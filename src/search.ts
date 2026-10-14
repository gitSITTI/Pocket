import type { Entry } from "./types.js";

export interface SearchHit {
  entry: Entry;
  score: number;
  snippet: string;
  /** Set by semantic search: how this entry was found. */
  via?: "keyword" | "meaning" | "both";
  /** Set by semantic search when the entry matched by meaning: cosine similarity, -1 to 1. */
  similarity?: number;
}

export interface SearchOptions {
  limit?: number;
  filter?: (entry: Entry) => boolean;
}

/** Lowercase, strip accents, split on non-alphanumerics, and fold simple plurals. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 || /\d/.test(token))
    .map((token) => (token.length > 3 && token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token));
}

const FIELD_WEIGHTS = { title: 3, tags: 3, id: 2, summary: 2, body: 1 } as const;
const K1 = 1.2;
const B = 0.75;

interface IndexedDoc {
  entry: Entry;
  termFreq: Map<string, number>;
  length: number;
}

/**
 * A small, dependency-free BM25 index. Fields are weighted, so a hit in the
 * title or tags counts for more than a hit deep in the body.
 *
 * To use something else (SQLite FTS, embeddings), keep this `search(query, opts)`
 * shape and swap the class used in kb.ts. See docs/extending.md.
 */
export class SearchIndex {
  private readonly docs: IndexedDoc[] = [];
  private readonly docFreq = new Map<string, number>();
  private readonly avgLength: number;

  constructor(entries: Entry[]) {
    for (const entry of entries) {
      const termFreq = new Map<string, number>();
      let length = 0;
      const add = (text: string, weight: number) => {
        for (const token of tokenize(text)) {
          termFreq.set(token, (termFreq.get(token) ?? 0) + weight);
          length += weight;
        }
      };
      add(entry.title, FIELD_WEIGHTS.title);
      add(entry.tags.join(" "), FIELD_WEIGHTS.tags);
      add(entry.id.replace(/-/g, " "), FIELD_WEIGHTS.id);
      add(entry.summary, FIELD_WEIGHTS.summary);
      add(entry.body, FIELD_WEIGHTS.body);
      for (const term of termFreq.keys()) this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      this.docs.push({ entry, termFreq, length });
    }
    const total = this.docs.reduce((sum, doc) => sum + doc.length, 0);
    this.avgLength = this.docs.length > 0 ? total / this.docs.length : 0;
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];
    const limit = options.limit ?? 10;
    const n = this.docs.length;

    const hits: SearchHit[] = [];
    for (const doc of this.docs) {
      if (options.filter && !options.filter(doc.entry)) continue;
      let score = 0;
      for (const term of terms) {
        const tf = doc.termFreq.get(term);
        if (!tf) continue;
        const df = this.docFreq.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const norm = tf + K1 * (1 - B + B * (doc.length / (this.avgLength || 1)));
        score += idf * ((tf * (K1 + 1)) / norm);
      }
      if (score > 0) hits.push({ entry: doc.entry, score, snippet: snippetFor(doc.entry, terms) });
    }

    hits.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
    return hits.slice(0, limit);
  }
}

function snippetFor(entry: Entry, terms: string[]): string {
  const wanted = new Set(terms);
  for (const line of entry.body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && tokenize(trimmed).some((token) => wanted.has(token))) {
      return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
    }
  }
  return entry.summary;
}
