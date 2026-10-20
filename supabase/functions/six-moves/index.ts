// Edge Function `six-moves`: the game server for Six Moves. Deployed public
// (verify_jwt = false); the facilitator code and the live room's class code are
// the authentication.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { supabaseStore } from "../ai/store.ts";
import { type DocStore, handle } from "./handler.ts";

const URL_ = Deno.env.get("SUPABASE_URL");
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

function supabaseDocs(url: string, serviceKey: string): DocStore {
  const t = createClient(url, serviceKey, { auth: { persistSession: false } }).from("six_moves_docs");
  const must = <T>(r: { data: T; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  };
  return {
    async all() {
      return must(await t.select("id, data, version")) ?? [];
    },
    async get(id) {
      return must(await t.select("id, data, version").eq("id", id).maybeSingle());
    },
    async insertIfAbsent(id, data, now) {
      const rows = must(await t.upsert({ id, data, version: 1, updated_at: now }, { onConflict: "id", ignoreDuplicates: true }).select("id"));
      return (rows ?? []).length === 1;
    },
    async updateIfVersion(id, data, base, now) {
      const rows = must(await t.update({ data, version: base + 1, updated_at: now }).eq("id", id).eq("version", base).select("id"));
      return (rows ?? []).length === 1;
    },
    async remove(id) {
      must(await t.delete().eq("id", id));
    },
    async clear() {
      must(await t.delete().not("id", "is", null));
    },
  };
}

const docs = URL_ && SERVICE ? supabaseDocs(URL_, SERVICE) : null;
const spend = supabaseStore(URL_ ?? "", SERVICE ?? "");

Deno.serve((req) =>
  handle(req, {
    docs,
    spend,
    hasKey: !!KEY,
    facilitatorCode: Deno.env.get("SIX_MOVES_FACILITATOR_CODE") ?? "",
    pepper: Deno.env.get("CLASS_CODE_PEPPER") ?? "",
    allowedOrigins: Deno.env.get("SIX_MOVES_ALLOWED_ORIGINS") ?? "",
    async callModel({ model, maxTokens, system, user }) {
      const api = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!api.ok) return { ok: false, status: api.status, detail: await api.text() };
      const out = await api.json();
      return {
        ok: true,
        text: (out.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join(""),
        inputTokens: out.usage?.input_tokens ?? 0,
        outputTokens: out.usage?.output_tokens ?? 0,
      };
    },
  })
);
