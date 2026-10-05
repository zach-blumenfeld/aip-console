import type {
  AnswerRequest, ApiErrorBody, Capabilities, CatalogEntry, FileEntry, GovernanceQuery, GovernanceRow, NextNode,
  ProcedureInfo, RunDetail, RunSummary, SearchHit, StepRequest, StepResponse,
} from "./types";

const SERVER_KEY = "aip.server";
const TOKEN_KEY = "aip.token";

/** The server URL. Empty means same origin: the dev proxy, or `aip server --inspector`. */
export function serverUrl(): string {
  return localStorage.getItem(SERVER_KEY) ?? "";
}

/** The bearer token, kept in sessionStorage: the design (§11) says never beyond the session. */
export function token(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? "";
}

export function configure(server: string, token: string | null): void {
  const url = server.trim().replace(/\/$/, "");
  if (url) localStorage.setItem(SERVER_KEY, url);
  else localStorage.removeItem(SERVER_KEY);
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, public kind: string, message: string, public location?: string) {
    super(message);
  }
}

/** Fetch with the bearer token; a non-2xx response becomes an ApiError from the envelope. */
async function send(path: string, init: RequestInit = {}, accept = "application/json"): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", accept);
  if (init.body) headers.set("Content-Type", "application/json");
  const bearer = token();
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  const res = await fetch(serverUrl() + path, { ...init, headers });
  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try { body = (await res.json()) as ApiErrorBody; } catch { /* not an envelope */ }
    const e = body?.error;
    throw new ApiError(res.status, e?.kind ?? "http_error", e?.message ?? res.statusText, e?.location);
  }
  return res;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await (await send(path, init)).json()) as T;
}

/** One file of a revision: the raw bytes and the media type the server guessed from the path. */
export interface FileBytes { bytes: Uint8Array; mediaType: string }

/** A file path as URL path segments: slashes kept, each segment encoded. */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export const api = {
  catalog: () => request<CatalogEntry[]>("/catalog"),
  search: (q: string, limit = 20) =>
    request<SearchHit[]>(`/catalog/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  /** `ref` is a name, `name@rev`, or `name@latest`. */
  info: (ref: string) => request<ProcedureInfo>(`/catalog/${encodeURIComponent(ref)}`),
  /** The file manifest of a revision: path, size, sha256, mode. */
  files: (ref: string) => request<FileEntry[]>(`/catalog/${encodeURIComponent(ref)}/files`),
  /** The raw bytes of one file of a revision. */
  file: async (ref: string, path: string): Promise<FileBytes> => {
    const res = await send(`/catalog/${encodeURIComponent(ref)}/files/${encodePath(path)}`, {}, "*/*");
    return { bytes: new Uint8Array(await res.arrayBuffer()), mediaType: res.headers.get("Content-Type") ?? "application/octet-stream" };
  },

  // Execution: the same calls the CLI runner makes (aip.client.runner).
  capabilities: (ref: string) => request<Capabilities>(`/procedures/${encodeURIComponent(ref)}/capabilities`),
  /** What receives `payload` after step `after` (null = the start), routers already walked. */
  peek: (ref: string, after: string | null, payload: Record<string, unknown>) =>
    request<NextNode | null>(`/procedures/${encodeURIComponent(ref)}/peek`, { method: "POST", body: JSON.stringify({ after, payload }) }),
  step: (ref: string, body: StepRequest) =>
    request<StepResponse>(`/procedures/${encodeURIComponent(ref)}/step`, { method: "POST", body: JSON.stringify(body) }),
  answer: (ref: string, body: AnswerRequest) =>
    request<StepResponse>(`/procedures/${encodeURIComponent(ref)}/answer`, { method: "POST", body: JSON.stringify(body) }),

  runs: (filter: { name?: string; status?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (filter.name) q.set("name", filter.name);
    if (filter.status) q.set("status", filter.status);
    if (filter.limit) q.set("limit", String(filter.limit));
    const qs = q.toString();
    return request<RunSummary[]>(`/runs${qs ? "?" + qs : ""}`);
  },
  run: (id: string) => request<RunDetail>(`/runs/${encodeURIComponent(id)}`),

  // Governance (§7): the publish scope for pin, retire and thresholds; read for the corpus queries.
  /** Pin `revision` as what the bare name resolves to; null clears the pin (latest live again). */
  pin: (name: string, revision: string | null) =>
    request<{ name: string; pinned: string | null }>(`/catalog/${encodeURIComponent(name)}/pin`, { method: "POST", body: JSON.stringify({ revision }) }),
  retire: (name: string, revision: string) =>
    request<{ name: string; retired: string }>(`/catalog/${encodeURIComponent(name)}/retire`, { method: "POST", body: JSON.stringify({ revision }) }),
  thresholds: (name: string) =>
    request<{ name: string; thresholds: Record<string, number> }>(`/catalog/${encodeURIComponent(name)}/thresholds`),
  /** Replaces the whole map: send every override that should remain. */
  setThresholds: (name: string, thresholds: Record<string, number>) =>
    request<{ name: string; thresholds: Record<string, number> }>(`/catalog/${encodeURIComponent(name)}/thresholds`, { method: "POST", body: JSON.stringify({ thresholds }) }),
  governance: () => request<GovernanceQuery[]>("/governance"),
  governanceQuery: (query: string, filter: { name?: string; window?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (filter.name) q.set("name", filter.name);
    if (filter.window) q.set("window", String(filter.window));
    if (filter.limit) q.set("limit", String(filter.limit));
    const qs = q.toString();
    return request<GovernanceRow[]>(`/governance/${encodeURIComponent(query)}${qs ? "?" + qs : ""}`);
  },
};
