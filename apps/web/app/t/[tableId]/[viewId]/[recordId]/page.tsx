import Link from "next/link";
import { notFound } from "next/navigation";
import { EditableCell } from "@/components/EditableCell";
import { DeleteRecordButton } from "@/components/RecordActions";
import { getMeta, getRecord } from "@/lib/server/gridApi";
import { fieldsForTable, linkPrimaries, linkTargets } from "@/lib/types";
import { resolveLinkLabels } from "@/lib/server/labels";

export const dynamic = "force-dynamic";

/**
 * Read-only record detail. Phase 3 turns this into an editable DetailPanel with
 * linked-record pickers; for now it shows every field, computed values included.
 */
export default async function DetailPage({
  params,
}: {
  params: Promise<{ tableId: string; viewId: string; recordId: string }>;
}) {
  const { tableId, viewId, recordId } = await params;
  const meta = await getMeta();
  const table = meta.tables.find((t) => t.tableId === tableId);
  if (!table) notFound();

  let record;
  try {
    record = await getRecord(tableId, recordId);
  } catch {
    notFound();
  }

  const fields = fieldsForTable(meta, tableId);
  const labels = await resolveLinkLabels(meta, fields, [record]);
  const targets = linkTargets(meta);
  const primaries = linkPrimaries(meta);
  const title = record.fields[table.primaryFieldId];

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between">
        <Link href={`/t/${tableId}/${viewId}`} className="text-sm text-neutral-500 hover:text-blue-600">
          ← {table.name}
        </Link>
        <DeleteRecordButton tableId={tableId} recordId={recordId} backHref={`/t/${tableId}/${viewId}`} />
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-900">
        {title != null && title !== "" ? String(title) : "(untitled)"}
      </h1>

      <dl className="mt-6 divide-y divide-surface-border rounded-lg border border-surface-border bg-white">
        {fields.map((f) => (
          <div key={f.fieldId} className="grid grid-cols-[180px_1fr] gap-4 px-4 py-3">
            <dt className="text-sm text-neutral-500">
              {f.name}
              {f.isComputed ? <span className="ml-1 text-[10px] text-neutral-400">ƒ</span> : null}
            </dt>
            <dd className="text-sm">
              <EditableCell
                tableId={tableId}
                recordId={recordId}
                field={f}
                value={record.fields[f.fieldId]}
                labels={labels}
                linkTargets={targets}
                linkPrimaries={primaries}
              />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
