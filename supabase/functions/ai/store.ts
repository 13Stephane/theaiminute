// The Store backed by Postgres through the service role (which bypasses RLS;
// the tables have no policies, so nothing else can read or write them).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Control, Store, UsageRow } from "./gate.ts";

export function supabaseStore(url: string, serviceKey: string): Store {
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const must = <T>(r: { data: T; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  };
  return {
    async control() {
      return must(await db.from("ai_control").select(
        "enabled, opens_at, closes_at, budget_usd, budget_since, class_code_salt",
      ).eq("id", true).single()) as Control;
    },
    async spendSince(since) {
      return Number(must(await db.rpc("ai_spend_since", { p_since: since })) ?? 0);
    },
    async reserve(device, bucket, limit, windowSeconds, row) {
      return must(await db.rpc("ai_reserve", {
        p_device: device, p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds, p_row: row,
      })) as number | null;
    },
    async finish(id, patch) {
      must(await db.from("ai_usage").update(patch).eq("id", id));
    },
    async log(row: UsageRow) {
      must(await db.from("ai_usage").insert(row));
    },
  };
}
