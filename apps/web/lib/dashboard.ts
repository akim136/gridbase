/** Pure transform for the dashboard view: records → per-metric time series + summary.
 *  No React/recharts import so it's unit-testable. */

import { fieldsForTable, type Meta, type RecordEnvelope, type ViewMeta } from "./types";

export interface MetricSeries {
  fieldId: string;
  name: string;
  /** Latest value (last row by date), or null if none. */
  current: number | null;
  /** current − previous row's value (week-over-week), or null if <2 rows. */
  prevDelta: number | null;
}

export interface DashboardData {
  /** Chart points sorted ascending by date: { date, [metricFieldId]: number }. */
  points: Array<Record<string, string | number>>;
  metrics: MetricSeries[];
  dateFieldId: string | null;
}

/** Coerce a cell value to a finite number, else null. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Resolve the date axis + metric fields: explicit view config, else inferred from the table
 *  (first date/datetime field; all number + formula fields). */
export function resolveDashboardConfig(meta: Meta, view: ViewMeta): { dateFieldId: string | null; metricFieldIds: string[] } {
  const fields = fieldsForTable(meta, view.tableId);
  const cfg = view.config.dashboard;

  const dateFieldId =
    cfg?.dateFieldId ?? fields.find((f) => f.type === "date" || f.type === "datetime")?.fieldId ?? null;

  const metricFieldIds =
    cfg?.metricFieldIds && cfg.metricFieldIds.length > 0
      ? cfg.metricFieldIds
      : fields.filter((f) => f.type === "number" || f.type === "formula").map((f) => f.fieldId);

  return { dateFieldId, metricFieldIds };
}

export function buildDashboard(meta: Meta, view: ViewMeta, records: RecordEnvelope[]): DashboardData {
  const { dateFieldId, metricFieldIds } = resolveDashboardConfig(meta, view);
  const nameById = new Map(fieldsForTable(meta, view.tableId).map((f) => [f.fieldId, f.name]));

  // Rows in chronological order, keyed by the date field (fallback: createdTime).
  const rows = records
    .map((r) => ({ date: dateFieldId ? String(r.fields[dateFieldId] ?? "") : r.createdTime, fields: r.fields }))
    .filter((r) => r.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const points = rows.map((r) => {
    const p: Record<string, string | number> = { date: r.date };
    for (const fid of metricFieldIds) {
      const n = num(r.fields[fid]);
      if (n !== null) p[fid] = n;
    }
    return p;
  });

  const metrics: MetricSeries[] = metricFieldIds.map((fid) => {
    // Use the last two RECORDED values (skip nulls) so a not-yet-computed latest
    // cell doesn't blank out the card while earlier weeks have data.
    const recorded = rows.map((r) => num(r.fields[fid])).filter((v): v is number => v !== null);
    const n = recorded.length;
    const current = n > 0 ? recorded[n - 1]! : null;
    const prev = n >= 2 ? recorded[n - 2]! : null;
    const prevDelta = current !== null && prev !== null ? current - prev : null;
    return { fieldId: fid, name: nameById.get(fid) ?? fid, current, prevDelta };
  });

  return { points, metrics, dateFieldId };
}
