import path from "node:path";
import { defineConfig } from "@playwright/test";
import { AIP_PORT, WEB_PORT, aipCommand } from "./e2e/aip";

// Two servers: a filesystem-backed `aip server` from the sibling aip repo (AIP_REPO,
// default ../aip), started with `--inspector dist` so it also serves this repo's freshly
// built bundle, and the Vite dev server proxying to it. Global setup publishes
// examples/billing-support before any test runs.
//
// Two projects run the same specs: `vite` against the dev server, then `bundle` against
// the bundle served by `aip server` itself, the way the package ships it. They share the
// backend root, so `bundle` runs after `vite` and exercises the specs' reused-root paths.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  // PLAYWRIGHT_CHANNEL=chrome drives an installed Google Chrome instead of the
  // downloaded Chromium (handy offline or before `npx playwright install`).
  use: {
    trace: "retain-on-failure",
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  projects: [
    { name: "vite", use: { baseURL: `http://localhost:${WEB_PORT}/inspector/` } },
    { name: "bundle", use: { baseURL: `http://localhost:${AIP_PORT}/inspector/` }, dependencies: ["vite"] },
  ],
  reporter: process.env.CI ? "github" : "list",
  webServer: [
    {
      command: "npm run build && " +
        aipCommand(`server --backend filesystem --root .aip-e2e/root --port ${AIP_PORT} --inspector dist`),
      // The server also reads ~/.config/aip/server.toml and the environment; the specs assume a
      // server with no decision model and no tokens, so neither may leak in from this machine.
      env: { AIP_CONFIG: path.resolve(".aip-e2e", "no-config.json"), TYPESAFE_API_KEY: "" },
      url: `http://localhost:${AIP_PORT}/catalog`,
      reuseExistingServer: false,
      stdout: "pipe",
      timeout: 120_000,
    },
    {
      command: `npx vite --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/inspector/`,
      env: { AIP_SERVER: `http://localhost:${AIP_PORT}` },
      reuseExistingServer: false,
    },
  ],
});
