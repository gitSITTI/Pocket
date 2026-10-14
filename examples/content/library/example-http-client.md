---
id: example-http-client
type: library
title: "Example: Choosing an HTTP client library"
summary: A sample library entry showing what to record when a team standardizes on one HTTP client.
tags:
  - example
  - http
status: active
version: 1
created: 2026-10-14
updated: 2026-10-14
links:
  - example-retry-with-backoff
---

This is a made-up entry. It shows the shape of a `library` entry, not real guidance.

## What it is for

Make outbound HTTP requests from services, with timeouts and retries handled in one place.

## Why we chose it

- One client across all services means one place to set timeouts, headers and tracing.
- It supports connection reuse, which keeps latency down under load.
- It is actively maintained and its license is compatible with our projects.

## How we use it

- Always set a request timeout. A missing timeout is a bug.
- Wrap calls with the retry approach in [[example-retry-with-backoff]] for idempotent requests only.
- Never log request bodies or authorization headers.

## When not to use it

Streaming very large files, where a dedicated transfer tool is a better fit.
