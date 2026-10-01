import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { handleAdmin } from "../supabase/functions/admin/logic.ts";
import { handle } from "../supabase/functions/ai/gate.ts";
import { memStore } from "./memstore.ts";

const ORIGIN = "https://www.theaiminute.blog";
const TOKENS: Record<string, string> = { "tok-admin": "Admin@Example.com", "tok-other": "someone@example.com" };

function setup() {
  const m = memStore({ enabled: false });
  const deps = {
    store: m.store,
    emailForToken: (t: string) => Promise.resolve(TOKENS[t] ?? null),
    adminEmail: "admin@example.com",
    pepper: "p",
    allowLocalhost: false,
  };
  const call = (token: string | null, body: unknown) =>
    handleAdmin(
      new Request("https://x/functions/v1/admin", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
      deps,
    );
  return { ...m, deps, call };
}

Deno.test("an address other than ADMIN_EMAIL cannot read or change anything", async () => {
  const s = setup();
  const before = JSON.stringify(s.control);
  for (const body of [{ action: "set", enabled: true, budget_usd: 999 }, { action: "rotate_code" }, { action: "reset_budget" }, { action: "state" }]) {
    assertEquals((await s.call("tok-other", body)).status, 403);
    assertEquals((await s.call(null, body)).status, 401);
    assertEquals((await s.call("forged", body)).status, 401);
  }
  assertEquals(JSON.stringify(s.control), before);
});

Deno.test("the admin can switch on, set window and budget, rotate and reset", async () => {
  const s = setup();
  let res = await s.call("tok-admin", {
    action: "set",
    enabled: true,
    budget_usd: 5,
    opens_at: "2026-10-06T06:30:00Z",
    closes_at: "2026-10-06T14:30:00Z",
  });
  assertEquals(res.status, 200);
  let st = await res.json();
  assertEquals(st.control.enabled, true);
  assertEquals(st.control.closes_at, "2026-10-06T14:30:00.000Z");
  assertEquals(st.control.has_code, false);

  res = await s.call("tok-admin", { action: "rotate_code" });
  st = await res.json();
  assertMatch(st.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  assert(!JSON.stringify(s.control).includes(st.code), "the plain code is never stored");
  assertEquals(st.control.has_code, true);

  // the rotated code opens the gate inside the window
  const gate = await handle(
    new Request("https://x/ai", {
      method: "POST",
      headers: { origin: ORIGIN, "x-class-code": st.code, "x-device-id": "device-0001" },
      body: JSON.stringify({ kind: "03.decompose", inputs: { job: "Recruiter" } }),
    }),
    {
      store: s.store,
      pepper: "p",
      allowLocalhost: false,
      now: () => new Date("2026-10-06T09:00:00Z"),
      callAnthropic: () =>
        Promise.resolve({
          model: "claude-sonnet-5-5",
          text: '[{"task":"a","type":"automate","why":"","time":1,"value":1},{"task":"b","type":"augment","why":"","time":1,"value":1},{"task":"c","type":"human","why":"","time":1,"value":1}]',
          inputTokens: 1,
          outputTokens: 1,
          refused: false,
        }),
    },
  );
  assertEquals(gate.status, 200);

  const before = s.control.budget_since;
  st = await (await s.call("tok-admin", { action: "reset_budget" })).json();
  assert(st.control.budget_since > before);
  assertEquals(st.log.length, 1);
});

Deno.test("admin input validation", async () => {
  const s = setup();
  assertEquals((await s.call("tok-admin", { action: "set", budget_usd: -1 })).status, 400);
  assertEquals((await s.call("tok-admin", { action: "set", enabled: "yes" })).status, 400);
  assertEquals((await s.call("tok-admin", { action: "set", opens_at: "2026-10-06T10:00:00Z", closes_at: "2026-10-06T09:00:00Z" })).status, 400);
  assertEquals((await s.call("tok-admin", { action: "drop_tables" })).status, 400);
  assertEquals((await s.call("tok-admin", { action: "set", opens_at: null, closes_at: null })).status, 200);
});
