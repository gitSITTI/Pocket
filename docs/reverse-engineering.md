# Reverse engineering with Pocket

Pocket keeps what you learn. It does not analyze programs. For the analysis you can pair it with a separate MCP server such as [REA](https://github.com/morluto/rea) ("Reverse Engineer Anything", MIT license), which inspects native binaries, JavaScript and Electron apps, .NET assemblies and websites on your own machine, and attaches evidence and limitations to its results.

The two are ordinary MCP servers, so a client can run both. REA produces evidence. Pocket stores the conclusions once a person has approved them.

## Running both

Add REA next to Pocket in your client's MCP config. REA's own setup does this for supported clients (`npx rea-agents setup`, see its README). By hand it looks like this, using the command from REA's registry metadata:

```json
{
  "mcpServers": {
    "pocket": {
      "command": "npx",
      "args": ["-y", "pocket-bok"],
      "env": { "POCKET_CONFIG": "/absolute/path/to/my-knowledge/pocket.config.json" }
    },
    "rea": {
      "command": "npx",
      "args": ["-y", "rea-agents", "mcp"]
    }
  }
}
```

The `pocket-bok` line works once Pocket is published to npm; until then use the `node` form in the [README](../README.md#quickstart). Native analysis in REA needs Hopper, Ghidra or IDA installed separately.

## A workflow

1. **Ask Pocket first.** The agent runs `search` for the program or feature. If someone already worked it out, the answer is there with its evidence.
2. **Investigate with REA** if it is not, inside whatever you wrote down as allowed (see the first step of [the example process](../examples/content/process/example-reverse-engineering.md)).
3. **Propose the finding.** The agent calls `add_entry` with the conclusion, a `source` naming the artifact and version, and an `evidence` block with the task, the outcome and a link to its notes.
4. **Review it.** `pocket proposals show <id>` prints the source and evidence, labels the evidence as the proposer's claim, and lists anything that needs a closer look. Nothing is stored until you approve.

Keep the labels from the example process in the entry body: observed, derived, inferred, unknown. A finding that says only "inferred" is still useful if it says so.

### A type for findings

The built-in types fit lessons and processes. If you record many findings, add a type of your own to `pocket.config.json`:

```json
{
  "types": [
    {
      "name": "finding",
      "description": "A conclusion from analyzing a specific artifact, with the evidence behind it.",
      "requiredFields": ["artifact"]
    }
  ]
}
```

Entries of that type then need an `artifact` key, where you can put the name, version and SHA-256 of what was analyzed.

## Importing REA's skills

REA ships Agent Skills, instructions for an agent on how to use REA well. Pocket can import them as proposals:

```sh
git clone --depth 1 https://github.com/morluto/rea
pocket import skills rea/.agents/skills \
  --source https://github.com/morluto/rea --license MIT --tag reverse-engineering
```

This was run on 2026-10-14 against REA's three skills. All three imported as new draft proposals, with source, license and a SHA-256 of each `SKILL.md`. What to know before approving:

- **Only `SKILL.md` comes across.** REA's main skill points to files in a `references/` folder. Pocket reports that folder as not imported, and the links in the entry will not resolve.
- **The skill describes the REA version it shipped with.** Re-run the import after upgrading REA and Pocket proposes an update if the file changed.
- **Keep the notice.** MIT requires the copyright notice to travel with copies. The entry records the license and source. If you publish the entry in a public repository, include REA's license text too.
- **It only helps where REA is connected.** An agent without the REA tools cannot follow its instructions.

## Staying inside the rules

Reverse engineering can be restricted by license terms, contracts and law, and the rules differ by country and purpose. Pocket does not decide that for you. It gives you a place to write down what you are allowed to examine before you start, and to keep that note next to the findings.
