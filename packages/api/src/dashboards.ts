import { HttpError } from "./repo.js";
import type { AggFn, DashboardConfig, DashboardMeta, Registry, Widget } from "./types.js";

const WIDGET_TYPES = new Set<Widget["type"]>(["kpi", "line", "bar", "table"]);
const AGGS = new Set<AggFn>(["count", "sum", "avg", "min", "max"]);

function newDashboardId(): string {
  return "dsh" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
}

interface MetaDashboardRow {
  dashboard_id: string;
  workspace_id: string | null;
  name: string;
  position: number;
  is_hidden: number;
  config: string;
}

function rowToDashboard(r: MetaDashboardRow): DashboardMeta {
  let config: DashboardConfig = { widgets: [] };
  try {
    const p = JSON.parse(r.config) as DashboardConfig;
    if (p && Array.isArray(p.widgets)) config = p;
  } catch {
    /* keep default */
  }
  return {
    dashboardId: r.dashboard_id,
    workspaceId: r.workspace_id,
    name: r.name,
    position: r.position,
    isHidden: r.is_hidden === 1,
    config,
  };
}

async function readDashboard(db: D1Database, id: string): Promise<DashboardMeta | null> {
  const row = await db.prepare("SELECT * FROM meta_dashboards WHERE dashboard_id = ?").bind(id).first<MetaDashboardRow>();
  return row ? rowToDashboard(row) : null;
}

/** Validate each widget against the registry — every table + field reference must
 *  exist and belong to the widget's table. (The aggregation endpoint re-validates
 *  at query time too, but failing fast on write keeps bad configs out of storage.) */
function validateConfig(config: DashboardConfig | undefined, reg: Registry): DashboardConfig {
  const widgets = config?.widgets ?? [];
  if (!Array.isArray(widgets)) throw new HttpError(400, "config.widgets must be an array");
  for (const w of widgets) {
    if (!WIDGET_TYPES.has(w.type)) throw new HttpError(400, `invalid widget type: ${w.type}`);
    if (!reg.tables.some((t) => t.tableId === w.tableId)) throw new HttpError(400, `widget references unknown table: ${w.tableId}`);
    const inTable = (fid?: string) => !fid || reg.fieldById.get(fid)?.tableId === w.tableId;
    if (!inTable(w.metricFieldId)) throw new HttpError(400, "widget metric field is not in its table");
    if (!inTable(w.groupByFieldId)) throw new HttpError(400, "widget groupBy field is not in its table");
    if (w.agg && !AGGS.has(w.agg)) throw new HttpError(400, `invalid agg: ${w.agg}`);
    for (const fid of w.fieldIds ?? []) if (!inTable(fid)) throw new HttpError(400, "widget field is not in its table");
    for (const c of w.filter?.conditions ?? []) if (!inTable(c.fieldId)) throw new HttpError(400, "widget filter field is not in its table");
  }
  return { widgets };
}

export interface CreateDashboardInput {
  name: string;
  workspaceId?: string | null;
  config?: DashboardConfig;
}

export async function createDashboard(db: D1Database, reg: Registry, input: CreateDashboardInput): Promise<DashboardMeta> {
  if (!input.name || typeof input.name !== "string") throw new HttpError(400, "dashboard name is required");
  const config = validateConfig(input.config, reg);
  const id = newDashboardId();
  const maxPos = reg.dashboards.reduce((m, d) => Math.max(m, d.position), -1);
  await db
    .prepare("INSERT INTO meta_dashboards (dashboard_id, workspace_id, name, position, is_hidden, config) VALUES (?, ?, ?, ?, 0, ?)")
    .bind(id, input.workspaceId ?? null, input.name, maxPos + 1, JSON.stringify(config))
    .run();
  const d = await readDashboard(db, id);
  if (!d) throw new HttpError(500, "dashboard create failed");
  return d;
}

export interface UpdateDashboardInput {
  name?: string;
  config?: DashboardConfig;
  position?: number;
  isHidden?: boolean;
}

export async function updateDashboard(db: D1Database, reg: Registry, id: string, input: UpdateDashboardInput): Promise<DashboardMeta> {
  const existing = await readDashboard(db, id);
  if (!existing) throw new HttpError(404, `unknown dashboard: ${id}`);

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || !input.name) throw new HttpError(400, "name must be a non-empty string");
    sets.push("name = ?");
    binds.push(input.name);
  }
  if (input.config !== undefined) {
    sets.push("config = ?");
    binds.push(JSON.stringify(validateConfig(input.config, reg)));
  }
  if (input.isHidden !== undefined) {
    sets.push("is_hidden = ?");
    binds.push(input.isHidden ? 1 : 0);
  }
  if (input.position !== undefined) {
    sets.push("position = ?");
    binds.push(input.position);
  }
  if (sets.length === 0) return existing;

  await db.prepare(`UPDATE meta_dashboards SET ${sets.join(", ")} WHERE dashboard_id = ?`).bind(...binds, id).run();
  const d = await readDashboard(db, id);
  if (!d) throw new HttpError(500, "dashboard update failed");
  return d;
}

export async function deleteDashboard(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM meta_dashboards WHERE dashboard_id = ?").bind(id).run();
  return res.meta.changes > 0;
}
