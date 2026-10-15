# Demo: from an app's traffic to a working MCP connector

This folder runs the recipe in [docs/building-connectors.md](../../docs/building-connectors.md) end to end on a small app that lives here, so every step can be seen working. It is not part of the published `pocket-bok` package and adds nothing to Pocket's dependencies.

## The app

`app/server.mjs` is "Notebook", a toy notes service with a web page and a JSON API (sign in, who am I, list notes with paging and a tag filter, read a note, create a note, plus an analytics beacon the page fires on every action). It has no dependencies. Its only account is `demo` / `demo-password`, made up for this demo.

The API is deliberately not documented anywhere. The only way to know it is to watch the page use it.

## Run it

You need Node 22.12 or newer, Python 3.12 or newer, and about a minute.

```sh
cd demos/connector-from-traffic
npm install                              # the generator, pinned to 4.1.0
pip install mitmproxy2swagger==0.15.0    # also installs mitmproxy; use a virtual environment
node pipeline/run.mjs
```

If the converter is installed somewhere that is not on your `PATH`, point `MITMPROXY2SWAGGER` at it.

What you see, in order:

1. **First pass**: the converter lists the endpoints in the recorded traffic (`capture/notebook.har`).
2. **Choose endpoints**: `connector/decisions.json` keeps `/session`, `/me`, `/notes` and `/notes/{id}`, and leaves out the analytics beacon.
3. **Second pass**: the converter infers parameters and response shapes for the chosen endpoints.
4. **Overlay**: `connector/overlay.json` adds what the converter missed. The run prints what the draft got wrong on its own (two query parameters, `tag` and `cursor`, that the capture used).
5. **Coverage check**: fails if anything in the capture is missing from the final description.
6. **Generate, install, build**: [openapi-mcp-generator](https://www.npmjs.com/package/openapi-mcp-generator) writes the server into `build/connector` and it is compiled.
7. **Verify**: `pipeline/verify.mjs` starts the app and the connector and makes ten real tool calls over MCP.

The last line is `the connector works against the app`. Anything else exits non-zero.

## Other things to try

```sh
# Record the traffic again instead of using the committed capture. Needs Playwright
# (not installed by this folder) and a Chrome or Chromium; see the top of capture/capture.mjs.
node pipeline/run.mjs --capture

# Start from a spec the vendor publishes instead of from traffic. official/openapi.yaml stands in for one.
# Only operations you name are offered, and anything that is not a GET is refused...
node pipeline/run.mjs --from-spec official/openapi.yaml --expose getMe,listNotes,getNote
# ...unless you say so. The live check expects exactly the three read tools, so it fails on
# this build by design; skip it, and write your own check for any tool that changes data.
node pipeline/run.mjs --from-spec official/openapi.yaml --expose createNote --allow-writes --skip-verify

# Build without the live check
node pipeline/run.mjs --skip-verify
```

To see what the connector does by hand, run `node pipeline/run.mjs --skip-verify`, start the app yourself (`node -e "import('./app/server.mjs').then(m => m.startApp({port: 4010}))"`), and run `build/connector/build/index.js` with `API_BASE_URL=http://127.0.0.1:4010/api` and `BEARER_TOKEN_SESSIONTOKEN=demo-session-token` in its environment, from any MCP client.

## Files

| Path | What it is |
| --- | --- |
| `app/` | The demo app and its web page |
| `capture/capture.mjs` | Drives the page in a headless browser and records a HAR file |
| `capture/notebook.har` | A real recording of that session. Every value in it is made up; it holds no cookies |
| `connector/decisions.json` | Which endpoints to keep, and why the others were left out |
| `connector/overlay.json` | The review of the draft: names, descriptions, parameters, the security scheme, and which operations to offer |
| `official/openapi.yaml` | A stand-in for a spec a vendor publishes, for the second route |
| `pipeline/run.mjs` | Runs the whole chain |
| `pipeline/spec.mjs` | The small pieces of logic: merging the overlay, the coverage check, choosing read-only operations |
| `pipeline/verify.mjs` | The live check |
| `build/` | Output. Not committed |

`tests/connector-demo.test.ts` in the main project tests the pieces in `pipeline/spec.mjs` and the demo app. The `connector-demo` job in `.github/workflows/ci.yml` runs the two routes above on every push.

## What this does not show

It is one small app with one kind of sign-in. It does not show a real third-party service, cookie-based sessions, GraphQL, streaming, or capture from a desktop or mobile app. The guide lists these, and what was measured of the reverse-engineering tool REA, under "What the demo proves, and what it does not".

Do not point the capture or the generated connector at an app you are not allowed to examine.
