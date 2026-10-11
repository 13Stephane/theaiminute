// The three case tools of the AI & Finance executive programme: AkzoNobel,
// AB InBev / SABMiller and LEGO India. Each page sends its slider values, the
// table's committed numbers and a question; the server recomputes the page's
// model from the sliders and builds the prompt. The pages build the same
// prompt for their copy-a-prompt route; tests/cases.test.ts checks both match.
//
// Claude Sonnet 5.5 at medium effort, as asked for these tools.

import { arr, InputError, int, type KindSpec, num, obj, str, type V } from "./templates.ts";

const bool: V<boolean> = (v, p = "inputs") => {
  if (typeof v !== "boolean") throw new InputError(`${p} must be true or false`);
  return v;
};
const oneOf = <T extends string>(...xs: T[]): V<T> => (v, p = "inputs") => {
  if (!xs.includes(v as T)) throw new InputError(`${p} must be one of ${xs.join(", ")}`);
  return v as T;
};
const question = str(600, { multiline: true });
const text = (s: string) => {
  const t = s.trim();
  if (!t) throw new Error("empty");
  return t;
};
// A question that is not about the case gets one sentence, not an essay.
const ON_TOPIC = " Answer it only if it is about this case and the numbers above; otherwise say so in one sentence.";

// ---------------------------------------------------------------- AB InBev / SABMiller
const SH = 1640, SAB_ND = 11.579, SAB_NCI = 1.183, BOOK = 36.899, SAB_EBIT = 4.459, SAB_JV = 1.083;
const sabInputs = obj({
  offer: num(50, 75), und: num(60, 90), syn: num(0, 4), dis: num(0, 60), tax: num(15, 40), w: num(5, 10),
  g: num(-2, 4), int: num(0, 5), gr: num(0, 8), rn: num(6, 30),
});
const validateSab = obj({
  sliders: sabInputs,
  rule: str(600, { multiline: true }),
  q: oneOf("red", "flip", "sd", "free"),
  question,
});
type InSab = ReturnType<typeof validateSab>;

// calc() in sab.html, the parts the prompt uses.
export function sabState(i: InSab["sliders"]) {
  const offer = i.offer, und = i.und, syn = i.syn, dis = i.dis / 100, tax = i.tax / 100, w = i.w / 100, g = i.g / 100,
    integ = i.int, gr = i.gr / 100, rn = i.rn / 100;
  const eq = offer * SH / 1000, prem = eq - und, s = syn * (1 - dis), at = s * (1 - tax);
  const pv = (w > g) ? at / (w - g) - integ : Infinity, left = pv - prem;
  const beG = (prem + integ) > 0 ? w - at / (prem + integ) : null;
  const ev = eq + SAB_ND + SAB_NCI, above = ev - BOOK;
  const n1 = SAB_EBIT * (1 - tax) + SAB_JV + at;
  const rp1 = n1 / ev, ep1 = n1 - w * ev;
  let icp = ev, icb = BOOK, n = n1, cross: number | null = null;
  for (let t = 1; t <= 15; t++) {
    const rp = n / icp;
    if (cross === null && rp >= w) cross = t;
    const reinv = n * gr / rn;
    icp += reinv; icb += reinv; n *= 1 + gr;
  }
  return { offer, und, eq, prem, syn, dis, tax, w, g, integ, pv, left, beG, ev, above, rp1, rb1: n1 / BOOK, ep1, cross, gr };
}
const sabBn = (v: number) => (v < 0 ? "−$" : "$") + Math.abs(v).toFixed(1) + " bn";
const sabPc = (v: number) => (v * 100).toFixed(1) + "%";

// PROMPTS and TAIL in sab.html, word for word.
export const SAB_PROMPTS: Record<string, string> = {
  red: "Red-team the walk-away rule below. Find its three weakest points, in order of how much value they put at risk, and propose one change to the rule for each. Then say whether you would sign it.",
  flip: "Which single assumption above, moved by a plausible amount, flips the verdict? Give the amount, why it is plausible, and what evidence the Chair should ask for before relying on it.",
  sd: "The Santo Domingo family (about 14%) must accept for the deal to proceed. What would they need, given the partial share alternative (0.48 AB InBev share + £2.37 per SAB share), their tax position and their wish to stay exposed to brewing? How much of the spread does that hand them, and does the walk-away rule survive it?",
};
const SAB_TAIL = "\nAnswer in plain text, under 220 words, no headings. Reason from value created (ROIC against WACC, premium against synergies), not earnings per share. Use the theories of value (operational efficiency, intangible capital, innovation and IP, platform and ecosystem, capital redeployment, risk and resilience, regulatory and political) and Teece (complementary assets) where they help. Do not use knowledge of what happened after October 2015.";

export function promptSab(i: InSab): string {
  const S = sabState(i.sliders), bn = sabBn, pc = sabPc;
  const context = "Case: AB InBev considering its third proposal for SABMiller, 7 October 2015. Current assumptions from the class tool:\n" +
    "- Offer $" + S.offer.toFixed(1) + " per share; equity value " + bn(S.eq) + "; undisturbed value " + bn(S.und) + "; premium " + bn(S.prem) + ".\n" +
    "- Synergies $" + S.syn.toFixed(1) + " bn a year, " + Math.round(S.dis * 100) + "% lost to disposals, taxed at " + Math.round(S.tax * 100) + "%, WACC " + pc(S.w) + ", synergy growth " + pc(S.g) + ", integration cost " + bn(S.integ) + ".\n" +
    "- Value of synergies " + bn(S.pv) + "; value left for AB InBev after the premium " + bn(S.left) + "; break-even synergy growth " + (S.beG === null ? "n/a" : pc(S.beG)) + ".\n" +
    "- Enterprise value paid " + bn(S.ev) + ", of which " + bn(S.above) + " above SABMiller’s book capital. Year-1 ROIC on the price " + pc(S.rp1) + " (on SAB’s own capital " + pc(S.rb1) + "); year-1 economic profit " + bn(S.ep1) + "; at " + pc(S.gr) + " growth the return on the price " + (S.cross ? "reaches WACC in year " + S.cross : "does not reach WACC within 15 years") + ".\n" +
    "- Largest SABMiller holders: Altria 27%, Santo Domingo family 14%. Regulators may require disposals of about a third of SABMiller’s enterprise value.\n" +
    'Walk-away rule proposed by the table: "' + i.rule + '"\n\n';
  const ask = i.q === "free" ? 'The table asks: "' + i.question.trim() + '"' + ON_TOPIC : SAB_PROMPTS[i.q];
  return context + ask + SAB_TAIL;
}

// ---------------------------------------------------------------- LEGO India
const Y = [2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033];
const SHARE = [5, 10, 15, 16, 18, 20, 22, 24, 26, 28], FTE = [5, 6, 18, 21, 24, 27, 30, 33, 36, 39], MK = [750, 1250, 1500, 2000];
export type LegoP = { share: number; own: boolean; hq: number; crp: number; pg: number; cg: number; mg: number; ss: number; tax: boolean; sunk: boolean; int: boolean };

// model() in lego.html, unchanged.
export function legoModel(p: LegoP) {
  const rate = p.hq + p.crp, rows: { y: number; m: number; focf: number; pv: number; roic: number; df: number }[] = [];
  let nwcPrev = 10000;
  for (let i = 0; i < 10; i++) {
    const vol = 35000 * Math.pow(1 + p.mg, i) * SHARE[i] / 100 * p.ss;
    const price = 120.5 * Math.pow(1 + p.pg, i), uc = 105 * Math.pow(1 + p.cg, i);
    const sales = vol * price, costs = vol * uc;
    const mkt = i < 4 ? MK[i] : 2000 * Math.pow(1.02, i - 3);
    const sf = FTE[i] * 50 * Math.pow(1.02, i), oh = 0.04 * sales, dep = 10000;
    const ebit = sales - costs - mkt - sf - oh - dep;
    const tax = (ebit < 0 && !p.tax) ? 0 : 0.3 * ebit, noplat = ebit - tax;
    const nwc = 0.05 * costs + 0.08 * sales, capex = i < 9 ? 10000 : -90000;
    const inv = (i < 9) ? (nwcPrev - nwc) - capex : nwcPrev - capex;
    const focf = noplat + dep + inv - (p.int ? 1000 : 0);
    const df = 1 / Math.pow(1 + rate, i + 1);
    rows.push({ y: Y[i], m: (price - uc) / price, focf, df, pv: focf * df, roic: noplat / (100000 + nwcPrev) });
    nwcPrev = nwc;
  }
  const t0 = -110000 - (p.sunk ? 2000 : 0);
  const pvSum = rows.reduce((a, r) => a + r.pv, 0);
  const npv = t0 + pvSum, dfEnd = rows[9].df;
  const npvL = p.own ? (-100000 + 100000 * dfEnd + p.share * (npv + 100000 - 100000 * dfEnd)) : p.share * npv;
  const cf = [t0].concat(rows.map((r) => r.focf));
  const f = (r: number) => cf.reduce((a, v, k) => a + v / Math.pow(1 + r, k), 0);
  let irr: number | null = null, lo = -0.95, hi = 1.5;
  if (f(lo) * f(hi) < 0) {
    for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
    irr = (lo + hi) / 2;
  }
  return { rows, npv, npvL, irr, rate, nominal: cf.reduce((a, v) => a + v, 0) };
}
const legoK = (v: number) => (v < 0 ? "−" : "") + Math.round(Math.abs(v)).toLocaleString("en-GB");
const LEGO_LETTERS = ["A", "B", "C", "D", "E"] as const;
export const LEGO_ASSUMPTIONS = ["Price path", "Unit cost growth", "Discount rate", "Market share path", "Market growth"];

const validateLego = obj({
  sliders: obj({
    share: num(10, 100), own: bool, hq: num(3, 12), crp: num(0, 8), pg: num(0, 5), cg: num(0, 5), mg: num(0, 12), ss: num(25, 150),
    tax: bool, sunk: bool, int: bool,
  }),
  ranking: arr(int(1, 5), 5, 5),
  question,
});
type InLego = ReturnType<typeof validateLego>;

export function promptLego(i: InLego): string {
  const s = i.sliders;
  const p: LegoP = { share: s.share / 100, own: s.own, hq: s.hq / 100, crp: s.crp / 100, pg: s.pg / 100, cg: s.cg / 100, mg: s.mg / 100, ss: s.ss / 100, tax: s.tax, sunk: s.sunk, int: s.int };
  const R = legoModel(p), k = legoK;
  const best = R.rows.reduce((a, r) => r.roic > a.roic ? r : a);
  const pc = (v: number) => (v * 100).toFixed(1) + "%";
  const ranked = LEGO_LETTERS.map((l, n) => ({ l, n, r: i.ranking[n] })).sort((a, b) => a.r - b.r)
    .map((x) => x.l + " " + LEGO_ASSUMPTIONS[x.n].toLowerCase()).join(", ");
  return "Case: LEGO India, start of 2024, a fictional teaching case. LEGO is asked to fund an INR 100 m factory in a venture that gives the Indian government 70% of the project cash flows and LEGO 30%; the factory is bought back for INR 100 m after ten years. The controller's spreadsheet values 100% of the project. Current assumptions from the class tool:\n" +
    "- LEGO's share of project cash flows " + Math.round(p.share * 100) + "%; " + (p.own ? "LEGO pays for the factory and receives the buy-back itself" : "the factory payment and buy-back are shared like the other cash flows") + ".\n" +
    "- Discount rate " + pc(R.rate) + " (" + pc(p.hq) + " head-office cost of capital + " + pc(p.crp) + " India country risk premium); price growth " + pc(p.pg) + " a year from INR 120.50; unit cost growth " + pc(p.cg) + " a year from INR 105; market growth " + pc(p.mg) + " a year from 35 m units; market share path at " + Math.round(p.ss * 100) + "% of the case's 5% rising to 28%.\n" +
    "- Losses " + (p.tax ? "earn" : "do not earn") + " a 30% tax credit; the INR 2 m already spent on R&D is " + (p.sunk ? "included (an error)" : "left out") + "; the INR 1 m a year of interest is " + (p.int ? "deducted from the cash flows (an error)" : "left to the discount rate") + ".\n" +
    "- NPV of the whole project " + k(R.npv) + " kINR; NPV to LEGO " + k(R.npvL) + " kINR; IRR " + (R.irr === null ? "none" : pc(R.irr)) + "; unit gross margin " + (R.rows[0].m * 100).toFixed(0) + "% in 2024 and " + (R.rows[9].m * 100).toFixed(0) + "% in 2033; highest ROIC " + pc(best.roic) + " in " + best.y + " (the controller said \"about 40%\").\n" +
    "- Before opening the tool, the table ranked the five assumptions by how far a reasonable change moves NPV, largest first: " + ranked + ".\n\n" +
    'The table asks: "' + i.question.trim() + '"' + ON_TOPIC +
    "\nAnswer in plain text, under 220 words, no headings. Reason from value created (NPV, and ROIC against the cost of capital), not accounting profit. The case is fictional: do not bring in facts about LEGO's real operations in India.";
}

// ---------------------------------------------------------------- AkzoNobel
const AK_SH = 252, SC_EBITDA = 953;
const AK = {
  A: { when: "24 April 2017, PPG's third proposal: €61.50 in cash plus 0.357 PPG share", ref: 64.42, refLab: "the €64.42 undisturbed price", cash: 61.5, shares: 0.357, cutoff: "24 April 2017" },
  B: { when: "18 October 2017, the executive-board exercise: PPG offers €89 in cash (a case variant, not the historical offer)", ref: 58, refLab: "the €58 share price in the exercise", cash: 89, shares: 0, cutoff: "18 October 2017" },
};
const validateAkzo = obj({
  scenario: oneOf("A", "B"),
  sliders: obj({ ppg: num(80, 120), proc: num(6, 13), mult: num(7, 16), eb: num(1000, 1700), debt: num(1000, 5000), pay: num(0, 100), leak: num(0, 30) }),
  commit: obj({ pc: num(-100, 300), sc: num(-100, 300) }),
  question,
});
type InAkzo = ReturnType<typeof validateAkzo>;

// calc() in akzo.html.
export function akzoState(scenario: "A" | "B", i: InAkzo["sliders"]) {
  const s = AK[scenario], pay = i.pay / 100, leak = i.leak / 100;
  const offer = s.cash + s.shares * i.ppg;
  const remain = (i.mult * i.eb - i.debt) / AK_SH;
  const dist = i.proc * 1000 * pay * (1 - leak) / AK_SH;
  const sop = remain + dist;
  const be = ((offer - dist) * AK_SH + i.debt) / i.eb;
  return { offer, remain, dist, sop, be };
}
const eur = (v: number, d = 1) => "€" + v.toFixed(d);
const pct = (v: number) => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";

export function promptAkzo(i: InAkzo): string {
  const s = AK[i.scenario], x = akzoState(i.scenario, i.sliders), v = i.sliders, d = x.sop - x.offer;
  return "Case: AkzoNobel, " + s.when + ". The choice: separate the company, selling Specialty Chemicals and returning the proceeds, or open talks with PPG. Current assumptions from the class tool, per share on 252 m shares:\n" +
    "- The offer: " + eur(x.offer, 2) + ", " + pct(x.offer / s.ref - 1) + " on " + s.refLab + (s.shares ? " (PPG share at " + eur(v.ppg, 2) + ")" : "") + ".\n" +
    "- Paints & Coatings: " + v.mult.toFixed(1) + "× EBITDA of €" + v.eb.toLocaleString("en-GB") + " m, less €" + v.debt.toLocaleString("en-GB") + " m of debt: " + eur(x.remain) + " a share.\n" +
    "- Specialty Chemicals sold for €" + v.proc.toFixed(1) + " bn (" + (v.proc * 1000 / SC_EBITDA).toFixed(1) + "× its 2016 EBITDA of €953 m), " + Math.round(v.pay) + "% returned to shareholders after " + Math.round(v.leak) + "% leakage: " + eur(x.dist) + " a share.\n" +
    "- The parts: " + eur(x.sop) + " a share, " + (d >= 0 ? eur(d) + " above" : eur(-d) + " below") + " the offer; Paints & Coatings would need " + x.be.toFixed(1) + "× for the parts to match it.\n" +
    "- Before opening the tool, the table committed to " + eur(i.commit.pc) + " a share for Paints & Coatings and " + eur(i.commit.sc) + " for Specialty Chemicals, " + eur(i.commit.pc + i.commit.sc) + " for the parts.\n\n" +
    'The table asks: "' + i.question.trim() + '"' + ON_TOPIC +
    "\nAnswer in plain text, under 220 words, no headings. Reason from value per share and who keeps the spread (premium against separation upside, synergies, certainty, leakage), not earnings per share. Do not use knowledge of what happened after " + s.cutoff + ".";
}

// ---------------------------------------------------------------- the kinds
const caseKind = (artifact: string, validate: (v: unknown) => unknown, prompt: (i: never) => string, checkQuestion: (i: never) => void): KindSpec => ({
  artifact, bucket: artifact + ".ask", limit: 8, windowSeconds: 600, maxTokens: 5000, effort: "medium",
  validate: (v) => { const i = validate(v); checkQuestion(i as never); return i; },
  prompt, parse: text,
});
const needsQuestion = (i: { question: string }) => {
  if (i.question.trim().length < 3) throw new InputError("inputs.question must be at least 3 characters");
};

export const CASE_KINDS: Record<string, KindSpec> = {
  "sab.ask": caseKind("sab", validateSab, promptSab as (i: never) => string, ((i: InSab) => {
    if (i.q === "free") needsQuestion(i);
    else if (i.question !== "") throw new InputError("inputs.question must be empty unless q is free");
  }) as (i: never) => void),
  "lego.ask": caseKind("lego", (v) => {
    const i = validateLego(v);
    if (new Set(i.ranking).size !== 5) throw new InputError("inputs.ranking must use each rank 1-5 once");
    return i;
  }, promptLego as (i: never) => string, needsQuestion as (i: never) => void),
  "akzo.ask": caseKind("akzo", validateAkzo, promptAkzo as (i: never) => string, needsQuestion as (i: never) => void),
};
