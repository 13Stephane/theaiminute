// Edge Function `compose`: the editor's AI Composer. Deploy with JWT
// verification on (the default); logic.ts then insists on an editor.

import { createClient } from "npm:@supabase/supabase-js@2";
import { handleCompose, mistralCaller } from "./logic.ts";

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`missing secret ${k}`);
  return v;
};

const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const deps = {
  editorForToken: async (token: string) => {
    const { data, error } = await sb.auth.getUser(token);
    const email = data?.user?.email?.toLowerCase();
    if (error || !email || !data.user.email_confirmed_at) return null;
    const { data: row } = await sb.from("editors").select("email").eq("email", email).maybeSingle();
    return row ? email : null;
  },
  callMistral: mistralCaller(env("MISTRAL_API_KEY")),
  allowLocalhost: Deno.env.get("AI_ALLOW_LOCALHOST") === "true",
};

Deno.serve(async (req) => {
  try {
    return await handleCompose(req, deps);
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: "server" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
