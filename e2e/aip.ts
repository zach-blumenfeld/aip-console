import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const AIP_PORT = Number(process.env.AIP_E2E_PORT ?? 8765);
export const WEB_PORT = Number(process.env.WEB_E2E_PORT ?? 5174);

/** The aip repo this inspector is developed against (a clone with the server extra). */
export function aipRepo(): string {
  const repo = path.resolve(process.env.AIP_REPO ?? path.join(import.meta.dirname, "..", "..", "aip"));
  if (!existsSync(path.join(repo, "pyproject.toml"))) {
    throw new Error(`AIP_REPO=${repo} is not the aip repo (no pyproject.toml); set AIP_REPO`);
  }
  return repo;
}

/** `uv run aip <args>` inside the aip repo's environment, from this repo's cwd. */
export function aipCommand(args: string): string {
  return `uv run --project "${aipRepo()}" --group dev aip ${args}`;
}

export function aip(args: string, env: NodeJS.ProcessEnv = {}): string {
  return execSync(aipCommand(args), { env: { ...process.env, ...env }, encoding: "utf8" });
}

export const EXAMPLE = () => path.join(aipRepo(), "examples", "billing-support");
