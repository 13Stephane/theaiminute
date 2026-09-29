// Storage behind both functions. The gate and the admin logic take a Store,
// so tests can run them against an in-memory copy.

export interface Control {
  enabled: boolean;
  opens_at: string | null;
  closes_at: string | null;
  budget_usd: number;
  budget_since: string;
  class_code_salt: string | null;
  class_code_hash: string | null;
  updated_at?: string;
}

export interface UsageRow {
  at?: string;
  artifact: string;
  kind: string;
  device: string;
  status: number;
  reason: string | null;
  called: boolean;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  inputs: unknown;
}

export interface SpendLine {
  artifact: string;
  spend: number;
  calls: number;
}

export interface Store {
  getControl(): Promise<Control>;
  updateControl(patch: Partial<Control>): Promise<void>;
  spendSince(since: string): Promise<SpendLine[]>;
  deviceCalls(device: string, kind: string, since: string): Promise<number>;
  logUsage(row: UsageRow): Promise<void>;
  recentUsage(limit: number): Promise<UsageRow[]>;
}

export function totalSpend(lines: SpendLine[]): number {
  return lines.reduce((a, l) => a + Number(l.spend || 0), 0);
}

export type LiveReason = "on" | "off" | "outside window" | "budget";

// What the status badge shows. Same order as the gate, minus the class code.
export function liveStatus(c: Control, spent: number, now: Date): { live: boolean; reason: LiveReason } {
  if (!c.enabled) return { live: false, reason: "off" };
  if (!insideWindow(c, now)) return { live: false, reason: "outside window" };
  if (spent >= Number(c.budget_usd)) return { live: false, reason: "budget" };
  return { live: true, reason: "on" };
}

export function insideWindow(c: Control, now: Date): boolean {
  const t = now.getTime();
  if (c.opens_at && t < Date.parse(c.opens_at)) return false;
  if (c.closes_at && t >= Date.parse(c.closes_at)) return false;
  return true;
}

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export function supabaseStore(sb: SupabaseClient): Store {
  const check = (error: unknown) => {
    if (error) throw new Error("store: " + JSON.stringify(error));
  };
  return {
    async getControl() {
      const { data, error } = await sb.from("ai_control").select("*").eq("id", 1).single();
      check(error);
      return { ...data, budget_usd: Number(data.budget_usd) } as Control;
    },
    async updateControl(patch) {
      const { error } = await sb.from("ai_control")
        .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
      check(error);
    },
    async spendSince(since) {
      const { data, error } = await sb.rpc("ai_spend_since", { since });
      check(error);
      return (data ?? []).map((r: SpendLine) => ({
        artifact: r.artifact,
        spend: Number(r.spend),
        calls: Number(r.calls),
      }));
    },
    async deviceCalls(device, kind, since) {
      const { data, error } = await sb.rpc("ai_device_calls", { p_device: device, p_kind: kind, since });
      check(error);
      return Number(data ?? 0);
    },
    async logUsage(row) {
      const { error } = await sb.from("ai_usage").insert(row);
      check(error);
    },
    async recentUsage(limit) {
      const { data, error } = await sb.from("ai_usage")
        .select("at,artifact,kind,device,status,reason,called,model,input_tokens,output_tokens,cost_usd,latency_ms")
        .order("at", { ascending: false }).limit(limit);
      check(error);
      return (data ?? []).map((r: UsageRow) => ({ ...r, cost_usd: Number(r.cost_usd) }));
    },
  };
}
