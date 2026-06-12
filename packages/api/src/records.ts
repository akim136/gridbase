import type { FieldMeta, FormulaSpec, RecordEnvelope, Registry } from "./types.js";

/**
 * Convert a stored D1 column value into its Airtable-shaped field value, or
 * return undefined to OMIT the field (Airtable omits empty cells from responses,
 * and the adapter relies on that parity).
 */
function coerceStored(field: FieldMeta, raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  switch (field.type) {
    case "number":
      return typeof raw === "number" ? raw : Number(raw);
    case "checkbox":
      return raw === 1 || raw === true ? true : undefined; // false ⇒ omit, like Airtable
    case "multiselect": {
      const arr = typeof raw === "string" ? safeArray(raw) : raw;
      return Array.isArray(arr) && arr.length ? arr : undefined;
    }
    case "text": case "longtext": case "select": case "url": case "email":
    case "json": case "date": case "datetime":
    default:
      return raw === "" ? undefined : raw;
  }
}

function safeArray(raw: string): unknown[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Coerce a single linked value for a lookup. Unlike coerceStored, checkbox
 * lookups keep `false` (Airtable returns e.g. [true]/[false], and consumers
 * test `value[0] === true`).
 */
function coerceLookupValue(targetField: FieldMeta, raw: unknown): unknown {
  if (targetField.type === "checkbox") return raw === 1 || raw === true;
  if (targetField.type === "number") return typeof raw === "number" ? raw : Number(raw);
  return raw;
}

/** Evaluate a declarative formula over a row. Operands may be other formulas
 *  (resolved recursively, e.g. Tiers depends on TOTAL). */
function numFor(fieldId: string, row: Record<string, unknown>, reg: Registry): number {
  const f = reg.fieldById.get(fieldId);
  if (!f) return 0;
  if (f.type === "formula" && f.options?.formula) {
    const v = evalFormula(f.options.formula, row, reg);
    return typeof v === "number" ? v : Number(v) || 0;
  }
  if (!f.columnName) return 0;
  const v = row[f.columnName];
  return typeof v === "number" ? v : Number(v) || 0;
}

export function evalFormula(spec: FormulaSpec, row: Record<string, unknown>, reg: Registry): number | string {
  switch (spec.expr) {
    case "sum":
      return spec.operands.reduce((acc, id) => acc + numFor(id, row, reg), 0);
    case "ratio": {
      const denom = numFor(spec.denominator, row, reg);
      return denom > 0 ? numFor(spec.numerator, row, reg) / denom : spec.zeroDefault;
    }
    case "bucket": {
      const n = numFor(spec.operand, row, reg);
      for (const t of spec.thresholds) if (n > t.gt) return t.label;
      return spec.default;
    }
    default: {
      // Exhaustiveness guard: an unhandled expr is a registry/code mismatch, not
      // a silent 0 — surface it.
      const _never: never = spec;
      throw new Error(`unknown formula expr: ${JSON.stringify(_never)}`);
    }
  }
}

/** Reduce a rollup's gathered numbers to a scalar. `count` is the value count;
 *  empty input is 0 for every agg (no linked rows ⇒ 0). */
export function aggregateRollup(agg: "count" | "sum" | "avg" | "min" | "max", nums: number[]): number {
  if (agg === "count") return nums.length;
  if (nums.length === 0) return 0;
  switch (agg) {
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "avg": return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min": return Math.min(...nums);
    case "max": return Math.max(...nums);
    default: {
      const _never: never = agg;
      throw new Error(`unknown rollup agg: ${JSON.stringify(_never)}`);
    }
  }
}

/**
 * Assemble one Airtable-shaped record from a raw entity row plus resolved link
 * arrays (fieldId → linked ids) and lookup arrays (fieldId → linked values).
 * `wanted` limits which fields are emitted (undefined = all). Computed (formula),
 * lookup, and link fields are injected.
 */
export function assembleRecord(
  table: { primaryFieldId: string },
  fields: FieldMeta[],
  row: Record<string, unknown>,
  links: Map<string, string[]>,
  lookups: Map<string, unknown[]>,
  rollups: Map<string, number>,
  reg: Registry,
  wanted?: Set<string>,
): RecordEnvelope {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (wanted && !wanted.has(field.fieldId)) continue;
    if (field.type === "link") {
      const ids = links.get(field.fieldId);
      if (ids && ids.length) out[field.fieldId] = ids;
      continue;
    }
    if (field.type === "lookup") {
      const vals = lookups.get(field.fieldId);
      if (vals && vals.length) out[field.fieldId] = vals;
      continue;
    }
    if (field.type === "rollup") {
      const n = rollups.get(field.fieldId);
      if (n !== undefined) out[field.fieldId] = n;
      continue;
    }
    if (field.type === "formula") {
      const spec = field.options?.formula;
      if (spec) out[field.fieldId] = evalFormula(spec, row, reg);
      continue;
    }
    const v = coerceStored(field, field.columnName ? row[field.columnName] : undefined);
    if (v !== undefined) out[field.fieldId] = v;
  }
  return {
    id: String(row["id"]),
    createdTime: String(row["created_at"] ?? ""),
    fields: out,
  };
}

export { coerceLookupValue };
