"use client";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createField, deleteField, updateViewConfig } from "@/lib/client";
import type { FieldMeta, FieldOptions, FieldType, FilterCondition, FilterGroup, FilterItem, Meta, ViewConfig } from "@/lib/types";
import { fieldsForTable, isFilterGroup } from "@/lib/types";

const OPS_BY_KIND: Record<string, Array<{ op: string; label: string; noValue?: boolean }>> = {
  text: [
    { op: "is", label: "is" }, { op: "isNot", label: "is not" }, { op: "contains", label: "contains" },
    { op: "isEmpty", label: "is empty", noValue: true }, { op: "isNotEmpty", label: "is not empty", noValue: true },
  ],
  number: [
    { op: "is", label: "=" }, { op: "gt", label: ">" }, { op: "lt", label: "<" },
    { op: "isEmpty", label: "is empty", noValue: true }, { op: "isNotEmpty", label: "is not empty", noValue: true },
  ],
  select: [
    { op: "is", label: "is" }, { op: "isNot", label: "is not" },
    { op: "isEmpty", label: "is empty", noValue: true }, { op: "isNotEmpty", label: "is not empty", noValue: true },
  ],
  checkbox: [{ op: "is", label: "is" }],
  date: [
    { op: "before", label: "before" }, { op: "after", label: "after" }, { op: "is", label: "on" },
    { op: "isEmpty", label: "is empty", noValue: true }, { op: "isNotEmpty", label: "is not empty", noValue: true },
  ],
  link: [{ op: "isEmpty", label: "is empty", noValue: true }, { op: "isNotEmpty", label: "is not empty", noValue: true }],
};

function kindOf(f: FieldMeta): string | null {
  switch (f.type) {
    case "text": case "longtext": case "url": case "email": case "multiselect": return "text";
    case "number": return "number";
    case "select": return "select";
    case "checkbox": return "checkbox";
    case "date": case "datetime": return "date";
    case "link": return "link";
    case "lookup": return "lookup";
    default: return null; // formula/json — not filterable
  }
}

/** The linked table's id for a link or lookup field, or undefined. */
function linkedTableIdOf(field: FieldMeta, meta: Meta): string | undefined {
  if (field.type === "link") return field.options?.linkedTableId;
  if (field.type === "lookup") {
    const via = (field.options as { lookup?: { via?: string } } | null)?.lookup?.via;
    const vf = via ? meta.fields.find((f) => f.fieldId === via) : undefined;
    return vf?.options?.linkedTableId;
  }
  return undefined;
}

/** Sub-fields available on the linked table for a link field's sub-field picker. */
function linkedSubFields(field: FieldMeta, meta: Meta): FieldMeta[] {
  const tid = linkedTableIdOf(field, meta);
  if (!tid) return [];
  return fieldsForTable(meta, tid).filter((f) => kindOf(f) !== null && f.type !== "link" && f.type !== "lookup");
}

/** The effective field whose kind/ops/value-input a filter row should use:
 *  the linked sub-field when one is picked on a link, else the field itself. */
function effectiveField(field: FieldMeta, linkedFieldId: string | undefined, meta: Meta): FieldMeta {
  if (field.type === "link" && linkedFieldId) {
    const sub = meta.fields.find((f) => f.fieldId === linkedFieldId);
    if (sub) return sub;
  }
  if (field.type === "lookup") {
    // A lookup compares against its target column; surface the target's kind.
    const target = (field.options as { lookup?: { target?: string } } | null)?.lookup?.target;
    const tf = target ? meta.fields.find((f) => f.fieldId === target) : undefined;
    if (tf) return tf;
  }
  return field;
}

const btn = "rounded-md border border-surface-border px-2.5 py-1 text-xs text-neutral-600 hover:bg-surface-muted";
const panel = "absolute z-40 mt-1 max-h-[70vh] w-[28rem] max-w-[calc(100vw-6rem)] overflow-auto rounded-lg border border-surface-border bg-white p-3 shadow-lg";
const panelSm = "absolute z-40 mt-1 w-72 rounded-lg border border-surface-border bg-white p-3 shadow-lg";

export function ViewToolbar({
  viewId,
  viewType,
  fields,
  config,
  meta,
}: {
  viewId: string;
  viewType: string;
  fields: FieldMeta[];
  config: ViewConfig;
  meta: Meta;
}) {
  const router = useRouter();
  const [cfg, setCfg] = useState<ViewConfig>(config);
  const [open, setOpen] = useState<null | "filter" | "sort" | "fields" | "freeze" | "config">(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setCfg(config), [config]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  async function save(next: ViewConfig) {
    setCfg(next);
    await updateViewConfig(viewId, next);
    router.refresh();
  }

  // Link + lookup fields are now filterable/sortable (via a linked sub-field).
  // Computed fields (formula/rollup) aren't sortable — they aren't stored columns.
  const filterable = fields.filter((f) => kindOf(f) !== null);
  const sortable = fields.filter((f) => f.type !== "formula" && f.type !== "rollup");
  // Single-select fields are the valid Kanban grouping fields; date/datetime
  // fields are the valid Calendar placement fields.
  const stackFields = fields.filter((f) => f.type === "select");
  const dateFields = fields.filter((f) => f.type === "date" || f.type === "datetime");
  const conds = cfg.filters?.conditions ?? [];
  const sorts = cfg.sorts ?? [];
  const hiddenCount = cfg.fields ? fields.length - cfg.fields.length : 0;

  // Per-view-type config popover (one button + one panel; add new view types here).
  const typeEditors: Record<string, { label: string; el: React.ReactNode }> = {
    kanban: {
      label: "Kanban",
      el: <KanbanEditor stackFields={stackFields} kanban={cfg.kanban} onChange={(kanban) => save({ ...cfg, kanban })} />,
    },
    calendar: {
      label: "Calendar",
      el: <CalendarEditor dateFields={dateFields} calendar={cfg.calendar} onChange={(calendar) => save({ ...cfg, calendar })} />,
    },
    gallery: {
      label: "Gallery",
      el: <GalleryEditor urlFields={fields.filter((f) => f.type === "url")} gallery={cfg.gallery} onChange={(gallery) => save({ ...cfg, gallery })} />,
    },
    gantt: {
      label: "Gantt",
      el: <GanttEditor dateFields={dateFields} gantt={cfg.gantt} onChange={(gantt) => save({ ...cfg, gantt })} />,
    },
  };
  const typeEditor = typeEditors[viewType];

  return (
    <div ref={ref} className="relative flex items-center gap-2 py-2">
      <button className={btn} onClick={() => setOpen(open === "filter" ? null : "filter")}>
        Filter{conds.length ? ` (${conds.length})` : ""}
      </button>
      <button className={btn} onClick={() => setOpen(open === "sort" ? null : "sort")}>
        Sort{sorts.length ? ` (${sorts.length})` : ""}
      </button>
      <button className={btn} onClick={() => setOpen(open === "fields" ? null : "fields")}>
        Fields{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
      </button>
      <button className={btn} onClick={() => setOpen(open === "freeze" ? null : "freeze")}>
        Freeze
      </button>
      {typeEditor ? (
        <button className={btn} onClick={() => setOpen(open === "config" ? null : "config")}>
          {typeEditor.label}
        </button>
      ) : null}

      {open === "filter" ? (
        <div className={panel} style={{ top: "100%", right: 0 }}>
          <FilterEditor fields={filterable} meta={meta} filters={cfg.filters} onChange={(filters) => save({ ...cfg, filters })} />
        </div>
      ) : null}
      {open === "sort" ? (
        <div className={panel} style={{ top: "100%", right: 0 }}>
          <SortEditor fields={sortable} meta={meta} sorts={sorts} onChange={(s) => save({ ...cfg, sorts: s })} />
        </div>
      ) : null}
      {open === "fields" ? (
        <div className={panel} style={{ top: "100%", right: 0 }}>
          <FieldEditor allFields={fields} configFields={cfg.fields} meta={meta} onChange={(f) => save({ ...cfg, fields: f })} />
        </div>
      ) : null}
      {open === "freeze" ? (
        <div className={`${panelSm} !w-64`} style={{ top: "100%", right: 0 }}>
          <FreezeEditor
            freezeHeader={cfg.freezeHeader !== false}
            frozen={cfg.frozen ?? 1}
            maxCols={Math.min(4, fields.length)}
            onChange={(freezeHeader, frozen) => save({ ...cfg, freezeHeader, frozen })}
          />
        </div>
      ) : null}
      {open === "config" && typeEditor ? (
        <div className={panelSm} style={{ top: "100%", right: 0 }}>
          {typeEditor.el}
        </div>
      ) : null}
    </div>
  );
}

/** Non-negative-integer input that commits on blur/Enter — no save per keystroke,
 *  and clearing it restores the default (commits undefined). */
function CountInput({ value, fallback, onCommit }: { value: number | undefined; fallback: number; onCommit: (n: number | undefined) => void }) {
  return (
    <input
      type="number"
      min={0}
      className="w-16 rounded border border-surface-border px-1.5 py-0.5 text-sm"
      defaultValue={value ?? fallback}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const n = Math.max(0, Math.floor(Number(raw)));
        onCommit(raw !== "" && Number.isFinite(n) ? n : undefined);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

/** Labeled single-field picker shared by the view-type config editors. With
 *  `none` set, an empty choice (labelled by it) maps to undefined; otherwise the
 *  placeholder is a disabled "Choose a field…". */
function FieldSelect({
  label,
  fields,
  value,
  none,
  onChange,
}: {
  label: string;
  fields: FieldMeta[];
  value: string;
  none?: string;
  onChange: (fieldId: string | undefined) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-neutral-600">{label}</label>
      <select
        className="w-full rounded border border-surface-border px-1.5 py-1 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        {none != null ? <option value="">{none}</option> : <option value="" disabled>Choose a field…</option>}
        {fields.map((f) => <option key={f.fieldId} value={f.fieldId}>{f.name}</option>)}
      </select>
    </div>
  );
}

/** Configure a Gallery view: an optional cover-image field (url) + how many
 *  fields each card previews. Card field selection is the shared Fields editor. */
function GalleryEditor({
  urlFields,
  gallery,
  onChange,
}: {
  urlFields: FieldMeta[];
  gallery: ViewConfig["gallery"];
  onChange: (g: NonNullable<ViewConfig["gallery"]>) => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <FieldSelect label="Cover image field" fields={urlFields} value={gallery?.coverFieldId ?? ""} none="None" onChange={(coverFieldId) => onChange({ ...gallery, coverFieldId })} />
      {urlFields.length === 0 ? <p className="text-[11px] text-neutral-400">Add a URL field to use card covers.</p> : null}
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-600">Max card fields</span>
        <CountInput value={gallery?.maxPreviewFields} fallback={6} onCommit={(n) => onChange({ ...gallery, maxPreviewFields: n })} />
      </div>
      <p className="text-xs text-neutral-400">Use the <span className="font-medium">Fields</span> menu to choose which fields show on each card.</p>
    </div>
  );
}

/** Configure a Gantt view: the start (required) and end (optional) date fields
 *  that define each record's bar. */
function GanttEditor({
  dateFields,
  gantt,
  onChange,
}: {
  dateFields: FieldMeta[];
  gantt: ViewConfig["gantt"];
  onChange: (g: NonNullable<ViewConfig["gantt"]>) => void;
}) {
  const startFieldId = gantt?.startFieldId ?? "";
  if (dateFields.length === 0) {
    return <p className="text-xs text-neutral-400">Add a date or date-&-time field to plot records on a timeline.</p>;
  }
  return (
    <div className="space-y-3 text-sm">
      <FieldSelect label="Start date field" fields={dateFields} value={startFieldId} onChange={(id) => onChange({ ...gantt, startFieldId: id ?? "" })} />
      <FieldSelect
        label="End date field (optional)"
        fields={dateFields.filter((f) => f.fieldId !== startFieldId)}
        value={gantt?.endFieldId ?? ""}
        none="None — 1-day bars"
        onChange={(endFieldId) => onChange({ ...gantt, startFieldId, endFieldId })}
      />
      <p className="text-xs text-neutral-400">Each record renders a bar from start to end on a shared timeline.</p>
    </div>
  );
}

/** Configure a Calendar view: which date/datetime field places records on the
 *  month grid. Mirrors the Kanban stack-field picker. */
function CalendarEditor({
  dateFields,
  calendar,
  onChange,
}: {
  dateFields: FieldMeta[];
  calendar: ViewConfig["calendar"];
  onChange: (c: NonNullable<ViewConfig["calendar"]>) => void;
}) {
  const dateFieldId = calendar?.dateFieldId ?? "";
  if (dateFields.length === 0) {
    return <p className="text-xs text-neutral-400">Add a date or date-&-time field to place records on a calendar.</p>;
  }
  return (
    <div className="space-y-3 text-sm">
      <FieldSelect label="Date field" fields={dateFields} value={dateFieldId} onChange={(id) => onChange({ dateFieldId: id ?? "" })} />
      <p className="text-xs text-neutral-400">Records appear on the month grid by this field. Drag an event to another day to update it.</p>
    </div>
  );
}

/** Configure a Kanban view: which single-select field stacks into columns, and
 *  a soft cap on how many fields each card previews. Card field selection itself
 *  is the shared "Fields" editor. */
function KanbanEditor({
  stackFields,
  kanban,
  onChange,
}: {
  stackFields: FieldMeta[];
  kanban: ViewConfig["kanban"];
  onChange: (k: NonNullable<ViewConfig["kanban"]>) => void;
}) {
  const stackFieldId = kanban?.stackFieldId ?? "";
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  if (stackFields.length === 0) {
    return <p className="text-xs text-neutral-400">Add a single-select field to this table to group a Kanban by it.</p>;
  }
  // Buckets to order = the chosen field's options, in the saved order first.
  const stackField = stackFields.find((f) => f.fieldId === stackFieldId);
  const choices = stackField?.options?.choices?.map((c) => c.name) ?? [];
  const order = kanban?.columnOrder ?? [];
  const buckets = [...order.filter((n) => choices.includes(n)), ...choices.filter((n) => !order.includes(n))];

  const onBucketDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = buckets.indexOf(String(e.active.id));
    const to = buckets.indexOf(String(e.over.id));
    if (from < 0 || to < 0) return;
    onChange({ ...kanban, stackFieldId, columnOrder: arrayMove(buckets, from, to) });
  };

  return (
    <div className="space-y-3 text-sm">
      {/* Changing the field invalidates the old field's column order. */}
      <FieldSelect label="Stack by" fields={stackFields} value={stackFieldId} onChange={(id) => onChange({ ...kanban, stackFieldId: id ?? "", columnOrder: undefined })} />
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-600">Max card fields</span>
        <CountInput value={kanban?.maxPreviewFields} fallback={8} onCommit={(n) => onChange({ ...kanban, stackFieldId, maxPreviewFields: n })} />
      </div>
      {buckets.length ? (
        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-600">Column order</label>
          <DndContext sensors={sensors} onDragEnd={onBucketDragEnd}>
            <SortableContext items={buckets} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {buckets.map((name) => <SortableBucketRow key={name} name={name} />)}
              </div>
            </SortableContext>
          </DndContext>
          <p className="text-[11px] text-neutral-400">Drag to set left-to-right column order. “Uncategorized” always shows last.</p>
        </div>
      ) : null}
      <p className="text-xs text-neutral-400">Use the <span className="font-medium">Fields</span> menu to choose which fields show on each card.</p>
    </div>
  );
}

/** One draggable Kanban bucket in the column-order list. */
function SortableBucketRow({ name }: { name: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: name });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded border border-surface-border px-2 py-1 text-xs ${isDragging ? "bg-surface-muted shadow-sm" : "bg-white"}`}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-base leading-none text-neutral-400 hover:text-neutral-700 active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <span className="flex-1 truncate">{name}</span>
    </div>
  );
}

/** Ops valid for a filter row, accounting for link sub-fields: a link with no
 *  sub-field offers only emptiness ops; otherwise ops follow the effective
 *  (sub-)field's kind. */
function opsForRow(field: FieldMeta, cond: FilterCondition, meta: Meta): Array<{ op: string; label: string; noValue?: boolean }> {
  if (field.type === "link" && !cond.linkedFieldId) return OPS_BY_KIND.link!;
  const eff = effectiveField(field, cond.linkedFieldId, meta);
  return OPS_BY_KIND[kindOf(eff) ?? "text"] ?? OPS_BY_KIND.text!;
}

/** Default a freshly-picked field's condition: links default to the linked
 *  primary sub-field so they're immediately comparable. */
function defaultCondForField(field: FieldMeta, meta: Meta): FilterCondition {
  if (field.type === "link") {
    const subs = linkedSubFields(field, meta);
    const tid = linkedTableIdOf(field, meta);
    const primaryId = meta.tables.find((t) => t.tableId === tid)?.primaryFieldId;
    const linkedFieldId = subs.find((s) => s.fieldId === primaryId)?.fieldId ?? subs[0]?.fieldId;
    const eff = effectiveField(field, linkedFieldId, meta);
    return { fieldId: field.fieldId, linkedFieldId, op: (OPS_BY_KIND[kindOf(eff) ?? "text"] ?? OPS_BY_KIND.text!)[0]!.op as FilterCondition["op"] };
  }
  const ops = OPS_BY_KIND[kindOf(field) ?? "text"] ?? OPS_BY_KIND.text!;
  return { fieldId: field.fieldId, op: ops[0]!.op as FilterCondition["op"] };
}

/** One leaf-condition row (field picker, optional linked sub-field picker, op,
 *  value). Reused at the top level and inside groups. `lead` is the leading
 *  label ("Where" / the conjunction). */
function ConditionRow({
  cond, fields, meta, lead, onChange, onRemove,
}: {
  cond: FilterCondition;
  fields: FieldMeta[];
  meta: Meta;
  lead: React.ReactNode;
  onChange: (patch: Partial<FilterCondition>) => void;
  onRemove: () => void;
}) {
  const field = fields.find((f) => f.fieldId === cond.fieldId);
  const ops = field ? opsForRow(field, cond, meta) : [];
  const opMeta = ops.find((o) => o.op === cond.op);
  const subFields = field && field.type === "link" ? linkedSubFields(field, meta) : [];
  const eff = field ? effectiveField(field, cond.linkedFieldId, meta) : undefined;
  const sel = "rounded border border-surface-border px-1 py-0.5 text-xs";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {lead}
      <select className={sel} value={cond.fieldId}
        onChange={(e) => { const nf = fields.find((f) => f.fieldId === e.target.value)!; onChange({ ...defaultCondForField(nf, meta), value: undefined }); }}>
        {fields.map((f) => <option key={f.fieldId} value={f.fieldId}>{f.name}</option>)}
      </select>
      {field?.type === "link" && subFields.length ? (
        <select className={sel} value={cond.linkedFieldId ?? ""}
          onChange={(e) => { const lf = subFields.find((s) => s.fieldId === e.target.value)!; onChange({ linkedFieldId: e.target.value, op: (OPS_BY_KIND[kindOf(lf) ?? "text"] ?? OPS_BY_KIND.text!)[0]!.op as FilterCondition["op"], value: undefined }); }}>
          {subFields.map((s) => <option key={s.fieldId} value={s.fieldId}>{s.name}</option>)}
        </select>
      ) : null}
      <select className={sel} value={cond.op} onChange={(e) => onChange({ op: e.target.value as FilterCondition["op"], value: undefined })}>
        {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
      </select>
      {opMeta && !opMeta.noValue && eff ? <ValueInput field={eff} value={cond.value} onChange={(v) => onChange({ value: v })} /> : null}
      <button className="ml-auto text-xs text-neutral-400 hover:text-red-500" onClick={onRemove}>✕</button>
    </div>
  );
}

function FilterEditor({
  fields,
  meta,
  filters,
  onChange,
}: {
  fields: FieldMeta[];
  meta: Meta;
  filters: ViewConfig["filters"];
  onChange: (f: ViewConfig["filters"]) => void;
}) {
  const conjunction = filters?.conjunction ?? "and";
  const items: FilterItem[] = filters?.conditions ?? [];
  const emit = (next: FilterItem[]) =>
    onChange(next.length ? { conjunction, conditions: next } : undefined);

  const setItem = (i: number, item: FilterItem) => emit(items.map((x, j) => (j === i ? item : x)));
  const removeItem = (i: number) => emit(items.filter((_, j) => j !== i));

  const lead = (i: number) => (i === 0
    ? <span className="w-12 text-xs text-neutral-400">Where</span>
    : <span className="w-12 text-xs text-neutral-500">{conjunction}</span>);

  return (
    <div className="space-y-2">
      {items.length === 0 ? <p className="text-xs text-neutral-400">No filters. Records aren’t filtered.</p> : null}
      {items.map((item, i) => isFilterGroup(item) ? (
        <GroupRow
          key={i} group={item} fields={fields} meta={meta} lead={lead(i)}
          onChange={(g) => setItem(i, g)} onRemove={() => removeItem(i)}
        />
      ) : (
        <ConditionRow
          key={i} cond={item} fields={fields} meta={meta} lead={lead(i)}
          onChange={(patch) => setItem(i, { ...item, ...patch })} onRemove={() => removeItem(i)}
        />
      ))}
      <div className="flex items-center gap-2 pt-1">
        <button className={btn}
          onClick={() => { const f = fields[0]; if (!f) return; emit([...items, defaultCondForField(f, meta)]); }}>
          + Add condition
        </button>
        <button className={btn}
          onClick={() => { const f = fields[0]; if (!f) return; emit([...items, { conjunction: "or", conditions: [defaultCondForField(f, meta)] }]); }}>
          + Add group
        </button>
        {items.length > 1 ? (
          <select className="rounded border border-surface-border px-1 py-0.5 text-xs" value={conjunction}
            onChange={(e) => onChange({ conjunction: e.target.value as "and" | "or", conditions: items })}>
            <option value="and">all (and)</option><option value="or">any (or)</option>
          </select>
        ) : null}
      </div>
    </div>
  );
}

/** A one-level AND/OR group: its own conjunction toggle + leaf condition rows. */
function GroupRow({
  group, fields, meta, lead, onChange, onRemove,
}: {
  group: FilterGroup;
  fields: FieldMeta[];
  meta: Meta;
  lead: React.ReactNode;
  onChange: (g: FilterGroup) => void;
  onRemove: () => void;
}) {
  const conds = group.conditions ?? [];
  const setCond = (i: number, patch: Partial<FilterCondition>) =>
    onChange({ ...group, conditions: conds.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const removeCond = (i: number) => {
    const next = conds.filter((_, j) => j !== i);
    if (next.length === 0) { onRemove(); return; }
    onChange({ ...group, conditions: next });
  };
  return (
    <div className="flex items-start gap-1.5">
      {lead}
      <div className="flex-1 space-y-1.5 rounded-md border border-surface-border bg-surface-muted/40 p-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-400">Group —</span>
          <select className="rounded border border-surface-border px-1 py-0.5 text-xs" value={group.conjunction}
            onChange={(e) => onChange({ ...group, conjunction: e.target.value as "and" | "or" })}>
            <option value="and">all (and)</option><option value="or">any (or)</option>
          </select>
          <button className="ml-auto text-xs text-neutral-400 hover:text-red-500" onClick={onRemove}>remove group</button>
        </div>
        {conds.map((c, i) => (
          <ConditionRow
            key={i} cond={c} fields={fields} meta={meta}
            lead={i === 0 ? <span className="w-10 text-xs text-neutral-400">When</span> : <span className="w-10 text-xs text-neutral-500">{group.conjunction}</span>}
            onChange={(patch) => setCond(i, patch)} onRemove={() => removeCond(i)}
          />
        ))}
        <button className={btn}
          onClick={() => { const f = fields[0]; if (f) onChange({ ...group, conditions: [...conds, defaultCondForField(f, meta)] }); }}>
          + Add condition
        </button>
      </div>
    </div>
  );
}

function ValueInput({ field, value, onChange }: { field: FieldMeta; value: unknown; onChange: (v: unknown) => void }) {
  const cls = "rounded border border-surface-border px-1 py-0.5 text-xs";
  if (field.type === "select" && field.options?.choices) {
    return (
      <select className={cls} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {field.options.choices.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select>
    );
  }
  if (field.type === "checkbox") {
    return (
      <select className={cls} value={value ? "true" : "false"} onChange={(e) => onChange(e.target.value === "true")}>
        <option value="true">checked</option><option value="false">unchecked</option>
      </select>
    );
  }
  const type = field.type === "number" ? "number" : field.type === "date" || field.type === "datetime" ? "date" : "text";
  return (
    <input className={cls} type={type} defaultValue={value == null ? "" : String(value)}
      onBlur={(e) => onChange(type === "number" ? Number(e.target.value) : e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

function SortEditor({ fields, meta, sorts, onChange }: { fields: FieldMeta[]; meta: Meta; sorts: NonNullable<ViewConfig["sorts"]>; onChange: (s: ViewConfig["sorts"]) => void }) {
  // Default a link sort to the linked primary so it's immediately meaningful.
  const defaultSort = (f: FieldMeta): NonNullable<ViewConfig["sorts"]>[number] => {
    if (f.type === "link") {
      const subs = linkedSubFields(f, meta);
      const tid = linkedTableIdOf(f, meta);
      const primaryId = meta.tables.find((t) => t.tableId === tid)?.primaryFieldId;
      const linkedFieldId = subs.find((s) => s.fieldId === primaryId)?.fieldId ?? subs[0]?.fieldId;
      return { fieldId: f.fieldId, linkedFieldId, direction: "asc" };
    }
    return { fieldId: f.fieldId, direction: "asc" };
  };
  const sel = "rounded border border-surface-border px-1 py-0.5 text-xs";
  return (
    <div className="space-y-2">
      {sorts.length === 0 ? <p className="text-xs text-neutral-400">No sorts.</p> : null}
      {sorts.map((s, i) => {
        const field = fields.find((f) => f.fieldId === s.fieldId);
        const subFields = field && field.type === "link" ? linkedSubFields(field, meta) : [];
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <select className={sel} value={s.fieldId}
              onChange={(e) => { const nf = fields.find((f) => f.fieldId === e.target.value)!; onChange(sorts.map((x, j) => (j === i ? defaultSort(nf) : x))); }}>
              {fields.map((f) => <option key={f.fieldId} value={f.fieldId}>{f.name}</option>)}
            </select>
            {field?.type === "link" && subFields.length ? (
              <select className={sel} value={s.linkedFieldId ?? ""}
                onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, linkedFieldId: e.target.value } : x)))}>
                {subFields.map((sf) => <option key={sf.fieldId} value={sf.fieldId}>{sf.name}</option>)}
              </select>
            ) : null}
            <select className={sel} value={s.direction ?? "asc"}
              onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, direction: e.target.value as "asc" | "desc" } : x)))}>
              <option value="asc">A → Z</option><option value="desc">Z → A</option>
            </select>
            <button className="ml-auto text-xs text-neutral-400 hover:text-red-500" onClick={() => onChange(sorts.filter((_, j) => j !== i))}>✕</button>
          </div>
        );
      })}
      <button className={btn} onClick={() => { const f = fields[0]; if (f) onChange([...sorts, defaultSort(f)]); }}>
        + Add sort
      </button>
    </div>
  );
}

function FieldEditor({ allFields, configFields, meta, onChange }: { allFields: FieldMeta[]; configFields: ViewConfig["fields"]; meta: Meta; onChange: (f: ViewConfig["fields"]) => void }) {
  const router = useRouter();
  const tableId = allFields[0]?.tableId;
  // Current ordered+visible list; default = all fields by position.
  const ordered = configFields && configFields.length
    ? configFields.map((c) => allFields.find((f) => f.fieldId === c.fieldId)).filter((f): f is FieldMeta => Boolean(f))
    : allFields;
  const visible = new Set(ordered.map((f) => f.fieldId));

  // A short drag distance keeps the checkbox clickable without starting a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const setVisible = (fieldId: string, on: boolean) => {
    const next = on
      ? [...ordered, allFields.find((f) => f.fieldId === fieldId)!]
      : ordered.filter((f) => f.fieldId !== fieldId);
    onChange(next.map((f) => ({ fieldId: f.fieldId })));
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ordered.findIndex((f) => f.fieldId === e.active.id);
    const to = ordered.findIndex((f) => f.fieldId === e.over!.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(ordered, from, to).map((f) => ({ fieldId: f.fieldId })));
  };
  const onDelete = async (field: FieldMeta) => {
    if (!tableId) return;
    if (!window.confirm(`Delete the field “${field.name}”? This removes its data and can’t be undone.`)) return;
    try {
      await deleteField(tableId, field.fieldId);
      router.refresh();
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    // pr-3 keeps the drag handle clear of the (overlay) scrollbar.
    <div className="max-h-[28rem] space-y-0.5 overflow-auto pr-3">
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext items={ordered.map((f) => f.fieldId)} strategy={verticalListSortingStrategy}>
          {ordered.map((f) => (
            <SortableFieldRow key={f.fieldId} field={f} onHide={() => setVisible(f.fieldId, false)} onDelete={() => onDelete(f)} />
          ))}
        </SortableContext>
      </DndContext>
      {allFields.filter((f) => !visible.has(f.fieldId)).map((f) => (
        // pl-8 aligns the hidden rows under the visible rows' checkbox (past the handle).
        <div key={f.fieldId} className="group flex items-center gap-2 py-1 pl-8 text-xs text-neutral-400">
          <input type="checkbox" checked={false} onChange={() => setVisible(f.fieldId, true)} />
          <span className="flex-1 truncate">{f.name}</span>
          {!f.isPrimary ? (
            <button type="button" className="px-1 text-neutral-300 opacity-0 hover:text-red-500 group-hover:opacity-100" aria-label="Delete field" onClick={() => onDelete(f)}>✕</button>
          ) : null}
        </div>
      ))}
      {tableId ? (
        <AddFieldForm
          tableId={tableId}
          fields={allFields}
          meta={meta}
          onCreated={(field) => {
            // If the view pins an explicit field list, append the new field so it
            // shows right away (save() refreshes); otherwise all fields show already.
            if (configFields && configFields.length) onChange([...configFields, { fieldId: field.fieldId }]);
            else router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/** One draggable visible-field row: a generous left drag handle reorders,
 *  checkbox hides, and a hover ✕ deletes (non-primary only). The handle is on
 *  the left so the scroll container's scrollbar never overlaps it. */
function SortableFieldRow({ field, onHide, onDelete }: { field: FieldMeta; onHide: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.fieldId });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 rounded text-xs ${isDragging ? "bg-surface-muted shadow-sm" : ""}`}
    >
      <button
        type="button"
        className="-my-0.5 cursor-grab touch-none px-1.5 py-1.5 text-base leading-none text-neutral-400 hover:text-neutral-700 active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <input type="checkbox" checked onChange={onHide} />
      <span className="flex-1 truncate">{field.name}</span>
      {!field.isPrimary ? (
        <button type="button" className="px-1 text-neutral-300 opacity-0 hover:text-red-500 group-hover:opacity-100" aria-label="Delete field" onClick={onDelete}>✕</button>
      ) : null}
    </div>
  );
}

const AGGS: Array<"count" | "sum" | "avg" | "min" | "max"> = ["count", "sum", "avg", "min", "max"];
const CREATE_TYPES: Array<{ type: FieldType; label: string }> = [
  { type: "text", label: "Text" }, { type: "longtext", label: "Long text" }, { type: "number", label: "Number" },
  { type: "checkbox", label: "Checkbox" }, { type: "date", label: "Date" }, { type: "datetime", label: "Date & time" },
  { type: "url", label: "URL" }, { type: "email", label: "Email" },
  { type: "select", label: "Single select" }, { type: "multiselect", label: "Multi select" },
  { type: "rollup", label: "Rollup" },
];

/** Self-service "add field" form. Stored types create a column; rollups aggregate
 *  a number across a link field; select types take comma-separated choices. */
function AddFieldForm({ tableId, fields, meta, onCreated }: { tableId: string; fields: FieldMeta[]; meta: Meta; onCreated: (field: FieldMeta) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [choices, setChoices] = useState("");
  const [via, setVia] = useState("");
  const [agg, setAgg] = useState<"count" | "sum" | "avg" | "min" | "max">("count");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const linkFields = fields.filter((f) => f.type === "link");
  const viaField = linkFields.find((f) => f.fieldId === via);
  const targetFields = viaField?.options?.linkedTableId
    ? fieldsForTable(meta, viaField.options.linkedTableId).filter((f) => f.type === "number")
    : [];
  const sel = "w-full rounded border border-surface-border px-1.5 py-1 text-xs";

  const reset = () => { setName(""); setType("text"); setChoices(""); setVia(""); setAgg("count"); setTarget(""); };
  const submit = async () => {
    if (!name.trim()) return;
    let options: FieldOptions | null = null;
    if (type === "rollup") {
      if (!via) { alert("Pick a link field to roll up."); return; }
      if (agg !== "count" && !target) { alert("Pick a number field to aggregate."); return; }
      options = { rollup: { via, agg, ...(agg !== "count" && target ? { target } : {}) } };
    } else if (type === "select" || type === "multiselect") {
      options = { choices: choices.split(",").map((s) => s.trim()).filter(Boolean).map((nm) => ({ name: nm })) };
    }
    setBusy(true);
    try {
      const created = await createField(tableId, { name: name.trim(), type, options });
      reset(); setOpen(false); onCreated(created);
    } catch (e) {
      alert(`Create failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="mt-2 w-full rounded-md border border-dashed border-surface-border px-2 py-1.5 text-xs text-neutral-500 hover:border-blue-300 hover:text-blue-600" onClick={() => setOpen(true)}>
        + Add field
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-md border border-surface-border bg-surface-muted/40 p-2">
      <input className={sel} placeholder="Field name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      <select className={sel} value={type} onChange={(e) => setType(e.target.value as FieldType)}>
        {CREATE_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
      </select>
      {(type === "select" || type === "multiselect") ? (
        <input className={sel} placeholder="Choices, comma-separated" value={choices} onChange={(e) => setChoices(e.target.value)} />
      ) : null}
      {type === "rollup" ? (
        <>
          <select className={sel} value={via} onChange={(e) => { setVia(e.target.value); setTarget(""); }}>
            <option value="" disabled>Roll up via… (a link field)</option>
            {linkFields.map((f) => <option key={f.fieldId} value={f.fieldId}>{f.name}</option>)}
          </select>
          <select className={sel} value={agg} onChange={(e) => setAgg(e.target.value as typeof agg)}>
            {AGGS.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}
          </select>
          {agg !== "count" ? (
            <select className={sel} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="" disabled>Number field to aggregate…</option>
              {targetFields.map((f) => <option key={f.fieldId} value={f.fieldId}>{f.name}</option>)}
            </select>
          ) : null}
          {linkFields.length === 0 ? <p className="text-[11px] text-amber-600">This table has no link fields to roll up.</p> : null}
        </>
      ) : null}
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy} className="rounded-md bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50" onClick={submit}>
          {busy ? "Adding…" : "Add field"}
        </button>
        <button type="button" className="text-xs text-neutral-400 hover:text-neutral-700" onClick={() => { reset(); setOpen(false); }}>Cancel</button>
      </div>
    </div>
  );
}

function FreezeEditor({
  freezeHeader,
  frozen,
  maxCols,
  onChange,
}: {
  freezeHeader: boolean;
  frozen: number;
  maxCols: number;
  onChange: (freezeHeader: boolean, frozen: number) => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={freezeHeader} onChange={(e) => onChange(e.target.checked, frozen)} />
        Freeze header row
      </label>
      <div className="flex items-center justify-between">
        <span>Frozen columns</span>
        <select
          className="rounded border border-surface-border px-1.5 py-0.5 text-sm"
          value={frozen}
          onChange={(e) => onChange(freezeHeader, Number(e.target.value))}
        >
          {Array.from({ length: maxCols + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>
      <p className="text-xs text-neutral-400">Keeps field names + the first N columns visible while scrolling. Saved with this view.</p>
    </div>
  );
}
