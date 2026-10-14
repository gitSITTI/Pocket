---
id: example-process-audit
type: process
title: "Example: Write up a process you just finished"
summary: A sample process for reconstructing, after the fact, exactly how a piece of work was done so that a person or an agent can repeat it.
tags:
  - example
  - documentation
  - reverse-engineering
status: active
version: 1
created: 2026-10-14
updated: 2026-10-14
links:
  - example-reverse-engineering
---

This is a made-up entry. It shows the shape of a `process` entry, not real guidance.

A finished piece of work is easiest to reconstruct while you still remember it, so do this the same day. The idea is to reverse engineer your own process: start from what you ended up with and work out the steps that produced it.

## Purpose

Turn "I got it done" into something a newcomer, or an agent, can repeat without asking you.

## Steps

1. **Collect the trail.** Gather shell history, commit logs, chat transcripts, scratch files and the final outputs.
2. **Write the write-up in this order:**
   - The problem and who it was for.
   - The raw materials: inputs, formats, where they lived.
   - Every step in order, grouped into phases. For each step: what you did, why, and what came out.
   - Tools and versions.
   - Outputs produced, and where they are.
   - Who decided what. If an agent helped, say what it was asked to do and what a person checked.
   - Failures and how you recovered.
   - Quirks of the data or the tools that will catch the next person, listed with an identifier for each.
3. **Split the write-up into entries.** Repeatable steps become a `process` entry. Each failure worth remembering becomes a `lesson-learned`. Reusable code becomes a `script`.
4. **Propose them** to the knowledge base. Link the entries to each other and to the original write-up.

## Checks

- Could someone who was not there repeat the work using only the entries?
- Is every step something you actually did, not something you would do now?
- Is there anything private, such as names, account numbers or case details, that does not belong in a shared base?

See [[example-reverse-engineering]] for the same discipline applied to a program you did not write.
