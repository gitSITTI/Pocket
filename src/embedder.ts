import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { KnowledgeBase } from "./kb.js";
import type { PocketConfig, SemanticConfig } from "./config.js";
import { SemanticSearch, type Embedder, type SemanticOptions } from "./semantic.js";

// Typed as a plain string so TypeScript does not look for the package, which is optional.
const PACKAGE: string = "@huggingface/transformers";

const installHint = (baseDir: string): string =>
  `search by meaning needs the optional package ${PACKAGE}. Run \`npm install ${PACKAGE}\` in ${baseDir} ` +
  `(it is large; see docs/semantic-search.md), or remove "semanticSearch" from the config.`;

/** The small part of transformers.js that Pocket uses. */
interface TransformersModule {
  env: { localModelPath: string; allowRemoteModels: boolean; allowLocalModels: boolean; cacheDir: string };
  pipeline(task: "feature-extraction", model: string, options: { dtype: string }): Promise<Extractor>;
}
type Extractor = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

/**
 * True when `error` says the optional package itself cannot be found. The name must appear in
 * quotes: a package that is installed but misses one of its own dependencies mentions that other
 * name in the message, and that problem should be shown as it is, not as "please install".
 * Node, the CommonJS resolver and Vite each word the message differently.
 */
export function isMissingPackage(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Cannot find (?:package|module)|Could not resolve|Failed to resolve/i.test(message) && /['"]@huggingface\/transformers['"]/.test(message);
}

/**
 * Finds the optional package. It is looked up where Pocket is installed first, then next to the
 * config file, so a knowledge base repository can carry the package itself and be used with `npx`.
 */
async function loadTransformers(baseDir: string): Promise<TransformersModule> {
  try {
    return (await import(PACKAGE)) as TransformersModule;
  } catch (error) {
    if (!isMissingPackage(error)) throw error;
  }
  let resolved: string;
  try {
    resolved = createRequire(join(baseDir, "package.json")).resolve(PACKAGE);
  } catch (error) {
    if (isMissingPackage(error)) throw new Error(installHint(baseDir));
    throw error;
  }
  return (await import(pathToFileURL(resolved).href)) as TransformersModule;
}

/**
 * An embedder that runs a model on this machine with transformers.js. The package and the model are
 * loaded on first use, so a Pocket that never searches by meaning never pays for either.
 */
export function transformersEmbedder(config: SemanticConfig): Embedder {
  let extractor: Promise<Extractor> | undefined;

  const load = async (): Promise<Extractor> => {
    const transformers = await loadTransformers(config.baseDir);
    transformers.env.cacheDir = join(config.cacheDir, "models");
    let model = config.model;
    if (isAbsolute(model)) {
      // A folder on disk: use it as is and never reach out to the network.
      if (!existsSync(join(model, "config.json"))) throw new Error(`${model} does not look like a model folder (no config.json)`);
      transformers.env.allowRemoteModels = false;
      transformers.env.localModelPath = dirname(model);
      model = basename(model);
    }
    return transformers.pipeline("feature-extraction", model, { dtype: config.dtype });
  };

  return {
    id: `transformers.js:${config.model}:${config.dtype}`,
    async embed(texts) {
      extractor ??= load();
      let run: Extractor;
      try {
        run = await extractor;
      } catch (error) {
        extractor = undefined; // allow a later attempt, for example once the network is back
        throw error;
      }
      const output = await run(texts, { pooling: "mean", normalize: true });
      const size = output.dims[output.dims.length - 1]!;
      const data = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);
      return texts.map((_text, index) => data.slice(index * size, (index + 1) * size));
    },
  };
}

/** Search by meaning for a configured knowledge base, or nothing when it is not turned on. */
export function semanticSearchFor(kb: KnowledgeBase, config: PocketConfig, warn?: SemanticOptions["warn"]): SemanticSearch | undefined {
  const semantic = config.semantic;
  if (!semantic) return undefined;
  return new SemanticSearch(kb, transformersEmbedder(semantic), {
    cacheFile: join(semantic.cacheDir, "vectors.json"),
    minSimilarity: semantic.minSimilarity,
    ...(warn ? { warn } : {}),
  });
}
