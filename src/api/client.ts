import type { ApiErrorBody, CatalogEntry, FileEntry, ProcedureInfo, SearchHit } from "./types";

const SERVER_KEY = "aip.server";
const TOKEN_KEY = "aip.token";

/** The server URL. Empty means same origin: the dev proxy, or `aip server --inspector`. */
export function serverUrl(): string {
  return localStorage.getItem(SERVER_KEY) ?? "";
}

export function configure(server: string, token: string | null): void {
  localStorage.setItem(SERVER_KEY, server.replace(/\/$/, ""));
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
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
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);
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
};
