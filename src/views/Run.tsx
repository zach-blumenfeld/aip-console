import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type {
  Capabilities, CatalogEntry, HistoryEntry, NextNode, NextQuestion, NextStep, ProcedureInfo, ReviewItem, StepResponse,
} from "../api/types";
import { asFieldText, coerce, describeNext, expectsOf } from "../run/protocol";
import { href } from "../router";
import { RunStepCard } from "./RunStepCard";
import { describe } from "./Source";

/** View 3: the run console. Same `/step` and `/answer` calls the CLI runner makes. */
export function Run({ reference }: { reference?: string }) {
  if (!reference) return <Picker />;
  return <Console key={reference} reference={reference} />;
}

function Picker() {
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.catalog().then(setEntries).catch((e: unknown) => setError(describe(e))); }, []);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!entries) return <p className="muted">Loading the catalog…</p>;
  return (
    <article>
      <h1>Run a procedure</h1>
      <p>Pick a procedure; the pinned revision runs, else the latest.</p>
      <ul className="picker">
        {entries.map((c) => (
          <li key={c.name}>
            <a href={href({ page: "run", ref: c.name })}><code>{c.name}</code></a>
            <span className="muted"> @{c.pinned ?? c.latest}{c.pinned ? " (pinned)" : ""} — {c.description}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

// ------------------------------------------------------------------ the session

/** One request/response pair; `entries` are the history entries this call added (routers included). */
interface Turn { response: StepResponse; entries: HistoryEntry[] }

type Pending =
  | { kind: "start" }
  | { kind: "input"; after: string; payload: Record<string, unknown>; next: NextNode }
  | { kind: "decision"; after: string | null; payload: Record<string, unknown>; node: NextStep }
  | { kind: "client_task"; after: string; payload: Record<string, unknown>; next: NextNode; task: string }
  | { kind: "review"; after: string; payload: Record<string, unknown>; next: NextNode; review: ReviewItem[] }
  | { kind: "done"; state: Record<string, unknown> };

interface Session {
  turns: Turn[];
  history: HistoryEntry[];
  runId: string | null;
  pending: Pending;
}

const fresh: Session = { turns: [], history: [], runId: null, pending: { kind: "start" } };

function Console({ reference }: { reference: string }) {
  const [info, setInfo] = useState<ProcedureInfo | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session>(fresh);
  const [busy, setBusy] = useState(false);
  // Threshold overrides for this run, as typed; blank means "no override".
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    setError(null);
    Promise.all([api.info(reference), api.capabilities(reference)])
      .then(([i, c]) => { setInfo(i); setCaps(c); })
      .catch((e: unknown) => setError(describe(e)));
  }, [reference]);

  const thresholds = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [q, raw] of Object.entries(overrides)) {
      const n = Number(raw);
      if (raw.trim() !== "" && !Number.isNaN(n)) out[q] = n;
    }
    return out;
  }, [overrides]);

  /** Thresholds in force: author defaults, the server's stored overrides, then this run's. */
  const effective = useMemo(() => {
    const out: Record<string, number> = {};
    for (const q of info?.questions ?? []) if (q.threshold !== null) out[q.name] = q.threshold;
    Object.assign(out, info?.thresholds ?? {}, thresholds);
    return out;
  }, [info, thresholds]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!info || !caps) return <p className="muted">Loading {reference}…</p>;

  const ref = `${info.name}@${info.revision}`;

  /** What a step response leaves to do next (the runner's `_continue`). */
  const settle = (s: Session, response: StepResponse): Session => {
    const entries = response.history.slice(s.history.length);
    const base = { turns: [...s.turns, { response, entries }], history: response.history, runId: response.run_id ?? s.runId };
    if (response.next === null) return { ...base, pending: { kind: "done", state: response.result } };
    if (response.kind === "client_task") {
      return { ...base, pending: { kind: "client_task", after: response.ran, payload: response.suggested, next: response.next,
                                   task: String(response.result.task) } };
    }
    if (response.review.length > 0) {
      return { ...base, pending: { kind: "review", after: response.ran, payload: response.suggested, next: response.next, review: response.review } };
    }
    return { ...base, pending: { kind: "input", after: response.ran, payload: response.suggested, next: response.next } };
  };

  /** One move of the runner's loop: peek, then either pause for a manual decision or step. */
  const advance = async (s: Session, after: string | null, payload: Record<string, unknown>): Promise<Session> => {
    const node = await api.peek(ref, after, payload);
    if (node && node.kind === "decision" && !caps.decision_model) {
      return { ...s, pending: { kind: "decision", after, payload, node } };
    }
    const response = await api.step(ref, {
      after, payload, history: s.history, run_id: s.runId,
      thresholds: Object.keys(thresholds).length ? thresholds : undefined,
    });
    return settle(s, response);
  };

  const guard = async (work: () => Promise<Session>) => {
    setBusy(true);
    setError(null);
    try { setSession(await work()); } catch (e) { setError(describe(e)); } finally { setBusy(false); }
  };

  const step = (after: string | null, payload: Record<string, unknown>) => guard(() => advance(session, after, payload));

  const runToPause = (after: string | null, payload: Record<string, unknown>) => guard(async () => {
    let s = await advance(session, after, payload);
    while (s.pending.kind === "input") s = await advance(s, s.pending.after, s.pending.payload);
    return s;
  });

  const answer = (answers: Record<string, boolean | string | number>) => guard(async () => {
    if (session.pending.kind !== "decision") return session;
    const { after, payload } = session.pending;
    const response = await api.answer(ref, { after, payload, history: session.history, answers, run_id: session.runId });
    return settle(session, response);
  });

  const { pending } = session;
  const status = pending.kind === "done" ? "done" : pending.kind === "start" ? "not started" : session.turns.length === 0 && pending.kind === "decision" ? "paused" : pending.kind === "input" ? "running" : "paused";
  const last = session.turns[session.turns.length - 1];

  return (
    <article className="run">
      <nav className="crumbs">
        <a href={href({ page: "catalog" })}>catalog</a> / <a href={href({ page: "procedure", ref })}><code>{info.name}</code></a> / run
      </nav>
      <h1>{info.name} <span className="muted rev">run @{info.revision}</span></h1>
      <p className="run-meta">
        <span>status <strong data-testid="run-status">{status}</strong></span>
        {session.runId && <span> · run <a href={href({ page: "run-detail", id: session.runId })}><code data-testid="run-id">{session.runId}</code></a></span>}
        {!caps.decision_model && <span className="muted"> · no decision model: decisions are answered here</span>}
        {!caps.persists_runs && <span className="muted"> · runs are not persisted by this server</span>}
        {session.turns.length > 0 && <> · <button type="button" onClick={() => setSession(fresh)} disabled={busy}>new run</button></>}
      </p>

      <div className="run-grid">
        <div>
          {session.turns.map((t, ti) => t.entries.map((entry, ei) => {
            const isLast = ei === t.entries.length - 1;
            return (
              <RunStepCard key={`${ti}.${ei}`} entry={entry} info={info} thresholds={effective}
                           index={session.turns.slice(0, ti).reduce((n, x) => n + x.entries.length, 0) + ei + 1}
                           after={isLast && entry.kind !== "end" ? t.response.suggested : undefined}
                           review={isLast ? t.response.review : []} />
            );
          }))}

          {error && <p className="error" role="alert">{error}</p>}

          {pending.kind === "start" && (
            <PayloadForm title={`Start input for ${info.start.step}`} testid="pause-start" expects={Object.fromEntries(info.inputs.filter((i) => i.step === info.start.step).map((i) => [i.name, i.type]))}
                         initial={info.example_input} busy={busy}
                         onStep={(p) => step(null, p)} onRun={(p) => runToPause(null, p)} />
          )}
          {pending.kind === "input" && (
            <PayloadForm title={`Input for ${describeNext(pending.next)}`} testid="pause-input" expects={expectsOf(pending.next)}
                         initial={pending.payload} busy={busy}
                         onStep={(p) => step(pending.after, p)} onRun={(p) => runToPause(pending.after, p)} />
          )}
          {pending.kind === "decision" && (
            <DecisionForm node={pending.node} busy={busy} onAnswer={answer} />
          )}
          {pending.kind === "client_task" && (
            <PayloadForm title={`Client task ${pending.after}: produce the input for ${describeNext(pending.next)}`} testid="pause-client-task"
                         intro={<p className="muted">The task is shown above. Fill in what it asks for; the state passes through.</p>}
                         expects={expectsOf(pending.next)} initial={pending.payload} busy={busy}
                         onStep={(p) => step(pending.after, p)} onRun={(p) => runToPause(pending.after, p)} />
          )}
          {pending.kind === "review" && (
            <PayloadForm title={`Review ${pending.after}: confirm or override before ${describeNext(pending.next)}`} testid="pause-review"
                         intro={<ReviewList review={pending.review} suggested={pending.payload} />}
                         expects={Object.fromEntries(pending.review.map((r) => [r.question, typeOfValue(pending.payload[r.question])]))}
                         initial={pending.payload} busy={busy}
                         onStep={(p) => step(pending.after, p)} onRun={(p) => runToPause(pending.after, p)} />
          )}
          {pending.kind === "done" && (
            <section className="pause" data-testid="run-done">
              <h2>Done</h2>
              <p className="muted">The final state is the end step's card above{last ? ` (${session.history.length} entries)` : ""}.</p>
            </section>
          )}
        </div>

        <aside>
          <h2>Thresholds for this run</h2>
          <p className="muted small">Sent as <code>thresholds</code> with every step. Noul: margin around 0.5; choice and score: minimum confidence.</p>
          <table className="compact" aria-label="threshold overrides">
            <thead><tr><th>question</th><th>author</th><th>server</th><th>this run</th></tr></thead>
            <tbody>
              {info.questions.map((q) => (
                <tr key={`${q.step}.${q.name}`}>
                  <td><code>{q.name}</code><div className="muted small">{q.step} · {q.type}</div></td>
                  <td>{q.threshold ?? <span className="muted">default</span>}</td>
                  <td>{info.thresholds[q.name] ?? <span className="muted">—</span>}</td>
                  <td><input type="number" step="0.05" min="0" max="1" className="threshold" aria-label={`threshold for ${q.name}`}
                             value={overrides[q.name] ?? ""} placeholder={String(effective[q.name] ?? "")}
                             onChange={(e) => setOverrides({ ...overrides, [q.name]: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>History</h2>
          <ol className="trace small" data-testid="trace">
            {session.history.map((h, i) => <li key={i}><code>{h.step}</code> <span className="muted">{h.kind}</span></li>)}
          </ol>
        </aside>
      </div>
    </article>
  );
}

function typeOfValue(v: unknown): string {
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "float";
  if (typeof v === "string") return "string";
  return Array.isArray(v) ? "list[*]" : "object";
}

// ------------------------------------------------------------------ the forms

interface PayloadFormProps {
  title: string;
  testid: string;
  intro?: React.ReactNode;
  /** Keys the next step expects, with their types: a typed field each. */
  expects: Record<string, string>;
  initial: Record<string, unknown>;
  busy: boolean;
  onStep: (payload: Record<string, unknown>) => void;
  onRun: (payload: Record<string, unknown>) => void;
}

/** The next payload: typed fields for the expected keys, and the whole object as JSON (the source of truth). */
function PayloadForm({ title, testid, intro, expects, initial, busy, onStep, onRun }: PayloadFormProps) {
  const [text, setText] = useState(() => JSON.stringify(withBlanks(initial, expects), null, 2));
  const [problem, setProblem] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      const v = JSON.parse(text);
      if (!v || typeof v !== "object" || Array.isArray(v)) return null;
      return v as Record<string, unknown>;
    } catch { return null; }
  }, [text]);

  const setKey = (key: string, raw: string, type: string) => {
    if (!parsed) return;
    try {
      setText(JSON.stringify({ ...parsed, [key]: coerce(raw, type) }, null, 2));
      setProblem(null);
    } catch (e) { setProblem(`${key}: ${(e as Error).message}`); }
  };

  const submit = (go: (p: Record<string, unknown>) => void) => {
    if (!parsed) { setProblem("the payload must be a JSON object"); return; }
    const missing = Object.keys(expects).filter((k) => !(k in parsed));
    if (missing.length) { setProblem(`missing ${missing.join(", ")}`); return; }
    setProblem(null);
    go(parsed);
  };

  return (
    <section className="pause" data-testid={testid}>
      <h2>{title}</h2>
      {intro}
      {Object.keys(expects).length > 0 && (
        <div className="fields">
          {Object.entries(expects).map(([key, type]) => (
            <label key={key} className="field">
              <span><code>{key}</code> <span className="muted small">{type}</span></span>
              {type === "boolean" ? (
                <input type="checkbox" checked={parsed?.[key] === true} disabled={!parsed || busy}
                       onChange={(e) => setKey(key, String(e.target.checked), type)} aria-label={key} />
              ) : type === "string" ? (
                <textarea rows={3} value={parsed ? asFieldText(parsed[key], type) : ""} disabled={!parsed || busy}
                          onChange={(e) => setKey(key, e.target.value, type)} aria-label={key} />
              ) : (
                <input type="text" value={parsed ? asFieldText(parsed[key], type) : ""} disabled={!parsed || busy}
                       onChange={(e) => setKey(key, e.target.value, type)} aria-label={key} />
              )}
            </label>
          ))}
        </div>
      )}
      <label className="field">
        <span>payload <span className="muted small">JSON; extra keys pass through</span></span>
        <textarea className="json" rows={Math.min(16, text.split("\n").length + 1)} value={text} data-testid="payload"
                  aria-label="payload" disabled={busy} onChange={(e) => { setText(e.target.value); setProblem(null); }} />
      </label>
      {!parsed && <p className="error small">Not a JSON object.</p>}
      {problem && <p className="error small" role="alert">{problem}</p>}
      <div className="actions">
        <button type="button" onClick={() => submit(onStep)} disabled={busy || !parsed}>Step</button>
        <button type="button" onClick={() => submit(onRun)} disabled={busy || !parsed}>Run to pause</button>
        {busy && <span className="muted">working…</span>}
      </div>
    </section>
  );
}

function withBlanks(initial: Record<string, unknown>, expects: Record<string, string>): Record<string, unknown> {
  const out = { ...initial };
  for (const [k, t] of Object.entries(expects)) {
    if (!(k in out)) out[k] = t === "object" ? {} : t.startsWith("list") ? [] : t === "boolean" ? false : t === "string" ? "" : 0;
  }
  return out;
}

function ReviewList({ review, suggested }: { review: ReviewItem[]; suggested: Record<string, unknown> }) {
  return (
    <ul className="review" data-testid="review-items">
      {review.map((r) => (
        <li key={r.question}>
          <code>{r.question}</code>: {r.reason}; the model says <code>{JSON.stringify(suggested[r.question])}</code>
          {r.probabilities && <span className="muted small"> {JSON.stringify(r.probabilities)}</span>}
          {r.noul !== undefined && <span className="muted small"> p(true) = {r.noul.toFixed(3)}</span>}
        </li>
      ))}
    </ul>
  );
}

/** A decision without a model: the client answers each question (the CLI's `_prompt_answers`). */
function DecisionForm({ node, busy, onAnswer }: { node: NextStep; busy: boolean; onAnswer: (a: Record<string, boolean | string | number>) => void }) {
  const questions = Object.entries(node.questions ?? {});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    const answers: Record<string, boolean | string | number> = {};
    for (const [name, q] of questions) {
      const v = picked[name];
      if (v === undefined) { setProblem(`answer ${name}`); return; }
      answers[name] = q.type === "noul" ? v === "true" : q.type === "score" ? Number(v) : v;
    }
    setProblem(null);
    onAnswer(answers);
  };

  return (
    <section className="pause" data-testid="pause-decision">
      <h2>Decision {node.step}: answer its questions</h2>
      <p className="muted">This server has no decision model, so the answers are yours; they are recorded as a manual decision.</p>
      {questions.map(([name, q]) => (
        <fieldset key={name} className="question">
          <legend><code>{name}</code> <span className="muted small">{q.type}</span></legend>
          <p>{q.instructions}</p>
          {optionsOf(q).map(([value, label]) => (
            <label key={value} className="option">
              <input type="radio" name={`q-${node.step}-${name}`} value={value} checked={picked[name] === value} disabled={busy}
                     onChange={() => setPicked({ ...picked, [name]: value })} />
              {" "}{label}
            </label>
          ))}
        </fieldset>
      ))}
      {problem && <p className="error small" role="alert">{problem}</p>}
      <div className="actions">
        <button type="button" onClick={submit} disabled={busy}>Answer</button>
        {busy && <span className="muted">working…</span>}
      </div>
    </section>
  );
}

/** [value, label] pairs for one question's radios. */
function optionsOf(q: NextQuestion): [string, string][] {
  if (q.type === "noul") {
    const c = (q.criteria ?? {}) as Record<string, string | null>;
    return [["true", c.true ? `yes — ${c.true}` : "yes"], ["false", c.false ? `no — ${c.false}` : "no"]];
  }
  if (q.type === "choice") {
    return Object.entries((q.criteria ?? {}) as Record<string, string | null>).map(([label, d]) => [label, d ? `${label} — ${d}` : label]);
  }
  return ((q.criteria ?? []) as (string | null)[]).map((d, i) => [String(i), d ? `${i} — ${d}` : String(i)]);
}
