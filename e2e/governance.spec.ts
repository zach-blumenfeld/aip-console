import { expect, test, type APIRequestContext } from "@playwright/test";
import { SERVER as BASE } from "./aip";

// Governance: pin and retire from the procedure page (publish scope; the e2e server is open on
// localhost), and the corpus queries of GET /governance as lists.
//
// The e2e CLI has no decision model, so every decision the other specs drive is answered by hand,
// and a manual decision has no model answer to override. One run with a model-answered triage is
// posted straight to the run API, the way a client with a model reports a reviewed decision: the
// model said `angry`, the reviewer answered `calm`.

interface Entry { name: string; pinned: string | null; latest: string; revisions: { revision: string; retired: boolean }[] }

async function entry(request: APIRequestContext): Promise<Entry> {
  const res = await request.get(`${BASE}/catalog`);
  expect(res.ok()).toBeTruthy();
  const found = ((await res.json()) as Entry[]).find((e) => e.name === "billing-support");
  expect(found).toBeDefined();
  return found!;
}

test.describe.configure({ mode: "serial" });

test("pin a revision; the pin survives a reload", async ({ page, request }) => {
  // Start clean, whatever an earlier spec left.
  expect((await request.post(`${BASE}/catalog/billing-support/pin`, { data: { revision: null } })).ok()).toBeTruthy();
  const latest = (await entry(request)).latest;

  await page.goto("./#/p/billing-support");
  const box = page.getByTestId("governance");
  await expect(box).toBeVisible();
  await expect(box.getByTestId("pin-state")).toHaveText("no pin");
  await box.getByRole("button", { name: "Pin this revision" }).click();
  await expect(box.getByTestId("governance-note")).toContainText("Pinned");
  await expect(box.getByTestId("pin-state")).toContainText(`pinned ${latest.slice(0, 8)} (this revision)`);
  await expect(box.getByRole("button", { name: "Pin this revision" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "revision" })).toContainText("pinned");
  // Thresholds are the author's: shown on the step card, with nothing to override.
  await expect(page.locator("#step-triage")).toContainText("0.6");
  await expect(page.getByLabel("override for tone")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("pin-state")).toContainText(`pinned ${latest.slice(0, 8)} (this revision)`);
  expect((await entry(request)).pinned).toBe(latest);

  // The pinned revision is the latest one, so the bare name still resolves as before for the other specs.
  await page.getByTestId("governance").getByRole("button", { name: "Unpin" }).click();
  await expect(page.getByTestId("pin-state")).toHaveText("no pin");
  expect((await entry(request)).pinned).toBeNull();
});

test("retire the older revision from its page; the name still resolves to the latest", async ({ page, request }) => {
  const before = await entry(request);
  const older = before.revisions.find((r) => r.revision !== before.latest)!;
  expect(older).toBeDefined();

  await page.goto(`./#/p/billing-support@${older.revision}`);
  const box = page.getByTestId("governance");
  await expect(box).toBeVisible();
  if (!older.retired) {                                   // a reused root has already retired it
    await box.getByRole("button", { name: "Retire this revision…" }).click();
    await expect(box).toContainText("This cannot be undone");
    await box.getByRole("button", { name: "Cancel" }).click();
    await expect(box.getByTestId("retired-state")).toHaveCount(0);
    await box.getByRole("button", { name: "Retire this revision…" }).click();
    await box.getByRole("button", { name: "Confirm retire" }).click();
    await expect(box.getByTestId("governance-note")).toContainText("Retired");
  }
  await expect(box.getByTestId("retired-state")).toHaveText("This revision is retired.");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("(retired)");
  await expect(page.getByRole("combobox", { name: "revision" })).toContainText("retired");
  await expect(box.getByRole("button", { name: "Pin this revision" })).toHaveCount(0);

  const after = await entry(request);
  expect(after.revisions.find((r) => r.revision === older.revision)!.retired).toBe(true);
  expect(after.latest).toBe(before.latest);
  const resolved = await (await request.get(`${BASE}/catalog/billing-support`)).json();
  expect(resolved.revision).toBe(before.latest);
});

test("the governance page lists the overridden decision and marks the graph-only query", async ({ page, request }) => {
  const message = "Hi, could you tell me why I was billed $12 this month?";
  const opened = await request.post(`${BASE}/runs`, { data: { name: "billing-support", input: { message } } });
  expect(opened.status(), await opened.text()).toBe(201);
  const { run_id: runId } = (await opened.json()) as { run_id: string };
  const answered = await request.post(`${BASE}/runs/${runId}/result`, { data: {
    step: "triage",
    answer: { billing: true, tone: "calm" },
    attribution: { resolver: "typesafe", model: "jev-1", confidence: { billing: 0.97, tone: 0.55 }, reviewed: true,
                   proposed: { billing: true, tone: "angry" } },
  } });
  expect(answered.ok(), await answered.text()).toBeTruthy();

  await page.goto("./#/governance");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Governance");
  const queries = page.getByTestId("governance-query");
  await expect(queries).toHaveCount(5);
  for (const q of ["overridden-decisions", "manual-decisions", "failing-scripts", "missing-fields", "untaken-branches"]) {
    await expect(page.locator(`[data-testid="governance-query"][data-query="${q}"]`)).toHaveCount(1);
  }

  const overridden = page.locator('[data-testid="governance-query"][data-query="overridden-decisions"]');
  await expect(overridden).toHaveAttribute("data-state", "rows");
  const row = overridden.locator('[data-testid="governance-row"][data-step="triage"][data-question="tone"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("billing-support");
  await expect(row.getByRole("link", { name: "billing-support" })).toHaveAttribute("href", /#\/p\/billing-support$/);
  await expect(overridden.locator('[data-testid="governance-row"][data-question="billing"]')).toHaveCount(0);

  // The filesystem backend scans run files for the others and declines the graph one.
  await expect(page.locator('[data-testid="governance-query"][data-query="failing-scripts"]')).toHaveAttribute("data-state", "rows");
  await expect(page.locator('[data-testid="governance-query"][data-query="missing-fields"] [data-testid="no-rows"]')).toBeVisible();
  const untaken = page.locator('[data-testid="governance-query"][data-query="untaken-branches"]');
  await expect(untaken).toHaveAttribute("data-state", "unsupported");
  await expect(untaken.getByTestId("needs-graph")).toContainText("needs the Neo4j backend");
  await expect(page.getByRole("alert")).toHaveCount(0);

  // The name filter rides in the hash and narrows every list.
  await page.getByRole("combobox", { name: "name" }).selectOption("billing-support");
  await expect(page).toHaveURL(/#\/governance\?name=billing-support$/);
  await expect(row).toHaveCount(1);

  // The server page shows the console's server and keeps a token for this browser; the token never reaches localStorage.
  await page.goto("./#/server");
  await expect(page.getByTestId("server-url")).toHaveText(BASE);
  await page.getByLabel("bearer token").fill("secret-token");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("server-note")).toContainText("procedure");
  expect(await page.evaluate(() => [localStorage.getItem("aip.token"), sessionStorage.getItem("aip.token")])).toEqual([null, "secret-token"]);
  await page.getByRole("button", { name: "Clear" }).click();
  expect(await page.evaluate(() => sessionStorage.getItem("aip.token"))).toBeNull();
});
