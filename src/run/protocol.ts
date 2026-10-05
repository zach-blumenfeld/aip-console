// The client side of the step protocol, mirroring aip.client.runner and
// aip.model.steps.Decision.review. Pure functions; the console in views/Run.tsx
// drives the calls.
import type { Answer, NextNode, ReviewItem } from "../api/types";

/** Defaults the server applies when neither the author nor the request set a threshold. */
export const DEFAULT_NOUL_MARGIN = 0.15;
export const DEFAULT_MIN_CONFIDENCE = 0.6;

/** The input keys the client must produce for what comes next; a router's are the union of its branches'. */
export function expectsOf(next: NextNode | null): Record<string, string> {
  if (next === null) return {};
  if (next.kind === "router") {
    const merged: Record<string, string> = {};
    for (const branch of Object.values(next.branches)) Object.assign(merged, expectsOf(branch));
    return merged;
  }
  return { ...next.inputs };
}

/** The runnable step a `peek` resolved to, or the first branch of a router (for display only). */
export function describeNext(next: NextNode | null): string {
  if (next === null) return "end of the procedure";
  if (next.kind === "router") {
    const targets = Object.entries(next.branches).map(([v, n]) => `${v} → ${n?.step ?? "end"}`).join(", ");
    return `router ${next.step} on ${next.branch_on}: ${targets}`;
  }
  return next.kind === "end" ? `the end step ${next.step}` : `${next.kind} ${next.step}`;
}

/** Discrete value of one answer: noul → bool, choice → label, score → argmax level, manual → as given. */
export function collapse(answer: Answer): boolean | string | number {
  if ("manual" in answer) return answer.manual;
  switch (answer.type) {
    case "noul": return answer.noul >= 0.5;
    case "choice": return answer.choice;
    case "score": {
      const [level] = Object.entries(answer.probabilities).reduce((best, cur) => (cur[1] > best[1] ? cur : best));
      return Number(level);
    }
  }
}

/** Whether an answer crosses its threshold the way Decision.review decides; null for manual answers. */
export function crossed(answer: Answer, threshold: number | undefined): { flagged: boolean; reason: string } | null {
  if ("manual" in answer) return null;
  if (answer.type === "noul") {
    const margin = threshold ?? DEFAULT_NOUL_MARGIN;
    return { flagged: Math.abs(answer.noul - 0.5) < margin, reason: `within ${margin} of 0.5` };
  }
  const minimum = threshold ?? DEFAULT_MIN_CONFIDENCE;
  return { flagged: answer.confidence < minimum, reason: `confidence below ${minimum}` };
}

/** The distribution of an answer as label → probability, for the bars. */
export function distribution(answer: Answer): [string, number][] {
  if ("manual" in answer) return [];
  if (answer.type === "noul") return [["true", answer.noul], ["false", 1 - answer.noul]];
  return Object.entries(answer.probabilities);
}

/** A form value as the typed JSON value an input of `type` expects (the CLI's `_coerce`). */
export function coerce(raw: string, type: string): unknown {
  const text = raw.trim();
  switch (type) {
    case "string": return raw;
    case "integer": {
      if (!/^-?\d+$/.test(text)) throw new Error(`expected an integer, got ${JSON.stringify(raw)}`);
      return Number(text);
    }
    case "float": {
      const n = Number(text);
      if (text === "" || Number.isNaN(n)) throw new Error(`expected a number, got ${JSON.stringify(raw)}`);
      return n;
    }
    case "boolean": {
      if (/^(true|yes|y|1)$/i.test(text)) return true;
      if (/^(false|no|n|0)$/i.test(text)) return false;
      throw new Error(`expected true or false, got ${JSON.stringify(raw)}`);
    }
    default:
      return JSON.parse(text);   // object, list[...]
  }
}

/** The empty value of a typed input, as text for a form field. */
export function blankFor(type: string): string {
  if (type === "object") return "{}";
  if (type.startsWith("list")) return "[]";
  return "";
}

/** A payload value as the text of a form field. */
export function asFieldText(value: unknown, type: string): string {
  if (value === undefined) return blankFor(type);
  if (type === "string" && typeof value === "string") return value;
  if (type === "boolean" || type === "integer" || type === "float") return String(value);
  return JSON.stringify(value);
}

export function reviewOf(review: ReviewItem[], question: string): ReviewItem | undefined {
  return review.find((r) => r.question === question);
}
