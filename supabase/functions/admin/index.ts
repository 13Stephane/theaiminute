// Edge Function `admin`: the control room's only door.
// Deploy with JWT verification on; logic.ts then insists on ADMIN_EMAIL.

import { createClient } from "npm:@supabase/supabase-js@2";
import { supabaseStore } from "../_shared/store.ts";
import { handleAdmin } from "./logic.ts";

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`missing secret ${k}`);
  return v;
};

const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const deps = {
  store: supabaseStore(sb),
  emailForToken: async (token: string) => {
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user?.email || !data.user.email_confirmed_at) return null;
    return data.user.email as string;
  },
  adminEmail: env("ADMIN_EMAIL"),
  pepper: env("CLASS_CODE_PEPPER"),
  allowLocalhost: Deno.env.get("AI_ALLOW_LOCALHOST") === "true",
};

Deno.serve(async (req) => {
  try {
    return await handleAdmin(req, deps);
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: "server" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
