# Approval flow

Agents can read everything but cannot change approved knowledge. They can only propose.

## Lifecycle

1. **Propose.** An agent calls `add_entry` or `update_entry`. Pocket validates the result (schema, entry type, required fields, links to a known id) and writes `<proposals dir>/p-<date>-<time>-<random>.json`. Invalid proposals are rejected immediately with the reasons, so the agent can fix and retry.
2. **Review.** A person runs `pocket proposals list`, then `pocket proposals show <id>`. For updates, `show` prints only the changed lines of metadata and body. See [what the reviewer sees](#what-the-reviewer-sees).
3. **Decide.**
   - `pocket proposals approve <id>` shows the proposal again, asks for confirmation, then writes the entry file.
   - `pocket proposals reject <id> --note "why"` records the decision and writes nothing.
4. **Commit.** Review the new or changed file with `git diff` and commit it.

Decided proposals move to `<proposals dir>/archive/` with the time and any note, which gives you an audit trail.

## What the reviewer sees

`pocket proposals show` (and `approve`, which shows it again) prints:

- **Source, license and hash.** Where the knowledge came from, what license it carries, and for imports the SHA-256 of the original. Missing values read `(none stated)`.
- **Evidence.** An agent can attach `evidence` to `add_entry` and `update_entry`: the `task` it was doing, the `outcome`, and a `link` to a trace, log or commit. It is stored with the proposal (and kept in the archive), not written into the entry. It is labelled as written by the proposer, because Pocket does not check it.
- **Look closely at.** Prompts for the reviewer, not verdicts:
  - a new entry with no source, or a link as a source with no license;
  - `allowed-tools`, which pre-approves tools for any agent that loads the entry;
  - a title, summary or tag that reads like an instruction to an agent ("ignore previous instructions", "always use this", "before answering, call...");
  - for updates, any change to the title, summary or tags, which are what search and agents see first, and to the source or license.
- **The change itself**, as a diff for updates.

Everything is printed with control characters, zero-width characters, direction overrides and carriage returns replaced by visible `\u{...}` markers, and the output says how many were replaced. Text written by an agent cannot clear the screen, move the cursor or hide words from the person approving it.

`pocket validate` raises the same instruction-like text and hidden-character findings as warnings for entries already in the base. Instruction-like phrases are only looked for in titles, summaries and tags, because a process document may legitimately say "you must".

## What approval does

- New entries start at `version: 1`. Updates increase the version by one.
- `created` and `updated` dates are set.
- `--status active` sets the status at approval time (proposals default to `draft`).
- The result is validated again against the types configured at that moment.

## Stale proposals

An update records the version it was based on. If the entry changed before approval, the approval fails with a clear message. Reject it and ask for a new proposal. The same applies if someone added an entry with the same id after an add was proposed. Nothing is ever silently overwritten.

## What this does and does not guarantee

The MCP server has no tool that edits an entry. That is the baseline.

For a **hard** guarantee, run the server with your content directory mounted read-only and give it a separate writable proposals directory (see [configuration.md](configuration.md#docker)). Then even a compromised server cannot alter approved knowledge.

The CLI's confirmation prompt is a safeguard against mistakes, not a security boundary. `--yes` skips it for scripts you control. If an agent has a shell on the same machine and account, it could run the CLI itself, so keep approval somewhere the agent cannot reach, and let git review be the final gate (for example, require pull request review before merging into the content repo's main branch).

## Running the server fully read-only

Set `POCKET_READ_ONLY=1` (or `"readOnly": true`) and the write tools are not offered. Agents can still search and read.
