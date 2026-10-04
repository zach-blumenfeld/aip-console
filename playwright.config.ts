import { defineConfig } from "@playwright/test";
import { AIP_PORT, WEB_PORT, aipCommand } from "./e2e/aip";

// Two servers: a filesystem-backed `aip server` from the sibling aip repo
// (AIP_REPO, default ../aip) and the Vite dev server proxying to it. Global
// setup publishes examples/billing-support before any test runs.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  // PLAYWRIGHT_CHANNEL=chrome drives an installed Google Chrome instead of the
  // downloaded Chromium (handy offline or before `npx playwright install`).
  use: {
    baseURL: `http://localhost:${WEB_PORT}/inspector/`,
    trace: "retain-on-failure",
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  reporter: process.env.CI ? "github" : "list",
  webServer: [
    {
      command: aipCommand(`server --backend filesystem --root .aip-e2e/root --port ${AIP_PORT}`),
      url: `http://localhost:${AIP_PORT}/catalog`,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: `npx vite --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/inspector/`,
      env: { AIP_SERVER: `http://localhost:${AIP_PORT}` },
      reuseExistingServer: false,
    },
  ],
});
