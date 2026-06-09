"use client";
import { DndContext, type DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import Link from "next/link";
import { useEffect, useState } from "react";
import { updateRecord } from "@/lib/client";
import { fieldsForTable, type Meta, type RecordEnvelope, type ViewMeta } from "@/lib/types";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const dayOf = (v: unknown) => (typeof v === "string" && v.length >= 8 ? v.slice(0, 10) : null);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Month grid; events drag between days → optimistic move + PATCH the date field. */
export function CalendarView({
  meta,
  view,
  records,
}: {
  meta: Meta;
  view: ViewMeta;
  records: RecordEnvelope[];
}) {
  const [recs, setRecs] = useState(records);
  useEffect(() => setRecs(records), [records]);

  const dateId = view.config.calendar?.dateFieldId;
  const dateField = fieldsForTable(meta, view.tableId).find((f) => f.fieldId === dateId);
  const primaryId = meta.tables.find((t) => t.tableId === view.tableId)?.primaryFieldId;
  const today = new Date();
  const [cur, setCur] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  if (!dateField || !dateId) return <p className="text-neutral-500">This Calendar view has no date field configured.</p>;
  const dId: string = dateId;
  const dField = dateField;

  // 6×7 grid starting from the Monday on/before the 1st of the month.
  const first = new Date(cur.y, cur.m, 1);
  const offset = (first.getDay() + 6) % 7; // Mon=0
  const start = new Date(cur.y, cur.m, 1 - offset);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { date: iso(d.getFullYear(), d.getMonth(), d.getDate()), inMonth: d.getMonth() === cur.m };
  });

  const byDay = new Map<string, RecordEnvelope[]>();
  let undated = 0;
  for (const r of recs) {
    const day = dayOf(r.fields[dId]);
    if (!day) { undated++; continue; }
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(r);
  }

  async function onDragEnd(e: DragEndEvent) {
    const recordId = String(e.active.id);
    const day = e.over ? String(e.over.id) : null;
    if (!day) return;
    const rec = recs.find((r) => r.id === recordId);
    if (!rec || dayOf(rec.fields[dId]) === day) return;
    let next = day;
    if (dField.type === "datetime") {
      const t = String(rec.fields[dId] ?? "").slice(11);
      next = t ? `${day}T${t}` : `${day}T00:00:00`;
    }
    setRecs((rs) => rs.map((r) => (r.id === recordId ? { ...r, fields: { ...r.fields, [dateId!]: next } } : r)));
    try {
      await updateRecord(view.tableId, recordId, { [dId]: next });
    } catch (err) {
      setRecs(records);
      alert(`Reschedule failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const monthLabel = new Date(cur.y, cur.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const step = (delta: number) => setCur(({ y, m }) => { const d = new Date(y, m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex items-center justify-between pb-2">
        <h2 className="text-sm font-semibold text-neutral-700">{monthLabel}</h2>
        <div className="flex gap-1">
          <button onClick={() => step(-1)} className="rounded border border-surface-border px-2 py-0.5 text-sm hover:bg-surface-muted">←</button>
          <button onClick={() => setCur({ y: today.getFullYear(), m: today.getMonth() })} className="rounded border border-surface-border px-2 py-0.5 text-xs hover:bg-surface-muted">Today</button>
          <button onClick={() => step(1)} className="rounded border border-surface-border px-2 py-0.5 text-sm hover:bg-surface-muted">→</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-surface-border bg-surface-border text-xs">
        {WEEKDAYS.map((w) => <div key={w} className="bg-surface-muted px-2 py-1 font-medium text-neutral-500">{w}</div>)}
        {cells.map((cell) => (
          <DayCell key={cell.date} date={cell.date} inMonth={cell.inMonth} isToday={cell.date === iso(today.getFullYear(), today.getMonth(), today.getDate())}>
            {(byDay.get(cell.date) ?? []).map((rec) => (
              <Event key={rec.id} rec={rec} href={`/t/${view.tableId}/${view.viewId}/${rec.id}`} primaryId={primaryId} />
            ))}
          </DayCell>
        ))}
      </div>
      {undated > 0 ? <p className="mt-2 text-xs text-neutral-400">{undated} record(s) with no {dateField.name}.</p> : null}
    </DndContext>
  );
}

function DayCell({ date, inMonth, isToday, children }: { date: string; inMonth: boolean; isToday: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  return (
    <div ref={setNodeRef} className={`min-h-[5rem] p-1 ${inMonth ? "bg-white" : "bg-surface-muted/40"} ${isOver ? "ring-1 ring-inset ring-blue-300" : ""}`}>
      <div className={`mb-1 text-[10px] ${isToday ? "font-bold text-blue-600" : "text-neutral-400"}`}>{Number(date.slice(8))}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Event({ rec, href, primaryId }: { rec: RecordEnvelope; href: string; primaryId?: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: rec.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 } : undefined;
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}
      className={`rounded bg-blue-50 px-1 py-0.5 text-[11px] text-blue-700 ${isDragging ? "opacity-60" : ""}`}>
      <Link href={href} onClick={(e) => isDragging && e.preventDefault()} className="block truncate">
        {primaryId && rec.fields[primaryId] ? String(rec.fields[primaryId]) : "(untitled)"}
      </Link>
    </div>
  );
}
