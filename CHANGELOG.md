# Changelog

All notable changes are recorded here. The project follows [Semantic Versioning](https://semver.org/).

## 0.1.0

First release.

- MCP server with `search`, `get_entry`, `list_entries`, `list_types`, `validate`, `add_entry` and `update_entry`.
- Markdown entries with YAML frontmatter, a JSON Schema, and seven built-in entry types.
- Layered content directories with later layers overriding earlier ones.
- Human-approved writes: agents create proposals, `pocket proposals approve` applies them.
- `pocket` CLI: validate, list, search, show, types, init, and proposal review.
- Dependency-free BM25 search.
- Gitleaks config, pre-commit hook and CI job; Dockerfile and compose example; forkable content template.
