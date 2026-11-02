// ELPIS 2026 (DTU): the margin diagnostic, AI move 1 on Tuesday evening.
// A participant answers four questions about one real opportunity, plus the
// demand they can show; the sparring partner tests each claim. The page sends
// the answers, never prompt text; the server builds the prompt. The page builds
// the same text for its copy-a-prompt route; tests/elpis.test.ts checks both match.

import { arr, InputError, int, type KindSpec, obj, str, type V } from "./templates.ts";

const oneOf = <T extends string>(...xs: T[]): V<T> => (v, p = "inputs") => {
  if (!xs.includes(v as T)) throw new InputError(`${p} must be one of ${xs.map((x) => x || '""').join(", ")}`);
  return v as T;
};
// The page trims what it sends; trimming here too keeps the prompt identical either way.
const line = (max: number, min = 0): V<string> => (v, p) => str(max, { min })(v, p).trim();
const para = (max: number): V<string> => (v, p) => str(max, { multiline: true })(v, p).trim();
const months: V<number | null> = (v, p = "inputs") => v === null ? null : int(0, 999)(v, p);

// Caps match the page's maxlength attributes.
const validateStrict = obj({
  otype: oneOf("", "technology", "model", "whole", "context"),
  name: line(160, 1),
  pays: line(200),
  escape: oneOf("differentiation", "fence", "scarce", "none", "cost"),
  mechanism: para(600),
  months,
  route: oneOf("", "copy", "invent", "input", "trade", "other"),
  why: para(600),
  goodenough: para(300),
  scarce: para(300),
  approp: oneOf("", "tight", "weak"),
  complements: arr(obj({
    name: line(120),
    type: oneOf("", "generic", "cospecialised"),
    owner: line(120),
    plan: oneOf("", "build", "partner", "buy"),
  }), 2, 2),
  rung: oneOf("", "say", "time", "sign", "pay", "commit"),
  evidence: para(600),
});
// A page saved before the kind of opportunity was added sends no otype: read it as not given.
const validateMargin = (v: unknown, p = "inputs") =>
  validateStrict(v && typeof v === "object" && !Array.isArray(v) && !("otype" in v) ? { ...v, otype: "" } : v, p);
export type InMargin = ReturnType<typeof validateStrict>;

// SYSTEM_PROMPT, FORMAT and the labels in artifacts/elpis_margin_diagnostic.html, word for word.
export const MARGIN_SYSTEM = "You are the margin sparring partner for ELPIS, an executive programme at DTU on leading industrial science. A participant describes one real opportunity and answers questions about what its margin will rest on. Your job is to test the claims, not to praise or rewrite the idea.\n\n" +
  "Framework, in the programme's terms:\n" +
  "- A margin survives only where one of three conditions of competitive pricing is broken: fungibility (escape: differentiation), arbitrage (escape: a fence between buyers), free entry (escape: a scarce position). A cost advantage is not an escape: it earns a rent only while a costlier producer still sets the price.\n" +
  "- Teece: who profits depends on appropriability (tight or weak) and on who owns the complementary assets (generic or cospecialised). A partner who holds a cospecialised asset is a claimant on the margin.\n" +
  "- Christensen and Raynor: when a layer becomes good enough and modular, margins move to the adjacent layer that is still hard to copy. AI floods some layers; the complement collects.\n" +
  "- Demand: what people say is a hypothesis; what they pay or commit is evidence. Rungs: say they like it, give time, sign something, pay something, commit volume and price.\n" +
  "- Four kinds of opportunity, each with a usual weak point: a technology (the margin needs tight appropriability, and the complements are usually someone else's); a business model (who pays for which unit, and whether the partner who holds the complement claims the margin); a product made whole (the ring of the whole product the next buyers still lack, and who holds it); a change in the context (who must agree, who loses, and whether the participant can set the structure others work within). Use the participant's kind to choose your challenges; if the answers do not fit the kind, say so.\n\n" +
  'Assess five items, with these keys: "escape", "speed", "profit_moving", "complements", "demand". For each give:\n' +
  '- "verdict": "specific", "vague" or "missing". Specific means stated with a mechanism and units a sceptic could check.\n' +
  '- "challenge": the one question a competent rival or a sceptical board member would ask. One sentence.\n' +
  '- "test": the cheapest test that would confirm or refute the claim within 90 days. One or two sentences.\n' +
  '- "proof": what evidence would count as proof, and the type of source where it would be found (for example a patent search in Espacenet, standards-body records, regulator filings, annual reports, a signed letter of intent). Name types of source; do not invent specific documents, figures or citations.\n\n' +
  "Then give:\n" +
  '- "restatement": the margin claim restated in one sentence with units, in the form "Our margin rests on ..., because ...; a competent rival needs about ... months to ...". Where the participant gave no figure, write [unknown] rather than inventing one.\n' +
  '- "weakest": which item is the weakest link, and why, in at most two sentences.\n' +
  '- "next_step": one action for the next seven days, with the role that should own it.\n\n' +
  'Rules: be direct and concrete; no flattery and no exclamation marks; at most 45 words per field. Do not assert facts about real companies, markets or patents that the participant did not give; if you rely on general knowledge, say "from general knowledge" and keep to widely known facts. Answer in the language the participant wrote in.';

export const MARGIN_FORMAT = "\n\nReply with only one JSON object and no other text, in exactly this shape:\n" +
  '{"restatement": "...", "items": [{"key": "escape", "verdict": "specific|vague|missing", "challenge": "...", "test": "...", "proof": "..."}, ' +
  '{"key": "speed", ...}, {"key": "profit_moving", ...}, {"key": "complements", ...}, {"key": "demand", ...}], "weakest": "...", "next_step": "..."}';

const OTYPES: Record<string, string> = { technology: "A technology (worked out in the lab)", model: "A business model (the same technology, with the right complement)", whole: "A product made whole (designed from what the mainstream buyer needs)", context: "A change in the context (a standard, an infrastructure, a rule, a new kind of buyer)" };
const ESCAPES: Record<string, string> = { differentiation: "Differentiation", fence: "A fence", scarce: "A scarce position", none: "Nothing yet", cost: "A cost advantage" };
const ROUTES: Record<string, string> = { copy: "copy it", invent: "invent around it", input: "build or buy the key input", trade: "trade around the fence", other: "another route" };
const RUNGS: Record<string, string> = { say: "1 · they say they like it", time: "2 · they give time", sign: "3 · they sign something", pay: "4 · they pay something", commit: "5 · they commit volume and price" };

// participantText() and marginPrompt() in the page, unchanged.
export function participantText(i: InMargin): string {
  const lines: string[] = [];
  lines.push("Opportunity: " + (i.name || "[not given]"));
  lines.push("Kind of opportunity: " + (OTYPES[i.otype] || "[not given]"));
  lines.push("Who pays, for what: " + (i.pays || "[not given]"));
  lines.push("1. What the price rests on: " + (ESCAPES[i.escape] || "[not given]") + ". Mechanism: " + (i.mechanism || "[not given]"));
  lines.push("2. How long it holds: " + (i.months !== null ? i.months + " months" : "[not given]") + "; the rival's most likely route: " + (ROUTES[i.route] || "[not given]") + ". Why: " + (i.why || "[not given]"));
  lines.push("3. Where profit is moving. Layer becoming good enough: " + (i.goodenough || "[not given]") + ". Adjacent layer becoming scarce: " + (i.scarce || "[not given]"));
  const comps = i.complements.filter((c) => c.name).map((c) =>
    c.name + " (" + (c.type || "type not given") + "; owned by " + (c.owner || "[owner not given]") + "; plan: " + (c.plan || "[not given]") + ")"
  );
  lines.push("4. Complements. Appropriability: " + (i.approp || "[not given]") + ". " + (comps.length ? comps.join("; ") : "[no complement named]"));
  lines.push("5. Demand. Highest rung reached: " + (RUNGS[i.rung] || "[not given]") + ". Evidence: " + (i.evidence || "[not given]"));
  return lines.join("\n");
}
export function promptMargin(i: InMargin): string {
  return MARGIN_SYSTEM + "\n\nThe participant's answers:\n\n" + participantText(i) + MARGIN_FORMAT;
}

// ---------- the answer ----------
export const MARGIN_KEYS = ["escape", "speed", "profit_moving", "complements", "demand"] as const;
const VERDICTS = ["specific", "vague", "missing"];
const FIELD_MAX = 600; // the prompt asks for at most 45 words a field
export type MarginItem = { key: string; verdict: string; challenge: string; test: string; proof: string };
export type MarginFeedback = { restatement: string; items: MarginItem[]; weakest: string; next_step: string };

// One JSON object with all five items, each with a known verdict and three texts.
// Anything else throws, and the gate answers 502 "bad output" (the device keeps its allowance).
export function parseMargin(text: string): MarginFeedback {
  let t = text.trim().replace(/```json|```/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON object");
  t = t.slice(a, b + 1);
  let o: Record<string, unknown>;
  try { o = JSON.parse(t); } catch { throw new Error("not JSON"); }
  if (!o || typeof o !== "object" || Array.isArray(o) || !Array.isArray(o.items)) throw new Error("no items");
  const s = (x: unknown, what: string) => {
    if (typeof x !== "string" || !x.trim()) throw new Error(what + " missing");
    return x.trim().slice(0, FIELD_MAX);
  };
  const byKey = new Map<string, MarginItem>();
  for (const x of o.items as Record<string, unknown>[]) {
    if (!x || typeof x !== "object" || !MARGIN_KEYS.includes(x.key as never) || byKey.has(x.key as string)) continue;
    const verdict = typeof x.verdict === "string" ? x.verdict.trim().toLowerCase() : "";
    if (!VERDICTS.includes(verdict)) throw new Error("verdict");
    const key = x.key as string;
    byKey.set(key, { key, verdict, challenge: s(x.challenge, key + ".challenge"), test: s(x.test, key + ".test"), proof: s(x.proof, key + ".proof") });
  }
  if (byKey.size !== MARGIN_KEYS.length) throw new Error("items do not match");
  return {
    restatement: s(o.restatement, "restatement"),
    items: MARGIN_KEYS.map((k) => byKey.get(k)!),
    weakest: s(o.weakest, "weakest"),
    next_step: s(o.next_step, "next_step"),
  };
}

export const ELPIS_KINDS: Record<string, KindSpec> = {
  "elpis.margin": {
    artifact: "elpis", bucket: "elpis.margin", limit: 6, windowSeconds: 3600, maxTokens: 4000, effort: "low",
    validate: validateMargin, prompt: promptMargin as (i: never) => string, parse: (text: string) => parseMargin(text),
  },
};
