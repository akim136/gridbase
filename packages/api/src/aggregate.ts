import { buildWhere } from "./filter.js";
import { HttpError } from "./repo.js";
import { AGG_FNS } from "./types.js";
import type { AggFn, AggregateSpec, Registry } from "./types.js";

/** Aggregation functions (fixed allowlist — never interpolate user input). */
const AGGS: Set<AggFn> = new Set(AGG_FNS);
/** Date-bucket → strftime format (fixed allowlist; the key is validated, the
 *  value is a constant, so nothing user-controlled reaches the SQL). */
const BUCKET_FMT: Record<string, string> = {
  day: "%Y-%m-%d",
  week: "%Y-W%W",
  month: "%Y-%m",
  year: "%Y",
};

export interface AggregateRow {
  groupValue: string | null;
  value: number;
}

/**
 * Build a parameterized aggregation query. Every SQL fragment comes from either
 * a fixed allowlist (the agg fn, the bucket format) or a registry-validated
 * identifier (table slug, column name — already checked by `assertIdent` at load).
 * Filter values are bound via `buildWhere`. No user input is interpolated.
 */
export function buildAggregate(spec: AggregateSpec, reg: Registry, tableId: string): { sql: string; binds: unknown[] } {
  const table = reg.tables.find((t) => t.tableId === tableId);
  if (!table) throw new HttpError(404, `unknown table: ${tableId}`);

  const agg = spec.agg;
  if (!AGGS.has(agg)) throw new HttpError(400, `invalid agg: ${spec.agg}`);

  // Metric column. COUNT works without one (COUNT(*)); sum/avg/min/max require a number.
  let metricCol: string | null = null;
  if (agg === "count") {
    if (spec.metric) {
      const mf = reg.fieldById.get(spec.metric);
      if (mf && mf.tableId === tableId && mf.columnName) metricCol = `"${mf.columnName}"`;
    }
  } else {
    const mf = reg.fieldById.get(spec.metric ?? "");
    if (!mf || mf.tableId !== tableId || !mf.columnName || mf.type !== "number") {
      throw new HttpError(400, `${agg} needs a numeric metric field`);
    }
    metricCol = `"${mf.columnName}"`;
  }
  const valueExpr = agg === "count" ? (metricCol ? `COUNT(${metricCol})` : "COUNT(*)") : `${agg.toUpperCase()}(${metricCol})`;

  // Group expression (optional). A date column can be bucketed via strftime.
  let groupExpr: string | null = null;
  if (spec.groupBy) {
    const gf = reg.fieldById.get(spec.groupBy);
    if (!gf || gf.tableId !== tableId || !gf.columnName) throw new HttpError(400, "invalid groupBy field");
    const col = `"${gf.columnName}"`;
    if (spec.bucket) {
      const fmt = BUCKET_FMT[spec.bucket];
      if (!fmt) throw new HttpError(400, `invalid bucket: ${spec.bucket}`);
      groupExpr = `strftime('${fmt}', ${col})`;
    } else {
      groupExpr = col;
    }
  }

  const where = buildWhere(spec.filter, reg, table.slug);
  const select = groupExpr ? `${groupExpr} AS g, ${valueExpr} AS v` : `${valueExpr} AS v`;
  const grouping = groupExpr ? ` GROUP BY ${groupExpr} ORDER BY ${groupExpr}` : "";
  const sql = `SELECT ${select} FROM ${table.slug} ${where.sql}${grouping}`.replace(/\s+/g, " ").trim();
  return { sql, binds: where.binds };
}

export async function aggregate(db: D1Database, reg: Registry, tableId: string, spec: AggregateSpec): Promise<AggregateRow[]> {
  const { sql, binds } = buildAggregate(spec, reg, tableId);
  const res = await db.prepare(sql).bind(...binds).all<{ g?: unknown; v: unknown }>();
  return (res.results ?? []).map((r) => ({
    groupValue: "g" in r && r.g != null ? String(r.g) : null,
    value: typeof r.v === "number" ? r.v : Number(r.v ?? 0),
  }));
}
