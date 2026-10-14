---
id: example-api-versioning-policy
type: contract
title: "Example: API versioning policy"
summary: A sample contract entry stating what an API provider promises its consumers about changes.
tags:
  - example
  - api
status: active
version: 1
created: 2026-10-14
updated: 2026-10-14
links: []
---

This is a made-up entry. It shows the shape of a `contract` entry, not real guidance.

## Parties

The team that provides the API (the provider) and the teams that call it (the consumers).

## Provider commitments

- Breaking changes only ship in a new major version.
- A deprecated version stays available for at least six months after the announcement.
- Deprecations are announced in the changelog and by direct message to known consumers.

## Consumer commitments

- Pin to a major version and do not rely on undocumented behavior.
- Move off a deprecated version before its end date.

## What counts as breaking

Removing or renaming a field, changing a field's type or meaning, tightening validation, or changing error codes.
