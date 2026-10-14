import { readFileSync } from "node:fs";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, GetPromptRequestSchema, ListPromptsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DEFAULT_PROMPT_TYPES } from "./config.js";
import { serializeEntry } from "./frontmatter.js";
import { KnowledgeBase, summarize } from "./kb.js";
import { ProposalStore, evidenceSchema, proposeAdd, proposeUpdate, type ProposeResult } from "./proposals.js";
import { ENTRY_STATUSES, type Entry, type EntryStatus } from "./types.js";

/** Resources are addressed as pocket://entry/<id>. */
const ENTRY_URI = /^pocket:\/\/entry\/([a-z0-9][a-z0-9-]*)$/;

/** A hint to clients about how much context an entry deserves. Active knowledge matters most. */
const STATUS_PRIORITY: Record<EntryStatus, number> = { active: 0.8, draft: 0.3, deprecated: 0.1 };

// The MCP specification defines -32002 for a resource that does not exist; the SDK's ErrorCode enum has no name for it.
const RESOURCE_NOT_FOUND = -32002;

function entryUri(id: string): string {
  return `pocket://entry/${id}`;
}

function resourceFor(entry: Entry) {
  return {
    uri: entryUri(entry.id),
    name: entry.id,
    title: entry.title,
    description: entry.status === "active" ? entry.summary : `(${entry.status}) ${entry.summary}`,
    mimeType: "text/markdown",
    annotations: {
      audience: ["user" as const, "assistant" as const],
      priority: STATUS_PRIORITY[entry.status],
      ...(entry.updated !== undefined ? { lastModified: `${entry.updated}T00:00:00Z` } : {}),
    },
  };
}

/** Active entries of the configured prompt types. Drafts and deprecated entries are never offered as prompts. */
function promptEntries(kb: KnowledgeBase): Entry[] {
  const types = new Set(kb.config.promptTypes ?? DEFAULT_PROMPT_TYPES);
  return kb.listEntries({ status: "active" }).filter((entry) => types.has(entry.type));
}

function promptText(entry: Entry, context: string | undefined): string {
  const lines = [
    `Follow "${entry.title}" from the knowledge base (${entryUri(entry.id)}, version ${entry.version}).`,
    "",
    entry.body.trim(),
  ];
  if (context) lines.push("", "Apply it to this:", context);
  return lines.join("\n");
}

function packageVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

function proposalResult(result: ProposeResult) {
  if (!result.ok) return failure(`Proposal rejected:\n- ${result.errors.join("\n- ")}`);
  const { proposal } = result;
  return json({
    status: "pending_human_approval",
    proposalId: proposal.proposalId,
    action: proposal.action,
    entryId: proposal.entryId,
    scope: proposal.scope,
    note: "Nothing has changed yet. A human must approve this proposal with the `pocket` CLI before it becomes part of the knowledge base.",
  });
}

const statusField = z.enum(ENTRY_STATUSES);

/** Build the MCP server. Read tools are always on; write tools only propose changes. */
export function createServer(kb: KnowledgeBase, store: ProposalStore): McpServer {
  const server = new McpServer({ name: "pocket", version: packageVersion() });
  const readOnlyAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

  server.registerTool(
    "search",
    {
      title: "Search the body of knowledge",
      description:
        "Full-text search across all entries, best matches first. Titles and tags count more than body text. Narrow with type, tag, status or scope.",
      inputSchema: {
        query: z.string().min(1).describe("What to look for, in plain words."),
        type: z.string().optional().describe("Only this entry type. See list_types."),
        tag: z.string().optional().describe("Only entries carrying this tag."),
        status: statusField.optional().describe("Only entries with this status."),
        scope: z.string().optional().describe("Only entries from this content layer."),
        limit: z.number().int().min(1).max(50).default(10).describe("Maximum results."),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ query, type, tag, status, scope, limit }) => {
      const filter = {
        ...(type ? { type } : {}),
        ...(tag ? { tag } : {}),
        ...(status ? { status } : {}),
        ...(scope ? { scope } : {}),
      };
      const hits = kb.search(query, filter, limit);
      return json({
        count: hits.length,
        results: hits.map((hit) => ({
          ...summarize(hit.entry),
          score: Math.round(hit.score * 1000) / 1000,
          snippet: hit.snippet,
        })),
      });
    },
  );

  server.registerTool(
    "get_entry",
    {
      title: "Read one entry",
      description: "Return the full entry (metadata and Markdown body) for an id.",
      inputSchema: { id: z.string().min(1).describe("The entry id.") },
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => {
      const entry = kb.getEntry(id);
      if (!entry) return failure(`No entry with id "${id}". Try search or list_entries.`);
      return json({
        ...summarize(entry),
        created: entry.created,
        updated: entry.updated,
        links: entry.links,
        source: entry.source,
        license: entry.license,
        sourceHash: entry.sourceHash,
        extra: entry.extra,
        body: entry.body,
      });
    },
  );

  server.registerTool(
    "list_entries",
    {
      title: "List entries",
      description: "List entry summaries, optionally filtered. Bodies are not included; use get_entry for those.",
      inputSchema: {
        type: z.string().optional(),
        tag: z.string().optional(),
        status: statusField.optional(),
        scope: z.string().optional(),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ type, tag, status, scope }) => {
      const entries = kb.listEntries({
        ...(type ? { type } : {}),
        ...(tag ? { tag } : {}),
        ...(status ? { status } : {}),
        ...(scope ? { scope } : {}),
      });
      return json({ count: entries.length, entries: entries.map(summarize) });
    },
  );

  server.registerTool(
    "list_types",
    {
      title: "List entry types and scopes",
      description: "Describe the entry types in use, how many entries each has, and the content layers in precedence order.",
      inputSchema: {},
      annotations: readOnlyAnnotations,
    },
    async () => {
      const all = kb.listEntries();
      return json({
        types: kb.types.list().map((t) => ({
          name: t.name,
          description: t.description,
          requiredFields: t.requiredFields ?? [],
          entries: all.filter((e) => e.type === t.name).length,
        })),
        scopes: kb.scopes(),
        scopeNote: "Later scopes override earlier ones when they define the same id.",
        readOnly: kb.config.readOnly,
      });
    },
  );

  server.registerTool(
    "validate",
    {
      title: "Validate the knowledge base",
      description: "Report problems found in the content: invalid frontmatter, unknown types, duplicate ids, broken links.",
      inputSchema: { id: z.string().optional().describe("Only report problems for this entry id.") },
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => {
      const issues = kb.issues().filter((issue) => (id ? issue.id === id : true));
      return json({
        entries: kb.listEntries().length,
        errors: issues.filter((i) => i.level === "error").length,
        warnings: issues.filter((i) => i.level === "warning").length,
        issues,
      });
    },
  );

  // Resources: every entry, for clients that let a person pick context. Always read-only.
  server.registerResource(
    "entry",
    new ResourceTemplate("pocket://entry/{id}", {
      list: async () => ({ resources: kb.listEntries().map(resourceFor) }),
      complete: {
        id: (value) =>
          kb
            .listEntries()
            .map((entry) => entry.id)
            .filter((id) => id.startsWith(value))
            .slice(0, 100),
      },
    }),
    {
      title: "Pocket entry",
      description: "One entry from the body of knowledge: Markdown with its YAML frontmatter.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const match = ENTRY_URI.exec(uri.href);
      if (!match) throw new McpError(ErrorCode.InvalidParams, `Not a Pocket entry address: ${uri.href}`);
      const entry = kb.getEntry(match[1]!);
      if (!entry) throw new McpError(RESOURCE_NOT_FOUND, "Resource not found", { uri: uri.href });
      return {
        contents: [
          {
            uri: entryUri(entry.id),
            mimeType: "text/markdown",
            text: serializeEntry(entry, entry.body),
          },
        ],
      };
    },
  );

  // Prompts: active entries of the configured types, for clients that offer them as commands.
  // The list is computed on every request so it always matches the files on disk.
  server.server.registerCapabilities({ prompts: { listChanged: true } });
  server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: promptEntries(kb).map((entry) => ({
      name: entry.id,
      title: entry.title,
      description: entry.summary,
      arguments: [{ name: "context", description: "What you are applying this to, in your own words.", required: false }],
    })),
  }));
  server.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const entry = promptEntries(kb).find((candidate) => candidate.id === request.params.name);
    if (!entry) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt "${request.params.name}"`);
    const context = request.params.arguments?.context?.trim();
    return {
      description: entry.summary,
      messages: [{ role: "user" as const, content: { type: "text" as const, text: promptText(entry, context || undefined) } }],
    };
  });

  if (kb.config.readOnly) return server;

  const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

  server.registerTool(
    "add_entry",
    {
      title: "Propose a new entry",
      description:
        "Propose a new entry. This does NOT change the knowledge base: it creates a pending proposal that a human must approve. Give a clear rationale so the reviewer can decide quickly.",
      inputSchema: {
        id: z.string().describe("Lowercase letters, digits and hyphens, for example 'retry-with-backoff'."),
        type: z.string().describe("Entry type. See list_types."),
        title: z.string(),
        summary: z.string().describe("One or two sentences. Shown in search results."),
        body: z.string().describe("The entry content, in Markdown."),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional().describe("Ids of related entries."),
        status: statusField.optional().describe("Defaults to draft."),
        source: z.string().optional().describe("Where this knowledge came from: a URL, document or event."),
        license: z.string().optional().describe("The license the knowledge is available under, for example 'MIT' or 'CC-BY-4.0'. Say so when you copied it from somewhere."),
        extra: z.record(z.string(), z.unknown()).optional().describe("Additional frontmatter fields, such as those a type requires."),
        scope: z.string().optional().describe("Content layer to write to. Defaults to the most specific layer."),
        rationale: z.string().min(1).describe("Why this entry should be added."),
        evidence: evidenceSchema.optional().describe("What backs this up: the task, the outcome and a link to a trace or log. The reviewer sees it as your claim."),
        proposed_by: z.string().optional().describe("Who or what is proposing this, for the audit trail."),
      },
      annotations: writeAnnotations,
    },
    async (args) =>
      proposalResult(
        proposeAdd(kb, store, {
          id: args.id,
          type: args.type,
          title: args.title,
          summary: args.summary,
          body: args.body,
          rationale: args.rationale,
          ...(args.tags ? { tags: args.tags } : {}),
          ...(args.links ? { links: args.links } : {}),
          ...(args.status ? { status: args.status } : {}),
          ...(args.source ? { source: args.source } : {}),
          ...(args.license ? { license: args.license } : {}),
          ...(args.evidence ? { evidence: args.evidence } : {}),
          ...(args.extra ? { extra: args.extra } : {}),
          ...(args.scope ? { scope: args.scope } : {}),
          ...(args.proposed_by ? { proposedBy: args.proposed_by } : {}),
        }),
      ),
  );

  server.registerTool(
    "update_entry",
    {
      title: "Propose a change to an entry",
      description:
        "Propose changes to an existing entry. Only the fields you pass are changed. This does NOT change the knowledge base: it creates a pending proposal that a human must approve. Pass base_version (from get_entry) so a stale edit is rejected instead of overwriting newer work.",
      inputSchema: {
        id: z.string().describe("The entry to change."),
        base_version: z.number().int().positive().optional().describe("The version you read. Rejected if the entry has since changed."),
        title: z.string().optional(),
        summary: z.string().optional(),
        body: z.string().optional().describe("The complete new body, not a diff."),
        tags: z.array(z.string()).optional().describe("The complete new tag list."),
        links: z.array(z.string()).optional().describe("The complete new link list."),
        status: statusField.optional(),
        source: z.string().optional(),
        license: z.string().optional(),
        extra: z.record(z.string(), z.unknown()).optional(),
        scope: z.string().optional().describe("Write the result to this layer, creating an override if it differs from the current one."),
        rationale: z.string().min(1).describe("Why this change should be made."),
        evidence: evidenceSchema.optional().describe("What backs this change up: the task, the outcome and a link to a trace or log. The reviewer sees it as your claim."),
        proposed_by: z.string().optional(),
      },
      annotations: writeAnnotations,
    },
    async (args) =>
      proposalResult(
        proposeUpdate(kb, store, {
          id: args.id,
          rationale: args.rationale,
          ...(args.base_version !== undefined ? { baseVersion: args.base_version } : {}),
          ...(args.scope ? { scope: args.scope } : {}),
          ...(args.evidence ? { evidence: args.evidence } : {}),
          ...(args.proposed_by ? { proposedBy: args.proposed_by } : {}),
          patch: {
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(args.summary !== undefined ? { summary: args.summary } : {}),
            ...(args.body !== undefined ? { body: args.body } : {}),
            ...(args.tags !== undefined ? { tags: args.tags } : {}),
            ...(args.links !== undefined ? { links: args.links } : {}),
            ...(args.status !== undefined ? { status: args.status } : {}),
            ...(args.source !== undefined ? { source: args.source } : {}),
            ...(args.license !== undefined ? { license: args.license } : {}),
            ...(args.extra !== undefined ? { extra: args.extra } : {}),
          },
        }),
      ),
  );

  return server;
}

/**
 * Returns a function that tells connected clients the resource and prompt lists changed,
 * if the content on disk has changed since it last looked. Returns true when it notified.
 * Changes made by another process, such as `pocket proposals approve`, are picked up here.
 */
export function createChangeNotifier(kb: KnowledgeBase, server: McpServer): () => boolean {
  let seen = kb.generation;
  return () => {
    kb.refresh();
    if (kb.generation === seen) return false;
    seen = kb.generation;
    try {
      server.sendResourceListChanged();
      server.sendPromptListChanged();
    } catch (error) {
      console.error(`pocket: could not send a list-changed notification: ${(error as Error).message}`);
    }
    return true;
  };
}

/** Check for content changes every `intervalMs` milliseconds. Returns a function that stops the checks. */
export function watchForChanges(kb: KnowledgeBase, server: McpServer, intervalMs = 5000): () => void {
  const check = createChangeNotifier(kb, server);
  const timer = setInterval(() => {
    try {
      check();
    } catch (error) {
      console.error(`pocket: could not check for changes: ${(error as Error).message}`);
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
