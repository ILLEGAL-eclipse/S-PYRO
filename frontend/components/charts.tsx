"use client";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const SERIES_COLORS = ["#FF9E1B", "#FFF3C4", "#D9381E", "#B8A99A", "#F2784B", "#B81D24"];

export const tooltipStyle = {
  contentStyle: { background: "rgba(17,12,14,0.92)", border: "1px solid rgba(255,158,27,0.25)", borderRadius: 8, fontSize: 12, color: "#FF9E1B" },
  labelStyle: { color: "#B8A99A" },
  cursor: { fill: "rgba(255,158,27,0.06)" },
};

/** Horizontal bar distribution from real database counts. */
export function DistributionChart({ title, data, unitLabel = "investigations" }: { title: string; data: { name: string; count: number }[]; unitLabel?: string }) {
  const rows = data.slice(0, 8);
  return (
    <div>
      <p className="label-caps mb-2">{title}</p>
      {rows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No data recorded yet.</p> : (
        <div role="img" aria-label={`${title}: ${rows.map((r) => `${r.name} ${r.count}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 34 + 16)}>
            <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 24, top: 0, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke="rgba(255,158,27,0.1)" />
              <XAxis type="number" allowDecimals={false} tick={{ fill: "#B8A99A", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fill: "#B8A99A", fontSize: 12 }} axisLine={false} tickLine={false}
                tickFormatter={(v: string) => (v.length > 20 ? v.slice(0, 19) + "…" : v)} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} ${unitLabel}`, ""]} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={16} label={{ position: "right", fill: "#B8A99A", fontSize: 11 }}>
                {rows.map((_, i) => <Cell key={i} fill="#FF9E1B" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
