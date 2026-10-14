# Roadmap

What Pocket may grow into, in rough priority order. Nothing here is promised or scheduled. Each item has a GitHub issue where the design gets discussed before any code is written.

Pocket's core stays small: Markdown files in git, no database, no native dependencies, and every agent write waits for a person's approval. Items that would break those rules ship as optional extensions.

## Why this order

Recent agent-skills research points the same way as Pocket's design:

- Skills written by people helped agents; skills the models wrote for themselves did not. In SkillsBench, curated skills raised pass rates by 16.2 points on average, self-generated skills gave no benefit, and focused skills of 2 to 3 modules beat comprehensive documentation. Sixteen of 84 tasks got worse with skills, so every entry needs a way to be measured. ([SkillsBench](https://huggingface.co/papers/2602.12670))
- Updates should be admitted on evidence, not on an agent's say-so. ([SkillsVote](https://huggingface.co/papers/2605.18401))
- Text in a skill description can steer which skills agents find and pick, and malicious skills passed a registry's governance check in 36.5% to 100% of the tested cases. Imported text needs provenance and review. ([Under the Hood of SKILL.md](https://huggingface.co/papers/2605.11418))
- Rewriting a context over and over erodes detail ("context collapse"). Small incremental updates keep it. ([Agentic Context Engineering](https://huggingface.co/papers/2510.04618))

## 1. Provenance, license and evidence

Status: done, in the unreleased version ([#3](https://github.com/gitSITTI/Pocket/issues/3)). See [docs/approval-flow.md](docs/approval-flow.md#what-the-reviewer-sees).

Entries already had a `source` field. This added:

- `license` and a content hash for imported material.
- An optional `evidence` block on proposals: the task, the outcome and a link to a trace or log.
- Review output (`pocket proposals show`) that always prints source, license and evidence, and highlights changes to `title`, `summary` and `tags`, because those are what steer retrieval.
- A warning when a description contains instruction-like text aimed at an agent.

## 2. Agent Skills import and export

Status: done, in the unreleased version ([#4](https://github.com/gitSITTI/Pocket/issues/4)). See [docs/agent-skills.md](docs/agent-skills.md).

`skill` entries map onto the open [Agent Skills format](https://agentskills.io/specification): a folder with a `SKILL.md`, a `name` of up to 64 lowercase letters, digits and hyphens that matches the folder name, and a `description` of up to 1,024 characters.

- `pocket export skills <dir>` writes a skill folder per `skill` entry.
- Import reads a skill folder and creates a proposal.
- Pocket's ID pattern allows `--` and a trailing hyphen, which the Agent Skills format forbids. Export skips such entries and says why.

## 3. MCP resources and prompts

Status: done, in the unreleased version ([#5](https://github.com/gitSITTI/Pocket/issues/5)). See [docs/resources-and-prompts.md](docs/resources-and-prompts.md).

Pocket exposes tools only. The MCP spec also defines:

- **Resources**, chosen by the application, with `lastModified` and `priority` annotations. A natural fit for entries, as `pocket://entry/<id>`, plus a list-changed notification.
- **Prompts**, chosen by the user, like slash commands. A natural fit for `process` and playbook entries.

See the [resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources) and [prompts](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts) pages.

## 4. Publish to the MCP Registry

Status: ready to release, not yet published ([#6](https://github.com/gitSITTI/Pocket/issues/6)). The metadata, checks and workflow are in place; the first release needs an npm account and token. See [docs/publishing.md](docs/publishing.md). The `.mcpb` bundle is not done.

- Add `mcpName` and `repository` to `package.json`, and a `server.json`.
- Publish from GitHub Actions with the `mcp-publisher` tool.
- Optionally ship a `.mcpb` bundle with [@anthropic-ai/mcpb](https://www.npmjs.com/package/@anthropic-ai/mcpb) (MIT).
- The registry is a preview and its docs warn that breaking changes or data resets may occur. See the [quickstart](https://modelcontextprotocol.io/registry/quickstart).

## 5. Optional semantic search

An extension, off by default, so the core keeps its zero-dependency search.

- Local embeddings with [@huggingface/transformers](https://www.npmjs.com/package/@huggingface/transformers) (Apache-2.0) and a small ONNX model. Candidates, all tagged Apache-2.0 on Hugging Face: [granite-embedding-30m-english](https://hf.co/ibm-granite/granite-embedding-30m-english) and [jina-embeddings-v2-small-en](https://hf.co/jinaai/jina-embeddings-v2-small-en).
- Optional reranker: [gte-reranker-modernbert-base](https://hf.co/Alibaba-NLP/gte-reranker-modernbert-base) or the smaller [ettin-reranker-17m-v1](https://hf.co/cross-encoder/ettin-reranker-17m-v1).
- BM25 and vector results merged by rank, with vectors cached in a plain file that is not committed.
- Not planned for now: sqlite-vec. It is at v0.1 and needs a native extension.

## 6. Retrieval and skill evals

- A small suite, run in CI, that checks the right entry comes back for a given question. [promptfoo](https://www.npmjs.com/package/promptfoo) (MIT) is the candidate runner.
- A recipe for measuring whether a skill helps an agent, modeled on [SkillsBench](https://huggingface.co/datasets/benchflow/skillsbench).
- An entry-quality lint: warn on entries that are very long or cover many topics.

## 7. Workflow and lesson entry types, append-only edits

- New types: `workflow` (a reusable routine) and `lesson`, where a lesson records failures as well as successes. Related work: [Agent Workflow Memory](https://huggingface.co/papers/2409.07429) and [ReasoningBank](https://huggingface.co/papers/2509.25140).
- A proposal kind that appends to a section instead of replacing the whole entry, so small additions do not rewrite what a person already approved.

## 8. `pocket import` with a license allowlist

- Imports always become proposals. Each records its source URL, license and a content hash.
- Default allowlist: Apache-2.0, MIT, CC0 and CC-BY. Non-commercial and AGPL sources are rejected unless the user overrides it.
- See [docs/content-sources.md](docs/content-sources.md) for sources whose licenses have been checked.

## Out of scope for the core

- Writing approved entries without a person (see [docs/approval-flow.md](docs/approval-flow.md)).
- Bundling third-party content in this repository. Content lives in your own repos.
- Copying code from projects whose licenses are incompatible with Apache-2.0, such as AGPL.
