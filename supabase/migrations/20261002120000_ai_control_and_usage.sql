-- Live AI for artifacts 03 and 06: the control row and the usage log.
-- Additive: creates new objects only, touches nothing existing.
-- RLS is on and there are no policies, so anon and authenticated users can
-- neither read nor write. Only the edge functions (service role) touch these.

-- ── control: exactly one row ────────────────────────────────────────────────
create table if not exists public.ai_control (
  id              boolean primary key default true check (id),
  enabled         boolean      not null default false,
  opens_at        timestamptz,
  closes_at       timestamptz,
  budget_usd      numeric(10,2) not null default 5 check (budget_usd >= 0),
  budget_since    timestamptz  not null default now(),
  -- The class code is derived from this salt with the CLASS_CODE_PEPPER secret;
  -- the code itself is never stored. See supabase/functions/_shared/classcode.ts.
  class_code_salt text         not null default replace(gen_random_uuid()::text, '-', ''),
  updated_at      timestamptz  not null default now(),
  updated_by      text
);
insert into public.ai_control (id) values (true) on conflict do nothing;

-- ── usage: one row per call ─────────────────────────────────────────────────
create table if not exists public.ai_usage (
  id            bigint generated always as identity primary key,
  ts            timestamptz  not null default now(),
  artifact      text,                       -- '03' | '06' | null when the kind was unknown
  kind          text         not null,      -- '03.decompose' | '06.briefing' | '06.debrief' | 'unknown'
  bucket        text,                       -- rate-limit bucket
  device        text,
  status        int          not null,      -- HTTP status returned; 0 while the model call is in flight
  reason        text,
  input_tokens  int          not null default 0,
  output_tokens int          not null default 0,
  cost_usd      numeric(12,6) not null default 0,
  latency_ms    int          not null default 0,
  inputs        jsonb,                      -- validated structured inputs: job titles and game numbers
  model         text
);
create index if not exists ai_usage_ts_idx on public.ai_usage (ts desc);
create index if not exists ai_usage_rate_idx on public.ai_usage (device, bucket, ts desc);

alter table public.ai_control enable row level security;
alter table public.ai_usage   enable row level security;
revoke all on public.ai_control from anon, authenticated;
revoke all on public.ai_usage   from anon, authenticated;

-- ── spend since a timestamp ─────────────────────────────────────────────────
create or replace function public.ai_spend_since(p_since timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_usd), 0) from ai_usage where ts >= p_since;
$$;

-- ── spend by artifact since a timestamp (control room) ──────────────────────
create or replace function public.ai_spend_by_artifact(p_since timestamptz)
returns table (artifact text, calls bigint, ok_calls bigint, cost_usd numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(u.artifact, '—'), count(*), count(*) filter (where u.status = 200), coalesce(sum(u.cost_usd), 0)
  from ai_usage u where u.ts >= p_since group by 1 order by 1;
$$;

-- ── atomic rate check + reservation ─────────────────────────────────────────
-- Serialises per device and bucket, counts calls that are in flight (0) or
-- succeeded (200) inside the window, and inserts the pending row if under the
-- limit. Rejected and failed calls do not use up a device's allowance.
create or replace function public.ai_reserve(
  p_device text, p_bucket text, p_limit int, p_window_seconds int, p_row jsonb
) returns bigint language plpgsql security definer set search_path = public as $$
declare
  n int;
  new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('ai_rate:' || p_device || ':' || p_bucket));
  select count(*) into n from ai_usage
   where device = p_device and bucket = p_bucket
     and ts > now() - make_interval(secs => p_window_seconds)
     and status in (0, 200);
  if n >= p_limit then
    return null;
  end if;
  insert into ai_usage (artifact, kind, bucket, device, status, inputs, model)
  values (p_row->>'artifact', p_row->>'kind', p_bucket, p_device, 0, p_row->'inputs', p_row->>'model')
  returning id into new_id;
  return new_id;
end $$;

revoke all on function public.ai_spend_since(timestamptz)        from public, anon, authenticated;
revoke all on function public.ai_spend_by_artifact(timestamptz)  from public, anon, authenticated;
revoke all on function public.ai_reserve(text, text, int, int, jsonb) from public, anon, authenticated;
grant execute on function public.ai_spend_since(timestamptz)       to service_role;
grant execute on function public.ai_spend_by_artifact(timestamptz) to service_role;
grant execute on function public.ai_reserve(text, text, int, int, jsonb) to service_role;
