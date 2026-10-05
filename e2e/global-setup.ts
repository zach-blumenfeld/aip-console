import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AIP_PORT, EXAMPLE, aip } from "./aip";

// The second revision of billing-support: the example with one line of
// assets/policy.md changed. Specs import these to know what the diff must show.
// The folder must still be called billing-support: the validator checks the name.
export const CHANGED_FILE = "assets/policy.md";
export const OLD_LINE = "- Refunds for other reasons are honored within 30 days of purchase.";
export const NEW_LINE = "- Refunds for other reasons are honored within 45 days of purchase.";
export const SECOND_REVISION_DIR = path.resolve(import.meta.dirname, "..", ".aip-e2e", "v2", "billing-support");

// Runs after Playwright has started both web servers. Publishing is idempotent:
// the same folder always yields the same revision, so the order here (v1 then v2)
// fixes which revision is newest on a fresh root and is a no-op on a reused one.
export default async function globalSetup(): Promise<void> {
  const env = { AIP_SERVER: `http://localhost:${AIP_PORT}` };
  const first = aip(`publish "${EXAMPLE()}"`, env);
  if (!/billing-support@/.test(first)) throw new Error(`publish did not return a revision:\n${first}`);

  mkdirSync(path.dirname(SECOND_REVISION_DIR), { recursive: true });
  cpSync(EXAMPLE(), SECOND_REVISION_DIR, { recursive: true });
  const policy = path.join(SECOND_REVISION_DIR, CHANGED_FILE);
  const text = readFileSync(policy, "utf8");
  if (!text.includes(OLD_LINE)) throw new Error(`${CHANGED_FILE} no longer contains the line the diff spec changes`);
  writeFileSync(policy, text.replace(OLD_LINE, NEW_LINE));
  const second = aip(`publish "${SECOND_REVISION_DIR}"`, env);
  if (!/billing-support@/.test(second)) throw new Error(`second publish did not return a revision:\n${second}`);
  if (second.trim() === first.trim()) throw new Error("the second publish yielded the same revision as the first");
}
