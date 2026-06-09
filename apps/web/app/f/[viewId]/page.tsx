import { notFound } from "next/navigation";
import { FormRenderer } from "@/components/FormRenderer";
import { getMeta } from "@/lib/server/gridApi";
import { visibleFields } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Standalone form page for a `type='form'` view (gated by the app's auth). */
export default async function FormPage({ params }: { params: Promise<{ viewId: string }> }) {
  const { viewId } = await params;
  const meta = await getMeta();
  const view = meta.views.find((v) => v.viewId === viewId);
  if (!view) notFound();
  const fields = visibleFields(meta, view);

  return (
    <div className="min-h-full bg-surface-muted p-8">
      <FormRenderer tableId={view.tableId} fields={fields} title={view.config.form?.title ?? view.name} />
    </div>
  );
}
