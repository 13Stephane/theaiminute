// Prompt templates and input/output validation for the `ai` function.
//
// Pages send a `kind` and structured `inputs`, never prompt text. Each kind
// below owns its validator, its prompt (moved verbatim from the page), its
// max_tokens and its rate limit. The client cannot choose any of these.

export const MODEL = "claude-sonnet-5-5";

// USD per million tokens, Claude Sonnet 5.5, from
// https://platform.claude.com/docs/en/about-claude/pricing (checked 2 Oct 2026).
// Thinking tokens are billed as output tokens and are included in usage.output_tokens.
export const PRICE_PER_MTOK = { input: 2, output: 10 };

// Low effort: the effort doc recommends it for "short, scoped tasks and
// latency-sensitive workloads". Thinking stays on (adaptive is the default
// on Sonnet 5.5), and max_tokens caps thinking plus answer together, so the
// limits below leave room above the old 1000.
// https://platform.claude.com/docs/en/build-with-claude/effort
export const EFFORT = "low";

export function costUsd(inputTokens: number, outputTokens: number): number {
  const c = (inputTokens * PRICE_PER_MTOK.input + outputTokens * PRICE_PER_MTOK.output) / 1e6;
  return Math.round(c * 1e6) / 1e6;
}

export class InputError extends Error {}

// ---------- tiny strict validators ----------
type V<T> = (v: unknown, path?: string) => T;

const num = (min: number, max: number): V<number> => (v, p = "inputs") => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    throw new InputError(`${p} must be a number in ${min}..${max}`);
  }
  return v;
};
const int = (min: number, max: number): V<number> => (v, p = "inputs") => {
  const n = num(min, max)(v, p);
  if (!Number.isInteger(n)) throw new InputError(`${p} must be an integer`);
  return n;
};
function obj<S extends Record<string, V<unknown>>>(shape: S): V<{ [K in keyof S]: ReturnType<S[K]> }> {
  return (v, p = "inputs") => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new InputError(`${p} must be an object`);
    const rec = v as Record<string, unknown>;
    for (const k of Object.keys(rec)) if (!(k in shape)) throw new InputError(`${p}.${k} is not allowed`);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(shape)) {
      if (!(k in rec)) throw new InputError(`${p}.${k} is required`);
      out[k] = shape[k](rec[k], `${p}.${k}`);
    }
    return out as { [K in keyof S]: ReturnType<S[K]> };
  };
}
const arr = <T>(item: V<T>, min: number, max: number): V<T[]> => (v, p = "inputs") => {
  if (!Array.isArray(v) || v.length < min || v.length > max) {
    throw new InputError(`${p} must be an array of ${min}..${max} items`);
  }
  return v.map((x, i) => item(x, `${p}[${i}]`));
};

// A role title: letters (any script), digits, spaces and light punctuation.
// No quotes, braces or newlines, so it cannot break out of the prompt's quotes.
const JOB_RE = /^[\p{L}\p{M}\p{N} &'’.,\/()+-]{2,80}$/u;
const jobTitle: V<string> = (v, p = "inputs") => {
  if (typeof v !== "string") throw new InputError(`${p} must be a string`);
  const s = v.trim().replace(/\s+/g, " ");
  if (!JOB_RE.test(s)) throw new InputError(`${p} must be 2-80 letters, digits, spaces or & ' . , / ( ) + -`);
  return s;
};

// One task from a participant's own list: their wording, so a little more
// punctuation than a role title, still no quotes, braces or newlines.
const TASK_RE = /^[\p{L}\p{M}\p{N} &'’.,\/()+\-:;%?!#]{2,90}$/u;
const taskText: V<string> = (v, p = "inputs") => {
  if (typeof v !== "string") throw new InputError(`${p} must be a string`);
  const s = v.trim().replace(/\s+/g, " ");
  if (!TASK_RE.test(s)) throw new InputError(`${p} must be 2-90 letters, digits, spaces or simple punctuation`);
  return s;
};
const TASK_TYPE: V<string> = (v, p = "inputs") => {
  if (v !== "automate" && v !== "augment" && v !== "human") throw new InputError(`${p} must be automate, augment or human`);
  return v;
};

// ---------- 08 · the flood, the wall, and the way out ----------
// Free text from the page: a length cap and no control characters; newlines only
// where the page's own field is a textarea.
const str = (max: number, opts: { multiline?: boolean; min?: number } = {}): V<string> => (v, p = "inputs") => {
  if (typeof v !== "string" || v.length > max || v.trim().length < (opts.min ?? 0)) {
    throw new InputError(`${p} must be text of at most ${max} characters`);
  }
  const bad = opts.multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/ : /\p{Cc}/u;
  if (bad.test(v)) throw new InputError(`${p} contains control characters`);
  return v;
};
const validateFlood = (v: unknown, p = "inputs") => {
  const o = obj({
    industry: str(80), company: str(80),
    activities: arr(obj({ n: str(120, { min: 1 }), a: int(0, 60), g: int(0, 60), h: int(0, 60) }), 1, 7),
    wall: arr(obj({ n: str(120, { min: 1 }), kind: int(0, 7), bound: int(0, 1), esc: int(0, 3) }), 0, 4),
    route: int(-1, 2), relies: int(-1, 3),
    move: str(400, { multiline: true }), sentence: str(400, { multiline: true }),
  })(v, p);
  if (o.relies >= o.wall.length) throw new InputError(`${p}.relies must point at a card on the wall`);
  return o;
};
type InFlood = ReturnType<typeof validateFlood>;

// The page's lists and arithmetic, as in 08_the_flood_value_chain.html.
const HZ8 = ["resists", "3 to 7 years", "under 3 years", "already flooding"];
const KINDS8 = ["Patent or protected IP", "Process know-how or trade secret", "Proprietary data", "Brand and reputation",
  "Relationships and network", "Regulatory licence or status", "Physical assets and scale", "People and scarce skills"];
const ESCS8 = ["break fungibility", "block arbitrage", "block free entry", "none"];
type Act = { n: string; a: number; g: number; h: number };
const tot8 = (r: Act) => r.a + r.g + r.h;
const reach8 = (r: Act) => tot8(r) ? (r.a + 0.5 * r.g) / tot8(r) : null;
const hzOf8 = (x: number | null) => x === null ? -1 : (x >= 0.8 ? 3 : x >= 0.6 ? 2 : x >= 0.4 ? 1 : 0);
const isKept8 = (r: Act) => tot8(r) > 0 && r.h / tot8(r) > 0.5;
const f2 = (x: number | null) => x === null ? "\u2014" : x.toFixed(2);

// buildPrompt() from the page, word for word; a test checks the two produce the same text.
export function promptFlood(i: InFlood): string {
  const flood = i.activities.map((r, k) => {
    const x = reach8(r);
    return `${k + 1}. ${r.n} | votes automate ${r.a}, augment ${r.g}, keep human ${r.h} | reach ${f2(x)} | their call: ${x === null ? "not voted" : HZ8[hzOf8(x)]}${isKept8(r) ? " | KEPT HUMAN by majority" : ""}`;
  }).join("\n") || "(none listed)";
  const wall = i.wall.map((c, k) => `${k + 1}. ${c.n} | ${KINDS8[c.kind]} | they say: ${c.bound === 0 ? "bound to them" : "generic"} | escape it enables: ${ESCS8[c.esc]}`).join("\n") || "(none listed)";
  return `You are a sparring partner for a team of executives on a Managerial Economics course. They have just worked through an exercise on how AI will reshape the economics of their industry, and they want honest, specific feedback on all of it. Be direct. Disagree where the evidence points the other way. Do not flatter them, and do not soften a criticism to be polite.

THE FRAMEWORK THEY USED
- The flood. AI capability rises like water. An activity the machine can do stops being scarce, so its price falls toward the cost of running the machine. For each activity, each team member voted automate, augment or keep human. Reach = automate share + half the augment share. Their call follows from reach: 0.80 and above = already flooding, 0.60 = under 3 years, 0.40 = 3 to 7 years, below = resists. An activity a strict majority voted to keep human is marked KEPT HUMAN.
- The wall (David Teece, Profiting from Innovation). When an idea can be copied, value goes to whoever owns the complementary assets it must pass through, above all cospecialised ones. "Bound" means a rival could not rent or copy it within three years.
- The way out. Price stays above cost only if something breaks one of three conditions: buyers treat products as interchangeable (fungibility), buyers can move freely between prices (arbitrage), rivals can enter freely (free entry). So there are three escapes: break fungibility, block arbitrage, block free entry. Where ideas can be copied, blocking entry is usually the one that lasts.

THEIR WORK
Industry: ${i.industry || "(not stated)"}
Company: ${i.company || "(not stated)"}

The flood:
${flood}

The wall:
${wall}

The way out:
Main escape: ${i.route < 0 ? "not decided" : ESCS8[i.route]}
It depends on: ${i.relies >= 0 ? i.wall[i.relies].n : "no card chosen"}
The move: ${i.move || "(not stated)"}
Their sentence: ${i.sentence}

WHAT TO GIVE THEM
Write plain prose under these five headings, 300 to 450 words in total: they have six minutes to read it. Name specific activities and cards; generalities are no use to them.
1. The flood. Which of their calls would you challenge, and why? What belongs on their list that is missing?
2. What they kept human. Are the activities they kept human protected by real constraints (regulation, liability, trust, physical presence) or by preference? Would a competitor keep the same line?
3. The wall. For each card they marked bound: is it really? Which could a well-funded rival rent, copy or build within three years? Which asset is missing?
4. The way out. Does their route follow from their wall? Is the move concrete enough to start on Monday? What is most likely to make it fail?
5. The one thing. The single most important change to their thinking.

Then, after the prose, add this block exactly, inside \`\`\`json fences, so their page can read it. Give your OWN view of each activity, not theirs:
{"activities":[{"i":1,"horizon":"under 3 years","why":"at most 18 words"}],"wall":[{"i":1,"bound":true,"note":"at most 18 words"}],"summary":"at most 40 words: where the margin sits in three years"}
Use exactly one of these for horizon: "already flooding", "under 3 years", "3 to 7 years", "resists". Number activities and cards as listed above.`;
}

// ---------- 06 shared shapes (ranges match the page's sliders, gauges generous) ----------
const MIX_KEYS = ["cheques", "retention", "liquidity", "health", "infra"] as const;
const mix = obj({
  cheques: num(0, 100), retention: num(0, 100), liquidity: num(0, 100), health: num(0, 100), infra: num(0, 100),
});
const decision = obj({ r: num(0, 3), qe: num(0, 12), stim: num(0, 12), mix });
const econ = obj({ Y: num(-50, 50), U: num(0, 50), pi: num(-20, 50) });

const QLABEL = ["2020 Q1", "2020 Q2", "2020 Q3", "2020 Q4", "2021 Q1", "2021 Q2", "2021 Q3", "2021 Q4"];
const ARCH_LABEL: Record<string, string> = {
  cheques: "Household transfers", retention: "Job retention (furlough)", liquidity: "Business liquidity",
  health: "Health & vaccines", infra: "Investment / infrastructure",
};
// Same as qeBn() and qeLabel() in 06_policy_room.html.
function qeLabel(q: number) {
  const b = Math.round(q * 50);
  const w = q <= 0.5 ? "none" : q < 3 ? "light" : q < 6 ? "moderate" : q < 9 ? "heavy" : "massive";
  return q <= 0.5 ? "none (\u20AC0bn/q)" : `\u20AC${b}bn/q \u00B7 ${w}`;
}

// The "Why this decision?" tags each role can pick, as in RATIONALE in the page,
// plus an optional one-line note the players type.
const RATIONALE_TAGS = {
  US: ["Fight the downturn", "Fear overheating", "Protect financial system", "Save fiscal space", "Match the ECB/Fed"],
  EU: ["Fight the downturn", "Fear overheating", "Defend the spread", "Save fiscal space", "Match the ECB/Fed"],
};
const NOTE_MAX = 200;
const note: V<string> = (v, p = "inputs") => {
  if (typeof v !== "string" || v.length > NOTE_MAX || /\p{Cc}/u.test(v)) {
    throw new InputError(`${p} must be one line of at most ${NOTE_MAX} characters`);
  }
  return v;
};
const tags = (allowed: string[]): V<string[]> => (v, p = "inputs") => {
  const a = arr<string>((x, q) => {
    if (typeof x !== "string" || !allowed.includes(x)) throw new InputError(`${q} is not a known rationale tag`);
    return x;
  }, 0, allowed.length)(v, p);
  if (new Set(a).size !== a.length) throw new InputError(`${p} repeats a tag`);
  return a;
};
const rationale = (region: "US" | "EU") =>
  obj({ cb: obj({ tags: tags(RATIONALE_TAGS[region]), note }), gov: obj({ tags: tags(RATIONALE_TAGS[region]), note }) });
type Why = { tags: string[]; note: string };
// Same expression as the page: tags joined, or "none", then the note in brackets if any.
const why = (w: Why) => `${w.tags.join(", ") || "none"}${w.note ? " (" + w.note + ")" : ""}`;
// Same as topMix() in the page: first key with the largest weight wins.
function topMix(d: { mix: Record<string, number> }) {
  let best = "cheques", bv = -1;
  MIX_KEYS.forEach((k) => { if (d.mix[k] > bv) { bv = d.mix[k]; best = k; } });
  return ARCH_LABEL[best];
}

// ---------- 03 output ----------
const TYPES = ["automate", "augment", "human"];
export type Task = { task: string; type: string; why: string; time: number; value: number };

export function parseTasks(text: string): Task[] {
  let t = text.trim().replace(/```json|```/g, "").trim();
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  let arr: unknown;
  try { arr = JSON.parse(t); } catch { throw new Error("not JSON"); }
  if (!Array.isArray(arr)) throw new Error("not an array");
  const clampW = (x: unknown) => {
    const n = Math.round(Number(x));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 8;
  };
  const tasks = arr
    .filter((x): x is Record<string, unknown> =>
      !!x && typeof x === "object" && typeof (x as Record<string, unknown>).task === "string" &&
      TYPES.includes((x as Record<string, unknown>).type as string))
    .slice(0, 15)
    .map((x) => ({
      task: String(x.task).slice(0, 80),
      type: String(x.type),
      why: typeof x.why === "string" ? x.why.slice(0, 160) : "",
      time: clampW(x.time),
      value: clampW(x.value),
    }));
  if (tasks.length < 3) throw new Error("too few tasks");
  return tasks;
}

// ---------- the kinds ----------
export type KindSpec = {
  artifact: "03" | "06" | "08";
  bucket: string;
  limit: number;          // calls allowed per device per window
  windowSeconds: number;
  maxTokens: number;
  validate: (inputs: unknown) => unknown;
  prompt: (inputs: never) => string;
  parse: (text: string, inputs?: unknown) => unknown;
  field?: "result" | "text"; // the response key for the result; 08 answers {text, usage, cost_usd}
};

const validate03 = obj({ job: jobTitle });
const validateReview = obj({
  job: jobTitle,
  tasks: arr(obj({ task: taskText, type: TASK_TYPE, time: int(0, 100), value: int(0, 100) }), 3, 15),
});
const validateBrief = obj({
  quarter: int(0, 7),
  decisions: obj({ US: decision, EU: decision }),
  gauges: obj({
    US: econ, EU: econ,
    SPX: num(0, 2000), FX: num(0, 5), stress: num(0, 500), spread: num(-10, 50),
  }),
  rationale: obj({ US: rationale("US"), EU: rationale("EU") }),
});
const validateDebrief = obj({ path: arr(obj({ US: econ, EU: econ }), 8, 8) });

type In03 = ReturnType<typeof validate03>;
type InReview = ReturnType<typeof validateReview>;
type InBrief = ReturnType<typeof validateBrief>;
type InDebrief = ReturnType<typeof validateDebrief>;

export function prompt03({ job }: In03): string {
  return `You are helping an executive MBA class apply Erik Brynjolfsson's jobs-vs-tasks framework. Decompose the role of "${job}" into 8 to 11 concrete constituent tasks. Classify each as exactly one of: "automate" (AI can do it end-to-end better or cheaper), "augment" (AI assists but a human stays in the loop), or "human" (best kept human: judgement, accountability, relationships, physical or tacit skill). Also estimate two weights per task: "time" = its share of the working week, and "value" = its share of the role's economic value; across all tasks time should sum to roughly 100 and value to roughly 100. Order tasks roughly automate first, human last. Return ONLY a JSON array, no prose and no markdown fences. Each element: {"task": string max 7 words, "type": "automate"|"augment"|"human", "why": string max 12 words, "time": integer, "value": integer}.`;
}

// A second opinion on a participant's own decomposition: they sort and weight
// first, then Claude gives its own sort and weights and names the
// disagreements worth arguing about. The page's copy-a-prompt uses the same words.
export function promptReview({ job, tasks }: InReview): string {
  const share = (k: "time" | "value") => {
    const tot = tasks.reduce((a, t) => a + t[k], 0) || 1;
    return tasks.map((t) => Math.round((t[k] / tot) * 100));
  };
  const time = share("time"), value = share("value");
  const list = tasks.map((t, i) => `${i + 1}. ${t.task}: their call ${t.type}, ${time[i]}% of the week, ${value[i]}% of the value`).join("\n");
  return `You are helping an executive MBA class apply Erik Brynjolfsson's jobs-vs-tasks framework. A participant has decomposed their own role, "${job}", into the tasks below. They classified each as "automate" (AI can do it end-to-end better or cheaper), "augment" (AI assists but a human stays in the loop) or "human" (best kept human: judgement, accountability, relationships, physical or tacit skill), and weighted each by its share of the working week and of the role's economic value.

${list}

Give a second opinion. For every task, in the same order and keeping their wording, give your own classification and your own two weights: "time" = its share of the working week, "value" = its share of the role's economic value, each set summing to roughly 100. Then name the two or three disagreements most worth arguing about: where your classification differs from theirs, or where your weights differ most, and why it matters for how much of this role is really exposed to AI. Be specific to this role and do not soften a disagreement. Return ONLY a JSON object, no prose and no markdown fences: {"tasks": [{"i": task number, "type": "automate"|"augment"|"human", "time": integer, "value": integer, "why": string max 12 words}], "disagreements": [{"i": task number, "point": string max 30 words}], "summary": string max 30 words}.`;
}

export type Review = {
  tasks: { type: string; time: number; value: number; why: string }[];
  disagreements: { i: number; point: string }[];
  summary: string;
};

// Claude's answer to a review, checked against the number of tasks sent.
export function parseReview(text: string, n: number): Review {
  let t = text.trim().replace(/```json|```/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  let o: Record<string, unknown>;
  try { o = JSON.parse(t); } catch { throw new Error("not JSON"); }
  if (!o || typeof o !== "object" || !Array.isArray(o.tasks)) throw new Error("no tasks");
  const byI = new Map<number, Record<string, unknown>>();
  for (const x of o.tasks as Record<string, unknown>[]) {
    const i = Number(x?.i);
    if (Number.isInteger(i) && i >= 1 && i <= n && !byI.has(i) && TYPES.includes(x.type as string)) byI.set(i, x);
  }
  if (byI.size !== n) throw new Error("tasks do not match");
  const w = (x: unknown) => { const v = Math.round(Number(x)); return Number.isFinite(v) && v >= 0 ? Math.min(v, 100) : 0; };
  const tasks = Array.from({ length: n }, (_, k) => {
    const x = byI.get(k + 1)!;
    return { type: String(x.type), time: w(x.time), value: w(x.value), why: typeof x.why === "string" ? x.why.slice(0, 160) : "" };
  });
  const disagreements = (Array.isArray(o.disagreements) ? o.disagreements as Record<string, unknown>[] : [])
    .filter((d) => Number.isInteger(Number(d?.i)) && Number(d.i) >= 1 && Number(d.i) <= n && typeof d.point === "string")
    .slice(0, 4).map((d) => ({ i: Number(d.i), point: String(d.point).slice(0, 300) }));
  return { tasks, disagreements, summary: typeof o.summary === "string" ? o.summary.slice(0, 300) : "" };
}

export function promptBriefing({ quarter: t, decisions, gauges: r, rationale: why6 }: InBrief): string {
  const dUS = decisions.US, dEU = decisions.EU;
  return `You are an economic advisor debriefing a policy game on the 2020-21 pandemic. Quarter just resolved: ${QLABEL[t]}.
Decisions — Fed: rate ${dUS.r}%, QE ${qeLabel(dUS.qe)}; US fiscal ${dUS.stim}% GDP, mostly ${topMix(dUS)}. ECB: rate ${dEU.r}%, QE ${qeLabel(dEU.qe)}; EU fiscal ${dEU.stim}% GDP, mostly ${topMix(dEU)}.
Resulting gauges — US: output gap ${r.US.Y}%, unemployment ${r.US.U}%, inflation ${r.US.pi}%. EU: output gap ${r.EU.Y}%, unemployment ${r.EU.U}%, inflation ${r.EU.pi}%. Equities ${r.SPX}, EUR/USD ${r.FX}, financial stress ${r.stress}, EU spread ${r.spread}pp.
In 4-5 sentences, plain and concrete: what these decisions did this quarter, naming the mechanism loops at work (demand support; the 3-6 quarter inflation pipe; the labour channel, furlough vs transfers; euro-area fragmentation and the spread; shock attenuation via health spending). Comment briefly on the contribution of each role - central banks and governments, US and EU - so every player learns from what the others did. End with the one thing building with a lag they should watch. Where a role gave a rationale (below), say whether the result vindicates or challenges that reasoning \u2014 a good outcome with flawed reasoning still deserves a flag. No preamble, no lists.
Stated rationales this quarter: Fed \u2014 ${why(why6.US.cb)}; ECB \u2014 ${why(why6.EU.cb)}; US Gov \u2014 ${why(why6.US.gov)}; EU Govs \u2014 ${why(why6.EU.gov)}.`;
}

export function promptDebrief({ path: hist }: InDebrief): string {
  const you = hist[7];
  const path = hist.map((h, i) =>
    `${QLABEL[i]}: US gap ${h.US.Y} U ${h.US.U} pi ${h.US.pi} | EU gap ${h.EU.Y} U ${h.EU.U} pi ${h.EU.pi}`).join("\n");
  return `You are debriefing players of a 2020-21 pandemic policy game (roles: Fed, ECB, US & EU governments). Their quarter-by-quarter outcomes:
${path}
Real end-2021 outcomes: US unemployment ~3.9%, inflation ~7%; euro area unemployment ~7%, inflation ~5%.
Their end-2021: US U ${you.US.U}% pi ${you.US.pi}%; EU U ${you.EU.U}% pi ${you.EU.pi}%.
Write a short debrief (4-6 sentences, plain prose, no lists): how their path compares to the real one, the single biggest difference their decisions made, the clearest US-vs-EU lesson their game shows, and one thing to take home about fiscal-monetary timing and lags. Be specific and constructive.`;
}

const text = (s: string) => {
  const t = s.trim();
  if (!t) throw new Error("empty");
  return t;
};

export const KINDS: Record<string, KindSpec> = {
  "03.decompose": {
    artifact: "03", bucket: "03", limit: 4, windowSeconds: 600, maxTokens: 3000,
    validate: validate03, prompt: prompt03 as (i: never) => string, parse: parseTasks,
  },
  "03.review": {
    artifact: "03", bucket: "03.review", limit: 3, windowSeconds: 600, maxTokens: 4000,
    validate: validateReview, prompt: promptReview as (i: never) => string,
    parse: (text: string, inputs?: unknown) => parseReview(text, (inputs as InReview).tasks.length),
  },
  "08.feedback": {
    artifact: "08", bucket: "08", limit: 4, windowSeconds: 3600, maxTokens: 4000,
    validate: validateFlood, prompt: promptFlood as (i: never) => string, parse: text, field: "text",
  },
  "06.briefing": {
    artifact: "06", bucket: "06.briefing", limit: 10, windowSeconds: 3600, maxTokens: 2000,
    validate: validateBrief, prompt: promptBriefing as (i: never) => string, parse: text,
  },
  "06.debrief": {
    artifact: "06", bucket: "06.debrief", limit: 1, windowSeconds: 3600, maxTokens: 2000,
    validate: validateDebrief, prompt: promptDebrief as (i: never) => string, parse: text,
  },
};
