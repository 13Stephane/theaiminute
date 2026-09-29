// deno test tests/compose_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { handleCompose, MAX_TOKENS, MISTRAL_MODEL, mistralCaller } from "../supabase/functions/compose/logic.ts";

const ORIGIN = "https://www.theaiminute.blog";
const calls: [string, string][] = [];
const deps = {
  editorForToken: (t: string) => Promise.resolve(t === "editor-token" ? "hanne@example.com" : null),
  callMistral: (system: string, user: string) => {
    calls.push([system, user]);
    return Promise.resolve('{"title":"T","body":"B","hashtags":["#AI"]}');
  },
  allowLocalhost: false,
};
const post = (body: unknown, token: string | null = "editor-token", origin = ORIGIN) =>
  handleCompose(
    new Request("https://x/functions/v1/compose", {
      method: "POST",
      headers: { origin, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
    deps,
  );

Deno.test("an editor gets the model's text back", async () => {
  const res = await post({ system: "You write for The AI Minute.", user: "Post type: insight\nIdea: boards" });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGIN);
  assertEquals((await res.json()).text, '{"title":"T","body":"B","hashtags":["#AI"]}');
  assertEquals(calls.at(-1), ["You write for The AI Minute.", "Post type: insight\nIdea: boards"]);
});

Deno.test("no session, a non-editor, or another site: refused, the model is not called", async () => {
  const before = calls.length;
  assertEquals((await post({ system: "s", user: "u" }, null)).status, 403);
  assertEquals((await post({ system: "s", user: "u" }, "stranger-token")).status, 403);
  assertEquals((await post({ system: "s", user: "u" }, "editor-token", "https://evil.example")).status, 403);
  assertEquals(calls.length, before);
});

Deno.test("inputs are bounded", async () => {
  assertEquals((await post({ system: "s", user: "" })).status, 400);
  assertEquals((await post({ system: "s".repeat(8001), user: "u" })).status, 400);
  assertEquals((await post({ system: "s", user: "u".repeat(4001) })).status, 400);
  assertEquals((await post({ user: "u" })).status, 400);
});

Deno.test("the Mistral call uses the server's model, limit and key", async () => {
  let sent: Record<string, unknown> = {}, auth = "";
  const fake = ((_u: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string);
    auth = new Headers(init.headers).get("authorization") ?? "";
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] })));
  }) as typeof fetch;
  assertEquals(await mistralCaller("server-secret", fake)("sys", "usr"), "hello");
  assertEquals([sent.model, sent.max_tokens, auth], [MISTRAL_MODEL, MAX_TOKENS, "Bearer server-secret"]);
});
