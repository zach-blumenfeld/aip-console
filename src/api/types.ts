// Response shapes of the AIP server API (server-design.md §4.2). Only what the
// views read is typed; everything else stays `unknown` until a view needs it.

export interface Revision {
  revision: string;
  published_at: string;
  retired: boolean;
}

export interface CatalogEntry {
  name: string;
  description: string;
  pinned: string | null;
  latest: string;
  revisions: Revision[];
}

export interface SearchHit {
  name: string;
  revision: string;
  description: string;
  score: number;
}

export type StepKind = "decision" | "router" | "execution" | "client_task" | "end";

export interface StepDetail {
  name: string;
  kind: StepKind;
  order: number;
  description: string | null;
  branch_on?: string;   // router
  script?: string;      // execution
  timeout?: number | null;
  template?: string;    // client_task
  framing?: boolean;
}

export interface Edge { from: string; to: string }
export interface Branch { router: string; value: string; to: string }

export interface StepInput {
  step: string;
  order: number;
  name: string;
  type: string;
  description: string | null;
}

export interface Question {
  step: string;
  order: number;
  name: string;
  type: string;
  instructions: string;
  criteria: string | null;   // JSON text
  threshold: number | null;
}

export interface Resource {
  step: string;
  path: string;
  role: "script" | "template" | "asset" | "reference";
  description: string | null;
}

export interface FileEntry { path: string; size: number; sha256: string; mode: number }

/** `GET /catalog/{ref}`: describe() plus the `aip info` fields and the projection. */
export interface ProcedureInfo {
  name: string;
  revision: string;
  id: string;
  description: string;
  aip_version: string | null;
  published_at: string;
  retired: boolean;
  purpose: string;
  trigger_when: string[];
  do_not_use_when: string[];
  anti_patterns: string[];
  example_input: Record<string, unknown>;
  thresholds: Record<string, number>;
  start: { step: string; kind: StepKind };
  end: { step: string; kind: StepKind };
  steps: Record<string, StepKind>;
  step_details: StepDetail[];
  edges: Edge[];
  branches: Branch[];
  inputs: StepInput[];
  questions: Question[];
  resources: Resource[];
  files: FileEntry[];
}

export interface ApiErrorBody {
  error: { kind: string; message: string; location?: string };
}
