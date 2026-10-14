# Architecture

Pocket is a thin layer over a folder of Markdown files.

```
 MCP client (agent)                         a person
        |                                       |
   stdio (MCP)                             `pocket` CLI
        |                                       |
  src/server.ts --> src/mcp.ts            src/cli.ts
        |  read tools        \ write tools        |
        v                     v                    v
  src/kb.ts  <---------- src/proposals.ts  (approve / reject)
  load, layer, validate      |  pending proposals as JSON
        |                    v
  src/search.ts        proposals directory
        |
        v
  content layers: Markdown files in git (the source of truth)
```

## Modules

| File | Responsibility |
| --- | --- |
| `src/types.ts` | Entry and issue types, the default entry types |
| `src/schema.ts` | Frontmatter validation (zod) and the type registry |
| `src/frontmatter.ts` | Split and write Markdown with YAML frontmatter |
| `src/config.ts` | Find and validate configuration; merge custom types |
| `src/kb.ts` | Scan content layers, apply layering, collect validation issues, answer queries |
| `src/search.ts` | Dependency-free BM25 index with field weights |
| `src/proposals.ts` | Proposal store, proposing add/update, approving and rejecting |
| `src/review.ts` | The text a person reads when reviewing a proposal, and the prompts shown with it |
| `src/lint.ts` | Flags instruction-like text and hidden characters in entries |
| `src/sanitize.ts` | Detects hidden characters and makes them visible |
| `src/skills.ts` | Import and export of the Agent Skills format |
| `src/mcp.ts` | Defines the MCP tools, resources and prompts, and the change notifications |
| `src/server.ts` | Executable entry point for the MCP server (stdio) |
| `src/cli.ts` | Executable entry point for the human CLI |
| `src/index.ts` | Public API when using Pocket as a library |

## Decisions worth knowing

**Files in git are the source of truth.** There is no database to migrate or back up. History, review and blame come from git. The search index is rebuilt from the files and is never authoritative.

**The index rebuilds itself.** Each tool call checks file modification times and re-scans only if something changed. No restart is needed after you edit or approve an entry.

**Layers.** Content directories are listed least specific first. If two layers define the same id, the later one wins. Duplicate ids inside one layer are an error.

**Writes are proposals.** The server never writes an entry file. It writes a JSON proposal into a separate directory, and the CLI turns an approved proposal into an entry. That separation is what makes a read-only content mount possible. See [approval-flow.md](approval-flow.md).

**Optimistic concurrency.** Every entry has a `version`. An update proposal records the version it was based on, and approval fails if the entry has moved on.

**No native dependencies.** Search is a small in-memory BM25 implementation, so installing and running needs only Node. For very large knowledge bases, or semantic search, swap the index (see [extending.md](extending.md)).

**stdout is the protocol.** The server only logs to stderr.
