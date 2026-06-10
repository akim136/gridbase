"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createDashboard } from "@/lib/client";

/** Prompt for a name, create a dashboard, navigate to it. */
export function NewDashboardButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function create() {
    const name = window.prompt("Dashboard name?", "Untitled dashboard");
    if (!name) return;
    setBusy(true);
    try {
      const d = await createDashboard({ name });
      router.push(`/d/${d.dashboardId}`);
    } catch (e) {
      alert(`Create failed: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }
  return (
    <button onClick={create} disabled={busy} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
      + New dashboard
    </button>
  );
}
