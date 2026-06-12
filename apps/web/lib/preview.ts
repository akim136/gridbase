import type { FieldMeta } from "./types";

/** Render a card-preview cell value: link/lookup arrays become comma-joined
 *  labels (via the id→label map); scalars stringify. Returns "" when empty.
 *  Shared by the Kanban and Gallery card renderers. */
export function previewValue(field: FieldMeta, value: unknown, labels: Map<string, string>): string {
  if (value == null || value === "") return "";
  if (field.type === "link") {
    const ids = Array.isArray(value) ? (value as string[]) : [String(value)];
    return ids.map((id) => labels.get(id) ?? id).join(", ");
  }
  if (Array.isArray(value)) return value.filter((v) => v != null && v !== "").map((v) => String(v)).join(", ");
  return String(value);
}
