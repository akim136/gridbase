"use client";
import { useState } from "react";
import { FieldInput, WRITABLE } from "./FieldInput";
import { createRecord } from "@/lib/client";
import type { FieldMeta } from "@/lib/types";

/**
 * A focused data-entry form: renders the configured fields as inputs and creates
 * a record on submit. Gated behind the app's auth like everything else (internal
 * form); resets for fast repeated entry.
 */
export function FormRenderer({
  tableId,
  fields,
  title,
}: {
  tableId: string;
  fields: FieldMeta[];
  title?: string;
}) {
  const writable = fields.filter((f) => WRITABLE.has(f.type));
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(0);

  async function submit() {
    setSaving(true);
    try {
      await createRecord(tableId, vals);
      setVals({});
      setDone((n) => n + 1);
    } catch (e) {
      alert(`Submit failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl rounded-xl border border-surface-border bg-white p-6">
      <h1 className="text-xl font-semibold tracking-tight text-neutral-900">{title || "New entry"}</h1>
      {done > 0 ? <p className="mt-1 text-sm text-emerald-600">✓ Submitted {done} — form cleared for the next one.</p> : null}
      <div className="mt-5 space-y-4">
        {writable.map((f) => (
          <div key={f.fieldId}>
            <label className="mb-1 block text-sm font-medium text-neutral-600">{f.name}</label>
            <FieldInput field={f} value={vals[f.fieldId]} onChange={(v) => setVals((s) => ({ ...s, [f.fieldId]: v }))} />
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={submit}
        className="mt-6 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Submitting…" : "Submit"}
      </button>
    </div>
  );
}
