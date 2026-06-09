import type { FieldMeta } from "@/lib/types";
import { LinkChips } from "./LinkChips";

const chip = "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium";

/**
 * Render one cell value in its field-type-appropriate form. Read-only (Phase 1).
 * `labels` maps linked record id → primary-field label; `linkTargets` maps a
 * table id → its detail base path so link chips can navigate.
 */
export function Cell({
  field,
  value,
  labels,
  linkTargets = {},
}: {
  field: FieldMeta;
  value: unknown;
  labels: Map<string, string>;
  linkTargets?: Record<string, string>;
}) {
  if (value === undefined || value === null || value === "") {
    return <span className="text-neutral-300">—</span>;
  }

  switch (field.type) {
    case "checkbox":
      return value ? <span className="text-emerald-600">✓</span> : <span className="text-neutral-300">—</span>;

    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      return <span className="tabular-nums">{Number.isInteger(n) ? n : n.toFixed(2)}</span>;
    }

    case "formula": {
      const n = typeof value === "number" ? value : Number(value);
      const pretty = Number.isFinite(n) ? (Number.isInteger(n) ? n : n.toFixed(2)) : String(value);
      return <span className="tabular-nums text-neutral-600">{pretty}</span>;
    }

    case "select":
      return <span className={`${chip} bg-neutral-100 text-neutral-700`}>{String(value)}</span>;

    case "multiselect": {
      const arr = Array.isArray(value) ? value : [value];
      return (
        <span className="flex flex-wrap gap-1">
          {arr.map((v, i) => (
            <span key={i} className={`${chip} bg-neutral-100 text-neutral-700`}>{String(v)}</span>
          ))}
        </span>
      );
    }

    case "link": {
      const ids = Array.isArray(value) ? (value as string[]) : [String(value)];
      const chipLabels = Object.fromEntries(ids.map((id) => [id, labels.get(id) ?? id]));
      const basePath = field.options?.linkedTableId ? linkTargets[field.options.linkedTableId] : undefined;
      return <LinkChips ids={ids} labels={chipLabels} basePath={basePath} />;
    }

    case "lookup": {
      const arr = Array.isArray(value) ? value : [value];
      return (
        <span className="flex flex-wrap gap-1">
          {arr.map((v, i) => (
            <span key={i} className={`${chip} bg-neutral-100 text-neutral-600`}>
              {typeof v === "boolean" ? (v ? "✓" : "✗") : String(v)}
            </span>
          ))}
        </span>
      );
    }

    case "url":
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
          {String(value).replace(/^https?:\/\//, "").slice(0, 40)}
        </a>
      );

    case "email":
      return <a href={`mailto:${value}`} className="text-blue-600 hover:underline">{String(value)}</a>;

    case "longtext":
      return <span className="block max-w-md truncate text-neutral-700" title={String(value)}>{String(value)}</span>;

    default:
      return <span className="text-neutral-800">{String(value)}</span>;
  }
}
