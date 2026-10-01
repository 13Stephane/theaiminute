// The editor's AI Composer, server side. Only a signed-in editor (a row in
// public.editors) may call it; the Mistral key stays in Supabase secrets.

const ALLOWED_ORIGINS = ["https://www.theaiminute.blog", "https://theaiminute.blog"];
const ALLOW_HEADERS = "authorization, apikey, content-type, x-client-info";
export const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
export const MISTRAL_MODEL = "mistral-small-latest"; // as the editor used before
export const MAX_TOKENS = 1000;
const MAX_SYSTEM = 8000, MAX_USER = 4000;

export interface ComposeDeps {
  // The signed-in editor's email for this bearer token, or null.
  editorForToken: (token: string) => Promise<string | null>;
  callMistral: (system: string, user: string) => Promise<string>;
  allowLocalhost: boolean;
}

function originOk(origin: string | null, dev: boolean): origin is string {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin) ||
    (dev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin));
}

const json = (status: number, body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export async function handleCompose(req: Request, deps: ComposeDeps): Promise<Response> {
  const origin = req.headers.get("origin");
  if (!originOk(origin, deps.allowLocalhost)) return json(403, { error: "origin not allowed" }, {});
  const cors = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Vary": "Origin",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "method not allowed" }, cors);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !(await deps.editorForToken(token))) {
    return json(403, { error: "sign in as an editor first" }, cors);
  }

  let body: { system?: unknown; user?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad json" }, cors);
  }
  const { system, user } = body;
  if (typeof system !== "string" || typeof user !== "string" || !user.trim() ||
      system.length > MAX_SYSTEM || user.length > MAX_USER) {
    return json(400, { error: `system (max ${MAX_SYSTEM}) and user (1 to ${MAX_USER} characters) are required` }, cors);
  }
  try {
    return json(200, { text: await deps.callMistral(system, user) }, cors);
  } catch (e) {
    console.error(e);
    return json(502, { error: "the model did not answer" }, cors);
  }
}

export function mistralCaller(apiKey: string, fetchFn: typeof fetch = fetch) {
  return async (system: string, user: string): Promise<string> => {
    const res = await fetchFn(MISTRAL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`mistral ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return String(data?.choices?.[0]?.message?.content ?? "");
  };
}
