import type { Attribution, ClientTaskResult, DecisionResult, HistoryEntry, ProcedureInfo } from "../api/types";
import { inputsOf, outputsOf } from "../graph/dataflow";
import { href } from "../router";

interface Props {
  entry: HistoryEntry;
  info: ProcedureInfo;
  index: number;
}

type State = Record<string, unknown>;

/** One step of a recorded run: the declared keys it read and added, what it did, and where it ran. Read-only. */
export function RunStepCard({ entry, info, index }: Props) {
  const kind = entry.kind === "error" ? entry.step_kind ?? "error" : entry.kind;
  const io = stateIO(entry, info);
  return (
    <section className={`step-card run-card kind-${kind}`} data-testid="run-step" data-step={entry.step} data-kind={entry.kind}>
      <h3>
        <span className="muted">{index}. </span><code>{entry.step}</code> <span className="kind-tag">{kind}</span>
        {entry.kind === "error" && <span className="error"> · failed</span>}
      </h3>
      <Machine entry={entry} />
      {entry.kind === "decision" && <Decision result={entry.result as unknown as DecisionResult} info={info} attribution={entry.attribution} />}
      {entry.kind === "router" && <Router entry={entry} />}
      {entry.kind === "execution" && <Execution entry={entry} info={info} />}
      {entry.kind === "client_task" && <ClientTask result={entry.result as unknown as ClientTaskResult} info={info} />}
      {entry.kind === "end" && <pre data-testid="final-state">{JSON.stringify(entry.result, null, 2)}</pre>}
      {entry.kind === "error" && <ErrorResult result={entry.result} />}
      <div className="state-pair state-io">
        <div>
          <h4>state in <span className="muted small">{io.inKeys.length ? io.inKeys.join(", ") : "no keys"}</span></h4>
          <pre data-testid="state-in">{JSON.stringify(io.in, null, 2)}</pre>
        </div>
        <div>
          <h4>state out <span className="muted small">{io.outNote}</span></h4>
          {io.out && <pre data-testid="state-out">{JSON.stringify(io.out, null, 2)}</pre>}
        </div>
      </div>
    </section>
  );
}

/** Where a step ran. Scripts, decisions and tasks run on the client; the server only routes, checks and records. */
function Machine({ entry }: { entry: HistoryEntry }) {
  const kind = entry.kind === "error" ? entry.step_kind : entry.kind;
  const host = entry.kind === "error" ? (typeof entry.result.host === "string" ? entry.result.host : undefined) : entry.host;
  let where: "client" | "server" = "client";
  let text: React.ReactNode;
  if (kind === "execution") {
    text = <>ran on the client{host ? <> <code data-testid="host">{host}</code></> : ""}{entry.kind === "execution" && entry.seconds !== undefined ? ` in ${entry.seconds}s` : ""}</>;
  } else if (kind === "decision") {
    const who = entry.attribution;
    text = who?.resolver === "typesafe" ? <>answered on the client by its decision model{who.model ? <> <code>{who.model}</code></> : ""}</> : "answered on the client, by hand";
  } else if (kind === "client_task") {
    text = "performed by the client";
  } else {
    where = "server";
    text = kind === "router" ? "routed by the server" : kind === "end" ? "closed by the server" : "recorded by the server";
  }
  return <p className="muted machine" data-testid="ran-on" data-machine={where} data-host={host}>{text}</p>;
}

/** The declared keys a step read and added. A step sees only its `inputs`, so the history's `input` is the state
 *  in (an error entry keeps the whole state before the step: projected here). Out is the step's outputs: a
 *  script's stdout, a decision's answers, a client task's answer; routers and the end step add nothing. */
function stateIO(entry: HistoryEntry, info: ProcedureInfo) {
  const step = entry.step;
  const inKeys = inputsOf(info, step);
  const pick = (state: State, keys: string[]) => Object.fromEntries(keys.filter((k) => k in state).map((k) => [k, state[k]]));
  const input = entry.kind === "error" ? pick(entry.input, inKeys) : entry.input;
  const outKeys = outputsOf(info, step);
  let out: State | null = null;
  let outNote = outKeys.join(", ");
  if (entry.kind === "execution") out = entry.result;
  else if (entry.kind === "decision") out = (entry.result as unknown as DecisionResult).answers;
  else if (entry.kind === "client_task") out = (entry.result as unknown as ClientTaskResult).answer;
  else if (entry.kind === "router") outNote = "adds nothing; the branch is in the history";
  else if (entry.kind === "end") outNote = "the procedure's result";
  else if (entry.kind === "error") outNote = "nothing: the step failed";
  if (entry.kind === "end") out = entry.result;
  return { in: input, inKeys, out, outNote };
}

function Decision({ result, info, attribution }: { result: DecisionResult; info: ProcedureInfo; attribution?: Attribution }) {
  const byName = new Map(info.questions.map((q) => [q.name, q]));
  const who = attribution ?? { resolver: "manual", model: null, confidence: null, reviewed: false };
  const review = reviewOf(who, result.answers);
  return (
    <>
      <p data-testid="attribution" data-resolver={who.resolver}>
        resolver <strong>{who.resolver}</strong>
        {who.resolver === "manual" ? <span className="muted"> · answered by the client, no decision model</span>
          : <span className="muted">{who.model ? ` · model ${who.model}` : ""}</span>}
        {" · "}<span className={`status-tag review-${review.status}`} data-testid="review-status" data-review={review.status}>{review.text}</span>
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

/** A decision's review status: answered by hand (no model, nothing to review), the model's answers accepted
 *  without review, or reviewed because a question fell under its threshold, keeping or overriding them. */
function reviewOf(who: Attribution | { resolver: "manual"; reviewed: boolean; proposed?: undefined }, answers: DecisionResult["answers"]) {
  if (who.resolver === "manual") return { status: "manual", text: "no review: answered by hand" };
  if (!who.reviewed) return { status: "accepted", text: "accepted without review" };
  const changed = Object.entries(answers).filter(([q, v]) => who.proposed?.[q] !== undefined && who.proposed[q] !== v).map(([q]) => q);
  if (!changed.length) return { status: "kept", text: "reviewed: the model's answers kept" };
  return { status: "overridden", text: `reviewed: overrode ${changed.join(", ")}` };
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
