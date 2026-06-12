"use client";
import type { DashboardMeta, ViewConfig, ViewMeta, Widget } from "./types";

/**
 * Browser-side calls to the BFF (/api/grid/* → grid-api /v1/*). The Bearer
 * secret is attached server-side by the BFF, never exposed here.
 */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/grid/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`grid ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const updateViewConfig = (viewId: string, config: ViewConfig) =>
  call<ViewMeta>("PATCH", `views/${viewId}`, { config });

export const renameView = (viewId: string, name: string) =>
  call<ViewMeta>("PATCH", `views/${viewId}`, { name });

export const hideView = (viewId: string, isHidden: boolean) =>
  call<ViewMeta>("PATCH", `views/${viewId}`, { isHidden });

export const createView = (input: { tableId: string; name: string; type: string; config?: ViewConfig }) =>
  call<ViewMeta>("POST", "views", input);

export const deleteView = (viewId: string) => call<{ deleted: boolean }>("DELETE", `views/${viewId}`);

// ---- dashboard mutations --------------------------------------------------

export const createDashboard = (input: { name: string; config?: { widgets: Widget[] } }) =>
  call<DashboardMeta>("POST", "dashboards", input);

export const updateDashboard = (id: string, input: { name?: string; config?: { widgets: Widget[] }; position?: number; isHidden?: boolean }) =>
  call<DashboardMeta>("PATCH", `dashboards/${id}`, input);

export const deleteDashboard = (id: string) => call<{ deleted: boolean }>("DELETE", `dashboards/${id}`);

// ---- record mutations (typecast: true → resolve selects/links given by name) ----

interface RecordResult {
  records: Array<{ id: string; createdTime: string; fields: Record<string, unknown> }>;
}

export const updateRecord = (tableId: string, id: string, fields: Record<string, unknown>) =>
  call<RecordResult>("PATCH", `tables/${tableId}/records`, { records: [{ id, fields }], typecast: true });

export const createRecord = (tableId: string, fields: Record<string, unknown> = {}) =>
  call<RecordResult>("POST", `tables/${tableId}/records`, { records: [{ fields }], typecast: true });

/** Batch-create (≤50 per call — grid-api's MAX_WRITE_BATCH). Used by CSV import. */
export const createRecords = (tableId: string, rows: Array<Record<string, unknown>>) =>
  call<RecordResult>("POST", `tables/${tableId}/records`, { records: rows.map((fields) => ({ fields })), typecast: true });

export const deleteRecord = (tableId: string, id: string) =>
  call<{ records: Array<{ id: string; deleted: boolean }> }>("DELETE", `tables/${tableId}/records?records[]=${encodeURIComponent(id)}`);

/** Batch-delete records, chunked to grid-api's MAX_WRITE_BATCH (50) per call. */
export async function deleteRecords(tableId: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const qs = chunk.map((id) => `records[]=${encodeURIComponent(id)}`).join("&");
    await call<{ records: Array<{ id: string; deleted: boolean }> }>("DELETE", `tables/${tableId}/records?${qs}`);
  }
}

/** List a table's records (id + chosen fields) — used by the linked-record picker. */
export const listRecords = (tableId: string, fields: string[]) =>
  call<RecordResult>("GET", `tables/${tableId}/records?fields=${fields.join(",")}&pageSize=100`);
