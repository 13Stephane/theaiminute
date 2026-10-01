// Prompt templates, moved verbatim from the pages. The pages send structured
// inputs only; every input is validated here before a prompt is built.

import type { Kind } from "../_shared/config.ts";

export class InputError extends Error {}

const fail = (msg: string): never => {
  throw new InputError(msg);
};

/* ------------------------------ validators ------------------------------ */

function obj(v: unknown, keys: string[], where: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(`${where}: expected an object`);
  const o = v as Record<string, unknown>;
  const got = Object.keys(o).sort().join(",");
  if (got !== [...keys].sort().join(",")) fail(`${where}: expected keys ${keys.join(", ")}`);
  return o;
}

function num(v: unknown, min: number, max: number, where: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    fail(`${where}: expected a number from ${min} to ${max}`);
  }
  return v as number;
}

function int(v: unknown, min: number, max: number, where: string): number {
  const n = num(v, min, max, where);
  if (!Number.isInteger(n)) fail(`${where}: expected an integer`);
  return n;
}

/* ------------------------- 03 · jobs vs tasks ------------------------- */

// Letters in any script, digits, spaces and light punctuation. No quotes,
// braces or newlines, so a job title cannot step outside its slot.
const JOB_RE = /^[\p{L}\p{M}\p{N} &'’().,:#\/+\-]{2,80}$/u;

export interface DecomposeInputs {
  job: string;
}

export function validateDecompose(v: unknown): DecomposeInputs {
  const o = obj(v, ["job"], "inputs");
  if (typeof o.job !== "string") fail("job: expected a string");
  const job = (o.job as string).trim().replace(/\s+/g, " ");
  if (!JOB_RE.test(job)) fail("job: 2 to 80 letters, digits, spaces or simple punctuation");
  return { job };
}

export function promptDecompose({ job }: DecomposeInputs): string {
  return `You are helping an executive MBA class apply Erik Brynjolfsson's jobs-vs-tasks framework. Decompose the role of "${job}" into 8 to 11 concrete constituent tasks. Classify each as exactly one of: "automate" (AI can do it end-to-end better or cheaper), "augment" (AI assists but a human stays in the loop), or "human" (best kept human: judgement, accountability, relationships, physical or tacit skill). Also estimate two weights per task: "time" = its share of the working week, and "value" = its share of the role's economic value; across all tasks time should sum to roughly 100 and value to roughly 100. Order tasks roughly automate first, human last. Return ONLY a JSON array, no prose and no markdown fences. Each element: {"task": string max 7 words, "type": "automate"|"augment"|"human", "why": string max 12 words, "time": integer, "value": integer}.`;
}

export interface Task {
  task: string;
  type: "automate" | "augment" | "human";
  why: string;
  time: number;
  value: number;
}

const TYPES = ["automate", "augment", "human"];

// The same filter the page applied, plus length and range limits.
export function parseTasks(text: string): Task[] {
  let t = text.trim().replace(/```json|```/g, "").trim();
  let arr: unknown;
  try {
    arr = JSON.parse(t);
  } catch {
    const a = t.indexOf("["), b = t.lastIndexOf("]");
    if (a < 0 || b <= a) fail("output: no JSON array");
    t = t.slice(a, b + 1);
    try {
      arr = JSON.parse(t);
    } catch {
      fail("output: JSON did not parse");
    }
  }
  if (!Array.isArray(arr)) fail("output: not an array");
  const weight = (x: unknown) => {
    const n = Math.round(Number(x));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 8;
  };
  const tasks = (arr as Record<string, unknown>[])
    .filter((x) => x && typeof x === "object" && typeof x.task === "string" && x.task.trim() && TYPES.includes(x.type as string))
    .slice(0, 14)
    .map((x) => ({
      task: String(x.task).trim().slice(0, 80),
      type: x.type as Task["type"],
      why: typeof x.why === "string" ? x.why.trim().slice(0, 160) : "",
      time: weight(x.time),
      value: weight(x.value),
    }));
  if (tasks.length < 3) fail("output: fewer than 3 usable tasks");
  return tasks;
}

/* ------------------------ 06 · pandemic policy room ------------------------ */

const QLABEL = ["2020 Q1", "2020 Q2", "2020 Q3", "2020 Q4", "2021 Q1", "2021 Q2", "2021 Q3", "2021 Q4"];
const ARCH_KEYS = ["cheques", "retention", "liquidity", "health", "infra"] as const;
const ARCH_LABEL: Record<string, string> = {
  cheques: "Household transfers",
  retention: "Job retention (furlough)",
  liquidity: "Business liquidity",
  health: "Health & vaccines",
  infra: "Investment / infrastructure",
};

function qeLabel(q: number): string {
  return q <= 0.5 ? "none" : q < 3 ? "light" : q < 6 ? "moderate" : q < 9 ? "heavy" : "massive";
}

interface Decision {
  r: number;
  qe: number;
  stim: number;
  mix: Record<string, number>;
}
interface Econ {
  Y: number;
  U: number;
  pi: number;
}

function decision(v: unknown, where: string): Decision {
  const o = obj(v, ["r", "qe", "stim", "mix"], where);
  const m = obj(o.mix, [...ARCH_KEYS], where + ".mix");
  const mix: Record<string, number> = {};
  ARCH_KEYS.forEach((k) => (mix[k] = int(m[k], 0, 100, `${where}.mix.${k}`)));
  return {
    r: num(o.r, 0, 3, where + ".r"),
    qe: num(o.qe, 0, 12, where + ".qe"),
    stim: num(o.stim, 0, 12, where + ".stim"),
    mix,
  };
}

function econ(v: unknown, where: string): Econ {
  const o = obj(v, ["Y", "U", "pi"], where);
  return { Y: num(o.Y, -30, 30, where + ".Y"), U: num(o.U, 0, 40, where + ".U"), pi: num(o.pi, -10, 40, where + ".pi") };
}

export interface BriefingInputs {
  t: number;
  US: Decision;
  EU: Decision;
  gauges: { US: Econ; EU: Econ; SPX: number; FX: number; stress: number; spread: number };
}

export function validateBriefing(v: unknown): BriefingInputs {
  const o = obj(v, ["t", "US", "EU", "gauges"], "inputs");
  const g = obj(o.gauges, ["US", "EU", "SPX", "FX", "stress", "spread"], "gauges");
  return {
    t: int(o.t, 0, 7, "t"),
    US: decision(o.US, "US"),
    EU: decision(o.EU, "EU"),
    gauges: {
      US: econ(g.US, "gauges.US"),
      EU: econ(g.EU, "gauges.EU"),
      SPX: num(g.SPX, 0, 1000, "gauges.SPX"),
      FX: num(g.FX, 0.5, 2, "gauges.FX"),
      stress: num(g.stress, 0, 500, "gauges.stress"),
      spread: num(g.spread, 0, 50, "gauges.spread"),
    },
  };
}

export function promptBriefing({ t, US: dUS, EU: dEU, gauges: r }: BriefingInputs): string {
  const topMix = (d: Decision) => {
    let best = "cheques", bv = -1;
    ARCH_KEYS.forEach((k) => {
      if (d.mix[k] > bv) {
        bv = d.mix[k];
        best = k;
      }
    });
    return ARCH_LABEL[best];
  };
  return `You are an economic advisor debriefing a policy game on the 2020-21 pandemic. Quarter just resolved: ${QLABEL[t]}.
Decisions — Fed: rate ${dUS.r}%, QE ${qeLabel(dUS.qe)}; US fiscal ${dUS.stim}% GDP, mostly ${topMix(dUS)}. ECB: rate ${dEU.r}%, QE ${qeLabel(dEU.qe)}; EU fiscal ${dEU.stim}% GDP, mostly ${topMix(dEU)}.
Resulting gauges — US: output gap ${r.US.Y}%, unemployment ${r.US.U}%, inflation ${r.US.pi}%. EU: output gap ${r.EU.Y}%, unemployment ${r.EU.U}%, inflation ${r.EU.pi}%. Equities ${r.SPX}, EUR/USD ${r.FX}, financial stress ${r.stress}, EU spread ${r.spread}pp.
In 3-4 sentences, plain and concrete: what these decisions did this quarter, the key US-vs-EU contrast, and what is building with a lag that they should watch. No preamble, no lists.`;
}

export interface DebriefInputs {
  hist: { US: Econ; EU: Econ }[];
}

export function validateDebrief(v: unknown): DebriefInputs {
  const o = obj(v, ["hist"], "inputs");
  if (!Array.isArray(o.hist) || o.hist.length !== 8) fail("hist: expected 8 quarters");
  const hist = (o.hist as unknown[]).map((h, i) => {
    const q = obj(h, ["US", "EU"], `hist[${i}]`);
    return { US: econ(q.US, `hist[${i}].US`), EU: econ(q.EU, `hist[${i}].EU`) };
  });
  return { hist };
}

export function promptDebrief({ hist }: DebriefInputs): string {
  const you = hist[7];
  const path = hist.map((h, i) =>
    `${QLABEL[i]}: US gap ${h.US.Y} U ${h.US.U} pi ${h.US.pi} | EU gap ${h.EU.Y} U ${h.EU.U} pi ${h.EU.pi}`
  ).join("\n");
  return `You are debriefing players of a 2020-21 pandemic policy game (roles: Fed, ECB, US & EU governments). Their quarter-by-quarter outcomes:
${path}
Real end-2021 outcomes: US unemployment ~3.9%, inflation ~7%; euro area unemployment ~7%, inflation ~5%.
Their end-2021: US U ${you.US.U}% pi ${you.US.pi}%; EU U ${you.EU.U}% pi ${you.EU.pi}%.
Write a short debrief (4-6 sentences, plain prose, no lists): how their path compares to the real one, the single biggest difference their decisions made, the clearest US-vs-EU lesson their game shows, and one thing to take home about fiscal-monetary timing and lags. Be specific and constructive.`;
}

/* ------------------------------ dispatch ------------------------------ */

export interface Built {
  inputs: unknown; // the validated, normalised inputs, as logged
  prompt: string;
  finish: (text: string) => unknown; // turns the model's text into the result
}

const asText = (text: string) => {
  const t = text.trim();
  if (!t) fail("output: empty");
  return t;
};

export function build(kind: Kind, raw: unknown): Built {
  switch (kind) {
    case "03.decompose": {
      const inputs = validateDecompose(raw);
      return { inputs, prompt: promptDecompose(inputs), finish: parseTasks };
    }
    case "06.briefing": {
      const inputs = validateBriefing(raw);
      return { inputs, prompt: promptBriefing(inputs), finish: asText };
    }
    case "06.debrief": {
      const inputs = validateDebrief(raw);
      return { inputs, prompt: promptDebrief(inputs), finish: asText };
    }
  }
}
