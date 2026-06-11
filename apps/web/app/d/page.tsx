import Link from "next/link";
import { NewDashboardButton } from "@/components/NewDashboardButton";
import { getMeta } from "@/lib/server/gridApi";

export const dynamic = "force-dynamic";

/** Dashboards index — the workspace's report pages. */
export default async function DashboardsPage() {
  const meta = await getMeta();
  const dashboards = (meta.dashboards ?? []).filter((d) => !d.isHidden);

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">Dashboards</h1>
        <NewDashboardButton />
      </div>

      {dashboards.length === 0 ? (
        <p className="text-sm text-neutral-400">No dashboards yet. Create one to compose KPIs, charts, and reports from any table.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dashboards.map((d) => {
            const n = d.config.widgets?.length ?? 0;
            return (
              <li key={d.dashboardId}>
                <Link href={`/d/${d.dashboardId}`} className="block rounded-lg border border-surface-border bg-white p-4 hover:border-blue-300">
                  <span className="text-sm font-medium text-neutral-900">{d.name}</span>
                  <span className="mt-1 block text-xs text-neutral-400">{n} widget{n === 1 ? "" : "s"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
