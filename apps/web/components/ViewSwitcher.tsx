"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createView, deleteView, hideView, renameView } from "@/lib/client";
import { VIEW_TYPES, type ViewConfig, type ViewType } from "@/lib/types";

export interface SwitcherView {
  viewId: string;
  name: string;
  type: string;
  isHidden: boolean;
}

// One registry per view type, keyed by the shared ViewType union — adding a view
// type without an entry here is a compile error, so the icon/label/addable lists
// can't silently drift. (detail is API-creatable but not offered in the menu.)
const TYPE_INFO: Record<ViewType, { icon: string; label: string; addable: boolean }> = {
  table: { icon: "▦", label: "Grid", addable: true },
  kanban: { icon: "▤", label: "Kanban", addable: true },
  calendar: { icon: "▥", label: "Calendar", addable: true },
  gallery: { icon: "▣", label: "Gallery", addable: true },
  gantt: { icon: "≡", label: "Gantt", addable: true },
  form: { icon: "✎", label: "Form", addable: true },
  dashboard: { icon: "📊", label: "Dashboard", addable: true },
  detail: { icon: "❏", label: "Detail", addable: false },
};
const ADDABLE = VIEW_TYPES.filter((t) => TYPE_INFO[t].addable).map((type) => ({ type, label: TYPE_INFO[type].label }));
const iconOf = (type: string): string => TYPE_INFO[type as ViewType]?.icon ?? "▦";

/** Tabs across a table's views + a manager (add / rename / duplicate / hide / delete). */
export function ViewSwitcher({
  tableId,
  currentViewId,
  views,
  currentConfig,
}: {
  tableId: string;
  currentViewId: string;
  views: SwitcherView[];
  currentConfig: ViewConfig;
}) {
  const router = useRouter();
  const [menu, setMenu] = useState<null | "add" | "current">(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const visible = views.filter((v) => !v.isHidden);

  async function add(type: string) {
    const name = window.prompt(`Name for the new ${type} view?`, `${type[0]!.toUpperCase()}${type.slice(1)}`);
    if (!name) return;
    setMenu(null);
    const v = await createView({ tableId, name, type });
    router.push(`/t/${tableId}/${v.viewId}`);
    router.refresh();
  }
  async function duplicate() {
    const cur = views.find((v) => v.viewId === currentViewId);
    const name = window.prompt("Name for the duplicated view?", `${cur?.name ?? "View"} copy`);
    if (!name) return;
    setMenu(null);
    const v = await createView({ tableId, name, type: cur?.type ?? "table", config: currentConfig });
    router.push(`/t/${tableId}/${v.viewId}`);
    router.refresh();
  }
  async function rename() {
    const cur = views.find((v) => v.viewId === currentViewId);
    const name = window.prompt("Rename view", cur?.name ?? "");
    if (!name) return;
    setMenu(null);
    await renameView(currentViewId, name);
    router.refresh();
  }
  async function hide() {
    setMenu(null);
    await hideView(currentViewId, true);
    const next = visible.find((v) => v.viewId !== currentViewId);
    if (next) router.push(`/t/${tableId}/${next.viewId}`);
    router.refresh();
  }
  async function remove() {
    if (!window.confirm("Delete this view? (the underlying data is unaffected)")) return;
    setMenu(null);
    await deleteView(currentViewId);
    const next = visible.find((v) => v.viewId !== currentViewId);
    if (next) router.push(`/t/${tableId}/${next.viewId}`);
    router.refresh();
  }

  return (
    <div ref={ref} className="relative flex flex-wrap items-center gap-1">
      {visible.map((v) => {
        const active = v.viewId === currentViewId;
        return (
          <span key={v.viewId} className="flex items-center">
            <Link
              href={`/t/${tableId}/${v.viewId}`}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
                active ? "border-blue-600 font-medium text-blue-700" : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              <span className="text-xs">{iconOf(v.type)}</span>
              {v.name}
            </Link>
            {active ? (
              <button className="px-1 text-neutral-400 hover:text-neutral-700" onClick={() => setMenu(menu === "current" ? null : "current")}>⋯</button>
            ) : null}
          </span>
        );
      })}
      <button className="ml-1 rounded px-2 py-1 text-sm text-neutral-400 hover:bg-surface-muted hover:text-neutral-700"
        onClick={() => setMenu(menu === "add" ? null : "add")}>+</button>

      {menu === "add" ? (
        <div className="absolute top-full left-0 z-40 mt-1 w-40 rounded-lg border border-surface-border bg-white py-1 shadow-lg">
          <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-neutral-400">Add view</p>
          {ADDABLE.map((a) => (
            <button key={a.type} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-neutral-700 hover:bg-surface-muted" onClick={() => add(a.type)}>
              <span className="text-xs">{iconOf(a.type)}</span>{a.label}
            </button>
          ))}
        </div>
      ) : null}
      {menu === "current" ? (
        <div className="absolute top-full z-40 mt-1 w-36 rounded-lg border border-surface-border bg-white py-1 shadow-lg" style={{ left: "8rem" }}>
          <button className="block w-full px-3 py-1.5 text-left text-sm text-neutral-700 hover:bg-surface-muted" onClick={rename}>Rename</button>
          <button className="block w-full px-3 py-1.5 text-left text-sm text-neutral-700 hover:bg-surface-muted" onClick={duplicate}>Duplicate</button>
          <button className="block w-full px-3 py-1.5 text-left text-sm text-neutral-700 hover:bg-surface-muted" onClick={hide}>Hide</button>
          <button className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50" onClick={remove}>Delete</button>
        </div>
      ) : null}
    </div>
  );
}
