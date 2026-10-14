# Configuration

## The config file

Pocket looks for a config file in this order:

1. the path in `POCKET_CONFIG` (it is an error if that file does not exist)
2. `./pocket.config.json` in the working directory

If neither exists, Pocket uses a single layer: the directory in `POCKET_CONTENT_DIR`, or `./content`.

```json
{
  "contentDirs": [
    { "scope": "global", "path": "./content/global" },
    { "scope": "project", "path": "./content/project" }
  ],
  "proposalsDir": "./.pocket/proposals",
  "readOnly": false,
  "promptTypes": ["process"],
  "types": [
    {
      "name": "runbook",
      "description": "Step-by-step operational procedure for a known situation.",
      "requiredFields": ["owner"]
    }
  ]
}
```

Relative paths are resolved from the folder containing the config file.

| Field | Meaning |
| --- | --- |
| `contentDirs` | Layers, least specific first. Each has a `scope` name (lowercase letters, digits, hyphens) and a `path`. At least one is required. |
| `proposalsDir` | Where proposals are written. Default `.pocket/proposals`. |
| `readOnly` | When true, `add_entry` and `update_entry` are not offered. |
| `promptTypes` | Entry types offered as MCP prompts (slash commands), active entries only. Default `["process"]`. See [resources-and-prompts.md](resources-and-prompts.md). |
| `types` | Extra entry types, or overrides of built-in ones. `requiredFields` lists frontmatter keys that must be present for that type. |

## Layers

Later layers override earlier ones when they define the same entry id. A typical setup is `global` (shared across everything) and `project` (specific to one project). `list_types` reports the layers in order. New proposals are written to the most specific layer unless a scope is given.

## Environment variables

| Variable | Effect |
| --- | --- |
| `POCKET_CONFIG` | Path to the config file |
| `POCKET_CONTENT_DIR` | Single content directory, used only when there is no config file |
| `POCKET_PROPOSALS_DIR` | Overrides the proposals directory |
| `POCKET_READ_ONLY` | Set to `1` to disable the write tools |
| `POCKET_WATCH_INTERVAL_MS` | How often the server checks for changed entries to tell clients (default `5000`, `0` turns it off) |

See `.env.example`. Never commit a real `.env` file.

## Docker

```sh
docker build -t pocket .
docker run -i --rm \
  -v /path/to/my-knowledge/content:/data/content:ro \
  -v /path/to/proposals:/data/proposals \
  pocket
```

The content mount is read-only, so the server cannot change approved knowledge. Proposals go to a separate writable folder, which you review from the host with the `pocket` CLI pointed at the same proposals directory. The container runs as the unprivileged `node` user, so the proposals folder must be writable by it.

`compose.yaml` shows the same setup against the bundled examples.

## Extra frontmatter

Keys other than the standard ones are kept and written back unchanged. Use them for fields a custom type requires, such as `owner`.
