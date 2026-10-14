# Extending Pocket

Pocket is meant to be the base you build on. These are the usual ways to extend it, from easiest to most involved.

## Add your own entry types

No code needed. List them in the config file:

```json
{
  "types": [
    {
      "name": "runbook",
      "description": "Step-by-step operational procedure for a known situation.",
      "requiredFields": ["owner"]
    }
  ]
}
```

Then create entries with `type: runbook` and an `owner` field. `validate` reports entries that miss a required field, and `list_types` tells agents about the new type.

## Add custom checks

`pocket validate` and the `validate` tool report what `KnowledgeBase.issues()` found. To add your own rules (for example, "every contract needs a review date"), extend the scan in `src/kb.ts` where the other warnings are produced, or build your own wrapper using Pocket as a library (below).

## Add an MCP tool

Tools are defined in `src/mcp.ts` with `server.registerTool`. A read-only tool only needs the `KnowledgeBase`:

```ts
server.registerTool(
  "count_by_type",
  {
    title: "Count entries by type",
    description: "How many entries exist for each type.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const counts: Record<string, number> = {};
    for (const entry of kb.listEntries()) counts[entry.type] = (counts[entry.type] ?? 0) + 1;
    return { content: [{ type: "text", text: JSON.stringify(counts) }] };
  },
);
```

Rule for write-capable tools: they must go through the proposal store. Do not write entry files from the server. See [approval-flow.md](approval-flow.md).

## Swap the search backend

`KnowledgeBase` uses `SearchIndex` from `src/search.ts`. Anything with the same two members works:

- a constructor that takes the effective `Entry[]`
- `search(query, { limit, filter }): SearchHit[]`

Replace the class used in `kb.ts` with one backed by SQLite full-text search or an external service. The files stay the source of truth; the index is always rebuilt from them.

Search by meaning does not need a swap: it sits on top of the word index. Turn it on with `semanticSearch` in the config, or give `SemanticSearch` your own `Embedder`. See [semantic-search.md](semantic-search.md).

## Use Pocket as a library

```ts
import { loadConfig, KnowledgeBase, createServer, ProposalStore } from "pocket-bok";

const config = loadConfig({ configPath: "./pocket.config.json" });
const kb = new KnowledgeBase(config);
const store = new ProposalStore(config.proposalsDir);
const server = createServer(kb, store); // an McpServer, connect any transport you like
```

`src/index.ts` lists everything exported: configuration, the knowledge base, frontmatter helpers, the proposal functions, the search index and the schema pieces.

## Other transports

The bundled entry point uses stdio. To serve over HTTP, import `createServer` and connect one of the transports from `@modelcontextprotocol/sdk` instead. If you expose Pocket over a network, add authentication in front of it.

## Add content, not code

Most teams will mostly add entries. Use `pocket init <dir>` to create a content repo from the template, keep it separate from this repository, and point `POCKET_CONFIG` at it.
