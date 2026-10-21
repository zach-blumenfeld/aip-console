// A small layered (Sugiyama-style) layout for step graphs. Procedures have a
// handful of steps, so a hand-rolled longest-path layering with one barycenter
// ordering pass draws them cleanly without a layout library. An edge that skips
// layers is routed through dummy nodes, so it bends around the steps between.

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
  /** The slot an edge that skips a layer takes in each layer it crosses. */
  dummyWidth: number;
  start?: string;
}

const DEFAULTS: LayoutOptions = { nodeWidth: 150, nodeHeight: 48, layerGap: 70, nodeGap: 36, dummyWidth: 16 };

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

  // An edge that skips layers gets a slim dummy node in each layer it crosses, so it is ordered and placed
  // like a node and never drawn through one; the drawn edge bends at each dummy.
  const widthOf = new Map<string, number>(ids.map((id) => [id, o.nodeWidth]));
  const chains = new Map<string, string[]>();     // `from->to` of a long edge -> its dummies, top to bottom
  for (const e of edges) {
    const key = `${e.from}->${e.to}`;
    if (!out.has(e.from) || !out.has(e.to) || back.has(key) || chains.has(key)) continue;
    const span = layerOf.get(e.to)! - layerOf.get(e.from)!;
    if (span <= 1) continue;
    const dummies: string[] = [];
    let previous = e.from;
    for (let k = 1; k < span; k++) {
      const id = `\u0000${key}#${k}`;
      dummies.push(id);
      layerOf.set(id, layerOf.get(e.from)! + k);
      widthOf.set(id, o.dummyWidth);
      forwardIn.set(id, [previous]);
      previous = id;
    }
    forwardIn.set(e.to, forwardIn.get(e.to)!.map((p) => (p === e.from ? previous : p)));
    chains.set(key, dummies);
  }
  const all = [...ids, ...[...chains.values()].flat()];

  // Order within a layer by the mean position of predecessors (one top-down pass),
  // ties broken by declaration order.
  const layers: string[][] = [];
  for (const id of all) (layers[layerOf.get(id)!] ??= []).push(id);
  const pos = new Map<string, number>();
  layers.forEach((layer, i) => {
    if (i > 0) {
      const bary = (id: string) => {
        const preds = forwardIn.get(id)!.map((p) => pos.get(p)!).filter((v) => v !== undefined);
        return preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : Number.POSITIVE_INFINITY;
      };
      layer.sort((a, b) => bary(a) - bary(b) || all.indexOf(a) - all.indexOf(b));
    }
    layer.forEach((id, j) => pos.set(id, j));
  });

  const rowWidth = (layer: string[]) => layer.reduce((w, id) => w + widthOf.get(id)!, 0) + (layer.length - 1) * o.nodeGap;
  const width = Math.max(...layers.map(rowWidth));
  const placed = new Map<string, PlacedNode>();
  layers.forEach((layer, i) => {
    let x = (width - rowWidth(layer)) / 2;
    for (const id of layer) {
      placed.set(id, { id, layer: i, x, y: i * (o.nodeHeight + o.layerGap) });
      x += widthOf.get(id)! + o.nodeGap;
    }
  });
  const height = layers.length * o.nodeHeight + (layers.length - 1) * o.layerGap;
  const centre = (id: string) => placed.get(id)!.x + widthOf.get(id)! / 2;

  const placedEdges: PlacedEdge[] = edges
    .filter((e) => placed.has(e.from) && placed.has(e.to))
    .map((e) => {
      const a = placed.get(e.from)!, b = placed.get(e.to)!;
      const key = `${e.from}->${e.to}`;
      const isBack = back.has(key);
      const ax = centre(e.from), bx = centre(e.to);
      let points: [number, number][];
      if (isBack) {
        points = [[ax, a.y + o.nodeHeight], [ax, a.y + o.nodeHeight + o.layerGap / 2],
                  [Math.max(ax, bx) + o.nodeWidth / 2 + 10, a.y + o.nodeHeight + o.layerGap / 2],
                  [Math.max(ax, bx) + o.nodeWidth / 2 + 10, b.y - o.layerGap / 2], [bx, b.y - o.layerGap / 2], [bx, b.y]];
      } else {
        points = [[ax, a.y + o.nodeHeight]];
        for (const d of chains.get(key) ?? []) {
          const dy = placed.get(d)!.y, dx = centre(d);
          points.push([dx, dy], [dx, dy + o.nodeHeight]);
        }
        points.push([bx, b.y]);
      }
      return { ...e, points, back: isBack };
    });

  return { nodes: ids.map((id) => placed.get(id)!), edges: placedEdges, width, height };
}
