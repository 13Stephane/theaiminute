import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  InputError,
  parseTasks,
  promptDecompose,
  validateDecompose,
} from "../supabase/functions/ai/templates.ts";

const PAGE_03 = new URL("../artifacts/03_jobs_vs_tasks_decomposer.html", import.meta.url);

Deno.test("03: the page's copy-a-prompt wording equals the server template", async () => {
  const html = await Deno.readTextFile(PAGE_03);
  const src = html.slice(html.indexOf("function promptFor(job){"), html.indexOf("function toTasks("));
  const promptFor = new Function(src + "; return promptFor;")() as (job: string) => string;
  for (const job of ["Radiologist", "Financial controller", "Équity research analyst (sell-side)"]) {
    assertEquals(promptFor(job), promptDecompose(validateDecompose({ job })));
  }
});

Deno.test("both pages carry the AI_URL line and never call Anthropic directly", async () => {
  for (const f of ["03_jobs_vs_tasks_decomposer.html", "06_pandemic_policy_room.html"]) {
    const html = await Deno.readTextFile(new URL("../artifacts/" + f, import.meta.url));
    assert(/const AI_URL = "(|https:\/\/[^"\s]+)";/.test(html), f);
    assert(!html.includes("api.anthropic.com"), f);
    assert(!html.includes("CALL_LIMIT"), f);
  }
});

Deno.test("03: job titles are trimmed; quotes and braces are refused", () => {
  assertEquals(validateDecompose({ job: "  Head of   M&A  " }).job, "Head of M&A");
  assertEquals(validateDecompose({ job: "C# developer" }).job, "C# developer");
  assertEquals(validateDecompose({ job: "line\nbreak" }).job, "line break"); // whitespace folds to one space
  for (const job of ['a"b', "x{y}", "a`b", "<b>", "", "a", 42]) {
    assertThrows(() => validateDecompose({ job }), InputError);
  }
});

Deno.test("03: model output parsing mirrors the page and caps sizes", () => {
  const t = parseTasks(
    'Here you go:\n```json\n[{"task":"A","type":"automate","why":"w","time":0,"value":"12"},' +
      '{"task":"B","type":"robot","why":"w","time":5,"value":5},' +
      '{"task":"C","type":"human","time":500,"value":9},{"task":"D","type":"augment","why":"","time":7,"value":7}]\n```',
  );
  assertEquals(t.map((x) => x.task), ["A", "C", "D"]);
  assertEquals([t[0].time, t[0].value, t[1].time, t[1].why], [8, 12, 100, ""]);
  assertThrows(() => parseTasks("no json here"), InputError);
  assertThrows(() => parseTasks('[{"task":"only one","type":"human"}]'), InputError);
});
