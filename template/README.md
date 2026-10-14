# My body of knowledge

This repository holds knowledge entries for use with pocket, a Body of Knowledge MCP server.
Entries are plain Markdown files with a little YAML at the top, so they diff, review and merge like code.

## Layout

```
content/
  library/         reusable libraries and tools
  process/         repeatable ways of working
  skill/           techniques and capabilities
  script/          runnable scripts and snippets
  pipeline/        automated flows
  contract/        agreements, interfaces, standards
  lesson-learned/  what happened and what to do next time
pocket.config.json    tells pocket where the content is
```

## Use it

1. `git init` and run `sh scripts/setup-hooks.sh` to turn on secret scanning before commits.
2. Add an entry, for example `content/process/my-first-process.md`:

   ```markdown
   ---
   id: my-first-process
   type: process
   title: My first process
   summary: One or two sentences that say what this is.
   tags: [example]
   status: draft
   ---

   The body, in Markdown.
   ```

3. Run `pocket validate --strict` to check your entries.
4. Point your MCP client at the server with `POCKET_CONFIG` set to this repo's `pocket.config.json`.

## How changes get in

Agents can only propose changes. A proposal waits in `.pocket/proposals/` until a person runs
`pocket proposals approve <id>`, which writes the entry file. Review the result with `git diff` and commit it.

For the strongest guarantee, run the server with this repo's `content/` mounted read-only.

## Keep secrets out

This repo is set up with gitleaks (config, pre-commit hook and a GitHub Action). Never put credentials,
personal data or confidential material in an entry.
