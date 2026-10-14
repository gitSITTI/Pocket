import { parse, stringify } from "yaml";
import type { EntryMeta } from "./types.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface SplitResult {
  data: unknown;
  body: string;
}

/**
 * Split a Markdown file into YAML frontmatter and body.
 * Returns null when the file has no frontmatter (it is not an entry).
 * Throws when the frontmatter is present but is not valid YAML.
 */
export function splitFrontmatter(text: string): SplitResult | null {
  const match = FRONTMATTER.exec(text);
  if (!match) return null;
  const yaml = match[1] ?? "";
  const body = match[2] ?? "";
  let data: unknown;
  try {
    data = parse(yaml);
  } catch (error) {
    throw new Error(`invalid YAML frontmatter: ${(error as Error).message}`);
  }
  return { data: data ?? {}, body: body.replace(/^\r?\n+/, "") };
}

/** Write an entry back to Markdown with a stable key order. */
export function serializeEntry(meta: EntryMeta, body: string): string {
  const ordered: Record<string, unknown> = {
    id: meta.id,
    type: meta.type,
    title: meta.title,
    summary: meta.summary,
    tags: meta.tags,
    status: meta.status,
    version: meta.version,
  };
  if (meta.created !== undefined) ordered.created = meta.created;
  if (meta.updated !== undefined) ordered.updated = meta.updated;
  ordered.links = meta.links;
  if (meta.source !== undefined) ordered.source = meta.source;
  if (meta.license !== undefined) ordered.license = meta.license;
  if (meta.sourceHash !== undefined) ordered.sourceHash = meta.sourceHash;
  for (const [key, value] of Object.entries(meta.extra)) ordered[key] = value;

  const yaml = stringify(ordered, { lineWidth: 0 });
  return `---\n${yaml}---\n\n${body.trim()}\n`;
}
