"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { updateViewConfig } from "@/lib/client";
import type { FieldMeta, FilterCondition, FilterGroup, FilterItem, Meta, ViewConfig } from "@/lib/types";
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

export function ViewToolbar({
  viewId,
  fields,
  config,
  meta,
}: {
  viewId: string;
  fields: FieldMeta[];
  config: ViewConfig;
  meta: Meta;
}) {
  const router = useRouter();
  const [cfg, setCfg] = useState<ViewConfig>(config);
  const [open, setOpen] = useState<null | "filter" | "sort" | "fields" | "freeze">(null);
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
  const filterable = fields.filter((f) => kindOf(f) !== null);
  const sortable = fields.filter((f) => f.type !== "formula");
  const conds = cfg.filters?.conditions ?? [];
  const sorts = cfg.sorts ?? [];
  const hiddenCount = cfg.fields ? fields.length - cfg.fields.length : 0;

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
          <FieldEditor allFields={fields} configFields={cfg.fields} onChange={(f) => save({ ...cfg, fields: f })} />
        </div>
      ) : null}
      {open === "freeze" ? (
        <div className="absolute z-40 mt-1 w-64 rounded-lg border border-surface-border bg-white p-3 shadow-lg" style={{ top: "100%", right: 0 }}>
          <FreezeEditor
            freezeHeader={cfg.freezeHeader !== false}
            frozen={cfg.frozen ?? 1}
            maxCols={Math.min(4, fields.length)}
            onChange={(freezeHeader, frozen) => save({ ...cfg, freezeHeader, frozen })}
          />
        </div>
      ) : null}
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

function FieldEditor({ allFields, configFields, onChange }: { allFields: FieldMeta[]; configFields: ViewConfig["fields"]; onChange: (f: ViewConfig["fields"]) => void }) {
  // Current ordered+visible list; default = all fields by position.
  const ordered = configFields && configFields.length
    ? configFields.map((c) => allFields.find((f) => f.fieldId === c.fieldId)).filter((f): f is FieldMeta => Boolean(f))
    : allFields;
  const visible = new Set(ordered.map((f) => f.fieldId));

  const setVisible = (fieldId: string, on: boolean) => {
    const next = on
      ? [...ordered, allFields.find((f) => f.fieldId === fieldId)!]
      : ordered.filter((f) => f.fieldId !== fieldId);
    onChange(next.map((f) => ({ fieldId: f.fieldId })));
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= ordered.length) return;
    const next = [...ordered];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next.map((f) => ({ fieldId: f.fieldId })));
  };

  return (
    <div className="max-h-80 space-y-0.5 overflow-auto">
      {ordered.map((f, i) => (
        <div key={f.fieldId} className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked onChange={() => setVisible(f.fieldId, false)} />
          <span className="flex-1 truncate">{f.name}</span>
          <button className="text-neutral-300 hover:text-neutral-600" onClick={() => move(i, -1)}>↑</button>
          <button className="text-neutral-300 hover:text-neutral-600" onClick={() => move(i, 1)}>↓</button>
        </div>
      ))}
      {allFields.filter((f) => !visible.has(f.fieldId)).map((f) => (
        <div key={f.fieldId} className="flex items-center gap-2 text-xs text-neutral-400">
          <input type="checkbox" checked={false} onChange={() => setVisible(f.fieldId, true)} />
          <span className="flex-1 truncate">{f.name}</span>
        </div>
      ))}
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
