"use client";
import { DndContext, type DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { updateRecord } from "@/lib/client";
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

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const cards = recs.filter((r) => bucketOf(r) === col.id);
          return (
            <Column key={col.id} id={col.id} label={col.label} count={cards.length}>
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

function Column({ id, label, count, children }: { id: string; label: string; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`w-64 flex-shrink-0 rounded-lg p-1 ${isOver ? "bg-blue-50 ring-1 ring-blue-200" : ""}`}>
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</span>
        <span className="text-xs text-neutral-400">{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
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
