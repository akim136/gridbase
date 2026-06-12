import { HttpError } from "./repo.js";
import type { FieldMeta, FieldOptions, FieldType, Registry } from "./types.js";

/** Stored (non-computed) types → their SQLite column affinity. Types absent here
 *  are either computed (no column) or not user-creatable (link). */
const STORED_SQL: Partial<Record<FieldType, string>> = {
  text: "TEXT", longtext: "TEXT", url: "TEXT", email: "TEXT", json: "TEXT",
  select: "TEXT", multiselect: "TEXT", date: "TEXT", datetime: "TEXT",
  number: "REAL", checkbox: "INTEGER",
};
const COMPUTED = new Set<FieldType>(["formula", "lookup", "rollup"]);
const CREATABLE = new Set<FieldType>([
  ...(Object.keys(STORED_SQL) as FieldType[]),
  ...COMPUTED,
]); // `link` is intentionally excluded — it needs a join table.

function rand(n: number): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, n);
}

export interface CreateFieldInput {
  name: string;
  type: FieldType;
  options?: FieldOptions | null;
}

/**
 * Create a field on a table. Computed fields (formula/lookup/rollup) only insert
 * a meta_fields row; stored fields also `ALTER TABLE ADD COLUMN` (additive +
 * nullable, so it's safe on a populated table). The physical column name is
 * server-generated, never user input, so it can be interpolated into DDL safely.
 */
export async function createField(
  db: D1Database,
  reg: Registry,
  tableId: string,
  input: CreateFieldInput,
): Promise<FieldMeta> {
  const table = reg.tables.find((t) => t.tableId === tableId);
  if (!table) throw new HttpError(404, `unknown table: ${tableId}`);

  const name = (input.name ?? "").trim();
  if (!name) throw new HttpError(400, "field name is required");
  const type = input.type;
  if (!CREATABLE.has(type)) throw new HttpError(400, `cannot create a field of type "${type}"`);

  let options: FieldOptions | null = input.options ?? null;

  if (type === "rollup") {
    const r = options?.rollup;
    if (!r?.via || !r.agg) throw new HttpError(400, "rollup needs { via, agg }");
    const viaField = reg.fieldById.get(r.via);
    if (!viaField || viaField.type !== "link") throw new HttpError(400, "rollup.via must be a link field on this table");
    if (r.agg !== "count") {
      const tf = r.target ? reg.fieldById.get(r.target) : undefined;
      if (!tf?.columnName) throw new HttpError(400, "rollup needs a stored target field for sum/avg/min/max");
    }
  }
  if ((type === "select" || type === "multiselect") && !options) options = { choices: [] };

  const fields = reg.fieldsByTable.get(tableId) ?? [];
  const position = fields.reduce((m, f) => Math.max(m, f.position), -1) + 1;
  const fieldId = "fld" + rand(14);
  const isComputed = COMPUTED.has(type);
  const columnName = isComputed ? null : "usr_" + rand(12);

  if (columnName) {
    await db.prepare(`ALTER TABLE ${table.slug} ADD COLUMN "${columnName}" ${STORED_SQL[type]}`).run();
  }
  await db
    .prepare(
      `INSERT INTO meta_fields (field_id, table_id, name, type, column_name, position, options, is_computed, is_primary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .bind(fieldId, tableId, name, type, columnName, position, options ? JSON.stringify(options) : null, isComputed ? 1 : 0)
    .run();

  return { fieldId, tableId, name, type, columnName, position, options, isComputed, isPrimary: false };
}

/**
 * Delete a field. Refuses the primary field and any field another computed field
 * still references (so the registry can't be left with dangling specs). Stored
 * fields also drop their column; a deleted field id lingering in a view's
 * config.fields is harmless (visibleFields filters unknown ids).
 */
export async function deleteField(
  db: D1Database,
  reg: Registry,
  tableId: string,
  fieldId: string,
): Promise<boolean> {
  const field = reg.fieldById.get(fieldId);
  if (!field || field.tableId !== tableId) return false;
  if (field.isPrimary) throw new HttpError(400, "cannot delete the primary field");

  const referencedBy = (reg.fieldsByTable.get(tableId) ?? []).find((f) => {
    const o = f.options;
    if (!o) return false;
    return (
      o.rollup?.via === fieldId || o.rollup?.target === fieldId ||
      o.lookup?.via === fieldId || o.lookup?.target === fieldId ||
      (o.formula && JSON.stringify(o.formula).includes(`"${fieldId}"`))
    );
  });
  if (referencedBy) throw new HttpError(409, `"${referencedBy.name}" depends on this field — delete it first`);

  const table = reg.tables.find((t) => t.tableId === tableId);
  await db.prepare(`DELETE FROM meta_fields WHERE field_id = ?`).bind(fieldId).run();
  if (field.columnName && table) {
    // DROP COLUMN can fail if the column is otherwise constrained; the meta row
    // is already gone, so swallow and leave an orphan column rather than 500.
    try { await db.prepare(`ALTER TABLE ${table.slug} DROP COLUMN "${field.columnName}"`).run(); } catch { /* noop */ }
  }
  return true;
}
