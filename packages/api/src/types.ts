/** Runtime registry types, loaded from the meta_* tables (schema-as-data). */

export type FieldType =
  | "text" | "longtext" | "number" | "date" | "datetime"
  | "select" | "multiselect" | "checkbox" | "url" | "email" | "json"
  | "formula" | "link" | "lookup" | "rollup";

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

/** Rollup: aggregate `target` across the record(s) linked via the `via` link
 *  field. `count` ignores `target` (counts linked rows); sum/avg/min/max read
 *  the numeric `target` column. */
export interface RollupSpec {
  via: string;
  target?: string;
  agg: "count" | "sum" | "avg" | "min" | "max";
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
  rollup?: RollupSpec;
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
  /** When `fieldId` is a link (or lookup) field, names the sub-field in the
   *  linked table to compare on; defaults to the linked table's primary field. */
  linkedFieldId?: string;
  op: "is" | "isNot" | "isEmpty" | "isNotEmpty" | "contains" | "gt" | "lt" | "before" | "after" | "anyOf";
  value?: unknown;
}

/** A one-level-deep AND/OR group; contains only leaf conditions. */
export interface FilterGroup {
  conjunction: "and" | "or";
  conditions: FilterCondition[];
}

/** True when an item in a FilterSpec is a group (has nested conditions) rather
 *  than a leaf condition (which carries an `op`). */
export function isFilterGroup(item: FilterCondition | FilterGroup): item is FilterGroup {
  return Array.isArray((item as FilterGroup).conditions);
}

export interface FilterSpec {
  conjunction: "and" | "or";
  /** Top-level items: leaf conditions and/or one-level groups. Old flat specs
   *  (conditions only) remain valid. */
  conditions: Array<FilterCondition | FilterGroup>;
}

export interface ViewConfig {
  fields?: Array<{ fieldId: string; width?: number }>;
  filters?: FilterSpec;
  /** `linkedFieldId` sorts by a sub-field of the linked table (see FilterCondition). */
  sorts?: Array<{ fieldId: string; linkedFieldId?: string; direction?: "asc" | "desc" }>;
  groupBy?: string;
  kanban?: { stackFieldId: string; maxPreviewFields?: number };
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
