import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SemanticConfig } from "../src/config.js";
import { isMissingPackage, semanticSearchFor, transformersEmbedder } from "../src/embedder.js";
import { fixture, tempDir, writeEntry } from "./helpers.js";

/**
 * These tests run the real @huggingface/transformers and onnxruntime on a tiny model kept in
 * tests/fixtures/toy-model. The model has no language knowledge: words in the same group (ship,
 * release, deploy) simply get nearly the same vector. What is tested is the whole path: finding
 * the package, loading a model folder, tokenizing, running ONNX, pooling, and the search on top.
 *
 * The package is optional, so without it these tests are skipped. CI has a job that installs it and
 * sets POCKET_REQUIRE_SEMANTIC_TESTS=1, which turns a missing package into a failure.
 */
const installed = (() => {
  try {
    createRequire(import.meta.url).resolve("@huggingface/transformers");
    return true;
  } catch {
    return false;
  }
})();
const required = process.env.POCKET_REQUIRE_SEMANTIC_TESTS === "1";

const toyModel = join(import.meta.dirname, "fixtures", "toy-model");

function toyConfig(overrides: Partial<SemanticConfig> = {}): SemanticConfig {
  const dir = tempDir();
  return { model: toyModel, dtype: "q8", cacheDir: join(dir, "embeddings"), minSimilarity: 0, baseDir: dir, ...overrides };
}

const cosine = (a: Float32Array, b: Float32Array): number => a.reduce((sum, x, i) => sum + x * b[i]!, 0);

it.runIf(required)("has the optional package when it is required", () => {
  expect(installed).toBe(true);
});

describe.skipIf(!installed)("the transformers.js embedder", () => {
  it("returns one unit-length vector per text", async () => {
    const embedder = transformersEmbedder(toyConfig());
    const vectors = await embedder.embed(["how do we ship a release", "retry with backoff", "xyzzy unknown words"]);
    expect(vectors).toHaveLength(3);
    for (const vector of vectors) {
      expect(vector).toBeInstanceOf(Float32Array);
      expect(vector).toHaveLength(16);
      expect(Math.sqrt(cosine(vector, vector))).toBeCloseTo(1, 4);
    }
  });

  it("puts texts with the same meaning close together", async () => {
    const embedder = transformersEmbedder(toyConfig());
    const [query, release, retry] = await embedder.embed(["publish the deployment", "how do we ship a release", "retry with backoff"]);
    expect(cosine(query!, release!)).toBeGreaterThan(0.9);
    expect(cosine(query!, retry!)).toBeLessThan(0.2);
  });

  it("gives the same vector for a text whatever it is batched with", async () => {
    const embedder = transformersEmbedder(toyConfig());
    const [alone] = await embedder.embed(["secret token leak"]);
    const [together] = await embedder.embed(["secret token leak", "a much longer text about the release and the review of code before we ship"]);
    expect(cosine(alone!, together!)).toBeGreaterThan(0.999);
  });

  it("names the model and precision so a changed setting never reuses old vectors", () => {
    expect(transformersEmbedder(toyConfig()).id).toBe(`transformers.js:${toyModel}:q8`);
    expect(transformersEmbedder(toyConfig({ dtype: "fp32" })).id).toBe(`transformers.js:${toyModel}:fp32`);
  });

  it("explains a model folder that is not one, and can be tried again", async () => {
    const empty = tempDir();
    const embedder = transformersEmbedder(toyConfig({ model: empty }));
    await expect(embedder.embed(["x"])).rejects.toThrow(/does not look like a model folder/);
    await expect(embedder.embed(["x"])).rejects.toThrow(/does not look like a model folder/);
  });

  it("does not try the network for a model folder", async () => {
    const embedder = transformersEmbedder(toyConfig({ model: join(toyModel, "missing") }));
    await expect(embedder.embed(["x"])).rejects.toThrow(/does not look like a model folder/);
  });

  it("searches a knowledge base by meaning end to end", async () => {
    const f = fixture();
    writeEntry(f.layers.main!, { id: "release-checklist", title: "Release checklist", summary: "Steps before we ship.", body: "Run the tests, then tag the release." });
    writeEntry(f.layers.main!, { id: "retry-policy", title: "Retry policy", summary: "How to repeat a failed call.", body: "Use backoff for a transient failure." });
    writeEntry(f.layers.main!, { id: "code-review", title: "Code review", summary: "How we review a pull request.", body: "Leave feedback, then approve." });

    const config = toyConfig();
    const semantic = semanticSearchFor(f.kb, { ...f.config, semantic: config }, () => {})!;
    expect(f.kb.search("publish deployment", {}, 5)).toEqual([]); // no shared words

    const { hits, note } = await semantic.search("publish deployment", {}, 3, { wait: true });
    expect(note).toBeUndefined();
    expect(hits[0]!.entry.id).toBe("release-checklist");
    expect(hits[0]!.via).toBe("meaning");
    expect(hits[0]!.similarity).toBeGreaterThan(0.5);

    // A second start reuses the cache written by the first.
    const again = semanticSearchFor(f.kb, { ...f.config, semantic: config }, () => {})!;
    await again.sync();
    expect(again.status()).toEqual({ total: 3, embedded: 3 });
  });
});

describe.skipIf(installed)("without the optional package", () => {
  it("says how to install it, and search keeps working by keyword", async () => {
    const f = fixture();
    writeEntry(f.layers.main!, { id: "release-checklist", title: "Release checklist", summary: "Steps before we ship.", body: "Tag the release." });
    const warnings: string[] = [];
    const semantic = semanticSearchFor(f.kb, { ...f.config, semantic: toyConfig() }, (m) => warnings.push(m))!;

    const { hits, note } = await semantic.search("release", {}, 5, { wait: true });
    expect(hits.map((h) => h.entry.id)).toEqual(["release-checklist"]);
    expect(note).toMatch(/npm install @huggingface\/transformers/);
    expect(warnings).toHaveLength(1);
  });
});

describe("isMissingPackage", () => {
  it.each([
    ["Node ESM", "Cannot find package '@huggingface/transformers' imported from /app/dist/embedder.js"],
    ["Node CommonJS", "Cannot find module '@huggingface/transformers'\nRequire stack:\n- /app/x.js"],
    ["Vite", 'Could not resolve "@huggingface/transformers" imported by "pocket-bok".'],
  ])("recognizes the message from %s", (_runtime, message) => {
    expect(isMissingPackage(new Error(message))).toBe(true);
  });

  it("does not hide an installed package that is broken", () => {
    const path = "/app/node_modules/@huggingface/transformers/dist/transformers.node.mjs";
    expect(isMissingPackage(new Error(`Cannot find package 'onnxruntime-node' imported from ${path}`))).toBe(false);
    expect(isMissingPackage(new Error(`Cannot find module 'onnxruntime-node'\nRequire stack:\n- ${path}`))).toBe(false);
    expect(isMissingPackage(new Error("invalid ELF header"))).toBe(false);
    expect(isMissingPackage("something else")).toBe(false);
  });
});

describe("semanticSearchFor", () => {
  it("is nothing unless the setting is on", () => {
    const f = fixture();
    expect(semanticSearchFor(f.kb, f.config)).toBeUndefined();
  });
});
