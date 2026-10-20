-- Six Moves: the game's documents (settings, debrief notes, one per team).
-- Additive: creates one new table, touches nothing existing.
-- RLS is on and there are no policies, so anon and authenticated users can
-- neither read nor write. Only the six-moves edge function (service role) does.
-- Writes are optimistic: insert at version 1 when absent, otherwise update
-- where version matches the writer's base; no row changed means a conflict.

create table if not exists public.six_moves_docs (
  id         text        primary key,
  data       jsonb       not null,
  version    int         not null,
  updated_at timestamptz not null default now()
);

alter table public.six_moves_docs enable row level security;
revoke all on public.six_moves_docs from anon, authenticated;
