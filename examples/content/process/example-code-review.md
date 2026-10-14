---
id: example-code-review
type: process
title: "Example: Code review"
summary: A sample process entry describing a lightweight, repeatable code review.
tags:
  - example
  - review
status: active
version: 1
created: 2026-10-14
updated: 2026-10-14
links:
  - example-release-pipeline
---

This is a made-up entry. It shows the shape of a `process` entry, not real guidance.

## Purpose

Catch defects and share knowledge before a change reaches the main branch.

## Roles

- **Author:** keeps the change small and explains the intent.
- **Reviewer:** checks correctness, clarity and risk, and responds within one working day.

## Steps

1. Author opens a pull request with a short description and how it was tested.
2. Automated checks run. A failing check blocks review.
3. Reviewer reads the description first, then the change.
4. Reviewer marks each comment as blocking or optional.
5. Author resolves blocking comments. Reviewer approves.
6. Author merges. The change flows through [[example-release-pipeline]].

## Checks

- Is there a test that would fail without this change?
- Could this fail in production in a way the tests cannot see?
- Is anything secret or personal in the diff?
