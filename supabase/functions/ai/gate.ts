// The `ai` function's request handler. Checks run in this order:
//   1 origin (403) · 2 switch (423 off) · 3 window (423 outside window)
//   4 class code (401) · 5 budget (429 budget) · 6 device rate (429 rate)
//   7 kind and inputs (400)
// Only then is Anthropic called; every outcome after the origin check is logged.

import {
  ANTHROPIC_BETA,
  ANTHROPIC_URL,
  ANTHROPIC_VERSION,
  costUsd,
  EFFORT,
  isKind,
  type Kind,
  KINDS,
  MAX_BODY_BYTES,
  MODEL,
} from "../_shared/config.ts";
import { corsHeaders, hashCode, json, originAllowed, safeEqual } from "../_shared/http.ts";
import { insideWindow, liveStatus, type Store, totalSpend, type UsageRow } from "../_shared/store.ts";
import { build, InputError } from "./templates.ts";

export interface AnthropicReply {
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  refused: boolean;
}

export type CallAnthropic = (prompt: string, maxTokens: number) => Promise<AnthropicReply>;

export interface Deps {
  store: Store;
  callAnthropic: CallAnthropic;
  pepper: string;
  allowLocalhost: boolean;
  now?: () => Date;
}

const ALLOW_HEADERS = "content-type, x-class-code, x-device-id";
const DEVICE_RE = /^[A-Za-z0-9-]{8,64}$/;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const origin = req.headers.get("origin");
  const url = new URL(req.url);
  const isStatus = req.method === "GET" && url.pathname.replace(/\/+$/, "").endsWith("/status");

  // 1. Origin. The status probe carries no secret, so a request with no Origin
  //    header (curl, a monitor) may read it; a browser on another site may not.
  if (isStatus && !origin) return await status(deps, now(), {});
  if (!originAllowed(origin, deps.allowLocalhost)) return json(403, { error: "origin not allowed" });
  const cors = corsHeaders(origin!, ALLOW_HEADERS);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (isStatus) return await status(deps, now(), cors);
  if (req.method !== "POST") return json(405, { error: "method not allowed" }, cors);

  const started = Date.now();
  const deviceRaw = req.headers.get("x-device-id") ?? "";
  const device = DEVICE_RE.test(deviceRaw) ? deviceRaw : "invalid";

  // Read the body now (bounded); it is judged at step 7.
  let body: { kind?: unknown; inputs?: unknown } | null = null;
  const text = await req.text();
  if (text.length <= MAX_BODY_BYTES) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
    } catch { /* judged at step 7 */ }
  }
  const kind: Kind | null = body && isKind(body.kind) ? body.kind : null;
  const artifact = kind ? KINDS[kind].artifact : "?";

  const log = async (row: Partial<UsageRow> & { status: number }) => {
    try {
      await deps.store.logUsage({
        artifact,
        kind: kind ?? String(body?.kind ?? "?").slice(0, 40),
        device,
        reason: null,
        called: false,
        model: null,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        latency_ms: Date.now() - started,
        inputs: null,
        ...row,
      });
    } catch (e) {
      console.error("usage log failed", e);
    }
  };
  const refuse = async (status: number, reason: string) => {
    await log({ status, reason });
    return json(status, { reason }, cors);
  };

  const control = await deps.store.getControl();
  const t = now();

  // 2. The switch.
  if (!control.enabled) return await refuse(423, "off");

  // 3. The session window.
  if (!insideWindow(control, t)) return await refuse(423, "outside window");

  // 4. Class code.
  const code = req.headers.get("x-class-code") ?? "";
  let codeOk = false;
  if (code && code.length <= 32 && control.class_code_hash && control.class_code_salt) {
    const h = await hashCode(code, control.class_code_salt, deps.pepper);
    codeOk = safeEqual(h, control.class_code_hash);
  }
  if (!codeOk) return await refuse(401, "class code");

  // 5. Budget.
  const spent = totalSpend(await deps.store.spendSince(control.budget_since));
  if (spent >= Number(control.budget_usd)) return await refuse(429, "budget");

  // 6. Device rate limit.
  if (device === "invalid") return await refuse(400, "device");
  if (kind) {
    const { calls, windowMinutes } = KINDS[kind].rate;
    const since = new Date(t.getTime() - windowMinutes * 60_000).toISOString();
    if (await deps.store.deviceCalls(device, kind, since) >= calls) return await refuse(429, "rate");
  }

  // 7. Kind and inputs. Anything else in the body (model, max_tokens, ...) is ignored.
  if (!body) return await refuse(400, "body");
  if (!kind) return await refuse(400, "unknown kind");
  let built;
  try {
    built = build(kind, body.inputs);
  } catch (e) {
    if (e instanceof InputError) {
      await log({ status: 400, reason: "inputs" });
      return json(400, { reason: "inputs", detail: e.message }, cors);
    }
    throw e;
  }

  // The call. Model and max_tokens are fixed per kind on the server.
  let reply: AnthropicReply;
  try {
    reply = await deps.callAnthropic(built.prompt, KINDS[kind].maxTokens);
  } catch (e) {
    console.error("anthropic call failed", e);
    await log({ status: 502, reason: "upstream", called: true, inputs: built.inputs });
    return json(502, { reason: "upstream" }, cors);
  }
  const cost = costUsd(reply.model, reply.inputTokens, reply.outputTokens);
  const billed = {
    called: true,
    model: reply.model,
    input_tokens: reply.inputTokens,
    output_tokens: reply.outputTokens,
    cost_usd: cost,
    inputs: built.inputs,
  };
  if (reply.refused) {
    await log({ status: 502, reason: "refused", ...billed });
    return json(502, { reason: "refused" }, cors);
  }
  let result: unknown;
  try {
    result = built.finish(reply.text);
  } catch (e) {
    await log({ status: 502, reason: "bad output", ...billed });
    return json(502, { reason: "bad output", detail: (e as Error).message }, cors);
  }
  await log({ status: 200, ...billed });
  return json(200, {
    result,
    usage: { input_tokens: reply.inputTokens, output_tokens: reply.outputTokens },
    cost_usd: Number(cost.toFixed(6)),
  }, cors);
}

async function status(deps: Deps, now: Date, cors: Record<string, string>): Promise<Response> {
  const control = await deps.store.getControl();
  const spent = totalSpend(await deps.store.spendSince(control.budget_since));
  return json(200, liveStatus(control, spent, now), cors);
}

// The real Anthropic call: raw HTTP, the server's model, low effort.
export function anthropicCaller(apiKey: string, fetchFn: typeof fetch = fetch): CallAnthropic {
  return async (prompt, maxTokens) => {
    const res = await fetchFn(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": ANTHROPIC_BETA,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        output_config: { effort: EFFORT },
        fallbacks: "default",
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const u = data.usage ?? {};
    return {
      model: String(data.model ?? MODEL),
      text: (data.content ?? []).filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text).join("\n").trim(),
      inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
      refused: data.stop_reason === "refusal",
    };
  };
}
