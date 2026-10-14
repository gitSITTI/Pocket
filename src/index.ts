// Public API for building on pocket.
export { DEFAULT_PROMPT_TYPES, loadConfig, type PocketConfig, type LayerConfig, type LoadConfigOptions } from "./config.js";
export { KnowledgeBase, summarize, type EntryFilter, type EntrySummary } from "./kb.js";
export { splitFrontmatter, serializeEntry } from "./frontmatter.js";
export { createChangeNotifier, createServer, watchForChanges } from "./mcp.js";
export {
  ProposalStore,
  approveProposal,
  proposeAdd,
  proposeUpdate,
  rejectProposal,
  evidenceSchema,
  type Evidence,
  type Proposal,
} from "./proposals.js";
export { lintEntry, type LintFinding } from "./lint.js";
export { renderProposal, reviewNotes } from "./review.js";
export { hasHiddenCharacters, makeVisible } from "./sanitize.js";
export { ID_PATTERN, SUMMARY_MAX, TypeRegistry, frontmatterSchema, parseMeta } from "./schema.js";
export {
  checkSkillName,
  entryToSkillMd,
  exportSkills,
  importSkills,
  parseSkillMd,
  type ExportItem,
  type ExportOptions,
  type ImportItem,
  type ImportOptions,
  type SkillDocument,
} from "./skills.js";
export { SearchIndex, tokenize, type SearchHit } from "./search.js";
export { DEFAULT_TYPES, ENTRY_STATUSES, type Entry, type EntryMeta, type EntryStatus, type Issue, type TypeDef } from "./types.js";
