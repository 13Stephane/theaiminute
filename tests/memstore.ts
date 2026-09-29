// In-memory Store for tests. Mirrors the SQL in 0001_control_and_usage.sql.
import type { Control, SpendLine, Store, UsageRow } from "../supabase/functions/_shared/store.ts";

export function memStore(init: Partial<Control> = {}, clock: () => Date = () => new Date()) {
  const control: Control = {
    enabled: false,
    opens_at: null,
    closes_at: null,
    budget_usd: 5,
    budget_since: new Date(0).toISOString(),
    class_code_salt: null,
    class_code_hash: null,
    ...init,
  };
  const usage: (UsageRow & { at: string })[] = [];
  const store: Store = {
    getControl: () => Promise.resolve({ ...control }),
    updateControl: (patch) => {
      Object.assign(control, patch);
      return Promise.resolve();
    },
    spendSince: (since) => {
      const by = new Map<string, SpendLine>();
      for (const r of usage) {
        if (r.at < since) continue;
        const l = by.get(r.artifact) ?? { artifact: r.artifact, spend: 0, calls: 0 };
        l.spend += r.cost_usd;
        if (r.called) l.calls++;
        by.set(r.artifact, l);
      }
      return Promise.resolve([...by.values()]);
    },
    deviceCalls: (device, kind, since) =>
      Promise.resolve(usage.filter((r) => r.device === device && r.kind === kind && r.called && r.at >= since).length),
    logUsage: (row) => {
      usage.push({ ...row, at: clock().toISOString() });
      return Promise.resolve();
    },
    recentUsage: (n) => Promise.resolve([...usage].reverse().slice(0, n)),
  };
  return { store, control, usage };
}
