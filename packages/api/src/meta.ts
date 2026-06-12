import type {
  DashboardConfig,
  DashboardMeta,
  FieldMeta,
  Registry,
  TableMeta,
  ViewConfig,
  ViewMeta,
} from "./types.js";

interface MetaTableRow {
  table_id: string;
  workspace_id: string | null;
  name: string;
  slug: string;
  primary_field_id: string;
  position: number;
  source_kind: string;
  source_ref: string | null;
}

interface MetaFieldRow {
  field_id: string;
  table_id: string;
  name: string;
  type: string;
  column_name: string | null;
  position: number;
  options: string | null;
  is_computed: number;
  is_primary: number;
}

interface MetaViewRow {
  view_id: string;
  table_id: string;
  name: string;
  type: string;
  position: number;
  is_hidden: number;
  config: string;
}

function parseJSON<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * SQL identifiers (table slugs, column names, join endpoints) are interpolated
 * into queries, not bound, so they must be trusted bare identifiers. Reject
 * anything else at load time — a malformed/hostile registry row fails loudly
 * here instead of becoming an injection sink downstream.
 */
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
function assertIdent(value: string | null | undefined, what: string): void {
  if (value != null && value !== "" && !IDENT.test(value)) {
    throw new Error(`grid registry: unsafe identifier for ${what}: ${JSON.stringify(value)}`);
  }
}

type Schema = Pick<Registry, "tables" | "fieldsByTable" | "fieldById">;

/**
 * Schema (tables + fields) is cached per isolate — it rarely changes (only DDL/
 * migrations do). Views are NOT cached here; they change often (the view editor
 * writes them) so loadRegistry reads them fresh each call, which keeps every
 * isolate consistent after a view write without cross-isolate invalidation.
 */
let schemaCache: Schema | null = null;

export function invalidateRegistry(): void {
  schemaCache = null;
}

export async function loadRegistry(db: D1Database): Promise<Registry> {
  const [schema, views, dashboards] = await Promise.all([loadSchema(db), loadViews(db), loadDashboards(db)]);
  return { ...schema, views, dashboards };
}

export interface MetaDashboardRow {
  dashboard_id: string;
  workspace_id: string | null;
  name: string;
  position: number;
  is_hidden: number;
  config: string;
}

/** Canonical meta_dashboards row → DashboardMeta mapper (also used by the CRUD
 *  module, so both read paths normalize a malformed config the same way). */
export function rowToDashboard(r: MetaDashboardRow): DashboardMeta {
  const parsed = parseJSON<DashboardConfig>(r.config, { widgets: [] });
  return {
    dashboardId: r.dashboard_id,
    workspaceId: r.workspace_id,
    name: r.name,
    position: r.position,
    isHidden: r.is_hidden === 1,
    config: Array.isArray(parsed.widgets) ? parsed : { widgets: [] },
  };
}

async function loadDashboards(db: D1Database): Promise<DashboardMeta[]> {
  try {
    const res = await db.prepare("SELECT * FROM meta_dashboards ORDER BY position, name").all<MetaDashboardRow>();
    return (res.results ?? []).map(rowToDashboard);
  } catch (err) {
    // Dashboards are optional: on a DB whose 0004 migration hasn't run yet
    // (deploy-before-migrate), don't take every /v1 route down with them.
    if (String(err).includes("no such table")) return [];
    throw err;
  }
}

async function loadViews(db: D1Database): Promise<ViewMeta[]> {
  const res = await db.prepare("SELECT * FROM meta_views ORDER BY position, name").all<MetaViewRow>();
  return (res.results ?? []).map((r) => ({
    viewId: r.view_id,
    tableId: r.table_id,
    name: r.name,
    type: r.type as ViewMeta["type"],
    position: r.position,
    isHidden: r.is_hidden === 1,
    config: parseJSON<ViewConfig>(r.config, {}),
  }));
}

async function loadSchema(db: D1Database): Promise<Schema> {
  if (schemaCache) return schemaCache;

  const [tablesRes, fieldsRes] = await Promise.all([
    db.prepare("SELECT * FROM meta_tables ORDER BY position, name").all<MetaTableRow>(),
    db.prepare("SELECT * FROM meta_fields ORDER BY position").all<MetaFieldRow>(),
  ]);

  const tables: TableMeta[] = (tablesRes.results ?? []).map((r) => {
    assertIdent(r.slug, `table ${r.table_id} slug`);
    return {
      tableId: r.table_id,
      workspaceId: r.workspace_id,
      name: r.name,
      slug: r.slug,
      primaryFieldId: r.primary_field_id,
      position: r.position,
      sourceKind: r.source_kind,
      sourceRef: r.source_ref,
    };
  });

  const fieldsByTable = new Map<string, FieldMeta[]>();
  const fieldById = new Map<string, FieldMeta>();
  for (const r of fieldsRes.results ?? []) {
    assertIdent(r.column_name, `field ${r.field_id} column_name`);
    const options = parseJSON<FieldMeta["options"]>(r.options, null);
    if (options) {
      assertIdent(options.join, `field ${r.field_id} link join`);
      assertIdent(options.self, `field ${r.field_id} link self`);
      assertIdent(options.other, `field ${r.field_id} link other`);
    }
    const field: FieldMeta = {
      fieldId: r.field_id,
      tableId: r.table_id,
      name: r.name,
      type: r.type as FieldMeta["type"],
      columnName: r.column_name,
      position: r.position,
      options,
      isComputed: r.is_computed === 1,
      isPrimary: r.is_primary === 1,
    };
    fieldById.set(field.fieldId, field);
    const arr = fieldsByTable.get(field.tableId) ?? [];
    arr.push(field);
    fieldsByTable.set(field.tableId, arr);
  }

  schemaCache = { tables, fieldsByTable, fieldById };
  return schemaCache;
}
