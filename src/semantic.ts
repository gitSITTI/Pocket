import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { EntryFilter, KnowledgeBase } from "./kb.js";
import type { SearchHit } from "./search.js";
import type { Entry } from "./types.js";

/**
 * Turns text into vectors so entries can be matched by meaning. The built-in implementation runs a
 * small model locally (see embedder.ts); anything with this shape works when Pocket is used as a library.
 */
export interface Embedder {
  /** Names the model and settings. Vectors made under a different id are thrown away. */
  readonly id: string;
  /** One vector per text, in order, all the same length. */
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface SemanticOptions {
  /** Where to keep vectors between runs. Without it they live in memory only. */
  cacheFile?: string;
  /** Entries found only by meaning are dropped below this cosine similarity. Default 0 (keep all). */
  minSimilarity?: number;
  /**
   * Where problems are reported. Default: standard error. "failure" means search by meaning cannot
   * run (callers that also show the result's note may skip it); "cache" means the vector cache had a problem.
   */
  warn?: (message: string, kind: "failure" | "cache") => void;
}

export interface SemanticResult {
  hits: SearchHit[];
  /** Set when the answer is keyword-only or incomplete, with the reason. */
  note?: string;
}

/** Only the start of an entry is embedded: its title, summary and tags, then as much body as fits. */
const MAX_EMBED_CHARS = 1500;
const BATCH_SIZE = 16;
/** How many candidates each ranking contributes before they are merged. */
const CANDIDATES = 50;
/** Reciprocal rank fusion constant; 60 is the value from the paper that introduced it. */
const RRF_K = 60;
/** After a failure, wait this long before trying the model again. */
const RETRY_AFTER_MS = 60_000;
const CACHE_FORMAT = 1;

export function embeddingText(entry: Entry): string {
  const head = [entry.title, entry.summary, entry.tags.join(", ")].filter((part) => part.length > 0).join("\n");
  return `${head}\n${entry.body}`.slice(0, MAX_EMBED_CHARS);
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const x of vector) sum += x * x;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) throw new Error("the embedder returned a vector that is empty or not finite");
  return vector.map((x) => x / norm);
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * b[i]!;
  return sum;
}

const cacheSchema = z.strictObject({
  format: z.literal(CACHE_FORMAT),
  model: z.string(),
  dim: z.number().int().min(1).max(8192),
  vectors: z.record(z.string(), z.strictObject({ hash: z.string().regex(/^[0-9a-f]{64}$/), v: z.string() })),
});

interface Stored {
  hash: string;
  vector: Float32Array;
}

/** Reads the vector cache. Returns nothing usable (and says why) rather than throwing: the cache is only an optimization. */
function readCache(file: string, model: string): { vectors: Map<string, Stored>; problem?: string } {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { vectors: new Map() };
    return { vectors: new Map(), problem: `could not read ${file}: ${(error as Error).message}` };
  }
  try {
    const parsed = cacheSchema.parse(JSON.parse(text));
    if (parsed.model !== model) return { vectors: new Map() }; // another model made these; start over quietly
    const vectors = new Map<string, Stored>();
    for (const [id, item] of Object.entries(parsed.vectors)) {
      const bytes = Buffer.from(item.v, "base64");
      if (bytes.length !== parsed.dim * 4) throw new Error(`vector for "${id}" has the wrong length`);
      const vector = new Float32Array(parsed.dim);
      new Uint8Array(vector.buffer).set(bytes);
      vectors.set(id, { hash: item.hash, vector });
    }
    return { vectors };
  } catch (error) {
    return { vectors: new Map(), problem: `ignoring the vector cache ${file}: ${(error as Error).message}` };
  }
}

function writeCache(file: string, model: string, vectors: Map<string, Stored>): void {
  const first = vectors.values().next().value as Stored | undefined;
  const body = {
    format: CACHE_FORMAT,
    model,
    dim: first?.vector.length ?? 1,
    vectors: Object.fromEntries(
      [...vectors].map(([id, { hash, vector }]) => [id, { hash, v: Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString("base64") }]),
    ),
  };
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(body), { mode: 0o600 });
  renameSync(temporary, file);
}

/**
 * Merges two rankings by position, not score, because keyword scores and cosine similarities are not
 * on the same scale. An entry high in both lists comes first. The returned score is relative: 1 means
 * first in both lists. Compare scores within one result list only.
 */
export function fuse(keyword: SearchHit[], meaning: { entry: Entry; similarity: number }[], limit: number): SearchHit[] {
  const merged = new Map<string, { hit: SearchHit; rrf: number }>();
  keyword.forEach((hit, index) => {
    merged.set(hit.entry.id, { hit: { ...hit, via: "keyword" }, rrf: 1 / (RRF_K + index + 1) });
  });
  meaning.forEach(({ entry, similarity }, index) => {
    const share = 1 / (RRF_K + index + 1);
    const existing = merged.get(entry.id);
    if (existing) {
      existing.rrf += share;
      existing.hit.via = "both";
      existing.hit.similarity = similarity;
    } else {
      merged.set(entry.id, { hit: { entry, score: 0, snippet: entry.summary, via: "meaning", similarity }, rrf: share });
    }
  });
  const scale = (RRF_K + 1) / 2;
  return [...merged.values()]
    .map(({ hit, rrf }) => ({ ...hit, score: rrf * scale }))
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
    .slice(0, limit);
}

/**
 * Search by meaning, combined with the keyword search the knowledge base already has.
 *
 * Vectors are made in the background and cached, so the first searches after a start (or after
 * entries change) may return keyword results with a note saying why. Nothing here is required for
 * Pocket to work: if the model cannot run, searches keep returning keyword results.
 */
export class SemanticSearch {
  private vectors = new Map<string, Stored>();
  private cacheLoaded = false;
  private running: Promise<void> | undefined;
  private syncedGeneration = -1;
  private failure: { message: string; at: number } | undefined;
  private readonly hashes = new WeakMap<Entry, string>();

  constructor(
    private readonly kb: KnowledgeBase,
    private readonly embedder: Embedder,
    private readonly options: SemanticOptions = {},
  ) {}

  private warn(message: string, kind: "failure" | "cache"): void {
    (this.options.warn ?? ((m: string) => console.error(`pocket: ${m}`)))(message, kind);
  }

  private hashOf(entry: Entry): string {
    let hash = this.hashes.get(entry);
    if (!hash) {
      hash = sha256(embeddingText(entry));
      this.hashes.set(entry, hash);
    }
    return hash;
  }

  private isCurrent(entry: Entry): boolean {
    return this.vectors.get(entry.id)?.hash === this.hashOf(entry);
  }

  /** How many entries there are and how many have an up-to-date vector. */
  status(): { total: number; embedded: number; failure?: string } {
    const entries = this.kb.listEntries();
    return {
      total: entries.length,
      embedded: entries.filter((entry) => this.isCurrent(entry)).length,
      ...(this.failure ? { failure: this.failure.message } : {}),
    };
  }

  /** Make vectors for entries that are new or changed. Never rejects; check status() for the outcome. */
  sync(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async run(): Promise<void> {
    if (!this.cacheLoaded) {
      this.cacheLoaded = true;
      if (this.options.cacheFile) {
        const { vectors, problem } = readCache(this.options.cacheFile, this.embedder.id);
        this.vectors = vectors;
        if (problem) this.warn(problem, "cache");
      }
    }
    try {
      // Entries can change while the model is working, so loop until a pass sees no new changes.
      for (;;) {
        this.kb.refresh();
        const generation = this.kb.generation;
        const entries = this.kb.listEntries();
        const pending = entries.filter((entry) => !this.isCurrent(entry));
        const removed = [...this.vectors.keys()].filter((id) => !entries.some((entry) => entry.id === id));

        for (let start = 0; start < pending.length; start += BATCH_SIZE) {
          const batch = pending.slice(start, start + BATCH_SIZE);
          const vectors = await this.embedder.embed(batch.map(embeddingText));
          if (vectors.length !== batch.length) throw new Error("the embedder returned the wrong number of vectors");
          batch.forEach((entry, index) => this.vectors.set(entry.id, { hash: this.hashOf(entry), vector: normalize(vectors[index]!) }));
        }
        for (const id of removed) this.vectors.delete(id);
        if ((pending.length > 0 || removed.length > 0) && this.options.cacheFile) this.save();

        this.syncedGeneration = generation;
        this.failure = undefined;
        this.kb.refresh(); // generation only moves when the content is re-scanned
        if (this.kb.generation === generation) return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failure = { message, at: Date.now() };
      this.warn(`search by meaning is unavailable: ${message}`, "failure");
    }
  }

  private save(): void {
    try {
      writeCache(this.options.cacheFile!, this.embedder.id, this.vectors);
    } catch (error) {
      this.warn(`could not save the vector cache: ${(error as Error).message}`, "cache");
    }
  }

  private needsSync(): boolean {
    if (this.failure && Date.now() - this.failure.at < RETRY_AFTER_MS) return false;
    return this.kb.generation !== this.syncedGeneration || this.status().embedded < this.kb.listEntries().length;
  }

  /**
   * Keyword and meaning results merged. With `wait`, vectors are brought up to date first (for
   * one-off commands); otherwise this answers at once with what is ready and says what is missing.
   */
  async search(query: string, filter: EntryFilter = {}, limit = 10, options: { wait?: boolean } = {}): Promise<SemanticResult> {
    this.kb.refresh();
    if (options.wait) await this.sync();
    else if (this.needsSync()) void this.sync();

    const keyword = this.kb.search(query, filter, Math.max(CANDIDATES, limit));
    const keywordOnly = (note: string): SemanticResult => ({ hits: keyword.slice(0, limit), note });

    if (this.failure && Date.now() - this.failure.at < RETRY_AFTER_MS) {
      return keywordOnly(`Search by meaning is unavailable (${this.failure.message}); these are keyword results.`);
    }
    const ready = this.kb.listEntries(filter).filter((entry) => this.isCurrent(entry));
    if (query.trim() === "") return { hits: [] };
    if (ready.length === 0 && this.kb.listEntries(filter).length > 0) {
      return keywordOnly("Search by meaning is still getting ready; these are keyword results.");
    }

    let queryVector: Float32Array;
    try {
      const [vector] = await this.embedder.embed([query]);
      if (!vector) throw new Error("the embedder returned no vector for the query");
      queryVector = normalize(vector);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failure = { message, at: Date.now() };
      this.warn(`search by meaning is unavailable: ${message}`, "failure");
      return keywordOnly(`Search by meaning is unavailable (${message}); these are keyword results.`);
    }

    const floor = this.options.minSimilarity ?? 0;
    const meaning = ready
      .map((entry) => ({ entry, similarity: dot(queryVector, this.vectors.get(entry.id)!.vector) }))
      .filter((item) => item.similarity >= floor)
      .sort((a, b) => b.similarity - a.similarity || a.entry.title.localeCompare(b.entry.title))
      .slice(0, Math.max(CANDIDATES, limit));

    const missing = this.kb.listEntries(filter).length - ready.length;
    const note = missing > 0 ? `${missing} ${missing === 1 ? "entry is" : "entries are"} not ready for search by meaning yet and can only match by keyword.` : undefined;
    return { hits: fuse(keyword, meaning, limit), ...(note ? { note } : {}) };
  }
}
