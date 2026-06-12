import Link from "next/link";
import { previewValue, recordTitle } from "@/lib/preview";
import { type Meta, type RecordEnvelope, type ViewMeta, visibleFields } from "@/lib/types";

/**
 * Gallery: a responsive grid of large record cards. Card title = the primary
 * field (links to the record); card fields follow the view's FieldEditor
 * (show/hide/reorder), capped by config.gallery.maxPreviewFields. An optional
 * cover field (a url field) renders as an image strip on top of each card.
 */
export function GalleryView({
  meta,
  view,
  records,
  labels,
}: {
  meta: Meta;
  view: ViewMeta;
  records: RecordEnvelope[];
  labels: Map<string, string>;
}) {
  const fields = visibleFields(meta, view);
  const primaryId = meta.tables.find((t) => t.tableId === view.tableId)?.primaryFieldId;
  const coverId = view.config.gallery?.coverFieldId;
  const maxPreview = view.config.gallery?.maxPreviewFields ?? 6;
  const cardFields = fields
    .filter((f) => f.fieldId !== primaryId && f.fieldId !== coverId)
    .slice(0, maxPreview);

  if (records.length === 0) return <p className="py-8 text-center text-neutral-400">No records.</p>;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {records.map((rec) => {
        const cover = coverId ? rec.fields[coverId] : undefined;
        return (
          <Link
            key={rec.id}
            href={`/t/${view.tableId}/${view.viewId}/${rec.id}`}
            className="block overflow-hidden rounded-lg border border-surface-border bg-white shadow-sm transition hover:border-blue-300 hover:shadow"
          >
            {typeof cover === "string" && cover.startsWith("http") ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-provided host
              <img src={cover} alt="" className="h-28 w-full border-b border-surface-border object-cover" />
            ) : null}
            <div className="p-3">
              <p className="mb-1.5 truncate font-medium text-neutral-900">{recordTitle(meta, view, rec)}</p>
              {cardFields.map((f) => {
                const text = previewValue(f, rec.fields[f.fieldId], labels);
                if (!text) return null;
                return (
                  <div key={f.fieldId} className="truncate text-xs text-neutral-500">
                    <span className="text-neutral-400">{f.name}:</span> {text}
                  </div>
                );
              })}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
