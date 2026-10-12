// The AI & Finance case tools: AkzoNobel, AB InBev / SABMiller, LEGO India.
// Each page's prompt block must build exactly the server's prompt; LEGO's stress
// panel must reproduce the deck's slides 52 and 54; AkzoNobel's comparison
// slide 29; and the server must refuse what it should.

import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { CASE_KINDS } from "../supabase/functions/ai/cases.ts";
import { InputError } from "../supabase/functions/ai/templates.ts";
import { handle } from "../supabase/functions/ai/gate.ts";
import { deriveCode } from "../supabase/functions/_shared/classcode.ts";
import { fakeModel, MemDb } from "./memstore.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const page = (f: string) => Deno.readTextFileSync(ROOT + "artifacts/" + f + ".html");

// The page's prompt block (plus, for LEGO, the data its model reads), run on its own.
// deno-lint-ignore no-explicit-any
function block(f: string, extra = ""): any {
  const s = page(f);
  const a = s.indexOf("/* ---- the prompt:"), b = s.indexOf("/* ---- end of the prompt ---- */");
  assert(a > 0 && b > a, f + ": prompt block not found");
  const names = s.slice(a, b).match(/function (\w+)\(/g)!.map((x) => x.slice(9, -1));
  return new Function(extra + s.slice(a, b) + "; return {" + names.join(",") + "};")();
}
const legoData = () => {
  const s = page("lego");
  return [s.match(/ {2}var Y = \[[^\]]*\];/)![0], s.match(/ {2}var SHARE = [^\n]*;/)![0]].join("\n") + "\n";
};
const serverPrompt = (kind: string, inputs: unknown) => {
  const k = CASE_KINDS[kind];
  return k.prompt(k.validate(inputs) as never);
};

const SAB_CASE = { offer: 64, und: 75, syn: 2.2, dis: 0, tax: 30, w: 7, g: 0, int: 0, gr: 3, rn: 12 };
const sabIn = (q: string, over: Record<string, number> = {}, question = "", rule = "We pay up to $65 per share if synergies reach $2.5 bn; we walk if disposals exceed a third.") =>
  ({ sliders: { ...SAB_CASE, ...over }, rule, q, question });

Deno.test("SAB: the page and the server build the same prompt, for the three questions and a free one", () => {
  const P = block("sab");
  const cases = [
    sabIn("red"), sabIn("flip", { offer: 70.5, dis: 35, tax: 38, w: 9.25, g: -1.5, int: 2.5, gr: 6.5, rn: 20 }), sabIn("sd", { offer: 50, und: 90 }),
    sabIn("free", {}, "  Would a share alternative change who keeps the spread?  "), sabIn("free", { syn: 0 }, "Is the rule too loose?", ""),
  ];
  for (const c of cases) assertEquals(P.casePrompt(c), serverPrompt("sab.ask", c), JSON.stringify(c).slice(0, 90));
});

Deno.test("SAB: the three red-team questions are the page's originals, word for word", () => {
  const original = new TextDecoder().decode(new Deno.Command("git", { args: ["show", "8f5767a:artifacts/sab.html"], cwd: ROOT }).outputSync().stdout);
  for (const q of ["red", "flip", "sd"]) {
    const m = original.match(new RegExp(`\\n {4}${q}: '([^']*)'`))!;
    assert(serverPrompt("sab.ask", sabIn(q)).includes(m[1].replace("\\u00a3", "£")), q);
  }
  const tail = original.match(/var TAIL = '([^']*)';/)![1].replace("\\n", "\n");
  assert(serverPrompt("sab.ask", sabIn("red")).endsWith(tail));
});

const LEGO_CASE = { share: 100, own: false, hq: 6, crp: 4, pg: 0, cg: 2, mg: 8, ss: 100, tax: true, sunk: false, int: false };

Deno.test("LEGO: the page and the server build the same prompt", () => {
  const P = block("lego", legoData());
  for (const c of [
    { sliders: LEGO_CASE, ranking: [3, 2, 1, 4, 5], question: "Stress-test this NPV: one assumption at a time." },
    { sliders: { ...LEGO_CASE, share: 30, own: true, pg: 1.5, crp: 0, sunk: true, int: true, tax: false }, ranking: [1, 2, 3, 4, 5], question: "Should LEGO sign?" },
    { sliders: { ...LEGO_CASE, ss: 150, mg: 12, cg: 5 }, ranking: [5, 4, 3, 2, 1], question: "Why does more volume lose money?" },
  ]) assertEquals(P.casePrompt(c), serverPrompt("lego.ask", c));
});

Deno.test("LEGO: the stress panel reproduces slides 52 and 54", () => {
  const P = block("lego", legoData());
  const st = P.stressRows();
  const m = (v: number) => Math.round(v / 1000);
  assertEquals(m(st.base), -232);
  assertEquals(Math.round(st.base), -232136); // the spreadsheet, to the unit
  const got = Object.fromEntries(st.rows.map((r: { change: string; npv: number; deal: number }) => [r.change, [m(r.npv), m(r.deal)]]));
  assertEquals(got, {
    "Price growth 2% a year": [256, 34], "Unit costs flat": [217, 22], "Price growth 1% a year": [5, -42],
    "Market share path ×0.75": [-204, -104], "Discount rate 14%: country premium 8%": [-214, -115],
    "Discount rate 6%: no country premium": [-253, -107], "Market share path ×1.25": [-261, -121],
    "Market growth 12% a year": [-282, -128], "Unit cost growth 3% a year": [-476, -186],
  });
  assertEquals(m(st.baseD), -113);
  assertEquals([st.bePrice, st.bePriceDeal, st.beCost].map((x: number) => (x * 100).toFixed(2)), ["0.98", "1.56", "0.99"]);
  // the price path decides it; the discount rate barely moves it
  assertEquals(st.rank, [1, 2, 5, 4, 3]); // A price 1st, B unit cost 2nd, E market growth 3rd, D share 4th, C rate 5th
  assertEquals(m(st.swing[2]), 21); // "from 6% to 14%, NPV moves by INR 40 m": 21 down, 18 up
});

const AKZO_CASE = { ppg: 98.74, proc: 8.6, mult: 11.5, eb: 1349, debt: 3585, pay: 100, leak: 0 };

Deno.test("AkzoNobel: the page and the server build the same prompt, in both scenarios", () => {
  const P = block("akzo");
  for (const c of [
    { scenario: "A", sliders: AKZO_CASE, commit: { pc: 47, sc: 35.5 }, question: "What would PPG have to add?" },
    { scenario: "B", sliders: { ...AKZO_CASE, proc: 10.1, mult: 13, leak: 12, pay: 80 }, commit: { pc: 50, sc: 30 }, question: "Sell, or accept €89?" },
    { scenario: "A", sliders: { ...AKZO_CASE, ppg: 85.25, eb: 1000, debt: 5000 }, commit: { pc: -3, sc: 0 }, question: "Is the parts value credible?" },
  ]) assertEquals(P.casePrompt(c), serverPrompt("akzo.ask", c));
});

Deno.test("AkzoNobel: the comparison after the commit reproduces slide 29", () => {
  const P = block("akzo");
  const x = P.akzoState("A", AKZO_CASE);
  assertEquals([x.remain, x.dist, x.sop].map((v: number) => v.toFixed(1)), ["47.3", "34.1", "81.5"]);
  assertEquals(x.offer.toFixed(2), "96.75");
  assertEquals((x.offer - x.sop).toFixed(1), "15.3");
  assertEquals(x.be.toFixed(1), "14.4");
});

Deno.test("the three pages: the programme's footer, the proxy, and the commit screens", () => {
  for (const f of ["sab", "lego", "akzo"]) {
    const s = page(f);
    assert(!/Nyenrode|lecture 3|window\.claude/.test(s), f);
    assert(s.includes('<p class="note">AI &amp; Finance programme. Case:') && !/executive programme|Session \d, case/.test(s), f);
    if (f === "akzo") assert(s.includes("Segment margins and returns: shareholder circular, 18 October 2017, annexes 1 and 2."));
    assert(/^const AI_URL = "https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/ai";/m.test(s), f);
    assert(s.includes('id="gate"') && s.includes('class="locked" id="model"'), f);
  }
});

Deno.test("the case kinds refuse what they should", () => {
  const v = (k: string, i: unknown) => CASE_KINDS[k].validate(i);
  for (const [k, bad] of [
    ["sab.ask", sabIn("free")], // a free question needs a question
    ["sab.ask", sabIn("red", {}, "and also this")], // a preset carries no question
    ["sab.ask", sabIn("poem")],
    ["sab.ask", sabIn("red", { offer: 120 })],
    ["sab.ask", sabIn("free", {}, "x".repeat(601))],
    ["lego.ask", { sliders: LEGO_CASE, ranking: [1, 1, 2, 3, 4], question: "Why?" }],
    ["lego.ask", { sliders: LEGO_CASE, ranking: [1, 2, 3, 4], question: "Why?" }],
    ["lego.ask", { sliders: { ...LEGO_CASE, own: "yes" }, ranking: [1, 2, 3, 4, 5], question: "Why?" }],
    ["akzo.ask", { scenario: "C", sliders: AKZO_CASE, commit: { pc: 1, sc: 1 }, question: "Why?" }],
    ["akzo.ask", { scenario: "A", sliders: AKZO_CASE, commit: { pc: 1, sc: 1 }, question: "?" }],
    ["akzo.ask", { scenario: "A", sliders: AKZO_CASE, commit: { pc: 1 }, question: "Why not?" }],
  ] as [string, unknown][]) assertThrows(() => v(k, bad), InputError, undefined, k + " " + JSON.stringify(bad).slice(0, 70));
  for (const k of Object.keys(CASE_KINDS)) assertEquals([CASE_KINDS[k].effort, CASE_KINDS[k].limit, CASE_KINDS[k].windowSeconds], ["medium", 8, 600]);
});

Deno.test("the gate sends case questions at medium effort, and logs them under their tool", async () => {
  const db = new MemDb(), calls: { effort: string }[] = [];
  const code = await deriveCode("p", db.ctl.class_code_salt);
  const res = await handle(new Request("https://x/functions/v1/ai", {
    method: "POST",
    headers: { origin: "https://www.theaiminute.blog", "x-class-code": code, "x-device-id": "dev_case_01" },
    body: JSON.stringify({ kind: "akzo.ask", inputs: { scenario: "A", sliders: AKZO_CASE, commit: { pc: 47, sc: 34 }, question: "What would PPG have to add?" } }),
  }), { store: db, callModel: fakeModel(calls as never), pepper: "p", dev: false });
  assertEquals(res.status, 200);
  assertEquals(typeof (await res.json()).result, "string");
  assertEquals(calls[0].effort, "medium");
  assertEquals([db.rows[0].artifact, db.rows[0].bucket], ["akzo", "akzo.ask"]);
});

Deno.test("the three pages use the programme palette, with no gold text on cream", () => {
  for (const f of ["sab", "lego", "akzo"]) {
    const s = page(f), css = s.slice(0, s.indexOf("</style>"));
    for (const [v, hex] of [["bg", "#ECEBE3"], ["ink", "#193C3F"], ["gold", "#C6A553"]]) {
      assert(new RegExp(`--${v}: ${hex}`).test(css), `${f}: --${v}`);
    }
    assert(!/#0F2A2C|#173A3D|color-scheme: dark/.test(css), f + ": dark theme left");
    assert(!/(^|[;{\s])color:\s*var\(--gold\)/m.test(css), f + ": gold used as text colour");
    assert(!/fill:var\(--gold\)|fill:var\(--bg\)/.test(s), f + ": gold or cream text in a chart");
    assert(s.includes('<header class="band">') && /body \{[^}]*font-family: Georgia/.test(css), f);
  }
});

Deno.test("AkzoNobel: two ways to make a margin, computed from the circular's figures", () => {
  const src = page("akzo");
  const a = src.indexOf("/* ---- margin decomposition:"), b = src.indexOf("/* ---- end of the margin decomposition ---- */");
  const M = new Function(src.slice(a, b) + "; return marginDecomposition(SEG);")();
  const p1 = (v: number) => (v * 100).toFixed(1) + "%", p0 = (v: number) => Math.round(v * 100) + "%";
  const got = (k: "sc" | "pc") => {
    const d = M[k];
    return [p1(d.gross), p1(d.sga), p1(d.margin), Math.round(d.ic), d.turnover.toFixed(2) + "×", p1(d.roic), p1(d.taxRate), p1(d.roicAfterTax), p1(d.roicTangible),
      [p0(d.shareRevenue), p0(d.shareOpInc), p0(d.shareIc)].join(" / ")];
  };
  //                gross    SG&A     op. margin  IC    turnover pre-tax  tax      after-tax tangible  shares
  // Turnover: 5,098 / 3,433 = 1.484998..., which rounds to 1.48 (the brief's 1.49 rounds twice, via 1.485).
  assertEquals(M.sc.turnover.toFixed(4), "1.4850");
  assertEquals(got("sc"), ["34.0%", "21.9%", "12.0%", 3433, "1.48×", "17.9%", "25.2%", "13.4%", "23.6%", "34% / 38% / 38%"]);
  assertEquals(got("pc"), ["45.0%", "34.3%", "10.4%", 5624, "1.74×", "18.1%", "25.8%", "13.5%", "45.9%", "66% / 62% / 62%"]);
  // ROIC is margin × turnover
  for (const k of ["sc", "pc"]) assert(Math.abs(M[k].roic - M[k].margin * M[k].turnover) < 1e-12);
});

Deno.test("AkzoNobel: the multiple each ROIC justifies, at the default 2% growth", () => {
  const src = page("akzo");
  const a = src.indexOf("/* ---- margin decomposition:"), b = src.indexOf("/* ---- end of the margin decomposition ---- */");
  const P = new Function(src.slice(a, b) + "; return { M: marginDecomposition(SEG), SEG, justifiedMultiple, CASE_WACC };")();
  const ms = P.justifiedMultiple(P.M.sc.roicAfterTax, 0.02, P.CASE_WACC), mp = P.justifiedMultiple(P.M.pc.roicAfterTax, 0.02, P.CASE_WACC);
  const nopatSc = 2 * P.SEG.sc.opInc * (1 - P.M.sc.taxRate);
  assertEquals([ms.toFixed(1), mp.toFixed(1), Math.round(nopatSc), (ms * nopatSc / 953).toFixed(1)], ["23.0", "23.0", 459, "11.1"]);
  assertEquals(P.justifiedMultiple(0.1, 0, 0.057).toFixed(2), (1 / 0.057).toFixed(2)); // no growth: 1 / WACC
  // display only: the multiples never reach the sum of the parts
  assert(!/justifiedMultiple|iGsc|iGpc/.test(src.slice(src.indexOf("function calc()"), src.indexOf("function sens("))));
});
