// The server prompts are the pages' prompts, verbatim. Each original
// template literal is pulled out of the page as it was before live AI
// (commit BEFORE), evaluated with the same inputs, and compared.

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { InputError, KINDS, parseTasks, prompt03, promptBriefing, promptDebrief } from "../supabase/functions/ai/templates.ts";

const BEFORE = "83991ee";
const ROOT = new URL("..", import.meta.url).pathname;

function gitShow(path: string): string {
  const out = new Deno.Command("git", { args: ["show", `${BEFORE}:${path}`], cwd: ROOT }).outputSync();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return new TextDecoder().decode(out.stdout);
}
// The backtick template that follows `marker` in `src`.
function templateAfter(src: string, marker: string): string {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error("marker not found: " + marker);
  const a = src.indexOf("`", i), b = src.indexOf("`", a + 1);
  return src.slice(a, b + 1);
}
// deno-lint-ignore no-explicit-any
const evalTemplate = (tpl: string, scope: Record<string, any>) =>
  new Function(...Object.keys(scope), "return " + tpl)(...Object.values(scope));

const p03 = gitShow("03_jobs_vs_tasks.html");
const p06 = gitShow("artifacts/06_pandemic_policy_room.html");

Deno.test("03.decompose prompt is the page's prompt verbatim", () => {
  const tpl = templateAfter(p03, "const prompt=");
  for (const job of ["Radiologist", "Financial controller", "Équipe RH / People partner"]) {
    assertEquals(prompt03({ job }), evalTemplate(tpl, { job }));
  }
});

const QLABEL = ["2020 Q1", "2020 Q2", "2020 Q3", "2020 Q4", "2021 Q1", "2021 Q2", "2021 Q3", "2021 Q4"];
const qeLabel = (q: number) => q <= 0.5 ? "none" : q < 3 ? "light" : q < 6 ? "moderate" : q < 9 ? "heavy" : "massive";
const ARCH: Record<string, { label: string }> = {
  cheques: { label: "Household transfers" }, retention: { label: "Job retention (furlough)" },
  liquidity: { label: "Business liquidity" }, health: { label: "Health & vaccines" },
  infra: { label: "Investment / infrastructure" },
};
const ARCH_KEYS = ["cheques", "retention", "liquidity", "health", "infra"];
// deno-lint-ignore no-explicit-any
const topMix = (d: any) => { let best = "cheques", bv = -1; ARCH_KEYS.forEach((k) => { if (d.mix[k] > bv) { bv = d.mix[k]; best = k; } }); return ARCH[best].label; };

Deno.test("06 helper copies match the page", () => {
  for (const name of ["qeLabel", "QLABEL"]) {
    const line = p06.split("\n").find((l) => l.includes(name === "qeLabel" ? "function qeLabel" : "const QLABEL="))!;
    const page = new Function(line + `; return ${name};`)();
    const mine = name === "qeLabel" ? qeLabel : QLABEL;
    if (name === "qeLabel") for (const q of [0, 0.5, 1, 3, 5.5, 6, 9, 12]) assertEquals(page(q), qeLabel(q));
    else assertEquals(page, mine);
  }
  assertEquals(p06.includes(`const topMix=d=>{let best="cheques",bv=-1;ARCH_KEYS.forEach(k=>{if(d.mix[k]>bv){bv=d.mix[k];best=k;}});return ARCH[best].label;};`), true);
});

Deno.test("06.briefing prompt is the page's prompt verbatim", () => {
  const tpl = templateAfter(p06.slice(p06.indexOf("async function briefing")), "const prompt=");
  const cases = [
    { quarter: 0, US: [1.5, 0, 0, [30, 30, 20, 20, 0]], EU: [0, 0, 0, [15, 45, 20, 20, 0]] },
    { quarter: 5, US: [0.25, 12, 11.5, [20, 20, 20, 20, 20]], EU: [0.75, 2.5, 3, [0, 0, 10, 90, 0]] },
  ];
  for (const c of cases) {
    const dec = (x: (number | number[])[]) => {
      const m = x[3] as number[];
      return { r: x[0] as number, qe: x[1] as number, stim: x[2] as number,
        mix: { cheques: m[0], retention: m[1], liquidity: m[2], health: m[3], infra: m[4] } };
    };
    const dUS = dec(c.US), dEU = dec(c.EU);
    const r = { US: { Y: -9.12, U: 13.2, pi: 0.61 }, EU: { Y: -12.4, U: 7.83, pi: 0.3 }, SPX: 92, FX: 1.124, stress: 41, spread: 2.1 };
    const want = evalTemplate(tpl, { QLABEL, t: c.quarter, dUS, dEU, r, qeLabel, topMix });
    assertEquals(promptBriefing({ quarter: c.quarter, decisions: { US: dUS, EU: dEU }, gauges: r }), want);
  }
});

Deno.test("06.debrief prompt is the page's prompt verbatim", () => {
  const fn = p06.slice(p06.indexOf("async function debriefAI"));
  const pathExpr = fn.slice(fn.indexOf("const path=") + "const path=".length, fn.indexOf(".join(\"\\n\");") + ".join(\"\\n\")".length);
  const tpl = templateAfter(fn, "const prompt=");
  const rows = QLABEL.map((q, i) => ({ q, US: { Y: -i, U: 4 + i / 3, pi: 1.5 + i }, EU: { Y: -i / 2, U: 7.5, pi: 0.4 * i } }));
  const G = { hist: rows };
  const path = new Function("G", "return " + pathExpr)(G);
  const want = evalTemplate(tpl, { path, you: rows[7] });
  assertEquals(promptDebrief({ path: rows.map(({ US, EU }) => ({ US, EU })) }), want);
});

Deno.test("03's copy-a-prompt wording matches the server template", () => {
  const page = Deno.readTextFileSync(ROOT + "03_jobs_vs_tasks.html");
  const fnSrc = page.slice(page.indexOf("function decomposePrompt("));
  const body = fnSrc.slice(0, fnSrc.indexOf("\n}") + 2);
  const decomposePrompt = new Function(body + "; return decomposePrompt;")();
  for (const job of ["Radiologist", "Head of procurement"]) assertEquals(decomposePrompt(job), prompt03({ job }));
});

Deno.test("parseTasks accepts fenced or chatty JSON, rejects junk", () => {
  const arr = '[{"task":"A","type":"automate","why":"w","time":10,"value":5},{"task":"B","type":"augment","why":"w","time":"20","value":0},{"task":"C","type":"human","time":70,"value":95},{"task":"D","type":"robot"}]';
  const t = parseTasks("```json\n" + arr + "\n```");
  assertEquals(t.map((x) => x.task), ["A", "B", "C"]);
  assertEquals([t[1].time, t[1].value, t[2].why], [20, 8, ""]);
  assertEquals(parseTasks("Here you go:\n" + arr).length, 3);
  for (const bad of ["no json", "{}", "[]", '[{"task":"A","type":"automate"}]']) assertThrows(() => parseTasks(bad));
});

Deno.test("validators reject extra keys, wrong types and out-of-range numbers", () => {
  const v = KINDS["03.decompose"].validate;
  assertEquals(v({ job: "  Air   traffic controller " }), { job: "Air traffic controller" });
  for (const bad of [null, [], { job: 3 }, { job: "ok", x: 1 }, {}, { job: "<script>" }]) {
    assertThrows(() => v(bad), InputError);
  }
});
