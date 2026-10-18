import type { Attribution, ClientTaskResult, DecisionResult, HistoryEntry, ProcedureInfo } from "../api/types";
import { href } from "../router";

interface Props {
  entry: HistoryEntry;
  info: ProcedureInfo;
  /** The state after this step, when the next entry shows it. */
  after?: Record<string, unknown>;
  index: number;
}

/** One step of a recorded run: what it received, what it did, and who did it. Read-only. */
export function RunStepCard({ entry, info, after, index }: Props) {
  const kind = entry.kind === "error" ? entry.step_kind ?? "error" : entry.kind;
  return (
    <section className={`step-card run-card kind-${kind}`} data-testid="run-step" data-step={entry.step} data-kind={entry.kind}>
      <h3>
        <span className="muted">{index}. </span><code>{entry.step}</code> <span className="kind-tag">{kind}</span>
        {entry.kind === "execution" && entry.seconds !== undefined && <span className="muted"> · ran on the client in {entry.seconds}s</span>}
        {entry.kind === "error" && <span className="error"> · failed</span>}
      </h3>
      {entry.kind === "decision" && <Decision result={entry.result as unknown as DecisionResult} info={info} attribution={entry.attribution} />}
      {entry.kind === "router" && <Router entry={entry} />}
      {entry.kind === "execution" && <Execution entry={entry} info={info} />}
      {entry.kind === "client_task" && <ClientTask result={entry.result as unknown as ClientTaskResult} info={info} />}
      {entry.kind === "end" && <pre data-testid="final-state">{JSON.stringify(entry.result, null, 2)}</pre>}
      {entry.kind === "error" && <ErrorResult result={entry.result} />}
      {entry.kind !== "end" && entry.kind !== "router" && (
        <details className="states">
          <summary>state before{after ? " and after" : ""}</summary>
          <div className="state-pair">
            <pre data-testid="state-before">{JSON.stringify(entry.input, null, 2)}</pre>
            {after && <pre data-testid="state-after">{JSON.stringify(after, null, 2)}</pre>}
          </div>
        </details>
      )}
    </section>
  );
}

function Decision({ result, info, attribution }: { result: DecisionResult; info: ProcedureInfo; attribution?: Attribution }) {
  const byName = new Map(info.questions.map((q) => [q.name, q]));
  const who = attribution ?? { resolver: "manual", model: null, confidence: null, reviewed: false };
  return (
    <>
      <p data-testid="attribution" data-resolver={who.resolver}>
        resolver <strong>{who.resolver}</strong>
        {who.resolver === "manual" ? <span className="muted"> · answered by the client, no decision model</span>
          : <span className="muted">{who.model ? ` · model ${who.model}` : ""}{who.reviewed ? " · reviewed" : " · not reviewed"}</span>}
      </p>
      <table className="compact answers" aria-label="answers">
        <thead><tr><th>question</th><th>answer</th><th>confidence</th><th>threshold</th></tr></thead>
        <tbody>
          {Object.entries(result.answers).map(([name, value]) => {
            const proposed = who.proposed?.[name];
            const overridden = proposed !== undefined && proposed !== value;
            return (
              <tr key={name} data-testid="answer" data-question={name}>
                <td><code>{name}</code><div className="muted small">{byName.get(name)?.instructions}</div></td>
                <td>
                  <code data-testid="answer-value">{JSON.stringify(value)}</code>
                  {overridden && <span className="muted"> · overrode the model's <code>{JSON.stringify(proposed)}</code></span>}
                </td>
                <td>{who.confidence?.[name] !== undefined ? `${(who.confidence[name] * 100).toFixed(1)}%` : <span className="muted">—</span>}</td>
                <td>{byName.get(name)?.threshold ?? <span className="muted">default</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function Router({ entry }: { entry: HistoryEntry }) {
  const [key, value] = Object.entries(entry.input)[0] ?? ["?", undefined];
  return (
    <p data-testid="branch-taken">
      <code>{key}</code> = <code>{JSON.stringify(value)}</code> → branch to <code>{String(entry.result.to)}</code>
    </p>
  );
}

function Execution({ entry, info }: { entry: HistoryEntry; info: ProcedureInfo }) {
  const step = info.step_details.find((s) => s.name === entry.step);
  const assets = info.resources.filter((r) => r.step === entry.step && r.role === "asset").map((r) => r.path);
  return (
    <div className="io-pair">
      <div>
        <h4>stdin <span className="muted small">state{assets.length ? `, assets ${assets.map((a) => a.replace(/^.*\//, "").replace(/\.[^.]+$/, "")).join(", ")}` : ""}, expects</span></h4>
        <pre data-testid="script-stdin">{JSON.stringify({ state: entry.input }, null, 2)}</pre>
        {step?.script && <p className="muted small">script <code>{step.script}</code></p>}
      </div>
      <div>
        <h4>stdout</h4>
        <pre data-testid="script-stdout">{JSON.stringify(entry.result, null, 2)}</pre>
      </div>
    </div>
  );
}

function ErrorResult({ result }: { result: Record<string, unknown> }) {
  return (
    <>
      <p className="error" data-testid="step-error">{String(result.error)}</p>
      {typeof result.stderr === "string" && result.stderr && <pre data-testid="step-stderr">{result.stderr}</pre>}
    </>
  );
}

function ClientTask({ result, info }: { result: ClientTaskResult; info: ProcedureInfo }) {
  return (
    <>
      <h4>task</h4>
      <pre className="task" data-testid="task">{result.task}</pre>
      {result.references.length > 0 && (
        <>
          <h4>references the client may load</h4>
          <ul data-testid="references">
            {result.references.map((r) => {
              const path = r.uri.replace(new RegExp(`^${info.name}/`), "");
              return <li key={r.uri}><a href={href({ page: "source", ref: `${info.name}@${info.revision}`, path })}><code>{path}</code></a> — {r.description}</li>;
            })}
          </ul>
        </>
      )}
    </>
  );
}
