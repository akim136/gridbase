"use client";
import { useState } from "react";
import { Cell } from "./Cell";
import { LinkPicker } from "./LinkPicker";
import { updateRecord } from "@/lib/client";
import type { FieldMeta } from "@/lib/types";

const EDITABLE = new Set([
  "text", "longtext", "number", "select", "multiselect", "checkbox", "date", "datetime", "url", "email",
]);

const inputCls = "w-full rounded border border-blue-400 px-1.5 py-1 text-sm outline-none";

/**
 * One grid/detail cell with click-to-edit. Scalar types edit inline with an
 * optimistic PATCH; computed/lookup/link render read-only here (links get a
 * picker separately). Empty input clears the field (null).
 */
export function EditableCell({
  tableId,
  recordId,
  field,
  value,
  labels,
  linkTargets,
  linkPrimaries,
}: {
  tableId: string;
  recordId: string;
  field: FieldMeta;
  value: unknown;
  labels: Map<string, string>;
  linkTargets?: Record<string, string>;
  linkPrimaries?: Record<string, string>;
}) {
  const [val, setVal] = useState<unknown>(value);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function commit(next: unknown) {
    setEditing(false);
    if (JSON.stringify(next) === JSON.stringify(val)) return;
    const prev = val;
    setVal(next);
    setSaving(true);
    try {
      await updateRecord(tableId, recordId, { [field.fieldId]: next === "" ? null : next });
    } catch (e) {
      setVal(prev);
      alert(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  if (field.type === "link") {
    const linkedTableId = field.options?.linkedTableId;
    return (
      <LinkPicker
        tableId={tableId}
        recordId={recordId}
        field={field}
        value={val}
        labels={labels}
        basePath={linkedTableId ? linkTargets?.[linkedTableId] : undefined}
        linkedPrimaryFieldId={linkedTableId ? linkPrimaries?.[linkedTableId] : undefined}
      />
    );
  }

  if (!EDITABLE.has(field.type)) {
    return <Cell field={field} value={val} labels={labels} linkTargets={linkTargets} />;
  }

  if (field.type === "checkbox") {
    return (
      <button type="button" onClick={() => commit(!val)} className="text-base leading-none" title="toggle">
        {val ? <span className="text-emerald-600">✓</span> : <span className="text-neutral-300">☐</span>}
      </button>
    );
  }

  if (!editing) {
    return (
      <div
        onClick={() => setEditing(true)}
        className={`min-h-[1.5rem] cursor-text rounded px-1 hover:bg-blue-50/60 ${saving ? "opacity-50" : ""}`}
      >
        <Cell field={field} value={val} labels={labels} linkTargets={linkTargets} />
      </div>
    );
  }

  return <Editor field={field} value={val} onCommit={commit} onCancel={() => setEditing(false)} />;
}

function Editor({
  field,
  value,
  onCommit,
  onCancel,
}: {
  field: FieldMeta;
  value: unknown;
  onCommit: (v: unknown) => void;
  onCancel: () => void;
}) {
  if (field.type === "select") {
    return (
      <select
        autoFocus
        className={inputCls}
        defaultValue={String(value ?? "")}
        onChange={(e) => onCommit(e.target.value || null)}
        onBlur={onCancel}
      >
        <option value="">—</option>
        {field.options?.choices?.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select>
    );
  }

  if (field.type === "multiselect") {
    return <MultiSelectEditor field={field} value={Array.isArray(value) ? value : []} onCommit={onCommit} onCancel={onCancel} />;
  }

  if (field.type === "longtext") {
    return (
      <textarea
        autoFocus
        className={`${inputCls} min-h-[4rem]`}
        defaultValue={String(value ?? "")}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
      />
    );
  }

  const inputType = field.type === "number" ? "number"
    : field.type === "date" || field.type === "datetime" ? "date"
    : field.type === "email" ? "email"
    : field.type === "url" ? "url"
    : "text";

  return (
    <input
      autoFocus
      type={inputType}
      className={inputCls}
      defaultValue={value == null ? "" : String(field.type === "date" || field.type === "datetime" ? String(value).slice(0, 10) : value)}
      onBlur={(e) => onCommit(inputType === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}

function MultiSelectEditor({
  field,
  value,
  onCommit,
  onCancel,
}: {
  field: FieldMeta;
  value: unknown[];
  onCommit: (v: unknown) => void;
  onCancel: () => void;
}) {
  const [sel, setSel] = useState<string[]>(value.map(String));
  const toggle = (name: string) =>
    setSel((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));
  return (
    <div className="rounded-lg border border-blue-400 bg-white p-2 shadow-lg">
      <div className="max-h-48 space-y-0.5 overflow-auto">
        {field.options?.choices?.map((c) => (
          <label key={c.name} className="flex items-center gap-2 px-1 text-xs">
            <input type="checkbox" checked={sel.includes(c.name)} onChange={() => toggle(c.name)} />
            {c.name}
          </label>
        ))}
      </div>
      <div className="mt-1 flex justify-end gap-2 text-xs">
        <button className="text-neutral-500" onClick={onCancel}>cancel</button>
        <button className="font-medium text-blue-600" onClick={() => onCommit(sel)}>save</button>
      </div>
    </div>
  );
}
