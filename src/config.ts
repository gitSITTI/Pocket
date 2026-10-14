import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { ID_PATTERN } from "./schema.js";
import { DEFAULT_TYPES, type TypeDef } from "./types.js";

export interface LayerConfig {
  /** Name of the layer, for example "global" or "project". */
  scope: string;
  /** Absolute path of the directory holding this layer's Markdown entries. */
  path: string;
}

export interface PocketConfig {
  /** Layers in precedence order: later layers override earlier ones on the same id. */
  contentDirs: LayerConfig[];
  /** Where pending proposals are written. */
  proposalsDir: string;
  /** When true, the MCP server exposes no write tools at all. */
  readOnly: boolean;
  types: TypeDef[];
  /**
   * Entry types offered as MCP prompts (slash commands), for active entries only.
   * Defaults to ["process"] when not set.
   */
  promptTypes?: string[];
  /** Optional search by meaning. Absent unless "semanticSearch" is set in the config file. */
  semantic?: SemanticConfig;
}

export interface SemanticConfig {
  /** A Hugging Face model id, or the absolute path of a folder holding a downloaded model. */
  model: string;
  /** Weight precision for transformers.js. "q8" is the small 8-bit build. */
  dtype: string;
  /** Where vectors and downloaded models are cached. Not committed. */
  cacheDir: string;
  /** Entries that match only by meaning are dropped below this cosine similarity. */
  minSimilarity: number;
  /** The folder the config file is in; used to find the optional package next to the knowledge base. */
  baseDir: string;
}

export const DEFAULT_PROMPT_TYPES = ["process"];
export const DEFAULT_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DTYPES = ["fp32", "fp16", "q8", "int8", "uint8", "q4", "bnb4", "q4f16"] as const;

const configSchema = z.object({
  contentDirs: z
    .array(
      z.object({
        scope: z.string().regex(ID_PATTERN, "scope must use lowercase letters, digits and hyphens"),
        path: z.string().min(1),
      }),
    )
    .min(1, "contentDirs needs at least one entry"),
  proposalsDir: z.string().min(1).optional(),
  readOnly: z.boolean().default(false),
  promptTypes: z.array(z.string().regex(ID_PATTERN, "prompt type names use lowercase letters, digits and hyphens")).default(DEFAULT_PROMPT_TYPES),
  semanticSearch: z
    .union([
      z.boolean(),
      z.strictObject({
        model: z.string().min(1).default(DEFAULT_EMBEDDING_MODEL),
        dtype: z.enum(EMBEDDING_DTYPES).default("q8"),
        cacheDir: z.string().min(1).optional(),
        minSimilarity: z.number().min(0).max(1).default(0),
      }),
    ])
    .default(false),
  types: z
    .array(
      z.object({
        name: z.string().regex(ID_PATTERN, "type name must use lowercase letters, digits and hyphens"),
        description: z.string().default(""),
        requiredFields: z.array(z.string().min(1)).default([]),
      }),
    )
    .default([]),
});

export interface LoadConfigOptions {
  /** Explicit config file path. Overrides POCKET_CONFIG. */
  configPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function mergeTypes(overrides: TypeDef[]): TypeDef[] {
  const merged = new Map<string, TypeDef>(DEFAULT_TYPES.map((t) => [t.name, { ...t }]));
  for (const override of overrides) {
    const existing = merged.get(override.name);
    merged.set(override.name, {
      name: override.name,
      description: override.description || existing?.description || "",
      requiredFields: override.requiredFields ?? existing?.requiredFields ?? [],
    });
  }
  return [...merged.values()];
}

/**
 * Resolve configuration from, in order: an explicit path, POCKET_CONFIG,
 * ./pocket.config.json, or (with no config file) POCKET_CONTENT_DIR / ./content
 * as a single layer.
 */
export function loadConfig(options: LoadConfigOptions = {}): PocketConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const explicit = options.configPath ?? env.POCKET_CONFIG;
  const configPath = resolve(cwd, explicit ?? "pocket.config.json");
  const readOnlyFromEnv = env.POCKET_READ_ONLY === "1";

  if (!existsSync(configPath)) {
    if (explicit) throw new Error(`Config file not found: ${configPath}`);
    return {
      contentDirs: [{ scope: "default", path: resolve(cwd, env.POCKET_CONTENT_DIR ?? "content") }],
      proposalsDir: resolve(cwd, env.POCKET_PROPOSALS_DIR ?? ".pocket/proposals"),
      readOnly: readOnlyFromEnv,
      types: mergeTypes([]),
      promptTypes: DEFAULT_PROMPT_TYPES,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${configPath}: ${(error as Error).message}`);
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`Invalid config ${configPath}: ${details}`);
  }

  const scopes = parsed.data.contentDirs.map((d) => d.scope);
  const duplicate = scopes.find((scope, index) => scopes.indexOf(scope) !== index);
  if (duplicate) throw new Error(`Invalid config ${configPath}: duplicate scope "${duplicate}"`);

  const configDir = dirname(configPath);
  const semantic = semanticConfig(parsed.data.semanticSearch, configDir);
  return {
    contentDirs: parsed.data.contentDirs.map((d) => ({ scope: d.scope, path: resolve(configDir, d.path) })),
    proposalsDir: resolve(configDir, env.POCKET_PROPOSALS_DIR ?? parsed.data.proposalsDir ?? ".pocket/proposals"),
    readOnly: parsed.data.readOnly || readOnlyFromEnv,
    types: mergeTypes(parsed.data.types),
    promptTypes: parsed.data.promptTypes,
    ...(semantic ? { semantic } : {}),
  };
}

function semanticConfig(setting: z.infer<typeof configSchema>["semanticSearch"], configDir: string): SemanticConfig | undefined {
  if (setting === false) return undefined;
  const options = setting === true ? { model: DEFAULT_EMBEDDING_MODEL, dtype: "q8", minSimilarity: 0, cacheDir: undefined } : setting;
  // A folder next to the config file wins over a Hugging Face id of the same shape, so a model can be
  // downloaded once and used offline.
  const folder = resolve(configDir, options.model);
  const isFolder = existsSync(folder) && statSync(folder).isDirectory();
  return {
    model: isFolder ? folder : options.model,
    dtype: options.dtype,
    cacheDir: resolve(configDir, options.cacheDir ?? ".pocket/embeddings"),
    minSimilarity: options.minSimilarity,
    baseDir: configDir,
  };
}
