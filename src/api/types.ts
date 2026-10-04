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

export interface ApiErrorBody {
  error: { kind: string; message: string; location?: string };
}
