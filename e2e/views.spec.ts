import { expect, test, type APIRequestContext } from "@playwright/test";
import { hostname } from "node:os";
import { SERVER, aipJson } from "./aip";

// The 0.6a0 views: `requires` on the catalog and procedure pages, the key-level data flow, and runs that show
// each step's declared state in and out, where it ran, and who answered its decisions. The fixtures are runs
// posted straight to the run API the way a client reports them: one whose triage the client's decision model
// answered, with its script reported from a machine called `fixture-box`, and one whose script failed there
// (the CLI the console drives has no decision model, so it only ever answers by hand).

const FIXTURE_HOST = "fixture-box";

interface Opened { run_id: string; pause: { kind: string; step: string } }

/** Open a run on the server and answer its triage as a client with a decision model would. */
async function modelTriage(request: APIRequestContext, message: string, tone: "angry" | "calm", reviewed = false): Promise<string> {
  const opened = await request.post(`${SERVER}/runs`, { data: { name: "billing-support", input: { message } } });
  expect(opened.status(), await opened.text()).toBe(201);
  const { run_id: runId } = (await opened.json()) as Opened;
  const answered = await request.post(`${SERVER}/runs/${runId}/result`, { data: {
    step: "triage",
    answer: { billing: true, tone },
    attribution: { resolver: "typesafe", model: "jev-1", confidence: { billing: 0.98, tone: 0.91 }, reviewed,
                   ...(reviewed ? { proposed: { billing: true, tone } } : {}) },
  } });
  expect(answered.ok(), await answered.text()).toBeTruthy();
  return runId;
}

/** Report the escalate script's run from the fixture machine: its output, or a failure. */
async function report(request: APIRequestContext, runId: string, answer: Record<string, unknown>) {
  const res = await request.post(`${SERVER}/runs/${runId}/result`, { data: { step: "escalate", answer: { ...answer, host: FIXTURE_HOST } } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

test("the catalog and the procedure page show what the scripts require", async ({ page }) => {
  await page.goto("./");
  const row = page.getByRole("table", { name: "catalog" }).getByRole("row").filter({ hasText: "billing-support" });
  await expect(row.getByTestId("catalog-requires")).toHaveText("python ≥ 3.10");

  await page.goto("./#/p/billing-support");
  await expect(page.getByTestId("requires-interpreter")).toHaveText("python ≥ 3.10");
  await expect(page.getByTestId("requires")).toContainText("packages none");
  const escalate = page.locator("#step-escalate");
  await expect(escalate.getByTestId("outputs")).toContainText("ticket_id");
  await expect(escalate.getByTestId("outputs")).toContainText("queue");
  await expect(escalate.getByTestId("command")).toHaveText("python escalate.py (default)");
  await expect(page.locator("#step-reply").getByTestId("outputs")).toContainText("reply");
});

test("the graph draws the key-level data flow from outputs to inputs", async ({ page }) => {
  await page.goto("./#/p/billing-support");
  const graph = page.getByRole("img", { name: "step graph" });
  await expect(graph.getByTestId("step-node")).toHaveCount(5);
  await expect(graph.getByTestId("data-edge")).toHaveCount(0);

  await page.getByRole("radio", { name: "data flow" }).check();
  await expect(graph.getByTestId("input-node")).toHaveCount(1);
  const edge = (from: string, to: string) => graph.locator(`[data-testid="data-edge"][data-from="${from}"][data-to="${to}"]`);
  await expect(graph.getByTestId("data-edge")).toHaveCount(7);
  await expect(edge("(input)", "triage")).toHaveAttribute("data-keys", "message");
  await expect(edge("triage", "by-tone")).toHaveAttribute("data-keys", "tone");
  await expect(edge("triage", "escalate")).toHaveAttribute("data-keys", "tone");
  await expect(edge("(input)", "end")).toHaveAttribute("data-keys", "message");
  await expect(edge("escalate", "end")).toHaveCount(0);                 // the end step reads only message

  const flow = page.getByRole("table", { name: "data flow" });
  const key = (k: string) => flow.locator(`[data-testid="data-flow-row"][data-key="${k}"]`);
  await expect(key("message")).toHaveAttribute("data-to", "triage,escalate,reply,end");
  await expect(key("tone")).toHaveAttribute("data-from", "triage");
  await expect(key("ticket_id")).toHaveAttribute("data-from", "escalate");
  await expect(key("ticket_id")).toContainText("kept in the history");
  await expect(key("reply")).toHaveAttribute("data-from", "reply");

  await page.getByRole("radio", { name: "control flow" }).check();
  await expect(graph.getByTestId("data-edge")).toHaveCount(0);
});

test("a run shows each step's declared state in and out and the machine that ran it", async ({ page, request }) => {
  const message = "Charged twice!! Refund me now. [views]";
  const runId = await modelTriage(request, message, "angry");
  const done = await report(request, runId, { output: { ticket_id: 4242, queue: "tier2" }, seconds: 0.25 });
  expect(done.done).toBe(true);

  await page.goto(`./#/runs/${runId}`);
  await expect(page.getByTestId("run-status")).toHaveText("done");
  const card = (step: string) => page.locator(`[data-testid="run-step"][data-step="${step}"]`);

  const triage = card("triage");
  await expect(triage.getByTestId("attribution")).toHaveAttribute("data-resolver", "typesafe");
  await expect(triage.getByTestId("attribution")).toContainText("model jev-1");
  await expect(triage.getByTestId("review-status")).toHaveAttribute("data-review", "accepted");
  await expect(triage.getByTestId("ran-on")).toHaveText("answered on the client by its decision model jev-1");
  await expect(triage.getByTestId("state-in")).toContainText('"message"');
  expect(JSON.parse(await triage.getByTestId("state-out").innerText())).toEqual({ billing: true, tone: "angry" });

  const route = card("by-tone");
  await expect(route.getByTestId("ran-on")).toHaveAttribute("data-machine", "server");
  expect(JSON.parse(await route.getByTestId("state-in").innerText())).toEqual({ tone: "angry" });
  await expect(route.getByTestId("state-out")).toHaveCount(0);

  const escalate = card("escalate");
  await expect(escalate.getByTestId("ran-on")).toHaveAttribute("data-machine", "client");
  await expect(escalate.getByTestId("host")).toHaveText(FIXTURE_HOST);
  await expect(escalate.getByTestId("ran-on")).toContainText("in 0.25s");
  expect(JSON.parse(await escalate.getByTestId("state-in").innerText())).toEqual({ message, tone: "angry" });   // only its inputs
  expect(JSON.parse(await escalate.getByTestId("state-out").innerText())).toEqual({ ticket_id: 4242, queue: "tier2" });

  expect(JSON.parse(await card("end").getByTestId("state-out").innerText())).toEqual({ message });
});

test("a run the console drove names this machine; a client task's answer is in the record", async ({ page }) => {
  const angry = aipJson(["run", "billing-support"], { message: "I was double charged, fix it NOW" }) as { run_id: string };
  const done = aipJson(["resume", angry.run_id], { billing: true, tone: "angry" }) as { run_id: string; done?: boolean };
  expect(done.done).toBe(true);
  await page.goto(`./#/runs/${done.run_id}`);
  const triage = page.locator('[data-testid="run-step"][data-step="triage"]');
  await expect(triage.getByTestId("review-status")).toHaveAttribute("data-review", "manual");
  await expect(triage.getByTestId("ran-on")).toHaveText("answered on the client, by hand");
  await expect(page.locator('[data-testid="run-step"][data-step="escalate"]').getByTestId("host")).toHaveText(hostname());

  const calm = aipJson(["run", "billing-support"], { message: "Why was I billed $12?" }) as { run_id: string };
  const task = aipJson(["resume", calm.run_id], { billing: true, tone: "calm" }) as { run_id: string };
  aipJson(["resume", task.run_id], { reply: "That is your monthly plan." });
  await page.goto(`./#/runs/${task.run_id}`);
  const reply = page.locator('[data-testid="run-step"][data-step="reply"]');
  await expect(reply.getByTestId("ran-on")).toHaveText("performed by the client");
  expect(JSON.parse(await reply.getByTestId("state-in").innerText())).toEqual({ message: "Why was I billed $12?", tone: "calm" });
  expect(JSON.parse(await reply.getByTestId("state-out").innerText())).toEqual({ reply: "That is your monthly plan." });
  await expect(reply.getByTestId("task")).toContainText("Why was I billed $12?");
});

test("a failed run shows the client's stderr on the run and in failing-scripts, beside both resolver kinds", async ({ page, request }) => {
  // A model-answered decision whose script failed on the fixture machine, and a reviewed one that the run kept.
  const failedId = await modelTriage(request, "Your service double-billed me. [views-failed]", "angry");
  const failed = await report(request, failedId, { error: "script_failed", exit_code: 1, stderr: "ticket service unreachable" });
  expect(failed.error).toBe("script_failed");
  const reviewedId = await modelTriage(request, "Refund me now! [views-reviewed]", "angry", true);
  await report(request, reviewedId, { output: { ticket_id: 7, queue: "tier2" }, seconds: 0.1 });
  // And one answered by hand through the CLI, as the console does.
  const manual = aipJson(["run", "billing-support"], { message: "Charged twice, again." }) as { run_id: string };
  aipJson(["resume", manual.run_id], { billing: true, tone: "angry" });

  await page.goto(`./#/runs/${failedId}`);
  await expect(page.getByTestId("run-status")).toHaveText("failed");
  const error = page.locator('[data-testid="run-step"][data-kind="error"]');
  await expect(error.getByTestId("step-stderr")).toHaveText("ticket service unreachable");
  await expect(error.getByTestId("host")).toHaveText(FIXTURE_HOST);
  await expect(error.getByTestId("ran-on")).toHaveAttribute("data-machine", "client");
  expect(JSON.parse(await error.getByTestId("state-in").innerText())).toEqual(
    { message: "Your service double-billed me. [views-failed]", tone: "angry" });   // the state before, as the step saw it
  await expect(error.getByTestId("state-out")).toHaveCount(0);

  await page.goto(`./#/runs/${reviewedId}`);
  await expect(page.locator('[data-testid="run-step"][data-step="triage"]').getByTestId("review-status")).toHaveAttribute("data-review", "kept");

  await page.goto("./#/governance");
  await expect(page.locator("main")).not.toContainText("threshold override");
  const manualQuery = page.locator('[data-testid="governance-query"][data-query="manual-decisions"]');
  const breakdown = manualQuery.locator('[data-testid="governance-row"][data-name="billing-support"][data-step="triage"]').getByTestId("resolver-breakdown");
  await expect(breakdown).toBeVisible();
  expect(Number(await breakdown.getAttribute("data-typesafe"))).toBeGreaterThanOrEqual(2);
  expect(Number(await breakdown.getAttribute("data-manual"))).toBeGreaterThanOrEqual(1);

  const failing = page.locator('[data-testid="governance-query"][data-query="failing-scripts"]');
  const row = failing.locator('[data-testid="governance-row"][data-step="escalate"]');
  // Whichever client failed last (this spec or run.spec's retry), the script's own stderr is what it reported.
  await expect(row.getByTestId("stderr")).toHaveText("ticket service unreachable");
  await expect(row.getByTestId("exit-code")).toHaveText("1");
});
