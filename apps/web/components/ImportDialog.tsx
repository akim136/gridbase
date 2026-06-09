"use client";
import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { WRITABLE } from "./FieldInput";
import { createRecords } from "@/lib/client";
import type { FieldMeta } from "@/lib/types";

const SKIP = "__skip__";
const CHUNK = 50;

/** "Import CSV" → parse → map columns to fields → chunked create. */
export function ImportButton({ tableId, fields }: { tableId: string; fields: FieldMeta[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-surface-border px-3 py-1.5 text-sm text-neutral-600 hover:bg-surface-muted"
      >
        Import CSV
      </button>
      {open ? <Dialog tableId={tableId} fields={fields} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Dialog({ tableId, fields, onClose }: { tableId: string; fields: FieldMeta[]; onClose: () => void }) {
  const router = useRouter();
  const writable = fields.filter((f) => WRITABLE.has(f.type));
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({}); // csvCol → fieldId | SKIP
  const [status, setStatus] = useState<string | null>(null);

  function onFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const cols = res.meta.fields ?? [];
        setColumns(cols);
        setRows(res.data);
        // auto-map by case-insensitive name match
        const byName = new Map(writable.map((f) => [f.name.toLowerCase(), f.fieldId]));
        setMapping(Object.fromEntries(cols.map((c) => [c, byName.get(c.toLowerCase().trim()) ?? SKIP])));
      },
    });
  }

  async function runImport() {
    const active = Object.entries(mapping).filter(([, fid]) => fid !== SKIP);
    if (active.length === 0) { setStatus("Map at least one column."); return; }
    const fieldById = new Map(writable.map((f) => [f.fieldId, f]));
    const records = rows.map((row) => {
      const fieldsOut: Record<string, unknown> = {};
      for (const [col, fid] of active) {
        const raw = row[col];
        if (raw == null || raw === "") continue;
        const f = fieldById.get(fid)!;
        fieldsOut[fid] =
          f.type === "number" ? Number(raw)
          : f.type === "checkbox" ? /^(true|yes|1|✓)$/i.test(raw.trim())
          : f.type === "multiselect" ? raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
          : raw;
      }
      return fieldsOut;
    });

    let done = 0, failed = 0;
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      try {
        await createRecords(tableId, chunk);
        done += chunk.length;
      } catch {
        failed += chunk.length;
      }
      setStatus(`Imported ${done}/${records.length}${failed ? ` (${failed} failed)` : ""}…`);
    }
    setStatus(`Done — ${done} imported${failed ? `, ${failed} failed` : ""}.`);
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-6" onClick={onClose}>
      <div className="mt-12 max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-semibold text-neutral-900">Import CSV</h2>

        {columns.length === 0 ? (
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="text-sm" />
        ) : (
          <>
            <p className="mb-2 text-xs text-neutral-500">{rows.length} rows. Map each CSV column to a field:</p>
            <div className="space-y-1.5">
              {columns.map((col) => (
                <div key={col} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
                  <span className="truncate font-medium text-neutral-700">{col}</span>
                  <span className="text-neutral-300">→</span>
                  <select
                    className="rounded border border-surface-border px-1.5 py-1 text-sm"
                    value={mapping[col] ?? SKIP}
                    onChange={(e) => setMapping((m) => ({ ...m, [col]: e.target.value }))}
                  >
                    <option value={SKIP}>— skip —</option>
                    {writable.map((f) => <option key={f.fieldId} value={f.fieldId}>{f.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </>
        )}

        {status ? <p className="mt-3 text-sm text-neutral-600">{status}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-surface-muted">Close</button>
          {columns.length > 0 ? (
            <button type="button" onClick={runImport} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
              Import {rows.length} rows
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
