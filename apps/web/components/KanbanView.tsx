"use client";
import { DndContext, type DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createRecord, updateRecord, updateViewConfig } from "@/lib/client";
import { previewValue, recordTitle } from "@/lib/preview";
import { type FieldMeta, fieldsForTable, type Meta, type RecordEnvelope, type ViewMeta, visibleFields } from "@/lib/types";

const UNSET = "__unset__";

/**
 * Kanban grouped by a singleSelect stack field. Cards drag between columns →
 * optimistic move + PATCH the stack field (null for the Uncategorized column).
 */
export function KanbanView({
  meta,
  view,
  records,
  labels,
}: {
  meta: Meta;
  view: ViewMeta;
  records: RecordEnvelope[];
  labels: Map<string, string>;
}) {
  const router = useRouter();
  const [recs, setRecs] = useState(records);
  useEffect(() => setRecs(records), [records]);

  const stackId = view.config.kanban?.stackFieldId;
  const fields = visibleFields(meta, view);
  const stackField = fieldsForTable(meta, view.tableId).find((f) => f.fieldId === stackId);
  const primaryId = meta.tables.find((t) => t.tableId === view.tableId)?.primaryFieldId;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  if (!stackField || !stackId) return <p className="text-neutral-500">This Kanban view has no stack field configured.</p>;

  // Card fields follow the view's FieldEditor (show/hide/reorder) — the single
  // source of truth — minus the stack (it's the column) and the primary (the
  // card title). A soft cap (default 8) keeps cards readable.
  const maxPreview = view.config.kanban?.maxPreviewFields ?? 8;
  const previewFields = fields
    .filter((f) => f.fieldId !== primaryId && f.fieldId !== stackId)
    .slice(0, maxPreview);
  const bucketOf = (rec: RecordEnvelope) => {
    const v = rec.fields[stackId];
    return v == null || v === "" ? UNSET : String(v);
  };
  // Columns = the field's defined options, plus any value present in records that
  // isn't a defined option (so no record silently vanishes when choices are
  // incomplete). A saved columnOrder pins the left-to-right order; anything not
  // listed follows in natural order. Uncategorized is always last.
  const defined = stackField.options?.choices?.map((c) => c.name) ?? [];
  const present = recs.map(bucketOf).filter((b) => b !== UNSET);
  const all = [...new Set([...defined, ...present])];
  const order = view.config.kanban?.columnOrder ?? [];
  const sorted = [...order.filter((n) => all.includes(n)), ...all.filter((n) => !order.includes(n))];
  const columns = [
    ...sorted.map((name) => ({ id: name, label: name })),
    { id: UNSET, label: "Uncategorized" },
  ];

  async function onDragEnd(e: DragEndEvent) {
    const recordId = String(e.active.id);
    const target = e.over ? String(e.over.id) : null;
    if (!target) return;
    const rec = recs.find((r) => r.id === recordId);
    if (!rec || bucketOf(rec) === target) return;
    const newValue = target === UNSET ? null : target;
    setRecs((rs) => rs.map((r) => (r.id === recordId ? { ...r, fields: { ...r.fields, [stackId!]: newValue ?? undefined } } : r)));
    try {
      await updateRecord(view.tableId, recordId, { [stackId!]: newValue });
    } catch (err) {
      setRecs(records);
      alert(`Move failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Quick-add: a blank record pre-filled with this column's stack value, ready
  // for inline editing on its detail page.
  async function addToColumn(columnId: string) {
    try {
      const res = await createRecord(view.tableId, columnId === UNSET ? {} : { [stackId!]: columnId });
      const id = res.records[0]?.id;
      if (id) router.push(`/t/${view.tableId}/${view.viewId}/${id}`);
      router.refresh();
    } catch (err) {
      alert(`Add failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Collapsed columns shrink to a slim vertical bar (persisted per view).
  const collapsed = new Set(view.config.kanban?.collapsedColumns ?? []);
  async function setCollapsed(columnId: string, on: boolean) {
    const next = on ? [...collapsed, columnId] : [...collapsed].filter((c) => c !== columnId);
    try {
      await updateViewConfig(view.viewId, { ...view.config, kanban: { ...view.config.kanban!, collapsedColumns: next } });
      router.refresh();
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const cards = recs.filter((r) => bucketOf(r) === col.id);
          if (collapsed.has(col.id)) {
            return (
              <CollapsedColumn key={col.id} id={col.id} label={col.label} count={cards.length} onExpand={() => setCollapsed(col.id, false)} />
            );
          }
          return (
            <Column key={col.id} id={col.id} label={col.label} count={cards.length} onCollapse={() => setCollapsed(col.id, true)} onAdd={() => addToColumn(col.id)}>
              {cards.map((rec) => (
                <Card
                  key={rec.id}
                  rec={rec}
                  href={`/t/${view.tableId}/${view.viewId}/${rec.id}`}
                  title={recordTitle(meta, view, rec)}
                  previewFields={previewFields}
                  labels={labels}
                />
              ))}
            </Column>
          );
        })}
      </div>
    </DndContext>
  );
}

function Column({ id, label, count, onCollapse, onAdd, children }: { id: string; label: string; count: number; onCollapse: () => void; onAdd: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`group/col w-64 flex-shrink-0 rounded-lg p-1 ${isOver ? "bg-blue-50 ring-1 ring-blue-200" : ""}`}>
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</span>
        <span className="text-xs text-neutral-400">{count}</span>
        <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/col:opacity-100">
          <button type="button" title="New record in this column" onClick={onAdd} className="rounded px-1 text-neutral-400 hover:bg-surface-muted hover:text-blue-600">+</button>
          <button type="button" title="Collapse column" onClick={onCollapse} className="rounded px-1 text-neutral-400 hover:bg-surface-muted hover:text-neutral-700">⇤</button>
        </span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

/** A collapsed bucket: slim vertical bar showing the name + count; still a drop
 *  target, click to expand. */
function CollapsedColumn({ id, label, count, onExpand }: { id: string; label: string; count: number; onExpand: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onExpand}
      title={`Expand ${label}`}
      className={`flex w-9 flex-shrink-0 flex-col items-center gap-2 rounded-lg border border-surface-border bg-surface-muted/60 py-2 ${isOver ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-surface-muted"}`}
    >
      <span className="text-xs text-neutral-400">{count}</span>
      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500" style={{ writingMode: "vertical-rl" }}>
        {label}
      </span>
    </button>
  );
}

function Card({ rec, href, title, previewFields, labels }: { rec: RecordEnvelope; href: string; title: string; previewFields: FieldMeta[]; labels: Map<string, string> }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: rec.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 } : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`rounded-lg border border-surface-border bg-white p-3 shadow-sm ${isDragging ? "opacity-60" : "hover:border-blue-300"}`}
    >
      <Link href={href} className="mb-1 block font-medium text-neutral-900" onClick={(e) => isDragging && e.preventDefault()}>
        {title}
      </Link>
      {previewFields.map((f) => {
        const text = previewValue(f, rec.fields[f.fieldId], labels);
        if (!text) return null;
        return (
          <div key={f.fieldId} className="truncate text-xs text-neutral-500">
            <span className="text-neutral-400">{f.name}:</span> {text}
          </div>
        );
      })}
    </div>
  );
}
