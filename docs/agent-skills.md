# Agent Skills

[Agent Skills](https://agentskills.io/specification) is an open format for packaging instructions an agent can load on demand: a folder with a `SKILL.md` file whose YAML frontmatter has a `name` and a `description`. Pocket can export its `skill` entries in that format and import skill folders as proposals.

Only `SKILL.md` is carried across. Pocket entries are single Markdown files, so `scripts/`, `references/` and `assets/` are not imported. That also means an import can never bring executable code into your knowledge base.

## Export

```sh
pocket export skills ./skills-out
```

Writes `./skills-out/<id>/SKILL.md` for every active `skill` entry. Other files already in those folders are left alone, and a `SKILL.md` that is a symbolic link is never overwritten.

| Option | Effect |
| --- | --- |
| `--status draft` | Export entries with this status instead of `active` |
| `--all` | Export every status |
| `--type process` | Export a different entry type |

How an entry maps onto the format:

| Pocket | `SKILL.md` |
| --- | --- |
| `id` | `name` (and the folder name) |
| `summary`, or the `description` field when one exists | `description` |
| `license` | `license` |
| `compatibility`, `allowed-tools`, `metadata` (extra fields) | The same fields |
| `title`, `tags`, `source` | `metadata.pocket-title`, `metadata.pocket-tags`, `metadata.pocket-source` |
| Body | Body |

The specification limits a name to 64 lowercase letters, digits and single hyphens, and a description to 1,024 characters. An entry that breaks these is skipped with the reason, and the command exits with an error. Pocket's own ID rule is looser (it allows `--` and a trailing hyphen), so rename such an entry before exporting it.

## Import

```sh
pocket import skills ./some-skills --source https://github.com/example/skills --license MIT
```

Pass a skill folder, or a folder that contains skill folders. Each skill becomes a **proposal**. Nothing reaches the knowledge base until a person approves it with `pocket proposals approve`.

`--source` is required: say where the skills came from. `--license` overrides the `license` in each file; without it, the file's own license is used, and the review screen says so when there is none. Other options: `--type`, `--tag a,b`, `--scope`, and `--dry-run` to check everything and create nothing.

What the import does:

- **Records provenance.** The proposal carries `source`, `license` and `sourceHash`, the SHA-256 of the `SKILL.md` as it was read. The hash covers `SKILL.md` only.
- **Starts as a draft.** Approve it with `--status active` once you are happy with it.
- **Keeps the full description.** A skill description can be 1,024 characters, but a Pocket summary is limited to 500. A longer description is kept whole in a `description` field and the summary is shortened; export uses the full text.
- **Names the entry.** The title is `metadata.pocket-title` if present, otherwise the first `# Heading` in the body, otherwise the name written as a sentence.
- **Handles existing entries.** If an entry with that id exists, the import proposes an update to its summary, body, source, license and extra fields. The title and tags you already set are kept. If nothing but the file hash would change, no proposal is created.
- **Reports what it left out.** Folders such as `scripts/` and any frontmatter keys outside the specification are listed as notes and ignored.

## What the reviewer sees

`pocket proposals show` points out the things that matter for skills:

- a missing source or license;
- `allowed-tools`, which pre-approves tools for whatever agent loads the skill;
- text in the description that reads like an instruction to an agent;
- hidden or control characters anywhere in the proposal, which are replaced with visible `\u{...}` markers.

See [approval-flow.md](approval-flow.md#what-the-reviewer-sees) for the full list.

## Limits

- Only ASCII names are supported, although the specification also allows other lowercase letters.
- `SKILL.md` files over 256 KiB, and ones that are symbolic links, are rejected.
- Pocket does not check that a skill works or that it is safe. Treat imported text like any other code or content from outside, and read it before approving.
