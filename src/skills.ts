import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { stringify } from "yaml";
import { splitFrontmatter } from "./frontmatter.js";
import type { KnowledgeBase } from "./kb.js";
import { ProposalStore, proposeAdd, proposeUpdate, type ProposeResult } from "./proposals.js";
import { SUMMARY_MAX } from "./schema.js";
import type { Entry, EntryStatus } from "./types.js";

/**
 * Import and export of the open Agent Skills format (https://agentskills.io/specification):
 * a folder holding a SKILL.md with `name` and `description` frontmatter.
 *
 * Only SKILL.md is carried across. Pocket entries are single Markdown files, so
 * scripts/, references/ and assets/ are not imported, which also means an import can
 * never bring executable code into the knowledge base.
 */

export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;
export const SKILL_COMPATIBILITY_MAX = 500;
const MAX_SKILL_FILE_BYTES = 256 * 1024;
const SPEC_KEYS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);

/** Why a name is not a valid skill name, or undefined when it is valid. */
export function checkSkillName(name: string): string | undefined {
  if (name.length < 1 || name.length > SKILL_NAME_MAX) return `must be 1 to ${SKILL_NAME_MAX} characters`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    return "may only contain lowercase letters a-z, digits and single hyphens, and must not start or end with a hyphen (Pocket supports ASCII names only)";
  }
  return undefined;
}

export interface SkillDocument {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string;
  /** The `metadata` map, with every value as a string. */
  metadata: Record<string, string>;
  body: string;
  /** Frontmatter keys that are not part of the specification. They are not imported. */
  ignoredKeys: string[];
}

export type ParseSkillResult = { ok: true; skill: SkillDocument } | { ok: false; errors: string[] };

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read and validate the text of a SKILL.md. Pass the folder name to check that it matches. */
export function parseSkillMd(text: string, folderName?: string): ParseSkillResult {
  let split;
  try {
    split = splitFrontmatter(text);
  } catch (error) {
    return { ok: false, errors: [(error as Error).message] };
  }
  if (!split) return { ok: false, errors: ["SKILL.md has no YAML frontmatter"] };
  if (!isMapping(split.data)) return { ok: false, errors: ["frontmatter must be a YAML mapping of keys to values"] };

  const data = split.data;
  const errors: string[] = [];

  const name = data.name;
  if (typeof name !== "string") errors.push("name: required, and must be text");
  else {
    const problem = checkSkillName(name);
    if (problem) errors.push(`name: ${problem}`);
    else if (folderName !== undefined && folderName !== name) {
      errors.push(`name: "${name}" must match the folder name "${folderName}"`);
    }
  }

  const rawDescription = data.description;
  const description = typeof rawDescription === "string" ? rawDescription.trim() : "";
  if (typeof rawDescription !== "string" || description === "") errors.push("description: required, and must not be empty");
  else if (description.length > SKILL_DESCRIPTION_MAX) {
    errors.push(`description: ${description.length} characters, the limit is ${SKILL_DESCRIPTION_MAX}`);
  }

  let license: string | undefined;
  if (data.license !== undefined) {
    if (typeof data.license === "string" && data.license.trim() !== "") license = data.license.trim();
    else errors.push("license: must be non-empty text");
  }

  let compatibility: string | undefined;
  if (data.compatibility !== undefined) {
    if (typeof data.compatibility !== "string" || data.compatibility.trim() === "") {
      errors.push("compatibility: must be non-empty text");
    } else if (data.compatibility.length > SKILL_COMPATIBILITY_MAX) {
      errors.push(`compatibility: ${data.compatibility.length} characters, the limit is ${SKILL_COMPATIBILITY_MAX}`);
    } else compatibility = data.compatibility.trim();
  }

  let allowedTools: string | undefined;
  const tools = data["allowed-tools"];
  if (tools !== undefined) {
    if (typeof tools === "string" && tools.trim() !== "") allowedTools = tools.trim();
    else if (Array.isArray(tools) && tools.length > 0 && tools.every((t) => typeof t === "string")) allowedTools = tools.join(" ");
    else errors.push("allowed-tools: must be a space-separated string");
  }

  const metadata: Record<string, string> = {};
  if (data.metadata !== undefined) {
    if (!isMapping(data.metadata)) errors.push("metadata: must be a mapping of keys to text");
    else {
      for (const [key, value] of Object.entries(data.metadata)) {
        if (typeof value === "string") metadata[key] = value;
        else if (typeof value === "number" || typeof value === "boolean") metadata[key] = String(value);
        else errors.push(`metadata.${key}: must be text`);
      }
    }
  }

  const body = split.body.trim();
  if (body === "") errors.push("SKILL.md has no instructions after the frontmatter");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    skill: {
      name: name as string,
      description,
      ...(license !== undefined ? { license } : {}),
      ...(compatibility !== undefined ? { compatibility } : {}),
      ...(allowedTools !== undefined ? { allowedTools } : {}),
      metadata,
      body,
      ignoredKeys: Object.keys(data).filter((key) => !SPEC_KEYS.has(key)),
    },
  };
}

function sentenceCase(name: string): string {
  const spaced = name.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function titleFor(skill: SkillDocument): string {
  const stored = skill.metadata["pocket-title"];
  if (stored && stored.length <= 200) return stored;
  const heading = /^#\s+(.+?)\s*$/m.exec(skill.body)?.[1];
  if (heading && heading.length <= 200) return heading;
  return sentenceCase(skill.name);
}

// ---------------------------------------------------------------------------
// Export

export interface SkillText {
  name: string;
  text: string;
}

/** Render an entry as the text of a SKILL.md. */
export function entryToSkillMd(entry: Entry): { ok: true; skill: SkillText } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const problem = checkSkillName(entry.id);
  if (problem) errors.push(`id "${entry.id}" is not a valid skill name: ${problem}`);

  const description = (typeof entry.extra.description === "string" ? entry.extra.description : entry.summary).trim();
  if (description.length > SKILL_DESCRIPTION_MAX) {
    errors.push(`description is ${description.length} characters, the limit is ${SKILL_DESCRIPTION_MAX}`);
  }

  const front: Record<string, unknown> = { name: entry.id, description };
  if (entry.license !== undefined) front.license = entry.license;

  const compatibility = entry.extra.compatibility;
  if (typeof compatibility === "string" && compatibility.trim() !== "") {
    if (compatibility.length > SKILL_COMPATIBILITY_MAX) {
      errors.push(`compatibility is ${compatibility.length} characters, the limit is ${SKILL_COMPATIBILITY_MAX}`);
    } else front.compatibility = compatibility;
  }
  if (typeof entry.extra["allowed-tools"] === "string") front["allowed-tools"] = entry.extra["allowed-tools"];

  const metadata: Record<string, string> = {};
  if (isMapping(entry.extra.metadata)) {
    for (const [key, value] of Object.entries(entry.extra.metadata)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") metadata[key] = String(value);
    }
  }
  metadata["pocket-title"] = entry.title;
  if (entry.tags.length > 0) metadata["pocket-tags"] = entry.tags.join(", ");
  if (entry.source !== undefined) metadata["pocket-source"] = entry.source;
  front.metadata = metadata;

  if (errors.length > 0) return { ok: false, errors };
  const text = `---\n${stringify(front, { lineWidth: 0 })}---\n\n${entry.body.trim()}\n`;

  // Never write a file that this module would itself reject.
  const check = parseSkillMd(text, entry.id);
  if (!check.ok) return { ok: false, errors: check.errors };
  return { ok: true, skill: { name: entry.id, text } };
}

export interface ExportOptions {
  /** Entry type to export. Defaults to "skill". */
  type?: string;
  /** Which statuses to export. Defaults to active entries only. */
  statuses?: EntryStatus[] | "all";
}

export interface ExportItem {
  id: string;
  /** The file that was written, when the export worked. */
  path?: string;
  /** Why the entry was skipped. */
  errors: string[];
}

/** Write each matching entry to <dir>/<id>/SKILL.md. Other files in those folders are left alone. */
export function exportSkills(kb: KnowledgeBase, dir: string, options: ExportOptions = {}): ExportItem[] {
  const statuses = options.statuses ?? ["active"];
  const entries = kb
    .listEntries({ type: options.type ?? "skill" })
    .filter((entry) => statuses === "all" || statuses.includes(entry.status));

  const items: ExportItem[] = [];
  for (const entry of entries) {
    const rendered = entryToSkillMd(entry);
    if (!rendered.ok) {
      items.push({ id: entry.id, errors: rendered.errors });
      continue;
    }
    const folder = join(dir, rendered.skill.name);
    const path = join(folder, "SKILL.md");
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
      items.push({ id: entry.id, errors: ["SKILL.md in the target folder is a symbolic link, so it was not overwritten"] });
      continue;
    }
    mkdirSync(folder, { recursive: true });
    writeFileSync(path, rendered.skill.text, "utf8");
    items.push({ id: entry.id, path, errors: [] });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Import

export interface ImportOptions {
  /** Where the skills came from, such as a repository URL. Required: provenance is not optional. */
  source: string;
  /** Overrides the license in each SKILL.md. */
  license?: string;
  /** Entry type to create. Defaults to "skill". */
  type?: string;
  tags?: string[];
  scope?: string;
  /** Check everything and report, but create no proposals. */
  dryRun?: boolean;
  proposedBy?: string;
}

export type ImportOutcome = "proposed" | "proposed-update" | "unchanged" | "invalid";

export interface ImportItem {
  /** The skill name, or the folder name when the name could not be read. */
  name: string;
  outcome: ImportOutcome;
  proposalId?: string;
  errors: string[];
  warnings: string[];
}

function findSkillFolders(dir: string): string[] {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`${root} is not a folder`);
  if (existsSync(join(root, "SKILL.md"))) return [root];
  const folders = readdirSync(root, { withFileTypes: true })
    .filter((child) => child.isDirectory() && !child.name.startsWith("."))
    .map((child) => join(root, child.name))
    .filter((folder) => existsSync(join(folder, "SKILL.md")))
    .sort();
  if (folders.length === 0) throw new Error(`No SKILL.md found in ${root} or in its immediate subfolders.`);
  return folders;
}

/**
 * Read Agent Skills folders and turn each into a proposal. Nothing is written to the
 * knowledge base: a person still reviews and approves every skill.
 */
export function importSkills(kb: KnowledgeBase, store: ProposalStore, dir: string, options: ImportOptions): ImportItem[] {
  if (options.source.trim() === "") throw new Error("A source is required, for example the URL of the repository the skills came from.");
  const type = options.type ?? "skill";
  // Throwaway proposals: used for dry runs and to test whether an update would change anything.
  const scratch = mkdtempSync(join(tmpdir(), "pocket-import-"));
  const trialStore = new ProposalStore(scratch);
  const target = options.dryRun ? trialStore : store;

  try {
    const items: ImportItem[] = [];
    for (const folder of findSkillFolders(dir)) {
      const folderName = basename(folder);
      const item: ImportItem = { name: folderName, outcome: "invalid", errors: [], warnings: [] };
      items.push(item);

      const file = join(folder, "SKILL.md");
      const stat = lstatSync(file);
      if (!stat.isFile()) {
        item.errors.push("SKILL.md must be a regular file, not a link");
        continue;
      }
      if (stat.size > MAX_SKILL_FILE_BYTES) {
        item.errors.push(`SKILL.md is ${stat.size} bytes, more than the ${MAX_SKILL_FILE_BYTES} byte limit`);
        continue;
      }

      const bytes = readFileSync(file);
      const sourceHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const parsed = parseSkillMd(bytes.toString("utf8"), folderName);
      if (!parsed.ok) {
        item.errors.push(...parsed.errors);
        continue;
      }
      const { skill } = parsed;
      item.name = skill.name;

      const others = readdirSync(folder).filter((name) => name !== "SKILL.md");
      if (others.length > 0) {
        item.warnings.push(`Not imported (Pocket entries are single Markdown files): ${others.sort().join(", ")}`);
      }
      if (skill.ignoredKeys.length > 0) item.warnings.push(`Ignored frontmatter keys: ${skill.ignoredKeys.join(", ")}`);

      const license = options.license ?? skill.license;
      const longDescription = skill.description.length > SUMMARY_MAX;
      const summary = longDescription ? `${skill.description.slice(0, SUMMARY_MAX - 3).trimEnd()}...` : skill.description;
      if (longDescription) {
        item.warnings.push(`The description is ${skill.description.length} characters. The summary was shortened to ${SUMMARY_MAX}; the full text is kept in the "description" field.`);
      }

      const existing = kb.getEntry(skill.name);
      const extra: Record<string, unknown> = {};
      if (longDescription || existing?.extra.description !== undefined) extra.description = skill.description;
      if (skill.compatibility !== undefined) extra.compatibility = skill.compatibility;
      if (skill.allowedTools !== undefined) extra["allowed-tools"] = skill.allowedTools;
      const kept = Object.fromEntries(Object.entries(skill.metadata).filter(([key]) => !key.startsWith("pocket-")));
      if (Object.keys(kept).length > 0) extra.metadata = kept;
      // When an update drops a field the earlier version had, remove it instead of keeping the stale value.
      if (existing) {
        for (const key of ["compatibility", "allowed-tools", "metadata"]) {
          if (existing.extra[key] !== undefined && extra[key] === undefined) extra[key] = undefined;
        }
      }

      const rationale = `Imported from the Agent Skills folder "${skill.name}" (source: ${options.source}).`;
      const proposedBy = options.proposedBy ?? "pocket import skills";

      let result: ProposeResult;
      if (existing) {
        if (existing.type !== type) {
          item.errors.push(`An entry with id "${skill.name}" already exists with type "${existing.type}", not "${type}"`);
          continue;
        }
        const patch = {
          summary,
          body: skill.body,
          source: options.source,
          ...(license !== undefined ? { license } : {}),
          extra,
        };
        const common = {
          id: skill.name,
          baseVersion: existing.version,
          ...(options.scope ? { scope: options.scope } : {}),
          rationale,
          proposedBy,
        };
        // A different file hash alone (say, reformatted whitespace) is not worth a person's time.
        const trial = proposeUpdate(kb, trialStore, { ...common, patch });
        if (!trial.ok && trial.errors.some((e) => e.startsWith("patch: no changes"))) {
          item.outcome = "unchanged";
          continue;
        }
        result = proposeUpdate(kb, target, { ...common, patch: { ...patch, sourceHash } });
      } else {
        const pocketTags = skill.metadata["pocket-tags"]?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];
        result = proposeAdd(kb, target, {
          id: skill.name,
          type,
          title: titleFor(skill),
          summary,
          body: skill.body,
          tags: options.tags ?? pocketTags,
          source: options.source,
          sourceHash,
          ...(license !== undefined ? { license } : {}),
          extra,
          ...(options.scope ? { scope: options.scope } : {}),
          rationale,
          proposedBy,
        });
      }

      if (!result.ok) {
        item.errors.push(...result.errors);
        continue;
      }
      item.outcome = existing ? "proposed-update" : "proposed";
      if (!options.dryRun) item.proposalId = result.proposal.proposalId;
    }
    return items;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
