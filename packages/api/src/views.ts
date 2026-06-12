import { HttpError } from "./repo.js";
import type { Registry, ViewConfig, ViewMeta } from "./types.js";

const VIEW_TYPES = new Set(["table", "kanban", "calendar", "form", "detail", "dashboard", "gallery", "gantt"]);

function newViewId(): string {
  return "viw" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
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

function rowToView(r: MetaViewRow): ViewMeta {
  let config: ViewConfig = {};
  try {
    config = JSON.parse(r.config) as ViewConfig;
  } catch {
    /* keep {} */
  }
  return {
    viewId: r.view_id,
    tableId: r.table_id,
    name: r.name,
    type: r.type as ViewMeta["type"],
    position: r.position,
    isHidden: r.is_hidden === 1,
    config,
  };
}

async function readView(db: D1Database, viewId: string): Promise<ViewMeta | null> {
  const row = await db.prepare("SELECT * FROM meta_views WHERE view_id = ?").bind(viewId).first<MetaViewRow>();
  return row ? rowToView(row) : null;
}

export interface CreateViewInput {
  tableId: string;
  name: string;
  type: string;
  config?: ViewConfig;
}

export async function createView(db: D1Database, reg: Registry, input: CreateViewInput): Promise<ViewMeta> {
  if (!reg.tables.some((t) => t.tableId === input.tableId)) {
    throw new HttpError(400, `unknown table: ${input.tableId}`);
  }
  if (!input.type || !VIEW_TYPES.has(input.type)) throw new HttpError(400, `invalid view type: ${input.type}`);
  if (!input.name || typeof input.name !== "string") throw new HttpError(400, "view name is required");

  const viewId = newViewId();
  // Append after the table's existing views.
  const maxPos = reg.views.filter((v) => v.tableId === input.tableId).reduce((m, v) => Math.max(m, v.position), -1);
  await db
    .prepare(
      "INSERT INTO meta_views (view_id, table_id, name, type, position, is_hidden, config) VALUES (?, ?, ?, ?, ?, 0, ?)",
    )
    .bind(viewId, input.tableId, input.name, input.type, maxPos + 1, JSON.stringify(input.config ?? {}))
    .run();
  const view = await readView(db, viewId);
  if (!view) throw new HttpError(500, "view create failed");
  return view;
}

export interface UpdateViewInput {
  name?: string;
  config?: ViewConfig;
  isHidden?: boolean;
  position?: number;
}

export async function updateView(db: D1Database, viewId: string, input: UpdateViewInput): Promise<ViewMeta> {
  const existing = await readView(db, viewId);
  if (!existing) throw new HttpError(404, `unknown view: ${viewId}`);

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || !input.name) throw new HttpError(400, "name must be a non-empty string");
    sets.push("name = ?");
    binds.push(input.name);
  }
  if (input.config !== undefined) {
    if (typeof input.config !== "object" || input.config === null) throw new HttpError(400, "config must be an object");
    sets.push("config = ?");
    binds.push(JSON.stringify(input.config));
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

  await db.prepare(`UPDATE meta_views SET ${sets.join(", ")} WHERE view_id = ?`).bind(...binds, viewId).run();
  const view = await readView(db, viewId);
  if (!view) throw new HttpError(500, "view update failed");
  return view;
}

export async function deleteView(db: D1Database, viewId: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM meta_views WHERE view_id = ?").bind(viewId).run();
  return res.meta.changes > 0;
}
