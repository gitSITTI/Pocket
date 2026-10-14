// Public API for building on pocket.
export { loadConfig, type PocketConfig, type LayerConfig, type LoadConfigOptions } from "./config.js";
export { KnowledgeBase, summarize, type EntryFilter, type EntrySummary } from "./kb.js";
export { splitFrontmatter, serializeEntry } from "./frontmatter.js";
export { createServer } from "./mcp.js";
export {
  ProposalStore,
  approveProposal,
  proposeAdd,
  proposeUpdate,
  rejectProposal,
  type Proposal,
} from "./proposals.js";
export { ID_PATTERN, TypeRegistry, frontmatterSchema, parseMeta } from "./schema.js";
export { SearchIndex, tokenize, type SearchHit } from "./search.js";
export { DEFAULT_TYPES, ENTRY_STATUSES, type Entry, type EntryMeta, type EntryStatus, type Issue, type TypeDef } from "./types.js";
