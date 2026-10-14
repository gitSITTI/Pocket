---
id: example-writing-runbooks
type: skill
title: "Example: Writing a useful runbook"
summary: A sample skill entry on writing operational runbooks that people can follow under pressure.
tags:
  - example
  - documentation
status: draft
version: 1
created: 2026-10-14
updated: 2026-10-14
links:
  - example-config-change-outage
---

This is a made-up entry. It shows the shape of a `skill` entry, not real guidance.

## The idea

A runbook is read by someone tired, stressed and in a hurry. Write for that person.

## Practices

- Start with the symptom the reader sees, not the underlying cause.
- Give one action per step, and the expected result after it.
- Put the safest checks first and the risky actions last.
- State how to undo each risky action before describing the action.
- Say who to contact and when to stop and escalate.

## Check your work

Ask someone who did not write it to follow it on a practice run. Fix every place they hesitate.
Lessons from real incidents, such as [[example-config-change-outage]], belong back in the runbook.
