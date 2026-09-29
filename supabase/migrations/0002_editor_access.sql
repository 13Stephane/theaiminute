-- Editor access without the service-role key.
--
-- Until now editor.html wrote posts and media with the service-role key,
-- shipped to every browser. From here on, editors sign in with Supabase Auth
-- (email link), and the database itself decides what a signed-in editor, and
-- everyone else, may do:
--   * anyone may read published posts (what index.html needs);
--   * only editors may read drafts and write, archive or delete posts;
--   * only editors may upload to or change the public "media" bucket.
-- Safe to run more than once.

-- 1. Who the editors are. Rows are added by hand in the SQL editor, e.g.
--      insert into public.editors (email, author) values ('you@example.com', 'stephane');
create table if not exists public.editors (
  email  text primary key check (email = lower(email)),
  author text not null check (author in ('stephane', 'hanne'))
);
alter table public.editors enable row level security;
revoke all on public.editors from anon, authenticated;
grant select on public.editors to authenticated;
drop policy if exists "editors read their own row" on public.editors;
create policy "editors read their own row" on public.editors
  for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

-- True when the signed-in user's email is in public.editors.
create or replace function public.is_editor()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.editors where email = lower(auth.jwt() ->> 'email'))
$$;
revoke all on function public.is_editor() from public;
grant execute on function public.is_editor() to anon, authenticated;

-- 2. Posts. Existing policies are dropped so the end state is exactly this.
alter table public.posts enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'posts' loop
    execute format('drop policy %I on public.posts', p.policyname);
  end loop;
end $$;

create policy "anyone reads published posts" on public.posts
  for select to anon, authenticated
  using (status = 'published');

create policy "editors read every post" on public.posts
  for select to authenticated
  using (public.is_editor());

create policy "editors add posts" on public.posts
  for insert to authenticated
  with check (public.is_editor());

create policy "editors change posts" on public.posts
  for update to authenticated
  using (public.is_editor()) with check (public.is_editor());

create policy "editors delete posts" on public.posts
  for delete to authenticated
  using (public.is_editor());

-- 3. The media bucket stays public for reading (its public URLs bypass these
--    policies); writing needs an editor. Upserts need select as well.
drop policy if exists "media: editors read"   on storage.objects;
drop policy if exists "media: editors upload" on storage.objects;
drop policy if exists "media: editors change" on storage.objects;
drop policy if exists "media: editors delete" on storage.objects;

create policy "media: editors read" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and public.is_editor());

create policy "media: editors upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and public.is_editor());

create policy "media: editors change" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and public.is_editor())
  with check (bucket_id = 'media' and public.is_editor());

create policy "media: editors delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and public.is_editor());
