import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { PocketConfig, LayerConfig } from "./config.js";
import { splitFrontmatter } from "./frontmatter.js";
import { TypeRegistry, parseMeta } from "./schema.js";
import { SearchIndex, type SearchHit } from "./search.js";
import type { Entry, EntryStatus, Issue } from "./types.js";

const SKIPPED_DIRS = new Set(["node_modules"]);

/** All Markdown files under a directory, in a stable order. Dot-directories are skipped. */
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  const children = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const child of children) {
    if (child.name.startsWith(".") || SKIPPED_DIRS.has(child.name)) continue;
    const path = join(dir, child.name);
    if (child.isDirectory()) walk(path, out);
    else if (child.isFile() && child.name.endsWith(".md")) out.push(path);
  }
  return out;
}

export interface EntryFilter {
  type?: string;
  tag?: string;
  status?: EntryStatus;
  scope?: string;
}

export interface EntrySummary {
  id: string;
  type: string;
  title: string;
  summary: string;
  tags: string[];
  status: EntryStatus;
  version: number;
  scope: string;
}

export function summarize(entry: Entry): EntrySummary {
  return {
    id: entry.id,
    type: entry.type,
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags,
    status: entry.status,
    version: entry.version,
    scope: entry.scope,
  };
}

/**
 * The knowledge base: loads Markdown entries from each content layer, applies
 * layering (later layers override earlier ones on the same id), validates them,
 * and keeps a search index. It re-scans automatically when files change.
 */
export class KnowledgeBase {
  readonly types: TypeRegistry;
  private signature = "";
  private effective = new Map<string, Entry>();
  private found: Issue[] = [];
  private index = new SearchIndex([]);

  constructor(readonly config: PocketConfig) {
    this.types = new TypeRegistry(config.types);
    this.refresh(true);
  }

  /** Re-scan the content directories if anything changed since the last scan. */
  refresh(force = false): void {
    const files: { layer: LayerConfig; path: string }[] = [];
    for (const layer of this.config.contentDirs) {
      for (const path of walk(layer.path)) files.push({ layer, path });
    }
    const signature = files
      .map(({ path }) => {
        const stat = statSync(path);
        return `${path}:${stat.mtimeMs}:${stat.size}`;
      })
      .join("|");
    if (!force && signature === this.signature) return;
    this.signature = signature;

    const issues: Issue[] = [];
    const effective = new Map<string, Entry>();

    for (const layer of this.config.contentDirs) {
      if (!existsSync(layer.path)) {
        issues.push({
          level: "warning",
          scope: layer.scope,
          file: layer.path,
          message: "content directory does not exist",
        });
        continue;
      }

      const seen = new Map<string, Entry>();
      for (const { layer: owner, path } of files) {
        if (owner.scope !== layer.scope) continue;
        const file = relative(layer.path, path);
        let text: string;
        try {
          text = readFileSync(path, "utf8");
        } catch (error) {
          issues.push({ level: "error", scope: layer.scope, file, message: `cannot read file: ${(error as Error).message}` });
          continue;
        }

        let split;
        try {
          split = splitFrontmatter(text);
        } catch (error) {
          issues.push({ level: "error", scope: layer.scope, file, message: (error as Error).message });
          continue;
        }
        if (!split) continue; // Markdown without frontmatter (a README, say) is not an entry.

        const result = parseMeta(split.data, this.types);
        if (!result.ok) {
          const id = typeof (split.data as { id?: unknown })?.id === "string" ? (split.data as { id: string }).id : undefined;
          for (const message of result.errors) {
            issues.push({ level: "error", scope: layer.scope, file, ...(id ? { id } : {}), message });
          }
          continue;
        }

        const entry: Entry = { ...result.meta, body: split.body, scope: layer.scope, filePath: path };
        if (basename(path, ".md") !== entry.id) {
          issues.push({
            level: "warning",
            scope: layer.scope,
            file,
            id: entry.id,
            message: `file name should match the id (expected ${entry.id}.md)`,
          });
        }
        if (seen.has(entry.id)) {
          issues.push({
            level: "error",
            scope: layer.scope,
            file,
            id: entry.id,
            message: `duplicate id in the same scope (also in ${relative(layer.path, seen.get(entry.id)!.filePath)})`,
          });
          continue;
        }
        seen.set(entry.id, entry);
      }
      for (const entry of seen.values()) effective.set(entry.id, entry);
    }

    for (const entry of effective.values()) {
      // `links` in the frontmatter is the machine-readable list; [[id]] in the body is a
      // convention for readers. Both are checked so neither silently rots.
      const bodyLinks = [...entry.body.matchAll(/\[\[([a-z0-9][a-z0-9-]*)\]\]/g)].map((m) => m[1]!);
      for (const link of new Set([...entry.links, ...bodyLinks])) {
        if (!effective.has(link)) {
          issues.push({
            level: "warning",
            scope: entry.scope,
            file: relative(this.layer(entry.scope)?.path ?? "", entry.filePath),
            id: entry.id,
            message: `links to unknown entry "${link}"`,
          });
        }
      }
    }

    this.effective = effective;
    this.found = issues;
    this.index = new SearchIndex([...effective.values()]);
  }

  layer(scope: string): LayerConfig | undefined {
    return this.config.contentDirs.find((l) => l.scope === scope);
  }

  /** Scopes in precedence order, least specific first. */
  scopes(): string[] {
    return this.config.contentDirs.map((l) => l.scope);
  }

  getEntry(id: string): Entry | undefined {
    this.refresh();
    return this.effective.get(id);
  }

  listEntries(filter: EntryFilter = {}): Entry[] {
    this.refresh();
    const tag = filter.tag?.toLowerCase();
    return [...this.effective.values()]
      .filter((e) => (filter.type ? e.type === filter.type : true))
      .filter((e) => (filter.status ? e.status === filter.status : true))
      .filter((e) => (filter.scope ? e.scope === filter.scope : true))
      .filter((e) => (tag ? e.tags.some((t) => t.toLowerCase() === tag) : true))
      .sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
  }

  search(query: string, filter: EntryFilter = {}, limit = 10): SearchHit[] {
    this.refresh();
    const tag = filter.tag?.toLowerCase();
    return this.index.search(query, {
      limit,
      filter: (e) =>
        (filter.type ? e.type === filter.type : true) &&
        (filter.status ? e.status === filter.status : true) &&
        (filter.scope ? e.scope === filter.scope : true) &&
        (tag ? e.tags.some((t) => t.toLowerCase() === tag) : true),
    });
  }

  /** Every problem found by the most recent scan. */
  issues(): Issue[] {
    this.refresh();
    return this.found;
  }
}
