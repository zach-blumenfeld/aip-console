import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { CatalogEntry } from "../api/types";

export function Catalog() {
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.catalog().then(setEntries).catch((e: unknown) => {
      setError(e instanceof ApiError ? `${e.kind}: ${e.message}` : String(e));
    });
  }, []);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (entries === null) return <p className="muted">Loading catalog…</p>;
  if (entries.length === 0) return <p className="muted">The catalog is empty.</p>;

  return (
    <table aria-label="catalog">
      <thead>
        <tr><th>Name</th><th>Description</th><th>Latest</th><th>Revisions</th></tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.name}>
            <td><code>{e.name}</code></td>
            <td>{e.description}</td>
            <td><code>{e.latest.slice(0, 8)}</code>{e.pinned ? " (pinned)" : ""}</td>
            <td>{e.revisions.length}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
