// The Six Moves game server in supabase/functions/six-moves/handler.ts, run
// with in-memory stores and a fake model: the Worker's contract, then the
// live room's spend control in front of the game master.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { handle, type ModelCall, resetRoomCache } from "../supabase/functions/six-moves/handler.ts";
import { deriveCode } from "../supabase/functions/_shared/classcode.ts";
import { costUsd, MODEL } from "../supabase/functions/ai/templates.ts";
import { MemDb, MemDocs } from "./memstore.ts";

const ORIGIN = "https://theaiminute.blog";
const PEPPER = "test-pepper";
const F = "facilitator-code", T = await deriveCode(PEPPER, "test-salt"); // the class code MemDb's salt gives
const SETTINGS = { teams: [{ id: "north", name: "North" }, { id: "south", name: "South" }] };

function setup(o: { reply?: string; fail?: number; perTeamPerHour?: number } = {}) {
  resetRoomCache();
  const docs = new MemDocs(), db = new MemDb();
  const asked: { model: string; maxTokens: number; system: string; user: string }[] = [];
  const callModel: ModelCall = (a) => {
    asked.push(a);
    if (o.fail) return Promise.resolve({ ok: false, status: o.fail, detail: "overloaded" });
    return Promise.resolve({ ok: true, text: o.reply ?? '{"story":"s","lens":"l","question":"q?"}', inputTokens: 300, outputTokens: 200 });
  };
  const send = async (method: string, path: string, body?: unknown, h: { code?: string; origin?: string | null } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", "x-code": h.code ?? F };
    if (h.origin !== null) headers.Origin = h.origin ?? ORIGIN;
    const res = await handle(
      new Request("https://x.supabase.co/functions/v1/six-moves" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      { docs, spend: db, callModel, hasKey: true, facilitatorCode: F, pepper: PEPPER, allowedOrigins: ORIGIN + ",https://www.theaiminute.blog", perTeamPerHour: o.perTeamPerHour },
    );
    return { status: res.status, headers: res.headers, json: res.status === 204 ? null : await res.json() };
  };
  return { docs, db, asked, send };
}

Deno.test("health, CORS and the prefix: the Worker's answers under /functions/v1/six-moves", async () => {
  const { send } = setup();
  const h = await send("GET", "/api/health", undefined, { code: "" });
  assertEquals(h.status, 200);
  assertEquals(h.json, { ok: true, model: MODEL, key: true, database: true, codes: true, originAllowed: true, aiLive: true });
  assertEquals(h.headers.get("access-control-allow-origin"), ORIGIN);
  assertEquals(h.headers.get("access-control-allow-headers"), "content-type, x-code");
  const pre = await send("OPTIONS", "/api/state", undefined, { origin: "https://www.theaiminute.blog" });
  assertEquals(pre.status, 204);
  assertEquals(pre.headers.get("access-control-allow-origin"), "https://www.theaiminute.blog");
  const other = await send("GET", "/api/health", undefined, { origin: "https://evil.example" });
  assertEquals(other.json.originAllowed, false);
  assertEquals(other.headers.get("access-control-allow-origin"), ORIGIN);
});

Deno.test("origin 403, wrong code 401, unknown route 404", async () => {
  const { send } = setup();
  assertEquals((await send("GET", "/api/state", undefined, { origin: "https://evil.example" })).status, 403);
  assertEquals((await send("GET", "/api/state", undefined, { origin: null })).status, 403);
  assertEquals((await send("GET", "/api/state", undefined, { code: "nope" })).status, 401);
  assertEquals((await send("GET", "/api/nothing")).status, 404);
});

Deno.test("writes: base 0 inserts once, then version must match; a conflict returns the current doc", async () => {
  const { send } = setup();
  assertEquals((await send("PUT", "/api/doc/settings", { data: SETTINGS, base: 0 })).json, { ok: true, version: 1 });
  const again = await send("PUT", "/api/doc/settings", { data: { teams: [] }, base: 0 });
  assertEquals(again.status, 409);
  assertEquals(again.json, { error: "Someone else saved this just now.", current: { data: SETTINGS, version: 1 } });
  assertEquals((await send("PUT", "/api/doc/settings", { data: SETTINGS, base: 1 })).json, { ok: true, version: 2 });
  assertEquals((await send("PUT", "/api/doc/settings", { data: SETTINGS, base: 1 })).status, 409);
  assertEquals((await send("PUT", "/api/doc/debrief", { data: { text: "x" }, base: 5 })).json.current, null);
  assertEquals((await send("PUT", "/api/doc/settings", { base: 0 })).status, 400);
  assertEquals((await send("PUT", "/api/doc/settings", { data: { big: "x".repeat(200001) }, base: 2 })).status, 413);
});

Deno.test("roles: a team writes only its listed team, never settings, notes, deletes or resets", async () => {
  const { send } = setup();
  await send("PUT", "/api/doc/settings", { data: SETTINGS, base: 0 });
  await send("PUT", "/api/doc/debrief", { data: { text: "notes" }, base: 0 });
  const team = { code: T };
  assertEquals((await send("PUT", "/api/doc/settings", { data: {}, base: 1 }, team)).status, 403);
  assertEquals((await send("PUT", "/api/doc/debrief", { data: {}, base: 1 }, team)).status, 403);
  assertEquals((await send("PUT", "/api/doc/team/west", { data: {}, base: 0 }, team)).status, 404);
  assertEquals((await send("PUT", "/api/doc/team/north", { data: { turns: [1] }, base: 0 }, team)).json, { ok: true, version: 1 });
  assertEquals((await send("DELETE", "/api/doc/team/north", undefined, team)).status, 403);
  assertEquals((await send("POST", "/api/reset", undefined, team)).status, 403);
  const st = await send("GET", "/api/state", undefined, team);
  assertEquals(st.json, { role: "team", ai: true, settings: SETTINGS, debrief: null, teams: { north: { turns: [1] } }, versions: { settings: 1, "team:north": 1 } });
  const fst = await send("GET", "/api/state");
  assertEquals(fst.json.debrief, { text: "notes" });
  assertEquals(fst.json.versions.debrief, 1);
  assertEquals((await send("DELETE", "/api/doc/team/north")).json, { ok: true });
  assertEquals((await send("POST", "/api/reset")).json, { ok: true });
  assertEquals((await send("GET", "/api/state")).json, { role: "facilitator", ai: true, settings: null, debrief: null, teams: {}, versions: {} });
});

Deno.test("AI: the server's prompt and model, the reply's JSON, the call logged with its cost", async () => {
  const { send, asked, db } = setup();
  const r = await send("POST", "/api/ai", { task: "feedback", data: { round: 1 }, team: "north" }, { code: T });
  assertEquals(r.status, 200);
  assertEquals(r.json, { json: { story: "s", lens: "l", question: "q?" } });
  assertEquals(asked[0].model, "claude-sonnet-5-5");
  assertEquals(asked[0].maxTokens, 700);
  assert(asked[0].system.startsWith("You are the game master of Six Moves"));
  assert(asked[0].user.startsWith('Round data (JSON):\n{"round":1}'));
  const row = db.rows[0];
  assertEquals([row.artifact, row.kind, row.bucket, row.device, row.status], ["six-moves", "six-moves.feedback", "six-moves", "north", 200]);
  assertEquals(row.cost_usd, costUsd(300, 200));
});

Deno.test("AI: console is facilitators only and returns text; unknown task 400; unreadable answer and upstream error 502", async () => {
  assertEquals((await setup().send("POST", "/api/ai", { task: "console", data: {} }, { code: T })).status, 403);
  const c = await setup({ reply: "Notes for the room." }).send("POST", "/api/ai", { task: "console", data: {} });
  assertEquals(c.json, { text: "Notes for the room." });
  assertEquals((await setup().send("POST", "/api/ai", { task: "toString", data: {} })).status, 400);
  const bad = setup({ reply: "no json here" });
  assertEquals((await bad.send("POST", "/api/ai", { task: "debrief", data: {}, team: "north" }, { code: T })).status, 502);
  assertEquals(bad.db.rows[0].reason, "bad output");
  const up = await setup({ fail: 529 }).send("POST", "/api/ai", { task: "feedback", data: {} }, { code: T });
  assertEquals(up.json, { error: "The model service returned an error (529)." });
  assertEquals(up.status, 502);
});

Deno.test("spend control: switch off hides the game master and refuses calls; budget and the team's hour give 429", async () => {
  const off = setup();
  off.db.ctl.enabled = false;
  assertEquals((await off.send("GET", "/api/state")).json.ai, false);
  const r = await off.send("POST", "/api/ai", { task: "feedback", data: {}, team: "north" }, { code: T });
  assertEquals(r.status, 503);
  assertEquals(off.asked.length, 0);
  assertEquals(off.db.rows[0].reason, "off");

  const broke = setup();
  broke.db.ctl.budget_usd = 0;
  assertEquals((await broke.send("POST", "/api/ai", { task: "feedback", data: {} }, { code: T })).status, 429);
  assertEquals(broke.asked.length, 0);

  const busy = setup({ perTeamPerHour: 2 });
  const ask = (team: string) => busy.send("POST", "/api/ai", { task: "feedback", data: {}, team }, { code: T });
  assertEquals((await ask("north")).status, 200);
  assertEquals((await ask("north")).status, 200);
  assertEquals((await ask("north")).json, { error: "Limit reached. Try again later." });
  assertEquals((await ask("south")).status, 200);
  assertEquals((await ask("NOT VALID")).status, 200); // falls to the shared "anon" bucket, as in the Worker
  assertEquals(busy.db.rows.filter((x) => x.device === "anon").length, 1);
});

Deno.test("the team code is the class code: typed loosely it works, rotated the old one stops, a failed read is 500 not 401", async () => {
  const { send, db } = setup();
  const loose = T.toLowerCase().slice(0, 3) + "-" + T.toLowerCase().slice(3);
  assertEquals((await send("GET", "/api/state", undefined, { code: loose })).json.role, "team");
  assertEquals((await send("GET", "/api/state", undefined, { code: T.slice(0, 5) })).status, 401);

  db.ctl.class_code_salt = "rotated-salt";
  resetRoomCache(); // the fifteen seconds have passed
  assertEquals((await send("GET", "/api/state", undefined, { code: T })).status, 401);
  const fresh = await deriveCode(PEPPER, "rotated-salt");
  assertEquals((await send("GET", "/api/state", undefined, { code: fresh })).json.role, "team");
  assertEquals((await send("GET", "/api/state")).json.role, "facilitator"); // the console code does not rotate

  resetRoomCache();
  db.control = () => Promise.reject(new Error("db down"));
  assertEquals((await send("GET", "/api/state", undefined, { code: fresh })).status, 500);
  assertEquals((await send("GET", "/api/health")).json.aiLive, false);
});
