"use client";
import { useState } from "react";
import type { AggFn, DateBucket, Meta, Widget, WidgetType } from "@/lib/types";

const TYPES: Array<{ type: WidgetType; label: string }> = [
  { type: "kpi", label: "KPI number" },
  { type: "bar", label: "Bar chart" },
  { type: "line", label: "Line chart" },
  { type: "table", label: "Table" },
];
const AGGS: AggFn[] = ["count", "sum", "avg", "min", "max"];
const BUCKETS: DateBucket[] = ["day", "week", "month", "year"];
const NON_COLUMN = new Set(["formula", "lookup", "link"]);

function newId(): string {
  return "wgt" + Math.random().toString(36).slice(2, 12);
}

const selectCls = "w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none";

/** Modal to add/edit one widget: type → table → metric/agg → group-by/bucket → title. */
export function WidgetBuilder({ meta, initial, onSave, onClose }: { meta: Meta; initial: Widget | null; onSave: (w: Widget) => void; onClose: () => void }) {
  const [w, setW] = useState<Widget>(
    initial ?? { widgetId: newId(), type: "kpi", title: "", tableId: meta.tables[0]?.tableId ?? "", agg: "count" },
  );
  const set = (patch: Partial<Widget>) => setW((s) => ({ ...s, ...patch }));

  const tableFields = meta.fields.filter((f) => f.tableId === w.tableId);
  const numberFields = tableFields.filter((f) => f.type === "number");
  const groupable = tableFields.filter((f) => !NON_COLUMN.has(f.type));
  const groupField = tableFields.find((f) => f.fieldId === w.groupByFieldId);
  const groupIsDate = groupField?.type === "date" || groupField?.type === "datetime";

  const isChart = w.type === "line" || w.type === "bar";
  const needsMetric = (w.type === "kpi" || isChart) && w.agg !== "count";
  const valid =
    Boolean(w.tableId) &&
    (!needsMetric || Boolean(w.metricFieldId)) &&
    (!isChart || Boolean(w.groupByFieldId)); // charts need an x-axis

  function save() {
    const title = w.title.trim() || defaultTitle(w, meta);
    onSave({ ...w, title });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-6" onClick={onClose}>
      <div className="mt-12 max-h-[80vh] w-full max-w-md overflow-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-semibold text-neutral-900">{initial ? "Edit widget" : "Add widget"}</h2>

        <label className="mb-1 block text-xs font-medium text-neutral-500">Type</label>
        <div className="mb-3 grid grid-cols-4 gap-1">
          {TYPES.map((t) => (
            <button
              key={t.type}
              onClick={() => set({ type: t.type, ...(t.type === "kpi" || t.type === "table" ? { groupByFieldId: undefined, bucket: undefined } : {}) })}
              className={`rounded-md border px-2 py-1.5 text-xs ${w.type === t.type ? "border-blue-500 bg-blue-50 text-blue-700" : "border-neutral-300 text-neutral-600 hover:bg-surface-muted"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <Row label="Table">
            <select className={selectCls} value={w.tableId} onChange={(e) => set({ tableId: e.target.value, metricFieldId: undefined, groupByFieldId: undefined })}>
              {meta.tables.map((t) => <option key={t.tableId} value={t.tableId}>{t.name}</option>)}
            </select>
          </Row>

          {w.type !== "table" ? (
            <Row label="Measure">
              <select className={selectCls} value={w.agg ?? "count"} onChange={(e) => set({ agg: e.target.value as AggFn })}>
                {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Row>
          ) : null}

          {needsMetric ? (
            <Row label="Of field">
              <select className={selectCls} value={w.metricFieldId ?? ""} onChange={(e) => set({ metricFieldId: e.target.value || undefined })}>
                <option value="">— pick a number field —</option>
                {numberFields.map((f) => <option key={f.fieldId} value={f.fieldId}>{f.name}</option>)}
              </select>
            </Row>
          ) : null}

          {isChart ? (
            <Row label="Group by">
              <select className={selectCls} value={w.groupByFieldId ?? ""} onChange={(e) => set({ groupByFieldId: e.target.value || undefined, bucket: undefined })}>
                <option value="">— pick a field —</option>
                {groupable.map((f) => <option key={f.fieldId} value={f.fieldId}>{f.name}</option>)}
              </select>
            </Row>
          ) : null}

          {isChart && groupIsDate ? (
            <Row label="Bucket">
              <select className={selectCls} value={w.bucket ?? "month"} onChange={(e) => set({ bucket: e.target.value as DateBucket })}>
                {BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Row>
          ) : null}

          <Row label="Title">
            <input className={selectCls} placeholder={defaultTitle(w, meta)} value={w.title} onChange={(e) => set({ title: e.target.value })} />
          </Row>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-surface-muted">Cancel</button>
          <button disabled={!valid} onClick={save} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Save</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[90px_1fr] items-center gap-3">
      <label className="text-sm text-neutral-500">{label}</label>
      {children}
    </div>
  );
}

function defaultTitle(w: Widget, meta: Meta): string {
  const table = meta.tables.find((t) => t.tableId === w.tableId)?.name ?? "records";
  if (w.type === "table") return table;
  const metric = w.agg === "count" ? "count" : `${w.agg} of ${meta.fields.find((f) => f.fieldId === w.metricFieldId)?.name ?? "value"}`;
  const by = w.groupByFieldId ? ` by ${meta.fields.find((f) => f.fieldId === w.groupByFieldId)?.name ?? ""}` : "";
  return `${table}: ${metric}${by}`;
}
