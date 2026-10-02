// Edge Function `ai`: the only caller of Anthropic. Deployed public
// (verify_jwt = false); the gate in gate.ts does the checking.

import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { handle } from "./gate.ts";
import { EFFORT } from "./templates.ts";
import { supabaseStore } from "./store.ts";

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
  timeout: 60_000,
  maxRetries: 1,
});

const store = supabaseStore(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve((req) =>
  handle(req, {
    store,
    pepper: Deno.env.get("CLASS_CODE_PEPPER") ?? "",
    dev: Deno.env.get("AI_DEV") === "1",
    async callModel({ model, maxTokens, prompt }) {
      const msg = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        output_config: { effort: EFFORT },
        messages: [{ role: "user", content: prompt }],
      });
      const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
      return {
        text,
        stopReason: msg.stop_reason,
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
      };
    },
  })
);
