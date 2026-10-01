#!/usr/bin/env bash
# Runs supabase/migrations/0002_editor_access.sql against a throwaway local
# Postgres that mimics Supabase's roles, auth.jwt() and storage.objects, then
# checks who may read and write posts and media. Needs PostgreSQL 15+ binaries.
#
#   tests/editor_access_test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DIR="$(mktemp -d)"; PORT=55432
trap '"$BIN/pg_ctl" -D "$DIR" stop -m fast >/dev/null 2>&1 || true; [ -n "${KEEP_LOG:-}" ] && cp "$DIR/log" /tmp/editor_access_pg.log; rm -rf "$DIR"' EXIT
if [ "$(id -u)" = 0 ]; then chown -R postgres "$DIR"; RUN="runuser -u postgres --"; else RUN=""; fi
$RUN "$BIN/initdb" -D "$DIR" -A trust -U postgres >/dev/null
$RUN "$BIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR" -l "$DIR/log" start >/dev/null
PSQL="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X"

# A minimal stand-in for what Supabase provides, plus the existing posts table
# with a wide-open policy of the kind this migration must remove.
$PSQL <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; grant usage on schema auth to anon, authenticated;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create schema storage; grant usage on schema storage to anon, authenticated;
create table storage.objects (id bigserial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated; grant usage on all sequences in schema storage to anon, authenticated;
create table public.posts (id bigserial primary key, title text, status text, author text,
  published_at timestamptz, archived boolean default false, series text);
grant all on public.posts to anon, authenticated; grant usage on all sequences in schema public to anon, authenticated;
alter table public.posts enable row level security;
create policy "wide open" on public.posts for all to anon using (true) with check (true);
insert into public.posts (title, status, author) values ('Live post', 'published', 'stephane'), ('A draft', 'draft', 'hanne');
SQL

$PSQL -f "$ROOT/supabase/migrations/0002_editor_access.sql"
$PSQL -f "$ROOT/supabase/migrations/0002_editor_access.sql"   # twice: must be idempotent
$PSQL -c "insert into public.editors values ('stephane@example.com','stephane'), ('hanne@example.com','hanne')"

fail=0
# as <role> <email or ''> <sql> -> prints result or ERROR
as() {
  local role=$1 email=$2 sql=$3 claims='{}'
  [ -n "$email" ] && claims="{\"email\":\"$email\",\"role\":\"$role\"}"
  $PSQL -t -A -c "begin; set local role $role; set local request.jwt.claims = '$claims'; $sql; commit;" 2>&1 \
    | grep -v -E '^(BEGIN|SET|COMMIT)$' | sed -E 's/^psql:.*ERROR: +/ERROR: /' | tr '\n' ' ' | sed 's/ *$//'
}
expect() { # label expected actual
  if [[ "$3" == *"$2"* ]]; then echo "PASS  $1"; else echo "FAIL  $1  -> got: $3"; fail=1; fi
}

expect "anon reads published posts only"            "Live post"  "$(as anon '' "select string_agg(title, '|') from public.posts")"
expect "anon cannot see drafts"                      "0"          "$(as anon '' "select count(*) from public.posts where status = 'draft'")"
expect "anon cannot add a post"                      "ERROR"      "$(as anon '' "insert into public.posts (title, status) values ('x','published')")"
expect "anon cannot change a post (0 rows)"           "0"        "$(as anon '' "with x as (update public.posts set title='hacked' returning 1) select count(*) from x")"
expect "anon cannot read the editors list"           "permission denied" "$(as anon '' 'select * from public.editors')"
expect "stranger signed in: published only"          "1"          "$(as authenticated 'someone@example.com' 'select count(*) from public.posts')"
expect "stranger cannot add a post"                  "ERROR"      "$(as authenticated 'someone@example.com' "insert into public.posts (title, status) values ('x','draft')")"
expect "stranger sees no editor row"                 "0"          "$(as authenticated 'someone@example.com' 'select count(*) from public.editors')"
expect "editor reads drafts too"                     "2"          "$(as authenticated 'stephane@example.com' 'select count(*) from public.posts')"
expect "editor email is case-insensitive"            "2"          "$(as authenticated 'Hanne@Example.com' 'select count(*) from public.posts')"
expect "editor learns their author from editors"     "hanne"      "$(as authenticated 'hanne@example.com' 'select author from public.editors')"
expect "editor adds a post"                           "1"        "$(as authenticated 'stephane@example.com' "with x as (insert into public.posts (title, status) values ('New','draft') returning 1) select count(*) from x")"
expect "editor changes a post"                        "3"        "$(as authenticated 'stephane@example.com' "with x as (update public.posts set archived = false returning 1) select count(*) from x")"
expect "editor deletes a post"                        "1"        "$(as authenticated 'hanne@example.com' "with x as (delete from public.posts where title = 'New' returning 1) select count(*) from x")"
expect "the old wide-open policy is gone"            "0"          "$($PSQL -t -A -c "select count(*) from pg_policies where tablename='posts' and policyname='wide open'")"
expect "editor uploads to media"                      "1"        "$(as authenticated 'stephane@example.com' "with x as (insert into storage.objects (bucket_id, name) values ('media','images/a.jpg') returning 1) select count(*) from x")"
expect "editor cannot upload to another bucket"      "ERROR"      "$(as authenticated 'stephane@example.com' "insert into storage.objects (bucket_id, name) values ('other','x')")"
expect "stranger cannot upload to media"             "ERROR"      "$(as authenticated 'someone@example.com' "insert into storage.objects (bucket_id, name) values ('media','x')")"
expect "anon cannot upload to media"                 "ERROR"      "$(as anon '' "insert into storage.objects (bucket_id, name) values ('media','x')")"

[ $fail = 0 ] && echo "all editor-access checks passed" || echo "SOME CHECKS FAILED"
exit $fail
