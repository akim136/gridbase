"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export interface SidebarTable {
  tableId: string;
  name: string;
  firstViewId: string;
}

const KEY = "grid-sidebar-collapsed";

/** Below this width the expanded sidebar overlays the content instead of
 *  squeezing it, and the default state is collapsed. */
const MOBILE_QUERY = "(max-width: 639px)";

/** Left rail listing every table; links to each table's first view. Collapsible;
 *  on phones it defaults to the icon rail and expands as an overlay. */
export function Sidebar({ tables }: { tables: SidebarTable[] }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    // No saved preference → collapse on small screens, expand on desktop.
    setCollapsed(stored === null ? window.matchMedia(MOBILE_QUERY).matches : stored === "1");
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(KEY, next ? "1" : "0");
      return next;
    });
  };
  // After navigating on a phone, fold the overlay out of the way.
  const collapseIfMobile = () => {
    if (window.matchMedia(MOBILE_QUERY).matches) setCollapsed(true);
  };

  if (collapsed) {
    return (
      <nav className="flex w-11 flex-shrink-0 flex-col items-center border-r border-surface-border bg-white py-3">
        <Link href="/" title="gridbase" className="mb-1">
          <Image src="/grid.png" alt="gridbase" width={28} height={28} className="rounded" />
        </Link>
        <button onClick={toggle} title="Expand sidebar" className="rounded-md p-1.5 text-neutral-400 hover:bg-surface-muted hover:text-neutral-700">
          »
        </button>
        <ul className="mt-2 flex flex-col items-center gap-1">
          <li>
            <Link
              href="/d"
              title="Dashboards"
              className={`flex h-7 w-7 items-center justify-center rounded-md text-xs ${
                pathname.startsWith("/d") ? "bg-blue-50 text-blue-700" : "text-neutral-500 hover:bg-surface-muted"
              }`}
            >
              📊
            </Link>
          </li>
          {tables.map((t) => {
            const active = pathname.startsWith(`/t/${t.tableId}/`);
            return (
              <li key={t.tableId}>
                <Link
                  href={`/t/${t.tableId}/${t.firstViewId}`}
                  title={t.name}
                  className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium ${
                    active ? "bg-blue-50 text-blue-700" : "text-neutral-500 hover:bg-surface-muted"
                  }`}
                >
                  {t.name.slice(0, 2)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <>
      {/* Mobile: the expanded sidebar floats over the content (tap the backdrop
          to close) so it doesn't eat the viewport; ≥sm it sits in the flow. */}
      <div className="fixed inset-0 z-40 bg-black/30 sm:hidden" onClick={toggle} aria-hidden />
      <nav className="fixed inset-y-0 left-0 z-50 w-64 overflow-y-auto border-r border-surface-border bg-white sm:static sm:z-auto sm:w-56 sm:flex-shrink-0">
        <div className="flex items-start justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <Link href="/" title="gridbase" className="flex-shrink-0">
              <Image src="/grid.png" alt="gridbase" width={28} height={28} className="rounded" />
            </Link>
            <div>
              <Link href="/" className="text-sm font-semibold tracking-tight text-neutral-900">gridbase</Link>
              <p className="mt-0.5 text-[11px] text-neutral-400">workspace</p>
            </div>
          </div>
          <button onClick={toggle} title="Collapse sidebar" className="rounded-md p-1 text-neutral-400 hover:bg-surface-muted hover:text-neutral-700">
            «
          </button>
        </div>
        <ul className="space-y-0.5 px-2">
          <li>
            <Link
              href="/d"
              onClick={collapseIfMobile}
              className={`block rounded-md px-3 py-1.5 text-sm ${
                pathname.startsWith("/d") ? "bg-blue-50 font-medium text-blue-700" : "text-neutral-700 hover:bg-surface-muted"
              }`}
            >
              📊 Dashboards
            </Link>
          </li>
          <li className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-wide text-neutral-400">Tables</li>
          {tables.map((t) => {
            const active = pathname.startsWith(`/t/${t.tableId}/`);
            return (
              <li key={t.tableId}>
                <Link
                  href={`/t/${t.tableId}/${t.firstViewId}`}
                  onClick={collapseIfMobile}
                  className={`block rounded-md px-3 py-1.5 text-sm ${
                    active ? "bg-blue-50 font-medium text-blue-700" : "text-neutral-700 hover:bg-surface-muted"
                  }`}
                >
                  {t.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
