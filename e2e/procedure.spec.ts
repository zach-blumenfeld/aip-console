import { expect, test } from "@playwright/test";

const STEPS = ["triage", "by-tone", "escalate", "reply", "end"];

test("search ranks billing-support first and links to its page", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("searchbox", { name: "search" }).fill("refund");
  const results = page.getByRole("table", { name: "search results" });
  await expect(results).toBeVisible();
  const first = results.getByRole("row").nth(1);
  await expect(first).toContainText("billing-support");
  await first.getByRole("link", { name: "billing-support" }).click();
  await expect(page).toHaveURL(/#\/p\/billing-support(%40|@)[0-9a-f]{16}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("billing-support");
});

test("the procedure page draws every step and the router's branches", async ({ page }) => {
  await page.goto("./#/p/billing-support");
  const graph = page.getByRole("img", { name: "step graph" });
  await expect(graph).toBeVisible();

  const nodes = graph.getByTestId("step-node");
  await expect(nodes).toHaveCount(STEPS.length);
  for (const name of STEPS) {
    await expect(graph.locator(`[data-testid="step-node"][data-step="${name}"]`)).toHaveCount(1);
  }
  await expect(graph.locator('[data-step="by-tone"]')).toHaveAttribute("data-kind", "router");

  const labels = graph.getByTestId("branch-label");
  await expect(labels).toHaveText(["angry", "calm"]);

  await expect(page.getByTestId("example-input")).toContainText('"message"');
  await expect(page.getByText("Do not use when")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "revision" })).toContainText("latest");
});

test("the revision switcher re-fetches the page", async ({ page }) => {
  await page.goto("./#/p/billing-support");
  const picker = page.getByRole("combobox", { name: "revision" });
  const revision = await picker.inputValue();
  await picker.selectOption(revision);
  await expect(page).toHaveURL(new RegExp(`billing-support(%40|@)${revision}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`@${revision}`);
});
