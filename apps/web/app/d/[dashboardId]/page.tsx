import { notFound } from "next/navigation";
import { DashboardRenderer } from "@/components/DashboardRenderer";
import { computeWidgets, getMeta } from "@/lib/server/gridApi";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ dashboardId: string }> }) {
  const { dashboardId } = await params;
  const meta = await getMeta();
  const dashboard = (meta.dashboards ?? []).find((d) => d.dashboardId === dashboardId);
  if (!dashboard) notFound();

  // Every widget's data is computed server-side (the API secret stays on the server).
  const data = await computeWidgets(dashboard.config.widgets ?? []);

  return (
    <div className="p-6">
      <DashboardRenderer dashboard={dashboard} meta={meta} data={data} />
    </div>
  );
}
