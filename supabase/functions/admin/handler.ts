// Control-room actions. Every request must carry the Supabase Auth session
// of ADMIN_EMAIL; anything else gets 403 and changes nothing.
//
// POST /admin {action: "state" | "set" | "reset_budget" | "rotate_code", ...}
// Every action answers with the full state.

import { corsHeaders, originAllowed } from "../_shared/cors.ts";
import { deriveCode, newSalt } from "../_shared/classcode.ts";
import { type Control, liveState } from "../ai/gate.ts";

export type AdminDb = {
  control(): Promise<Control & { updated_at: string; updated_by: string | null }>;
  updateControl(patch: Record<string, unknown>): Promise<void>;
  spendSince(since: string): Promise<number>;
  spendByArtifact(since: string): Promise<{ artifact: string; calls: number; ok_calls: number; cost_usd: number }[]>;
  recent(n: number): Promise<Record<string, unknown>[]>;
};

export type AdminDeps = {
  db: AdminDb;
  userEmail(jwt: string): Promise<string | null>; // confirmed email of the session, or null
  adminEmail: string;
  pepper: string;
  dev: boolean;
  now?: () => Date;
};

const isoOrNull = (v: unknown, name: string) => {
  if (v === null) return null;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw new Error(`${name} must be an ISO time or null`);
  return new Date(v).toISOString();
};

export async function handleAdmin(req: Request, deps: AdminDeps): Promise<Response> {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin, deps.dev, "POST, OPTIONS");
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: originAllowed(origin, deps.dev) ? 204 : 403, headers: cors });
  }
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!originAllowed(origin, deps.dev)) return json(403, { error: "origin" });

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const email = jwt ? await deps.userEmail(jwt).catch(() => null) : null;
  if (!deps.adminEmail || !email || email.toLowerCase() !== deps.adminEmail.toLowerCase()) {
    return json(403, { error: "not the admin" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object") throw 0;
  } catch {
    return json(400, { error: "bad json" });
  }

  const stamp = { updated_at: new Date().toISOString(), updated_by: email };
  try {
    switch (body.action) {
      case "state":
        break;
      case "set": {
        const patch: Record<string, unknown> = {};
        if ("enabled" in body) {
          if (typeof body.enabled !== "boolean") return json(400, { error: "enabled must be true or false" });
          patch.enabled = body.enabled;
        }
        if ("opens_at" in body) patch.opens_at = isoOrNull(body.opens_at, "opens_at");
        if ("closes_at" in body) patch.closes_at = isoOrNull(body.closes_at, "closes_at");
        if ("budget_usd" in body) {
          const b = body.budget_usd;
          if (typeof b !== "number" || !Number.isFinite(b) || b < 0 || b > 1000) {
            return json(400, { error: "budget_usd must be 0..1000" });
          }
          patch.budget_usd = Math.round(b * 100) / 100;
        }
        if (!Object.keys(patch).length) return json(400, { error: "nothing to set" });
        await deps.db.updateControl({ ...patch, ...stamp });
        break;
      }
      case "reset_budget":
        await deps.db.updateControl({ budget_since: new Date().toISOString(), ...stamp });
        break;
      case "rotate_code":
        await deps.db.updateControl({ class_code_salt: newSalt(), ...stamp });
        break;
      default:
        return json(400, { error: "unknown action" });
    }
  } catch (e) {
    return json(400, { error: String((e as Error)?.message ?? e) });
  }

  const c = await deps.db.control();
  const [spend, byArtifact, log] = await Promise.all([
    deps.db.spendSince(c.budget_since), deps.db.spendByArtifact(c.budget_since), deps.db.recent(25),
  ]);
  const { class_code_salt, ...control } = c;
  return json(200, {
    control,
    status: liveState(c, spend, (deps.now ?? (() => new Date()))()),
    code: deps.pepper ? await deriveCode(deps.pepper, class_code_salt) : null,
    spend,
    by_artifact: byArtifact,
    log,
  });
}
