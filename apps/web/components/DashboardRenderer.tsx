"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateDashboard } from "@/lib/client";
import type { DashboardMeta, Meta, Widget } from "@/lib/types";
import { DashboardWidget, type WidgetResult } from "./DashboardWidget";
import { WidgetBuilder } from "./WidgetBuilder";

/** A dashboard: a grid of widgets you can add/edit/remove/reorder. Each edit
 *  PATCHes the dashboard config, then refreshes so the server recomputes widget data. */
export function DashboardRenderer({ dashboard, meta, data }: { dashboard: DashboardMeta; meta: Meta; data: Record<string, WidgetResult> }) {
  const router = useRouter();
  const [editing, setEditing] = useState<null | { widget: Widget | null }>(null);
  const [busy, setBusy] = useState(false);
  const widgets = dashboard.config.widgets ?? [];

  async function persist(next: Widget[]) {
    setBusy(true);
    try {
      await updateDashboard(dashboard.dashboardId, { config: { widgets: next } });
      router.refresh();
    } catch (e) {
      alert(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function onSave(w: Widget) {
    const exists = widgets.some((x) => x.widgetId === w.widgetId);
    setEditing(null);
    void persist(exists ? widgets.map((x) => (x.widgetId === w.widgetId ? w : x)) : [...widgets, w]);
  }
  function remove(id: string) {
    if (window.confirm("Remove this widget?")) void persist(widgets.filter((w) => w.widgetId !== id));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    [next[i], next[j]] = [next[j]!, next[i]!];
    void persist(next);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">{dashboard.name}</h1>
        <div className="flex items-center gap-2">
          {busy ? <span className="text-xs text-neutral-400">Saving…</span> : null}
          <button disabled={busy} onClick={() => setEditing({ widget: null })} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            + Add widget
          </button>
        </div>
      </div>

      {widgets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-surface-border p-10 text-center text-sm text-neutral-400">
          No widgets yet — add a KPI, chart, or report from any table.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {widgets.map((w, i) => (
            <div key={w.widgetId} className="rounded-lg border border-surface-border bg-white p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="truncate text-sm font-medium text-neutral-700">{w.title || "(untitled)"}</span>
                {/* Disabled while a PATCH is in flight: every action rewrites the
                    whole widgets[] from the (stale until refresh) prop, so a second
                    click would clobber the first write. */}
                <span className="flex items-center gap-1.5 text-neutral-300">
                  <button disabled={busy} title="Move left" onClick={() => move(i, -1)} className="hover:text-neutral-600 disabled:opacity-40">←</button>
                  <button disabled={busy} title="Move right" onClick={() => move(i, 1)} className="hover:text-neutral-600 disabled:opacity-40">→</button>
                  <button disabled={busy} title="Edit" onClick={() => setEditing({ widget: w })} className="hover:text-neutral-600 disabled:opacity-40">✎</button>
                  <button disabled={busy} title="Remove" onClick={() => remove(w.widgetId)} className="hover:text-red-500 disabled:opacity-40">✕</button>
                </span>
              </div>
              <DashboardWidget widget={w} meta={meta} result={data[w.widgetId]} />
            </div>
          ))}
        </div>
      )}

      {editing ? <WidgetBuilder meta={meta} initial={editing.widget} onSave={onSave} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
