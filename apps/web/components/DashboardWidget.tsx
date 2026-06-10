"use client";
import dynamic from "next/dynamic";
import type { AggregateRow, Meta, RecordEnvelope, Widget } from "@/lib/types";

// recharts is client-only — load the chart pieces without SSR.
const MetricChart = dynamic(() => import("./MetricChart").then((m) => m.MetricChart), { ssr: false });
const BarMini = dynamic(() => import("./BarMini").then((m) => m.BarMini), { ssr: false });

export interface WidgetResult {
  rows?: AggregateRow[];
  records?: RecordEnvelope[];
  error?: string;
}

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000) return v.toLocaleString();
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
function label(s: string | null): string {
  if (!s) return "—";
  return s.length > 14 ? `${s.slice(0, 13)}…` : s;
}
function cellText(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" && "name" in x ? String((x as { name: unknown }).name) : String(x))).join(", ");
  if (typeof v === "object") return "name" in (v as object) ? String((v as { name: unknown }).name) : JSON.stringify(v);
  return String(v);
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-24 items-center justify-center text-xs text-neutral-400">{children}</div>;
}

/** Render one widget from its server-computed result. Read-only. */
export function DashboardWidget({ widget, meta, result }: { widget: Widget; meta: Meta; result?: WidgetResult }) {
  if (result?.error) return <Empty>Couldn’t load: {result.error}</Empty>;

  if (widget.type === "kpi") {
    return <div className="py-2 text-3xl font-semibold tabular-nums text-neutral-900">{fmtNum(result?.rows?.[0]?.value ?? 0)}</div>;
  }

  if (widget.type === "line") {
    const data = (result?.rows ?? []).map((r) => ({ date: label(r.groupValue), v: r.value }));
    return data.length ? <div className="h-40"><MetricChart data={data} /></div> : <Empty>No data</Empty>;
  }

  if (widget.type === "bar") {
    const data = (result?.rows ?? []).map((r) => ({ label: label(r.groupValue), value: r.value }));
    return data.length ? <div className="h-40"><BarMini data={data} /></div> : <Empty>No data</Empty>;
  }

  // table
  const records = result?.records ?? [];
  const fieldById = new Map(meta.fields.map((f) => [f.fieldId, f]));
  const cols =
    widget.fieldIds && widget.fieldIds.length
      ? widget.fieldIds
      : meta.fields.filter((f) => f.tableId === widget.tableId).slice(0, 4).map((f) => f.fieldId);
  if (!records.length) return <Empty>No rows</Empty>;
  return (
    <div className="max-h-44 overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-400">
            {cols.map((c) => (
              <th key={c} className="border-b border-surface-border px-2 py-1 font-medium">{fieldById.get(c)?.name ?? c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.slice(0, 8).map((rec) => (
            <tr key={rec.id} className="border-b border-surface-border/60">
              {cols.map((c) => (
                <td key={c} className="truncate px-2 py-1 text-neutral-700">{cellText(rec.fields[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
