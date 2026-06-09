import "server-only";
import { cache } from "react";
import type { ListResult, Meta, RecordEnvelope } from "../types";

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
  sort?: Array<{ fieldId: string; direction?: "asc" | "desc" }>;
  pageSize?: number;
  offset?: string;
}

export function listRecords(tableId: string, params: ListParams = {}): Promise<ListResult> {
  const q = new URLSearchParams();
  if (params.fields?.length) q.set("fields", params.fields.join(","));
  if (params.sort?.length) q.set("sort", params.sort.map((s) => `${s.fieldId}:${s.direction ?? "asc"}`).join(","));
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
