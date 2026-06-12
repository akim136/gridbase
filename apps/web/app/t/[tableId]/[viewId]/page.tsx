import { notFound } from "next/navigation";
import { CalendarView } from "@/components/CalendarView";
import { DashboardView } from "@/components/DashboardView";
import { FormRenderer } from "@/components/FormRenderer";
import { GalleryView } from "@/components/GalleryView";
import { GanttView } from "@/components/GanttView";
import { ImportButton } from "@/components/ImportDialog";
import { KanbanView } from "@/components/KanbanView";
import { NewRecordButton } from "@/components/NewRecordDialog";
import { TableView } from "@/components/TableView";
import { ViewSwitcher } from "@/components/ViewSwitcher";
import { ViewToolbar } from "@/components/ViewToolbar";
import { getMeta, listRecords } from "@/lib/server/gridApi";
import { fieldsForTable, visibleFields } from "@/lib/types";
import { resolveLinkLabels } from "@/lib/server/labels";

export const dynamic = "force-dynamic";

export default async function ViewPage({
  params,
}: {
  params: Promise<{ tableId: string; viewId: string }>;
}) {
  const { tableId, viewId } = await params;
  const meta = await getMeta();
  const table = meta.tables.find((t) => t.tableId === tableId);
  const view = meta.views.find((v) => v.viewId === viewId && v.tableId === tableId);
  if (!table || !view) notFound();

  const { records, offset } = await listRecords(tableId, {
    sort: view.config.sorts,
    filter: view.config.filters,
    pageSize: 100,
  });

  const fields = fieldsForTable(meta, tableId);
  const labels = await resolveLinkLabels(meta, fields, records);

  const tableViews = meta.views
    .filter((v) => v.tableId === tableId && !v.isHidden)
    .sort((a, b) => a.position - b.position)
    .map((v) => ({ viewId: v.viewId, name: v.name, type: v.type }));
  const allViews = meta.views
    .filter((v) => v.tableId === tableId)
    .sort((a, b) => a.position - b.position)
    .map((v) => ({ viewId: v.viewId, name: v.name, type: v.type, isHidden: v.isHidden }));

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-surface-border bg-white px-5 pt-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight text-neutral-900">{table.name}</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-400">{records.length}{offset ? "+" : ""} records</span>
            <ImportButton tableId={tableId} fields={fields} />
            <NewRecordButton tableId={tableId} fields={fields} />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <ViewSwitcher tableId={tableId} currentViewId={viewId} views={allViews} currentConfig={view.config} />
          {view.type !== "form" ? <ViewToolbar viewId={viewId} viewType={view.type} fields={fields} config={view.config} meta={meta} /> : null}
        </div>
      </header>

      <div className={`flex-1 p-5 ${view.type === "table" ? "overflow-hidden" : "overflow-auto"}`}>
        {view.type === "kanban" ? (
          <KanbanView meta={meta} view={view} records={records} labels={labels} />
        ) : view.type === "calendar" ? (
          <CalendarView meta={meta} view={view} records={records} />
        ) : view.type === "gallery" ? (
          <GalleryView meta={meta} view={view} records={records} labels={labels} />
        ) : view.type === "gantt" ? (
          <GanttView meta={meta} view={view} records={records} />
        ) : view.type === "form" ? (
          <FormRenderer tableId={tableId} fields={visibleFields(meta, view)} title={view.config.form?.title ?? view.name} />
        ) : view.type === "dashboard" ? (
          <DashboardView meta={meta} view={view} records={records} />
        ) : (
          <TableView meta={meta} view={view} records={records} labels={labels} initialOffset={offset} />
        )}
      </div>
    </div>
  );
}
