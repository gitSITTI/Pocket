import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";
import type { PocketConfig } from "../src/config.js";
import { KnowledgeBase } from "../src/kb.js";
import { ProposalStore } from "../src/proposals.js";
import { DEFAULT_TYPES } from "../src/types.js";

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true });
});

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pocket-test-"));
  created.push(dir);
  return dir;
}

export interface EntrySpec {
  id: string;
  type?: string;
  title?: string;
  summary?: string;
  extraFrontmatter?: string;
  body?: string;
  /** File path relative to the layer. Defaults to <type>/<id>.md */
  file?: string;
}

export function writeEntry(layerDir: string, spec: EntrySpec): string {
  const type = spec.type ?? "process";
  const path = join(layerDir, spec.file ?? `${type}/${spec.id}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `---\nid: ${spec.id}\ntype: ${type}\ntitle: ${spec.title ?? `Title of ${spec.id}`}\nsummary: ${spec.summary ?? `Summary of ${spec.id}`}\n${spec.extraFrontmatter ?? ""}---\n\n${spec.body ?? "Body text."}\n`,
  );
  return path;
}

export interface Fixture {
  root: string;
  layers: Record<string, string>;
  config: PocketConfig;
  kb: KnowledgeBase;
  store: ProposalStore;
}

/** A knowledge base over temp directories. Layers are listed least specific first. */
export function fixture(scopes: string[] = ["main"], overrides: Partial<PocketConfig> = {}): Fixture {
  const root = tempDir();
  const layers: Record<string, string> = {};
  for (const scope of scopes) {
    layers[scope] = join(root, scope);
    mkdirSync(layers[scope]!, { recursive: true });
  }
  const config: PocketConfig = {
    contentDirs: scopes.map((scope) => ({ scope, path: layers[scope]! })),
    proposalsDir: join(root, "proposals"),
    readOnly: false,
    types: DEFAULT_TYPES,
    ...overrides,
  };
  return { root, layers, config, kb: new KnowledgeBase(config), store: new ProposalStore(config.proposalsDir) };
}
