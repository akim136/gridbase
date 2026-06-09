"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { updateViewConfig } from "@/lib/client";
import type { FieldMeta, FilterCondition, ViewConfig } from "@/lib/types";

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
    default: return null; // formula/lookup/json — not filterable
  }
}

const btn = "rounded-md border border-surface-border px-2.5 py-1 text-xs text-neutral-600 hover:bg-surface-muted";
const panel = "absolute z-40 mt-1 max-h-[70vh] w-[28rem] max-w-[calc(100vw-6rem)] overflow-auto rounded-lg border border-surface-border bg-white p-3 shadow-lg";

export function ViewToolbar({
  viewId,
  fields,
  config,
}: {
  viewId: string;
  fields: FieldMeta[];
  config: ViewConfig;
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

  const filterable = fields.filter((f) => kindOf(f) !== null);
  const sortable = fields.filter((f) => f.type !== "link" && f.type !== "lookup" && f.type !== "formula");
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
          <FilterEditor fields={filterable} filters={cfg.filters} onChange={(filters) => save({ ...cfg, filters })} />
        </div>
      ) : null}
      {open === "sort" ? (
        <div className={panel} style={{ top: "100%", right: 0 }}>
          <SortEditor fields={sortable} sorts={sorts} onChange={(s) => save({ ...cfg, sorts: s })} />
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

function FilterEditor({
  fields,
  filters,
  onChange,
}: {
  fields: FieldMeta[];
  filters: ViewConfig["filters"];
  onChange: (f: ViewConfig["filters"]) => void;
}) {
  const conjunction = filters?.conjunction ?? "and";
  const conditions = filters?.conditions ?? [];
  const emit = (conds: FilterCondition[]) =>
    onChange(conds.length ? { conjunction, conditions: conds } : undefined);

  const update = (i: number, patch: Partial<FilterCondition>) =>
    emit(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-2">
      {conditions.length === 0 ? <p className="text-xs text-neutral-400">No filters. Records aren’t filtered.</p> : null}
      {conditions.map((c, i) => {
        const field = fields.find((f) => f.fieldId === c.fieldId);
        const ops = field ? OPS_BY_KIND[kindOf(field)!]! : [];
        const opMeta = ops.find((o) => o.op === c.op);
        return (
          <div key={i} className="flex items-center gap-1.5">
            {i === 0 ? <span className="w-12 text-xs text-neutral-400">Where</span>
              : <span className="w-12 text-xs text-neutral-500">{conjunction}</span>}
            <select className="rounded border border-surface-border px-1 py-0.5 text-xs"
              value={c.fieldId}
              onChange={(e) => { const nf = fields.find((f) => f.fieldId === e.target.value)!; update(i, { fieldId: e.target.value, op: OPS_BY_KIND[kindOf(nf)!]![0]!.op as FilterCondition["op"], value: undefined }); }}>
              {fields.map((f) => <option key={f.fieldId} value={f.fieldId}>{f.name}</option>)}
            </select>
            <select className="rounded border border-surface-border px-1 py-0.5 text-xs"
              value={c.op} onChange={(e) => update(i, { op: e.target.value as FilterCondition["op"], value: undefined })}>
              {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
            </select>
            {opMeta && !opMeta.noValue ? <ValueInput field={field!} value={c.value} onChange={(v) => update(i, { value: v })} /> : null}
            <button className="ml-auto text-xs text-neutral-400 hover:text-red-500" onClick={() => emit(conditions.filter((_, j) => j !== i))}>✕</button>
          </div>
        );
      })}
      <div className="flex items-center gap-2 pt-1">
        <button className={btn}
          onClick={() => { const f = fields[0]; if (!f) return; emit([...conditions, { fieldId: f.fieldId, op: OPS_BY_KIND[kindOf(f)!]![0]!.op as FilterCondition["op"] }]); }}>
          + Add condition
        </button>
        {conditions.length > 1 ? (
          <select className="rounded border border-surface-border px-1 py-0.5 text-xs" value={conjunction}
            onChange={(e) => onChange({ conjunction: e.target.value as "and" | "or", conditions })}>
            <option value="and">all (and)</option><option value="or">any (or)</option>
          </select>
        ) : null}
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

function SortEditor({ fields, sorts, onChange }: { fields: FieldMeta[]; sorts: NonNullable<ViewConfig["sorts"]>; onChange: (s: ViewConfig["sorts"]) => void }) {
  return (
    <div className="space-y-2">
      {sorts.length === 0 ? <p className="text-xs text-neutral-400">No sorts.</p> : null}
      {sorts.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select className="rounded border border-surface-border px-1 py-0.5 text-xs" value={s.fieldId}
            onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, fieldId: e.target.value } : x)))}>
            {fields.map((f) => <option key={f.fieldId} value={f.fieldId}>{f.name}</option>)}
          </select>
          <select className="rounded border border-surface-border px-1 py-0.5 text-xs" value={s.direction ?? "asc"}
            onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, direction: e.target.value as "asc" | "desc" } : x)))}>
            <option value="asc">A → Z</option><option value="desc">Z → A</option>
          </select>
          <button className="ml-auto text-xs text-neutral-400 hover:text-red-500" onClick={() => onChange(sorts.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className={btn} onClick={() => { const f = fields[0]; if (f) onChange([...sorts, { fieldId: f.fieldId, direction: "asc" }]); }}>
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
