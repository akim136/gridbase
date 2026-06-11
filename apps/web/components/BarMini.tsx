"use client";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** A small bar chart for a dashboard widget. Loaded client-only (recharts measures the DOM). */
export function BarMini({ data }: { data: Array<{ label: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: 6 }}>
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} interval={0} />
        <YAxis hide />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb", padding: "4px 8px" }} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
        <Bar dataKey="value" fill="#2563eb" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
