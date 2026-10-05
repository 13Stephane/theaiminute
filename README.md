# theaiminute.blog

Static pages for theaiminute.blog, served by Cloudflare from `main`. This README covers **live AI for artifacts 03, 06 and 08**: a server-side proxy that holds the Anthropic key, plus a control room that switches live AI on for course days and off otherwise.

| Piece | Where |
|---|---|
| Artifact 03, jobs vs tasks | `03_jobs_vs_tasks.html` and an identical copy, `artifacts/03_jobs_vs_tasks_decomposer.html` (a test keeps them in sync) |
| Artifact 06, pandemic policy room (v2.5) | `06_policy_room.html` and an identical copy, `artifacts/06_pandemic_policy_room.html` (a test keeps them in sync) |
| Artifact 08, the flood, the wall, and the way out | `artifacts/08_the_flood_value_chain.html` |
| Control room | `admin/index.html`, at `/admin/` |
| Proxy, the only caller of Anthropic | `supabase/functions/ai/` |
| Control-room actions | `supabase/functions/admin/` |
| Tables `ai_control` and `ai_usage` | `supabase/migrations/` |
| Tests | `tests/` |

Each page has `const AI_URL = "";` at the top of its script. Empty means offline only: the page behaves as it always did. Every live failure (switched off, outside the window, wrong code, budget spent, rate limit, network) falls back to the offline text with a one-line reason.

## One-time setup

The functions run in the existing Supabase project `kcobpakjfluuyfzswtoq`, beside live-room and `course_place`. Run the commands from this repo's root.

1. **Link the project.**
   ```bash
   supabase login
   supabase link --project-ref kcobpakjfluuyfzswtoq
   ```
2. **Push the migration.** This creates `ai_control` and `ai_usage` and touches nothing else.
   ```bash
   supabase db push
   ```
   If the push complains about remote migration history, paste `supabase/migrations/20261002120000_ai_control_and_usage.sql` into the SQL editor and run it instead.
3. **Set the secrets.** Copy `.env.example` to `.env`, fill it in (`openssl rand -hex 32` makes a pepper), then:
   ```bash
   supabase secrets set --env-file .env
   ```
   `.env` is git-ignored. The key lives only in Supabase secrets.
4. **Deploy the functions.** `ai` is public; `admin` requires a signed-in session.
   ```bash
   supabase functions deploy ai --no-verify-jwt
   supabase functions deploy admin
   ```
5. **Point the pages at the proxy.** In `03_jobs_vs_tasks.html`, its copy `artifacts/03_jobs_vs_tasks_decomposer.html`, and `artifacts/06_pandemic_policy_room.html`, set
   ```js
   const AI_URL = "https://kcobpakjfluuyfzswtoq.supabase.co/functions/v1/ai";
   ```
   then commit and push `main`. Cloudflare publishes the pages.
6. **Auth.** In Supabase, open Authentication, then URL Configuration, and add `https://www.theaiminute.blog/admin/` and `https://theaiminute.blog/admin/` to the redirect URLs. Then, under Sign In / Providers, **turn off "Allow new users to sign up"** and add your admin address as a user (Users, then Add user). The control room only sends links to existing users. With sign-ups off, nobody else can create an account on this shared project.
7. **Spend backstop.** In the Claude Console, set a monthly spend limit on the workspace that owns the key.

Then check the deployment:
```bash
deno run --allow-net tests/smoke.ts https://kcobpakjfluuyfzswtoq.supabase.co/functions/v1/ai
```
Also check that the code folders are not published (the `.assetsignore` file keeps them out of the Cloudflare build):
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://www.theaiminute.blog/supabase/functions/ai/templates.ts
```
A `404` means they are hidden. A `200` means Cloudflare is not reading `.assetsignore`. That is harmless, since there are no secrets in these files, but say so if you want them hidden another way.

## Running a session

1. Open `https://www.theaiminute.blog/admin/` and sign in with the link.
2. Press **Today 08:30–16:30** (or Tomorrow), then **Save window**.
3. Set the budget (5 USD a day is plenty) and press **Reset spend to $0**.
4. **Rotate** the class code and **Copy** it.
5. Press the switch. The line under it should read **Live AI on**.
6. Put the code on a slide. Pages show a "Live AI on" badge and a class-code field.

The window switches live AI off at the end of the day even if the switch stays on. Before the class, run the smoke test with the code to see the whole path work (it costs about two cents):
```bash
deno run --allow-net tests/smoke.ts https://kcobpakjfluuyfzswtoq.supabase.co/functions/v1/ai ABC123
```

## How the proxy decides

`POST /functions/v1/ai` with `{kind, inputs}` and the headers `X-Class-Code` and `X-Device-Id`. Checked in this order:

| # | Check | Refusal |
|---|---|---|
| 1 | Origin is `https://www.theaiminute.blog` or `https://theaiminute.blog` | 403 |
| 2 | The switch is on | 423 `{reason: "off"}` |
| 3 | Now is inside `opens_at`..`closes_at`, when set | 423 `{reason: "outside window"}` |
| 4 | The class code matches | 401 |
| 5 | Spend since the last reset is below the budget | 429 `{reason: "budget"}` |
| 6 | The device is under its limit: 03 gets 4 decompositions and 3 second opinions per 10 minutes; 06 gets 10 briefings and 1 debrief an hour; 08 gets 4 feedback calls an hour | 429 `{reason: "rate"}` |
| 7 | The kind is `03.decompose`, `03.review`, `06.briefing`, `06.debrief` or `08.feedback`, and every input has the right type, length and range | 400 |

Only then does it call Anthropic. It logs the call to `ai_usage` and returns `{result, usage, cost_usd}`. For `03.decompose` the result is the parsed task array; for `03.review`, Claude's call and weights per task plus the disagreements worth arguing about. Both are validated on the server. `08.feedback` answers `{text, usage, cost_usd}` instead: the page reads the reply's prose and closing JSON block itself, as it does for a reply pasted from any assistant. Failed and refused calls do not use up a device's allowance. `GET /functions/v1/ai/status` returns `{live, reason}` with no secrets; the pages use it for the badge.

The prompts live in `supabase/functions/ai/templates.ts`. The 03 decomposition and both 06 prompts are moved verbatim from the pages (a test checks this against the pages as they were); the 03 second-opinion prompt is new, and the page's copy-a-prompt version is tested to match it. 08's `buildPrompt()` stays in the page for the copy-a-prompt route, and a test checks that the server builds byte-identical text from the same work.

**Retired: the Cloudflare Worker for 08.** 08 used to send its prompt to a Worker (`flood-feedback-worker.js`, `PROXY_URL`). That Worker was never deployed and is no longer needed: 08 goes through the same `ai` function, gate, class code, budget and window as 03 and 06. The server fixes the model and `max_tokens` per kind; anything else in the request body is ignored.

**The class code** is never stored. `ai_control` holds a random salt, and the code is `HMAC-SHA256(CLASS_CODE_PEPPER, salt)` mapped to six characters. The database alone cannot reveal the code, and the control room can still show the current one at any time. Rotating writes a new salt.

**Allowing localhost** for testing: set the secret `AI_DEV=1`. Without it, only the two production origins are accepted.

## Model and cost

| | |
|---|---|
| Model | `claude-sonnet-5-5` ([models overview](https://platform.claude.com/docs/en/about-claude/models/overview)) |
| API version | `anthropic-version: 2023-06-01`, sent by the official SDK |
| Price | $2 per million input tokens, $10 per million output tokens ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)), kept in one constant, `PRICE_PER_MTOK` in `templates.ts` |
| Thinking | On by default for Sonnet 5.5 (adaptive). Thinking tokens count as output: `max_tokens` caps thinking and answer together, and they are billed at the output rate. |
| Effort | `output_config: {effort: "low"}`, which the [effort docs](https://platform.claude.com/docs/en/build-with-claude/effort) recommend for short, scoped, latency-sensitive tasks |
| `max_tokens` | 03 decomposition: 3000 · 03 second opinion: 4000 · 06 briefing: 2000 · 06 debrief: 2000 · 08 feedback: 4000. The old pages used 1000, sized for a model without thinking. |

**Cost for a course day**, from real calls on 4 October 2026:

| Calls | Tokens in / out | Cost each | Day |
|---|---|---|---|
| 20 decompositions or second opinions (03) | ~320-590 / ~600 | ~$0.007 | ~$0.14 |
| 40 briefings (5 tables × 8 quarters) | ~545 / ~585 | ~$0.0069 | ~$0.28 |
| 5 debriefs | ~640 / ~620 | ~$0.0075 | ~$0.04 |
| **Total** | | | **~$0.46** |

Set a **daily budget of $5**. A full day costs well under that even at the ceiling. The control room shows the real figures per call as they come in.

## Tests

```bash
deno test --allow-read --allow-run=git tests/
```
These run the real gate and admin handlers against an in-memory database and a fake model. They cover every refusal, the gate order, the rate limits, the verbatim prompts, and a check that 06's engine, `ACTUAL`, scoring and export are byte-identical. They also play 3,000 random games to confirm that any game passes the server's input ranges.

To try the pages in a browser without Supabase or a key:
```bash
deno run --allow-net --allow-read --allow-env --allow-run=git tests/dev_server.ts
```
Then open `http://127.0.0.1:8787/03_jobs_vs_tasks.html?live` (the `?live` points `AI_URL` at the local gate). The class code is printed at start-up. `REAL=1` with `ANTHROPIC_API_KEY` set uses the real model.
