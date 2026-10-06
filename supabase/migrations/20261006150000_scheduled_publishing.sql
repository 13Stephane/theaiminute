-- Scheduled publishing.
--
-- The editor can set a post to "scheduled" with a publish time. This policy is
-- what makes that time mean something: Postgres opens the row the moment
-- published_at passes, on the database clock, with nothing running and nobody
-- present. Before it, a scheduled post stayed invisible for ever.
--
-- Additive. Permissive policies are OR'd, so the existing read policy for
-- published posts keeps working untouched.

drop policy if exists "public reads scheduled posts once due" on public.posts;

create policy "public reads scheduled posts once due"
  on public.posts
  for select
  to anon, authenticated
  using (status = 'scheduled' and published_at <= now());
