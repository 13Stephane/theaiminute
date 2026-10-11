// 03, 06 and 08 in the programme palette: cream ground, teal ink, Georgia,
// dark teal only behind the title (and 08's numbered steps). The case tools
// (akzo, sab, lego) are checked in cases.test.ts.

import { assert } from "jsr:@std/assert@1";

const ROOT = new URL("..", import.meta.url).pathname;
const css = (f: string) => { const s = Deno.readTextFileSync(ROOT + f); return s.slice(s.indexOf("<style>"), s.indexOf("</style>")); };

Deno.test("03, 06 and 08 use the programme palette", () => {
  for (const f of ["03_jobs_vs_tasks.html", "artifacts/03_jobs_vs_tasks_decomposer.html", "06_policy_room.html", "artifacts/06_pandemic_policy_room.html", "artifacts/08_the_flood_value_chain.html"]) {
    const c = css(f);
    assert(/--paper:\s*#ECEBE3/.test(c) && /--ink:\s*#193C3F/.test(c) && /--gold:\s*#C6A553/.test(c), f + ": palette");
    assert(/body\{background:var\(--paper\);color:var\(--ink\);font-family:Georgia/.test(c.replace(/\s+/g, "")) || /body\{[^}]*background:var\(--paper\)[^}]*color:var\(--ink\)[^}]*Georgia/.test(c), f + ": body");
  }
  // the dark band is the title (and 08's step headers), nothing else
  assert(css("03_jobs_vs_tasks.html").includes(".band{background:var(--ink)"));
  assert(css("artifacts/08_the_flood_value_chain.html").includes(".qh{") && css("artifacts/08_the_flood_value_chain.html").includes(".verdict{background:var(--cream2)"));
  assert(css("06_policy_room.html").includes(".topbar{background:var(--teal)"));
});
