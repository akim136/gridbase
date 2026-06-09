import { redirect } from "next/navigation";
import { getMeta } from "@/lib/server/gridApi";

export const dynamic = "force-dynamic";

/** Land on the first table's first view. */
export default async function Home() {
  const meta = await getMeta();
  const firstTable = [...meta.tables].sort((a, b) => a.position - b.position)[0];
  if (!firstTable) {
    return <div className="m-8 text-neutral-500">No tables in the registry yet.</div>;
  }
  const view = meta.views
    .filter((v) => v.tableId === firstTable.tableId && !v.isHidden)
    .sort((a, b) => a.position - b.position)[0];
  redirect(`/t/${firstTable.tableId}/${view?.viewId ?? ""}`);
}
