# Content sources

Pocket ships no third-party content. This page lists open sources that are good candidates for your own content repository, with what their repository pages said about licensing when checked on 2026-10-14.

Always read the LICENSE file in the source repository before importing. A page summary is not a license check, and a repository's license may not cover every file in it.

## Checked

| Source | License | Good for |
| --- | --- | --- |
| [google/eng-practices](https://github.com/google/eng-practices) | CC-BY 3.0 | `process` entries on code review, for reviewers and authors |
| [ossf/wg-best-practices-os-developers](https://github.com/ossf/wg-best-practices-os-developers) | Documentation CC-BY-4.0, software Apache-2.0 | Secure coding guides (Python, npm), guidance for AI assistant instructions, concise secure-development guides |
| [microsoft/ai-agents-for-beginners](https://github.com/microsoft/ai-agents-for-beginners) | MIT | Lessons on tool use, planning, multi-agent design, memory, context engineering and securing agents |
| [huggingface/agents-course](https://github.com/huggingface/agents-course) | Apache-2.0 (repository license; no separate content license shown) | Course units on agents and agentic RAG, for teaching material |
| [exercism/problem-specifications](https://github.com/exercism/problem-specifications) | MIT | Exercise descriptions and canonical test data, for interactive teaching |
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | Apache-2.0 for new contributions, MIT for existing code | Reference MCP servers, including a knowledge-graph memory server |

CC-BY content requires attribution. Record the author, title, source URL and license in the entry's `source` and `license` fields (see [ROADMAP.md](../ROADMAP.md)) and keep a credit line in the body.

## Check before using

- **[anthropics/skills](https://github.com/anthropics/skills):** many skills are Apache-2.0, but the `docx`, `pdf`, `pptx` and `xlsx` skills are source-available, not open source. Check each skill's folder.
- **[architecture-decision-record templates](https://github.com/joelparkerhenderson/architecture-decision-record):** the repository links to a LICENSE.md, but the license type was not confirmed. Read it first. Individual templates it lists (such as MADR) may have their own terms.
- **Exercism exercise descriptions:** the repository is MIT, but whether the descriptions carry a separate Creative Commons license was not confirmed.

## Tools that pair with Pocket

- [morluto/rea](https://github.com/morluto/rea) (MIT): an MCP server for reverse engineering binaries, JavaScript and Electron apps, .NET assemblies and websites. It produces evidence; Pocket keeps the approved conclusions. See [reverse-engineering.md](reverse-engineering.md).

## Datasets for testing, not for bundling

An aggregate dataset's license does not relicense the items inside it. Use these to test retrieval and review tooling, not as shipped content.

- [LittleDinoC/agent-skills](https://hf.co/datasets/LittleDinoC/agent-skills): 61,650 skills collected from GitHub, tagged MIT.
- [agent-skills-security-grades](https://hf.co/datasets/jasonzhuyansen/agent-skills-security-grades): security and quality grades for 130,173 skills and MCP servers, tagged CC-BY-4.0.
- [benchflow/skillsbench](https://hf.co/datasets/benchflow/skillsbench): the SkillsBench tasks and curated skills.

## Not acceptable by default

Content under non-commercial licenses (for example CC-BY-NC) and code under AGPL. They cannot be mixed into an Apache-2.0 project or a company's internal base without legal review.
