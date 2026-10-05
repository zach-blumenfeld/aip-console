// `npm run sync`: copy the built bundle into the aip package, where `aip server --inspector`
// serves it. Replaces the whole directory so hashed assets from older builds do not pile up.
// AIP_REPO names the aip checkout (default ../aip); run `npm run build` first.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const dist = path.resolve(here, "..", "dist");
const repo = path.resolve(process.env.AIP_REPO ?? path.join(here, "..", "..", "aip"));
const target = path.join(repo, "src", "aip", "server", "inspector");

if (!existsSync(path.join(dist, "index.html"))) {
  console.error(`sync: no bundle at ${dist} (run \`npm run build\` first)`);
  process.exit(1);
}
if (!existsSync(path.join(repo, "pyproject.toml")) || !existsSync(path.join(repo, "src", "aip", "server"))) {
  console.error(`sync: AIP_REPO=${repo} is not the aip repo (no pyproject.toml or src/aip/server); set AIP_REPO`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(dist, target, { recursive: true });

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(path.relative(target, p));
  }
};
walk(target);
console.log(`synced ${files.length} file(s) to ${target}:\n  ${files.sort().join("\n  ")}`);
