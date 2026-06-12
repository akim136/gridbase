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
import { getMeta, listAllRecords, listRecords } from "@/lib/server/gridApi";
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

  // The table view paginates ("Load more"); layout views render the whole set,
  // so they fetch every page up front (bounded) — otherwise kanban/calendar/
  // gallery/gantt silently showed only the first 100 records.
  const isLayoutView = view.type === "kanban" || view.type === "calendar" || view.type === "gallery" || view.type === "gantt";
  const { records, offset } = isLayoutView
    ? { ...(await listAllRecords(tableId, { sort: view.config.sorts, filter: view.config.filters })), offset: undefined }
    : await listRecords(tableId, { sort: view.config.sorts, filter: view.config.filters, pageSize: 100 });

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
      {/* Rows wrap on narrow screens so the toolbar can't push past the viewport
          (which dragged its right-anchored popovers off-page on mobile). */}
      <header className="border-b border-surface-border bg-white px-3 pt-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight text-neutral-900">{table.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-400">{records.length}{offset ? "+" : ""} records</span>
            <ImportButton tableId={tableId} fields={fields} />
            <NewRecordButton tableId={tableId} fields={fields} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4">
          <ViewSwitcher tableId={tableId} currentViewId={viewId} views={allViews} currentConfig={view.config} />
          {view.type !== "form" ? <ViewToolbar viewId={viewId} viewType={view.type} fields={fields} config={view.config} meta={meta} /> : null}
        </div>
      </header>

      {/* TableView (the table + detail fallthrough) owns its own scroll container,
          so its wrapper must clip; every other view scrolls in the wrapper. */}
      <div className={`flex-1 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-5 ${view.type === "table" || view.type === "detail" ? "overflow-hidden" : "overflow-auto"}`}>
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
