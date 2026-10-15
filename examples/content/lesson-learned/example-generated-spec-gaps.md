---
id: example-generated-spec-gaps
type: lesson-learned
title: "Example: The generated API description left out query parameters"
summary: A sample lesson-learned entry about an API description generated from recorded traffic that missed two query parameters the traffic used, and the coverage check that caught it.
tags:
  - example
  - connector
  - openapi
status: active
version: 1
created: 2026-10-14
updated: 2026-10-14
links:
  - example-build-connector
---

This is a made-up entry about an invented app. It shows the shape of a `lesson-learned` entry. The behavior it describes was measured on the demo in the Pocket repository (`demos/connector-from-traffic`).

## What happened

An OpenAPI description was generated from a recording of a notes app. The paths, methods and response shapes were right. A connector built straight from it could list notes but could not page through them or filter by tag, because two query parameters, `cursor` and `tag`, were missing even though the recording used both.

## Why it happened

- The converter (mitmproxy2swagger 0.15.0, from reading its source) sets an endpoint's parameters once, from the first request it sees for that endpoint. Here that was `limit` alone; `cursor` and `tag` appeared only on later requests and were dropped.
- Nothing compared the description with the recording, so a gap looked the same as a complete result.
- The draft also had no security scheme, only path-based names such as "GET notes", and typed a value that is `null` on the last page as a string.

## What we changed

- A reviewed overlay file now adds parameters, the security scheme, names, descriptions and nullable types, and is applied again each time the draft is regenerated.
- A coverage check compares the recording with the final description and stops the build if a captured path, method or query parameter is missing.
- Following [[example-build-connector]], the connector is checked by paging to the last page and by filtering, against the running app.

## What to remember

A generated description is a draft. If the only check is that it parses, a connector can quietly do less than the app does. Compare it with what was recorded.
