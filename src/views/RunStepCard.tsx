import type { Answer, ClientTaskResult, DecisionResult, HistoryEntry, ProcedureInfo, ReviewItem } from "../api/types";
import { collapse, crossed, distribution } from "../run/protocol";
import { href } from "../router";

interface Props {
  entry: HistoryEntry;
  info: ProcedureInfo;
  /** The state after this step: the server's `suggested` for the step that ran last. */
  after?: Record<string, unknown>;
  /** The review items the server attached to this step's response. */
  review?: ReviewItem[];
  /** Thresholds in force for this run: author defaults, server overrides, then this run's. */
  thresholds: Record<string, number>;
  index: number;
}

/** One step of a run: what it received, what it did, and the state it left. Read-only; I4 reuses it. */
export function RunStepCard({ entry, info, after, review = [], thresholds, index }: Props) {
  const kind = entry.kind === "error" ? entry.step_kind ?? "error" : entry.kind;
  return (
    <section className={`step-card run-card kind-${kind}`} data-testid="run-step" data-step={entry.step} data-kind={entry.kind}>
      <h3>
        <span className="muted">{index}. </span><code>{entry.step}</code> <span className="kind-tag">{kind}</span>
        {entry.manual && <span className="muted"> · answered by the client</span>}
        {entry.kind === "error" && <span className="error"> · failed</span>}
      </h3>
      {entry.kind === "decision" && <Decision result={entry.result as unknown as DecisionResult} info={info} review={review} thresholds={thresholds} />}
      {entry.kind === "router" && <Router entry={entry} />}
      {entry.kind === "execution" && <Execution entry={entry} info={info} />}
      {entry.kind === "client_task" && <ClientTask result={entry.result as unknown as ClientTaskResult} info={info} />}
      {entry.kind === "end" && <pre data-testid="final-state">{JSON.stringify(entry.result, null, 2)}</pre>}
      {entry.kind === "error" && <p className="error" data-testid="step-error">{String(entry.result.error)}</p>}
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

function Decision({ result, info, review, thresholds }: { result: DecisionResult; info: ProcedureInfo; review: ReviewItem[]; thresholds: Record<string, number> }) {
  const byName = new Map(info.questions.map((q) => [q.name, q]));
  return (
    <>
      {result.model && <p className="muted">model {result.model}{result.usage ? ` · ${result.usage.input_tokens ?? "?"} in / ${result.usage.output_tokens ?? "?"} out tokens` : ""}</p>}
      <table className="compact answers" aria-label="answers">
        <thead><tr><th>question</th><th>answer</th><th>distribution</th><th>threshold</th></tr></thead>
        <tbody>
          {Object.entries(result.answers).map(([name, answer]) => {
            const limit = thresholds[name] ?? byName.get(name)?.threshold ?? undefined;
            const check = crossed(answer, limit);
            const flagged = review.some((r) => r.question === name) || check?.flagged === true;
            return (
              <tr key={name} data-testid="answer" data-question={name} data-flagged={flagged ? "true" : "false"}>
                <td><code>{name}</code><div className="muted small">{byName.get(name)?.instructions}</div></td>
                <td><code data-testid="answer-value">{JSON.stringify(collapse(answer))}</code>{"manual" in answer && <span className="muted"> · manual</span>}</td>
                <td><Distribution answer={answer} /></td>
                <td>
                  {check === null ? <span className="muted">—</span> : (
                    <>
                      {limit ?? <span className="muted">default</span>}
                      {flagged ? <span className="status-tag flagged"> crossed</span> : <span className="muted small"> ok</span>}
                      <div className="muted small">{check.reason}</div>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function Distribution({ answer }: { answer: Answer }) {
  const rows = distribution(answer);
  if (rows.length === 0) return <span className="muted">—</span>;
  const chosen = String(collapse(answer));
  return (
    <ul className="dist">
      {rows.map(([label, p]) => (
        <li key={label} className={label === chosen ? "chosen" : undefined}>
          <span className="bar" style={{ width: `${Math.round(p * 100)}%` }} />
          <code>{label}</code> <span className="muted">{(p * 100).toFixed(1)}%</span>
        </li>
      ))}
      {"confidence" in answer && <li className="muted small">confidence {(answer.confidence * 100).toFixed(1)}%</li>}
    </ul>
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
        <h4>stdin <span className="muted small">currentState{assets.length ? `, assets ${assets.map((a) => a.replace(/^.*\//, "").replace(/\.[^.]+$/, "")).join(", ")} (loaded server-side)` : ""}, expects</span></h4>
        <pre data-testid="script-stdin">{JSON.stringify({ currentState: entry.input }, null, 2)}</pre>
        {step?.script && <p className="muted small">script <code>{step.script}</code></p>}
      </div>
      <div>
        <h4>stdout</h4>
        <pre data-testid="script-stdout">{JSON.stringify(entry.result, null, 2)}</pre>
      </div>
    </div>
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
