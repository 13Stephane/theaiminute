# Editor access: setup

`editor.html` no longer carries the Supabase service-role key, the Mistral key or the placeholder passwords. Editors sign in with an emailed link; the database decides what they may do (`migrations/0002_editor_access.sql`); the AI Composer calls Mistral through the `compose` edge function, which holds the key.

Do the steps **in this order**. The old editor keeps working until step 4, because the service-role key ignores the new rules; the new editor works from step 4 on.

1. **Apply the migration.** In the Supabase dashboard, SQL editor: paste and run `migrations/0002_editor_access.sql` (or `supabase db push`). It is safe to run twice. It replaces every existing policy on `posts` with: anyone reads published posts; editors read and write everything. It adds editor-only write rules to the `media` bucket, which stays public for reading.
2. **Name the editors**, in the SQL editor, with your real addresses:
   ```sql
   insert into public.editors (email, author) values
     ('stephane@your-domain', 'stephane'),
     ('hanne@her-domain', 'hanne');
   ```
3. **Auth settings.**
   - *Authentication → Users*: add both addresses as users (the page sends links only to existing users).
   - *Authentication → URL Configuration*: add `https://www.theaiminute.blog/editor` to the redirect URLs.
   - Turn off new user sign-ups: editors and the control-room admin are added by hand, and nobody else needs an account.
4. **Deploy the Composer, then merge.**
   ```
   supabase link --project-ref kcobpakjfluuyfzswtoq
   supabase functions deploy compose
   ```
   It reads the `MISTRAL_API_KEY` secret (already set for `course_place`; after step 5, set it to the new key). Merge the pull request; Cloudflare Pages publishes the new editor.
5. **Retire the leaked keys.** Both are in this repository's history for good, so removing them from the page is not enough.
   - **Mistral:** revoke the key that was in `editor.html` in the Mistral console, create a new one, and `supabase secrets set MISTRAL_API_KEY=...`.
   - **Supabase service role:** rotate it in *Project Settings → API keys*. If you move to the new publishable and secret keys and disable the legacy ones, the anon key in `config.js`, `index.html` and `editor.html` must be replaced with the publishable key in the same change.

## Checking it

```
tests/editor_access_test.sh     # the migration on a local Postgres: 19 checks of who may read and write
deno test tests/compose_test.ts # the compose function
node tests/editor_e2e.mjs       # editor.html in Chromium with Supabase stubbed: 14 checks
```

After step 4, on the live site: sign in at `/editor` with each editor address, save a draft, upload an image, run the Composer. Then open `/` in a private window: published posts still show, the draft does not.
