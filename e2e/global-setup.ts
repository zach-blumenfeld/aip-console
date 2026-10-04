import { AIP_PORT, EXAMPLE, aip } from "./aip";

// Runs after Playwright has started both web servers. Publishing is idempotent:
// the same folder always yields the same revision.
export default async function globalSetup(): Promise<void> {
  const out = aip(`publish "${EXAMPLE()}"`, { AIP_SERVER: `http://localhost:${AIP_PORT}` });
  if (!/billing-support@/.test(out)) throw new Error(`publish did not return a revision:\n${out}`);
}
