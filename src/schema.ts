import { z } from "zod";
import { ENTRY_STATUSES, type EntryMeta, type TypeDef } from "./types.js";

/** Lowercase letters, digits and hyphens. Safe to use as a file name. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** The longest summary an entry may have, in characters. */
export const SUMMARY_MAX = 500;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date written as YYYY-MM-DD");

const idField = z
  .string()
  .max(80)
  .regex(ID_PATTERN, "must use lowercase letters, digits and hyphens, starting with a letter or digit");

/**
 * The frontmatter every entry must have. Unknown keys are allowed and kept.
 * The same rules are published as schema/entry.schema.json for editors.
 */
export const frontmatterSchema = z.looseObject({
  id: idField,
  type: z.string().min(1),
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(SUMMARY_MAX),
  tags: z.array(z.string().min(1)).default([]),
  status: z.enum(ENTRY_STATUSES).default("draft"),
  version: z.number().int().positive().default(1),
  created: isoDate.optional(),
  updated: isoDate.optional(),
  links: z.array(idField).default([]),
  source: z.string().min(1).optional(),
  license: z.string().trim().min(1).max(100).optional(),
  sourceHash: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/, 'must be "sha256:" followed by 64 lowercase hex characters')
    .optional(),
});

const KNOWN_KEYS = new Set(Object.keys(frontmatterSchema.shape));

export class TypeRegistry {
  private readonly byName = new Map<string, TypeDef>();

  constructor(defs: TypeDef[]) {
    for (const def of defs) this.byName.set(def.name, def);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  get(name: string): TypeDef | undefined {
    return this.byName.get(name);
  }

  list(): TypeDef[] {
    return [...this.byName.values()];
  }

  names(): string[] {
    return [...this.byName.keys()];
  }
}

export type ParseMetaResult = { ok: true; meta: EntryMeta } | { ok: false; errors: string[] };

/** Validate raw frontmatter against the schema and the configured entry types. */
export function parseMeta(raw: unknown, types: TypeRegistry): ParseMetaResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["frontmatter must be a YAML mapping of keys to values"] };
  }

  const result = frontmatterSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    };
  }

  const data = result.data;
  const errors: string[] = [];

  const typeDef = types.get(data.type);
  if (!typeDef) {
    errors.push(`type: unknown type "${data.type}" (known types: ${types.names().join(", ")})`);
  } else {
    for (const field of typeDef.requiredFields ?? []) {
      const value = (data as Record<string, unknown>)[field];
      const empty =
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "") ||
        (Array.isArray(value) && value.length === 0);
      if (empty) errors.push(`${field}: required for type "${data.type}"`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value;
  }

  const meta: EntryMeta = {
    id: data.id,
    type: data.type,
    title: data.title,
    summary: data.summary,
    tags: data.tags,
    status: data.status,
    version: data.version,
    links: data.links,
    extra,
  };
  if (data.created !== undefined) meta.created = data.created;
  if (data.updated !== undefined) meta.updated = data.updated;
  if (data.source !== undefined) meta.source = data.source;
  if (data.license !== undefined) meta.license = data.license;
  if (data.sourceHash !== undefined) meta.sourceHash = data.sourceHash;
  return { ok: true, meta };
}
