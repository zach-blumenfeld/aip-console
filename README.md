# aip-inspector

A web client for an [AIP](https://github.com/zach-blumenfeld/aip) server. It speaks only
the HTTP API in the server design (§4.2 and §7 of `docs/server-design.md` there): no private
endpoints, the same calls the `aip` CLI makes.

Views, in build order: catalog with the step graph drawn, source and revision diff, run
console, history, governance. The plan is [`docs/PLAN.md`](docs/PLAN.md).

Routes are hash-based: `#/` catalog, `#/p/<name>[@rev]` procedure, `#/p/<ref>/files[/<path>]`
source manifest and viewer, `#/p/<name>/diff[/<a>..<b>]` the diff between two revisions
(manifest by hash, line diff for changed text files, both computed client-side).

## Running

Against a server you already have:

```
npm install
AIP_SERVER=http://localhost:8000 npm run dev      # http://localhost:5173/inspector/
```

The dev server proxies `/catalog`, `/procedures`, `/runs`, and `/governance` to
`AIP_SERVER`, so the app is same-origin and the server needs no CORS. For a server on
another origin at runtime, the Server page (once it exists) stores the URL and token
in `localStorage`.

To start a server, from a clone of the aip repo:

```
uv run aip server --backend filesystem --root /tmp/aip-root --port 8000
AIP_SERVER=http://localhost:8000 uv run aip publish examples/billing-support
```

## Building

`npm run build` writes `dist/`, a static bundle with base path `/inspector/`. The aip
package serves it from `aip server --inspector` (that wiring lands with the plan's
packaging milestone).

## Tests

`npm run e2e` starts a filesystem-backed `aip server` from the sibling aip repo
(`AIP_REPO`, default `../aip`, needs `uv`), publishes `billing-support` into a
throwaway root under `.aip-e2e/` (twice: the example, then a copy with one line of
`assets/policy.md` changed, so the diff view has two revisions), starts Vite against it, and drives the app in
headless Chromium. First time: `npx playwright install chromium`, or skip the download
and drive an installed Google Chrome with `PLAYWRIGHT_CHANNEL=chrome npm run e2e`.
