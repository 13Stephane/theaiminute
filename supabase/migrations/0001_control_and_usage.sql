-- Live AI for artifacts 03 and 06: one control row and a usage log.
-- The tables carry an ai_ prefix because this project also hosts the course
-- schema. RLS is on with no policies, and the client roles lose every grant:
-- only the service role (used inside the edge functions) can read or write.

create table if not exists public.ai_control (
  id              smallint primary key default 1 check (id = 1),
  enabled         boolean      not null default false,
  opens_at        timestamptz,
  closes_at       timestamptz,
  budget_usd      numeric(10,2) not null default 5 check (budget_usd >= 0 and budget_usd <= 1000),
  budget_since    timestamptz  not null default now(),
  class_code_salt text,
  class_code_hash text,
  updated_at      timestamptz  not null default now()
);

insert into public.ai_control (id) values (1) on conflict (id) do nothing;

create table if not exists public.ai_usage (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  artifact      text        not null,
  kind          text        not null,
  device        text        not null,
  status        smallint    not null,
  reason        text,
  called        boolean     not null default false, -- true when Anthropic was actually called
  model         text,
  input_tokens  integer     not null default 0,
  output_tokens integer     not null default 0,
  cost_usd      numeric(12,6) not null default 0,
  latency_ms    integer,
  inputs        jsonb
);

create index if not exists ai_usage_at_idx     on public.ai_usage (at desc);
create index if not exists ai_usage_device_idx on public.ai_usage (device, kind, at desc);

alter table public.ai_control enable row level security;
alter table public.ai_usage   enable row level security;

revoke all on public.ai_control from anon, authenticated;
revoke all on public.ai_usage   from anon, authenticated;

-- Spend since a moment, and per-artifact spend, computed in the database.
create or replace function public.ai_spend_since(since timestamptz)
returns table (artifact text, spend numeric, calls bigint)
language sql stable security invoker as $$
  select artifact, coalesce(sum(cost_usd), 0), count(*) filter (where called)
  from public.ai_usage
  where at >= since
  group by artifact
$$;

-- Calls that reached Anthropic for one device and kind inside a window.
create or replace function public.ai_device_calls(p_device text, p_kind text, since timestamptz)
returns bigint
language sql stable security invoker as $$
  select count(*) from public.ai_usage
  where device = p_device and kind = p_kind and called and at >= since
$$;

revoke all on function public.ai_spend_since(timestamptz)            from public, anon, authenticated;
revoke all on function public.ai_device_calls(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_spend_since(timestamptz)            to service_role;
grant execute on function public.ai_device_calls(text, text, timestamptz) to service_role;
