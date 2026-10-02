// In-memory stand-ins for Postgres and Anthropic, mirroring the SQL in
// supabase/migrations (same counting rule as ai_reserve).

import type { CallModel, Control, Store, UsageRow } from "../supabase/functions/ai/gate.ts";
import type { AdminDb } from "../supabase/functions/admin/handler.ts";

export type Row = UsageRow & { id: number; ts: string };

export class MemDb implements Store {
  ctl: Control & { updated_at: string; updated_by: string | null };
  rows: Row[] = [];
  clock: () => Date;
  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock;
    this.ctl = {
      enabled: true, opens_at: null, closes_at: null, budget_usd: 5,
      budget_since: new Date(0).toISOString(), class_code_salt: "test-salt",
      updated_at: new Date(0).toISOString(), updated_by: null,
    };
  }
  control() { return Promise.resolve({ ...this.ctl }); }
  spendSince(since: string) {
    const t = new Date(since).getTime();
    return Promise.resolve(this.rows.filter((r) => new Date(r.ts).getTime() >= t).reduce((a, r) => a + r.cost_usd, 0));
  }
  reserve(device: string, bucket: string, limit: number, windowSeconds: number, row: UsageRow) {
    const since = this.clock().getTime() - windowSeconds * 1000;
    const n = this.rows.filter((r) =>
      r.device === device && r.bucket === bucket && new Date(r.ts).getTime() > since && (r.status === 0 || r.status === 200)
    ).length;
    if (n >= limit) return Promise.resolve(null);
    const id = this.rows.length + 1;
    this.rows.push({ ...row, bucket, device, status: 0, id, ts: this.clock().toISOString() });
    return Promise.resolve(id);
  }
  finish(id: number, patch: Partial<UsageRow>) {
    Object.assign(this.rows.find((r) => r.id === id)!, patch);
    return Promise.resolve();
  }
  log(row: UsageRow) {
    this.rows.push({ ...row, id: this.rows.length + 1, ts: this.clock().toISOString() });
    return Promise.resolve();
  }

  admin(): AdminDb {
    return {
      control: () => Promise.resolve({ ...this.ctl }),
      updateControl: (patch) => { Object.assign(this.ctl, patch); return Promise.resolve(); },
      spendSince: (s) => this.spendSince(s),
      spendByArtifact: (s) => {
        const t = new Date(s).getTime(), by: Record<string, { artifact: string; calls: number; ok_calls: number; cost_usd: number }> = {};
        for (const r of this.rows.filter((r) => new Date(r.ts).getTime() >= t)) {
          const k = r.artifact ?? "—";
          by[k] ??= { artifact: k, calls: 0, ok_calls: 0, cost_usd: 0 };
          by[k].calls++; if (r.status === 200) by[k].ok_calls++; by[k].cost_usd += r.cost_usd;
        }
        return Promise.resolve(Object.values(by));
      },
      recent: (n) => Promise.resolve([...this.rows].reverse().slice(0, n) as unknown as Record<string, unknown>[]),
    };
  }
}

export const SAMPLE_TASKS = JSON.stringify([
  { task: "Reconcile ledgers", type: "automate", why: "Rule-based matching", time: 30, value: 10 },
  { task: "Draft commentary", type: "augment", why: "AI drafts, human edits", time: 30, value: 30 },
  { task: "Brief the board", type: "human", why: "Judgement and trust", time: 40, value: 60 },
]);

// A fake model that records what it was asked and answers per kind.
export function fakeModel(log: { model: string; maxTokens: number; prompt: string }[]): CallModel {
  return (a) => {
    log.push(a);
    const text = a.prompt.includes("JSON array") ? SAMPLE_TASKS : "Fiscal support arrived fast; inflation is building with a lag.";
    return Promise.resolve({ text, stopReason: "end_turn", inputTokens: 400, outputTokens: 600 });
  };
}
