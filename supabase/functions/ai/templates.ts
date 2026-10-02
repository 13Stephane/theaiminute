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
// Same as qeLabel() in the page.
function qeLabel(q: number) {
  return q <= 0.5 ? "none" : q < 3 ? "light" : q < 6 ? "moderate" : q < 9 ? "heavy" : "massive";
}
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
  artifact: "03" | "06";
  bucket: string;
  limit: number;          // calls allowed per device per window
  windowSeconds: number;
  maxTokens: number;
  validate: (inputs: unknown) => unknown;
  prompt: (inputs: never) => string;
  parse: (text: string) => unknown;
};

const validate03 = obj({ job: jobTitle });
const validateBrief = obj({
  quarter: int(0, 7),
  decisions: obj({ US: decision, EU: decision }),
  gauges: obj({
    US: econ, EU: econ,
    SPX: num(0, 2000), FX: num(0, 5), stress: num(0, 500), spread: num(-10, 50),
  }),
});
const validateDebrief = obj({ path: arr(obj({ US: econ, EU: econ }), 8, 8) });

type In03 = ReturnType<typeof validate03>;
type InBrief = ReturnType<typeof validateBrief>;
type InDebrief = ReturnType<typeof validateDebrief>;

export function prompt03({ job }: In03): string {
  return `You are helping an executive MBA class apply Erik Brynjolfsson's jobs-vs-tasks framework. Decompose the role of "${job}" into 8 to 11 concrete constituent tasks. Classify each as exactly one of: "automate" (AI can do it end-to-end better or cheaper), "augment" (AI assists but a human stays in the loop), or "human" (best kept human: judgement, accountability, relationships, physical or tacit skill). Also estimate two weights per task: "time" = its share of the working week, and "value" = its share of the role's economic value; across all tasks time should sum to roughly 100 and value to roughly 100. Order tasks roughly automate first, human last. Return ONLY a JSON array, no prose and no markdown fences. Each element: {"task": string max 7 words, "type": "automate"|"augment"|"human", "why": string max 12 words, "time": integer, "value": integer}.`;
}

export function promptBriefing({ quarter: t, decisions, gauges: r }: InBrief): string {
  const dUS = decisions.US, dEU = decisions.EU;
  return `You are an economic advisor debriefing a policy game on the 2020-21 pandemic. Quarter just resolved: ${QLABEL[t]}.
Decisions — Fed: rate ${dUS.r}%, QE ${qeLabel(dUS.qe)}; US fiscal ${dUS.stim}% GDP, mostly ${topMix(dUS)}. ECB: rate ${dEU.r}%, QE ${qeLabel(dEU.qe)}; EU fiscal ${dEU.stim}% GDP, mostly ${topMix(dEU)}.
Resulting gauges — US: output gap ${r.US.Y}%, unemployment ${r.US.U}%, inflation ${r.US.pi}%. EU: output gap ${r.EU.Y}%, unemployment ${r.EU.U}%, inflation ${r.EU.pi}%. Equities ${r.SPX}, EUR/USD ${r.FX}, financial stress ${r.stress}, EU spread ${r.spread}pp.
In 3-4 sentences, plain and concrete: what these decisions did this quarter, the key US-vs-EU contrast, and what is building with a lag that they should watch. No preamble, no lists.`;
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
  "06.briefing": {
    artifact: "06", bucket: "06.briefing", limit: 10, windowSeconds: 3600, maxTokens: 1500,
    validate: validateBrief, prompt: promptBriefing as (i: never) => string, parse: text,
  },
  "06.debrief": {
    artifact: "06", bucket: "06.debrief", limit: 1, windowSeconds: 3600, maxTokens: 2000,
    validate: validateDebrief, prompt: promptDebrief as (i: never) => string, parse: text,
  },
};
