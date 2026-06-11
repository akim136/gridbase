import type { FieldMeta, FilterCondition, FilterSpec, Registry, ViewConfig } from "./types.js";
import { isFilterGroup } from "./types.js";

export interface SqlFragment {
  sql: string;
  binds: unknown[];
}

/** Resolve the {join,self,other,linkedTableId} + linked-table slug + target
 *  column for traversing a link/lookup field to a sub-field of the linked
 *  table. Returns null when the shape can't be resolved (caller skips). */
function resolveLinkTarget(
  field: FieldMeta,
  linkedFieldId: string | undefined,
  reg: Registry,
): { join: string; self: string; other: string; linkedSlug: string; targetCol: string } | null {
  // A lookup field traverses its own `via` link; a link field traverses itself.
  let linkField = field;
  if (field.type === "lookup") {
    const via = field.options?.lookup?.via;
    const vf = via ? reg.fieldById.get(via) : undefined;
    if (!vf) return null;
    linkField = vf;
  }
  const { join, self, other, linkedTableId } = (linkField.options ?? {}) as {
    join?: string; self?: string; other?: string; linkedTableId?: string;
  };
  if (!join || !self || !other || !linkedTableId) return null;
  const linkedTable = reg.tables.find((t) => t.tableId === linkedTableId);
  if (!linkedTable) return null;

  // Default the sub-field to the linked table's primary; a lookup pins `target`.
  let targetFieldId = linkedFieldId;
  if (field.type === "lookup" && !targetFieldId) targetFieldId = field.options?.lookup?.target;
  if (!targetFieldId) targetFieldId = linkedTable.primaryFieldId;
  const targetField = reg.fieldById.get(targetFieldId);
  if (!targetField?.columnName) return null;

  return { join, self, other, linkedSlug: linkedTable.slug, targetCol: targetField.columnName };
}

/** Comparison clause + binds for `<col> <op> ?` over an already-resolved column,
 *  shared by stored-column and linked-sub-field paths. `dateish` truncates date
 *  ops to the day. Returns null when the op needs a value it doesn't have. */
function compare(col: string, type: FieldMeta["type"], op: FilterCondition["op"], value: unknown): SqlFragment | null {
  const dateish = type === "date" || type === "datetime";
  const val = resolveValue(value);
  const valueOp = op !== "isEmpty" && op !== "isNotEmpty";
  if (valueOp && type !== "checkbox" && (val === undefined || val === null)) return null;
  const cval = type === "checkbox" ? (val ? 1 : 0) : val;

  switch (op) {
    case "is":
      if (type === "checkbox") return { sql: cval ? `${col} = 1` : `(${col} IS NULL OR ${col} = 0)`, binds: [] };
      return { sql: `${col} = ?`, binds: [cval] };
    case "isNot":
      if (type === "checkbox") return { sql: cval ? `(${col} IS NULL OR ${col} = 0)` : `${col} = 1`, binds: [] };
      return { sql: `(${col} IS NULL OR ${col} != ?)`, binds: [cval] };
    case "isEmpty": return { sql: emptyClause(col, type, false), binds: [] };
    case "isNotEmpty": return { sql: emptyClause(col, type, true), binds: [] };
    case "contains": return { sql: `${col} LIKE ?`, binds: [`%${String(cval)}%`] };
    case "gt": return { sql: `${col} > ?`, binds: [cval] };
    case "lt": return { sql: `${col} < ?`, binds: [cval] };
    case "before": return { sql: dateish ? `date(${col}) < date(?)` : `${col} < ?`, binds: [cval] };
    case "after": return { sql: dateish ? `date(${col}) > date(?)` : `${col} > ?`, binds: [cval] };
    case "anyOf": {
      const vals = Array.isArray(cval) ? cval : [cval];
      if (vals.length === 0) return { sql: "0 = 1", binds: [] };
      return { sql: `${col} IN (${vals.map(() => "?").join(", ")})`, binds: vals };
    }
    default: return null;
  }
}

/** Filter on a sub-field of a linked record via a correlated EXISTS that joins
 *  the link's join table to the linked table and compares the target column.
 *  Emptiness is delegated to the link's own EXISTS shape. */
function linkedFieldClause(
  field: FieldMeta,
  cond: FilterCondition,
  tableSlug: string,
  reg: Registry,
): SqlFragment | null {
  const t = resolveLinkTarget(field, cond.linkedFieldId, reg);
  if (!t) return null;
  const linkExists = `SELECT 1 FROM ${t.join} WHERE ${t.join}.${t.self} = ${tableSlug}.id`;
  if (cond.op === "isEmpty") return { sql: `NOT EXISTS (${linkExists})`, binds: [] };
  if (cond.op === "isNotEmpty") return { sql: `EXISTS (${linkExists})`, binds: [] };

  // lt.<targetCol> is a bare column inside the subquery, not table-qualified at
  // the outer level, so compare() gets `lt."col"`.
  const cmp = compare(`lt."${t.targetCol}"`, reg.fieldById.get(cond.linkedFieldId ?? "")?.type ?? "text", cond.op, cond.value);
  if (!cmp) return null;
  const corr =
    `EXISTS (SELECT 1 FROM ${t.join} j JOIN ${t.linkedSlug} lt ON lt.id = j.${t.other} ` +
    `WHERE j.${t.self} = ${tableSlug}.id AND ${cmp.sql})`;
  return { sql: corr, binds: cmp.binds };
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

/** Build the SQL fragment for a single leaf condition (stored column, link
 *  membership, or linked sub-field). Returns null when the condition should be
 *  skipped (unknown field, half-built row, formula). */
function leafClause(
  cond: FilterCondition,
  reg: Registry,
  tableSlug: string,
): SqlFragment | null {
  const field = reg.fieldById.get(cond.fieldId);
  if (!field) return null;

  // Link/lookup + a named sub-field → correlated EXISTS over the linked table.
  // A lookup always traverses to its target even without an explicit linkedFieldId.
  if ((field.type === "link" && cond.linkedFieldId) || field.type === "lookup") {
    return linkedFieldClause(field, cond, tableSlug, reg);
  }
  // Link field with no sub-field → membership / emptiness over the join table.
  if (field.type === "link" && field.options?.join) {
    return linkClause(field, cond, tableSlug);
  }
  if (!field.columnName) return null; // formula → skip
  return compare(`"${field.columnName}"`, field.type, cond.op, cond.value);
}

/**
 * Build a parameterized WHERE clause from a structured filter spec. Stored
 * columns, link fields, and (new) linked sub-fields / lookups are filterable;
 * formula fields are skipped. Top-level items may be leaf conditions or
 * one-level AND/OR groups (Airtable-style); a group's leaf clauses are
 * parenthesized and joined by the group's own conjunction. Returns an empty
 * fragment when there's nothing to filter. Never interpolates values.
 */
export function buildWhere(
  filters: FilterSpec | undefined,
  reg: Registry,
  tableSlug: string,
): SqlFragment {
  if (!filters || filters.conditions.length === 0) return { sql: "", binds: [] };

  const clauses: string[] = [];
  const binds: unknown[] = [];

  for (const item of filters.conditions) {
    if (isFilterGroup(item)) {
      const inner: string[] = [];
      const innerBinds: unknown[] = [];
      for (const cond of item.conditions) {
        const frag = leafClause(cond, reg, tableSlug);
        if (frag) { inner.push(frag.sql); innerBinds.push(...frag.binds); }
      }
      if (inner.length === 0) continue;
      const joiner = item.conjunction === "or" ? " OR " : " AND ";
      clauses.push(`(${inner.join(joiner)})`);
      binds.push(...innerBinds);
      continue;
    }
    const frag = leafClause(item, reg, tableSlug);
    if (frag) { clauses.push(frag.sql); binds.push(...frag.binds); }
  }

  if (clauses.length === 0) return { sql: "", binds: [] };
  const joiner = filters.conjunction === "or" ? " OR " : " AND ";
  return { sql: `WHERE ${clauses.join(joiner)}`, binds };
}

/** Build an ORDER BY clause from view sorts. Stored columns sort directly;
 *  link/lookup fields sort by a correlated scalar subquery over the linked
 *  table's sub-field (default = linked primary). */
export function buildOrderBy(
  sorts: ViewConfig["sorts"],
  reg: Registry,
  tableSlug: string,
): string {
  if (!sorts || sorts.length === 0) return "";
  const parts: string[] = [];
  for (const s of sorts) {
    const field = reg.fieldById.get(s.fieldId);
    if (!field) continue;
    const dir = s.direction === "desc" ? "DESC" : "ASC";
    if ((field.type === "link" && s.linkedFieldId) || field.type === "lookup") {
      const t = resolveLinkTarget(field, s.linkedFieldId, reg);
      if (!t) continue;
      parts.push(
        `(SELECT lt."${t.targetCol}" FROM ${t.join} j JOIN ${t.linkedSlug} lt ON lt.id = j.${t.other} ` +
        `WHERE j.${t.self} = ${tableSlug}.id LIMIT 1) ${dir}`,
      );
      continue;
    }
    if (!field.columnName) continue;
    parts.push(`"${field.columnName}" ${dir}`);
  }
  return parts.length ? `ORDER BY ${parts.join(", ")}` : "";
}
