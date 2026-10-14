# Pocket

**Pocket Body of Knowledge**: an MCP server that gives AI agents (and people) a shared, searchable body of knowledge made of plain Markdown files in git.

- **Files are the source of truth.** Entries are Markdown with a little YAML. They diff, review and merge like code.
- **Agents propose, humans approve.** The server can search and read freely, but every change an agent suggests waits for a person to approve it.
- **Layered.** Keep global knowledge and project knowledge in separate folders; the more specific layer wins.
- **Small base, easy to extend.** No database, no native dependencies. Add your own entry types, tools or search backend.

## Quickstart

You need Node 22.12 or newer. From the repository root:

```sh
npm ci
npm run build

# Try it on the bundled examples
POCKET_CONTENT_DIR=examples/content node dist/cli.js search retry
POCKET_CONTENT_DIR=examples/content node dist/cli.js validate
```

Make your own content repo from the template, and put your knowledge there (not in this repo):

```sh
node dist/cli.js init ../my-knowledge
```

Connect an MCP client. Most clients accept a config like this:

```json
{
  "mcpServers": {
    "pocket": {
      "command": "node",
      "args": ["/absolute/path/to/Pocket/dist/server.js"],
      "env": { "POCKET_CONFIG": "/absolute/path/to/my-knowledge/pocket.config.json" }
    }
  }
}
```

Run `npm link` if you want the `pocket` command on your PATH. Docker works too; see [docs/configuration.md](docs/configuration.md).

## What agents can do

| Tool | What it does |
| --- | --- |
| `search` | Ranked full-text search, filterable by type, tag, status and layer |
| `get_entry` | Read one entry in full |
| `list_entries` | List summaries, optionally filtered |
| `list_types` | Describe entry types, counts and layers |
| `validate` | Report invalid or inconsistent content |
| `add_entry` | Propose a new entry (needs human approval) |
| `update_entry` | Propose a change to an entry (needs human approval) |

Set `POCKET_READ_ONLY=1` and the two write tools are not offered at all.

Every entry is also an MCP resource (`pocket://entry/<id>`) that a person can attach from the client, and each active `process` entry is a prompt (a slash command). Clients are told when entries change. See [docs/resources-and-prompts.md](docs/resources-and-prompts.md).

Proposals can carry a `source`, a `license` and `evidence` (the task, the outcome and a link to a trace). The review screen shows them, labels evidence as the proposer's claim, and flags anything that deserves a closer look.

## What an entry looks like

```markdown
---
id: retry-with-backoff
type: script
title: Retry a command with exponential backoff
summary: A small shell function that retries a flaky command.
tags: [shell, reliability]
status: active
version: 1
links: [release-pipeline]
---

The body, in Markdown. Refer to other entries with [[release-pipeline]].
```

Optional fields record where content came from: `source`, `license` (for example `CC-BY-4.0`) and `sourceHash`.

Built-in types: `library`, `process`, `skill`, `script`, `pipeline`, `contract`, `lesson-learned`. Add your own in the config file. The frontmatter rules are published as [schema/entry.schema.json](schema/entry.schema.json) for editor support.

## How changes get in

1. An agent calls `add_entry` or `update_entry`. Pocket writes a proposal file and changes nothing else.
2. A person reviews it: `pocket proposals list`, then `pocket proposals show <id>`.
3. `pocket proposals approve <id>` writes the entry file. Commit it like any other change.

If someone edited the entry in the meantime, the proposal is rejected as stale instead of overwriting their work. For a hard guarantee, mount your content read-only for the server. Details in [docs/approval-flow.md](docs/approval-flow.md).

## Documentation

- [Architecture](docs/architecture.md): how the pieces fit together
- [Configuration](docs/configuration.md): config file, environment variables, layers, Docker
- [Approval flow](docs/approval-flow.md): proposals, review, and what is and is not guaranteed
- [Agent Skills](docs/agent-skills.md): export skill entries and import skill folders as proposals
- [Resources and prompts](docs/resources-and-prompts.md): entries as attachable resources and playbooks as slash commands
- [Extending Pocket](docs/extending.md): new types, tools, search backends, using it as a library
- [Secret scanning for all your repos](docs/gitleaks-for-all-repos.md)
- [Publishing](docs/publishing.md): npm and the MCP Registry
- [Reverse engineering](docs/reverse-engineering.md): pairing Pocket with REA, and importing its skills
- [Content sources](docs/content-sources.md): open material worth importing, with licenses
- [Roadmap](ROADMAP.md): what may come next, and why

## Security

Secret scanning with gitleaks runs before commits and in CI, and an optional denylist check keeps private names out of public repos. See [SECURITY.md](SECURITY.md) to report a vulnerability and for what the approval model does and does not protect against.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
