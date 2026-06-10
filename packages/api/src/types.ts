/** Runtime registry types, loaded from the meta_* tables (schema-as-data). */

export type FieldType =
  | "text" | "longtext" | "number" | "date" | "datetime"
  | "select" | "multiselect" | "checkbox" | "url" | "email" | "json"
  | "formula" | "link" | "lookup";

export interface SelectChoice {
  id?: string;
  name: string;
  color?: string;
}

/** Declarative formula spec — the shapes that exist in the base. */
export type FormulaSpec =
  | { expr: "sum"; operands: string[] }
  | { expr: "ratio"; numerator: string; denominator: string; zeroDefault: number }
  | { expr: "bucket"; operand: string; thresholds: Array<{ gt: number; label: string }>; default: string };

/** Lookup: pull `target` from the record(s) linked via the `via` link field. */
export interface LookupSpec {
  via: string;
  target: string;
}

export interface LinkOptions {
  join: string;          // join-table name
  self: string;          // this row's endpoint column in the join table
  other: string;         // the linked row's endpoint column
  linkedTableId: string; // target meta_tables.table_id
  relation: "one-to-many" | "many-to-one" | "many-to-many";
}

export interface FieldOptions {
  choices?: SelectChoice[];
  formula?: FormulaSpec;
  lookup?: LookupSpec;
  timezone?: string;
  // link options are flattened here too
  join?: string;
  self?: string;
  other?: string;
  linkedTableId?: string;
  relation?: LinkOptions["relation"];
}

export interface FieldMeta {
  fieldId: string;
  tableId: string;
  name: string;
  type: FieldType;
  columnName: string | null;
  position: number;
  options: FieldOptions | null;
  isComputed: boolean;
  isPrimary: boolean;
}

export interface TableMeta {
  tableId: string;
  workspaceId: string | null;
  name: string;
  slug: string;
  primaryFieldId: string;
  position: number;
  sourceKind: string;
  sourceRef: string | null;
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

export interface FilterCondition {
  fieldId: string;
  op: "is" | "isNot" | "isEmpty" | "isNotEmpty" | "contains" | "gt" | "lt" | "before" | "after" | "anyOf";
  value?: unknown;
}

export interface FilterSpec {
  conjunction: "and" | "or";
  conditions: FilterCondition[];
}

export interface ViewConfig {
  fields?: Array<{ fieldId: string; width?: number }>;
  filters?: FilterSpec;
  sorts?: Array<{ fieldId: string; direction?: "asc" | "desc" }>;
  groupBy?: string;
  kanban?: { stackFieldId: string };
  calendar?: { dateFieldId: string };
  form?: { title?: string; fieldIds: string[]; redirectMessage?: string };
  dashboard?: { dateFieldId: string; metricFieldIds: string[] };
}

export interface Registry {
  tables: TableMeta[];
  fieldsByTable: Map<string, FieldMeta[]>;
  fieldById: Map<string, FieldMeta>;
  views: ViewMeta[];
  dashboards: DashboardMeta[];
}

// ---- dashboards: a workspace-level report composer -------------------------

export type AggFn = "count" | "sum" | "avg" | "min" | "max";
export type DateBucket = "day" | "week" | "month" | "year";

/** A grouped aggregation over one table: e.g. SUM(amount) GROUP BY month(close_date). */
export interface AggregateSpec {
  /** fieldId of a stored column to group by; omit for a single total. */
  groupBy?: string;
  /** fieldId of a number column; required for sum/avg/min/max. */
  metric?: string;
  agg: AggFn;
  /** date bucketing, applied when groupBy is a date/datetime column. */
  bucket?: DateBucket;
  filter?: FilterSpec;
}

export type WidgetType = "kpi" | "line" | "bar" | "table";

export interface Widget {
  widgetId: string;
  type: WidgetType;
  title: string;
  tableId: string;
  metricFieldId?: string;     // kpi/line/bar
  agg?: AggFn;                // kpi/line/bar (default count)
  groupByFieldId?: string;    // line/bar x-axis (date or category)
  bucket?: DateBucket;
  fieldIds?: string[];        // table widget columns
  filter?: FilterSpec;
}

export interface DashboardConfig {
  widgets: Widget[];
}

export interface DashboardMeta {
  dashboardId: string;
  workspaceId: string | null;
  name: string;
  position: number;
  isHidden: boolean;
  config: DashboardConfig;
}

/** Airtable-shaped record envelope (the wire contract the adapter mirrors). */
export interface RecordEnvelope {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}
