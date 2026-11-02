import fs from "node:fs";
import path from "node:path";
import { METRICS_FILE } from "./paths.js";

export interface UsageEvent {
  ts: string;
  tool: string;
  latencyMs: number;
  tokensOut?: number;
  budget?: number;
  results?: number;
  omitted?: number;
  cacheHit?: boolean;
  error?: string;
}

/** Append-only JSONL: easy to ship to any log pipeline later. */
export function record(event: Omit<UsageEvent, "ts">, file = METRICS_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function summarize(file = METRICS_FILE) {
  const events: UsageEvent[] = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const byTool: Record<string, unknown> = {};
  for (const tool of new Set(events.map((e) => e.tool))) {
    const ev = events.filter((e) => e.tool === tool);
    const lat = ev.map((e) => e.latencyMs);
    const withBudget = ev.filter((e) => e.budget && e.tokensOut !== undefined);
    byTool[tool] = {
      calls: ev.length,
      errors: ev.filter((e) => e.error).length,
      latency_ms_p50: percentile(lat, 50),
      latency_ms_p95: percentile(lat, 95),
      avg_tokens_out: withBudget.length
        ? Math.round(withBudget.reduce((s, e) => s + (e.tokensOut ?? 0), 0) / withBudget.length)
        : undefined,
      avg_budget_utilization: withBudget.length
        ? +(withBudget.reduce((s, e) => s + (e.tokensOut ?? 0) / e.budget!, 0) / withBudget.length).toFixed(2)
        : undefined,
      cache_hit_rate: ev.some((e) => e.cacheHit !== undefined)
        ? +(ev.filter((e) => e.cacheHit).length / ev.length).toFixed(2)
        : undefined,
      zero_result_calls: ev.filter((e) => e.results === 0).length,
    };
  }
  return { total_calls: events.length, by_tool: byTool };
}
