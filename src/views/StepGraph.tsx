import { useMemo } from "react";
import { START_INPUT } from "../graph/dataflow";
import { layout } from "../graph/layout";
import type { Branch, Edge, StepDetail } from "../api/types";
import type { Traffic } from "./Traffic";

const W = 150, H = 48, PAD = 24;
// Data-flow arrows run down the right of the nodes, one lane per arrow that skips a layer.
const LANE = 26, LANE_GAP = 20;

interface Props {
  steps: StepDetail[];
  edges: Edge[];
  branches: Branch[];
  start: string;
  end: string;
  /** Steps to highlight, for the run trace (I4). */
  visited?: Set<string>;
  /** Edges a run took, as `from->to`; without it, an edge between two visited steps counts as taken. */
  taken?: Set<string>;
  /** Draw the data flow instead: one arrow per (producer, consumer) labelled with the keys it carries
   *  (graph/dataflow.ts), with the start input as a node of its own. Control edges stay, faint. */
  flow?: { from: string; to: string; keys: string[] }[];
  /** Weight the control edges by the runs that took them and badge each step with the runs that reached it. */
  traffic?: Traffic;
}

export function StepGraph({ steps, edges, branches, start, end, visited, taken: takenEdges, flow, traffic }: Props) {
  const g = useMemo(() => {
    const all = [
      ...edges.map((e) => ({ from: e.from, to: e.to })),
      ...branches.map((b) => ({ from: b.router, to: b.to, label: b.value })),
    ];
    const nodes = steps.map((s) => ({ id: s.name }));
    // The start input sits above the start step; its edge to the start is only there to place it.
    if (flow) return layout([{ id: START_INPUT }, ...nodes], [{ from: START_INPUT, to: start }, ...all], { nodeWidth: W, nodeHeight: H, start: START_INPUT });
    return layout(nodes, all, { nodeWidth: W, nodeHeight: H, start });
  }, [steps, edges, branches, start, flow]);
  const byName = new Map(steps.map((s) => [s.name, s]));
  const data = useMemo(() => (flow ? route(flow, g.nodes) : []), [flow, g]);
  const right = data.length ? Math.max(0, ...data.map((d) => d.reach - g.width)) + 8 : 0;
  const controlEdges = g.edges.filter((e) => e.from !== START_INPUT);
  const busiest = traffic ? Math.max(1, ...traffic.edges.values()) : 1;

  return (
    <svg
      className={`step-graph${flow ? " data-mode" : ""}${traffic ? " traffic-mode" : ""}`}
      role="img"
      aria-label="step graph"
      viewBox={`${-PAD} ${-PAD} ${g.width + 2 * PAD + right} ${g.height + 2 * PAD}`}
      width={g.width + 2 * PAD + right}
      height={g.height + 2 * PAD}
    >
      <defs>
        {/* userSpaceOnUse: the head stays this size however thick the traffic mode draws the line. */}
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
        <marker id="arrow-busy" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="busy-arrow" />
        </marker>
        <marker id="data-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="data-arrow" />
        </marker>
      </defs>
      {controlEdges.map((e) => {
        const d = e.points.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");
        const [mx, my] = midpoint(e.points);
        const taken = takenEdges ? takenEdges.has(`${e.from}->${e.to}`) : (visited?.has(e.from) && visited?.has(e.to));
        const runs = traffic ? (traffic.edges.get(`${e.from}->${e.to}`) ?? 0) : null;
        // Traffic: width grows with the square root of the share, so a rare branch still reads as a line.
        const width = runs !== null ? (runs ? 1.5 + 6 * Math.sqrt(runs / busiest) : 1) : taken ? 2.5 : 1.25;
        return (
          <g key={`${e.from}->${e.to}:${e.label ?? ""}`} className={`edge${taken ? " taken" : ""}${runs ? " busy" : runs === 0 ? " idle" : ""}`}
             data-testid="step-edge" data-from={e.from} data-to={e.to} data-taken={taken ? "true" : "false"}
             data-runs={runs ?? undefined}>
            <path d={d} fill="none" stroke="currentColor" strokeWidth={width} strokeLinejoin="round" markerEnd={runs ? "url(#arrow-busy)" : "url(#arrow)"} />
            {e.label && (
              <text x={mx} y={my - 4 - width / 2} textAnchor="middle" className="branch-label" data-testid="branch-label">
                {e.label}
              </text>
            )}
            {runs ? <text x={mx + 9 + width / 2} y={my + 4} textAnchor="start" className="run-count" data-testid="edge-runs">{runs}</text> : null}
          </g>
        );
      })}
      {data.map((d) => (
        <g key={`${d.from}=>${d.to}`} className="data-edge" data-testid="data-edge" data-from={d.from} data-to={d.to}
           data-keys={d.keys.join(",")}>
          <path d={d.path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="5 3" markerEnd="url(#data-arrow)" />
          <text x={d.label[0]} y={d.label[1]} className="data-label" data-testid="data-label">{d.keys.join(", ")}</text>
        </g>
      ))}
      {g.nodes.map((n) => {
        if (n.id === START_INPUT) {
          return (
            <g key={n.id} className="node input-node" transform={`translate(${n.x}, ${n.y})`} data-testid="input-node">
              <rect width={W} height={H} rx={H / 2} />
              <text x={W / 2} y={H / 2 + 5} textAnchor="middle" className="node-name">start input</text>
            </g>
          );
        }
        const step = byName.get(n.id)!;
        const isEnd = n.id === end, isStart = n.id === start;
        return (
          <a key={n.id} href={`#step-${n.id}`} className="node-link">
            <g
              className={`node kind-${step.kind}${visited?.has(n.id) ? " visited" : ""}`}
              transform={`translate(${n.x}, ${n.y})`}
              data-testid="step-node"
              data-step={n.id}
              data-kind={step.kind}
            >
              <rect width={W} height={H} rx={step.kind === "router" ? H / 2 : 6} />
              {isEnd && <rect x={3} y={3} width={W - 6} height={H - 6} rx={4} className="end-ring" />}
              {isStart && <circle cx={0} cy={H / 2} r={5} className="start-dot" />}
              <text x={W / 2} y={H / 2 - 4} textAnchor="middle" className="node-name">{n.id}</text>
              <text x={W / 2} y={H / 2 + 13} textAnchor="middle" className="node-kind">{step.kind}</text>
              {traffic && <Badge runs={traffic.steps.get(n.id) ?? 0} failed={traffic.failed.get(n.id) ?? 0} total={traffic.runs} />}
            </g>
          </a>
        );
      })}
    </svg>
  );
}

/** The runs that reached a step, pinned to its top-right corner; red when some failed there. */
function Badge({ runs, failed, total }: { runs: number; failed: number; total: number }) {
  const text = failed ? `${runs} · ${failed} failed` : String(runs);
  const w = 8 + 6.5 * text.length;
  return (
    <g className={`badge${failed ? " failed" : runs ? "" : " none"}`} transform={`translate(${W - w + 8}, -9)`} data-testid="step-runs"
       data-runs={runs} data-failed={failed}>
      <title>{runs} of {total} runs reached this step{failed ? `, ${failed} failed here` : ""}</title>
      <rect width={w} height={18} rx={9} />
      <text x={w / 2} y={13} textAnchor="middle">{text}</text>
    </g>
  );
}

interface Routed { from: string; to: string; keys: string[]; path: string; label: [number, number]; reach: number }

/** Paths for the data arrows: one to the next layer leaves the producer's bottom a little right of the control
 *  edge; a longer one leaves its right side and curves out to a lane of its own, so arrows that skip layers
 *  never cross a node. `reach` is how far right the arrow goes. */
function route(flow: { from: string; to: string; keys: string[] }[], nodes: { id: string; x: number; y: number; layer: number }[]): Routed[] {
  const at = new Map(nodes.map((n) => [n.id, n]));
  const placed = flow.filter((f) => at.has(f.from) && at.has(f.to));
  const long = placed.filter((f) => at.get(f.to)!.layer - at.get(f.from)!.layer !== 1)
    .sort((a, b) => (at.get(a.to)!.layer - at.get(a.from)!.layer) - (at.get(b.to)!.layer - at.get(b.from)!.layer));
  return placed.map((f) => {
    const a = at.get(f.from)!, b = at.get(f.to)!;
    const lane = long.indexOf(f);
    if (lane < 0) {
      const x0 = a.x + W / 2 + 14, x1 = b.x + W / 2 + 14, y0 = a.y + H, y1 = b.y;
      const label: [number, number] = [(x0 + x1) / 2 + 6, (y0 + y1) / 2 + 4];
      return { ...f, path: `M ${x0} ${y0} L ${x1} ${y1}`, label, reach: label[0] + textWidth(f.keys) };
    }
    const x0 = a.x + W, y0 = a.y + H / 2 + 6, x1 = b.x + W, y1 = b.y + H / 2 - 6;
    const cx = Math.max(x0, x1) + LANE + lane * LANE_GAP;
    const path = `M ${x0} ${y0} C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
    const label: [number, number] = [0.25 * x0 + 0.75 * cx + 4, (y0 + y1) / 2];
    return { ...f, path, label, reach: Math.max(cx, label[0] + textWidth(f.keys)) };
  });
}

/** Roughly how wide a label of these keys draws at 11px. */
function textWidth(keys: string[]): number {
  return 6.5 * keys.join(", ").length;
}

function midpoint(points: [number, number][]): [number, number] {
  if (points.length === 2) {
    const [[x1, y1], [x2, y2]] = points;
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  }
  // A bent edge: the middle of its middle segment, which runs through a slot no node occupies.
  const i = Math.floor(points.length / 2);
  const [[x1, y1], [x2, y2]] = [points[i - 1], points[i]];
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}
