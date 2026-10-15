---
id: example-build-connector
type: process
title: "Example: Build an MCP connector for an app from its traffic"
summary: A sample process for turning what an app sends over the network into a read-only MCP connector, with a review step and a check against the live app.
tags:
  - example
  - connector
  - mcp
  - reverse-engineering
status: active
version: 1
created: 2026-10-14
updated: 2026-10-14
links:
  - example-reverse-engineering
  - example-generated-spec-gaps
---

This is a made-up entry. It shows the shape of a `process` entry. The full guide, with commands, is `docs/building-connectors.md` in the Pocket repository.

## Purpose

Give an agent access to an app that has no ready-made connector, using only what the app already does for a signed-in person, and offer nothing that changes data until someone decides it should.

## Before you start

1. **Look for an official API or MCP server first.** If one exists, use it and stop here.
2. **Write down what you may examine**: your own account, the app's terms, local law. Follow [[example-reverse-engineering]] for this part.
3. **Write down what the connector may do.** Default: reads only.

## Steps

1. **Capture.** Use the app in a browser with DevTools open, covering every feature the connector needs, including paging, filters and a failed sign-in. Save the traffic as a HAR file. It holds tokens and personal data: keep it private.
2. **Draft the API description.** Convert the HAR to an OpenAPI file with a tool such as mitmproxy2swagger, in two passes. After the first pass, keep the endpoints that are the app's data and drop analytics and ads. Do not turn on the options that copy examples or headers.
3. **Review the draft.** It will be incomplete. Check query parameters, authentication, names and descriptions, and values that can be null. Put the fixes in an overlay file so they are applied again on every run. See [[example-generated-spec-gaps]].
4. **Check coverage.** Compare the capture with the final description and fail if a captured path, method or query parameter is missing.
5. **Choose what to offer.** Mark only the read operations. Leave sign-in out; the connector takes a token you already have.
6. **Generate and build** an MCP server from the description. Install its dependencies without running install scripts, and read the generated code before giving it a real token.
7. **Check it against the app** with your own account: each tool returns real data, paging ends, a bad id and an expired token give readable errors, nothing was changed, no extra requests were sent.
8. **Write it up.** Record the app version, the date, what the connector offers and what it does not, and what you could not check.

## Checks

- Was the connector built from traffic you were allowed to record?
- Does a test fail if the connector offers more than you intended?
- Does the token appear in the HAR you keep, in the connector's files or in any log?
- Is each statement about the app's behavior labelled observed or inferred?
