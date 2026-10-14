# Changelog

All notable changes are recorded here. The project follows [Semantic Versioning](https://semver.org/).

## Unreleased

- Added a roadmap and a list of open content sources with checked licenses.
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
