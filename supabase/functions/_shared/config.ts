// Server-side constants for live AI. The client can choose none of these.
//
// Verified 29 Sep 2026 against the Anthropic docs:
//   Model id and pricing   https://platform.claude.com/docs/en/about-claude/pricing
//     Claude Sonnet 5.5 = claude-sonnet-5-5, $2 / MTok input, $10 / MTok output.
//   Effort                 https://platform.claude.com/docs/en/build-with-claude/effort
//     output_config.effort; "low" is the documented level for simple,
//     latency-sensitive work. Thinking is adaptive by default on Sonnet 5.5,
//     is billed as output tokens, and counts toward max_tokens, so the
//     max_tokens below are the hard ceiling on each call's output spend.
//   Refusal fallback       fallbacks: "default" with beta server-side-fallback-2026-07-01;
//     on Sonnet 5.5 a cyber or frontier_llm decline is retried on Claude Sonnet 5.

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_BETA = "server-side-fallback-2026-07-01";
export const MODEL = "claude-sonnet-5-5";
export const EFFORT = "low";

// USD per million tokens. The one place prices live.
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 }, // the refusal-fallback target
};
// A model not listed above is priced at this ceiling, so spend is never understated.
export const PRICE_CEILING = { input: 10, output: 50 };

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? PRICE_CEILING;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export type Kind = "03.decompose" | "06.briefing" | "06.debrief";

export interface KindSpec {
  artifact: "03" | "06";
  maxTokens: number;
  rate: { calls: number; windowMinutes: number };
}

export const KINDS: Record<Kind, KindSpec> = {
  "03.decompose": { artifact: "03", maxTokens: 4000, rate: { calls: 4, windowMinutes: 10 } },
  "06.briefing": { artifact: "06", maxTokens: 1500, rate: { calls: 10, windowMinutes: 60 } },
  "06.debrief": { artifact: "06", maxTokens: 2000, rate: { calls: 1, windowMinutes: 60 } },
};

export function isKind(k: unknown): k is Kind {
  return typeof k === "string" && Object.prototype.hasOwnProperty.call(KINDS, k);
}

export const ALLOWED_ORIGINS = ["https://www.theaiminute.blog", "https://theaiminute.blog"];

export const MAX_BODY_BYTES = 8192;
