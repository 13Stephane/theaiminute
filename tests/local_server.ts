// Local harness: serves the site and the `ai` function on http://localhost:8787
// with an in-memory store, so both pages can be exercised without Supabase.
//
//   deno run --allow-net --allow-read --allow-env tests/local_server.ts
//
// With ANTHROPIC_API_KEY set it calls Anthropic for real; otherwise a canned
// reply stands in. Test-only control: POST /__control with a JSON patch
// (enabled, opens_at, closes_at, budget_usd, code), GET /__usage for the log.
// Artifacts are served with AI_URL pointed here (class code LOCAL1); append
// ?offline to a page's URL to get it exactly as committed.
// The admin function is served too; bearer token "local-admin" is the admin,
// "local-other" is a signed-in stranger.

import { anthropicCaller, type CallAnthropic, handle } from "../supabase/functions/ai/gate.ts";
import { handleAdmin } from "../supabase/functions/admin/logic.ts";
import { hashCode } from "../supabase/functions/_shared/http.ts";
import { memStore } from "./memstore.ts";

const PORT = Number(Deno.env.get("PORT") ?? 8787);
const PEPPER = "local-pepper";
const ROOT = new URL("..", import.meta.url).pathname;
const m = memStore({ enabled: true, budget_usd: 5 });
await setCode("LOCAL1");

async function setCode(code: string) {
  m.control.class_code_salt = "local-salt";
  m.control.class_code_hash = await hashCode(code, "local-salt", PEPPER);
}

const canned: CallAnthropic = (prompt) =>
  Promise.resolve({
    model: "claude-sonnet-5-5",
    text: prompt.includes("jobs-vs-tasks")
      ? JSON.stringify([
        { task: "Screen CVs at volume", type: "automate", why: "Pattern matching on stated criteria", time: 20, value: 8 },
        { task: "Schedule interviews", type: "automate", why: "Calendar logistics", time: 10, value: 4 },
        { task: "Draft job adverts", type: "augment", why: "AI drafts; recruiter sets tone", time: 10, value: 10 },
        { task: "Assess cultural fit", type: "human", why: "Tacit judgement", time: 25, value: 38 },
        { task: "Close the offer", type: "human", why: "Negotiation and trust", time: 35, value: 40 },
      ])
      : prompt.includes("debriefing players")
      ? "LIVE DEBRIEF: your path tracked the real one closely."
      : "LIVE BRIEFING: the quarter in three sentences.",
    inputTokens: 320,
    outputTokens: 640,
    refused: false,
  });

const key = Deno.env.get("ANTHROPIC_API_KEY");
const deps = {
  store: m.store,
  callAnthropic: key ? anthropicCaller(key) : canned,
  pepper: PEPPER,
  allowLocalhost: true,
};

const adminDeps = {
  store: m.store,
  emailForToken: (t: string) =>
    Promise.resolve(({ "local-admin": "admin@local.test", "local-other": "other@local.test" } as Record<string, string>)[t] ?? null),
  adminEmail: "admin@local.test",
  pepper: PEPPER,
  allowLocalhost: true,
};

const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css" };

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/functions/v1/ai")) return handle(req, deps);
  if (url.pathname.startsWith("/functions/v1/admin")) return handleAdmin(req, adminDeps);
  if (url.pathname === "/__control" && req.method === "POST") {
    const patch = await req.json();
    if (patch.code) await setCode(patch.code);
    delete patch.code;
    Object.assign(m.control, patch);
    return Response.json(m.control);
  }
  if (url.pathname === "/__usage") return Response.json(m.usage);
  const path = decodeURIComponent(url.pathname).replace(/\/$/, "/index.html");
  if (path.includes("..")) return new Response("no", { status: 400 });
  try {
    let body: Uint8Array | string = await Deno.readFile(ROOT + path);
    // Artifacts are served live, pointed at this harness; add ?offline to get them untouched.
    if (path.startsWith("/artifacts/") && path.endsWith(".html") && !url.searchParams.has("offline")) {
      body = new TextDecoder().decode(body)
        .replace('const AI_URL = "";', `const AI_URL = "http://localhost:${PORT}/functions/v1/ai";`);
    }
    return new Response(body, { headers: { "content-type": TYPES[path.split(".").pop()!] ?? "application/octet-stream" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
});
console.log(`local harness on http://localhost:${PORT}  (Anthropic: ${key ? "live" : "canned"})`);
