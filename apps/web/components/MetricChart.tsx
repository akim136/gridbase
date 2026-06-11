"use client";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** A small trend line for one metric. Loaded client-only (recharts measures the DOM). */
export function MetricChart({ data }: { data: Array<{ date: string; v: number | null }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: 6 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis hide domain={["auto", "auto"]} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb", padding: "4px 8px" }}
          labelStyle={{ color: "#6b7280" }}
          formatter={(val: number | string) => [val, ""]}
        />
        <Line type="monotone" dataKey="v" stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
