import {
  GridApiError,
  type DataRecord,
  type FieldSet,
  type ListOptions,
  type WriteRecord,
} from "./types.js";
import { recordIdFromFormula } from "./formula.js";

/** The API accepts at most 10 records per write request; mirror that chunking. */
const WRITE_CHUNK = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A fetch-like: global `fetch` (Node) or a Worker service binding's `fetch`. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface GridClientConfig {
  fetcher: Fetcher;
  /** Base origin for the grid API. For a service binding any absolute URL works
   *  (routing is by binding); for Node pass the real worker URL. */
  origin?: string;
  /** Bearer secret; sent as Authorization on every request. */
  secret?: string;
}

/** ListOptions plus an optional structured filter (preferred over filterByFormula). */
export type DataListOptions = ListOptions & { filter?: object };

/**
 * Client for the @gridbase/api HTTP data API (over D1 or any registered source).
 * Records are addressed by field ID — the stable wire format.
 */
export class GridDataClient {
  private readonly fetcher: Fetcher;
  private readonly origin: string;
  private readonly secret?: string;

  constructor(config: GridClientConfig) {
    if (!config.fetcher) throw new Error("GridDataClient: fetcher is required");
    this.fetcher = config.fetcher;
    this.origin = config.origin ?? "https://grid-api.internal";
    this.secret = config.secret;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetcher(`${this.origin}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.secret ? { Authorization: `Bearer ${this.secret}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GridApiError(`grid-api ${method} ${path} failed: ${res.status}`, res.status, text);
    }
    return res.json();
  }

  async list<F = FieldSet>(tableId: string, options: DataListOptions = {}): Promise<DataRecord<F>[]> {
    // RECORD_ID()='X' → by-id fetch (the only translated formula).
    if (options.filterByFormula) {
      const id = recordIdFromFormula(options.filterByFormula);
      const rec = await this.getById<F>(tableId, id);
      return rec ? [rec] : [];
    }

    const out: DataRecord<F>[] = [];
    let offset: string | undefined;
    do {
      const q = new URLSearchParams();
      if (options.fields?.length) q.set("fields", options.fields.join(","));
      if (options.sort?.length) {
        q.set("sort", options.sort.map((s) => `${s.field}:${s.direction ?? "asc"}`).join(","));
      }
      if (options.filter) q.set("filter", JSON.stringify(options.filter));
      if (options.maxRecords) q.set("maxRecords", String(options.maxRecords));
      if (options.pageSize) q.set("pageSize", String(options.pageSize));
      if (offset) q.set("offset", offset);

      const json = (await this.request("GET", `/v1/tables/${tableId}/records?${q}`)) as {
        records: DataRecord<F>[];
        offset?: string;
      };
      out.push(...json.records);
      offset = json.offset;
      if (options.maxRecords && out.length >= options.maxRecords) return out.slice(0, options.maxRecords);
    } while (offset);
    return out;
  }

  private async getById<F = FieldSet>(tableId: string, id: string): Promise<DataRecord<F> | null> {
    const res = await this.fetcher(`${this.origin}/v1/tables/${tableId}/records/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: this.secret ? { Authorization: `Bearer ${this.secret}` } : {},
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GridApiError(`grid-api GET record failed: ${res.status}`, res.status, text);
    }
    return (await res.json()) as DataRecord<F>;
  }

  async create<F = FieldSet>(
    tableId: string,
    records: WriteRecord<F>[],
    options: { typecast?: boolean } = {},
  ): Promise<DataRecord<F>[]> {
    const out: DataRecord<F>[] = [];
    for (const group of chunk(records, WRITE_CHUNK)) {
      const json = (await this.request("POST", `/v1/tables/${tableId}/records`, {
        records: group.map((r) => ({ fields: r.fields })),
        typecast: options.typecast ?? false,
      })) as { records: DataRecord<F>[] };
      out.push(...json.records);
    }
    return out;
  }

  async update<F = FieldSet>(
    tableId: string,
    records: WriteRecord<F>[],
    options: { typecast?: boolean } = {},
  ): Promise<DataRecord<F>[]> {
    const out: DataRecord<F>[] = [];
    for (const group of chunk(records, WRITE_CHUNK)) {
      const json = (await this.request("PATCH", `/v1/tables/${tableId}/records`, {
        records: group.map((r) => {
          if (!r.id) throw new Error("GridDataClient.update: every record needs an id");
          return { id: r.id, fields: r.fields };
        }),
        typecast: options.typecast ?? false,
      })) as { records: DataRecord<F>[] };
      out.push(...json.records);
    }
    return out;
  }

  async remove(tableId: string, ids: string[]): Promise<string[]> {
    const deleted: string[] = [];
    for (const group of chunk(ids, WRITE_CHUNK)) {
      const q = new URLSearchParams();
      for (const id of group) q.append("records[]", id);
      const json = (await this.request("DELETE", `/v1/tables/${tableId}/records?${q}`)) as {
        records: Array<{ id: string; deleted: boolean }>;
      };
      deleted.push(...json.records.filter((r) => r.deleted).map((r) => r.id));
    }
    return deleted;
  }
}
