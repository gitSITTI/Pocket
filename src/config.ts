import { existsSync, readFileSync } from "node:fs";
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
}

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
  return {
    contentDirs: parsed.data.contentDirs.map((d) => ({ scope: d.scope, path: resolve(configDir, d.path) })),
    proposalsDir: resolve(configDir, env.POCKET_PROPOSALS_DIR ?? parsed.data.proposalsDir ?? ".pocket/proposals"),
    readOnly: parsed.data.readOnly || readOnlyFromEnv,
    types: mergeTypes(parsed.data.types),
  };
}
