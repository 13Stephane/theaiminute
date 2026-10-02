// The control room's function: only ADMIN_EMAIL can read or change anything.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleAdmin } from "../supabase/functions/admin/handler.ts";
import { deriveCode } from "../supabase/functions/_shared/classcode.ts";
import { MemDb } from "./memstore.ts";

const ADMIN = "admin@example.com";
const SESSIONS: Record<string, string> = { "jwt-admin": ADMIN, "jwt-other": "student@example.com", "jwt-upper": ADMIN.toUpperCase() };

function setup() {
  const db = new MemDb();
  const send = (jwt: string | null, body: unknown, origin = "https://www.theaiminute.blog") =>
    handleAdmin(
      new Request("https://x/functions/v1/admin", {
        method: "POST",
        headers: { origin, "content-type": "application/json", ...(jwt ? { authorization: "Bearer " + jwt } : {}) },
        body: JSON.stringify(body),
      }),
      {
        db: db.admin(), adminEmail: ADMIN, pepper: "test-pepper", dev: false,
        userEmail: (jwt) => Promise.resolve(SESSIONS[jwt] ?? null),
      },
    );
  return { db, send };
}

Deno.test("another address, no session, or the anon key cannot change anything", async () => {
  const { db, send } = setup();
  const before = JSON.stringify(db.ctl);
  for (const jwt of ["jwt-other", null, "anon-key-jwt"]) {
    for (const body of [
      { action: "set", enabled: false, budget_usd: 999 },
      { action: "rotate_code" },
      { action: "reset_budget" },
      { action: "state" },
    ]) {
      const res = await send(jwt, body);
      assertEquals(res.status, 403);
      const b = await res.json();
      assertEquals(b.code, undefined);
    }
  }
  assertEquals(JSON.stringify(db.ctl), before);
});

Deno.test("the admin can switch, set the window and budget, reset, rotate", async () => {
  const { db, send } = setup();
  const opens = "2026-10-05T06:30:00.000Z", closes = "2026-10-05T14:30:00.000Z";
  let res = await send("jwt-admin", { action: "set", enabled: false, opens_at: opens, closes_at: closes, budget_usd: 7.5 });
  assertEquals(res.status, 200);
  let b = await res.json();
  assertEquals([b.control.enabled, b.control.opens_at, b.control.closes_at, b.control.budget_usd], [false, opens, closes, 7.5]);
  assertEquals(b.status, { live: false, reason: "off" });
  assertEquals(b.control.updated_by, ADMIN);
  assertEquals(b.control.class_code_salt, undefined); // the salt never leaves the server

  const code1 = b.code;
  assertEquals(code1, await deriveCode("test-pepper", db.ctl.class_code_salt));
  b = await (await send("jwt-admin", { action: "rotate_code" })).json();
  assert(/^[A-Z2-9]{6}$/.test(b.code));
  assert(b.code !== code1);

  const since = db.ctl.budget_since;
  b = await (await send("jwt-upper", { action: "reset_budget" })).json(); // email match ignores case
  assert(b.control.budget_since > since);
  assertEquals(Array.isArray(b.log) && Array.isArray(b.by_artifact), true);
});

Deno.test("admin input is validated", async () => {
  const { send } = setup();
  for (const body of [
    { action: "set", enabled: "yes" },
    { action: "set", budget_usd: -1 },
    { action: "set", opens_at: "tomorrow-ish" },
    { action: "set" },
    { action: "drop_tables" },
  ]) assertEquals((await send("jwt-admin", body)).status, 400, JSON.stringify(body));
});

Deno.test("admin from a disallowed origin: 403", async () => {
  const { send } = setup();
  assertEquals((await send("jwt-admin", { action: "state" }, "https://evil.example")).status, 403);
});
