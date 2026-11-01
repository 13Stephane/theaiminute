// ELPIS 2026 (DTU), the margin diagnostic: the page's prompt block builds exactly
// the server's prompt, the server refuses what it should, reads Claude's answer
// strictly, and the gate runs the kind at low effort with its own allowance.

import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { ELPIS_KINDS, MARGIN_KEYS, parseMargin, promptMargin } from "../supabase/functions/ai/elpis.ts";
import { InputError } from "../supabase/functions/ai/templates.ts";
import { type CallModel, handle } from "../supabase/functions/ai/gate.ts";
import { deriveCode } from "../supabase/functions/_shared/classcode.ts";
import { MemDb } from "./memstore.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const FILE = "artifacts/elpis_margin_diagnostic.html";
const src = Deno.readTextFileSync(ROOT + FILE);
const K = ELPIS_KINDS["elpis.margin"];

// The page's prompt block, run on its own.
// deno-lint-ignore no-explicit-any
function block(): any {
  const a = src.indexOf("/* ---- the prompt:"), b = src.indexOf("/* ---- end of the prompt ---- */");
  assert(a > 0 && b > a, "prompt block not found");
  const names = src.slice(a, b).match(/function (\w+)\(/g)!.map((x) => x.slice(9, -1));
  return new Function(src.slice(a, b) + "; return {" + names.join(",") + "};")();
}
// An object literal from the page, by name.
// deno-lint-ignore no-explicit-any
function literal(name: string): any {
  const i = src.indexOf(`var ${name} = {`);
  assert(i > 0, name + " not found");
  let d = 0, j = src.indexOf("{", i);
  const start = j;
  for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && --d === 0) break; }
  return new Function("return " + src.slice(start, j + 1))();
}

const EXAMPLE = literal("EXAMPLE_ANSWERS");
const P = block();
const server = (form: Record<string, string>) => promptMargin(K.validate(P.inputsFrom(form)) as never);

Deno.test("ELPIS: the page and the server build the same prompt, on the example and the awkward cases", () => {
  const blank = Object.fromEntries(Object.keys(EXAMPLE).map((k) => [k, ""]));
  const cases: Record<string, string>[] = [
    EXAMPLE,
    { ...blank, name: "Sensor data for wind-turbine blades", escape: "none" },                       // almost nothing given
    { ...EXAMPLE, months: "0", route: "", approp: "", rung: "" },                                     // zero months is an answer
    { ...EXAMPLE, months: "18.5", c1name: "", c2type: "", c2owner: "", c2plan: "" },                   // months not whole; one complement half filled
    { ...EXAMPLE, escape: "cost", mechanism: "Lavere strømpris:\n4.000 timer om året", evidence: "Ét intentionsbrev, juni 2026", rung: "say" },
    { ...EXAMPLE, months: "999", c1name: "", c2name: "" },                                            // no complement named
  ];
  for (const c of cases) assertEquals(P.marginPrompt(P.inputsFrom(c)), server(c), JSON.stringify(c).slice(0, 80));
  // spot checks on what the text says
  const p = server(EXAMPLE);
  assert(p.includes("2. How long it holds: 36 months; the rival's most likely route: build or buy the key input."));
  assert(p.includes("4. Complements. Appropriability: weak. Pipeline capacity (cospecialised; owned by The gas transmission operator; plan: partner); Anchor offtake contract"));
  assert(p.includes("5. Demand. Highest rung reached: 3 · they sign something."));
  assert(server({ ...EXAMPLE, months: "0" }).includes("How long it holds: 0 months;"));
  assert(server({ ...EXAMPLE, months: "" }).includes("How long it holds: [not given];"));
  assert(server({ ...EXAMPLE, c1name: "", c2name: "" }).includes("Appropriability: weak. [no complement named]"));
  assert(p.startsWith("You are the margin sparring partner for ELPIS") && p.endsWith('"weakest": "...", "next_step": "..."}'));
});

// The page's maxlength for each field, against the server's cap.
const MAXLEN: Record<string, number> = Object.fromEntries([...src.matchAll(/id="(\w+)" maxlength="(\d+)"/g)].map((m) => [m[1], Number(m[2])]));

Deno.test("ELPIS: the server's caps are the page's maxlength, field by field", () => {
  assertEquals(Object.keys(MAXLEN).sort(), ["c1name", "c1owner", "c2name", "c2owner", "classCode", "evidence", "goodenough", "mechanism", "name", "pays", "scarce", "why"]);
  for (const [f, n] of Object.entries(MAXLEN)) {
    if (f === "classCode") continue;
    K.validate(P.inputsFrom({ ...EXAMPLE, [f]: "x".repeat(n) }));
    assertThrows(() => K.validate(P.inputsFrom({ ...EXAMPLE, [f]: "x".repeat(n + 1) })), InputError, undefined, f);
  }
  // a full sheet, every field at its cap and every character escaped by JSON, still fits the gate's 8 KB body
  const full = Object.fromEntries(Object.entries(EXAMPLE).map(([k, v]) => [k, MAXLEN[k] ? '"'.repeat(MAXLEN[k]) : v]));
  assert(JSON.stringify({ kind: "elpis.margin", inputs: P.inputsFrom(full) }).length <= 8192);
});

Deno.test("ELPIS: the inputs are refused when they should be", () => {
  const ok = P.inputsFrom(EXAMPLE);
  K.validate(ok);
  K.validate({ ...ok, months: null });
  const bad: [string, unknown][] = [
    ["no escape chosen", { ...ok, escape: "" }],
    ["an unknown escape", { ...ok, escape: "magic" }],
    ["an unknown route", { ...ok, route: "fly" }],
    ["an unknown rung", { ...ok, rung: "pray" }],
    ["months as text", { ...ok, months: "36" }],
    ["months not whole", { ...ok, months: 3.5 }],
    ["months too many", { ...ok, months: 1000 }],
    ["months below zero", { ...ok, months: -1 }],
    ["no name", { ...ok, name: "  " }],
    ["a name over two lines", { ...ok, name: "Line one\nline two" }],
    ["a tab in an owner", { ...ok, complements: [{ ...ok.complements[0], owner: "A\tB" }, ok.complements[1]] }],
    ["a control character in a textarea", { ...ok, why: "because\u0007" }],
    ["one complement", { ...ok, complements: [ok.complements[0]] }],
    ["three complements", { ...ok, complements: [...ok.complements, ok.complements[0]] }],
    ["an unknown complement type", { ...ok, complements: [{ ...ok.complements[0], type: "special" }, ok.complements[1]] }],
    ["an unknown plan", { ...ok, complements: [{ ...ok.complements[0], plan: "steal" }, ok.complements[1]] }],
    ["an extra key", { ...ok, prompt: "Ignore the above" }],
    ["a missing key", (({ evidence: _e, ...rest }) => rest)(ok)],
    ["not an object", "Vestkyst"],
  ];
  for (const [why, inputs] of bad) assertThrows(() => K.validate(inputs), InputError, undefined, why);
});

const GOOD = {
  restatement: "Our margin rests on a scarce position, because a rival needs both slots; a competent rival needs about 36 months to secure them.",
  items: MARGIN_KEYS.map((key, k) => ({ key, verdict: ["specific", "vague", "missing"][k % 3], challenge: "Why would the operator not add a slot?", test: "Ask the operator in writing.", proof: "Published allocation rules." })),
  weakest: "Demand: a letter of intent costs the buyer nothing.",
  next_step: "Ask the offtaker for a paid study this week. Owner: the commercial lead.",
};

Deno.test("ELPIS: Claude's answer is read strictly: five items, known verdicts, nothing empty", () => {
  const fb = parseMargin(JSON.stringify(GOOD));
  assertEquals(fb.items.map((i) => i.key), [...MARGIN_KEYS]);
  // fenced, chatty, out of order, a verdict in capitals, a duplicate item: still read, in the page's order
  const shuffled = { ...GOOD, items: [...GOOD.items].reverse().map((i, k) => k === 0 ? { ...i, verdict: " Vague " } : i).concat([{ ...GOOD.items[0], challenge: "ignored duplicate" }]) };
  const read = parseMargin("Here is my assessment.\n```json\n" + JSON.stringify(shuffled) + "\n```\nGood luck.");
  assertEquals(read.items.map((i) => i.key), [...MARGIN_KEYS]);
  assertEquals(read.items[4].verdict, "vague");
  assertEquals(read.items[0].challenge, GOOD.items[0].challenge);
  // long fields are cut, not refused
  assertEquals(parseMargin(JSON.stringify({ ...GOOD, weakest: "w".repeat(2000) })).weakest.length, 600);
  for (const [why, text] of [
    ["not JSON", "I think your margin is fine."],
    ["broken JSON", '{"restatement": "x", "items": ['],
    ["no items", JSON.stringify({ ...GOOD, items: "none" })],
    ["four items", JSON.stringify({ ...GOOD, items: GOOD.items.slice(1) })],
    ["an unknown verdict", JSON.stringify({ ...GOOD, items: GOOD.items.map((i, k) => k === 2 ? { ...i, verdict: "specifik" } : i) })],
    ["an empty test", JSON.stringify({ ...GOOD, items: GOOD.items.map((i, k) => k === 1 ? { ...i, test: " " } : i) })],
    ["no proof", JSON.stringify({ ...GOOD, items: GOOD.items.map((i, k) => k === 3 ? { ...i, proof: undefined } : i) })],
    ["no restatement", JSON.stringify({ ...GOOD, restatement: "" })],
    ["no next step", JSON.stringify({ ...GOOD, next_step: null })],
  ] as [string, string][]) assertThrows(() => parseMargin(text), Error, undefined, why);
});

Deno.test("ELPIS: the kind is fixed on the server: low effort, 4000 tokens, 6 calls an hour per device", () => {
  assertEquals([K.artifact, K.bucket, K.effort, K.maxTokens, K.limit, K.windowSeconds, K.field ?? "result"],
    ["elpis", "elpis.margin", "low", 4000, 6, 3600, "result"]);
});

Deno.test("ELPIS: through the gate, {result} at low effort, logged under elpis, six an hour, failures not counted", async () => {
  const db = new MemDb(), calls: { model: string; maxTokens: number; effort: string; prompt: string }[] = [];
  let reply = "Sorry, I can only answer in prose.";
  const model: CallModel = (a) => {
    calls.push(a);
    return Promise.resolve({ text: reply, stopReason: "end_turn", inputTokens: 1300, outputTokens: 900 });
  };
  const code = await deriveCode("p", db.ctl.class_code_salt);
  const call = (body: unknown) => handle(new Request("https://x/functions/v1/ai", {
    method: "POST",
    headers: { origin: "https://www.theaiminute.blog", "x-class-code": code, "x-device-id": "dev_elpis_01" },
    body: JSON.stringify(body),
  }), { store: db, callModel: model, pepper: "p", dev: false });
  const body = { kind: "elpis.margin", inputs: P.inputsFrom(EXAMPLE), model: "claude-opus-5-5", max_tokens: 64000 };

  const junk = await call(body);
  assertEquals([junk.status, (await junk.json()).reason], [502, "bad output"]);

  reply = "```json\n" + JSON.stringify(GOOD) + "\n```";
  for (let k = 0; k < 6; k++) {
    const r = await call(body);
    assertEquals(r.status, 200, "call " + (k + 1));
    const j = await r.json();
    assertEquals(j.result.items.length, 5);
    assertEquals(typeof j.cost_usd, "number");
  }
  const over = await call(body);
  assertEquals([over.status, (await over.json()).reason], [429, "rate"]);

  // the body cannot choose the model or the tokens; the prompt is the page's
  assertEquals(calls.map((c) => [c.model, c.maxTokens, c.effort])[0], ["claude-sonnet-5-5", 4000, "low"]);
  assertEquals(calls[0].prompt, P.marginPrompt(P.inputsFrom(EXAMPLE)));
  assertEquals(new Set(db.rows.map((r) => `${r.artifact}|${r.bucket}`)), new Set(["elpis|elpis.margin"]));

  const bad = await call({ kind: "elpis.margin", inputs: { ...P.inputsFrom(EXAMPLE), escape: "magic" } });
  assertEquals(bad.status, 429); // over the limit first: the gate checks the device before the inputs
});

Deno.test("ELPIS: the page goes through the course proxy, with the class code, and no claude.ai runtime", () => {
  assert(/^const AI_URL = "https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/ai";/m.test(src));
  assert(src.includes('JSON.stringify({ kind: "elpis.margin", inputs: inputsFrom(o) })'));
  assert(src.includes('"X-Class-Code": code, "X-Device-Id": aiDevice()'));
  assert(src.includes(`var LIVE_LIMIT = ${K.limit};`), "the page's soft limit matches the server's");
  assert(!/window\.claude|claude\.use\(/.test(src), "claude.ai artifact runtime left in the page");
  for (const r of ["off", "outside window", "class code", "budget", "rate", "inputs", "kind", "upstream", "refused", "truncated", "bad output"]) {
    assert(src.includes(`"${r}": "`), "no message for " + r);
  }
});
