# Building a connector from an app

A connector here means an MCP server that lets an agent use an app: read a notebook, list orders, look up a ticket. This page is a recipe for building one when the app has no ready-made connector, starting from what you can observe of the app.

Pocket does not do the reverse engineering and does not generate the connector. It is the place the recipe and the findings live (see [Recording what you learn](#recording-what-you-learn)). The tools doing the work are separate, open-source programs. The repository has a [runnable demo](../demos/connector-from-traffic/README.md) that goes the whole way once, on a small app that ships with it, and checks the result with real MCP tool calls.

## Before you start

1. **Look for an official one first.** Search the vendor's developer documentation and the [MCP Registry](https://registry.modelcontextprotocol.io/) for an API, an OpenAPI file or an MCP server. An official connector will outlast anything recovered from traffic.
2. **Write down what you are allowed to examine.** Terms of service, contracts and local law can limit recording an app's traffic, calling its private endpoints, or automating an account. Use your own account, ideally a test one. If you are unsure, get a documented review first. See [Staying inside the rules](./reverse-engineering.md#staying-inside-the-rules).
3. **Decide what the connector may do.** Start with reads only. The recipe below makes that the default.

## Which starting point are you at?

| You have | Start at |
| --- | --- |
| The vendor publishes an OpenAPI/Swagger file | [Choose what to offer](#4-choose-what-to-offer), skipping steps 1 to 3 |
| A web app with no public API | [Step 1](#1-capture-the-traffic), recording in the browser |
| An Electron app | Usually a web app in a window: open its DevTools, or use REA to unpack it, then [Step 1](#1-capture-the-traffic) |
| A desktop or mobile app | [Native and mobile apps](#native-and-mobile-apps) first, then step 1 with a proxy |
| No particular app, you want to see it work | Run the [demo](../demos/connector-from-traffic/README.md) |

## The chain

```
traffic (HAR file) -> draft API description (OpenAPI) -> reviewed description -> MCP server -> checked against the app
        1                       2                                3                  4/5              6
```

Each step has a human decision in it. The demo's `pipeline/run.mjs` runs all of them in order, and keeps the decisions in two small files (`connector/decisions.json` and `connector/overlay.json`) so that running it again after the app changes applies them again.

### 1. Capture the traffic

Open the app in a browser, open DevTools, go to the Network tab, use the app the way a person would, then choose "Save all as HAR". Use every feature you want the connector to cover, including paging, filters and a failed sign-in, because the only things you can recover are the ones you recorded. Playwright's `recordHar` option does the same from a script; the demo's `capture/capture.mjs` shows how.

A HAR file contains your tokens, cookies and data. Keep it private and do not commit it. The demo commits one because every value in it is made up.

### 2. Turn the traffic into a draft API description

[mitmproxy2swagger](https://github.com/alufers/mitmproxy2swagger) (MIT) reads the HAR and writes an OpenAPI file. It runs twice:

```sh
mitmproxy2swagger -i app.har -f har -o spec.yaml -p https://app.example.com/api
```

The first pass only lists the endpoints it saw, each with an `ignore:` prefix. Open `spec.yaml`, delete the prefix on the ones you want, leave it on the rest (analytics beacons, ads), and turn repeated ids into placeholders such as `/notes/{id}`. The second pass, the same command, fills in parameters and response shapes for the endpoints you kept.

Leave the converter's `--examples` and `--headers` options off. They copy real values, including tokens, into the file.

### 3. Review the draft and fix what it gets wrong

The draft is a starting point. On the demo, the second pass got the paths, methods and response shapes right and still missed:

- **Query parameters.** `limit` was found, `tag` and `cursor` were not, although the capture used both. In version 0.15.0 the converter sets an endpoint's parameters once, from the first request it sees (`GET /notes?limit=3` here), so parameters that appear only on later requests are dropped. A connector built from this draft could not page or filter.
- **Authentication.** There is no security scheme, so the generated server would not send a token.
- **Names and descriptions.** Every operation was named after its path ("GET notes"), with no explanation. A model picks tools by those words.
- **Nullable values.** `next_cursor` is `null` on the last page, and the draft's type said string.

Put the corrections in an overlay file and merge it over the draft (the demo does this in `pipeline/spec.mjs`; the overlay is plain JSON, easy to review in a pull request). Then run a coverage check, which compares the capture with the final description and fails if a captured path, method or query parameter is missing. On the demo, it reports the two missing parameters before the overlay and nothing after. Write the check for your own app. It is the guard against shipping a connector that quietly does less than the app does.

### 4. Choose what to offer

Not every endpoint belongs in a connector. The generator the recipe uses offers an operation only if the description marks it `x-mcp: true` (the recipe runs it with `--default-include false`). Mark the reads. Leave sign-in out, so the connector takes a token you already have instead of handling your password, and leave writes out until you want them.

The demo's published-description route enforces this: `--expose getMe,listNotes` offers those operations, and anything that is not a `GET` is refused unless you also pass `--allow-writes`.

### 5. Generate the MCP server

[openapi-mcp-generator](https://github.com/harsha-iiiv/openapi-mcp-generator) (MIT) writes a TypeScript MCP server from the description:

```sh
openapi-mcp-generator -i spec.yaml -o connector -n my-connector \
  -b https://app.example.com/api -t stdio --default-include false
cd connector && npm install --ignore-scripts && npm run build
```

Use `--ignore-scripts` when installing generated code you have not read. Read it before you trust it with a real account: it is a small program that sends your token to the address you gave it.

The built server reads the address from `API_BASE_URL` and a bearer token from `BEARER_TOKEN_<SCHEME>`, where `<SCHEME>` is the security scheme's name in upper case with other characters replaced by `_` (a scheme called `sessionToken` becomes `BEARER_TOKEN_SESSIONTOKEN`). Put it in an MCP client like any other server:

```json
{
  "mcpServers": {
    "my-connector": {
      "command": "node",
      "args": ["/absolute/path/to/connector/build/index.js"],
      "env": {
        "API_BASE_URL": "https://app.example.com/api",
        "BEARER_TOKEN_SESSIONTOKEN": "paste a token from your own signed-in session"
      }
    }
  }
}
```

A token copied from a browser session expires and may be tied to your account. Treat it like a password.

### 6. Check it against the app

Start the connector and call every tool the way a client would. The demo's `pipeline/verify.mjs` uses the MCP SDK's client over stdio and checks ten things, among them that exactly the intended tools are offered, that paging returns every record once, that a missing record and a rejected token come back as errors, and that nothing was changed. For a real app, do these by hand with your own account:

- [ ] Each offered tool returns real data, not just a 200.
- [ ] Paging reaches the last page and stops; a filter narrows the list.
- [ ] A bad id and an expired token give an error you can read.
- [ ] Nothing was created, changed or deleted, and no extra requests (analytics, telemetry) were sent.
- [ ] The token appears in no log, no file in the connector folder and no committed file.
- [ ] The app's own rate limits are respected. Do not loop over every record to test.

## Native and mobile apps

For a program that is not a web page, you first have to find out how it talks to the network.

- **Look inside it.** [REA](https://github.com/morluto/rea) ("Reverse Engineer Anything", MIT) can inspect JavaScript and Electron bundles, .NET assemblies, native binaries and websites, and reports evidence with its limits. See [Reverse engineering with Pocket](./reverse-engineering.md) for running it next to Pocket.
- **Watch it.** Route the app's traffic through a proxy such as [mitmproxy](https://mitmproxy.org/) on a test device or machine, and save the flows. mitmproxy2swagger also reads mitmproxy's own dump files (`-f flow`).
- **Expect resistance.** Many mobile apps pin their server certificate, which makes a proxy see nothing useful. Getting around that can break the app's terms and, depending on where you are, the law. It is a stop-and-ask point, not a technical detail.

What was measured of REA, run on the demo's own web page (its source, not the live app): it listed the page's script, found the `fetch` calls with their source locations, and could not resolve the endpoint passed to a wrapper function, so that field stayed empty. It gives you where to look, not the finished list of endpoints. Its website tools drive a Chrome you start with remote debugging on; they were not run for this page. Native analysis needs Hopper, Ghidra or IDA, which were not available here.

## What the demo proves, and what it does not

Proven, by running it (and again on a clean copy, on every push, in the `connector-demo` CI job):

- A real browser used the demo app, and a HAR file was recorded from that session.
- The pipeline turned that file into a description, applied the review, passed the coverage check, generated an MCP server, built it, and the server answered real MCP tool calls against the running app.
- The same server comes out of the published-description route, from a hand-written OpenAPI file for the same API.
- The connector offers only the reads, and a test fails if it offers more.

Not proven:

- **A real third-party app.** The demo app is small, sends JSON and uses one bearer token. No real service was tried, because that needs an account and permission this project does not have.
- **Other kinds of authentication.** Cookie sessions, CSRF tokens, OAuth flows with redirects, signed requests and tokens that rotate are not covered. The generator has a `--custom-auth` option that was not tried.
- **Other shapes of traffic.** GraphQL, WebSockets, streaming responses, file uploads and gRPC are not covered. Several of these do not fit an OpenAPI description well.
- **Desktop and mobile capture.** The proxy route is described, not run.
- **Good error reporting.** The generated server returns an API error as text in a normal result; it does not set the MCP `isError` flag, so a client cannot tell an error from data by that flag. The demo checks the text.
- **Staying current.** Apps change. Re-run the capture and the pipeline, and let the coverage check tell you what moved. Nothing here watches for that.

## Recording what you learn

The recipe and the lessons from using it are ordinary Pocket entries, so an agent can find them before starting:

- `example-build-connector`: the steps above as a `process` entry.
- `example-generated-spec-gaps`: a `lesson-learned` entry about what the converter missed.
- `example-reverse-engineering`: the general process for working out how a program does something.

Findings about a specific app (its endpoints, how it pages, which token it uses, what you were allowed to do) belong in your own knowledge base, not in this public repository. If you record several, add a `finding` type as described in [Reverse engineering with Pocket](./reverse-engineering.md#a-type-for-findings).

## Tools used

| Tool | Version tried | License |
| --- | --- | --- |
| [mitmproxy2swagger](https://github.com/alufers/mitmproxy2swagger) | 0.15.0 | MIT |
| [openapi-mcp-generator](https://www.npmjs.com/package/openapi-mcp-generator) | 4.1.0 | MIT |
| [Playwright](https://playwright.dev/) (capture only) | 1.56.0 | Apache-2.0 |
| [REA](https://github.com/morluto/rea) (optional) | 6.5.0 | MIT |

None of them is a dependency of `pocket-bok`. The demo's own `package.json` pins the generator and is not published to npm.
