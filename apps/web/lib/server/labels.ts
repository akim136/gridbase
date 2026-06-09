import "server-only";
import { listRecords } from "./gridApi";
import type { FieldMeta, Meta, RecordEnvelope } from "../types";

/**
 * Build an id → primary-field-label map for every linked record referenced by
 * the given records through their link fields. One extra list call per linked
 * table (cheap; tables are small). Used to render nice link chips instead of
 * raw rec… ids.
 */
export async function resolveLinkLabels(
  meta: Meta,
  fields: FieldMeta[],
  records: RecordEnvelope[],
): Promise<Map<string, string>> {
  const linkFields = fields.filter((f) => f.type === "link" && f.options?.linkedTableId);
  const tablesToFetch = new Set<string>();
  for (const lf of linkFields) {
    const target = lf.options!.linkedTableId!;
    const referenced = records.some((r) => Array.isArray(r.fields[lf.fieldId]) && (r.fields[lf.fieldId] as unknown[]).length);
    if (referenced) tablesToFetch.add(target);
  }

  const labels = new Map<string, string>();
  await Promise.all(
    [...tablesToFetch].map(async (tableId) => {
      const t = meta.tables.find((x) => x.tableId === tableId);
      if (!t) return;
      // Page through the whole linked table so ids past row 100 still get labels.
      let offset: string | undefined;
      do {
        const res = await listRecords(tableId, { fields: [t.primaryFieldId], pageSize: 100, offset });
        for (const rec of res.records) {
          const label = rec.fields[t.primaryFieldId];
          if (label != null) labels.set(rec.id, String(label));
        }
        offset = res.offset;
      } while (offset);
    }),
  );
  return labels;
}
