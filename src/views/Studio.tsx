import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DirectionToggle, StepGraph, useDirection } from "./StepGraph";
import { RUNNABLE_KINDS, type Draft, type Question, type Step, type StepKind } from "../studio/draft";
import { KINDS, addStepAfter, addStepOnBranch, deleteStep, graphOf, label, prefillBranches, setStart } from "../studio/edit";
import { lint, type Issue, type Tier } from "../studio/lint";
import { loadDraft, saveDraft } from "../studio/storage";

const STEP_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TIERS: Tier[] = ["error", "unfinished", "warning"];

/** The Studio: the step graph of a Draft on the left, a side panel for the selected step (or the procedure) on
 *  the right, and the linter's verdict under the graph. Every edit is autosaved to localStorage. */
export function Studio() {
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [selected, setSelected] = useState<string | null>(null);
  const [direction, setDirection] = useDirection();
  const [saved, setSaved] = useState<"saved" | "unsaved" | "no-storage">("saved");
  const [focus, setFocus] = useState<string | null>(null);
  const latest = useRef(draft);
  const dirty = useRef(false);

  const edit = (change: (d: Draft) => void) => {
    setDraft((d) => { const c = structuredClone(d); change(c); return c; });
  };

  // Autosave, debounced; and once more as the page goes away, so a reload right after an edit keeps it.
  const flush = () => {
    if (!dirty.current) return;
    dirty.current = false;
    setSaved(saveDraft(latest.current) ? "saved" : "no-storage");
  };
  useEffect(() => {
    if (latest.current === draft) return;
    latest.current = draft;
    dirty.current = true;
    setSaved((s) => (s === "no-storage" ? s : "unsaved"));
    const t = setTimeout(flush, 300);
    return () => clearTimeout(t);
  }, [draft]);
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, []);

  const issues = useMemo(() => lint(draft), [draft]);
  const marks = useMemo(() => {
    const m = new Map<string, Tier>();
    for (const i of issues) {
      if (!i.stepId) continue;
      const have = m.get(i.stepId);
      if (!have || TIERS.indexOf(i.tier) < TIERS.indexOf(have)) m.set(i.stepId, i.tier);
    }
    return m;
  }, [issues]);
  const g = useMemo(() => graphOf(draft), [draft]);
  const step = draft.steps.find((s) => s.id === selected);
  const select = (id: string | null, field?: string) => { setSelected(id); setFocus(field ?? null); };

  // Move focus to the field a lint issue names, once the panel it lives in has rendered.
  useEffect(() => {
    if (!focus) return;
    const top = focus.split(/[.[]/)[0];
    document.querySelector<HTMLElement>(`.studio-panel [data-field="${focus}"], .studio-panel [data-field="${top}"]`)?.focus();
    setFocus(null);
  }, [focus, selected]);

  const add = (after: string | undefined, kind: StepKind) => {
    const r = addStepAfter(draft, after, kind);
    setDraft(r.draft);
    setSelected(r.id);
  };
  const addOnBranch = (router: string, index: number, kind: StepKind) => {
    const r = addStepOnBranch(draft, router, index, kind);
    setDraft(r.draft);
    setSelected(r.id);
  };

  return (
    <div className="studio" data-testid="studio">
      <h1>Studio</h1>
      <p className="muted">
        Build a procedure step by step. Each edit is checked as you make it and kept in this browser
        {" "}<span data-testid="studio-saved" data-state={saved}>
          ({saved === "saved" ? "saved" : saved === "unsaved" ? "saving…" : "this browser will not keep it: storage is unavailable"})
        </span>.
      </p>
      <div className="studio-grid">
        <section>
          <div className="studio-bar">
            <DirectionToggle direction={direction} onChange={setDirection} />
            <button onClick={() => select(null)}>procedure settings</button>
          </div>
          {draft.steps.length === 0 ? (
            <div className="studio-panel" data-testid="studio-empty">
              <h2>Start with the first step</h2>
              <p className="muted">The first step is where the procedure starts, so it has to be one that runs.</p>
              <AddKinds label="Add the first step" kinds={RUNNABLE_KINDS} onAdd={(k) => add(undefined, k)} />
            </div>
          ) : (
            <StepGraph steps={g.steps} edges={g.edges} branches={g.branches} start={g.start} end={g.end}
              direction={direction} onSelect={(id) => select(id)} selected={selected ?? undefined} labels={g.labels} marks={marks} />
          )}
          <LintPanel issues={issues} draft={draft} onPick={(i) => select(i.stepId ?? null, i.field)} />
        </section>
        <aside className="studio-panel" data-testid="studio-panel">
          {step
            ? <StepPanel key={step.id} draft={draft} step={step} edit={edit}
                onAdd={(k) => add(step.id, k)}
                onDelete={() => { setDraft(deleteStep(draft, step.id)); setSelected(null); }}
                onStart={() => setDraft(setStart(draft, step.id))}
                onPrefill={() => setDraft(prefillBranches(draft, step.id))}
                onAddOnBranch={(i, k) => addOnBranch(step.id, i, k)} />
            : <ProcedurePanel draft={draft} edit={edit} />}
        </aside>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------- lint panel

function LintPanel({ issues, draft, onPick }: { issues: Issue[]; draft: Draft; onPick: (i: Issue) => void }) {
  const where = (i: Issue) => {
    const s = draft.steps.find((x) => x.id === i.stepId);
    return s ? `${label(s)}: ` : "";
  };
  return (
    <section className="studio-lint" data-testid="lint-panel" aria-label="lint">
      <h2>Lint</h2>
      {issues.length === 0 && <p className="muted" data-testid="lint-clean">No issues.</p>}
      {TIERS.map((tier) => {
        const these = issues.filter((i) => i.tier === tier);
        if (!these.length) return null;
        return (
          <div key={tier} className={`tier-${tier}`} data-testid={`lint-${tier}`}>
            <h3>{tier} ({these.length})</h3>
            <ul>
              {these.map((i, n) => (
                <li key={n} data-code={i.code} data-step={i.stepId}>
                  <button className="linkish" onClick={() => onPick(i)}>{where(i)}{i.message}</button> <code className="muted">{i.code}</code>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

// ----------------------------------------------------------------------------------------------- form bits

function Field({ name, children, hint }: { name: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{name}</span>
      {children}
      {hint && <span className="hint muted">{hint}</span>}
    </label>
  );
}

function Text({ name, value, onChange, field, area, invalid, hint, placeholder }: {
  name: string; value: string; onChange: (v: string) => void; field?: string; area?: boolean; invalid?: boolean; hint?: ReactNode; placeholder?: string;
}) {
  return (
    <Field name={name} hint={hint}>
      {area
        ? <textarea value={value} data-field={field} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input type="text" value={value} data-field={field} placeholder={placeholder} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

/** A list of strings: one text input per entry, with add and remove. */
function Strings({ name, items, onChange, field, area }: { name: string; items: string[]; onChange: (v: string[]) => void; field: string; area?: boolean }) {
  return (
    <fieldset>
      <legend>{name}</legend>
      {items.map((v, i) => (
        <div className="row" key={i}>
          {area
            ? <textarea value={v} data-field={i === 0 ? field : undefined} aria-label={`${name} ${i + 1}`} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
            : <input type="text" value={v} data-field={i === 0 ? field : undefined} aria-label={`${name} ${i + 1}`} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />}
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`remove ${name} ${i + 1}`}>remove</button>
        </div>
      ))}
      <button onClick={() => onChange([...items, ""])}>add</button>
    </fieldset>
  );
}

function AddKinds({ label: text, kinds, onAdd }: { label: string; kinds: readonly StepKind[]; onAdd: (k: StepKind) => void }) {
  return (
    <div className="add-kinds" role="group" aria-label={text}>
      {kinds.map((k) => <button key={k} onClick={() => onAdd(k)}>+ {k}</button>)}
    </div>
  );
}

// ----------------------------------------------------------------------------------------------- procedure panel

function ProcedurePanel({ draft, edit }: { draft: Draft; edit: (c: (d: Draft) => void) => void }) {
  const r = draft.requires;
  return (
    <div data-testid="procedure-panel">
      <h2>Procedure</h2>
      <Text name="name" field="name" value={draft.name} onChange={(v) => edit((d) => { d.name = v; })}
        hint="lowercase letters, digits and hyphens" />
      <Text name="description" field="description" area value={draft.description} onChange={(v) => edit((d) => { d.description = v; })} />
      <Text name="purpose" field="purpose" area value={draft.purpose} onChange={(v) => edit((d) => { d.purpose = v; })} />
      <Strings name="trigger_when" field="trigger_when" items={draft.triggerWhen} onChange={(v) => edit((d) => { d.triggerWhen = v; })} />
      <Strings name="do_not_use_when" field="do_not_use_when" items={draft.doNotUseWhen} onChange={(v) => edit((d) => { d.doNotUseWhen = v; })} />
      <Strings name="anti_patterns" field="anti_patterns" items={draft.antiPatterns} onChange={(v) => edit((d) => { d.antiPatterns = v; })} />
      <fieldset>
        <legend>requires</legend>
        <label className="option">
          <input type="checkbox" checked={!!r} data-field="requires"
            onChange={(e) => edit((d) => { d.requires = e.target.checked ? { interpreter: { name: "python", version: "3.10" }, packages: [], tools: [] } : undefined; })} /> scripts need an interpreter
        </label>
        {r && (
          <>
            <Text name="interpreter" field="requires.interpreter.name" value={r.interpreter.name}
              onChange={(v) => edit((d) => { d.requires!.interpreter.name = v; })} />
            <Text name="version" field="requires.interpreter.version" value={r.interpreter.version ?? ""}
              onChange={(v) => edit((d) => { d.requires!.interpreter.version = v || undefined; })} />
            <Strings name="packages" field="requires.packages" items={r.packages} onChange={(v) => edit((d) => { d.requires!.packages = v; })} />
            <Strings name="tools" field="requires.tools" items={r.tools} onChange={(v) => edit((d) => { d.requires!.tools = v; })} />
          </>
        )}
      </fieldset>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------- step panel

interface StepPanelProps {
  draft: Draft;
  step: Step;
  edit: (c: (d: Draft) => void) => void;
  onAdd: (k: StepKind) => void;
  onDelete: () => void;
  onStart: () => void;
  onPrefill: () => void;
  onAddOnBranch: (index: number, kind: StepKind) => void;
}

function StepPanel({ draft, step, edit, onAdd, onDelete, onStart, onPrefill, onAddOnBranch }: StepPanelProps) {
  const at = (d: Draft) => d.steps.find((s) => s.id === step.id)!;
  const set = (change: (s: Step) => void) => edit((d) => change(at(d)));
  const others = draft.steps.filter((s) => s.id !== step.id);
  const isStart = draft.steps[0]?.id === step.id;
  const runnable = RUNNABLE_KINDS.includes(step.kind);
  const target = (value: string | undefined, onChange: (v: string | undefined) => void, field?: string, aria?: string) => (
    <select value={value ?? ""} data-field={field} aria-label={aria} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">(none)</option>
      {others.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}
    </select>
  );

  return (
    <div data-testid="step-panel" data-step={step.id}>
      <h2>{label(step)} <span className="kind-tag" style={{ ["--kind" as string]: `var(--${step.kind})` }}>{step.kind}</span></h2>
      {step.kind !== "end" && step.kind !== "router" && (
        <>
          <strong className="small">Add a step after this one</strong>
          <AddKinds label={`Add step after ${label(step)}`} kinds={KINDS} onAdd={onAdd} />
        </>
      )}
      <Text name="name" field="name" value={step.name} invalid={!STEP_NAME.test(step.name)} onChange={(v) => set((s) => { s.name = v; })}
        hint={STEP_NAME.test(step.name) ? "lowercase letters, digits and hyphens" : <span className="error">use lowercase letters, digits and single hyphens</span>} />
      <Text name="description" field="description" area value={step.description} onChange={(v) => set((s) => { s.description = v; })} />

      {runnable && (
        <Field name="next step (inputs_to)">
          {target(step.next, (v) => set((s) => { s.next = v; }), "next", "next step")}
        </Field>
      )}

      {step.kind === "router" && <RouterFields step={step} set={set} target={target} onPrefill={onPrefill} onAddOnBranch={onAddOnBranch} />}
      {step.kind === "decision" && <DecisionFields step={step} set={set} />}
      {step.kind === "execution" && (
        <>
          <Text name="script" field="script" value={step.script ?? ""} onChange={(v) => set((s) => { s.script = v; })} hint="under scripts/" />
          <Field name="command" hint="Python only for now">
            <select value={step.command?.join(" ") ?? ""} data-field="command" onChange={(e) => set((s) => { s.command = e.target.value ? [e.target.value] : undefined; })}>
              <option value="">default (python)</option>
              <option value="python">python</option>
              {step.command && step.command.join(" ") !== "python" && <option value={step.command.join(" ")}>{step.command.join(" ")} (not Python)</option>}
            </select>
          </Field>
          <Strings name="assets" field="assets" items={step.assets ?? []} onChange={(v) => set((s) => { s.assets = v; })} />
          <Field name="timeout (seconds)">
            <input type="text" inputMode="numeric" data-field="timeout" value={step.timeout ?? ""}
              onChange={(e) => set((s) => { const n = Number(e.target.value); s.timeout = e.target.value.trim() && Number.isFinite(n) ? n : undefined; })} />
          </Field>
        </>
      )}
      {step.kind === "client_task" && (
        <>
          <Text name="template" field="template" value={step.template ?? ""} onChange={(v) => set((s) => { s.template = v; })} hint="under assets/" />
          <Strings name="assets" field="assets" items={step.assets ?? []} onChange={(v) => set((s) => { s.assets = v; })} />
          <fieldset>
            <legend>references</legend>
            {(step.references ?? []).map((r, i) => (
              <div className="row" key={i}>
                <input type="text" value={r.path} aria-label={`reference ${i + 1} path`} placeholder="references/…" onChange={(e) => set((s) => { s.references![i].path = e.target.value; })} />
                <input type="text" value={r.description} aria-label={`reference ${i + 1} description`} placeholder="description" onChange={(e) => set((s) => { s.references![i].description = e.target.value; })} />
                <button onClick={() => set((s) => { s.references!.splice(i, 1); })}>remove</button>
              </div>
            ))}
            <button onClick={() => set((s) => { (s.references ??= []).push({ path: "references/", description: "" }); })}>add</button>
          </fieldset>
          <label className="option">
            <input type="checkbox" checked={step.framing !== false} onChange={(e) => set((s) => { s.framing = e.target.checked ? undefined : false; })} /> framing
          </label>
        </>
      )}
      {step.kind === "end" && <p className="muted">The inputs of the end step become the result. A typed editor for them arrives with the inputs and outputs editor.</p>}

      <div className="actions">
        {runnable && !isStart && <button onClick={onStart}>make this the start</button>}
        {isStart && <span className="muted">this is the start</span>}
        <button className="danger" onClick={onDelete}>delete step</button>
      </div>
    </div>
  );
}

function RouterFields({ step, set, target, onPrefill, onAddOnBranch }: {
  step: Step; set: (c: (s: Step) => void) => void; onPrefill: () => void; onAddOnBranch: (index: number, kind: StepKind) => void;
  target: (value: string | undefined, onChange: (v: string | undefined) => void, field?: string, aria?: string) => ReactNode;
}) {
  const branches = step.branches ?? [];
  return (
    <>
      <Text name="branch_on" field="branch_on" value={step.branchOn ?? ""} onChange={(v) => set((s) => { s.branchOn = v || undefined; })}
        hint="the key whose value picks the branch" />
      <fieldset>
        <legend>branches (value → step)</legend>
        {branches.map((b, i) => (
          <div className="row" key={i}>
            <input type="text" value={b.value} aria-label={`branch ${i + 1} value`} data-field={i === 0 ? "branches" : undefined}
              onChange={(e) => set((s) => { s.branches![i].value = e.target.value; })} />
            {target(b.target, (v) => set((s) => { s.branches![i].target = v; }), undefined, `branch ${i + 1} target`)}
            <button onClick={() => set((s) => { s.branches!.splice(i, 1); })} aria-label={`remove branch ${i + 1}`}>remove</button>
            <div className="add-kinds" role="group" aria-label={`New step on branch ${i + 1}`}>
              {KINDS.map((k) => <button key={k} onClick={() => onAddOnBranch(i, k)}>+ {k}</button>)}
            </div>
          </div>
        ))}
        <div className="actions">
          <button onClick={() => set((s) => { (s.branches ??= []).push({ value: "" }); })}>add branch</button>
          <button onClick={onPrefill}>fill from the decision before</button>
        </div>
      </fieldset>
    </>
  );
}

function blankQuestion(type: Question["type"], name: string, instructions = ""): Question {
  if (type === "noul") return { type, name, instructions };
  if (type === "choice") return { type, name, instructions, criteria: [{ label: "", description: null }, { label: "", description: null }] };
  return { type, name, instructions, criteria: ["", ""] };
}

function DecisionFields({ step, set }: { step: Step; set: (c: (s: Step) => void) => void }) {
  const questions = step.questions ?? [];
  const q = (i: number, change: (q: Question) => void) => set((s) => change(s.questions![i]));
  return (
    <>
      <fieldset>
        <legend>questions</legend>
        {questions.map((question, i) => (
          <fieldset className="question" key={i} data-testid="question">
            <legend>{question.name || "(unnamed)"}</legend>
            <Text name="name" field={i === 0 ? "questions" : undefined} value={question.name}
              invalid={!/^[A-Za-z_][A-Za-z0-9_]*$/.test(question.name)}
              onChange={(v) => q(i, (x) => { x.name = v; })} />
            <Field name="type">
              <select value={question.type} aria-label={`${question.name} type`}
                onChange={(e) => set((s) => { const old = s.questions![i]; s.questions![i] = blankQuestion(e.target.value as Question["type"], old.name, old.instructions); })}>
                <option value="noul">noul (yes/no)</option><option value="choice">choice</option><option value="score">score</option>
              </select>
            </Field>
            <Text name="instructions" area value={question.instructions} onChange={(v) => q(i, (x) => { x.instructions = v; })} />
            <Criteria question={question} change={(f) => q(i, f)} />
            <Field name="threshold (confidence needed)">
              <input type="text" inputMode="decimal" aria-label={`${question.name} threshold`} value={step.thresholds?.[question.name] ?? ""}
                onChange={(e) => set((s) => {
                  const n = Number(e.target.value);
                  const t = { ...(s.thresholds ?? {}) };
                  if (e.target.value.trim() && Number.isFinite(n)) t[question.name] = n; else delete t[question.name];
                  s.thresholds = Object.keys(t).length ? t : undefined;
                })} />
            </Field>
            <button onClick={() => set((s) => { s.questions!.splice(i, 1); })}>remove question</button>
          </fieldset>
        ))}
        <div className="add-kinds" role="group" aria-label="Add question">
          {(["noul", "choice", "score"] as const).map((t) => (
            <button key={t} onClick={() => set((s) => { (s.questions ??= []).push(blankQuestion(t, `question_${(s.questions?.length ?? 0) + 1}`)); })}>+ {t}</button>
          ))}
        </div>
      </fieldset>
      <label className="option">
        <input type="checkbox" checked={!!step.history} onChange={(e) => set((s) => { s.history = e.target.checked || undefined; })} /> history
      </label>
    </>
  );
}

function Criteria({ question, change }: { question: Question; change: (f: (q: Question) => void) => void }) {
  if (question.type === "noul") {
    return (
      <>
        <Text name="criteria: true" value={question.criteria?.true ?? ""} onChange={(v) => change((x) => { if (x.type === "noul") x.criteria = { ...x.criteria, true: v || undefined }; })} />
        <Text name="criteria: false" value={question.criteria?.false ?? ""} onChange={(v) => change((x) => { if (x.type === "noul") x.criteria = { ...x.criteria, false: v || undefined }; })} />
      </>
    );
  }
  if (question.type === "choice") {
    return (
      <fieldset>
        <legend>labels</legend>
        {question.criteria.map((c, i) => (
          <div className="row" key={i}>
            <input type="text" value={c.label} aria-label={`label ${i + 1}`} placeholder="label"
              onChange={(e) => change((x) => { if (x.type === "choice") x.criteria[i].label = e.target.value; })} />
            <input type="text" value={c.description ?? ""} aria-label={`label ${i + 1} description`} placeholder="description"
              onChange={(e) => change((x) => { if (x.type === "choice") x.criteria[i].description = e.target.value || null; })} />
            <button onClick={() => change((x) => { if (x.type === "choice") x.criteria.splice(i, 1); })}>remove</button>
          </div>
        ))}
        <button onClick={() => change((x) => { if (x.type === "choice") x.criteria.push({ label: "", description: null }); })}>add label</button>
      </fieldset>
    );
  }
  return (
    <fieldset>
      <legend>levels (lowest first)</legend>
      {question.criteria.map((c, i) => (
        <div className="row" key={i}>
          <input type="text" value={c} aria-label={`level ${i + 1}`} onChange={(e) => change((x) => { if (x.type === "score") x.criteria[i] = e.target.value; })} />
          <button onClick={() => change((x) => { if (x.type === "score") x.criteria.splice(i, 1); })}>remove</button>
        </div>
      ))}
      <button onClick={() => change((x) => { if (x.type === "score") x.criteria.push(""); })}>add level</button>
    </fieldset>
  );
}
