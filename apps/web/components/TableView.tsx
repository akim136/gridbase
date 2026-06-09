import Link from "next/link";
import { EditableCell } from "./EditableCell";
import { AddRowButton } from "./RecordActions";
import { linkPrimaries as buildLinkPrimaries, linkTargets as buildLinkTargets, type Meta, type RecordEnvelope, type ViewMeta, visibleFields } from "@/lib/types";

const FROZEN_W = 200; // fixed width for frozen columns so left offsets are computable

/**
 * Generic table/grid view. Header row freezes by default (stays visible scrolling
 * down); the first `config.frozen` columns freeze (stay visible scrolling right) —
 * both saved per view. The whole table is one scroll container so sticky works.
 */
export function TableView({
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
  const targets = buildLinkTargets(meta);
  const primaries = buildLinkPrimaries(meta);
  const cols = visibleFields(meta, view);
  const primaryId = meta.tables.find((t) => t.tableId === view.tableId)?.primaryFieldId;
  const freezeHeader = view.config.freezeHeader !== false; // default on
  const frozen = view.config.frozen ?? 1; // default: freeze the first (record-name) column

  const colStyle = (i: number): React.CSSProperties =>
    i < frozen ? { position: "sticky", left: i * FROZEN_W, minWidth: FROZEN_W, width: FROZEN_W, maxWidth: FROZEN_W } : {};
  const thStyle = (i: number): React.CSSProperties => ({
    ...(freezeHeader || i < frozen ? { position: "sticky" } : {}),
    ...(freezeHeader ? { top: 0 } : {}),
    ...colStyle(i),
    zIndex: freezeHeader && i < frozen ? 30 : freezeHeader ? 20 : i < frozen ? 10 : undefined,
  });
  const tdStyle = (i: number): React.CSSProperties => (i < frozen ? { ...colStyle(i), zIndex: 10 } : {});

  return (
    <div className="h-full overflow-auto rounded-lg border border-surface-border bg-white">
      <table className="border-collapse text-sm">
        <thead>
          <tr className="text-left">
            {cols.map((f, i) => (
              <th
                key={f.fieldId}
                style={thStyle(i)}
                className={`whitespace-nowrap border-b border-surface-border bg-surface-muted px-3 py-2 font-medium text-neutral-500 ${i < frozen ? "border-r" : ""}`}
              >
                {f.name}
                {f.isComputed ? <span className="ml-1 text-[10px] text-neutral-400">ƒ</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className="px-3 py-8 text-center text-neutral-400">No records.</td>
            </tr>
          ) : (
            records.map((rec) => (
              <tr key={rec.id} className="group border-b border-surface-border last:border-0">
                {cols.map((f, i) => {
                  const value = rec.fields[f.fieldId];
                  const isPrimary = f.fieldId === primaryId;
                  return (
                    <td
                      key={f.fieldId}
                      style={tdStyle(i)}
                      className={`px-3 py-2 align-top ${i < frozen ? "border-r border-surface-border bg-white" : "group-hover:bg-surface-muted/60"}`}
                    >
                      {isPrimary ? (
                        <Link
                          href={`/t/${view.tableId}/${view.viewId}/${rec.id}`}
                          className="font-medium text-neutral-900 hover:text-blue-600 hover:underline"
                        >
                          {value != null && value !== "" ? String(value) : "(untitled)"}
                        </Link>
                      ) : (
                        <EditableCell
                          tableId={view.tableId}
                          recordId={rec.id}
                          field={f}
                          value={value}
                          labels={labels}
                          linkTargets={targets}
                          linkPrimaries={primaries}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="sticky left-0 border-t border-surface-border p-2">
        <AddRowButton tableId={view.tableId} />
      </div>
    </div>
  );
}
