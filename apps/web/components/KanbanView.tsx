"use client";
import { DndContext, type DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { updateRecord } from "@/lib/client";
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

  const previewFields = fields.filter((f) => f.fieldId !== primaryId && f.fieldId !== stackId && f.type !== "link").slice(0, 3);
  const columns = [
    ...(stackField.options?.choices?.map((c) => ({ id: c.name, label: c.name })) ?? []),
    { id: UNSET, label: "Uncategorized" },
  ];
  const bucketOf = (rec: RecordEnvelope) => {
    const v = rec.fields[stackId];
    return v == null || v === "" ? UNSET : String(v);
  };

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
                  primaryId={primaryId}
                  previewFields={previewFields}
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

function Card({ rec, href, primaryId, previewFields }: { rec: RecordEnvelope; href: string; primaryId?: string; previewFields: FieldMeta[] }) {
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
        {primaryId && rec.fields[primaryId] ? String(rec.fields[primaryId]) : "(untitled)"}
      </Link>
      {previewFields.map((f) => {
        const v = rec.fields[f.fieldId];
        if (v == null || v === "") return null;
        return (
          <div key={f.fieldId} className="truncate text-xs text-neutral-500">
            <span className="text-neutral-400">{f.name}:</span> {String(v)}
          </div>
        );
      })}
    </div>
  );
}
