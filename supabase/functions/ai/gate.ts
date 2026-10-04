// The request handler for `ai`, independent of Supabase and Anthropic so the
// tests can run it with an in-memory store and a fake model.
//
// POST /ai          {kind, inputs} + X-Class-Code + X-Device-Id
// GET  /ai/status   {live, reason}
//
// Gate order: origin 403 · enabled 423 · window 423 · class code 401 ·
// budget 429 · device rate 429 · kind and inputs 400. Only then the model.

import { corsHeaders, originAllowed } from "../_shared/cors.ts";
import { deriveCode, normalizeCode, sameCode } from "../_shared/classcode.ts";
import { costUsd, InputError, KINDS, MODEL } from "./templates.ts";

export type Control = {
  enabled: boolean;
  opens_at: string | null;
  closes_at: string | null;
  budget_usd: number;
  budget_since: string;
  class_code_salt: string;
};

export type UsageRow = {
  artifact: string | null;
  kind: string;
  bucket: string | null;
  device: string | null;
  status: number;            // 0 while the model call is in flight
  reason: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
  inputs: unknown;
  model: string | null;
};

export interface Store {
  control(): Promise<Control>;
  spendSince(since: string): Promise<number>;
  // Atomically: count this device's calls in the bucket over the window
  // (rows with status 0 or 200), and if under the limit insert `row` and
  // return its id. Returns null when the device is over its limit.
  reserve(device: string, bucket: string, limit: number, windowSeconds: number, row: UsageRow): Promise<number | null>;
  finish(id: number, patch: Partial<UsageRow>): Promise<void>;
  log(row: UsageRow): Promise<void>;
}

export type ModelReply = { text: string; stopReason: string | null; inputTokens: number; outputTokens: number };
export type CallModel = (a: { model: string; maxTokens: number; prompt: string }) => Promise<ModelReply>;

export type Deps = {
  store: Store;
  callModel: CallModel;
  pepper: string;
  dev: boolean;
  now?: () => Date;
};

const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BODY = 8192;

export function liveState(c: Control, spend: number, now: Date): { live: boolean; reason: string } {
  if (!c.enabled) return { live: false, reason: "off" };
  if (c.opens_at && now < new Date(c.opens_at)) return { live: false, reason: "outside window" };
  if (c.closes_at && now >= new Date(c.closes_at)) return { live: false, reason: "outside window" };
  if (spend >= Number(c.budget_usd)) return { live: false, reason: "budget" };
  return { live: true, reason: "on" };
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin, deps.dev, "GET, POST, OPTIONS");
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: originAllowed(origin, deps.dev) ? 204 : 403, headers: cors });
  }

  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.replace(/\/+$/, "").endsWith("/status")) {
    try {
      const c = await deps.store.control();
      return json(200, liveState(c, await deps.store.spendSince(c.budget_since), now()));
    } catch {
      return json(200, { live: false, reason: "unavailable" });
    }
  }
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const t0 = Date.now();

  // Read the body up front only to label the log row; it is acted on at step 7.
  let body: Record<string, unknown> | null = null;
  try {
    const raw = await req.text();
    if (raw.length <= MAX_BODY) {
      const b = JSON.parse(raw);
      if (b && typeof b === "object" && !Array.isArray(b)) body = b;
    }
  } catch { /* stays null; rejected at step 7 */ }
  const kindName = typeof body?.kind === "string" ? body.kind : "";
  const spec = Object.hasOwn(KINDS, kindName) ? KINDS[kindName] : null;
  const deviceHdr = req.headers.get("x-device-id");
  const device = deviceHdr && DEVICE_RE.test(deviceHdr) ? deviceHdr : null;

  const row = (status: number, reason: string | null, inputs: unknown = null): UsageRow => ({
    artifact: spec?.artifact ?? null, kind: spec ? kindName : "unknown", bucket: spec?.bucket ?? null,
    device, status, reason, input_tokens: 0, output_tokens: 0, cost_usd: 0,
    latency_ms: Date.now() - t0, inputs, model: null,
  });
  const reject = async (status: number, reason: string) => {
    try { await deps.store.log(row(status, reason)); } catch { /* logging must not mask the answer */ }
    return json(status, { error: reason, reason });
  };

  try {
    // 1. Origin
    if (!originAllowed(origin, deps.dev)) return await reject(403, "origin");

    // 2-3. Switch and window
    const c = await deps.store.control();
    const t = now();
    if (!c.enabled) return await reject(423, "off");
    if ((c.opens_at && t < new Date(c.opens_at)) || (c.closes_at && t >= new Date(c.closes_at))) {
      return await reject(423, "outside window");
    }

    // 4. Class code
    if (!deps.pepper) return await reject(500, "misconfigured");
    const expected = await deriveCode(deps.pepper, c.class_code_salt);
    if (!sameCode(normalizeCode(req.headers.get("x-class-code")), expected)) return await reject(401, "class code");

    // 5. Budget
    if (await deps.store.spendSince(c.budget_since) >= Number(c.budget_usd)) return await reject(429, "budget");

    // 6. Device rate limit (needs a known kind to pick the bucket; unknown kinds fall to 400)
    let id: number | null = null;
    if (spec) {
      if (!device) return await reject(400, "device");
      id = await deps.store.reserve(device, spec.bucket, spec.limit, spec.windowSeconds, row(0, null));
      if (id === null) return await reject(429, "rate");
    }

    // 7. Kind and inputs
    if (!body || !spec) {
      if (id !== null) await deps.store.finish(id, { status: 400, reason: "kind" });
      else await deps.store.log(row(400, "kind"));
      return json(400, { error: "unknown kind", reason: "kind" });
    }
    let inputs: unknown;
    try {
      inputs = spec.validate(body.inputs);
    } catch (e) {
      const msg = e instanceof InputError ? e.message : "invalid inputs";
      await deps.store.finish(id!, { status: 400, reason: "inputs", latency_ms: Date.now() - t0 });
      return json(400, { error: msg, reason: "inputs" });
    }

    // The model and max_tokens come from the kind; nothing in the body can change them.
    let reply: ModelReply;
    try {
      reply = await deps.callModel({ model: MODEL, maxTokens: spec.maxTokens, prompt: spec.prompt(inputs as never) });
    } catch (e) {
      await deps.store.finish(id!, {
        status: 502, reason: "upstream: " + String((e as Error)?.message ?? e).slice(0, 200),
        latency_ms: Date.now() - t0, inputs, model: MODEL,
      });
      return json(502, { error: "upstream", reason: "upstream" });
    }

    const usage = { input_tokens: reply.inputTokens, output_tokens: reply.outputTokens };
    const cost = costUsd(reply.inputTokens, reply.outputTokens);
    const paid = { ...usage, cost_usd: cost, latency_ms: Date.now() - t0, inputs, model: MODEL };

    let result: unknown, why: string | null = null;
    if (reply.stopReason === "refusal") why = "refused";
    else if (reply.stopReason === "max_tokens") why = "truncated";
    else {
      try { result = spec.parse(reply.text, inputs); } catch { why = "bad output"; }
    }
    if (why) {
      await deps.store.finish(id!, { ...paid, status: 502, reason: why });
      return json(502, { error: why, reason: why });
    }

    await deps.store.finish(id!, { ...paid, status: 200, reason: null });
    return json(200, { result, usage, cost_usd: cost });
  } catch (e) {
    console.error("ai gate:", e);
    return json(503, { error: "unavailable", reason: "unavailable" });
  }
}
