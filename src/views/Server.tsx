import { useState } from "react";
import { api, configure, serverUrl, token } from "../api/client";
import { describe } from "./Source";

/** The server this browser talks to and the bearer token it sends (design §11: the token never
 *  outlives the session, so it lives in sessionStorage; the URL is a per-browser convenience). */
export function Server() {
  const [server, setServer] = useState(serverUrl());
  const [bearer, setBearer] = useState(token());
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setNote(null);
    configure(server, bearer || null);
    try {
      const all = await api.catalog();
      setNote(`Saved. The catalog at ${serverUrl() || "this origin"} has ${all.length} ${all.length === 1 ? "procedure" : "procedures"}.`);
    } catch (e) {
      setError(describe(e));
    }
    window.dispatchEvent(new Event("hashchange"));   // the header shows the server URL
  };

  return (
    <article className="server">
      <h1>Server</h1>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="fields">
        <label className="field">server URL
          <input type="text" aria-label="server URL" value={server} placeholder="same origin (the dev proxy, or aip server --inspector)"
                 onChange={(e) => setServer(e.target.value)} />
          <span className="muted small">Empty means the origin this page was served from. Another origin needs the server to allow it.</span>
        </label>
        <label className="field">bearer token
          <input type="password" aria-label="bearer token" value={bearer} autoComplete="off"
                 onChange={(e) => setBearer(e.target.value)} />
          <span className="muted small">
            Needed off localhost, and for pin, retire and thresholds (the <code>publish</code> scope). Kept for this tab's session only.
          </span>
        </label>
        <div className="actions">
          <button type="submit">Save</button>
          <button type="button" onClick={() => { setServer(""); setBearer(""); configure("", null); setNote("Cleared."); }}>Clear</button>
        </div>
      </form>
      {note && <p className="muted" data-testid="server-note">{note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}
