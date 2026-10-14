export const ENTRY_STATUSES = ["draft", "active", "deprecated"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** A kind of knowledge entry. Users can add their own in the config file. */
export interface TypeDef {
  name: string;
  description: string;
  /** Extra frontmatter fields that must be present for this type. */
  requiredFields?: string[];
}

export const DEFAULT_TYPES: TypeDef[] = [
  {
    name: "library",
    description: "A reusable library, framework or tool: what it is for, when to use it, and how.",
  },
  {
    name: "process",
    description: "A repeatable way of working: steps, roles, inputs, outputs and checks.",
  },
  {
    name: "skill",
    description: "A capability or technique, with guidance for applying it well.",
  },
  {
    name: "script",
    description: "A runnable script or snippet, with its purpose, usage and caveats.",
  },
  {
    name: "pipeline",
    description: "An automated flow (build, deploy, data, review), its stages and failure handling.",
  },
  {
    name: "contract",
    description: "An agreement, interface or standard, and what it commits each party to.",
  },
  {
    name: "lesson-learned",
    description: "What happened, why, and what to do differently next time.",
  },
];

/** The validated frontmatter of an entry. */
export interface EntryMeta {
  id: string;
  type: string;
  title: string;
  summary: string;
  tags: string[];
  status: EntryStatus;
  version: number;
  created?: string;
  updated?: string;
  links: string[];
  source?: string;
  /** The license the content is available under, for example "Apache-2.0" or "CC-BY-4.0". */
  license?: string;
  /** "sha256:" and the hex digest of the original material this entry was imported from. */
  sourceHash?: string;
  /** Any additional frontmatter keys, preserved as written. */
  extra: Record<string, unknown>;
}

/** A loaded entry: frontmatter, Markdown body, and where it came from. */
export interface Entry extends EntryMeta {
  body: string;
  /** The content layer (scope) this entry was loaded from. */
  scope: string;
  /** Absolute path of the Markdown file. */
  filePath: string;
}

export interface Issue {
  level: "error" | "warning";
  scope: string;
  file: string;
  id?: string;
  message: string;
}
