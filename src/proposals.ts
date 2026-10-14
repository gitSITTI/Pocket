import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { serializeEntry } from "./frontmatter.js";
import type { KnowledgeBase } from "./kb.js";
import { parseMeta } from "./schema.js";
import type { EntryMeta, EntryStatus } from "./types.js";

export type ProposalState = "pending" | "approved" | "rejected";

export interface Proposal {
  proposalId: string;
  action: "add" | "update";
  entryId: string;
  /** The content layer the entry will be written to when approved. */
  scope: string;
  proposedBy: string;
  rationale: string;
  createdAt: string;
  /** For updates: the entry version this change was based on. */
  baseVersion?: number;
  state: ProposalState;
  decidedAt?: string;
  decisionNote?: string;
  entry: { meta: EntryMeta; body: string };
}

const PROPOSAL_ID = /^p-\d{8}-\d{6}-[0-9a-f]{6}$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function newProposalId(): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `p-${stamp.slice(0, 8)}-${stamp.slice(8, 14)}-${randomBytes(3).toString("hex")}`;
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, path);
}

/** Pending proposals live as JSON files in one directory; decided ones move to archive/. */
export class ProposalStore {
  constructor(readonly dir: string) {}

  create(input: Omit<Proposal, "proposalId" | "createdAt" | "state">): Proposal {
    const proposal: Proposal = {
      ...input,
      proposalId: newProposalId(),
      createdAt: new Date().toISOString(),
      state: "pending",
    };
    atomicWrite(join(this.dir, `${proposal.proposalId}.json`), `${JSON.stringify(proposal, null, 2)}\n`);
    return proposal;
  }

  /** Pending proposals, oldest first. */
  list(): Proposal[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => JSON.parse(readFileSync(join(this.dir, name), "utf8")) as Proposal)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(proposalId: string): Proposal {
    if (!PROPOSAL_ID.test(proposalId)) throw new Error(`Not a valid proposal id: ${proposalId}`);
    for (const path of [join(this.dir, `${proposalId}.json`), join(this.dir, "archive", `${proposalId}.json`)]) {
      if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as Proposal;
    }
    throw new Error(`No proposal found with id ${proposalId}`);
  }

  /** Record a decision and move the proposal out of the pending list. */
  archive(proposal: Proposal): void {
    atomicWrite(join(this.dir, "archive", `${proposal.proposalId}.json`), `${JSON.stringify(proposal, null, 2)}\n`);
    const pending = join(this.dir, `${proposal.proposalId}.json`);
    if (existsSync(pending)) unlinkSync(pending);
  }
}

export type ProposeResult = { ok: true; proposal: Proposal } | { ok: false; errors: string[] };

export interface ProposeAddInput {
  id: string;
  type: string;
  title: string;
  summary: string;
  body: string;
  tags?: string[];
  links?: string[];
  status?: EntryStatus;
  source?: string;
  extra?: Record<string, unknown>;
  scope?: string;
  rationale: string;
  proposedBy?: string;
}

export function proposeAdd(kb: KnowledgeBase, store: ProposalStore, input: ProposeAddInput): ProposeResult {
  const scope = input.scope ?? kb.scopes().at(-1)!;
  if (!kb.layer(scope)) return { ok: false, errors: [`scope: unknown scope "${scope}" (known: ${kb.scopes().join(", ")})`] };
  if (kb.getEntry(input.id)) {
    return { ok: false, errors: [`id: "${input.id}" already exists. Use update_entry to change it.`] };
  }
  if (input.body.trim() === "") return { ok: false, errors: ["body: must not be empty"] };

  const parsed = parseMeta(
    {
      id: input.id,
      type: input.type,
      title: input.title,
      summary: input.summary,
      tags: input.tags ?? [],
      links: input.links ?? [],
      status: input.status ?? "draft",
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.extra ?? {}),
    },
    kb.types,
  );
  if (!parsed.ok) return parsed;

  const proposal = store.create({
    action: "add",
    entryId: input.id,
    scope,
    proposedBy: input.proposedBy ?? "unknown",
    rationale: input.rationale,
    entry: { meta: parsed.meta, body: input.body.trim() },
  });
  return { ok: true, proposal };
}

export interface ProposeUpdateInput {
  id: string;
  /** The version the caller last read. Rejected if the entry has moved on. */
  baseVersion?: number;
  patch: {
    title?: string;
    summary?: string;
    body?: string;
    tags?: string[];
    links?: string[];
    status?: EntryStatus;
    source?: string;
    extra?: Record<string, unknown>;
  };
  scope?: string;
  rationale: string;
  proposedBy?: string;
}

export function proposeUpdate(kb: KnowledgeBase, store: ProposalStore, input: ProposeUpdateInput): ProposeResult {
  const current = kb.getEntry(input.id);
  if (!current) return { ok: false, errors: [`id: no entry with id "${input.id}"`] };
  if (input.baseVersion !== undefined && input.baseVersion !== current.version) {
    return {
      ok: false,
      errors: [`base_version: entry is at version ${current.version}, not ${input.baseVersion}. Re-read it and try again.`],
    };
  }
  const scope = input.scope ?? current.scope;
  if (!kb.layer(scope)) return { ok: false, errors: [`scope: unknown scope "${scope}" (known: ${kb.scopes().join(", ")})`] };

  const { patch } = input;
  const raw = {
    id: current.id,
    type: current.type,
    title: patch.title ?? current.title,
    summary: patch.summary ?? current.summary,
    tags: patch.tags ?? current.tags,
    links: patch.links ?? current.links,
    status: patch.status ?? current.status,
    version: current.version,
    ...(current.created !== undefined ? { created: current.created } : {}),
    ...(current.updated !== undefined ? { updated: current.updated } : {}),
    ...((patch.source ?? current.source) !== undefined ? { source: patch.source ?? current.source } : {}),
    ...current.extra,
    ...(patch.extra ?? {}),
  };
  const parsed = parseMeta(raw, kb.types);
  if (!parsed.ok) return parsed;

  const body = (patch.body ?? current.body).trim();
  if (body === "") return { ok: false, errors: ["body: must not be empty"] };

  const unchanged =
    serializeEntry(parsed.meta, body) === serializeEntry(current, current.body) && scope === current.scope;
  if (unchanged) return { ok: false, errors: ["patch: no changes compared with the current entry"] };

  const proposal = store.create({
    action: "update",
    entryId: current.id,
    scope,
    proposedBy: input.proposedBy ?? "unknown",
    rationale: input.rationale,
    baseVersion: current.version,
    entry: { meta: parsed.meta, body },
  });
  return { ok: true, proposal };
}

export interface ApproveOptions {
  /** Override the status written to the entry (for example "active"). */
  status?: EntryStatus;
  note?: string;
}

export interface ApproveResult {
  path: string;
  version: number;
}

/**
 * Apply a pending proposal: write the entry file into its content layer and
 * archive the proposal. Called by the `pocket` CLI, never exposed as an MCP tool.
 */
export function approveProposal(
  kb: KnowledgeBase,
  store: ProposalStore,
  proposalId: string,
  options: ApproveOptions = {},
): ApproveResult {
  kb.refresh(true);
  const proposal = store.get(proposalId);
  if (proposal.state !== "pending") throw new Error(`Proposal ${proposalId} was already ${proposal.state}`);

  const layer = kb.layer(proposal.scope);
  if (!layer) throw new Error(`Scope "${proposal.scope}" is not configured`);

  const current = kb.getEntry(proposal.entryId);
  if (proposal.action === "add" && current) {
    throw new Error(`Entry "${proposal.entryId}" now exists (added after this proposal). Reject it and propose an update.`);
  }
  if (proposal.action === "update") {
    if (!current) throw new Error(`Entry "${proposal.entryId}" no longer exists`);
    if (current.version !== proposal.baseVersion) {
      throw new Error(
        `Stale proposal: entry is at version ${current.version} but this was based on ${proposal.baseVersion}. Reject it and ask for a new one.`,
      );
    }
  }

  const version = proposal.action === "update" ? current!.version + 1 : 1;
  // parseMeta works on flat frontmatter, so lift any extra keys back to the top level.
  const { extra, ...known } = proposal.entry.meta;
  const frontmatter = {
    ...known,
    ...extra,
    status: options.status ?? proposal.entry.meta.status,
    version,
    created: proposal.action === "update" ? (current!.created ?? today()) : today(),
    updated: today(),
  };

  // Re-validate against the types configured now, which may differ from proposal time.
  const checked = parseMeta(frontmatter, kb.types);
  if (!checked.ok) throw new Error(`Proposal no longer validates:\n  ${checked.errors.join("\n  ")}`);
  const meta: EntryMeta = checked.meta;

  const target =
    proposal.action === "update" && current!.scope === proposal.scope
      ? current!.filePath
      : join(layer.path, meta.type, `${meta.id}.md`);
  const root = resolve(layer.path) + sep;
  if (!resolve(target).startsWith(root)) throw new Error("Refusing to write outside the content directory");

  atomicWrite(target, serializeEntry(meta, proposal.entry.body));

  store.archive({
    ...proposal,
    state: "approved",
    decidedAt: new Date().toISOString(),
    ...(options.note ? { decisionNote: options.note } : {}),
  });
  kb.refresh(true);
  return { path: target, version };
}

export function rejectProposal(store: ProposalStore, proposalId: string, note?: string): void {
  const proposal = store.get(proposalId);
  if (proposal.state !== "pending") throw new Error(`Proposal ${proposalId} was already ${proposal.state}`);
  store.archive({
    ...proposal,
    state: "rejected",
    decidedAt: new Date().toISOString(),
    ...(note ? { decisionNote: note } : {}),
  });
}
