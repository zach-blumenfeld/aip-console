import type { ProcedureInfo } from "../api/types";

// Key-level data flow (format 0.6a0): every key has exactly one producer, the start input or the step that
// declares it, and goes to every step that consumes it. Execution and client_task steps produce their
// `outputs`, a decision its question names; a step consumes its `inputs`, a router its `branch_on` key.
// Routers and the end step add nothing to the state.

/** The producer of the start step's inputs: what the client supplies when it opens a run. */
export const START_INPUT = "(input)";

export interface DataEdge { key: string; from: string; to: string }

/** Each key's producer: a step name, or START_INPUT. */
export function producers(info: ProcedureInfo): Map<string, string> {
  const out = new Map<string, string>();
  for (const i of info.inputs) if (i.step === info.start.step) out.set(i.name, START_INPUT);
  for (const o of info.outputs ?? []) out.set(o.name, o.step);
  for (const q of info.questions) out.set(q.name, q.step);
  return out;
}

/** The keys a step adds to the state, in declaration order. */
export function outputsOf(info: ProcedureInfo, step: string): string[] {
  const detail = info.step_details.find((s) => s.name === step);
  if (detail?.kind === "decision") return info.questions.filter((q) => q.step === step).map((q) => q.name);
  return (info.outputs ?? []).filter((o) => o.step === step).map((o) => o.name);
}

/** The keys a step reads from the state, in declaration order. */
export function inputsOf(info: ProcedureInfo, step: string): string[] {
  const detail = info.step_details.find((s) => s.name === step);
  if (detail?.kind === "router") return detail.branch_on ? [detail.branch_on] : [];
  return info.inputs.filter((i) => i.step === step).map((i) => i.name);
}

/** One edge per (key, consumer), from the key's producer, in step order. A key with no producer (an invalid
 *  skill) is left out. */
export function dataFlow(info: ProcedureInfo): DataEdge[] {
  const from = producers(info);
  const edges: DataEdge[] = [];
  for (const step of [...info.step_details].sort((a, b) => a.order - b.order)) {
    for (const key of inputsOf(info, step.name)) {
      const producer = from.get(key);
      if (producer !== undefined) edges.push({ key, from: producer, to: step.name });
    }
  }
  return edges;
}

/** The edges grouped per (producer, consumer) pair, keys in order: what the graph draws as one arrow. */
export function groupFlow(edges: DataEdge[]): { from: string; to: string; keys: string[] }[] {
  const groups = new Map<string, { from: string; to: string; keys: string[] }>();
  for (const e of edges) {
    const id = `${e.from}->${e.to}`;
    const g = groups.get(id) ?? { from: e.from, to: e.to, keys: [] };
    g.keys.push(e.key);
    groups.set(id, g);
  }
  return [...groups.values()];
}
