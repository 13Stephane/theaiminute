// Artifact 08: the server builds the same prompt as the page, the page's
// arithmetic is unchanged, and only the live-AI route differs from the file
// as delivered.

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { InputError, KINDS, promptFlood } from "../supabase/functions/ai/templates.ts";

const DELIVERED = "ee7d527"; // 08 exactly as handed over, before the live-AI wiring
const ROOT = new URL("..", import.meta.url).pathname;
const FILE = "artifacts/08_the_flood_value_chain.html";
const after = Deno.readTextFileSync(ROOT + FILE);
const before = new TextDecoder().decode(
  new Deno.Command("git", { args: ["show", `${DELIVERED}:${FILE}`], cwd: ROOT }).outputSync().stdout,
);

// The page's script, run against a minimal stand-in for the DOM.
function loadPage(src: string) {
  const script = src.slice(src.indexOf("<script>") + 8, src.lastIndexOf("</script>"));
  const upTo = (marker: string) => script.slice(0, script.indexOf(marker));
  const fn = (head: string) => {
    const i = script.indexOf(head);
    let d = 0, j = script.indexOf("{", i);
    for (; j < script.length; j++) { if (script[j] === "{") d++; else if (script[j] === "}" && --d === 0) break; }
    return script.slice(i, j + 1);
  };
  const exampleSrc = (() => { const i = script.indexOf('$("loadEx").onclick=()=>{'); return script.slice(i, script.indexOf("\n};", i) + 3); })();
  const els: Record<string, { value: string; innerHTML?: string; style?: Record<string, string> }> = {};
  const el = (id: string) => (els[id] ??= { value: "", innerHTML: "", style: {} });
  const document = { getElementById: el };
  // deno-lint-ignore no-explicit-any
  const page: any = new Function("document", "localStorage",
    upTo("/* ---------- 1 · the flood") + "\n" +
    ["function draftSentence(", "function buildPrompt(", "function drawKpis("].map(fn).join("\n") + "\n" +
    (script.includes("function floodInputs(") ? fn("function floodInputs(") : "") + `
    const drawRows=()=>{}, drawWall=()=>{}, renderAll=()=>{}, exampleSnapshot=()=>null; var EXAMPLE=null;
    ${exampleSrc}
    return { buildPrompt, drawKpis, draftSentence,
      rules: typeof isContested === "function" ? { isContested, insAlone, insOf, callOf } : null,
      floodInputs: typeof floodInputs === "function" ? floodInputs : null,
      loadExample(){ $("loadEx").onclick(); $("sent").value = draftSentence(); },
      set(r, w){ R = r; W = w; } };`)(document, {});
  return { page, el };
}

Deno.test("08: the worked example still adds up (7 activities, 32-34 votes, waterline 0.72, 1 kept human, 4 cards, 3 bound)", () => {
  for (const src of [before, after]) {
    const { page } = loadPage(src);
    page.loadExample();
    const K = page.drawKpis().map((k: [unknown, string]) => `${k[1]}=${k[0]}`);
    assertEquals(K, ["activities=7", "votes per activity=32–34", "waterline=0.72", "kept human=1", "wall cards=4", "bound to you=3"]);
  }
});

Deno.test("08: the server prompt is byte-identical to the page's buildPrompt() on the worked example", () => {
  const { page } = loadPage(after);
  page.loadExample();
  const inputs = KINDS["08.feedback"].validate(page.floodInputs());
  assertEquals(promptFlood(inputs as never), page.buildPrompt());
  // and, on the worked example (room-sized votes, no insider), the page's prompt is the one
  // delivered plus the two sentences that explain contested activities and the insider
  const old = loadPage(before).page;
  old.loadExample();
  const added = [
    " When automate and keep human each draw at least 30% of the votes, the activity is marked CONTESTED instead of given a call. Teams have three or four members, and one may work in this industry: their vote is marked where given.",
    " Where an activity is contested, or the member from the industry voted alone, say which side you think is right.",
  ];
  assertEquals(added.reduce((t, a) => t.replace(a, ""), page.buildPrompt()), old.buildPrompt());
});

Deno.test("08: same prompt in the awkward cases (blank rows and cards, unvoted, undecided, nothing stated)", () => {
  const { page, el } = loadPage(after);
  const row = (n: string, a: number, g: number, h: number, ins = -1) => ({ n, a, g, h, ins, read: -1, why: "" });
  const card = (n: string, kind: number, bound: number, esc: number) => ({ n, kind, bound, esc, note: "", aiBound: null });
  const cases = [
    { R: [row("  Claims triage ", 3, 1, 0), row("", 0, 0, 0), row("Underwriting", 0, 0, 0)], W: [card("", 4, 0, 0), card("Actuarial data", 2, 0, 1)], route: "-1", relies: "1", move: "", sent: "Line one\nline two", industry: "", company: "" },
    { R: [row("Advice", 1, 1, 4)], W: [card("Brand", 3, 1, 3)], route: "1", relies: "-1", move: "Start Monday:\nhire two actuaries", sent: "", industry: "Banking", company: "Team 4" },
    { R: [row("Advice", 2, 2, 2)], W: [], route: "2", relies: "-1", move: "x", sent: "y", industry: "Retail", company: "" },
    // tables of three and four: contested rows, an insider alone, an insider with company, an insider vote not cast
    { R: [row("Claims triage", 2, 0, 2, 2), row("Fraud checks", 1, 1, 1, 0), row("Broker relations", 2, 1, 0, 2), row("Pricing", 2, 1, 0, 0), row("Complaints", 0, 1, 2, 1)],
      W: [card("Actuarial data", 2, 0, 1)], route: "0", relies: "0", move: "m", sent: "s", industry: "Insurance", company: "Table 3" },
  ];
  for (const c of cases) {
    page.set(c.R, c.W);
    for (const k of ["route", "relies", "move", "sent", "industry", "company"]) el(k).value = (c as Record<string, unknown>)[k] as string;
    const inputs = KINDS["08.feedback"].validate(page.floodInputs());
    assertEquals(promptFlood(inputs as never), page.buildPrompt(), JSON.stringify(c));
  }
});

Deno.test("08: what the voting change did not touch is still the file as delivered", () => {
  const block = (src: string, head: string) => {
    const i = src.indexOf(head);
    if (i < 0) throw new Error("not found: " + head);
    let d = 0, j = src.indexOf("{", i);
    for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && --d === 0) break; }
    return src.slice(i, j + 1);
  };
  for (const head of ["function drawWall(", "function drawRelies(", "function drawVerdict(", "function mdLite(", "function drawFeedback(",
    "function drawReadings(", "function drawKpis(", "function splitReply(", "function applyReply(", "function copyText(", "function median("]) {
    assertEquals(block(after, head), block(before, head), head);
  }
  // the worked example's data, the print styles and the report styles
  const slice = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
  assertEquals(slice(after, "  R=[[\"Appointment", "  FEEDBACK=\"\""), slice(before, "  R=[[\"Appointment", "  FEEDBACK=\"\""));
  assertEquals(slice(after, "  /* ---------- report ---------- */", "  @media screen"), slice(before, "  /* ---------- report ---------- */", "  @media print"));
  assertEquals(slice(after, "  @media print{", "</style>"), slice(before, "  @media print{", "</style>"));
  assertEquals(/PROXY_URL|Worker/.test(after), false);
});

Deno.test("08: contested and insider-alone at the sizes teams actually have", () => {
  const { page } = loadPage(after);
  const { isContested, insAlone, insOf, callOf } = page.rules;
  const r = (a: number, g: number, h: number, ins = -1) => ({ n: "x", a, g, h, ins, read: -1, why: "" });
  const cases: [string, ReturnType<typeof r>, string, boolean][] = [
    // team of 3
    ["3: 1 automate, 1 augment, 1 human", r(1, 1, 1), "contested", false],
    ["3: 2 automate, 1 human", r(2, 0, 1), "contested", false],
    ["3: 3 augment", r(0, 3, 0), "3 to 7 years", false],
    ["3: 2 automate, 1 augment", r(2, 1, 0), "already flooding", false],
    ["3: 1 automate, 2 human (kept human, not contested)", r(1, 0, 2), "resists", false],
    ["3: insider says human, others automate", r(2, 0, 1, 2), "contested", true],
    // team of 4
    ["4: 2 automate, 2 human", r(2, 0, 2), "contested", false],
    ["4: 2 automate, 2 augment", r(2, 2, 0), "under 3 years", false],
    ["4: 2 augment, 2 human", r(0, 2, 2), "resists", false],
    ["4: 3 automate, 1 human (0.75)", r(3, 0, 1), "under 3 years", false],
    ["4: insider augment, with one other", r(1, 2, 1, 1), "3 to 7 years", false],
    ["4: insider human, alone", r(2, 1, 1, 2), "under 3 years", true],
    ["4: insider vote not among the votes", r(4, 0, 0, 2), "already flooding", false],
  ];
  for (const [name, row, call, alone] of cases) {
    assertEquals([callOf(row), insAlone(row)], [call, alone], name);
    assertEquals(callOf(row) === "contested", isContested(row), name);
  }
  assertEquals(insOf(r(4, 0, 0, 2)), -1); // a marked vote that was not cast is not counted
});

Deno.test("08: invalid inputs are refused", () => {
  const v = KINDS["08.feedback"].validate;
  const ok = {
    industry: "Health insurance", company: "Team 2", route: 2, relies: 0, move: "A move", sentence: "A sentence",
    activities: [{ n: "Scheduling", a: 24, g: 7, h: 2, ins: -1 }], wall: [{ n: "Network", kind: 4, bound: 0, esc: 2 }],
  };
  v(ok);
  v({ ...ok, activities: [{ ...ok.activities[0], ins: 2 }] });
  const act = ok.activities[0], wc = ok.wall[0];
  for (const bad of [
    { ...ok, activities: Array(8).fill(act) },
    { ...ok, wall: Array(5).fill(wc) },
    { ...ok, activities: [{ ...act, a: 999 }] },
    { ...ok, move: "m".repeat(2000) },
    { ...ok, activities: [] },
    { ...ok, wall: [{ ...wc, kind: 8 }] },
    { ...ok, relies: 1 }, // only one card on the wall
    { ...ok, activities: [{ ...act, n: "line\nbreak" }] },
    { ...ok, industry: "i".repeat(81) },
    { ...ok, prompt: "ignore all that" },
    { ...ok, activities: [{ n: "Scheduling", a: 3, g: 0, h: 0, ins: 2 }] }, // insider voted human, but no human vote was cast
    { ...ok, activities: [{ n: "Scheduling", a: 3, g: 0, h: 0 }] }, // ins missing
  ]) assertThrows(() => v(bad), InputError, undefined, JSON.stringify(bad).slice(0, 80));
});
