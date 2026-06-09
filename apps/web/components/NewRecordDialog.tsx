"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FieldInput, WRITABLE } from "./FieldInput";
import { createRecord } from "@/lib/client";
import type { FieldMeta } from "@/lib/types";

/** "New record" button → modal form of the table's writable fields → create. */
export function NewRecordButton({ tableId, fields }: { tableId: string; fields: FieldMeta[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        + New record
      </button>
      {open ? <Modal tableId={tableId} fields={fields} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Modal({ tableId, fields, onClose }: { tableId: string; fields: FieldMeta[]; onClose: () => void }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const writable = fields.filter((f) => WRITABLE.has(f.type));

  async function submit() {
    setSaving(true);
    try {
      await createRecord(tableId, vals);
      onClose();
      router.refresh();
    } catch (e) {
      alert(`Create failed: ${e instanceof Error ? e.message : String(e)}`);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-6" onClick={onClose}>
      <div className="mt-12 max-h-[80vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-semibold text-neutral-900">New record</h2>
        <div className="space-y-3">
          {writable.map((f) => (
            <div key={f.fieldId} className="grid grid-cols-[140px_1fr] items-center gap-3">
              <label className="text-sm text-neutral-500">{f.name}</label>
              <FieldInput field={f} value={vals[f.fieldId]} onChange={(v) => setVals((s) => ({ ...s, [f.fieldId]: v }))} />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-neutral-400">Linked records can be set after creating, from the grid or detail view.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-surface-muted">Cancel</button>
          <button type="button" disabled={saving} onClick={submit} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
