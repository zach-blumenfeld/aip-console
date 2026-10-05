import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { AIP_PORT } from "./aip";

// History replays runs the server persisted. Spec files run in parallel workers, so
// this one drives billing-support through both branches itself with the same /answer
// and /step calls the console makes in I3, then opens the resulting runs.

const BASE = `http://localhost:${AIP_PORT}`;

interface Step { ran: string; kind: string; result: Record<string, unknown>; suggested: Record<string, unknown>; next: unknown; history: unknown[]; run_id: string }

async function post(request: APIRequestContext, path: string, body: unknown): Promise<Step> {
  const res = await request.post(`${BASE}${path}`, { data: body });
  expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as Step;
}

/** Answer triage by hand, then step until the run ends or pauses as a client task. */
async function drive(request: APIRequestContext, message: string, tone: "angry" | "calm"): Promise<Step> {
  let s = await post(request, "/procedures/billing-support/answer",
    { after: null, payload: { message }, history: [], answers: { billing: true, tone } });
  while (s.next !== null && s.kind !== "client_task") {
    s = await post(request, "/procedures/billing-support/step",
      { after: s.ran, payload: s.suggested, history: s.history, run_id: s.run_id });
  }
  return s;
}

async function expectTrace(page: Page, visited: string[], notVisited: string[], edges: [string, string][]) {
  const graph = page.getByRole("img", { name: "step graph" });
  await expect(graph).toBeVisible();
  for (const step of visited) await expect(graph.locator(`[data-testid="step-node"][data-step="${step}"]`)).toHaveClass(/visited/);
  for (const step of notVisited) await expect(graph.locator(`[data-testid="step-node"][data-step="${step}"]`)).not.toHaveClass(/visited/);
  for (const [from, to] of edges) {
    await expect(graph.locator(`[data-testid="step-edge"][data-from="${from}"][data-to="${to}"]`)).toHaveAttribute("data-taken", "true");
  }
  const taken = graph.locator('[data-testid="step-edge"][data-taken="true"]');
  await expect(taken).toHaveCount(edges.length);
}

test("the angry run's trace highlights the script step", async ({ page, request }) => {
  const done = await drive(request, "I was charged twice and I want my money back NOW or I cancel!", "angry");
  expect(done.next).toBeNull();

  await page.goto(`./#/runs/${done.run_id}`);
  await expect(page.getByTestId("run-status")).toHaveText("done");
  await expectTrace(page, ["triage", "by-tone", "escalate", "end"], ["reply"],
                    [["triage", "by-tone"], ["by-tone", "escalate"], ["escalate", "end"]]);

  // The step cards from the console, read-only: the manual decision, the branch, the script's stdout.
  const cards = page.getByTestId("run-step");
  await expect(cards).toHaveCount(4);
  await expect(page.locator('[data-testid="run-step"][data-step="triage"]')).toContainText("answered by the client");
  await expect(page.getByTestId("branch-taken")).toContainText("escalate");
  await expect(page.locator('[data-testid="run-step"][data-step="escalate"]').getByTestId("script-stdout")).toContainText('"ticket_id"');
  await expect(page.getByTestId("final-state")).toContainText('"queue": "tier2"');
  await expect(page.getByTestId("trace").getByRole("listitem")).toHaveText([/triage/, /by-tone/, /escalate/, /end/]);
  await expect(page.getByRole("button")).toHaveCount(0);           // nothing to drive from here
});

test("the calm run's trace highlights the client task, paused and then done", async ({ page, request }) => {
  const paused = await drive(request, "Hi, could you tell me why I was billed $12 this month?", "calm");
  expect(paused.kind).toBe("client_task");

  await page.goto(`./#/runs/${paused.run_id}`);
  await expect(page.getByTestId("run-status")).toHaveText("paused");
  await expectTrace(page, ["triage", "by-tone", "reply"], ["escalate", "end"], [["triage", "by-tone"], ["by-tone", "reply"]]);
  await expect(page.getByTestId("run-pause")).toContainText("Paused at reply");
  await expect(page.locator('[data-testid="run-step"][data-step="reply"]').getByTestId("task")).toContainText("billed $12");

  // Finish it the way the console would, then the page replays the whole run.
  const done = await post(request, "/procedures/billing-support/step", {
    after: paused.ran, payload: { ...paused.suggested, reply: "Thanks for asking: the $12 is your monthly plan charge." },
    history: paused.history, run_id: paused.run_id,
  });
  expect(done.next).toBeNull();
  await page.reload();
  await expect(page.getByTestId("run-status")).toHaveText("done");
  await expectTrace(page, ["triage", "by-tone", "reply", "end"], ["escalate"],
                    [["triage", "by-tone"], ["by-tone", "reply"], ["reply", "end"]]);
  await expect(page.getByTestId("final-state")).toContainText("monthly plan charge");
  await expect(page.getByTestId("run-pause")).toHaveCount(0);
});

test("the runs list filters by name and status and links to the run page", async ({ page, request }) => {
  const done = await drive(request, "Charged twice, fix it now!", "angry");

  await page.goto("./#/runs");
  await expect(page.getByRole("table", { name: "runs" })).toBeVisible();
  await page.getByRole("combobox", { name: "name" }).selectOption("billing-support");
  await page.getByRole("combobox", { name: "status" }).selectOption("done");
  await expect(page).toHaveURL(/#\/runs\?name=billing-support&status=done$/);
  const rows = page.getByTestId("run-row");
  await expect(rows.first()).toBeVisible();
  for (const status of await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")))) expect(status).toBe("done");
  const mine = page.locator(`[data-testid="run-row"][data-run-id="${done.run_id}"]`);
  await expect(mine).toHaveCount(1);

  await page.getByRole("combobox", { name: "status" }).selectOption("error");
  await expect(page.getByTestId("no-runs")).toBeVisible();
  await page.getByRole("combobox", { name: "status" }).selectOption("done");

  await mine.getByRole("link", { name: done.run_id }).click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${done.run_id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("billing-support");
  await expect(page.getByTestId("run-status")).toHaveText("done");
});
