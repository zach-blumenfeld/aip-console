import { expect, test, type Page } from "@playwright/test";
import { AIP_PORT } from "./aip";

// The e2e server has no decision model (no TYPESAFE_API_KEY), so `triage` pauses as
// a manual decision and the console answers it through /answer; the router then
// sends angry messages to the script and calm ones to the client task.

async function startAndTriage(page: Page, message: string, tone: "angry" | "calm") {
  await page.goto("./#/run/billing-support");
  await expect(page.getByTestId("run-status")).toHaveText("not started");
  const start = page.getByTestId("pause-start");
  await expect(start.getByTestId("payload")).toContainText('"message"');     // prefilled from example_input
  await start.getByLabel("message", { exact: true }).fill(message);
  await expect(start.getByTestId("payload")).toContainText(message);

  await start.getByRole("button", { name: "Step" }).click();
  const decision = page.getByTestId("pause-decision");
  await expect(decision).toBeVisible();
  await expect(page.getByTestId("run-status")).toHaveText("paused");
  await decision.getByRole("group", { name: "billing" }).getByRole("radio", { name: /^yes/ }).check();
  await decision.getByRole("group", { name: "tone" }).getByRole("radio", { name: new RegExp(`^${tone}`) }).check();
  await decision.getByRole("button", { name: "Answer" }).click();

  const triage = page.locator('[data-testid="run-step"][data-step="triage"]');
  await expect(triage).toBeVisible();
  await expect(triage.locator('[data-question="tone"] [data-testid="answer-value"]')).toHaveText(`"${tone}"`);
  await expect(triage.locator('[data-question="billing"] [data-testid="answer-value"]')).toHaveText("true");
  await expect(triage).toContainText("answered by the client");
  await expect(page.getByTestId("run-status")).toHaveText("running");
  await expect(page.getByTestId("run-id")).toHaveText(/\S+/);
  return (await page.getByTestId("run-id").textContent())!.trim();
}

async function runsDone(page: Page): Promise<string[]> {
  const res = await page.request.get(`http://localhost:${AIP_PORT}/runs?name=billing-support&status=done&limit=1000`);
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { run_id: string }[]).map((r) => r.run_id);
}

test("an angry message runs the escalation script server-side", async ({ page }) => {
  const runId = await startAndTriage(page, "I was charged twice and I want my money back NOW or I cancel!", "angry");

  // A per-run threshold override rides along on every /step.
  await page.getByLabel("threshold for tone").fill("0.9");
  const stepRequest = page.waitForRequest((r) => r.url().endsWith("/step") && r.method() === "POST");
  await page.getByTestId("pause-input").getByRole("button", { name: "Run to pause" }).click();
  const body = (await stepRequest).postDataJSON();
  expect(body.thresholds).toEqual({ tone: 0.9 });
  expect(body.run_id).toBe(runId);
  expect(body.after).toBe("triage");

  await expect(page.getByTestId("run-status")).toHaveText("done");
  await expect(page.getByTestId("branch-taken")).toContainText("escalate");
  const escalate = page.locator('[data-testid="run-step"][data-step="escalate"]');
  await expect(escalate.getByTestId("script-stdin")).toContainText('"tone": "angry"');
  await expect(escalate.getByTestId("script-stdout")).toContainText('"ticket_id"');
  await expect(page.getByTestId("final-state")).toContainText('"ticket_id"');
  await expect(page.getByTestId("final-state")).toContainText('"queue": "tier2"');
  await expect(page.getByTestId("trace").getByRole("listitem")).toHaveText([/triage/, /by-tone/, /escalate/, /end/]);
  await expect(page.locator('[data-testid="run-step"][data-step="reply"]')).toHaveCount(0);

  expect(await runsDone(page)).toContain(runId);
});

test("a calm message pauses as a client task that is answered in the UI", async ({ page }) => {
  const runId = await startAndTriage(page, "Hi, could you tell me why I was billed $12 this month?", "calm");

  await page.getByTestId("pause-input").getByRole("button", { name: "Run to pause" }).click();
  const task = page.getByTestId("pause-client-task");
  await expect(task).toBeVisible();
  await expect(page.getByTestId("run-status")).toHaveText("paused");
  await expect(page.getByTestId("branch-taken")).toContainText("reply");
  const reply = page.locator('[data-testid="run-step"][data-step="reply"]');
  await expect(reply.getByTestId("task")).toContainText("Write a short, calm reply");
  await expect(reply.getByTestId("task")).toContainText("billed $12");                 // {message} rendered
  await expect(reply.getByTestId("task")).toContainText("Refunds");                    // {assets[policy]} rendered
  await expect(reply.getByTestId("references").getByRole("link")).toHaveText("references/help.md");

  // The end step only declares `message`; the template asks for `reply` too, so it goes in through the payload.
  const payload = task.getByTestId("payload");
  const current = JSON.parse((await payload.inputValue())) as Record<string, unknown>;
  expect(current.tone).toBe("calm");
  await payload.fill(JSON.stringify({ ...current, reply: "Thanks for asking: the $12 is your monthly plan charge." }, null, 2));
  await task.getByRole("button", { name: "Step" }).click();

  await expect(page.getByTestId("run-status")).toHaveText("done");
  await expect(page.getByTestId("final-state")).toContainText("monthly plan charge");
  await expect(page.getByTestId("final-state")).not.toContainText("ticket_id");
  await expect(page.locator('[data-testid="run-step"][data-step="escalate"]')).toHaveCount(0);

  expect(await runsDone(page)).toContain(runId);
});

test("an invalid start input is reported and the run is not started", async ({ page }) => {
  await page.goto("./#/run/billing-support");
  await page.getByTestId("payload").fill("{}");
  await page.getByRole("button", { name: "Step" }).click();
  await expect(page.getByRole("alert")).toContainText("missing message");
  await expect(page.getByTestId("run-id")).toHaveCount(0);
});
