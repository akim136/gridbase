"use client";
import { useEffect, useRef, useState } from "react";
import { LinkChips } from "./LinkChips";
import { listRecords, updateRecord } from "@/lib/client";
import type { FieldMeta } from "@/lib/types";

/**
 * Edit a link field: shows current linked records as navigable chips, with an
 * "edit" affordance that opens a searchable checkbox list of the linked table's
 * records. Toggling persists the new id array via PATCH.
 */
export function LinkPicker({
  tableId,
  recordId,
  field,
  value,
  labels,
  basePath,
  linkedPrimaryFieldId,
}: {
  tableId: string;
  recordId: string;
  field: FieldMeta;
  value: unknown;
  labels: Map<string, string>;
  basePath?: string;
  linkedPrimaryFieldId?: string;
}) {
  const linkedTableId = field.options?.linkedTableId;
  const [ids, setIds] = useState<string[]>(Array.isArray(value) ? (value as string[]) : []);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Array<{ id: string; label: string }> | null>(null);
  const [q, setQ] = useState("");
  const [localLabels, setLocalLabels] = useState<Record<string, string>>(
    Object.fromEntries(ids.map((id) => [id, labels.get(id) ?? id])),
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  async function openPicker() {
    setOpen(true);
    if (options || !linkedTableId || !linkedPrimaryFieldId) return;
    try {
      const res = await listRecords(linkedTableId, [linkedPrimaryFieldId]);
      const opts = res.records.map((r) => ({ id: r.id, label: String(r.fields[linkedPrimaryFieldId] ?? r.id) }));
      setOptions(opts);
      setLocalLabels((m) => ({ ...m, ...Object.fromEntries(opts.map((o) => [o.id, o.label])) }));
    } catch {
      setOptions([]);
    }
  }

  async function toggle(id: string) {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    setIds(next);
    try {
      await updateRecord(tableId, recordId, { [field.fieldId]: next });
    } catch (e) {
      setIds(ids);
      alert(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const labelMap = new Map(Object.entries(localLabels));
  const filtered = (options ?? []).filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));

  return (
    <span ref={ref} className="relative inline-flex items-center gap-1">
      <LinkChips ids={ids} labels={Object.fromEntries(labelMap)} basePath={basePath} />
      <button type="button" onClick={openPicker} className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-blue-600" title="edit links">
        ✎
      </button>
      {open ? (
        <div className="absolute top-full left-0 z-40 mt-1 w-64 rounded-lg border border-surface-border bg-white p-2 shadow-lg">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="mb-1 w-full rounded border border-surface-border px-1.5 py-1 text-xs outline-none"
          />
          <div className="max-h-56 space-y-0.5 overflow-auto">
            {options === null ? <p className="px-1 text-xs text-neutral-400">Loading…</p>
              : filtered.length === 0 ? <p className="px-1 text-xs text-neutral-400">No matches.</p>
              : filtered.map((o) => (
                <label key={o.id} className="flex items-center gap-2 px-1 py-0.5 text-xs hover:bg-surface-muted">
                  <input type="checkbox" checked={ids.includes(o.id)} onChange={() => toggle(o.id)} />
                  <span className="truncate">{o.label}</span>
                </label>
              ))}
          </div>
        </div>
      ) : null}
    </span>
  );
}
