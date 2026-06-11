import { buildOrderBy, buildWhere } from "./filter.js";
import { assembleRecord, coerceLookupValue } from "./records.js";
import type {
  FieldMeta,
  FilterSpec,
  RecordEnvelope,
  Registry,
  TableMeta,
  ViewConfig,
} from "./types.js";

export interface ListOpts {
  fields?: string[];
  filters?: FilterSpec;
  sorts?: ViewConfig["sorts"];
  maxRecords?: number;
  pageSize?: number;
  offset?: string;
}

export interface ListResult {
  records: RecordEnvelope[];
  offset?: string;
}

/** A record to write: fields keyed by field ID, optional id for updates. */
export interface WriteInput {
  id?: string;
  fields: Record<string, unknown>;
}

const MAX_PAGE = 100;

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function tableOf(reg: Registry, tableId: string): TableMeta {
  const t = reg.tables.find((x) => x.tableId === tableId);
  if (!t) throw new HttpError(404, `unknown table: ${tableId}`);
  return t;
}

function newRecordId(): string {
  return "rec" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
}

// ---- read-side relation resolution ---------------------------------------

/** rowId → (linkFieldId → opposite-side ids). Resolves ALL link fields (not
 *  just requested ones) so lookups can read their `via` edges. */
async function resolveLinks(
  db: D1Database,
  fields: FieldMeta[],
  rowIds: string[],
): Promise<Map<string, Map<string, string[]>>> {
  const byRow = new Map<string, Map<string, string[]>>();
  if (rowIds.length === 0) return byRow;

  const linkFields = fields.filter((f) => f.type === "link" && f.options?.join);
  const placeholders = rowIds.map(() => "?").join(", ");

  for (const f of linkFields) {
    const { join, self, other } = f.options as { join: string; self: string; other: string };
    const res = await db
      .prepare(`SELECT ${self} AS self_id, ${other} AS other_id FROM ${join} WHERE ${self} IN (${placeholders})`)
      .bind(...rowIds)
      .all<{ self_id: string; other_id: string }>();
    for (const edge of res.results ?? []) {
      let perField = byRow.get(edge.self_id);
      if (!perField) { perField = new Map(); byRow.set(edge.self_id, perField); }
      const arr = perField.get(f.fieldId) ?? [];
      arr.push(edge.other_id);
      perField.set(f.fieldId, arr);
    }
  }
  return byRow;
}

/** rowId → (lookupFieldId → linked target values). Reads the `via` link's edges
 *  (from the link map) then pulls `target` from the linked table. */
async function resolveLookups(
  db: D1Database,
  reg: Registry,
  fields: FieldMeta[],
  linkByRow: Map<string, Map<string, string[]>>,
  rowIds: string[],
  wanted: Set<string> | undefined,
): Promise<Map<string, Map<string, unknown[]>>> {
  const byRow = new Map<string, Map<string, unknown[]>>();
  const lookupFields = fields.filter(
    (f) => f.type === "lookup" && f.options?.lookup && (!wanted || wanted.has(f.fieldId)),
  );
  if (lookupFields.length === 0 || rowIds.length === 0) return byRow;

  for (const lf of lookupFields) {
    const { via, target } = lf.options!.lookup!;
    const viaField = reg.fieldById.get(via);
    const targetField = reg.fieldById.get(target);
    if (!viaField?.options?.linkedTableId || !targetField?.columnName) continue;
    const linkedTable = reg.tables.find((t) => t.tableId === viaField.options!.linkedTableId);
    if (!linkedTable) continue;

    const allIds = new Set<string>();
    for (const rid of rowIds) for (const id of linkByRow.get(rid)?.get(via) ?? []) allIds.add(id);
    if (allIds.size === 0) continue;

    const idArr = [...allIds];
    const ph = idArr.map(() => "?").join(", ");
    const res = await db
      .prepare(`SELECT id, "${targetField.columnName}" AS v FROM ${linkedTable.slug} WHERE id IN (${ph})`)
      .bind(...idArr)
      .all<{ id: string; v: unknown }>();
    const valById = new Map<string, unknown>();
    for (const r of res.results ?? []) valById.set(String(r.id), r.v);

    for (const rid of rowIds) {
      const ids = linkByRow.get(rid)?.get(via) ?? [];
      if (ids.length === 0) continue;
      const vals = ids.map((id) => coerceLookupValue(targetField, valById.get(id)));
      let m = byRow.get(rid);
      if (!m) { m = new Map(); byRow.set(rid, m); }
      m.set(lf.fieldId, vals);
    }
  }
  return byRow;
}

async function assembleRows(
  db: D1Database,
  reg: Registry,
  table: TableMeta,
  fields: FieldMeta[],
  rows: Record<string, unknown>[],
  wanted: Set<string> | undefined,
): Promise<RecordEnvelope[]> {
  const rowIds = rows.map((r) => String(r["id"]));
  const links = await resolveLinks(db, fields, rowIds);
  const lookups = await resolveLookups(db, reg, fields, links, rowIds, wanted);
  return rows.map((row) => {
    const id = String(row["id"]);
    return assembleRecord(table, fields, row, links.get(id) ?? new Map(), lookups.get(id) ?? new Map(), reg, wanted);
  });
}

export async function listRecords(
  db: D1Database,
  reg: Registry,
  tableId: string,
  opts: ListOpts,
): Promise<ListResult> {
  const table = tableOf(reg, tableId);
  const fields = reg.fieldsByTable.get(tableId) ?? [];
  const wanted = opts.fields && opts.fields.length ? new Set(opts.fields) : undefined;

  const where = buildWhere(opts.filters, reg, table.slug);
  const orderBy = buildOrderBy(opts.sorts, reg, table.slug);

  const offset = Math.max(0, Number.parseInt(opts.offset ?? "0", 10) || 0);
  // Clamp to [0, MAX_PAGE]: a negative LIMIT means "no limit" in SQLite, so an
  // unclamped negative pageSize would dump the whole table in one request.
  const requested = Number.isFinite(opts.pageSize) ? (opts.pageSize as number) : MAX_PAGE;
  let limit = Math.max(0, Math.min(requested, MAX_PAGE));
  if (opts.maxRecords && opts.maxRecords > 0 && offset + limit > opts.maxRecords) {
    limit = Math.max(0, opts.maxRecords - offset);
  }

  const sql =
    `SELECT * FROM ${table.slug} ${where.sql} ${orderBy} LIMIT ? OFFSET ?`.replace(/\s+/g, " ").trim();
  const res = await db.prepare(sql).bind(...where.binds, limit, offset).all<Record<string, unknown>>();
  const rows = res.results ?? [];

  const records = await assembleRows(db, reg, table, fields, rows, wanted);
  const more = rows.length === limit && (!opts.maxRecords || offset + limit < opts.maxRecords);
  return more ? { records, offset: String(offset + limit) } : { records };
}

export async function getRecord(
  db: D1Database,
  reg: Registry,
  tableId: string,
  id: string,
): Promise<RecordEnvelope | null> {
  const table = tableOf(reg, tableId);
  const fields = reg.fieldsByTable.get(tableId) ?? [];
  const row = await db.prepare(`SELECT * FROM ${table.slug} WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const [rec] = await assembleRows(db, reg, table, fields, [row], undefined);
  return rec ?? null;
}

// ---- write side -----------------------------------------------------------

/** Coerce an incoming field value into its stored column representation. */
function valueForColumn(field: FieldMeta, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (field.type) {
    case "checkbox": return value ? 1 : null;
    case "number": return typeof value === "number" ? value : Number(value);
    case "multiselect": return JSON.stringify(Array.isArray(value) ? value : [value]);
    default: return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

/** Resolve a link target value to a record id. With typecast, a non-rec string
 *  is treated as the linked table's primary-field value and resolved. */
async function resolveLinkId(
  db: D1Database,
  reg: Registry,
  linkField: FieldMeta,
  value: unknown,
  typecast: boolean,
): Promise<string | null> {
  const id = String(value);
  if (id.startsWith("rec") || !typecast) return id;
  const linkedTable = reg.tables.find((t) => t.tableId === linkField.options?.linkedTableId);
  const primary = linkedTable && reg.fieldById.get(linkedTable.primaryFieldId);
  if (!linkedTable || !primary?.columnName) return id;
  const hit = await db
    .prepare(`SELECT id FROM ${linkedTable.slug} WHERE "${primary.columnName}" = ? LIMIT 1`)
    .bind(id)
    .first<{ id: string }>();
  return hit?.id ?? null;
}

/** Replace the edges for one link field of `rowId` with `targetIds`. */
async function setLinks(db: D1Database, field: FieldMeta, rowId: string, targetIds: string[]): Promise<void> {
  const { join, self, other } = field.options as { join: string; self: string; other: string };
  await db.prepare(`DELETE FROM ${join} WHERE ${self} = ?`).bind(rowId).run();
  for (const t of targetIds) {
    await db.prepare(`INSERT OR IGNORE INTO ${join} (${self}, ${other}) VALUES (?, ?)`).bind(rowId, t).run();
  }
}

/** Apply the stored-column + link-edge writes for one record. Computed/lookup
 *  fields are ignored (not settable). Returns the row id. */
async function writeRecord(
  db: D1Database,
  reg: Registry,
  table: TableMeta,
  fields: FieldMeta[],
  id: string,
  input: Record<string, unknown>,
  isInsert: boolean,
  typecast: boolean,
): Promise<void> {
  const byId = new Map(fields.map((f) => [f.fieldId, f]));
  const cols: string[] = [];
  const vals: unknown[] = [];
  const linkWrites: Array<{ field: FieldMeta; ids: string[] }> = [];

  for (const [fieldId, value] of Object.entries(input)) {
    const field = byId.get(fieldId);
    if (!field) continue;
    if (field.type === "formula" || field.type === "lookup") continue; // not settable
    if (field.type === "link") {
      const raw = Array.isArray(value) ? value : value == null ? [] : [value];
      const ids: string[] = [];
      for (const v of raw) {
        const rid = await resolveLinkId(db, reg, field, v, typecast);
        if (rid) ids.push(rid);
      }
      linkWrites.push({ field, ids });
      continue;
    }
    if (!field.columnName) continue;
    cols.push(`"${field.columnName}"`);
    vals.push(valueForColumn(field, value));
  }

  if (isInsert) {
    const allCols = ["id", ...cols, "updated_at"];
    const placeholders = ["?", ...cols.map(() => "?"), "datetime('now')"];
    await db
      .prepare(`INSERT INTO ${table.slug} (${allCols.join(", ")}) VALUES (${placeholders.join(", ")})`)
      .bind(id, ...vals)
      .run();
  } else if (cols.length > 0) {
    const setClause = [...cols.map((c) => `${c} = ?`), "updated_at = datetime('now')"].join(", ");
    await db.prepare(`UPDATE ${table.slug} SET ${setClause} WHERE id = ?`).bind(...vals, id).run();
  }

  for (const { field, ids } of linkWrites) await setLinks(db, field, id, ids);
}

export async function createRecords(
  db: D1Database,
  reg: Registry,
  tableId: string,
  records: WriteInput[],
  typecast: boolean,
): Promise<RecordEnvelope[]> {
  const table = tableOf(reg, tableId);
  const fields = reg.fieldsByTable.get(tableId) ?? [];
  const ids: string[] = [];
  for (const rec of records) {
    const id = rec.id ?? newRecordId();
    await writeRecord(db, reg, table, fields, id, rec.fields, true, typecast);
    ids.push(id);
  }
  return readByIds(db, reg, table, fields, ids);
}

export async function updateRecords(
  db: D1Database,
  reg: Registry,
  tableId: string,
  records: WriteInput[],
  typecast: boolean,
): Promise<RecordEnvelope[]> {
  const table = tableOf(reg, tableId);
  const fields = reg.fieldsByTable.get(tableId) ?? [];
  const ids: string[] = [];
  for (const rec of records) {
    if (!rec.id) throw new HttpError(400, "update requires record id");
    await writeRecord(db, reg, table, fields, rec.id, rec.fields, false, typecast);
    ids.push(rec.id);
  }
  return readByIds(db, reg, table, fields, ids);
}

export async function deleteRecords(
  db: D1Database,
  reg: Registry,
  tableId: string,
  ids: string[],
): Promise<string[]> {
  const table = tableOf(reg, tableId);
  const fields = reg.fieldsByTable.get(tableId) ?? [];
  const linkFields = fields.filter((f) => f.type === "link" && f.options?.join);
  const deleted: string[] = [];
  for (const id of ids) {
    for (const f of linkFields) {
      const { join, self } = f.options as { join: string; self: string };
      await db.prepare(`DELETE FROM ${join} WHERE ${self} = ?`).bind(id).run();
    }
    const res = await db.prepare(`DELETE FROM ${table.slug} WHERE id = ?`).bind(id).run();
    if (res.meta.changes > 0) deleted.push(id);
  }
  return deleted;
}

/** Re-read a set of ids preserving order, for write responses. */
async function readByIds(
  db: D1Database,
  reg: Registry,
  table: TableMeta,
  fields: FieldMeta[],
  ids: string[],
): Promise<RecordEnvelope[]> {
  if (ids.length === 0) return [];
  const ph = ids.map(() => "?").join(", ");
  const res = await db.prepare(`SELECT * FROM ${table.slug} WHERE id IN (${ph})`).bind(...ids).all<Record<string, unknown>>();
  const rows = res.results ?? [];
  const assembled = await assembleRows(db, reg, table, fields, rows, undefined);
  const byId = new Map(assembled.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is RecordEnvelope => Boolean(r));
}
