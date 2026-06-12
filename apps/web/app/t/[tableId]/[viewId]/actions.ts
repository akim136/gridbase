"use server";
import { getMeta, listRecords } from "@/lib/server/gridApi";
import { resolveLinkLabels } from "@/lib/server/labels";
import { fieldsForTable } from "@/lib/types";
import type { RecordEnvelope } from "@/lib/types";

/**
 * Fetch the next page of a view's records (same sort/filter as the first page,
 * continued from `offset`) plus link labels for the new rows. Called by the
 * client TableView's "Load more" button. The labels Map serializes fine across
 * the server-action boundary.
 */
export async function loadMoreRecords(
  tableId: string,
  viewId: string,
  offset: string,
): Promise<{ records: RecordEnvelope[]; labels: Map<string, string>; offset?: string }> {
  const meta = await getMeta();
  const view = meta.views.find((v) => v.viewId === viewId && v.tableId === tableId);
  if (!view) throw new Error("view not found");

  const { records, offset: next } = await listRecords(tableId, {
    sort: view.config.sorts,
    filter: view.config.filters,
    pageSize: 100,
    offset,
  });
  const labels = await resolveLinkLabels(meta, fieldsForTable(meta, tableId), records);
  return { records, labels, offset: next };
}
