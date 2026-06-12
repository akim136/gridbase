import Link from "next/link";
import { fieldsForTable, type Meta, type RecordEnvelope, type ViewMeta } from "@/lib/types";

const DAY = 86_400_000;
const LABEL_W = 220; // fixed label column so track percentages line up

/** Parse a stored date/datetime cell to a UTC ms timestamp, or null. */
function toMs(v: unknown): number | null {
  if (v == null || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/**
 * Gantt: one row per record with a horizontal bar from the start-date field to
 * the end-date field (a missing end renders a 1-day bar). The time domain spans
 * all bars with a little padding; the header marks month boundaries. Rows sort
 * by start date; records without a start date are listed beneath the chart.
 */
export function GanttView({
  meta,
  view,
  records,
}: {
  meta: Meta;
  view: ViewMeta;
  records: RecordEnvelope[];
}) {
  const startId = view.config.gantt?.startFieldId;
  const endId = view.config.gantt?.endFieldId;
  const fields = fieldsForTable(meta, view.tableId);
  const startField = fields.find((f) => f.fieldId === startId);
  const primaryId = meta.tables.find((t) => t.tableId === view.tableId)?.primaryFieldId;

  if (!startField || !startId) {
    return <p className="text-neutral-500">This Gantt view has no start-date field configured. Use the Gantt menu to pick one.</p>;
  }

  const bars = records
    .map((rec) => {
      const start = toMs(rec.fields[startId]);
      if (start == null) return null;
      const endRaw = endId ? toMs(rec.fields[endId]) : null;
      const end = endRaw != null && endRaw > start ? endRaw : start + DAY;
      return { rec, start, end };
    })
    .filter((b): b is { rec: RecordEnvelope; start: number; end: number } => b !== null)
    .sort((a, b) => a.start - b.start);
  const undated = records.filter((rec) => toMs(rec.fields[startId]) == null);

  if (bars.length === 0) {
    return <p className="py-8 text-center text-neutral-400">No records have a value in “{startField.name}”.</p>;
  }

  // Domain with ~3% padding either side so edge bars aren't flush.
  const rawMin = bars[0]!.start;
  const rawMax = Math.max(...bars.map((b) => b.end));
  const pad = Math.max(DAY, (rawMax - rawMin) * 0.03);
  const min = rawMin - pad;
  const max = rawMax + pad;
  const span = max - min;
  const pct = (t: number) => ((t - min) / span) * 100;

  // Month boundaries inside the domain → header ticks + grid lines.
  const ticks: Array<{ t: number; label: string }> = [];
  const d = new Date(min);
  d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() + 1);
  while (d.getTime() < max) {
    ticks.push({ t: d.getTime(), label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }

  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);

  return (
    <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
      {/* time axis */}
      <div className="relative flex border-b border-surface-border bg-surface-muted text-[10px] text-neutral-400">
        <div className="flex-shrink-0 px-3 py-1.5 font-medium" style={{ width: LABEL_W }}>
          {bars.length} records
        </div>
        <div className="relative h-6 flex-1">
          {ticks.map((tk) => (
            <span key={tk.t} className="absolute top-1.5 -translate-x-1/2" style={{ left: `${pct(tk.t)}%` }}>
              {tk.label}
            </span>
          ))}
        </div>
      </div>
      {bars.map(({ rec, start, end }) => {
        const title = primaryId != null ? rec.fields[primaryId] : undefined;
        return (
          <div key={rec.id} className="group flex items-center border-b border-surface-border/60 last:border-0 hover:bg-surface-muted/40">
            <div className="flex-shrink-0 truncate px-3 py-1.5 text-xs" style={{ width: LABEL_W }}>
              <Link href={`/t/${view.tableId}/${view.viewId}/${rec.id}`} className="text-neutral-800 hover:text-blue-600 hover:underline">
                {title != null && title !== "" ? String(title) : "(untitled)"}
              </Link>
            </div>
            <div className="relative h-6 flex-1">
              {ticks.map((tk) => (
                <span key={tk.t} className="absolute inset-y-0 border-l border-surface-border/50" style={{ left: `${pct(tk.t)}%` }} />
              ))}
              <span
                title={`${fmt(start)} → ${fmt(end)}`}
                className="absolute top-1 h-4 rounded bg-blue-500/80 group-hover:bg-blue-600"
                style={{ left: `${pct(start)}%`, width: `${Math.max(pct(end) - pct(start), 0.5)}%` }}
              />
            </div>
          </div>
        );
      })}
      {undated.length > 0 ? (
        <p className="px-3 py-2 text-xs text-neutral-400">
          {undated.length} record{undated.length === 1 ? "" : "s"} without “{startField.name}” not shown.
        </p>
      ) : null}
    </div>
  );
}
