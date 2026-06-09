"use client";
import Link from "next/link";
import { useState } from "react";

const chip = "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100";

/**
 * Render linked-record chips. Each chip navigates to that record's detail when a
 * `basePath` is given (`/t/{tableId}/{viewId}` → `${basePath}/${id}`). Long lists
 * are capped at `max` with a "show all" toggle so a record with many links
 * (e.g. a Company with dozens of Roles) doesn't blow up its row height.
 */
export function LinkChips({
  ids,
  labels,
  basePath,
  max = 5,
}: {
  ids: string[];
  labels: Record<string, string>;
  basePath?: string;
  max?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (ids.length === 0) return <span className="text-neutral-300">—</span>;

  const shown = expanded ? ids : ids.slice(0, max);
  const hidden = ids.length - shown.length;

  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((id) => {
        const label = labels[id] ?? id;
        return basePath ? (
          <Link key={id} href={`${basePath}/${id}`} className={chip} prefetch={false}>
            {label}
          </Link>
        ) : (
          <span key={id} className={chip}>{label}</span>
        );
      })}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100"
        >
          +{hidden} more
        </button>
      ) : null}
      {expanded && ids.length > max ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100"
        >
          show less
        </button>
      ) : null}
    </span>
  );
}
