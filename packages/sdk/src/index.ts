/**
 * @gridbase/sdk — typed client for the @gridbase/api HTTP data API.
 *
 * Records are addressed by stable field ID (the wire contract). The client works
 * both in Node (HTTPS + Bearer) and inside a Cloudflare Worker (via a service
 * binding's `fetch`).
 */
import { GridDataClient, type GridClientConfig } from "./grid.js";
import type { DataRecord, FieldSet, WriteRecord } from "./types.js";

export { GridDataClient } from "./grid.js";
export type { GridClientConfig, Fetcher, DataListOptions } from "./grid.js";
export { recordIdFromFormula } from "./formula.js";
export {
  GridApiError,
  type DataRecord,
  type FieldSet,
  type ListOptions,
  type SortSpec,
  type WriteRecord,
} from "./types.js";

import type { DataListOptions } from "./grid.js";

/** The data-access surface the client satisfies. */
export interface IDataClient {
  list<F = FieldSet>(tableId: string, options?: DataListOptions): Promise<DataRecord<F>[]>;
  create<F = FieldSet>(tableId: string, records: WriteRecord<F>[], options?: { typecast?: boolean }): Promise<DataRecord<F>[]>;
  update<F = FieldSet>(tableId: string, records: WriteRecord<F>[], options?: { typecast?: boolean }): Promise<DataRecord<F>[]>;
  remove(tableId: string, ids: string[]): Promise<string[]>;
}

export interface MakeDataClientConfig {
  grid: GridClientConfig;
}

/** Construct the grid data client. */
export function makeDataClient(config: MakeDataClientConfig): IDataClient {
  return new GridDataClient(config.grid);
}

/** Minimal shape of a Cloudflare service binding — structurally satisfied by the
 *  CF `Fetcher` type, without depending on @cloudflare/workers-types (the SDK
 *  also runs in Node). */
export interface ServiceBinding {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/** A Worker env that carries a grid-api service binding (+ optional secret). */
export interface WorkerDataEnv {
  /** Service binding to the @gridbase/api worker. */
  GRID_API: ServiceBinding;
  GRID_API_SECRET?: string;
}

/**
 * Build the data client for a Worker from its env — talks to the grid API over
 * the service binding. One-liner for in-Worker consumers.
 */
export function workerDataClient(env: WorkerDataEnv): IDataClient {
  return makeDataClient({
    grid: { fetcher: (u, i) => env.GRID_API.fetch(u, i), secret: env.GRID_API_SECRET },
  });
}
