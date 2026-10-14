---
id: example-config-change-outage
type: lesson-learned
title: "Example: An unreviewed config change caused an outage"
summary: A sample lesson-learned entry about a fictional outage caused by a configuration change that skipped review.
tags:
  - example
  - incident
  - configuration
status: active
version: 1
created: 2026-10-14
updated: 2026-10-14
links:
  - example-release-pipeline
  - example-writing-runbooks
---

This is a made-up entry about an invented incident. It shows the shape of a `lesson-learned` entry.

## What happened

A timeout value in a shared configuration file was changed directly in production. The new value was too low, and requests began failing within minutes.

## Why it happened

- Configuration changes were not going through the same checks as code.
- There was no staging step where the effect could be seen first.
- The runbook did not mention how to roll back a configuration change.

## What we changed

- Configuration now ships through [[example-release-pipeline]].
- The rollback steps were added to the runbook, following [[example-writing-runbooks]].
- Risky settings now have documented safe ranges.

## What to remember

If a change can take the system down, it deserves the same review and rollout as code.
