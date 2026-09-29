// Edge Function `ai`: public, and the only caller of Anthropic.
// Deploy with --no-verify-jwt; the gate in gate.ts does the checking.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, originAllowed } from "../_shared/http.ts";
import { supabaseStore } from "../_shared/store.ts";
import { anthropicCaller, handle } from "./gate.ts";

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`missing secret ${k}`);
  return v;
};

const store = supabaseStore(
  createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } }),
);

const deps = {
  store,
  callAnthropic: anthropicCaller(env("ANTHROPIC_API_KEY")),
  pepper: env("CLASS_CODE_PEPPER"),
  allowLocalhost: Deno.env.get("AI_ALLOW_LOCALHOST") === "true",
};

Deno.serve(async (req) => {
  try {
    return await handle(req, deps);
  } catch (e) {
    console.error(e);
    // Keep CORS on a crash so the page can read the failure and fall back.
    const origin = req.headers.get("origin");
    const cors = originAllowed(origin, deps.allowLocalhost) ? corsHeaders(origin!, "content-type") : {};
    return new Response(JSON.stringify({ reason: "server" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }
});
