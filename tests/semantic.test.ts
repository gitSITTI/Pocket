import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import type { SearchHit } from "../src/search.js";
import { SemanticSearch, embeddingText, fuse, type Embedder } from "../src/semantic.js";
import { fixture, tempDir, writeEntry, type Fixture } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

/** Words in one group mean the same thing to the fake embedder, standing in for a real model. */
const GROUPS = [
  ["release", "ship", "deploy", "publish", "launch"],
  ["incident", "outage", "crash", "failure"],
  ["secret", "credential", "token", "password"],
  ["review", "approve", "feedback"],
];

function fakeEmbedder(id = "fake:1"): Embedder & { texts: string[]; calls: number } {
  const embedder = {
    id,
    texts: [] as string[],
    calls: 0,
    async embed(texts: string[]): Promise<Float32Array[]> {
      embedder.calls += 1;
      embedder.texts.push(...texts);
      return texts.map((text) => {
        const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
        const vector = new Float32Array(GROUPS.length + 1);
        words.forEach((word) => {
          const group = GROUPS.findIndex((g) => g.includes(word));
          vector[group === -1 ? GROUPS.length : group]! += 1;
        });
        vector[GROUPS.length]! += 0.01; // never an all-zero vector
        return vector;
      });
    },
  };
  return embedder;
}

function knowledge(): Fixture {
  const f = fixture();
  writeEntry(f.layers.main!, { id: "release-checklist", title: "Release checklist", summary: "Steps to take before we ship.", body: "Run the tests, then tag it." });
  writeEntry(f.layers.main!, { id: "incident-response", title: "Incident response", summary: "What to do during an outage.", body: "Page the on-call engineer." });
  writeEntry(f.layers.main!, { id: "rotate-keys", type: "skill", title: "Rotating keys", summary: "How to rotate a credential.", body: "Create the new one first." });
  return f;
}

const ids = (hits: SearchHit[]): string[] => hits.map((hit) => hit.entry.id);

describe("embeddingText", () => {
  it("starts with the title, summary and tags and is cut to a fixed size", () => {
    const f = fixture();
    writeEntry(f.layers.main!, { id: "long", title: "A title", summary: "A summary.", extraFrontmatter: "tags: [alpha, beta]\n", body: "x".repeat(5000) });
    const text = embeddingText(f.kb.getEntry("long")!);
    expect(text.startsWith("A title\nA summary.\nalpha, beta\n")).toBe(true);
    expect(text.length).toBe(1500);
  });
});

describe("fuse", () => {
  const entry = (id: string) => fixtureEntry(id);

  it("puts an entry that is high in both rankings first, and says how each was found", () => {
    const [a, b, c] = [entry("a"), entry("b"), entry("c")];
    const keyword: SearchHit[] = [
      { entry: a, score: 9, snippet: "a words" },
      { entry: b, score: 8, snippet: "b words" },
    ];
    const meaning = [
      { entry: b, similarity: 0.9 },
      { entry: c, similarity: 0.8 },
    ];
    const hits = fuse(keyword, meaning, 10);
    expect(ids(hits)).toEqual(["b", "a", "c"]);
    expect(hits.map((h) => h.via)).toEqual(["both", "keyword", "meaning"]);
    expect(hits[0]!.similarity).toBe(0.9);
    expect(hits[0]!.snippet).toBe("b words");
    expect(hits[2]!.snippet).toBe(c.summary); // nothing matched by words, so show the summary
  });

  it("scores 1 for an entry that is first in both rankings and never above that", () => {
    const a = entry("a");
    const hits = fuse([{ entry: a, score: 5, snippet: "s" }], [{ entry: a, similarity: 1 }], 10);
    expect(hits[0]!.score).toBeCloseTo(1, 10);
    expect(fuse([{ entry: a, score: 5, snippet: "s" }], [], 10)[0]!.score).toBeLessThan(1);
  });

  it("ignores the size of keyword scores and keeps to the limit", () => {
    const [a, b, c] = [entry("a"), entry("b"), entry("c")];
    const keyword: SearchHit[] = [
      { entry: a, score: 1000, snippet: "" },
      { entry: b, score: 0.001, snippet: "" },
    ];
    expect(ids(fuse(keyword, [{ entry: c, similarity: 0.5 }], 2))).toEqual(["a", "c"]);
  });
});

function fixtureEntry(id: string) {
  const f = fixture();
  writeEntry(f.layers.main!, { id, summary: `Summary of ${id}.` });
  return f.kb.getEntry(id)!;
}

describe("SemanticSearch", () => {
  it("finds an entry by meaning when no word matches", async () => {
    const f = knowledge();
    const semantic = new SemanticSearch(f.kb, fakeEmbedder());
    expect(f.kb.search("deploy", {}, 5)).toEqual([]); // the words alone find nothing

    const { hits, note } = await semantic.search("deploy", {}, 5, { wait: true });
    expect(ids(hits)[0]).toBe("release-checklist");
    expect(hits[0]!.via).toBe("meaning");
    expect(hits[0]!.similarity).toBeGreaterThan(hits[1]?.similarity ?? 0);
    expect(note).toBeUndefined();
  });

  it("ranks an entry found both ways above one found only by meaning", async () => {
    const f = knowledge();
    writeEntry(f.layers.main!, { id: "shipping-notes", title: "Notes", summary: "Misc.", body: "We ship on Fridays." });
    const semantic = new SemanticSearch(f.kb, fakeEmbedder());
    const { hits } = await semantic.search("ship", {}, 5, { wait: true });
    expect(hits[0]!.via).toBe("both");
    expect(ids(hits)).toContain("release-checklist");
  });

  it("respects filters", async () => {
    const f = knowledge();
    const semantic = new SemanticSearch(f.kb, fakeEmbedder());
    const { hits } = await semantic.search("credential", { type: "process" }, 10, { wait: true });
    expect(ids(hits)).not.toContain("rotate-keys");
    expect((await semantic.search("credential", { type: "skill" }, 10, { wait: true })).hits[0]!.entry.id).toBe("rotate-keys");
  });

  it("drops entries that match only by meaning below the similarity floor", async () => {
    const f = knowledge();
    const semantic = new SemanticSearch(f.kb, fakeEmbedder(), { minSimilarity: 0.95 });
    const { hits } = await semantic.search("deploy", {}, 5, { wait: true });
    expect(hits).toEqual([]);
  });

  it("answers an empty query with nothing", async () => {
    const f = knowledge();
    const semantic = new SemanticSearch(f.kb, fakeEmbedder());
    expect((await semantic.search("   ", {}, 5, { wait: true })).hits).toEqual([]);
  });

  it("answers at once with keyword results while vectors are still being made", async () => {
    const f = knowledge();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inner = fakeEmbedder();
    const slow: Embedder = {
      id: inner.id,
      async embed(texts) {
        if (texts.length > 1) await gate; // the entries wait; a single query does not
        return inner.embed(texts);
      },
    };
    const semantic = new SemanticSearch(f.kb, slow, { warn: () => {} });

    const early = await semantic.search("release", {}, 5);
    expect(ids(early.hits)).toEqual(["release-checklist"]);
    expect(early.hits[0]!.via).toBeUndefined();
    expect(early.note).toMatch(/still getting ready/);
    expect(semantic.status().embedded).toBe(0);

    release();
    await semantic.sync();
    expect(semantic.status()).toEqual({ total: 3, embedded: 3 });
    const late = await semantic.search("deploy", {}, 5);
    expect(late.hits[0]!.entry.id).toBe("release-checklist");
    expect(late.note).toBeUndefined();
  });

  it("makes vectors for entries added later, and drops them for entries that are removed", async () => {
    const f = knowledge();
    const embedder = fakeEmbedder();
    const semantic = new SemanticSearch(f.kb, embedder);
    await semantic.sync();
    expect(semantic.status()).toEqual({ total: 3, embedded: 3 });

    const added = writeEntry(f.layers.main!, { id: "code-review", title: "Code review", summary: "Give feedback.", body: "Be kind." });
    await semantic.sync();
    expect(semantic.status()).toEqual({ total: 4, embedded: 4 });
    expect(embedder.texts.filter((t) => t.startsWith("Code review"))).toHaveLength(1);

    unlinkSync(added);
    await semantic.sync();
    expect(semantic.status()).toEqual({ total: 3, embedded: 3 });
  });

  it("only re-embeds the entry that changed", async () => {
    const f = knowledge();
    const embedder = fakeEmbedder();
    const semantic = new SemanticSearch(f.kb, embedder);
    await semantic.sync();
    const before = embedder.texts.length;

    writeEntry(f.layers.main!, { id: "incident-response", title: "Incident response", summary: "What to do during an outage.", body: "Page the on-call engineer, then write it up." });
    await semantic.sync();
    expect(embedder.texts.length - before).toBe(1);
  });

  it("picks up an entry written while it was busy", async () => {
    const f = knowledge();
    const inner = fakeEmbedder();
    let wrote = false;
    const busy: Embedder = {
      id: inner.id,
      async embed(texts) {
        if (!wrote && texts.length > 1) {
          wrote = true;
          writeEntry(f.layers.main!, { id: "late-arrival", summary: "Arrived mid-run.", body: "A late entry about a release." });
        }
        return inner.embed(texts);
      },
    };
    const semantic = new SemanticSearch(f.kb, busy);
    await semantic.sync();
    expect(semantic.status()).toEqual({ total: 4, embedded: 4 });
  });

  it("runs one sync at a time", async () => {
    const f = knowledge();
    const embedder = fakeEmbedder();
    const semantic = new SemanticSearch(f.kb, embedder);
    await Promise.all([semantic.sync(), semantic.sync(), semantic.sync()]);
    expect(embedder.texts).toHaveLength(3);
  });

  describe("when the model cannot run", () => {
    const broken = (): Embedder => ({
      id: "broken:1",
      async embed() {
        throw new Error("model files are missing");
      },
    });

    it("still returns keyword results and says why", async () => {
      const f = knowledge();
      const warnings: string[] = [];
      const semantic = new SemanticSearch(f.kb, broken(), { warn: (m, kind) => warnings.push(`${kind}: ${m}`) });
      const { hits, note } = await semantic.search("release", {}, 5, { wait: true });
      expect(ids(hits)).toEqual(["release-checklist"]);
      expect(note).toMatch(/unavailable \(model files are missing\)/);
      expect(warnings).toEqual(["failure: search by meaning is unavailable: model files are missing"]);
      expect(semantic.status().failure).toBe("model files are missing");
    });

    it("does not retry on every search, but does after a minute", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const f = knowledge();
      let attempts = 0;
      const flaky: Embedder = {
        id: "flaky:1",
        async embed(texts) {
          attempts += 1;
          if (attempts === 1) throw new Error("offline");
          return fakeEmbedder().embed(texts);
        },
      };
      const semantic = new SemanticSearch(f.kb, flaky, { warn: () => {} });
      await semantic.search("release", {}, 5, { wait: true });
      expect(attempts).toBe(1);

      await semantic.search("release", {}, 5);
      await semantic.search("release", {}, 5);
      expect(attempts).toBe(1);

      vi.setSystemTime(Date.now() + 61_000);
      await semantic.search("release", {}, 5, { wait: true });
      const recovered = await semantic.search("deploy", {}, 5);
      expect(recovered.hits[0]!.entry.id).toBe("release-checklist");
      expect(semantic.status().failure).toBeUndefined();
    });

    it("falls back when only the query cannot be embedded", async () => {
      const f = knowledge();
      const inner = fakeEmbedder();
      const queryFails: Embedder = {
        id: inner.id,
        async embed(texts) {
          if (texts.length === 1) throw new Error("query failed");
          return inner.embed(texts);
        },
      };
      const semantic = new SemanticSearch(f.kb, queryFails, { warn: () => {} });
      const { hits, note } = await semantic.search("release", {}, 5, { wait: true });
      expect(ids(hits)).toEqual(["release-checklist"]);
      expect(note).toMatch(/query failed/);
    });

    it("rejects an embedder that returns the wrong number of vectors", async () => {
      const f = knowledge();
      const short: Embedder = { id: "short:1", embed: async () => [new Float32Array([1])] };
      const semantic = new SemanticSearch(f.kb, short, { warn: () => {} });
      await semantic.sync();
      expect(semantic.status().failure).toMatch(/wrong number of vectors/);
    });

    it("rejects a vector that is all zeros", async () => {
      const f = knowledge();
      const zeros: Embedder = { id: "zeros:1", embed: async (texts) => texts.map(() => new Float32Array(4)) };
      const semantic = new SemanticSearch(f.kb, zeros, { warn: () => {} });
      await semantic.sync();
      expect(semantic.status().failure).toMatch(/empty or not finite/);
    });
  });
});

describe("the vector cache", () => {
  const cachePath = (f: Fixture) => join(f.root, "cache", "vectors.json");

  it("lets a new run skip entries it already has vectors for", async () => {
    const f = knowledge();
    const first = fakeEmbedder();
    await new SemanticSearch(f.kb, first, { cacheFile: cachePath(f) }).sync();
    expect(first.texts).toHaveLength(3);

    const second = fakeEmbedder();
    const semantic = new SemanticSearch(f.kb, second, { cacheFile: cachePath(f) });
    const { hits } = await semantic.search("deploy", {}, 5, { wait: true });
    expect(ids(hits)[0]).toBe("release-checklist");
    expect(second.texts).toEqual(["deploy"]); // only the query was embedded
  });

  it("is private to the user and does not leave temporary files behind", async () => {
    const f = knowledge();
    await new SemanticSearch(f.kb, fakeEmbedder(), { cacheFile: cachePath(f) }).sync();
    expect(statSync(cachePath(f)).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(f.root, "cache"))).toEqual(["vectors.json"]);
  });

  it("holds each vector as compact text, not a list of numbers", async () => {
    const f = knowledge();
    await new SemanticSearch(f.kb, fakeEmbedder(), { cacheFile: cachePath(f) }).sync();
    const cache = JSON.parse(readFileSync(cachePath(f), "utf8"));
    expect(cache).toMatchObject({ format: 1, model: "fake:1", dim: 5 });
    expect(Object.keys(cache.vectors).sort()).toEqual(["incident-response", "release-checklist", "rotate-keys"]);
    expect(typeof cache.vectors["release-checklist"].v).toBe("string");
    expect(cache.vectors["release-checklist"].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is dropped without a complaint when another model made it", async () => {
    const f = knowledge();
    await new SemanticSearch(f.kb, fakeEmbedder("model-a"), { cacheFile: cachePath(f) }).sync();

    const warnings: string[] = [];
    const other = fakeEmbedder("model-b");
    await new SemanticSearch(f.kb, other, { cacheFile: cachePath(f), warn: (m) => warnings.push(m) }).sync();
    expect(other.texts).toHaveLength(3);
    expect(warnings).toEqual([]);
    expect(JSON.parse(readFileSync(cachePath(f), "utf8")).model).toBe("model-b");
  });

  it.each([
    ["is not JSON", "not json at all"],
    ["has the wrong shape", JSON.stringify({ format: 1, model: "fake:1" })],
    ["has a vector of the wrong length", JSON.stringify({ format: 1, model: "fake:1", dim: 5, vectors: { "rotate-keys": { hash: "a".repeat(64), v: "AAAA" } } })],
    ["has an unknown format", JSON.stringify({ format: 99, model: "fake:1", dim: 5, vectors: {} })],
  ])("is ignored, with a warning, when it %s", async (_name, content) => {
    const f = knowledge();
    mkdirSync(join(f.root, "cache"), { recursive: true });
    writeFileSync(cachePath(f), content);

    const warnings: string[] = [];
    const embedder = fakeEmbedder();
    const semantic = new SemanticSearch(f.kb, embedder, { cacheFile: cachePath(f), warn: (m, kind) => warnings.push(`${kind}: ${m}`) });
    await semantic.sync();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^cache: ignoring the vector cache/);
    expect(semantic.status()).toEqual({ total: 3, embedded: 3 });
    expect(embedder.texts).toHaveLength(3);
  });

  it("does not stop searching when it cannot be written", async () => {
    const f = knowledge();
    const blocker = join(f.root, "blocker");
    writeFileSync(blocker, "a file where a folder is needed");
    const warnings: string[] = [];
    const semantic = new SemanticSearch(f.kb, fakeEmbedder(), { cacheFile: join(blocker, "vectors.json"), warn: (m) => warnings.push(m) });
    const { hits } = await semantic.search("deploy", {}, 5, { wait: true });
    expect(ids(hits)[0]).toBe("release-checklist");
    expect(warnings.some((m) => /could not save the vector cache/.test(m))).toBe(true);
  });
});

describe("the semanticSearch setting", () => {
  const load = (setting: unknown, extra: Record<string, unknown> = {}) => {
    const dir = tempDir();
    writeFileSync(join(dir, "pocket.config.json"), JSON.stringify({ contentDirs: [{ scope: "main", path: "./content" }], semanticSearch: setting, ...extra }));
    return { dir, config: loadConfig({ cwd: dir, env: {} }) };
  };

  it("is off unless it is set", () => {
    expect(load(false).config.semantic).toBeUndefined();
    const dir = tempDir();
    writeFileSync(join(dir, "pocket.config.json"), JSON.stringify({ contentDirs: [{ scope: "main", path: "./content" }] }));
    expect(loadConfig({ cwd: dir, env: {} }).semantic).toBeUndefined();
    expect(loadConfig({ cwd: tempDir(), env: {} }).semantic).toBeUndefined();
  });

  it("turns on with a small default model when set to true", () => {
    const { dir, config } = load(true);
    expect(config.semantic).toEqual({
      model: "Xenova/all-MiniLM-L6-v2",
      dtype: "q8",
      cacheDir: join(dir, ".pocket", "embeddings"),
      minSimilarity: 0,
      baseDir: dir,
    });
  });

  it("takes a model, precision, cache folder and similarity floor", () => {
    const { dir, config } = load({ model: "Xenova/paraphrase-MiniLM-L6-v2", dtype: "fp16", cacheDir: "vectors", minSimilarity: 0.2 });
    expect(config.semantic).toMatchObject({ model: "Xenova/paraphrase-MiniLM-L6-v2", dtype: "fp16", cacheDir: join(dir, "vectors"), minSimilarity: 0.2 });
  });

  it("uses a model folder next to the config file in place of a Hugging Face id", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "models", "mine"), { recursive: true });
    writeFileSync(join(dir, "pocket.config.json"), JSON.stringify({ contentDirs: [{ scope: "main", path: "./content" }], semanticSearch: { model: "models/mine" } }));
    expect(loadConfig({ cwd: dir, env: {} }).semantic?.model).toBe(join(dir, "models", "mine"));
  });

  it.each([
    [{ dtype: "fp8" }, /semanticSearch/],
    [{ minSimilarity: 2 }, /semanticSearch/],
    [{ modle: "typo" }, /semanticSearch/],
    ["yes", /semanticSearch/],
  ])("rejects a setting that cannot work: %j", (setting, message) => {
    expect(() => load(setting)).toThrow(message);
  });
});
