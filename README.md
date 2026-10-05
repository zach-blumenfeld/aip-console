# aip-inspector

A web client for an [AIP](https://github.com/zach-blumenfeld/aip) server. It speaks only
the HTTP API in the server design (§4.2 and §7 of `docs/server-design.md` there): no private
endpoints, the same calls the `aip` CLI makes.

Views, in build order: catalog with the step graph drawn, source and revision diff, run
console, history, governance. The plan is [`docs/PLAN.md`](docs/PLAN.md).

Routes are hash-based: `#/` catalog, `#/p/<name>[@rev]` procedure (with pin, retire and the
per-question threshold overrides), `#/p/<ref>/files[/<path>]` source manifest and viewer,
`#/p/<name>/diff[/<a>..<b>]` the diff between two revisions (manifest by hash, line diff for
changed text files, both computed client-side), `#/run[/<ref>]` the run console, `#/runs[/<id>]`
history, `#/governance` the corpus queries of `GET /governance` as lists, and `#/server`.

## Running

Against a server you already have:

```
npm install
AIP_SERVER=http://localhost:8000 npm run dev      # http://localhost:5173/inspector/
```

The dev server proxies `/catalog`, `/procedures`, `/runs`, and `/governance` to
`AIP_SERVER`, so the app is same-origin and the server needs no CORS. The Server page
(`#/server`) stores a server URL in `localStorage` and a bearer token in `sessionStorage`
(the design says the token never outlives the session); the token is what pin, retire and
thresholds need off localhost.

To start a server, from a clone of the aip repo:

```
uv run aip server --backend filesystem --root /tmp/aip-root --port 8000
AIP_SERVER=http://localhost:8000 uv run aip publish examples/billing-support
```

## Building

`npm run build` writes `dist/`, a static bundle with base path `/inspector/`. The aip
package ships a copy of it and serves it from `aip server --inspector`:

```
npm run build && npm run sync      # copies dist/ to $AIP_REPO/src/aip/server/inspector/ (default ../aip)
cd ../aip && uv run aip server --backend filesystem --root /tmp/aip-root --inspector   # http://localhost:8000/inspector/
```

The sync replaces that directory wholesale, so commit it in the aip repo whenever the
bundle changes; `aip server --inspector DIR` serves any built `dist/` instead, and a missing
bundle answers 404 with the command that fills it.

## Tests

`npm run e2e` starts a filesystem-backed `aip server` from the sibling aip repo
(`AIP_REPO`, default `../aip`, needs `uv`), publishes `billing-support` into a
throwaway root under `.aip-e2e/` (twice: the example, then a copy with one line of
`assets/policy.md` changed, so the diff view has two revisions), starts Vite against it, and drives the app in
headless Chromium. The governance spec seeds one run with a model-answered decision through the
backend's `RunBackend` interface, since the e2e server has no decision model and a manual
decision is never "overridden". First time: `npx playwright install chromium`, or skip the download
and drive an installed Google Chrome with `PLAYWRIGHT_CHANNEL=chrome npm run e2e`.

Every spec runs twice, as two Playwright projects: `vite` against the dev server, then `bundle`
against the freshly built `dist/` served by that same `aip server --inspector dist`, the way
the package ships it (the aip server's start command runs `npm run build` first). The two share
one backend root, so the second pass also covers the specs' reused-root paths.
