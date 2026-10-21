import { expect, test, type Page } from "@playwright/test";
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { SECOND_REVISION_DIR, SERVER } from "./aip";

// Skill zips: a revision downloads as `<name>@<rev>.zip` holding `<name>/<path>` for every file of its
// manifest, and a zip of a skill folder publishes through the catalog page, where the server names the skill
// from SKILL.md's frontmatter: a new name appears, the same bytes land on the revision already there, and a
// change makes the next revision. The uploads use their own name so the other specs' two revisions of
// billing-support stay what they are.

const NAME = "zip-support";

interface Entry { path: string; size: number; sha256: string; mode: number }

/** The files of a skill folder, as `<name>/<path>` zip entries, with `edit` applied to SKILL.md and the rest. */
function zipOf(dir: string, name: string, edit: (path: string, text: string) => string | null = (_, t) => t): Buffer {
  const entries: Zippable = {};
  const walk = (rel: string) => {
    for (const item of readdirSync(path.join(dir, rel)).sort()) {
      const sub = rel ? `${rel}/${item}` : item;
      if (statSync(path.join(dir, sub)).isDirectory()) { walk(sub); continue; }
      const edited = edit(sub, readFileSync(path.join(dir, sub), "utf8"));
      if (edited !== null) entries[`${name}/${sub}`] = strToU8(edited);
    }
  };
  walk("");
  return Buffer.from(zipSync(entries));
}

/** billing-support's second revision renamed, so it publishes under NAME. */
const rename = (p: string, text: string) => (p === "SKILL.md" ? text.replace(/^name: billing-support$/m, `name: ${NAME}`) : text);

async function manifest(ref: string): Promise<Entry[]> {
  return (await (await fetch(`${SERVER}/catalog/${encodeURIComponent(ref)}/files`)).json()) as Entry[];
}

async function upload(page: Page, zip: Buffer, filename: string) {
  await page.getByLabel("skill zip").setInputFiles({ name: filename, mimeType: "application/zip", buffer: zip });
}

async function downloaded(page: Page): Promise<{ filename: string; entries: Record<string, Uint8Array> }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-zip").click()]);
  const file = await download.path();
  return { filename: download.suggestedFilename(), entries: unzipSync(new Uint8Array(readFileSync(file))) };
}

test("the procedure page downloads the revision as a zip of its manifest", async ({ page }) => {
  await page.goto("./#/p/billing-support");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("@");
  const revision = /@([0-9a-f]{16})/.exec(await page.getByRole("heading", { level: 1 }).innerText())![1];

  const { filename, entries } = await downloaded(page);
  expect(filename).toBe(`billing-support@${revision}.zip`);
  const files = await manifest(`billing-support@${revision}`);
  expect(Object.keys(entries).filter((k) => !k.endsWith("/")).sort()).toEqual(files.map((f) => `billing-support/${f.path}`).sort());
  for (const f of files) {
    expect(createHash("sha256").update(entries[`billing-support/${f.path}`]).digest("hex"), f.path).toBe(f.sha256);
  }
});

test("a zip of a skill folder publishes from the catalog page and opens the new revision", async ({ page }) => {
  await page.goto("./");
  await upload(page, zipOf(SECOND_REVISION_DIR, NAME, rename), `${NAME}.zip`);
  await expect(page).toHaveURL(new RegExp(`#/p/${NAME}(%40|@)[0-9a-f]{16}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(NAME);
  const note = page.getByTestId("published-note");
  await expect(note).toHaveAttribute("data-existed", "false");
  await expect(note).toContainText(`Published ${NAME}.zip as this revision.`);

  await page.goto("./");
  const row = page.getByRole("table", { name: "catalog" }).getByRole("row").filter({ hasText: NAME });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole("cell").nth(3)).toHaveText("1");
});

test("the same zip again lands on the revision already there; a change makes the next one", async ({ page }) => {
  await page.goto("./");
  await upload(page, zipOf(SECOND_REVISION_DIR, NAME, rename), "again.zip");
  await expect(page.getByTestId("published-note")).toHaveAttribute("data-existed", "true");
  await expect(page.getByTestId("published-note")).toContainText("nothing changed");
  const first = /@([0-9a-f]{16})/.exec(decodeURIComponent(page.url()))![1];

  await page.goto("./");
  const changed = (p: string, text: string) => (p === "assets/policy.md" ? `${text}\n- Zip uploads are refunded in full.\n` : rename(p, text));
  await upload(page, zipOf(SECOND_REVISION_DIR, NAME, changed), "v2.zip");
  await expect(page.getByTestId("published-note")).toHaveAttribute("data-existed", "false");
  const second = /@([0-9a-f]{16})/.exec(decodeURIComponent(page.url()))![1];
  expect(second).not.toBe(first);
  await expect(page.getByRole("combobox", { name: "revision" })).toContainText("latest");
  await page.getByRole("link", { name: "diff with previous" }).click();
  await expect(page.getByTestId("diff-summary")).toContainText("1 changed");
});

test("a downloaded zip uploads back onto the same revision", async ({ page }) => {
  await page.goto(`./#/p/${NAME}/files`);
  const { filename, entries } = await downloaded(page);
  expect(filename).toMatch(new RegExp(`^${NAME}@[0-9a-f]{16}\\.zip$`));
  const revision = /@([0-9a-f]{16})/.exec(filename)![1];
  expect(Object.keys(entries)).toContain(`${NAME}/SKILL.md`);

  await page.goto("./");
  await upload(page, Buffer.from(zipSync(entries)), filename);
  await expect(page).toHaveURL(new RegExp(`#/p/${NAME}(%40|@)${revision}$`));
  await expect(page.getByTestId("published-note")).toHaveAttribute("data-existed", "true");
});

test("a zip that is not a skill is refused with the reason", async ({ page }) => {
  await page.goto("./");
  // No SKILL.md anywhere: the page says so before anything is sent.
  await upload(page, Buffer.from(zipSync({ "notes/readme.md": strToU8("# nothing here\n") })), "notes.zip");
  const error = page.getByTestId("upload-error");
  await expect(error).toContainText("no SKILL.md");
  await expect(page).toHaveURL(/#\/$|\/$/);

  // A skill the server rejects: the validator's issues are listed. Without source/ the folder structure fails.
  const noSource = (p: string, text: string) => (p.startsWith("source/") ? null : rename(p, text).replace(`name: ${NAME}`, "name: zip-broken"));
  await upload(page, zipOf(SECOND_REVISION_DIR, "zip-broken", noSource), "broken.zip");
  await expect(error).toContainText("invalid_skill");
  await expect(error.getByTestId("issues").getByRole("listitem").first()).toContainText("source");
  await expect(page.getByRole("table", { name: "catalog" }).getByRole("row").filter({ hasText: "zip-broken" })).toHaveCount(0);
});

test("a name whose every revision is retired is hidden from the catalog unless asked for, and cannot be run", async ({ page, request }) => {
  const entry = (await (await fetch(`${SERVER}/catalog`)).json() as { name: string; revisions: { revision: string }[] }[]).find((e) => e.name === NAME)!;
  for (const r of entry.revisions) {
    expect((await request.post(`${SERVER}/catalog/${NAME}/retire`, { data: { revision: r.revision } })).ok()).toBeTruthy();
  }
  // Hidden from the catalog by default, then listed last and marked when asked for.
  await page.goto("./");
  const table = page.getByRole("table", { name: "catalog" });
  const row = table.getByRole("row").filter({ hasText: NAME });
  await expect(table.getByRole("row").filter({ hasText: "billing-support" })).toHaveCount(1);
  await expect(row).toHaveCount(0);
  await page.getByRole("checkbox", { name: /show 1 name with every revision retired/ }).check();
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("all-retired")).toHaveText("all retired");
  await expect(table.locator("tbody tr").last()).toContainText(NAME);

  await page.goto("./#/run");
  await expect(page.getByRole("list").getByText(NAME)).toBeVisible();
  await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);
  await expect(page.getByText("every revision is retired")).toBeVisible();
});
