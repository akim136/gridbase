import { type MetaDashboardRow, rowToDashboard } from "./meta.js";
import { HttpError } from "./repo.js";
import { AGG_FNS, isFilterGroup } from "./types.js";
import type { AggFn, DashboardConfig, DashboardMeta, FilterCondition, Registry, Widget } from "./types.js";

const WIDGET_TYPES = new Set<Widget["type"]>(["kpi", "line", "bar", "table"]);
const AGGS = new Set<AggFn>(AGG_FNS);
const MAX_WIDGETS = 50;

function newDashboardId(): string {
  return "dsh" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
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
  if (widgets.length > MAX_WIDGETS) throw new HttpError(400, `too many widgets (max ${MAX_WIDGETS})`);
  const seenIds = new Set<string>();
  for (const w of widgets) {
    // widgetId keys the computed-data map and the React list — require + dedupe.
    if (!w.widgetId || typeof w.widgetId !== "string") throw new HttpError(400, "every widget needs a widgetId");
    if (seenIds.has(w.widgetId)) throw new HttpError(400, `duplicate widgetId: ${w.widgetId}`);
    seenIds.add(w.widgetId);
    if (!WIDGET_TYPES.has(w.type)) throw new HttpError(400, `invalid widget type: ${w.type}`);
    if (!reg.tables.some((t) => t.tableId === w.tableId)) throw new HttpError(400, `widget references unknown table: ${w.tableId}`);
    const inTable = (fid?: string) => !fid || reg.fieldById.get(fid)?.tableId === w.tableId;
    if (!inTable(w.metricFieldId)) throw new HttpError(400, "widget metric field is not in its table");
    if (!inTable(w.groupByFieldId)) throw new HttpError(400, "widget groupBy field is not in its table");
    if (w.agg && !AGGS.has(w.agg)) throw new HttpError(400, `invalid agg: ${w.agg}`);
    for (const fid of w.fieldIds ?? []) if (!inTable(fid)) throw new HttpError(400, "widget field is not in its table");
    // Flatten one level of filter groups to validate every leaf condition's field.
    const leaves: FilterCondition[] = [];
    for (const item of w.filter?.conditions ?? []) {
      if (isFilterGroup(item)) leaves.push(...item.conditions);
      else leaves.push(item);
    }
    for (const c of leaves) if (!inTable(c.fieldId)) throw new HttpError(400, "widget filter field is not in its table");
    // Fail fast on a widget that can't run, mirroring aggregate.ts's query-time
    // rules so a stored widget always renders: non-count aggs need a numeric
    // stored metric; charts need a stored-column x-axis.
    if (w.type !== "table" && (w.agg ?? "count") !== "count") {
      const mf = w.metricFieldId ? reg.fieldById.get(w.metricFieldId) : undefined;
      if (!mf || mf.type !== "number" || !mf.columnName) {
        throw new HttpError(400, `${w.agg} widget needs a numeric metric field`);
      }
    }
    if (w.type === "line" || w.type === "bar") {
      const gf = w.groupByFieldId ? reg.fieldById.get(w.groupByFieldId) : undefined;
      if (!gf?.columnName) throw new HttpError(400, "chart widget needs a stored group-by field");
    }
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
    if (typeof input.position !== "number" || !Number.isFinite(input.position)) {
      throw new HttpError(400, "position must be a number");
    }
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
