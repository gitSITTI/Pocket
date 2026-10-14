#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { KnowledgeBase } from "./kb.js";
import { createServer, watchForChanges } from "./mcp.js";
import { ProposalStore } from "./proposals.js";

// With stdio transport, stdout carries the protocol. Log to stderr only.
async function main(): Promise<void> {
  const config = loadConfig();
  const kb = new KnowledgeBase(config);
  const store = new ProposalStore(config.proposalsDir);
  const server = createServer(kb, store);
  await server.connect(new StdioServerTransport());

  // Tell clients when entries change on disk. POCKET_WATCH_INTERVAL_MS=0 turns this off.
  const interval = Number.parseInt(process.env.POCKET_WATCH_INTERVAL_MS ?? "5000", 10);
  if (Number.isFinite(interval) && interval > 0) watchForChanges(kb, server, interval);

  const issues = kb.issues();
  const errors = issues.filter((i) => i.level === "error").length;
  console.error(
    `pocket ready: ${kb.listEntries().length} entries, ${config.contentDirs.length} layer(s), ` +
      `${config.readOnly ? "read-only" : "writes become proposals"}` +
      (errors > 0 ? `, ${errors} validation error(s) (run \`pocket validate\`)` : ""),
  );
}

main().catch((error: unknown) => {
  console.error(`pocket failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
