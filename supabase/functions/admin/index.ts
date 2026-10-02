// Edge Function `admin`: deployed with JWT verification on. The handler
// then checks that the session's confirmed email is ADMIN_EMAIL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleAdmin } from "./handler.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const must = <T>(r: { data: T; error: unknown }) => {
  if (r.error) throw r.error;
  return r.data;
};

Deno.serve((req) =>
  handleAdmin(req, {
    adminEmail: Deno.env.get("ADMIN_EMAIL") ?? "",
    pepper: Deno.env.get("CLASS_CODE_PEPPER") ?? "",
    dev: Deno.env.get("AI_DEV") === "1",
    async userEmail(jwt) {
      const { data, error } = await db.auth.getUser(jwt);
      if (error || !data.user?.email || !data.user.email_confirmed_at) return null;
      return data.user.email;
    },
    db: {
      async control() {
        return must(await db.from("ai_control").select("*").eq("id", true).single())!;
      },
      async updateControl(patch) {
        must(await db.from("ai_control").update(patch).eq("id", true));
      },
      async spendSince(since) {
        return Number(must(await db.rpc("ai_spend_since", { p_since: since })) ?? 0);
      },
      async spendByArtifact(since) {
        return must(await db.rpc("ai_spend_by_artifact", { p_since: since })) ?? [];
      },
      async recent(n) {
        return must(await db.from("ai_usage")
          .select("ts, artifact, kind, device, status, reason, input_tokens, output_tokens, cost_usd, latency_ms")
          .order("ts", { ascending: false }).limit(n)) ?? [];
      },
    },
  })
);
