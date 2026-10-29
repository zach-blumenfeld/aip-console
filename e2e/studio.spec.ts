import { expect, test, type Locator, type Page } from "@playwright/test";

// The Studio tab (S1): build the billing-support graph by hand through the page, reload, and find the draft kept
// and the wired part of the graph lint-clean. Inputs and outputs have no editor until S2, so the draft still has
// the issues that need them (a client task with no outputs, an unfinished script); only the wiring rules are
// asserted clean here.

const WIRING = ["duplicate_step_name", "invalid_start_step", "missing_end_step", "multiple_end_steps", "unknown_step_reference",
  "unreachable_step", "no_path_to_end", "unknown_branch_value"];

const node = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name} \\(`) });
const panel = (page: Page) => page.getByTestId("step-panel");
const field = (page: Page, name: string): Locator => panel(page).locator(`[data-field="${name}"]`).first();
const idOf = async (page: Page, name: string) => (await page.locator(`[data-testid="step-node"][data-name="${name}"]`).getAttribute("data-step"))!;
const edge = async (page: Page, from: string, to: string) =>
  page.locator(`[data-testid="step-edge"][data-from="${await idOf(page, from)}"][data-to="${await idOf(page, to)}"]`);
const rename = async (page: Page, name: string) => { await field(page, "name").fill(name); await expect(node(page, name)).toBeVisible(); };
const onBranch = (page: Page, n: number, kind: string) =>
  panel(page).getByRole("group", { name: `New step on branch ${n}` }).getByRole("button", { name: `+ ${kind}` }).click();
const addAfter = (page: Page, after: string, kind: string) =>
  page.getByRole("group", { name: `Add step after ${after}` }).getByRole("button", { name: `+ ${kind}` }).click();

test("build billing-support by hand, reload, and the draft and its wiring are kept", async ({ page }) => {
  await page.goto("./#/studio");
  await expect(page.getByTestId("studio-empty")).toBeVisible();

  // triage: a decision with one choice question, whose labels become the router's branches
  await page.getByRole("group", { name: "Add the first step" }).getByRole("button", { name: "+ decision" }).click();
  await rename(page, "triage");
  await page.getByRole("group", { name: "Add question" }).getByRole("button", { name: "+ choice" }).click();
  const q = panel(page).getByTestId("question");
  await q.locator("input").first().fill("tone");
  await q.getByLabel("label 1", { exact: true }).fill("angry");
  await q.getByLabel("label 2", { exact: true }).fill("calm");

  // by-tone: spliced after triage, its rows filled from the question's labels
  await addAfter(page, "triage", "router");
  await rename(page, "by-tone");
  await expect(field(page, "branch_on")).toHaveValue("tone");
  await expect(panel(page).getByLabel("branch 1 value")).toHaveValue("angry");
  await expect(panel(page).getByLabel("branch 2 value")).toHaveValue("calm");

  // a step is made from the branch row it belongs to
  await onBranch(page, 1, "execution");
  await rename(page, "escalate");
  await node(page, "by-tone").click();
  await onBranch(page, 2, "client_task");
  await expect(panel(page).getByRole("heading", { name: /^client-task-1/ })).toBeVisible();
  await rename(page, "reply");
  await node(page, "escalate").click();
  await addAfter(page, "escalate", "end");
  await rename(page, "end");

  // reply leads to the end through the next-step picker; a second outbound edge cannot be added
  await node(page, "reply").click();
  await panel(page).getByLabel("next step").selectOption({ label: "end" });

  await expect(page.getByTestId("step-node")).toHaveCount(5);
  await expect(page.getByTestId("step-edge")).toHaveCount(5);
  for (const [from, to] of [["triage", "by-tone"], ["by-tone", "escalate"], ["by-tone", "reply"], ["escalate", "end"], ["reply", "end"]]) {
    await expect(await edge(page, from, to)).toHaveCount(1);
  }
  await expect(page.getByTestId("branch-label")).toHaveText(["angry", "calm"]);

  // the lint panel shows no wiring errors, and a click on an issue selects its step
  const lintPanel = page.getByTestId("lint-panel");
  for (const code of WIRING) await expect(lintPanel.locator(`li[data-code="${code}"]`)).toHaveCount(0);
  await lintPanel.locator('li[data-code="missing_outputs"]').getByRole("button").click();
  await expect(panel(page).getByRole("heading", { name: /^reply/ })).toBeVisible();
  await expect(page.getByTestId("step-mark").first()).toBeVisible();

  // procedure settings are kept too
  await page.getByRole("button", { name: "procedure settings" }).click();
  await page.locator('[data-field="name"]').fill("billing-support");
  await page.locator('[data-field="purpose"]').fill("Answer a billing question.");

  await expect(page.getByTestId("studio-saved")).toHaveAttribute("data-state", "saved");
  await page.reload();

  await expect(page.getByTestId("step-node")).toHaveCount(5);
  await expect(page.getByTestId("step-edge")).toHaveCount(5);
  for (const name of ["triage", "by-tone", "escalate", "reply", "end"]) await expect(node(page, name)).toBeVisible();
  for (const [from, to] of [["by-tone", "escalate"], ["by-tone", "reply"], ["reply", "end"]]) {
    await expect(await edge(page, from, to)).toHaveCount(1);
  }
  await page.getByRole("button", { name: "procedure settings" }).click();
  await expect(page.locator('[data-field="purpose"]')).toHaveValue("Answer a billing question.");
  for (const code of WIRING) await expect(page.getByTestId("lint-panel").locator(`li[data-code="${code}"]`)).toHaveCount(0);
});

test("deleting a middle step re-links its neighbours; a step with no name still draws", async ({ page }) => {
  await page.goto("./#/studio");
  await page.getByRole("group", { name: "Add the first step" }).getByRole("button", { name: "+ execution" }).click();
  await rename(page, "first");
  await addAfter(page, "first", "execution");
  await rename(page, "middle");
  await addAfter(page, "middle", "end");
  await expect(page.getByTestId("step-edge")).toHaveCount(2);

  await node(page, "middle").click();
  await panel(page).getByRole("button", { name: "delete step" }).click();
  await expect(page.getByTestId("step-node")).toHaveCount(2);
  await expect(await edge(page, "first", "end")).toHaveCount(1);

  // an empty name is an error in the lint panel, not a crash
  await node(page, "first").click();
  await field(page, "name").fill("");
  await expect(page.getByTestId("lint-panel").locator('li[data-code="schema_violation"]').first()).toBeVisible();
  await expect(page.getByTestId("step-node")).toHaveCount(2);
});
