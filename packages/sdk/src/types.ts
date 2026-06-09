/**
 * Wire types for the @gridbase/sdk client. Records are addressed by field ID,
 * which is the stable wire contract (survives field renames).
 */

/** Cell values addressed by field ID. */
export type FieldSet = Record<string, unknown>;

export interface DataRecord<F = FieldSet> {
  id: string;
  createdTime: string;
  fields: F;
}

/** A record to create or update. `id` is required for updates only. */
export interface WriteRecord<F = FieldSet> {
  id?: string;
  fields: F;
}

export interface SortSpec {
  field: string;
  direction?: "asc" | "desc";
}

export interface ListOptions {
  /** Field IDs to return. Returning only needed fields keeps payloads small. */
  fields?: string[];
  /**
   * Optional record-id filter, e.g. `RECORD_ID()='recXXXX'` (the only supported
   * formula — anything else throws). Prefer the structured `filter` instead.
   */
  filterByFormula?: string;
  sort?: SortSpec[];
  maxRecords?: number;
  pageSize?: number;
}

/** Error thrown for any non-2xx response from the API. */
export class GridApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "GridApiError";
  }
}
