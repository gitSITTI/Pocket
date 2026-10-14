---
id: example-release-pipeline
type: pipeline
title: "Example: Release pipeline"
summary: A sample pipeline entry describing stages, gates and rollback for a simple release flow.
tags:
  - example
  - ci
  - release
status: active
version: 1
created: 2026-10-14
updated: 2026-10-14
links:
  - example-code-review
  - example-config-change-outage
---

This is a made-up entry. It shows the shape of a `pipeline` entry, not real guidance.

## Stages

1. **Build:** compile and package from a clean checkout.
2. **Test:** unit and integration tests. Any failure stops the pipeline.
3. **Scan:** dependency and secret scanning. Findings above the agreed severity stop the pipeline.
4. **Stage:** deploy to a staging environment and run smoke tests.
5. **Release:** deploy to production gradually, watching error rates.

## Gates

- A change must have passed [[example-code-review]] before it enters the pipeline.
- Configuration changes follow the same pipeline as code. See [[example-config-change-outage]].

## Failure handling

- A failed stage never partially releases. The previous version stays live.
- Rollback is a single action that redeploys the last known good version.
- Every rollback gets a short written note of what happened.
