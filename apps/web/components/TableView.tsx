"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { loadMoreRecords } from "@/app/t/[tableId]/[viewId]/actions";
import { deleteRecords } from "@/lib/client";
import { EditableCell } from "./EditableCell";
import { AddRowButton } from "./RecordActions";
import { linkPrimaries as buildLinkPrimaries, linkTargets as buildLinkTargets, type Meta, type RecordEnvelope, type ViewMeta, visibleFields } from "@/lib/types";

const FROZEN_W = 200; // fixed width for frozen columns so left offsets are computable
const CHECKBOX_W = 40; // leading selection column

/**
 * Generic table/grid view. Header row freezes by default (stays visible scrolling
 * down); the first `config.frozen` columns freeze (stay visible scrolling right) —
 * both saved per view. The whole table is one scroll container so sticky works.
 *
 * Client component: it owns row selection (bulk delete) and cursor "load more"
 * pagination, seeded from the server-rendered first page.
 */
export function TableView({
  meta,
  view,
  records,
  labels,
  initialOffset,
}: {
  meta: Meta;
  view: ViewMeta;
  records: RecordEnvelope[];
  labels: Map<string, string>;
  initialOffset?: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(records);
  const [labelMap, setLabelMap] = useState(labels);
  const [offset, setOffset] = useState(initialOffset);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [deleting, startDelete] = useTransition();

  // A server refresh (e.g. after delete/edit) re-seeds from the fresh first page.
  useEffect(() => {
    setRows(records);
    setLabelMap(labels);
    setOffset(initialOffset);
    setSelected(new Set());
  }, [records, labels, initialOffset]);

  const targets = buildLinkTargets(meta);
  const primaries = buildLinkPrimaries(meta);
  const cols = visibleFields(meta, view);
  const primaryId = meta.tables.find((t) => t.tableId === view.tableId)?.primaryFieldId;
  const freezeHeader = view.config.freezeHeader !== false; // default on
  const frozen = view.config.frozen ?? 1; // default: freeze the first (record-name) column

  // Frozen data columns sit to the right of the always-frozen checkbox column.
  const colStyle = (i: number): React.CSSProperties =>
    i < frozen ? { position: "sticky", left: CHECKBOX_W + i * FROZEN_W, minWidth: FROZEN_W, width: FROZEN_W, maxWidth: FROZEN_W } : {};
  const thStyle = (i: number): React.CSSProperties => ({
    ...(freezeHeader || i < frozen ? { position: "sticky" } : {}),
    ...(freezeHeader ? { top: 0 } : {}),
    ...colStyle(i),
    zIndex: freezeHeader && i < frozen ? 30 : freezeHeader ? 20 : i < frozen ? 10 : undefined,
  });
  const tdStyle = (i: number): React.CSSProperties => (i < frozen ? { ...colStyle(i), zIndex: 10 } : {});
  // The selection column is always frozen at the far left.
  const selStyle = (header: boolean): React.CSSProperties => ({
    position: "sticky",
    left: 0,
    minWidth: CHECKBOX_W,
    width: CHECKBOX_W,
    ...(header && freezeHeader ? { top: 0 } : {}),
    zIndex: header ? 30 : 11,
  });

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  async function onLoadMore() {
    if (!offset) return;
    setLoadingMore(true);
    try {
      const res = await loadMoreRecords(view.tableId, view.viewId, offset);
      setRows((prev) => [...prev, ...res.records]);
      setLabelMap((prev) => new Map([...prev, ...res.labels]));
      setOffset(res.offset);
    } catch (e) {
      alert(`Load more failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingMore(false);
    }
  }

  function onDeleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} record${ids.length === 1 ? "" : "s"}? This can’t be undone.`)) return;
    startDelete(async () => {
      try {
        await deleteRecords(view.tableId, ids);
        setSelected(new Set());
        router.refresh();
      } catch (e) {
        alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      {selected.size > 0 ? (
        <div className="mb-2 flex items-center gap-3 rounded-lg border border-surface-border bg-surface-muted px-3 py-2 text-sm">
          <span className="text-neutral-600">{selected.size} selected</span>
          <button
            type="button"
            disabled={deleting}
            onClick={onDeleteSelected}
            className="rounded-md px-2.5 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
          <button type="button" className="text-xs text-neutral-400 hover:text-neutral-700" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-surface-border bg-white">
        <table className="border-collapse text-sm">
          <thead>
            <tr className="text-left">
              <th style={selStyle(true)} className="border-b border-r border-surface-border bg-surface-muted px-2 py-2">
                <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll} />
              </th>
              {cols.map((f, i) => (
                <th
                  key={f.fieldId}
                  style={thStyle(i)}
                  className={`whitespace-nowrap border-b border-surface-border bg-surface-muted px-3 py-2 font-medium text-neutral-500 ${i < frozen ? "border-r" : ""}`}
                >
                  {f.name}
                  {f.isComputed ? <span className="ml-1 text-[10px] text-neutral-400">ƒ</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={cols.length + 1} className="px-3 py-8 text-center text-neutral-400">No records.</td>
              </tr>
            ) : (
              rows.map((rec) => {
                const checked = selected.has(rec.id);
                return (
                  <tr key={rec.id} className={`group border-b border-surface-border last:border-0 ${checked ? "bg-blue-50/40" : ""}`}>
                    <td style={selStyle(false)} className="border-r border-surface-border bg-white px-2 py-2 align-top">
                      <input type="checkbox" aria-label="Select row" checked={checked} onChange={() => toggleOne(rec.id)} />
                    </td>
                    {cols.map((f, i) => {
                      const value = rec.fields[f.fieldId];
                      const isPrimary = f.fieldId === primaryId;
                      return (
                        <td
                          key={f.fieldId}
                          style={tdStyle(i)}
                          className={`px-3 py-2 align-top ${i < frozen ? "border-r border-surface-border bg-white" : "group-hover:bg-surface-muted/60"}`}
                        >
                          {isPrimary ? (
                            <Link
                              href={`/t/${view.tableId}/${view.viewId}/${rec.id}`}
                              className="font-medium text-neutral-900 hover:text-blue-600 hover:underline"
                            >
                              {value != null && value !== "" ? String(value) : "(untitled)"}
                            </Link>
                          ) : (
                            <EditableCell
                              tableId={view.tableId}
                              recordId={rec.id}
                              field={f}
                              value={value}
                              labels={labelMap}
                              linkTargets={targets}
                              linkPrimaries={primaries}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <div className="sticky left-0 flex items-center gap-3 border-t border-surface-border p-2">
          <AddRowButton tableId={view.tableId} />
          {offset ? (
            <button
              type="button"
              disabled={loadingMore}
              onClick={onLoadMore}
              className="rounded-md border border-surface-border px-3 py-1.5 text-sm text-neutral-600 hover:bg-surface-muted disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          ) : null}
          <span className="text-xs text-neutral-400">{rows.length} loaded{offset ? "+" : ""}</span>
        </div>
      </div>
    </div>
  );
}
