# theaiminute.blog: live AI for artifacts 03 and 06

Artifacts 03 (Jobs vs Tasks) and 06 (Pandemic Policy Room) can call Claude live during the course days and run offline the rest of the time. A Supabase Edge Function holds the Anthropic key and is the only thing that talks to Anthropic. A control room at `/admin/` switches it on and off, sets a time window and a budget, and shows every call as it happens.

With `AI_URL` empty, both pages are offline-only and behave as they always have. They still work from a memory stick.

## How it is hosted

The site is served by **Cloudflare Pages** from this repository (the live responses carry `server: cloudflare`, `_headers` is applied, and `.html` is redirected to a clean URL). A commit to `main` publishes. There is no build step. The backend reuses the course's existing Supabase project, with its own `ai_`-prefixed tables.

```
supabase/
  config.toml                         function settings (ai public, admin behind auth)
  migrations/0001_control_and_usage.sql
  functions/_shared/config.ts         model, effort, max_tokens, rate limits, PRICES
  functions/_shared/http.ts           CORS, class-code hashing
  functions/_shared/store.ts          database access
  functions/ai/index.ts               entry point
  functions/ai/gate.ts                the gate and the Anthropic call
  functions/ai/templates.ts           prompts (moved verbatim from the pages) and input validation
  functions/admin/index.ts, logic.ts  control-room actions, ADMIN_EMAIL only
admin/index.html                      the control room
artifacts/03_jobs_vs_tasks_decomposer.html, artifacts/06_pandemic_policy_room.html
tests/                                Deno tests, browser checks, smoke script, local harness
```

## One-time setup

You need the [Supabase CLI](https://supabase.com/docs/guides/cli) and access to the project `kcobpakjfluuyfzswtoq`.

0. **Rotate the leaked service-role key first.** `editor.html` (line 419, `SUPABASE_SERVICE`) carries this project's **service-role** key, in a public repository and on the public site. That key ignores row-level security, so whoever reads it can rewrite any table here, `ai_control` included: switch live AI on, lift the budget, delete the usage log. The class code still holds, because its hash needs the pepper, but the other controls do not. Rotate the key in the Supabase dashboard (project API settings), and move whatever `editor.html` writes behind an edge function so the new key never reaches a browser. Rotating the legacy JWT secret also changes the anon key in `config.js` and `index.html`. Until this is done, a separate Supabase project for live AI is the safer home. The only project-specific values are `AI_URL` in the two pages and the Supabase URL and anon key that the control room reads from `config.js`.

1. **Link the project.**
   ```
   supabase link --project-ref kcobpakjfluuyfzswtoq
   ```
2. **Push the migration.**
   ```
   supabase db push
   ```
   If the CLI objects that the remote migration history does not match (the course tables were created outside this folder), paste `supabase/migrations/0001_control_and_usage.sql` into the SQL editor in the dashboard and run it. It is safe to run twice.
3. **Set the secrets.** Copy `.env.example` to `.env`, fill it in, then:
   ```
   supabase secrets set --env-file .env
   ```
   `CLASS_CODE_PEPPER` is any long random string: `openssl rand -hex 32`. Delete `.env` afterwards, or at least never commit it (`.gitignore` already excludes it).
4. **Deploy the functions.** `ai` is public; `admin` requires a signed-in session.
   ```
   supabase functions deploy ai --no-verify-jwt
   supabase functions deploy admin
   ```
5. **Point the pages at the function.** In both artifacts, the first line of the script becomes:
   ```js
   const AI_URL = "https://kcobpakjfluuyfzswtoq.supabase.co/functions/v1/ai";
   ```
   Commit to `main`; Cloudflare Pages publishes it.
6. **Supabase Auth.** In *Authentication → URL Configuration*, add `https://www.theaiminute.blog/admin/` to the redirect URLs. In *Authentication → Users*, add your own address (the same as `ADMIN_EMAIL`): the control room sends links only to existing users, so strangers cannot create accounts from it.
7. **Backstop.** In the Claude Console, set a monthly spend limit on the workspace that owns the key. If everything else fails, that is the ceiling.

## Running a session

1. Open `https://www.theaiminute.blog/admin/` and sign in with the emailed link.
2. Press **Today 08:30–16:30** (or Tomorrow), then **Save window**. Times are Copenhagen time, whatever the laptop thinks.
3. Check the **budget** ($5 a day is plenty) and press **Reset spend** at the start of the day.
4. Press **Rotate** for a fresh class code, then **Copy**.
5. Press the big switch to **ON**.
6. Put the class code on a slide. Students type it once; the page remembers it.

At the end of the window live AI switches itself off, so an evening of forgetting costs nothing. The switch stays on, ready for tomorrow's window.

## What the pages do

- A small badge reads **Live AI on** or **Offline mode**, from `GET /ai/status`. The class-code field appears only while live.
- Any failure falls back exactly as before (worked examples in 03, offline summaries in 06) with one line saying why: "Live AI is off", "That class code was not accepted", "Today's live-AI budget is spent", and so on.
- 03, for a custom role with no live AI, offers **Copy a prompt for any AI** (the same wording as the server's template) and a box to paste the answer back. If the browser blocks the clipboard, the prompt appears in a text box, already selected.
- 06 keeps its game engine, `ACTUAL`, scoring and export byte-identical. The in-page call limit is gone; the server's limits replace it.

## The gate

Every call to `ai` is checked in this order. Only a call that passes all seven reaches Anthropic.

| Step | Check | Failure |
|---|---|---|
| 1 | Origin is `https://www.theaiminute.blog` or `https://theaiminute.blog` (localhost only with `AI_ALLOW_LOCALHOST=true`) | 403 |
| 2 | The switch is on | 423 `{reason: "off"}` |
| 3 | Now is inside the window, when one is set | 423 `{reason: "outside window"}` |
| 4 | `X-Class-Code` matches the salted hash | 401 |
| 5 | Spend since the last reset is below the budget | 429 `{reason: "budget"}` |
| 6 | The device (`X-Device-Id`) is under its limit | 429 `{reason: "rate"}` |
| 7 | `kind` is known and every input has the right type, length and range | 400 |

Pages send only `{kind, inputs}`. The allowed kinds are `03.decompose`, `06.briefing` and `06.debrief`. The prompts live in `templates.ts`; a request that names a model or a `max_tokens` is ignored on those points. Per-device limits: 03, 4 calls per 10 minutes; 06, 10 briefings and 1 debrief per hour. Every call after the origin check is logged to `ai_usage`: time, artifact, kind, device, status, tokens, cost, latency and the validated inputs (job titles and game numbers, no personal data).

## Model and cost

Checked against the Anthropic documentation on 29 September 2026:

- Model `claude-sonnet-5-5`, API version header `anthropic-version: 2023-06-01` ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)).
- Price: **$2 per million input tokens, $10 per million output tokens.** Kept in one constant, `PRICES` in `supabase/functions/_shared/config.ts`.
- Thinking is adaptive by default on Sonnet 5.5, is billed as output tokens, and counts toward `max_tokens`. Calls run at `output_config.effort: "low"`, the level the [effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort) gives for simple, latency-sensitive work; at low effort the model skips thinking on most simple requests.
- `max_tokens` is fixed per kind (03: 4,000; briefing: 1,500; debrief: 2,000), which caps each call's worst case.
- A refusal is retried server-side on Claude Sonnet 5 (`fallbacks: "default"`, same price). It is unlikely to fire on job titles and GDP gaps.

Expected cost of a course day (20 decompositions, 5 tables × 8 briefings, 5 debriefs). The token counts per call are estimates until the first session's log replaces them:

| Kind | Calls | Estimated tokens in / out | Estimated cost | Ceiling at `max_tokens` |
|---|---|---|---|---|
| 03.decompose | 20 | ~300 / ~700 | $0.15 | $0.81 |
| 06.briefing | 40 | ~260 / ~200 | $0.10 | $0.62 |
| 06.debrief | 5 | ~330 / ~250 | $0.02 | $0.10 |
| **Day** | | | **≈ $0.30** | **$1.53** |

So a dollar is a generous day, and the recommended **daily budget of $5** will only ever be reached by something going wrong, which is exactly when you want it reached.

## Tests

```
deno test --allow-read tests/                              # gate, templates, admin (20 tests)
deno run --allow-net --allow-read --allow-env tests/local_server.ts   # local harness on :8787
node tests/pages_e2e.mjs                                   # both pages in Chromium, offline and live
node tests/admin_e2e.mjs                                   # the control room in Chromium
AI_URL=https://kcobpakjfluuyfzswtoq.supabase.co/functions/v1/ai CLASS_CODE=ABC123 tests/smoke.sh
```

The local harness serves the site and both functions with an in-memory database and a canned Claude, so everything can be exercised without Supabase or a key. With `ANTHROPIC_API_KEY` set it calls Claude for real.

### Trying it by hand on your own machine

1. Start the harness (add `ANTHROPIC_API_KEY=sk-ant-...` in front for real answers; a decomposition costs about a cent):
   ```
   deno run --allow-net --allow-read --allow-env tests/local_server.ts
   ```
2. Open `http://localhost:8787/artifacts/03_jobs_vs_tasks_decomposer.html`. The badge reads **Live AI on**; the class code is `LOCAL1`. Add `?offline` to the address to see the page exactly as committed.
3. Flip the state from a second terminal and watch the pages react:
   ```
   curl -X POST localhost:8787/__control -d '{"enabled":false}'          # Live AI is off
   curl -X POST localhost:8787/__control -d '{"enabled":true,"budget_usd":0}'  # budget spent
   curl -X POST localhost:8787/__control -d '{"budget_usd":5,"code":"NEWONE"}' # new class code
   curl localhost:8787/__usage                                                # the usage log
   ```
The control room needs real Supabase sign-in, so locally it is covered by `tests/admin_e2e.mjs` only.

Everything in this repository is published by Cloudflare Pages, including this README and the function source. None of it is secret: the key, the pepper and the admin address live only in Supabase secrets.
