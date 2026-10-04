// Artifact 06's game engine must be byte-identical to before live AI, and
// any game a table can play must pass the server's input validation.

import { assertEquals } from "jsr:@std/assert@1";
import { KINDS } from "../supabase/functions/ai/templates.ts";

const BEFORE = "83991ee";
const ROOT = new URL("..", import.meta.url).pathname;
const FILE = "06_policy_room.html"; // the policy room the course uses (v2.5)
const COPY = "artifacts/06_pandemic_policy_room.html"; // same page at a second address

const before = new TextDecoder().decode(
  new Deno.Command("git", { args: ["show", `${BEFORE}:${FILE}`], cwd: ROOT }).outputSync().stdout,
);
const after = Deno.readTextFileSync(ROOT + FILE);

// Source of `function name(` or `const name=` up to its matching closing brace.
function block(src: string, head: string): string {
  const i = src.indexOf(head);
  if (i < 0) throw new Error("not found: " + head);
  let depth = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) break;
  }
  return src.slice(i, j + 1);
}

const LINES = ["const QLABEL=", "const PANDEMIC=", "const SUPPLY=", "const NAT=", "const SENT_K=", "const ARCH_KEYS=", "const NATURAL_S=", "function qeBn(", "function qeLabel("];
const BLOCKS = [
  "const ARCH=", "const INIT=", "function newGame(", "function mixShares(", "function stepEconomy(", "function resolveQuarter(",
  "const ACTUAL=", "function actualRun(", "function scoreFromHist(", "function exportJSON(", "function forwardRun(",
  "function renderFwd(", "function fallbackBrief(", "function fallbackDebrief(", "function explainScores(", "function showDebrief(",
];
const line = (s: string, head: string) => {
  const i = s.indexOf(head);
  if (i < 0) throw new Error("not found: " + head);
  return s.slice(i, s.indexOf("\n", i));
};

Deno.test("06: engine, ACTUAL, scoring, export and fallbacks are byte-identical", () => {
  for (const head of LINES) assertEquals(line(after, head), line(before, head), head);
  for (const head of BLOCKS) assertEquals(block(after, head), block(before, head), head);
  // Engine, scoring and content sections, start to end, as one unbroken string.
  const engine = (s: string) => s.slice(s.indexOf("/* =================== ENGINE"), s.indexOf("/* =================== STATE & UI"));
  assertEquals(engine(after), engine(before));
});

Deno.test("06 is served from two addresses; both files must stay identical", () => {
  assertEquals(Deno.readTextFileSync(ROOT + COPY), after);
});

Deno.test("06: no direct Anthropic calls remain in 03 or 06", () => {
  for (const f of [FILE, COPY, "03_jobs_vs_tasks.html", "artifacts/03_jobs_vs_tasks_decomposer.html"]) {
    const s = Deno.readTextFileSync(ROOT + f);
    assertEquals(/api\.anthropic\.com|claude-sonnet-4-6|CALL_LIMIT/.test(s), false, f);
    assertEquals(/^const AI_URL = "(https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/ai)?";/m.test(s), true, f);
  }
});

Deno.test("06: random extreme games always pass the server's validators", () => {
  // Load the engine from the page and play it with random slider positions.
  const src = after.slice(after.indexOf("/* =================== ENGINE"), after.indexOf("/* =================== SCORING"));
  // deno-lint-ignore no-explicit-any
  const E: any = new Function(src + "; return {newGame, resolveQuarter, QLABEL};")();
  const pick = (lo: number, hi: number, step: number) => lo + step * Math.floor(Math.random() * ((hi - lo) / step + 1));
  const dec = (corner?: number) => ({
    r: corner === undefined ? pick(0, 3, 0.25) : corner ? 3 : 0,
    qe: corner === undefined ? pick(0, 12, 0.5) : corner ? 12 : 0,
    stim: corner === undefined ? pick(0, 12, 0.5) : corner ? 12 : 0,
    mix: { cheques: pick(0, 100, 1), retention: pick(0, 100, 1), liquidity: pick(0, 100, 1), health: pick(0, 100, 1), infra: pick(0, 100, 1) },
  });
  const econ = (e: { Y: number; U: number; pi: number }) => ({ Y: e.Y, U: e.U, pi: e.pi });
  const strip = (d: ReturnType<typeof dec>) => ({ r: d.r, qe: d.qe, stim: d.stim, mix: { ...d.mix } });
  for (let game = 0; game < 3000; game++) {
    const g = E.newGame();
    const corner = game < 4 ? [undefined, 0, 1, undefined][game] : undefined;
    for (let t = 0; t < 8; t++) {
      const us = dec(corner), eu = dec(corner === undefined ? undefined : 1 - corner);
      E.resolveQuarter(g, us, eu);
      const r = g.hist[t];
      KINDS["06.briefing"].validate({
        quarter: t, decisions: { US: strip(us), EU: strip(eu) },
        gauges: { US: econ(r.US), EU: econ(r.EU), SPX: r.SPX, FX: r.FX, stress: r.stress, spread: r.spread },
        rationale: {
          US: { cb: { tags: ["Fear overheating"], note: "" }, gov: { tags: [], note: "" } },
          EU: { cb: { tags: [], note: "" }, gov: { tags: ["Defend the spread", "Save fiscal space"], note: "hold" } },
        },
      });
    }
    // deno-lint-ignore no-explicit-any
    KINDS["06.debrief"].validate({ path: g.hist.map((h: any) => ({ US: econ(h.US), EU: econ(h.EU) })) });
  }
});

Deno.test("03 is served from two addresses; both files must stay identical", () => {
  assertEquals(
    Deno.readTextFileSync(ROOT + "artifacts/03_jobs_vs_tasks_decomposer.html"),
    Deno.readTextFileSync(ROOT + "03_jobs_vs_tasks.html"),
  );
});
