// Control-room actions. Every request needs a Supabase Auth session whose
// confirmed email is ADMIN_EMAIL; anyone else gets 403 and changes nothing.

import { corsHeaders, hashCode, json, newClassCode, newSalt, originAllowed } from "../_shared/http.ts";
import { liveStatus, type Store, totalSpend } from "../_shared/store.ts";

export interface AdminDeps {
  store: Store;
  // Resolves a bearer token to the user's confirmed email, or null.
  emailForToken: (token: string) => Promise<string | null>;
  adminEmail: string;
  pepper: string;
  allowLocalhost: boolean;
  now?: () => Date;
}

const ALLOW_HEADERS = "authorization, apikey, content-type, x-client-info";

export async function handleAdmin(req: Request, deps: AdminDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const origin = req.headers.get("origin");
  if (!originAllowed(origin, deps.allowLocalhost)) return json(403, { error: "origin not allowed" });
  const cors = corsHeaders(origin!, ALLOW_HEADERS);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "method not allowed" }, cors);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const email = token ? await deps.emailForToken(token) : null;
  if (!email) return json(401, { error: "sign in first" }, cors);
  if (email.toLowerCase() !== deps.adminEmail.trim().toLowerCase()) {
    return json(403, { error: "this address is not the control-room admin" }, cors);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad json" }, cors);
  }

  const s = deps.store;
  let extra: Record<string, unknown> = {};
  switch (body.action) {
    case "state":
      break;
    case "set": {
      const patch: Record<string, unknown> = {};
      if ("enabled" in body) {
        if (typeof body.enabled !== "boolean") return json(400, { error: "enabled: boolean" }, cors);
        patch.enabled = body.enabled;
      }
      for (const k of ["opens_at", "closes_at"]) {
        if (k in body) {
          const v = body[k];
          if (v !== null && (typeof v !== "string" || Number.isNaN(Date.parse(v)))) {
            return json(400, { error: `${k}: ISO time or null` }, cors);
          }
          patch[k] = v === null ? null : new Date(v as string).toISOString();
        }
      }
      if ("budget_usd" in body) {
        const b = body.budget_usd;
        if (typeof b !== "number" || !Number.isFinite(b) || b < 0 || b > 1000) {
          return json(400, { error: "budget_usd: 0 to 1000" }, cors);
        }
        patch.budget_usd = Math.round(b * 100) / 100;
      }
      const cur = await s.getControl();
      const o = (patch.opens_at !== undefined ? patch.opens_at : cur.opens_at) as string | null;
      const c = (patch.closes_at !== undefined ? patch.closes_at : cur.closes_at) as string | null;
      if (o && c && Date.parse(c) <= Date.parse(o)) {
        return json(400, { error: "the window must close after it opens" }, cors);
      }
      await s.updateControl(patch);
      break;
    }
    case "reset_budget":
      await s.updateControl({ budget_since: now().toISOString() });
      break;
    case "rotate_code": {
      const code = newClassCode();
      const salt = newSalt();
      await s.updateControl({ class_code_salt: salt, class_code_hash: await hashCode(code, salt, deps.pepper) });
      // The code itself is returned once and never stored.
      extra = { code };
      break;
    }
    default:
      return json(400, { error: "unknown action" }, cors);
  }
  return json(200, { ...(await state(s, now())), ...extra }, cors);
}

async function state(s: Store, now: Date) {
  const c = await s.getControl();
  const lines = await s.spendSince(c.budget_since);
  const spent = totalSpend(lines);
  return {
    control: {
      enabled: c.enabled,
      opens_at: c.opens_at,
      closes_at: c.closes_at,
      budget_usd: Number(c.budget_usd),
      budget_since: c.budget_since,
      has_code: !!c.class_code_hash,
      updated_at: c.updated_at ?? null,
    },
    status: liveStatus(c, spent, now),
    spend: { total: Number(spent.toFixed(6)), by_artifact: lines },
    log: await s.recentUsage(25),
    now: now.toISOString(),
  };
}
