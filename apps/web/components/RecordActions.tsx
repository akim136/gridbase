"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createRecord, deleteRecord } from "@/lib/client";

/** Adds a blank record to the table, then refreshes so it appears (editable inline). */
export function AddRowButton({ tableId }: { tableId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await createRecord(tableId, {});
          router.refresh();
        } catch (e) {
          alert(`Add failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setBusy(false);
        }
      }}
      className="flex items-center gap-1 rounded-md border border-dashed border-surface-border px-3 py-1.5 text-sm text-neutral-500 hover:border-blue-300 hover:text-blue-600"
    >
      + New record
    </button>
  );
}

/** Deletes a record (with confirm), then navigates back to the view. */
export function DeleteRecordButton({ tableId, recordId, backHref }: { tableId: string; recordId: string; backHref: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("Delete this record? This can’t be undone.")) return;
        setBusy(true);
        try {
          await deleteRecord(tableId, recordId);
          router.push(backHref);
          router.refresh();
        } catch (e) {
          alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
          setBusy(false);
        }
      }}
      className="rounded-md px-2.5 py-1 text-sm text-red-600 hover:bg-red-50"
    >
      Delete
    </button>
  );
}
