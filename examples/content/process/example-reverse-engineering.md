---
id: example-reverse-engineering
type: process
title: "Example: Reverse engineer a feature from a program you have"
summary: A sample process for working out how a shipped program does something, keeping what you saw apart from what you guessed.
tags:
  - example
  - reverse-engineering
  - security
status: active
version: 1
created: 2026-10-14
updated: 2026-10-14
links:
  - example-process-audit
---

This is a made-up entry. It shows the shape of a `process` entry. It is not legal advice or complete guidance.

## Purpose

Work out how one feature of a program you already have works, without its source code, and leave a record that someone else can check.

## Before you start

1. **Write down what you are allowed to examine.** Your own software, software you are licensed to analyze, open source, and approved security research are different situations. Terms of service, license agreements and local law can limit analysis, copying and getting around protections. If you are not sure, stop and get a documented review first.
2. **Write the question in one sentence**, and what would count as an answer. For example: "How does the export feature choose a file format?"
3. **Work on a copy.** Record the file name, version, size and SHA-256 so each finding ties to exactly what you looked at.

## Steps

1. **Inventory.** List what is in the package: files, libraries, resources, embedded strings. Nothing needs to run for this.
2. **Find the entry points.** Look for the code or resource that handles the feature: text shown in the interface, command names, endpoints, configuration keys.
3. **Read statically.** Follow the path from the entry point to the behavior. Decompiler output is an estimate of the original code, not the code itself.
4. **Observe at runtime only if you are allowed to.** Use an isolated machine and test data. Watch what the program reads, writes and sends.
5. **Label each finding** (see below) and note where you found it.
6. **Answer the question**, with how sure you are and what would change your mind.
7. **Write it down and propose it** to the knowledge base, with the artifact hash and a link to your notes as evidence.

## Labels for findings

- **Observed:** you saw it directly, such as a string at a known location or a request on the wire.
- **Derived:** it follows mechanically from observations, such as a decoded value.
- **Inferred:** a reasonable guess that fits what you saw, such as "this looks like a retry loop".
- **Unknown:** you have not established it.

## Checks

- Could someone repeat each observed finding from your recorded hashes and steps?
- Does any statement about how it works rest only on inference? Is it labelled that way?
- Did the work stay inside what you wrote down as allowed?
- Did your notes leave out secrets and personal data found along the way?

The labels are borrowed from how the open-source [REA](https://github.com/morluto/rea) project (MIT) describes evidence. See also [[example-process-audit]] for writing the work up afterwards.
