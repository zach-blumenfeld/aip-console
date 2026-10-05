import { expect, test, type APIRequestContext } from "@playwright/test";
import { AIP_PORT, ROOT, python } from "./aip";

// Governance: pin, retire and threshold overrides from the procedure page (publish scope; the e2e
// server is open on localhost), and the corpus queries of GET /governance as lists.
//
// The e2e server has no decision model, so every decision the other specs drive is answered by
// the client, and a manual decision has no model answer to override. One run with a model-answered
// triage is seeded through the backend's RunBackend interface (what the server would have recorded
// with a model): the model said `angry`, the client sent the router `calm`.

const BASE = `http://localhost:${AIP_PORT}`;

interface Entry { name: string; pinned: string | null; latest: string; revisions: { revision: string; retired: boolean }[] }

async function entry(request: APIRequestContext): Promise<Entry> {
  const res = await request.get(`${BASE}/catalog`);
  expect(res.ok()).toBeTruthy();
  const found = ((await res.json()) as Entry[]).find((e) => e.name === "billing-support");
  expect(found).toBeDefined();
  return found!;
}

test.describe.configure({ mode: "serial" });

test("pin a revision and set a threshold override; both survive a reload", async ({ page, request }) => {
  // A reused root may still hold last time's pin and overrides: start clean.
  expect((await request.post(`${BASE}/catalog/billing-support/pin`, { data: { revision: null } })).ok()).toBeTruthy();
  expect((await request.post(`${BASE}/catalog/billing-support/thresholds`, { data: { thresholds: {} } })).ok()).toBeTruthy();
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

  const tone = box.getByLabel("override for tone");
  await expect(tone).toHaveValue("");
  await tone.fill("0.8");
  await box.getByRole("button", { name: "Save thresholds" }).click();
  await expect(box.getByTestId("governance-note")).toContainText("Saved 1 override");
  // The step card's threshold column shows the override over the author's value.
  await expect(page.locator("#step-triage")).toContainText("0.8 (override of");

  await page.reload();
  await expect(page.getByTestId("pin-state")).toContainText(`pinned ${latest.slice(0, 8)} (this revision)`);
  await expect(page.getByLabel("override for tone")).toHaveValue("0.8");
  await expect(page.getByLabel("override for billing")).toHaveValue("");
  await expect(page.locator("#step-triage")).toContainText("0.8 (override of");

  expect((await entry(request)).pinned).toBe(latest);
  const stored = await (await request.get(`${BASE}/catalog/billing-support/thresholds`)).json();
  expect(stored).toEqual({ name: "billing-support", thresholds: { tone: 0.8 } });

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

test("the governance page lists the overridden decision and marks the graph-only query", async ({ page }) => {
  const seeded = python(`
import json, sys
from aip.server.backends.filesystem import FilesystemBackend
backend = FilesystemBackend(sys.argv[1])
name, revision = backend.catalog.resolve("billing-support")
run_id = backend.runs.create(name, revision)
message = "Hi, could you tell me why I was billed $12 this month?"
answers = {"billing": {"type": "noul", "noul": 0.97},
           "tone": {"type": "choice", "choice": "angry", "confidence": 0.55, "probabilities": {"angry": 0.55, "calm": 0.45}}}
backend.runs.append(run_id, {"step": "triage", "kind": "decision", "input": {"message": message},
                             "result": {"model": "jev-1", "usage": {"input_tokens": 1, "output_tokens": 1}, "answers": answers}},
                    "running", None)
backend.runs.append(run_id, {"step": "by-tone", "kind": "router", "input": {"tone": "calm"}, "result": {"to": "reply"}},
                    "running", None)
task = {"task": "Draft a reply", "references": []}
backend.runs.append(run_id, {"step": "reply", "kind": "client_task", "input": {"message": message, "billing": True, "tone": "calm"},
                             "result": task},
                    "paused", {"kind": "client_task", "step": "reply", **task, "expects": {"message": "str", "reply": "str"}})
print(run_id)
`, [ROOT]).trim();
  expect(seeded).toMatch(/^[0-9a-f]{16}$/);

  await page.goto("./#/governance");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Governance");
  const queries = page.getByTestId("governance-query");
  await expect(queries).toHaveCount(4);
  for (const q of ["overridden-decisions", "failing-scripts", "missing-fields", "untaken-branches"]) {
    await expect(page.locator(`[data-testid="governance-query"][data-query="${q}"]`)).toHaveCount(1);
  }

  const overridden = page.locator('[data-testid="governance-query"][data-query="overridden-decisions"]');
  await expect(overridden).toHaveAttribute("data-state", "rows");
  const row = overridden.locator('[data-testid="governance-row"][data-step="triage"][data-question="tone"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("billing-support");
  await expect(row.getByRole("link", { name: "billing-support" })).toHaveAttribute("href", /#\/p\/billing-support$/);
  await expect(overridden.locator('[data-testid="governance-row"][data-question="billing"]')).toHaveCount(0);

  // The filesystem backend scans run files for the first three and declines the graph one.
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

  // The server page keeps the URL and a token for this browser; the token never reaches localStorage.
  await page.goto("./#/server");
  await page.getByLabel("bearer token").fill("secret-token");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("server-note")).toContainText("procedure");
  expect(await page.evaluate(() => [localStorage.getItem("aip.token"), sessionStorage.getItem("aip.token")])).toEqual([null, "secret-token"]);
  await page.getByRole("button", { name: "Clear" }).click();
  expect(await page.evaluate(() => sessionStorage.getItem("aip.token"))).toBeNull();
});
