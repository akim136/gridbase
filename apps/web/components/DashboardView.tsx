"use client";
import dynamic from "next/dynamic";
import { buildDashboard } from "@/lib/dashboard";
import type { Meta, RecordEnvelope, ViewMeta } from "@/lib/types";

// recharts is client-only (it measures the DOM); load it without SSR to avoid a
// 0-size first paint / window access on the server.
const MetricChart = dynamic(() => import("./MetricChart").then((m) => m.MetricChart), { ssr: false });

function fmt(v: number | null): string {
  if (v === null) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** MM-DD slice of an ISO date for compact axis labels. */
function shortDate(d: string): string {
  return d.length >= 10 ? d.slice(5, 10) : d;
}

/** A dashboard of metric cards (current value + WoW delta + trend line) for a table's
 *  numeric/formula fields over its date field. Read-only. */
export function DashboardView({ meta, view, records }: { meta: Meta; view: ViewMeta; records: RecordEnvelope[] }) {
  const { points, metrics } = buildDashboard(meta, view, records);

  if (records.length === 0 || metrics.length === 0) {
    return <div className="text-sm text-neutral-500">No metrics to chart yet — this dashboard fills in as rows accrue.</div>;
  }

  return (
    <div className="h-full overflow-auto">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((m) => {
          const data = points.map((p) => ({
            date: shortDate(String(p.date)),
            v: typeof p[m.fieldId] === "number" ? (p[m.fieldId] as number) : null,
          }));
          const d = m.prevDelta;
          const arrow = d === null || d === 0 ? "→" : d > 0 ? "↑" : "↓";
          const color = d === null || d === 0 ? "text-neutral-400" : d > 0 ? "text-green-600" : "text-red-500";
          return (
            <div key={m.fieldId} className="rounded-lg border border-surface-border bg-white p-4">
              <div className="flex items-baseline justify-between">
                <span className="truncate text-sm text-neutral-500">{m.name}</span>
                <span className={`text-xs tabular-nums ${color}`}>
                  {arrow}
                  {d !== null && d !== 0 ? ` ${Math.abs(d)}` : ""}
                </span>
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{fmt(m.current)}</div>
              <div className="mt-3 h-16">
                <MetricChart data={data} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-neutral-400">
        Trends across {records.length} weekly snapshot{records.length === 1 ? "" : "s"}. The earliest week includes the initial data import.
      </p>
    </div>
  );
}
