/** Mirror of the grid-api /v1 wire shapes (kept in sync with workers/grid-api/src/types.ts). */

export type FieldType =
  | "text" | "longtext" | "number" | "date" | "datetime"
  | "select" | "multiselect" | "checkbox" | "url" | "email" | "json"
  | "formula" | "link" | "lookup";

export interface SelectChoice {
  id?: string;
  name: string;
  color?: string;
}

export interface FieldOptions {
  choices?: SelectChoice[];
  formula?: unknown;
  timezone?: string;
  join?: string;
  self?: string;
  other?: string;
  linkedTableId?: string;
  relation?: string;
}

export interface FieldMeta {
  fieldId: string;
  tableId: string;
  name: string;
  type: FieldType;
  options: FieldOptions | null;
  isComputed: boolean;
  isPrimary: boolean;
  position: number;
}

export interface TableMeta {
  tableId: string;
  name: string;
  slug: string;
  primaryFieldId: string;
  position: number;
  sourceKind: string;
}

export interface FilterCondition {
  fieldId: string;
  /** When `fieldId` is a link/lookup field, the sub-field of the linked table to
   *  compare on; defaults to the linked table's primary field. */
  linkedFieldId?: string;
  op: "is" | "isNot" | "isEmpty" | "isNotEmpty" | "contains" | "gt" | "lt" | "before" | "after" | "anyOf";
  value?: unknown;
}

/** A one-level-deep AND/OR group; contains only leaf conditions. */
export interface FilterGroup {
  conjunction: "and" | "or";
  conditions: FilterCondition[];
}

export type FilterItem = FilterCondition | FilterGroup;

/** True when a filter item is a group rather than a leaf condition. */
export function isFilterGroup(item: FilterItem): item is FilterGroup {
  return Array.isArray((item as FilterGroup).conditions);
}

export interface ViewConfig {
  fields?: Array<{ fieldId: string; width?: number }>;
  filters?: {
    conjunction: "and" | "or";
    conditions: FilterItem[];
  };
  sorts?: Array<{ fieldId: string; linkedFieldId?: string; direction?: "asc" | "desc" }>;
  groupBy?: string;
  kanban?: { stackFieldId: string; maxPreviewFields?: number };
  calendar?: { dateFieldId: string };
  form?: { title?: string; fieldIds: string[]; redirectMessage?: string };
  dashboard?: { dateFieldId: string; metricFieldIds: string[] };
  /** Table view: freeze the header row (default true) + N leading columns (default 1). */
  freezeHeader?: boolean;
  frozen?: number;
}

export interface ViewMeta {
  viewId: string;
  tableId: string;
  name: string;
  type: "table" | "kanban" | "calendar" | "form" | "detail" | "dashboard";
  position: number;
  isHidden: boolean;
  config: ViewConfig;
}

export interface Meta {
  tables: TableMeta[];
  fields: FieldMeta[];
  views: ViewMeta[];
  dashboards: DashboardMeta[];
}

// ---- dashboards (the report composer) -------------------------------------

export type AggFn = "count" | "sum" | "avg" | "min" | "max";
export type DateBucket = "day" | "week" | "month" | "year";
export type WidgetType = "kpi" | "line" | "bar" | "table";

export interface Widget {
  widgetId: string;
  type: WidgetType;
  title: string;
  tableId: string;
  metricFieldId?: string;
  agg?: AggFn;
  groupByFieldId?: string;
  bucket?: DateBucket;
  fieldIds?: string[];
  filter?: { conjunction: "and" | "or"; conditions: FilterCondition[] };
}

export interface DashboardMeta {
  dashboardId: string;
  workspaceId: string | null;
  name: string;
  position: number;
  isHidden: boolean;
  config: { widgets: Widget[] };
}

/** One aggregated row from GET /v1/tables/:id/aggregate. */
export interface AggregateRow {
  groupValue: string | null;
  value: number;
}

export interface RecordEnvelope {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

export interface ListResult {
  records: RecordEnvelope[];
  offset?: string;
}

/** Convenience: fields for a table, sorted by position. */
export function fieldsForTable(meta: Meta, tableId: string): FieldMeta[] {
  return meta.fields
    .filter((f) => f.tableId === tableId)
    .sort((a, b) => a.position - b.position);
}

/** Visible fields for a view: honor config.fields order/visibility, else all by position. */
export function visibleFields(meta: Meta, view: ViewMeta): FieldMeta[] {
  const all = fieldsForTable(meta, view.tableId);
  const cfg = view.config.fields;
  if (!cfg || cfg.length === 0) return all;
  const byId = new Map(all.map((f) => [f.fieldId, f]));
  return cfg.map((c) => byId.get(c.fieldId)).filter((f): f is FieldMeta => Boolean(f));
}

/** The first non-hidden view for a table (by position) — the default detail target. */
export function firstViewId(meta: Meta, tableId: string): string | undefined {
  return meta.views
    .filter((v) => v.tableId === tableId && !v.isHidden)
    .sort((a, b) => a.position - b.position)[0]?.viewId;
}

/**
 * tableId → "/t/{tableId}/{firstViewId}" base path, for navigating to a linked
 * record's detail. Computed once per page and threaded to link renderers.
 */
export function linkTargets(meta: Meta): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of meta.tables) {
    const v = firstViewId(meta, t.tableId);
    if (v) out[t.tableId] = `/t/${t.tableId}/${v}`;
  }
  return out;
}

/** tableId → its primary field id (for rendering linked-record labels in the picker). */
export function linkPrimaries(meta: Meta): Record<string, string> {
  return Object.fromEntries(meta.tables.map((t) => [t.tableId, t.primaryFieldId]));
}
