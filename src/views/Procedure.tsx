import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { CatalogEntry, ProcedureInfo, Question, Resource, StepDetail, StepInput } from "../api/types";
import { href, navigate } from "../router";
import { describe } from "./Source";
import { StepGraph } from "./StepGraph";

export function Procedure({ reference }: { reference: string }) {
  const [info, setInfo] = useState<ProcedureInfo | null>(null);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after pin or retire: both fetches run again, the page stays up meanwhile.
  const [version, setVersion] = useState(0);
  const name = reference.split("@")[0];

  useEffect(() => {
    setError(null);
    api.info(reference).then(setInfo).catch((e: unknown) => {
      setError(e instanceof ApiError ? `${e.kind}: ${e.message}` : String(e));
    });
  }, [reference, version]);
  useEffect(() => { setInfo(null); }, [reference]);

  useEffect(() => {
    api.catalog().then((all) => setEntry(all.find((c) => c.name === name) ?? null)).catch(() => setEntry(null));
  }, [name, version]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (info === null) return <p className="muted">Loading {reference}…</p>;

  const byStep = <T extends { step: string }>(rows: T[], step: string) => rows.filter((r) => r.step === step);
  // Revisions are newest first; the one after the current is the one published before it.
  const revisions = entry?.revisions.map((r) => r.revision) ?? [];
  const previous = revisions[revisions.indexOf(info.revision) + 1];

  return (
    <article className="procedure">
      <nav className="crumbs"><a href={href({ page: "catalog" })}>catalog</a> / <code>{info.name}</code></nav>
      <h1>
        {info.name}
        <span className="muted rev"> @{info.revision}{info.retired ? " (retired)" : ""}</span>
      </h1>
      <p>{info.description}</p>

      <div className="procedure-grid">
        <section>
          <h2>Steps</h2>
          <StepGraph steps={info.step_details} edges={info.edges} branches={info.branches}
                     start={info.start.step} end={info.end.step} />
        </section>

        <section>
          <h2>Revisions</h2>
          <RevisionPicker entry={entry} current={info.revision} name={info.name} />
          <p className="links">
            <a href={href({ page: "source", ref: `${info.name}@${info.revision}` })}>source</a>
            <span className="muted"> · {info.files.length} files</span>
            {previous && <> · <a href={href({ page: "diff", name: info.name, a: previous, b: info.revision })}>diff with previous</a></>}
            {" · "}<a href={href({ page: "run", ref: `${info.name}@${info.revision}` })}>run</a>
            {" · "}<a href={href({ page: "runs", name: info.name })}>history</a>
          </p>

          <h2>Purpose</h2>
          <p className="prose">{info.purpose}</p>
          <List title="Use when" items={info.trigger_when} />
          <List title="Do not use when" items={info.do_not_use_when} />
          <List title="Anti-patterns" items={info.anti_patterns} />

          <h2>Start input</h2>
          <p className="muted">Step <code>{info.start.step}</code> ({info.start.kind})</p>
          <pre data-testid="example-input">{JSON.stringify(info.example_input, null, 2)}</pre>
        </section>
      </div>

      <Governance key={info.id} info={info} entry={entry} onChanged={() => setVersion((v) => v + 1)} />

      <h2>Step details</h2>
      {info.step_details.map((s) => (
        <StepCard key={s.name} step={s} isStart={s.name === info.start.step} isEnd={s.name === info.end.step}
                  inputs={byStep(info.inputs, s.name)} questions={byStep(info.questions, s.name)}
                  resources={byStep(info.resources, s.name)} branches={info.branches.filter((b) => b.router === s.name)}
                  next={info.edges.find((e) => e.from === s.name)?.to} />
      ))}
    </article>
  );
}

function RevisionPicker({ entry, current, name }: { entry: CatalogEntry | null; current: string; name: string }) {
  if (!entry) return <p className="muted">—</p>;
  return (
    <select aria-label="revision" value={current}
            onChange={(e) => navigate({ page: "procedure", ref: `${name}@${e.target.value}` })}>
      {entry.revisions.map((r) => (
        <option key={r.revision} value={r.revision}>
          {r.revision}{r.revision === entry.pinned ? " · pinned" : ""}{r.revision === entry.latest ? " · latest" : ""}
          {r.retired ? " · retired" : ""} — {r.published_at.slice(0, 10)}
        </option>
      ))}
    </select>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <>
      <h3>{title}</h3>
      <ul>{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
    </>
  );
}

interface CardProps {
  step: StepDetail; isStart: boolean; isEnd: boolean;
  inputs: StepInput[]; questions: Question[]; resources: Resource[];
  branches: { value: string; to: string }[]; next?: string;
}

function StepCard({ step, isStart, isEnd, inputs, questions, resources, branches, next }: CardProps) {
  return (
    <section className={`step-card kind-${step.kind}`} id={`step-${step.name}`}>
      <h3>
        <code>{step.name}</code> <span className="kind-tag">{step.kind}</span>
        {isStart && <span className="muted"> · start</span>}{isEnd && <span className="muted"> · end</span>}
      </h3>
      {step.description && <p>{step.description}</p>}
      <dl>
        {step.kind === "router" && <><dt>branch on</dt><dd><code>{step.branch_on}</code></dd></>}
        {step.kind === "execution" && <><dt>script</dt><dd><code>{step.script}</code>{step.timeout ? ` (timeout ${step.timeout}s)` : ""}</dd></>}
        {step.kind === "client_task" && <><dt>template</dt><dd><code>{step.template}</code>{step.framing ? " · framed" : ""}</dd></>}
        {next && <><dt>inputs to</dt><dd><a href={`#step-${next}`}><code>{next}</code></a></dd></>}
      </dl>
      {branches.length > 0 && (
        <table className="compact"><thead><tr><th>value</th><th>to</th></tr></thead>
          <tbody>{branches.map((b) => <tr key={b.value}><td><code>{b.value}</code></td><td><a href={`#step-${b.to}`}><code>{b.to}</code></a></td></tr>)}</tbody>
        </table>
      )}
      {inputs.length > 0 && (
        <table className="compact"><thead><tr><th>input</th><th>type</th><th>description</th></tr></thead>
          <tbody>{inputs.map((i) => <tr key={i.name}><td><code>{i.name}</code></td><td>{i.type}</td><td>{i.description ?? ""}</td></tr>)}</tbody>
        </table>
      )}
      {questions.length > 0 && (
        <table className="compact"><thead><tr><th>question</th><th>type</th><th>threshold</th><th>instructions</th></tr></thead>
          <tbody>{questions.map((q) => (
            <tr key={q.name}>
              <td><code>{q.name}</code></td><td>{q.type}</td>
              <td>{q.threshold ?? <span className="muted">default</span>}</td>
              <td>{q.instructions}{q.criteria && <Criteria text={q.criteria} />}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {resources.length > 0 && (
        <table className="compact"><thead><tr><th>resource</th><th>role</th><th>description</th></tr></thead>
          <tbody>{resources.map((r) => <tr key={r.path}><td><code>{r.path}</code></td><td>{r.role}</td><td>{r.description ?? ""}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  );
}

function Criteria({ text }: { text: string }) {
  let parsed: Record<string, string> | null = null;
  try { parsed = JSON.parse(text); } catch { /* shown raw */ }
  if (!parsed) return <pre>{text}</pre>;
  return <ul className="criteria">{Object.entries(parsed).map(([k, v]) => <li key={k}><code>{k}</code>: {v}</li>)}</ul>;
}

// ------------------------------------------------------------------ governance (view 5a, §7)

interface GovernanceProps { info: ProcedureInfo; entry: CatalogEntry | null; onChanged: () => void }

/** Pin and retire this revision. Both need the publish scope: a 403 points at the Server page, where the token
 *  is set. Thresholds are the author's, from SKILL.md, so there is nothing to override here. */
function Governance({ info, entry, onChanged }: GovernanceProps) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRetire, setConfirmRetire] = useState(false);

  const pinned = entry?.pinned ?? null;
  const isPinned = pinned === info.revision;

  const act = async (what: string, call: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await call();
      setNote(done);
      onChanged();
    } catch (e) {
      const forbidden = e instanceof ApiError && (e.status === 401 || e.status === 403);
      setError(`${what} failed: ${describe(e)}${forbidden ? ". Set a token with the publish scope on the Server page." : ""}`);
    } finally {
      setBusy(false);
    }
  };

  const short = (r: string) => r.slice(0, 8);

  return (
    <section className="governance-box" data-testid="governance">
      <h2>Governance</h2>
      <div className="governance-grid">
        <div>
          <h3>Pin</h3>
          <p className="muted small">The bare name resolves to the pinned revision; with no pin, to the latest live one.</p>
          <p data-testid="pin-state">
            {pinned ? <>pinned <code>{short(pinned)}</code>{isPinned ? " (this revision)" : ""}</> : "no pin"}
          </p>
          <div className="actions">
            {!isPinned && !info.retired && (
              <button type="button" disabled={busy}
                      onClick={() => void act("pin", () => api.pin(info.name, info.revision), `Pinned ${short(info.revision)}.`)}>
                Pin this revision
              </button>
            )}
            {pinned && (
              <button type="button" disabled={busy} onClick={() => void act("unpin", () => api.pin(info.name, null), "Unpinned.")}>
                Unpin
              </button>
            )}
          </div>

          <h3>Retire</h3>
          <p className="muted small">A retired revision stays readable and runnable by exact reference, but the name no longer resolves to it.</p>
          {info.retired ? <p data-testid="retired-state">This revision is retired.</p> : (
            <div className="actions">
              {!confirmRetire && <button type="button" disabled={busy} onClick={() => setConfirmRetire(true)}>Retire this revision…</button>}
              {confirmRetire && (
                <>
                  <span>Retire <code>{short(info.revision)}</code>? This cannot be undone.</span>
                  <button type="button" disabled={busy}
                          onClick={() => { setConfirmRetire(false); void act("retire", () => api.retire(info.name, info.revision), `Retired ${short(info.revision)}.`); }}>
                    Confirm retire
                  </button>
                  <button type="button" onClick={() => setConfirmRetire(false)}>Cancel</button>
                </>
              )}
            </div>
          )}
        </div>

      </div>
      {note && <p className="muted" data-testid="governance-note">{note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
