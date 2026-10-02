// Local stand-in for the whole setup, for trying the pages in a browser:
//   /ai, /ai/status     the real gate (supabase/functions/ai/gate.ts), in-memory db
//   /admin-fn           the real admin handler; sessions "dev-admin" and "dev-other"
//   /_dev/control?...   flip the switch, window, budget, without the control room
//   /_dev/usage         the usage rows
//   everything else     the site's files, with AI_URL pointed at /ai
// The model is a fake unless REAL=1 and ANTHROPIC_API_KEY are set.
//
//   deno run --allow-net --allow-read --allow-env --allow-run=git tests/dev_server.ts

import { handle } from "../supabase/functions/ai/gate.ts";
import { handleAdmin } from "../supabase/functions/admin/handler.ts";
import { deriveCode } from "../supabase/functions/_shared/classcode.ts";
import { EFFORT } from "../supabase/functions/ai/templates.ts";
import { fakeModel, MemDb } from "./memstore.ts";
import type { CallModel } from "../supabase/functions/ai/gate.ts";

const PORT = Number(Deno.env.get("PORT") ?? 8787);
const ROOT = new URL("..", import.meta.url).pathname;
const PEPPER = "dev-pepper";
const db = new MemDb();
db.ctl.budget_since = new Date().toISOString();

let callModel: CallModel = fakeModel([]);
if (Deno.env.get("REAL") === "1") {
  const { default: Anthropic } = await import("npm:@anthropic-ai/sdk@0.131.0");
  const client = new Anthropic();
  callModel = async ({ model, maxTokens, prompt }) => {
    const msg = await client.messages.create({
      model, max_tokens: maxTokens, output_config: { effort: EFFORT }, messages: [{ role: "user", content: prompt }],
    });
    return {
      text: msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n"),
      stopReason: msg.stop_reason, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens,
    };
  };
}

const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", json: "application/json", css: "text/css", png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg" };

Deno.serve({ port: PORT, hostname: "127.0.0.1" }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/ai" || url.pathname.startsWith("/ai/")) {
    return handle(req, { store: db, callModel, pepper: PEPPER, dev: true });
  }
  if (url.pathname === "/admin-fn") {
    return handleAdmin(req, {
      db: db.admin(), adminEmail: "admin@example.com", pepper: PEPPER, dev: true,
      userEmail: (jwt) => Promise.resolve(({ "dev-admin": "admin@example.com", "dev-other": "student@example.com" } as Record<string, string>)[jwt] ?? null),
    });
  }
  if (url.pathname === "/_dev/control") {
    const q = url.searchParams;
    if (q.has("enabled")) db.ctl.enabled = q.get("enabled") === "true";
    if (q.has("budget")) db.ctl.budget_usd = Number(q.get("budget"));
    if (q.has("reset")) db.ctl.budget_since = new Date().toISOString();
    if (q.has("closes_in_min")) db.ctl.closes_at = new Date(Date.now() + Number(q.get("closes_in_min")) * 60e3).toISOString();
    if (q.has("clear_window")) { db.ctl.opens_at = null; db.ctl.closes_at = null; }
    if (q.has("clear_usage")) db.rows = [];
    return Response.json({ ...db.ctl, code: await deriveCode(PEPPER, db.ctl.class_code_salt) });
  }
  if (url.pathname === "/_dev/usage") return Response.json(db.rows);

  let path = decodeURIComponent(url.pathname);
  if (path.endsWith("/")) path += "index.html";
  try {
    let body: BodyInit = await Deno.readFile(ROOT + path.slice(1)) as Uint8Array<ArrayBuffer>;
    const ext = path.split(".").pop()!;
    if (ext === "html" && url.searchParams.has("live")) {
      body = new TextDecoder().decode(body as Uint8Array<ArrayBuffer>)
        .replace(/^const AI_URL = "[^"]*";/m, `const AI_URL = "${url.origin}/ai";`)
        .replace('const ADMIN_URL = SUPABASE_URL + "/functions/v1/admin";', `const ADMIN_URL = "${url.origin}/admin-fn";`);
    }
    return new Response(body, { headers: { "content-type": TYPES[ext] ?? "application/octet-stream" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
});

console.log(`dev server on http://127.0.0.1:${PORT}  class code: ${await deriveCode(PEPPER, db.ctl.class_code_salt)}  model: ${Deno.env.get("REAL") === "1" ? "REAL" : "fake"}`);
