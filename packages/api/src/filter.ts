import type { FieldMeta, FilterCondition, FilterSpec, ViewConfig } from "./types.js";

export interface SqlFragment {
  sql: string;
  binds: unknown[];
}

/** Resolve a relative date value ({relative:'daysAgo', n}) to an ISO date. */
function resolveValue(value: unknown): unknown {
  if (value && typeof value === "object" && "relative" in (value as Record<string, unknown>)) {
    const v = value as { relative: string; n: number };
    if (v.relative === "daysAgo") {
      return new Date(Date.now() - v.n * 86_400_000).toISOString().slice(0, 10);
    }
    if (v.relative === "today") return new Date().toISOString().slice(0, 10);
  }
  return value;
}

/** Empty-cell test that respects column storage: numeric/checkbox cells are
 *  empty only when NULL (a stored 0 is a real value, and `col = ''` would
 *  numeric-coerce and wrongly match it). Text-like cells are empty when NULL
 *  or "". */
function emptyClause(col: string, type: FieldMeta["type"], negate: boolean): string {
  const numeric = type === "number" || type === "checkbox";
  if (numeric) return negate ? `${col} IS NOT NULL` : `${col} IS NULL`;
  return negate ? `(${col} IS NOT NULL AND ${col} != '')` : `(${col} IS NULL OR ${col} = '')`;
}

/** Filter on a link field via a correlated EXISTS over its join table. Supports
 *  emptiness (no linked rows) and membership (linked to specific ids). */
function linkClause(field: FieldMeta, cond: FilterCondition, tableSlug: string): SqlFragment | null {
  const { join, self, other } = field.options as { join: string; self: string; other: string };
  const corr = `SELECT 1 FROM ${join} WHERE ${join}.${self} = ${tableSlug}.id`;
  switch (cond.op) {
    case "isEmpty": return { sql: `NOT EXISTS (${corr})`, binds: [] };
    case "isNotEmpty": return { sql: `EXISTS (${corr})`, binds: [] };
    case "is": case "anyOf": {
      const vals = Array.isArray(cond.value) ? cond.value : cond.value == null ? [] : [cond.value];
      if (vals.length === 0) return null; // no value yet → skip (don't hide everything)
      const ph = vals.map(() => "?").join(", ");
      return { sql: `EXISTS (${corr} AND ${join}.${other} IN (${ph}))`, binds: vals };
    }
    case "isNot": {
      const vals = Array.isArray(cond.value) ? cond.value : cond.value == null ? [] : [cond.value];
      if (vals.length === 0) return null;
      const ph = vals.map(() => "?").join(", ");
      return { sql: `NOT EXISTS (${corr} AND ${join}.${other} IN (${ph}))`, binds: vals };
    }
    default: return null; // gt/lt/contains/etc. don't apply to links
  }
}

/**
 * Build a parameterized WHERE clause from a structured filter spec. Stored
 * columns and link fields are filterable; formula/lookup fields are skipped.
 * Returns an empty fragment when there's nothing to filter. Never interpolates
 * values — all go through bind params.
 */
export function buildWhere(
  filters: FilterSpec | undefined,
  fieldById: Map<string, FieldMeta>,
  tableSlug: string,
): SqlFragment {
  if (!filters || filters.conditions.length === 0) return { sql: "", binds: [] };

  const clauses: string[] = [];
  const binds: unknown[] = [];

  for (const cond of filters.conditions) {
    const field = fieldById.get(cond.fieldId);
    if (!field) continue;
    if (field.type === "link" && field.options?.join) {
      const frag = linkClause(field, cond, tableSlug);
      if (frag) { clauses.push(frag.sql); binds.push(...frag.binds); }
      continue;
    }
    if (!field.columnName) continue; // formula / lookup → skip
    const col = `"${field.columnName}"`;
    let val = resolveValue(cond.value);
    // Skip value-requiring ops with no value yet (e.g. a half-built filter row in
    // the UI) — otherwise we'd bind undefined and error. Checkbox coerces nullish
    // to "unchecked", a valid filter, so it's exempt.
    const valueOp = cond.op !== "isEmpty" && cond.op !== "isNotEmpty";
    if (valueOp && field.type !== "checkbox" && (val === undefined || val === null)) continue;
    // Checkboxes are stored as 1 / NULL (false is never stored), so normalize.
    if (field.type === "checkbox") val = val ? 1 : 0;
    // before/after are date semantics; truncate both sides to the day so a
    // datetime column ('2026-06-09T09:00') compares correctly against a date.
    const dateish = field.type === "date" || field.type === "datetime";

    switch (cond.op) {
      case "is":
        if (field.type === "checkbox") {
          clauses.push(val ? `${col} = 1` : `(${col} IS NULL OR ${col} = 0)`);
        } else {
          clauses.push(`${col} = ?`);
          binds.push(val);
        }
        break;
      case "isNot":
        if (field.type === "checkbox") {
          clauses.push(val ? `(${col} IS NULL OR ${col} = 0)` : `${col} = 1`);
        } else {
          clauses.push(`(${col} IS NULL OR ${col} != ?)`);
          binds.push(val);
        }
        break;
      case "isEmpty": clauses.push(emptyClause(col, field.type, false)); break;
      case "isNotEmpty": clauses.push(emptyClause(col, field.type, true)); break;
      case "contains": clauses.push(`${col} LIKE ?`); binds.push(`%${String(val)}%`); break;
      case "gt": clauses.push(`${col} > ?`); binds.push(val); break;
      case "lt": clauses.push(`${col} < ?`); binds.push(val); break;
      case "before":
        clauses.push(dateish ? `date(${col}) < date(?)` : `${col} < ?`);
        binds.push(val);
        break;
      case "after":
        clauses.push(dateish ? `date(${col}) > date(?)` : `${col} > ?`);
        binds.push(val);
        break;
      case "anyOf": {
        const vals = Array.isArray(val) ? val : [val];
        if (vals.length === 0) { clauses.push("0 = 1"); break; }
        clauses.push(`${col} IN (${vals.map(() => "?").join(", ")})`);
        binds.push(...vals);
        break;
      }
    }
  }

  if (clauses.length === 0) return { sql: "", binds: [] };
  const joiner = filters.conjunction === "or" ? " OR " : " AND ";
  return { sql: `WHERE ${clauses.join(joiner)}`, binds };
}

/** Build an ORDER BY clause from view sorts. Only stored columns are sortable. */
export function buildOrderBy(
  sorts: ViewConfig["sorts"],
  fieldById: Map<string, FieldMeta>,
): string {
  if (!sorts || sorts.length === 0) return "";
  const parts: string[] = [];
  for (const s of sorts) {
    const field = fieldById.get(s.fieldId);
    if (!field || !field.columnName) continue;
    const dir = s.direction === "desc" ? "DESC" : "ASC";
    parts.push(`"${field.columnName}" ${dir}`);
  }
  return parts.length ? `ORDER BY ${parts.join(", ")}` : "";
}
