# Changelog

All notable changes are recorded here. The project follows [Semantic Versioning](https://semver.org/).

## Unreleased

- Building connectors: a guide ([docs/building-connectors.md](docs/building-connectors.md)) for turning an app's traffic, or an API description the vendor publishes, into an MCP connector; a runnable demo in `demos/connector-from-traffic` that records a web app in a browser, recovers an API description with mitmproxy2swagger, applies a reviewed overlay and a coverage check, generates a server with openapi-mcp-generator, and checks it with real MCP tool calls; a `connector-demo` CI job that runs it; and two example entries. The demo is not published to npm and adds no dependency to Pocket. It was run on one small app with one kind of sign-in: real third-party apps, cookie sessions, GraphQL, streaming and desktop or mobile capture are not covered, and the guide says so.
- Optional search by meaning: set `"semanticSearch": true` in the config and install `@huggingface/transformers` (an optional peer dependency; Pocket's own dependencies do not change). The `search` tool and `pocket search` then merge the word ranking with a ranking by meaning from a small local model, and each result says whether it matched by `keyword`, `meaning` or `both`. Vectors are cached in `.pocket/embeddings`. If the model cannot run, search falls back to keywords and says why in a `note`. New command: `pocket index`. Off by default; with it off nothing changes. No reranker yet. See [docs/semantic-search.md](docs/semantic-search.md). Closes #7.
- Added a roadmap and a list of open content sources with checked licenses.
- MCP Registry: `package.json` has `mcpName`, `repository` and a `pocket-bok` bin so `npx pocket-bok` starts the server; `server.json` describes the server and its environment variables; `scripts/registry-metadata.mjs` checks the two agree (and runs in the tests); `.github/workflows/publish.yml` publishes to npm and then the registry when a version tag is pushed. Nothing has been published yet. See [docs/publishing.md](docs/publishing.md). Part of #6.
- Reverse engineering: a guide to pairing Pocket with the REA MCP server and importing its skills ([docs/reverse-engineering.md](docs/reverse-engineering.md)), plus two example `process` entries, one for working out how a program does something and one for writing up a process you just finished.
- MCP resources and prompts: every entry is a resource at `pocket://entry/<id>` with `priority`, `lastModified` and `audience` annotations and id completion, and each active entry of a type in the new `promptTypes` config key (default `process`) is a prompt. The server tells clients when entries change on disk; `POCKET_WATCH_INTERVAL_MS` sets the check interval (`0` turns it off). See [docs/resources-and-prompts.md](docs/resources-and-prompts.md). Closes #5.
- Agent Skills: `pocket export skills <dir>` writes skill entries as `SKILL.md` folders, and `pocket import skills <dir> --source <where from>` turns skill folders into proposals. See [docs/agent-skills.md](docs/agent-skills.md). Closes #4.
- Provenance: entries accept `license` and `sourceHash` alongside `source`. `add_entry` and `update_entry` accept `license` and an `evidence` block (task, outcome, link). Closes #3.
- Review: `pocket proposals show` prints source, license, hash and evidence (labelled as the proposer's claim), and lists things to look at: a missing source or license, `allowed-tools`, instruction-like text, and changes to the title, summary, tags, source or license.
- Review output and `pocket proposals list` now replace control characters, zero-width characters, direction overrides and carriage returns with visible `\u{...}` markers, so proposed text cannot hide or rewrite what the reviewer sees.
- `pocket validate` warns about instruction-like text in titles, summaries and tags, and about hidden characters in any part of an entry. If you run `validate --strict` you may see new warnings.
- A `license` frontmatter key must now be a single piece of text. If you already used `license` for something else, such as a list, validation will report it.
- Denylist check: keeps private terms out of public repos. Runs as a pre-commit and commit-msg hook and as a CI job, reading terms from an untracked `.denylist` file or a `PUBLIC_DENYLIST` secret. Output never shows the matched text.
- CI runs the gitleaks release binary directly (pinned and checksum-verified) instead of the GitHub Action, so it needs no license key on organization accounts.

## 0.1.0

First release.

- MCP server with `search`, `get_entry`, `list_entries`, `list_types`, `validate`, `add_entry` and `update_entry`.
- Markdown entries with YAML frontmatter, a JSON Schema, and seven built-in entry types.
- Layered content directories with later layers overriding earlier ones.
- Human-approved writes: agents create proposals, `pocket proposals approve` applies them.
- `pocket` CLI: validate, list, search, show, types, init, and proposal review.
- Dependency-free BM25 search.
- Gitleaks config, pre-commit hook and CI job; Dockerfile and compose example; forkable content template.
