import type { ApiErrorBody, CatalogEntry, SearchHit } from "./types";

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
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
  return (await res.json()) as T;
}

export const api = {
  catalog: () => request<CatalogEntry[]>("/catalog"),
  search: (q: string, limit = 20) =>
    request<SearchHit[]>(`/catalog/search?q=${encodeURIComponent(q)}&limit=${limit}`),
};
