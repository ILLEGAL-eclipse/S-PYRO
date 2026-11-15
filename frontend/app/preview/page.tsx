"use client";
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Send } from "lucide-react";
import { AssistantCard, ContextPanel, UserBubble, type ChatMsg, type TraceStep } from "@/components/agent-ui";
import { IgnitionBar, OpticalHero, Viewport } from "@/components/optics";
import { AgentProgress } from "@/components/agent-progress";
import { tooltipStyle } from "@/components/charts";
import { Button } from "@/components/ui/primitives";
import type { Citation } from "@/lib/types";

/* -------------------------------------------------------------------------------------------------
   DESIGN PREVIEW — every number, curve, citation and statement on this page is ILLUSTRATIVE MOCK CONTENT
   written to show the visual system. It is not retrieved from S-PYRO's database or from any publication.
   ------------------------------------------------------------------------------------------------- */

const curve = Array.from({ length: 15 }, (_, i) => {
  const phi = +(0.7 + i * 0.05).toFixed(2);
  return { phi, mock: +(38 * Math.exp(-(((phi - 1.08) / 0.27) ** 2))).toFixed(1) };
});
const peak = curve.reduce((a, b) => (b.mock > a.mock ? b : a));

const mockCites: Citation[] = [
  { ref: "R1", kind: "text", label: "MOCK-001 · Illustrative citation A", investigation_title: "Mock investigation" },
  { ref: "R2", kind: "text", label: "MOCK-002 · Illustrative citation B", investigation_title: "Mock investigation" },
];
const mockTrace: TraceStep[] = [
  { tool: "search_research_text", arguments: { query: "laminar flame speed methane air equivalence ratio" }, ok: true, note: "mock · 6 passages retrieved" },
  { tool: "get_experimental_conditions", arguments: { investigation_id: "MOCK-001" }, ok: true, note: "mock · boundary conditions extracted",
    conditions: [
      { parameter: "Fuel", value: "CH4", unit: null, ref: "R1" }, { parameter: "Oxidizer", value: "air", unit: null, ref: "R1" },
      { parameter: "Equivalence ratio φ", value: "0.7 – 1.4", unit: null, ref: "R1" }, { parameter: "Temperature", value: "298", unit: "K", ref: "R1" },
      { parameter: "Pressure", value: "101.325", unit: "kPa", ref: "R1" }, { parameter: "Applied DC field", value: "0 – 2", unit: "kV/cm", ref: "R2" },
    ] },
  { tool: "compare_investigations", arguments: { investigation_ids: ["MOCK-001", "MOCK-002"] }, ok: true, note: "mock · conditions aligned, units normalised" },
];

function Chart() {
  return (
    <Viewport className="my-4" label="S_L vs φ · mock curve" meta="illustrative · not data">
      <div className="h-56" role="img" aria-label="Mock laminar flame speed versus equivalence ratio, peaking near phi 1.1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={curve} margin={{ left: 0, right: 16, top: 12, bottom: 18 }}>
            <CartesianGrid stroke="rgba(255,158,27,0.1)" />
            <XAxis dataKey="phi" type="number" domain={[0.7, 1.4]} tick={{ fill: "#B8A99A", fontSize: 11 }} axisLine={{ stroke: "rgba(255,158,27,0.25)" }} tickLine={false}
              label={{ value: "equivalence ratio φ (–)", position: "insideBottom", offset: -10, fill: "#B8A99A", fontSize: 11 }} />
            <YAxis tick={{ fill: "#B8A99A", fontSize: 11 }} axisLine={false} tickLine={false} label={{ value: "S_L (cm/s)", angle: -90, position: "insideLeft", fill: "#B8A99A", fontSize: 11 }} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} cm/s (mock)`, "S_L"]} labelFormatter={(l) => `φ = ${l}`} />
            <Line type="monotone" dataKey="mock" stroke="#FF9E1B" strokeOpacity={0.18} strokeWidth={9} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="mock" stroke="#FF9E1B" strokeWidth={2.2} dot={false} isAnimationActive={false} />
            <ReferenceDot x={peak.phi} y={peak.mock} r={5} fill="#FFF3C4" stroke="#FFF3C4" strokeWidth={2} style={{ filter: "drop-shadow(0 0 8px #FFF3C4)" }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Viewport>
  );
}

const answer: ChatMsg = {
  role: "assistant",
  content: [
    "### Laminar flame speed vs. equivalence ratio (mock)",
    "For a premixed CH₄/air flame at 298 K and 101.325 kPa, the unstretched laminar flame speed $S_L$ is plotted against the equivalence ratio $\\phi$ below. In this mock curve the maximum sits slightly rich of stoichiometry, near $\\phi \\approx 1.1$ [R1].",
    "$$\\phi = \\frac{(m_F / m_{ox})}{(m_F / m_{ox})_{st}}, \\qquad S_L \\propto \\sqrt{\\alpha \\, \\dot\\omega}$$",
    "**Electric-field stabilisation (mock summary)**",
    "- Chemi-ions formed in the reaction zone make the flame responsive to an applied DC field; the resulting body force $\\mathbf{f} = \\rho_e \\mathbf{E}$ can shift the position of a lifted flame base [R2].",
    "- The mock parameter sweep spans 0–2 kV/cm; conditions are listed in the context inspector on the right [R1, R2].",
    "- Different mechanisms are not compared where their conditions (temperature, pressure, burner geometry) differ.",
  ].join("\n\n"),
  citations: mockCites, trace: mockTrace, usage: { input_tokens: 18240, output_tokens: 412 },
  warnings: ["Design preview: this is a scripted mock session. Nothing here comes from the research database."],
  extra: <Chart />,
};

export default function Preview() {
  return (
    <div className="flex gap-5">
      <div className="min-w-0 flex-1">
        <div role="note" className="mb-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.1em] text-warning">
          Design preview · all content on this page is illustrative mock data — not from S-PYRO&apos;s database or any publication
        </div>

        <OpticalHero eyebrow="Solar corona theme" title={<>Research stream, <span className="text-incandescent">erupting from the dark</span></>}>
          Obsidian void, thermal amber-to-crimson accents and corona bloom lighting — a flame-front indicator while the agent works, spark-trail connectors in the reasoning trace, HUD viewport frames and an ignition-chamber prompt bar.
        </OpticalHero>

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Viewport label="CH* chemiluminescence" meta="reference image" bodyClassName="p-2"><img src="/optics/flame-blue.webp" alt="Blue laminar premixed flame front, chemiluminescence image" className="aspect-[4/3] w-full object-cover " /></Viewport>
          <Viewport label="Particle tracks" meta="reference image" bodyClassName="p-2"><img src="/optics/sparks.webp" alt="Long-exposure spark trails around a sphere" className="aspect-[4/3] w-full object-cover " /></Viewport>
          <Viewport label="Soot incandescence" meta="reference image" bodyClassName="p-2"><img src="/optics/flame-luminous.webp" alt="Bright incandescent diffusion flame" className="aspect-[4/3] w-full object-cover " /></Viewport>
        </div>

        <div className="space-y-5">
          <UserBubble>Compare laminar flame speeds of methane/air for φ = 0.7–1.4 and explain how an applied DC electric field stabilises a lifted flame.</UserBubble>
          <AssistantCard m={answer} />
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Loading screen while the agent works (mock steps)</p>
          <AgentProgress startedAt={Date.now() - 11400} text="" steps={[
            { id: 1, tool: "search_investigations", arguments: { query: "cool flames" }, status: "ok", returned: 3 },
            { id: 2, tool: "search_research_text", arguments: { query: "cool flames pressure range" }, status: "ok", returned: 8 },
            { id: 3, tool: "get_experimental_conditions", arguments: { investigation_id: "MOCK-001", parameter_key: "pressure" }, status: "running" },
          ]} />
        </div>

        <div className="sticky bottom-4 z-30 mx-auto mt-8 max-w-3xl">
          <p className="mb-1.5 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Ignition chamber — type to warm the glow</p>
          <PreviewBar />
        </div>
      </div>
      <div className="hidden w-72 shrink-0 xl:block"><ContextPanel steps={mockTrace} citations={mockCites} mock /></div>
    </div>
  );
}

function PreviewBar() {
  return <PreviewBarInner />;
}

import { useState } from "react";
function PreviewBarInner() {
  const [v, setV] = useState("");
  return (
    <IgnitionBar intensity={v.length / 60}>
      <div className="flex items-end gap-2 p-2">
        <textarea value={v} onChange={(e) => setV(e.target.value)} rows={1} aria-label="Preview prompt" placeholder="Type here — the perimeter glow warms from crimson to gold…"
          className="min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm placeholder:text-muted-foreground/70 focus:outline-none" />
        <Button size="icon" aria-label="Send (preview only)" disabled><Send /></Button>
      </div>
    </IgnitionBar>
  );
}
