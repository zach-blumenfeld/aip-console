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

// ---------------------------------------------------------------- execution (§4.2, StepResponse)

export interface Capabilities {
  name: string;
  revision: string;
  decision_model: boolean;
  executes_scripts: boolean;
  persists_runs: boolean;
  governance: boolean;
}

/** A decision question as `describe_next` and the peek endpoint hand it out. */
export interface NextQuestion {
  type: "noul" | "choice" | "score";
  instructions?: string;
  /** noul: {true, false} descriptions; choice: label -> description; score: one description per level. */
  criteria?: Record<string, string | null> | (string | null)[];
}

/** `describe_next(node)`: what receives the next input. Routers list every branch's shape. */
export interface NextRouter { step: string; kind: "router"; branch_on: string; branches: Record<string, NextNode | null> }
export interface NextStep {
  step: string;
  kind: Exclude<StepKind, "router">;
  inputs: Record<string, string>;
  questions?: Record<string, NextQuestion>;
}
export type NextNode = NextRouter | NextStep;

/** One answer of a decision model, or a manual one from `/answer`. */
export type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; legend: Record<string, unknown>; probabilities: Record<string, number> }
  | { type: "noul" | "choice" | "score"; manual: boolean | string | number };

export interface DecisionResult {
  model?: string;
  usage?: { input_tokens: number | null; output_tokens: number | null };
  answers: Record<string, Answer>;
}

export interface ClientTaskResult {
  task: string;
  references: { uri: string; description: string }[];
}

/** One history entry: what a step received and produced. Routers record the branch they took. */
export interface HistoryEntry {
  step: string;
  kind: StepKind | "error";
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  manual?: boolean;
  step_kind?: StepKind;
}

export interface ReviewItem {
  question: string;
  type: "noul" | "choice" | "score";
  reason: string;
  noul?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}

/** `POST /procedures/{ref}/step|answer`. */
export interface StepResponse {
  ran: string;
  kind: StepKind;
  result: Record<string, unknown>;
  suggested: Record<string, unknown>;
  review: ReviewItem[];
  next: NextNode | null;
  history: HistoryEntry[];
  run_id: string | null;
  name: string;
  revision: string;
}

export interface StepRequest {
  after: string | null;
  payload: Record<string, unknown>;
  history: HistoryEntry[];
  thresholds?: Record<string, number>;
  run_id?: string | null;
}

export interface AnswerRequest {
  after: string | null;
  payload: Record<string, unknown>;
  history: HistoryEntry[];
  answers: Record<string, boolean | string | number>;
  run_id?: string | null;
}

export type RunStatus = "running" | "paused" | "done" | "error";

export interface RunSummary {
  run_id: string;
  name: string;
  revision: string;
  status: RunStatus;
  started_at: string;
  updated_at: string;
  steps: number;
}

/** Why a run is paused (`run_status` in the server): the client task to do, or the answers to review. */
export type RunPause =
  | { kind: "client_task"; step: string; task: string | null; references: { uri: string; description: string }[]; expects: Record<string, string> }
  | { kind: "review"; step: string; review: ReviewItem[]; expects: Record<string, string> };

/** `GET /runs/{id}`: the summary fields plus the full history and the pause block. */
export interface RunDetail {
  run_id: string;
  name: string;
  revision: string;
  status: RunStatus;
  started_at: string;
  updated_at: string;
  pause: RunPause | null;
  history: HistoryEntry[];
}
