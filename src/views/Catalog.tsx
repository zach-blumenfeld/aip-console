import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { CatalogEntry, Requires, SearchHit } from "../api/types";
import { href } from "../router";
import { requiresText } from "./Requires";

export function Catalog() {
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => setError(e instanceof ApiError ? `${e.kind}: ${e.message}` : String(e));

  // What each name's resolved revision needs on the machine that runs its scripts; the listing does not carry it.
  const [requires, setRequires] = useState<Record<string, Requires | null>>({});

  useEffect(() => { api.catalog().then(setEntries).catch(fail); }, []);
  useEffect(() => {
    for (const e of entries ?? []) {
      api.info(e.name).then((info) => setRequires((r) => ({ ...r, [e.name]: info.requires }))).catch(() => undefined);
    }
  }, [entries]);

  // Search replaces the table while the query is non-empty; debounced so typing
  // does not fire a request per keystroke.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setHits(null); return; }
    const t = setTimeout(() => api.search(q).then(setHits).catch(fail), 200);
    return () => clearTimeout(t);
  }, [query]);

  const link = (name: string, revision?: string) =>
    href({ page: "procedure", ref: revision ? `${name}@${revision}` : name });

  return (
    <>
      <form role="search" onSubmit={(e) => e.preventDefault()}>
        <input type="search" placeholder="Search procedures…" aria-label="search" value={query}
               onChange={(e) => setQuery(e.target.value)} autoFocus />
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {hits !== null ? (
        hits.length === 0 ? <p className="muted">No procedure matches “{query.trim()}”.</p> : (
          <table aria-label="search results">
            <thead><tr><th>#</th><th>Name</th><th>Description</th><th>Revision</th><th>Score</th></tr></thead>
            <tbody>
              {hits.map((h, i) => (
                <tr key={`${h.name}@${h.revision}`}>
                  <td className="muted">{i + 1}</td>
                  <td><a href={link(h.name, h.revision)}><code>{h.name}</code></a></td>
                  <td>{h.description}</td>
                  <td><code>{h.revision.slice(0, 8)}</code></td>
                  <td>{h.score.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : entries === null ? <p className="muted">Loading catalog…</p>
        : entries.length === 0 ? <p className="muted">The catalog is empty.</p> : (
          <table aria-label="catalog">
            <thead><tr><th>Name</th><th>Description</th><th>Latest</th><th>Revisions</th><th>Requires</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.name}>
                  <td><a href={link(e.name)}><code>{e.name}</code></a></td>
                  <td>{e.description}</td>
                  <td><code>{e.latest.slice(0, 8)}</code>{e.pinned ? " (pinned)" : ""}</td>
                  <td>{e.revisions.length}</td>
                  <td data-testid="catalog-requires">{e.name in requires ? <code>{requiresText(requires[e.name])}</code> : <span className="muted">…</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </>
  );
}
