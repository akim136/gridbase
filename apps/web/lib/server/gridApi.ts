import "server-only";
import { cache } from "react";
import type { AggregateRow, ListResult, Meta, RecordEnvelope, Widget } from "../types";

/**
 * Server-only client for grid-api. Server Components call this directly (the
 * Bearer secret never reaches the browser). Interactive client mutations go
 * through the BFF proxy at /api/grid/* instead.
 */
const BASE = process.env.GRID_API_URL ?? "http://localhost:8799";
const SECRET = process.env.GRID_API_SECRET ?? "";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(SECRET ? { Authorization: `Bearer ${SECRET}` } : {}),
      ...(init?.headers ?? {}),
    },
    // The grid is a live editor; never serve stale reads.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`grid-api ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// Deduped per request: the layout and the page both need the registry, but it's
// fetched once per render (React cache), not once per call site.
export const getMeta = cache((): Promise<Meta> => call<Meta>("/v1/meta"));

export interface ListParams {
  fields?: string[];
  filter?: object;
  sort?: Array<{ fieldId: string; linkedFieldId?: string; direction?: "asc" | "desc" }>;
  pageSize?: number;
  offset?: string;
}

export function listRecords(tableId: string, params: ListParams = {}): Promise<ListResult> {
  const q = new URLSearchParams();
  if (params.fields?.length) q.set("fields", params.fields.join(","));
  // Sort token: "fieldId[>linkedFieldId]:dir" — `>` selects a linked sub-field.
  if (params.sort?.length) {
    q.set(
      "sort",
      params.sort
        .map((s) => `${s.fieldId}${s.linkedFieldId ? `>${s.linkedFieldId}` : ""}:${s.direction ?? "asc"}`)
        .join(","),
    );
  }
  // Plain JSON; URLSearchParams percent-encodes it (handles UTF-8 + +/&/= safely).
  if (params.filter) q.set("filter", JSON.stringify(params.filter));
  if (params.pageSize) q.set("pageSize", String(params.pageSize));
  if (params.offset) q.set("offset", params.offset);
  const qs = q.toString();
  return call<ListResult>(`/v1/tables/${encodeURIComponent(tableId)}/records${qs ? `?${qs}` : ""}`);
}

export function getRecord(tableId: string, id: string): Promise<RecordEnvelope> {
  return call<RecordEnvelope>(`/v1/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(id)}`);
}

/** Grouped aggregation for a dashboard widget. */
export function getAggregate(
  tableId: string,
  spec: { agg: string; metric?: string; groupBy?: string; bucket?: string; filter?: object },
): Promise<{ rows: AggregateRow[] }> {
  const q = new URLSearchParams({ agg: spec.agg });
  if (spec.metric) q.set("metric", spec.metric);
  if (spec.groupBy) q.set("groupBy", spec.groupBy);
  if (spec.bucket) q.set("bucket", spec.bucket);
  if (spec.filter) q.set("filter", JSON.stringify(spec.filter));
  return call<{ rows: AggregateRow[] }>(`/v1/tables/${encodeURIComponent(tableId)}/aggregate?${q.toString()}`);
}

/** Compute every widget's data server-side (secret stays on the server). Returns a
 *  map widgetId → result, tolerating a single widget's failure (so one bad widget
 *  can't blank the whole dashboard). */
export async function computeWidgets(
  widgets: Widget[],
): Promise<Record<string, { rows?: AggregateRow[]; records?: RecordEnvelope[]; error?: string }>> {
  const entries = await Promise.all(
    widgets.map(async (w) => {
      try {
        if (w.type === "table") {
          const res = await listRecords(w.tableId, { fields: w.fieldIds, filter: w.filter, pageSize: 20 });
          return [w.widgetId, { records: res.records }] as const;
        }
        const { rows } = await getAggregate(w.tableId, {
          agg: w.agg ?? "count",
          metric: w.metricFieldId,
          groupBy: w.groupByFieldId,
          bucket: w.bucket,
          filter: w.filter,
        });
        return [w.widgetId, { rows }] as const;
      } catch (e) {
        return [w.widgetId, { error: e instanceof Error ? e.message : String(e) }] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}
