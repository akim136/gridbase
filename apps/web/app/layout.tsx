import "./globals.css";
import type { Metadata } from "next";
import { Sidebar, type SidebarTable } from "@/components/Sidebar";
import { getMeta } from "@/lib/server/gridApi";

export const metadata: Metadata = {
  title: "gridbase",
  description: "Database-backed workspace (open-source Airtable replacement)",
  icons: { icon: "/icon.png" },
};

/** First non-hidden view for a table, by position. */
function firstViewId(views: { tableId: string; viewId: string; isHidden: boolean; position: number }[], tableId: string): string {
  const v = views
    .filter((x) => x.tableId === tableId && !x.isHidden)
    .sort((a, b) => a.position - b.position)[0];
  return v?.viewId ?? "";
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let tables: SidebarTable[] = [];
  let error: string | null = null;
  try {
    const meta = await getMeta();
    tables = meta.tables
      .sort((a, b) => a.position - b.position)
      .map((t) => ({ tableId: t.tableId, name: t.name, firstViewId: firstViewId(meta.views, t.tableId) }));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <html lang="en">
      <body>
        <div className="flex h-screen overflow-hidden">
          {error ? null : <Sidebar tables={tables} />}
          <main className="flex-1 overflow-auto">
            {error ? (
              <div className="m-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <p className="font-medium">Can’t reach grid-api.</p>
                <p className="mt-1 text-red-600">{error}</p>
                <p className="mt-2 text-red-500">
                  Set <code>GRID_API_URL</code> and <code>GRID_API_SECRET</code> in the app’s env.
                </p>
              </div>
            ) : (
              children
            )}
          </main>
        </div>
      </body>
    </html>
  );
}
