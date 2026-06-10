/**
 * @gridbase/api — HTTP data API for the metadata-driven, database-backed grid
 * (an open-source Airtable that fronts your own database).
 *
 * Serves the Next.js BFF (apps/web) and the @gridbase/sdk http transport. Binds a
 * D1 database (binding `DB`). Every /v1 route is gated by a Bearer secret
 * (GRID_API_SECRET); /health is open for liveness checks.
 *
 * Routes:
 *   GET    /health
 *   GET    /v1/meta                          → the whole registry (tables/fields/views)
 *   GET    /v1/tables/:tableId/records       → list (fields, sort, filter, paginate)
 *   GET    /v1/tables/:tableId/records/:id   → single record
 *   POST   /v1/tables/:tableId/records       → create
 *   PATCH  /v1/tables/:tableId/records       → update
 *   DELETE /v1/tables/:tableId/records       → delete (?records[]=…)
 *   POST   /v1/views, PATCH/DELETE /v1/views/:id → manage views
 */
import { aggregate } from "./aggregate.js";
import { createDashboard, deleteDashboard, updateDashboard } from "./dashboards.js";
import { loadRegistry } from "./meta.js";
import {
  createRecords,
  deleteRecords,
  getRecord,
  HttpError,
  listRecords,
  type ListOpts,
  updateRecords,
  type WriteInput,
} from "./repo.js";
import { createView, deleteView, updateView } from "./views.js";
import type { AggregateSpec, DashboardConfig, FilterSpec, Registry, ViewConfig } from "./types.js";

export interface Env {
  DB: D1Database;
  GRID_API_SECRET?: string;
  /** Local-dev escape hatch: "1" allows /v1 without a secret. Set only in
   *  .dev.vars (never deployed). In production a missing secret fails closed. */
  GRID_DEV_OPEN?: string;
}

function authorized(request: Request, env: Env): boolean {
  // Fail closed when no secret is configured (a missing required secret must not
  // silently ship an open endpoint). GRID_DEV_OPEN=1 opts into open local dev.
  if (!env.GRID_API_SECRET) return env.GRID_DEV_OPEN === "1";
  return request.headers.get("Authorization") === `Bearer ${env.GRID_API_SECRET}`;
}

const MAX_FILTER_CONDITIONS = 50;
const MAX_ANYOF_VALUES = 500;
const MAX_WRITE_BATCH = 50;

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

/** Serialize the registry into the UI-facing /v1/meta shape. */
function metaResponse(reg: Registry) {
  const fields = [...reg.fieldById.values()].map((f) => ({
    fieldId: f.fieldId,
    tableId: f.tableId,
    name: f.name,
    type: f.type,
    options: f.options,
    isComputed: f.isComputed,
    isPrimary: f.isPrimary,
    position: f.position,
  }));
  return {
    tables: reg.tables.map((t) => ({
      tableId: t.tableId,
      name: t.name,
      slug: t.slug,
      primaryFieldId: t.primaryFieldId,
      position: t.position,
      sourceKind: t.sourceKind,
    })),
    fields,
    views: reg.views,
    dashboards: reg.dashboards,
  };
}

/** Parse aggregate query params (groupBy/metric/agg/bucket/filter) into a spec. */
function parseAggregateSpec(url: URL): AggregateSpec {
  const spec: AggregateSpec = { agg: (url.searchParams.get("agg") ?? "count") as AggregateSpec["agg"] };
  const groupBy = url.searchParams.get("groupBy");
  if (groupBy) spec.groupBy = groupBy;
  const metric = url.searchParams.get("metric");
  if (metric) spec.metric = metric;
  const bucket = url.searchParams.get("bucket");
  if (bucket) spec.bucket = bucket as AggregateSpec["bucket"];
  const filter = url.searchParams.get("filter");
  if (filter) {
    let parsed: FilterSpec;
    try {
      parsed = JSON.parse(filter) as FilterSpec;
    } catch {
      throw new HttpError(400, "invalid filter param (expected JSON)");
    }
    spec.filter = assertFilterBounds(parsed);
  }
  return spec;
}

/** Bound a filter so one request can't build a pathologically large query. */
function assertFilterBounds(parsed: FilterSpec): FilterSpec {
  const conditions = parsed.conditions ?? [];
  if (conditions.length > MAX_FILTER_CONDITIONS) {
    throw new HttpError(400, `too many filter conditions (max ${MAX_FILTER_CONDITIONS})`);
  }
  for (const c of conditions) {
    if (Array.isArray(c.value) && c.value.length > MAX_ANYOF_VALUES) {
      throw new HttpError(400, `too many values in a condition (max ${MAX_ANYOF_VALUES})`);
    }
  }
  return parsed;
}

/** Parse list query params into ListOpts. filter is base64-encoded JSON. */
function parseListOpts(url: URL): ListOpts {
  const opts: ListOpts = {};
  const fields = url.searchParams.get("fields");
  if (fields) opts.fields = fields.split(",").filter(Boolean);

  const sort = url.searchParams.get("sort");
  if (sort) {
    opts.sorts = sort.split(",").filter(Boolean).map((s) => {
      const [fieldId, dir] = s.split(":");
      return { fieldId: fieldId!, direction: dir === "desc" ? "desc" : "asc" };
    });
  }

  const filter = url.searchParams.get("filter");
  if (filter) {
    // searchParams already percent-decoded this; it's plain JSON.
    let parsed: FilterSpec;
    try {
      parsed = JSON.parse(filter) as FilterSpec;
    } catch {
      throw new HttpError(400, "invalid filter param (expected JSON)");
    }
    opts.filters = assertFilterBounds(parsed);
  }

  const maxRecords = url.searchParams.get("maxRecords");
  if (maxRecords) opts.maxRecords = Number.parseInt(maxRecords, 10);
  const pageSize = url.searchParams.get("pageSize");
  if (pageSize) opts.pageSize = Number.parseInt(pageSize, 10);
  const offset = url.searchParams.get("offset");
  if (offset) opts.offset = offset;

  return opts;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "GET" && pathname === "/health") {
      return json({ status: "ok" });
    }

    if (!pathname.startsWith("/v1/")) {
      return new Response("not found", { status: 404 });
    }
    // Surface a missing secret loudly rather than as a generic 401.
    if (!env.GRID_API_SECRET && env.GRID_DEV_OPEN !== "1") {
      return json({ error: "grid-api misconfigured: GRID_API_SECRET not set" }, 503);
    }
    if (!authorized(request, env)) {
      return json({ error: "unauthorized" }, 401);
    }

    try {
      const reg = await loadRegistry(env.DB);

      if (request.method === "GET" && pathname === "/v1/meta") {
        return json(metaResponse(reg));
      }

      // /v1/views  (create)  and  /v1/views/:viewId  (update/delete)
      if (request.method === "POST" && pathname === "/v1/views") {
        const body = (await request.json().catch(() => null)) as
          | { tableId?: string; name?: string; type?: string; config?: ViewConfig }
          | null;
        if (!body?.tableId || !body.name || !body.type) {
          return json({ error: "expected { tableId, name, type, config? }" }, 400);
        }
        const view = await createView(env.DB, reg, {
          tableId: body.tableId, name: body.name, type: body.type, config: body.config,
        });
        return json(view);
      }
      const vm = pathname.match(/^\/v1\/views\/([^/]+)$/);
      if (vm) {
        const viewId = decodeURIComponent(vm[1]!);
        if (request.method === "PATCH") {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const view = await updateView(env.DB, viewId, body);
          return json(view);
        }
        if (request.method === "DELETE") {
          const ok = await deleteView(env.DB, viewId);
          return ok ? json({ deleted: true, id: viewId }) : json({ error: "not found" }, 404);
        }
        return json({ error: "method not allowed" }, 405);
      }

      // /v1/dashboards  (create)  and  /v1/dashboards/:dashboardId  (update/delete)
      if (request.method === "POST" && pathname === "/v1/dashboards") {
        const body = (await request.json().catch(() => null)) as
          | { name?: string; workspaceId?: string | null; config?: DashboardConfig }
          | null;
        if (!body?.name) return json({ error: "expected { name, config? }" }, 400);
        const dash = await createDashboard(env.DB, reg, { name: body.name, workspaceId: body.workspaceId, config: body.config });
        return json(dash);
      }
      const dm = pathname.match(/^\/v1\/dashboards\/([^/]+)$/);
      if (dm) {
        const dashboardId = decodeURIComponent(dm[1]!);
        if (request.method === "PATCH") {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const dash = await updateDashboard(env.DB, reg, dashboardId, body);
          return json(dash);
        }
        if (request.method === "DELETE") {
          const ok = await deleteDashboard(env.DB, dashboardId);
          return ok ? json({ deleted: true, id: dashboardId }) : json({ error: "not found" }, 404);
        }
        return json({ error: "method not allowed" }, 405);
      }

      // /v1/tables/:tableId/aggregate  → grouped aggregation for dashboard widgets
      const am = pathname.match(/^\/v1\/tables\/([^/]+)\/aggregate$/);
      if (am && request.method === "GET") {
        const rows = await aggregate(env.DB, reg, decodeURIComponent(am[1]!), parseAggregateSpec(url));
        return json({ rows });
      }

      // /v1/tables/:tableId/records  and  /v1/tables/:tableId/records/:id
      const m = pathname.match(/^\/v1\/tables\/([^/]+)\/records(?:\/([^/]+))?$/);
      if (m) {
        const tableId = decodeURIComponent(m[1]!);
        const recordId = m[2] ? decodeURIComponent(m[2]) : undefined;

        if (request.method === "GET" && recordId) {
          const rec = await getRecord(env.DB, reg, tableId, recordId);
          return rec ? json(rec) : json({ error: "not found" }, 404);
        }
        if (request.method === "GET") {
          const result = await listRecords(env.DB, reg, tableId, parseListOpts(url));
          return json(result);
        }
        if (request.method === "POST" || request.method === "PATCH") {
          const body = (await request.json().catch(() => null)) as
            | { records?: WriteInput[]; typecast?: boolean }
            | null;
          const records = body?.records ?? [];
          if (!Array.isArray(records) || records.length === 0) {
            return json({ error: "expected a non-empty records array" }, 400);
          }
          if (records.length > MAX_WRITE_BATCH) {
            return json({ error: `too many records (max ${MAX_WRITE_BATCH})` }, 400);
          }
          const typecast = body?.typecast === true;
          const out = request.method === "POST"
            ? await createRecords(env.DB, reg, tableId, records, typecast)
            : await updateRecords(env.DB, reg, tableId, records, typecast);
          return json({ records: out });
        }
        if (request.method === "DELETE") {
          const ids = url.searchParams.getAll("records[]");
          if (ids.length === 0) return json({ error: "expected records[] ids" }, 400);
          if (ids.length > MAX_WRITE_BATCH) {
            return json({ error: `too many records (max ${MAX_WRITE_BATCH})` }, 400);
          }
          const deleted = await deleteRecords(env.DB, reg, tableId, ids);
          return json({ records: deleted.map((id) => ({ id, deleted: true })) });
        }
        return json({ error: "method not allowed" }, 405);
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      // HttpError messages are author-controlled and safe to surface. Anything
      // else (e.g. a D1/SQLite error that may embed SQL/column names) is logged
      // server-side only and returned generically, to avoid info disclosure.
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error("grid-api error", err);
      return json({ error: "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
