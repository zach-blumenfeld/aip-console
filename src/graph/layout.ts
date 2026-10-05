// A small layered (Sugiyama-style) layout for step graphs. Procedures have a
// handful of steps, so a hand-rolled longest-path layering with one barycenter
// ordering pass draws them cleanly without a layout library.

export interface GraphNode { id: string }
export interface GraphEdge { from: string; to: string; label?: string }

export interface PlacedNode extends GraphNode { x: number; y: number; layer: number }
export interface PlacedEdge extends GraphEdge { points: [number, number][]; back: boolean }
export interface Layout { nodes: PlacedNode[]; edges: PlacedEdge[]; width: number; height: number }

export interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  layerGap: number;
  nodeGap: number;
  start?: string;
}

const DEFAULTS: LayoutOptions = { nodeWidth: 150, nodeHeight: 48, layerGap: 70, nodeGap: 36 };

export function layout(nodes: GraphNode[], edges: GraphEdge[], opts: Partial<LayoutOptions> = {}): Layout {
  const o = { ...DEFAULTS, ...opts };
  const ids = nodes.map((n) => n.id);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) if (out.has(e.from) && out.has(e.to)) out.get(e.from)!.push(e.to);

  // Depth-first from the start (then any unvisited node) to find back edges, so a
  // procedure that loops still gets a finite layering.
  const back = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id)!) {
      const s = state.get(to) ?? 0;
      if (s === 1) back.add(`${id}->${to}`);
      else if (s === 0) visit(to);
    }
    state.set(id, 2);
  };
  const roots = [o.start, ...ids].filter((id): id is string => !!id && out.has(id));
  for (const id of roots) if (!state.has(id)) visit(id);

  // Longest-path layering over the forward edges.
  const layerOf = new Map<string, number>();
  const forwardIn = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (out.has(e.from) && out.has(e.to) && !back.has(`${e.from}->${e.to}`)) forwardIn.get(e.to)!.push(e.from);
  }
  const depth = (id: string): number => {
    const known = layerOf.get(id);
    if (known !== undefined) return known;
    layerOf.set(id, 0); // guards against anything the back-edge pass missed
    const d = Math.max(-1, ...forwardIn.get(id)!.map(depth)) + 1;
    layerOf.set(id, d);
    return d;
  };
  for (const id of ids) depth(id);

  // Order within a layer by the mean position of predecessors (one top-down pass),
  // ties broken by declaration order.
  const layers: string[][] = [];
  for (const id of ids) (layers[layerOf.get(id)!] ??= []).push(id);
  const pos = new Map<string, number>();
  layers.forEach((layer, i) => {
    if (i > 0) {
      const bary = (id: string) => {
        const preds = forwardIn.get(id)!.map((p) => pos.get(p)!).filter((v) => v !== undefined);
        return preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : Number.POSITIVE_INFINITY;
      };
      layer.sort((a, b) => bary(a) - bary(b) || ids.indexOf(a) - ids.indexOf(b));
    }
    layer.forEach((id, j) => pos.set(id, j));
  });

  const widest = Math.max(...layers.map((l) => l.length));
  const width = widest * o.nodeWidth + (widest - 1) * o.nodeGap;
  const placed = new Map<string, PlacedNode>();
  layers.forEach((layer, i) => {
    const rowWidth = layer.length * o.nodeWidth + (layer.length - 1) * o.nodeGap;
    const left = (width - rowWidth) / 2;
    layer.forEach((id, j) => {
      placed.set(id, { id, layer: i, x: left + j * (o.nodeWidth + o.nodeGap), y: i * (o.nodeHeight + o.layerGap) });
    });
  });
  const height = layers.length * o.nodeHeight + (layers.length - 1) * o.layerGap;

  const placedEdges: PlacedEdge[] = edges
    .filter((e) => placed.has(e.from) && placed.has(e.to))
    .map((e) => {
      const a = placed.get(e.from)!, b = placed.get(e.to)!;
      const isBack = back.has(`${e.from}->${e.to}`);
      const ax = a.x + o.nodeWidth / 2, bx = b.x + o.nodeWidth / 2;
      const points: [number, number][] = isBack
        ? [[ax, a.y + o.nodeHeight], [ax, a.y + o.nodeHeight + o.layerGap / 2],
           [Math.max(ax, bx) + o.nodeWidth / 2 + 10, a.y + o.nodeHeight + o.layerGap / 2],
           [Math.max(ax, bx) + o.nodeWidth / 2 + 10, b.y - o.layerGap / 2], [bx, b.y - o.layerGap / 2], [bx, b.y]]
        : [[ax, a.y + o.nodeHeight], [bx, b.y]];
      return { ...e, points, back: isBack };
    });

  return { nodes: [...placed.values()], edges: placedEdges, width, height };
}
