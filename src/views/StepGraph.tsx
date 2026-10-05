import { useMemo } from "react";
import { layout } from "../graph/layout";
import type { Branch, Edge, StepDetail } from "../api/types";

const W = 150, H = 48, PAD = 24;

interface Props {
  steps: StepDetail[];
  edges: Edge[];
  branches: Branch[];
  start: string;
  end: string;
  /** Steps and edges to highlight, for the run trace (I4). */
  visited?: Set<string>;
}

export function StepGraph({ steps, edges, branches, start, end, visited }: Props) {
  const g = useMemo(() => {
    const all = [
      ...edges.map((e) => ({ from: e.from, to: e.to })),
      ...branches.map((b) => ({ from: b.router, to: b.to, label: b.value })),
    ];
    return layout(steps.map((s) => ({ id: s.name })), all, { nodeWidth: W, nodeHeight: H, start });
  }, [steps, edges, branches, start]);
  const byName = new Map(steps.map((s) => [s.name, s]));

  return (
    <svg
      className="step-graph"
      role="img"
      aria-label="step graph"
      viewBox={`${-PAD} ${-PAD} ${g.width + 2 * PAD} ${g.height + 2 * PAD}`}
      width={g.width + 2 * PAD}
      height={g.height + 2 * PAD}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {g.edges.map((e) => {
        const d = e.points.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");
        const [mx, my] = midpoint(e.points);
        const taken = visited?.has(e.from) && visited?.has(e.to);
        return (
          <g key={`${e.from}->${e.to}:${e.label ?? ""}`} className={`edge${taken ? " taken" : ""}`}>
            <path d={d} fill="none" stroke="currentColor" strokeWidth={taken ? 2.5 : 1.25} markerEnd="url(#arrow)" />
            {e.label && (
              <text x={mx} y={my - 4} textAnchor="middle" className="branch-label" data-testid="branch-label">
                {e.label}
              </text>
            )}
          </g>
        );
      })}
      {g.nodes.map((n) => {
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
            </g>
          </a>
        );
      })}
    </svg>
  );
}

function midpoint(points: [number, number][]): [number, number] {
  if (points.length === 2) {
    const [[x1, y1], [x2, y2]] = points;
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  }
  const [x, y] = points[Math.floor(points.length / 2)];
  return [x, y];
}
