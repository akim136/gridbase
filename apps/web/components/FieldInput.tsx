"use client";
import type { FieldMeta } from "@/lib/types";

const cls = "w-full rounded border border-surface-border px-2 py-1 text-sm outline-none focus:border-blue-400";

/** Field types a create-form can set (links are set after creation via the grid). */
export const WRITABLE = new Set([
  "text", "longtext", "number", "select", "multiselect", "checkbox", "date", "datetime", "url", "email",
]);

/**
 * Controlled input for one field — value + onChange held by the parent (forms,
 * the new-record modal, import mapping). Scalar/select/checkbox/date types;
 * computed/lookup/link are excluded (see WRITABLE).
 */
export function FieldInput({
  field,
  value,
  onChange,
  autoFocus,
}: {
  field: FieldMeta;
  value: unknown;
  onChange: (v: unknown) => void;
  autoFocus?: boolean;
}) {
  switch (field.type) {
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4"
        />
      );

    case "select":
      return (
        <select className={cls} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} autoFocus={autoFocus}>
          <option value="">—</option>
          {field.options?.choices?.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
      );

    case "multiselect": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (name: string) => onChange(arr.includes(name) ? arr.filter((x) => x !== name) : [...arr, name]);
      return (
        <div className="flex flex-wrap gap-1">
          {field.options?.choices?.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => toggle(c.name)}
              className={`rounded px-1.5 py-0.5 text-xs ${arr.includes(c.name) ? "bg-blue-100 text-blue-700" : "bg-neutral-100 text-neutral-600"}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      );
    }

    case "longtext":
      return (
        <textarea
          className={`${cls} min-h-[4rem]`}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
        />
      );

    default: {
      const type = field.type === "number" ? "number"
        : field.type === "date" || field.type === "datetime" ? "date"
        : field.type === "email" ? "email"
        : field.type === "url" ? "url"
        : "text";
      const shown = value == null ? "" : type === "date" ? String(value).slice(0, 10) : String(value);
      return (
        <input
          className={cls}
          type={type}
          value={shown}
          autoFocus={autoFocus}
          onChange={(e) => onChange(type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value || null)}
        />
      );
    }
  }
}
