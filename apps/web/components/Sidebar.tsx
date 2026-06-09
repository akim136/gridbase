"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export interface SidebarTable {
  tableId: string;
  name: string;
  firstViewId: string;
}

const KEY = "grid-sidebar-collapsed";

/** Left rail listing every table; links to each table's first view. Collapsible. */
export function Sidebar({ tables }: { tables: SidebarTable[] }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem(KEY) === "1");
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(KEY, next ? "1" : "0");
      return next;
    });
  };

  if (collapsed) {
    return (
      <nav className="flex w-11 flex-shrink-0 flex-col items-center border-r border-surface-border bg-white py-3">
        <button onClick={toggle} title="Expand sidebar" className="rounded-md p-1.5 text-neutral-400 hover:bg-surface-muted hover:text-neutral-700">
          »
        </button>
        <ul className="mt-2 flex flex-col items-center gap-1">
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
    <nav className="w-56 flex-shrink-0 border-r border-surface-border bg-white">
      <div className="flex items-start justify-between px-4 py-4">
        <div>
          <Link href="/" className="text-sm font-semibold tracking-tight text-neutral-900">gridbase</Link>
          <p className="mt-0.5 text-[11px] text-neutral-400">workspace</p>
        </div>
        <button onClick={toggle} title="Collapse sidebar" className="rounded-md p-1 text-neutral-400 hover:bg-surface-muted hover:text-neutral-700">
          «
        </button>
      </div>
      <ul className="space-y-0.5 px-2">
        {tables.map((t) => {
          const active = pathname.startsWith(`/t/${t.tableId}/`);
          return (
            <li key={t.tableId}>
              <Link
                href={`/t/${t.tableId}/${t.firstViewId}`}
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
  );
}
