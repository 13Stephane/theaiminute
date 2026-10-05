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
    const drawRows=()=>{}, drawWall=()=>{}, renderAll=()=>{};
    ${exampleSrc}
    return { buildPrompt, drawKpis, draftSentence,
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
  // and the page's prompt is the one delivered
  const old = loadPage(before).page;
  old.loadExample();
  assertEquals(page.buildPrompt(), old.buildPrompt());
});

Deno.test("08: same prompt in the awkward cases (blank rows and cards, unvoted, undecided, nothing stated)", () => {
  const { page, el } = loadPage(after);
  const row = (n: string, a: number, g: number, h: number) => ({ n, a, g, h, read: -1, why: "" });
  const card = (n: string, kind: number, bound: number, esc: number) => ({ n, kind, bound, esc, note: "", aiBound: null });
  const cases = [
    { R: [row("  Claims triage ", 3, 1, 0), row("", 0, 0, 0), row("Underwriting", 0, 0, 0)], W: [card("", 4, 0, 0), card("Actuarial data", 2, 0, 1)], route: "-1", relies: "1", move: "", sent: "Line one\nline two", industry: "", company: "" },
    { R: [row("Advice", 1, 1, 4)], W: [card("Brand", 3, 1, 3)], route: "1", relies: "-1", move: "Start Monday:\nhire two actuaries", sent: "", industry: "Banking", company: "Team 4" },
    { R: [row("Advice", 2, 2, 2)], W: [], route: "2", relies: "-1", move: "x", sent: "y", industry: "Retail", company: "" },
  ];
  for (const c of cases) {
    page.set(c.R, c.W);
    for (const k of ["route", "relies", "move", "sent", "industry", "company"]) el(k).value = (c as Record<string, unknown>)[k] as string;
    const inputs = KINDS["08.feedback"].validate(page.floodInputs());
    assertEquals(promptFlood(inputs as never), page.buildPrompt(), JSON.stringify(c));
  }
});

Deno.test("08: apart from the live-AI route, the page is the file as delivered", () => {
  const strip = (s: string) => s
    .replace(/^.*Two feedback routes.*\n/m, "")
    .replace(/^ {2}\.aibadge.*\n/gm, "")
    .replace(/^ *<span class="aibadge".*\n/m, "")
    .replace(/\/\* =+ CONFIGURATION =+[\s\S]*?\/\* =+ \*\//, "")
    .replace(/\/\* -+ route 2:[\s\S]*?(?=\/\* -+ report -+ \*\/\n\$\("printBtn"\))/, "");
  assertEquals(strip(after), strip(before));
  assertEquals(/PROXY_URL|Worker/.test(after), false);
});

Deno.test("08: invalid inputs are refused", () => {
  const v = KINDS["08.feedback"].validate;
  const ok = {
    industry: "Health insurance", company: "Team 2", route: 2, relies: 0, move: "A move", sentence: "A sentence",
    activities: [{ n: "Scheduling", a: 24, g: 7, h: 2 }], wall: [{ n: "Network", kind: 4, bound: 0, esc: 2 }],
  };
  v(ok);
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
  ]) assertThrows(() => v(bad), InputError, undefined, JSON.stringify(bad).slice(0, 80));
});
