import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { CatalogEntry, GovernanceQuery, GovernanceRow } from "../api/types";
import { href, navigate } from "../router";
import { describe } from "./Source";

const DEFAULT_WINDOW = 100;
const DEFAULT_LIMIT = 50;

/** View 5b: the corpus queries of `GET /governance`, each answered by `GET /governance/{query}` and shown as a list. */
export function Governance({ name }: { name?: string }) {
  const [queries, setQueries] = useState<GovernanceQuery[] | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [window, setWindow] = useState(DEFAULT_WINDOW);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);

  useEffect(() => {
    api.governance().then(setQueries).catch((e: unknown) => setError(describe(e)));
    api.catalog().then((all: CatalogEntry[]) => setNames(all.map((c) => c.name))).catch(() => setNames([]));
  }, []);

  return (
    <article className="governance">
      <h1>Governance</h1>
      <p className="muted">
        What the corpus says about the procedures and their runs. Decisions, scripts and tasks run on the clients, and
        each client reports who answered and how a script ended, so these lists cover every machine that ran a
        procedure. Pin and retire live on each procedure's page; thresholds are the author's, in SKILL.md.
      </p>
      <div className="filters">
        <label>name{" "}
          <select aria-label="name" value={name ?? ""} onChange={(e) => navigate({ page: "governance", name: e.target.value || undefined })}>
            <option value="">any</option>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
            {name && !names.includes(name) && <option value={name}>{name}</option>}
          </select>
        </label>
        <label>last{" "}
          <input className="num-field" type="number" min={1} max={100000} aria-label="window" value={window}
                 onChange={(e) => setWindow(Math.max(1, Number(e.target.value) || DEFAULT_WINDOW))} /> runs
        </label>
        <label>up to{" "}
          <input className="num-field" type="number" min={1} max={10000} aria-label="limit" value={limit}
                 onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || DEFAULT_LIMIT))} /> rows
        </label>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {!error && queries === null && <p className="muted">Loading the queries…</p>}
      {queries?.map((q) => <QueryList key={q.query} query={q} name={name} window={window} limit={limit} />)}
    </article>
  );
}

type Answer =
  | { kind: "loading" }
  | { kind: "rows"; rows: GovernanceRow[] }
  | { kind: "unsupported"; message: string }
  | { kind: "error"; message: string };

function QueryList({ query, name, window, limit }: { query: GovernanceQuery; name?: string; window: number; limit: number }) {
  const [answer, setAnswer] = useState<Answer>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    setAnswer({ kind: "loading" });
    api.governanceQuery(query.query, { name, window, limit })
      .then((rows) => { if (live) setAnswer({ kind: "rows", rows }); })
      .catch((e: unknown) => {
        if (!live) return;
        // A 501 is the backend declining, not a fault: the filesystem backend has no graph to ask.
        if (e instanceof ApiError && e.status === 501) setAnswer({ kind: "unsupported", message: e.message });
        else setAnswer({ kind: "error", message: describe(e) });
      });
    return () => { live = false; };
  }, [query.query, name, window, limit]);

  return (
    <section className="query" data-testid="governance-query" data-query={query.query} data-state={answer.kind}>
      <h2><code>{query.query}</code></h2>
      <p className="muted">{query.description}</p>
      {answer.kind === "loading" && <p className="muted">Asking…</p>}
      {answer.kind === "error" && <p className="error" role="alert">{answer.message}</p>}
      {answer.kind === "unsupported" && (
        <p className="muted" data-testid="needs-graph">
          <span className="status-tag">needs the Neo4j backend</span> {answer.message}
        </p>
      )}
      {answer.kind === "rows" && answer.rows.length === 0 && <p className="muted" data-testid="no-rows">Nothing to report.</p>}
      {answer.kind === "rows" && answer.rows.length > 0 && <Rows rows={query.query === "manual-decisions" ? withResolvers(answer.rows) : answer.rows} />}
    </section>
  );
}

/** The resolver breakdown of a manual-decisions row: of the step's decisions, how many the client's decision
 *  model answered and how many were answered by hand. */
function withResolvers(rows: GovernanceRow[]): GovernanceRow[] {
  return rows.map((row) => {
    const decided = Number(row.decided), manual = Number(row.manual);
    return Number.isFinite(decided) && Number.isFinite(manual)
      ? { ...row, resolvers: { typesafe: decided - manual, manual } } : row;
  });
}

/** Rows are flat; the columns are the keys in order of first appearance. */
function Rows({ rows }: { rows: GovernanceRow[] }) {
  const columns: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  return (
    <table className="compact" aria-label="rows">
      <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} data-testid="governance-row" data-name={cell(row.name)} data-step={cell(row.step)} data-question={cell(row.question)}
              data-resolver={cell(row.resolver)}>
            {columns.map((c) => <td key={c} className={typeof row[c] === "number" ? "num" : undefined}>{render(c, row[c], row)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function cell(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function render(column: string, value: unknown, row: GovernanceRow): React.ReactNode {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  if (column === "resolvers" && typeof value === "object") {
    const { typesafe, manual } = value as { typesafe: number; manual: number };
    const total = typesafe + manual || 1;
    return (
      <span data-testid="resolver-breakdown" data-typesafe={typesafe} data-manual={manual}>
        <span className="resolver-bar" aria-hidden="true">
          <span className="model" style={{ width: `${(100 * typesafe) / total}%` }} />
          <span className="manual" style={{ width: `${(100 * manual) / total}%` }} />
        </span>{" "}
        model {typesafe} · by hand {manual}
      </span>
    );
  }
  if (column === "resolver" && typeof value === "string") return <span className="status-tag" data-testid="resolver">{value}</span>;
  if (column === "stderr" && typeof value === "string") return value ? <pre className="stderr" data-testid="stderr">{value}</pre> : <span className="muted">empty</span>;
  if (column === "exit_code" && typeof value === "number") return <code data-testid="exit-code">{value}</code>;
  if (column === "name" && typeof value === "string") {
    const ref = typeof row.revision === "string" ? `${value}@${row.revision}` : value;
    return <a href={href({ page: "procedure", ref })}><code>{value}</code></a>;
  }
  if (column === "revision" && typeof value === "string") return <code>{value.slice(0, 8)}</code>;
  if (column === "rate" && typeof value === "number") return `${Math.round(value * 100)}%`;
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (typeof value === "string") return column === "step" || column === "question" || column === "script" ? <code>{value}</code> : value;
  if (Array.isArray(value)) return value.map((v, i) => <span key={i}>{i ? ", " : ""}<code>{String(v)}</code></span>);
  return <code>{JSON.stringify(value)}</code>;
}
