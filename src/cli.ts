#!/usr/bin/env node
import { cpSync, existsSync, readdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig, type PocketConfig } from "./config.js";
import { semanticSearchFor } from "./embedder.js";
import { serializeEntry } from "./frontmatter.js";
import { KnowledgeBase } from "./kb.js";
import { ProposalStore, approveProposal, rejectProposal, type Proposal } from "./proposals.js";
import { renderProposal } from "./review.js";
import { makeVisible } from "./sanitize.js";
import { exportSkills, importSkills } from "./skills.js";
import { ENTRY_STATUSES, type EntryStatus } from "./types.js";

const HELP = `pocket: manage a body-of-knowledge content repo

Usage: pocket <command> [options]

Content
  validate                      Check every entry. Exits 1 on errors (--strict: on warnings too).
  list [--type t] [--tag t] [--status s] [--scope s]
  search <query> [--type t] [--limit n]
                                Words and, when "semanticSearch" is on in the config, meaning too.
  index                         Prepare search by meaning now (the first run downloads a model).
  show <id>                     Print one entry.
  types                         List entry types and layers.
  init <dir>                    Create a new content repo from the bundled template.

Agent Skills (open format: a folder with a SKILL.md, see https://agentskills.io)
  export skills <dir> [--type t] [--status s | --all]
                                Write each skill entry to <dir>/<id>/SKILL.md (active entries by default).
  import skills <dir> --source <where from> [--license id] [--type t] [--tag a,b] [--scope s] [--dry-run]
                                Turn skill folders into proposals. A person still approves each one.

Proposals (human review of changes suggested by agents)
  proposals list
  proposals show <proposal-id>
  proposals approve <proposal-id> [--status active] [--note text] [--yes]
  proposals reject <proposal-id> [--note text] [--yes]

Options
  --config <path>               Config file (default: POCKET_CONFIG or ./pocket.config.json)
  --json                        Machine-readable output where supported
  -h, --help
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    type: { type: "string" },
    tag: { type: "string" },
    status: { type: "string" },
    scope: { type: "string" },
    limit: { type: "string" },
    note: { type: "string" },
    source: { type: "string" },
    license: { type: "string" },
    all: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseStatus(value: string | undefined): EntryStatus | undefined {
  if (value === undefined) return undefined;
  if (!(ENTRY_STATUSES as readonly string[]).includes(value)) {
    fail(`--status must be one of: ${ENTRY_STATUSES.join(", ")}`);
  }
  return value as EntryStatus;
}

function open() {
  const config = loadConfig(values.config ? { configPath: values.config } : {});
  return { config, kb: new KnowledgeBase(config), store: new ProposalStore(config.proposalsDir) };
}

/** Search by meaning for this run. A failure to run is reported once, by the command itself, so only cache problems are logged. */
function openSemantic(config: PocketConfig, kb: KnowledgeBase) {
  return semanticSearchFor(kb, config, (message, kind) => {
    if (kind === "cache") console.error(`pocket: ${message}`);
  });
}

async function confirm(question: string): Promise<boolean> {
  if (values.yes) return true;
  if (!process.stdin.isTTY) {
    fail("This needs an interactive terminal to confirm. Run it yourself, or pass --yes in a script you control.");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function printProposal(kb: KnowledgeBase, proposal: Proposal): void {
  console.log(renderProposal(kb, proposal));
}

async function proposalsCommand(args: string[]): Promise<void> {
  const [action, id] = args;
  const { kb, store } = open();

  if (action === "list") {
    const pending = store.list();
    if (values.json) return console.log(JSON.stringify(pending, null, 2));
    if (pending.length === 0) return console.log("No pending proposals.");
    for (const p of pending) {
      // proposedBy and rationale come from the proposer, so show them safely on one line.
      const line = `${p.proposalId}  ${p.action.padEnd(6)} ${p.entryId}  (by ${p.proposedBy}) ${p.rationale}`;
      console.log(makeVisible(line.replace(/\s+/g, " ")).text);
    }
    return;
  }

  if (!id) fail("Missing proposal id. Try: pocket proposals list");

  if (action === "show") return printProposal(kb, store.get(id));

  if (action === "approve") {
    kb.refresh(true);
    printProposal(kb, store.get(id));
    console.log("");
    if (!(await confirm("Approve and write this entry?"))) fail("Not approved.");
    const status = parseStatus(values.status);
    const result = approveProposal(kb, store, id, {
      ...(status ? { status } : {}),
      ...(values.note ? { note: values.note } : {}),
    });
    console.log(`Approved. Wrote ${result.path} (version ${result.version}).`);
    console.log("Review the change with git diff, then commit it.");
    return;
  }

  if (action === "reject") {
    printProposal(kb, store.get(id));
    console.log("");
    if (!(await confirm("Reject this proposal?"))) fail("Not rejected.");
    rejectProposal(store, id, values.note);
    console.log("Rejected.");
    return;
  }

  fail("Unknown proposals command. Use list, show, approve or reject.");
}

function initCommand(target: string | undefined): void {
  if (!target) fail("Usage: pocket init <dir>");
  const destination = resolve(target);
  if (existsSync(destination) && readdirSync(destination).length > 0) {
    fail(`${destination} already exists and is not empty.`);
  }
  const template = fileURLToPath(new URL("../template/", import.meta.url));
  if (!existsSync(template)) fail("The bundled template folder was not found.");
  cpSync(template, destination, { recursive: true });
  // npm drops files named .gitignore from packages, so the template ships it as _gitignore.
  const ignore = resolve(destination, "_gitignore");
  if (existsSync(ignore)) renameSync(ignore, resolve(destination, ".gitignore"));
  console.log(`Created a new content repo at ${destination}`);
  console.log("Next: cd into it, run `git init`, `sh scripts/setup-hooks.sh`, and add your first entry.");
}

async function main(): Promise<void> {
  const [command, ...rest] = positionals;
  if (values.help || !command || command === "help") return console.log(HELP);

  switch (command) {
    case "init":
      return initCommand(rest[0]);

    case "proposals":
      return proposalsCommand(rest);

    case "export": {
      if (rest[0] !== "skills" || !rest[1]) fail("Usage: pocket export skills <dir> [--type t] [--status s | --all]");
      const { kb } = open();
      const status = parseStatus(values.status);
      const items = exportSkills(kb, resolve(rest[1]), {
        ...(values.type ? { type: values.type } : {}),
        statuses: values.all ? "all" : status ? [status] : ["active"],
      });
      if (values.json) console.log(JSON.stringify(items, null, 2));
      else {
        for (const item of items) {
          if (item.path) console.log(`wrote    ${item.path}`);
          else console.log(`skipped  ${makeVisible(item.id).text}: ${makeVisible(item.errors.join("; ")).text}`);
        }
        const wrote = items.filter((item) => item.path).length;
        console.log(items.length === 0 ? "No matching entries to export." : `${wrote} exported, ${items.length - wrote} skipped`);
      }
      if (items.some((item) => item.errors.length > 0)) process.exit(1);
      return;
    }

    case "import": {
      if (rest[0] !== "skills" || !rest[1]) fail("Usage: pocket import skills <dir> --source <where from> [--license id] [--tag a,b] [--dry-run]");
      if (!values.source) fail("--source is required: say where these skills came from, for example the repository URL.");
      const { kb, store } = open();
      const tags = values.tag
        ? values.tag
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined;
      const dryRun = values["dry-run"] === true;
      const items = importSkills(kb, store, resolve(rest[1]), {
        source: values.source,
        dryRun,
        ...(values.license ? { license: values.license } : {}),
        ...(values.type ? { type: values.type } : {}),
        ...(values.scope ? { scope: values.scope } : {}),
        ...(tags ? { tags } : {}),
      });
      if (values.json) console.log(JSON.stringify(items, null, 2));
      else {
        for (const item of items) {
          const label = item.outcome === "proposed-update" ? "update" : item.outcome;
          console.log(`${label.padEnd(10)} ${makeVisible(item.name).text}${item.proposalId ? `  ${item.proposalId}` : ""}`);
          for (const error of item.errors) console.log(`           error: ${makeVisible(error).text}`);
          for (const warning of item.warnings) console.log(`           note: ${makeVisible(warning).text}`);
        }
        const count = (outcome: string) => items.filter((item) => item.outcome === outcome).length;
        console.log(
          `${count("proposed")} new, ${count("proposed-update")} update(s), ${count("unchanged")} unchanged, ${count("invalid")} invalid`,
        );
        console.log(dryRun ? "Dry run: no proposals were created." : "Review with: pocket proposals list");
      }
      if (items.some((item) => item.outcome === "invalid")) process.exit(1);
      return;
    }

    case "validate": {
      const { kb } = open();
      const issues = kb.issues();
      const errors = issues.filter((i) => i.level === "error");
      const warnings = issues.filter((i) => i.level === "warning");
      if (values.json) {
        console.log(JSON.stringify({ entries: kb.listEntries().length, errors: errors.length, warnings: warnings.length, issues }, null, 2));
      } else {
        for (const issue of issues) {
          console.log(`${issue.level.toUpperCase().padEnd(7)} [${issue.scope}] ${issue.file}: ${issue.message}`);
        }
        console.log(`${kb.listEntries().length} entries, ${errors.length} error(s), ${warnings.length} warning(s)`);
      }
      if (errors.length > 0 || (values.strict && warnings.length > 0)) process.exit(1);
      return;
    }

    case "list": {
      const { kb } = open();
      const status = parseStatus(values.status);
      const entries = kb.listEntries({
        ...(values.type ? { type: values.type } : {}),
        ...(values.tag ? { tag: values.tag } : {}),
        ...(status ? { status } : {}),
        ...(values.scope ? { scope: values.scope } : {}),
      });
      if (values.json) return console.log(JSON.stringify(entries.map(({ body: _body, filePath: _path, ...rest }) => rest), null, 2));
      for (const e of entries) console.log(`${e.type.padEnd(15)} ${e.id.padEnd(32)} ${e.status.padEnd(10)} ${e.title}`);
      console.log(`${entries.length} entries`);
      return;
    }

    case "search": {
      const query = rest.join(" ").trim();
      if (!query) fail("Usage: pocket search <query>");
      const { config, kb } = open();
      const limit = values.limit ? Number.parseInt(values.limit, 10) : 10;
      const count = Number.isFinite(limit) ? limit : 10;
      const filter = values.type ? { type: values.type } : {};
      const semantic = openSemantic(config, kb);
      // A one-off command has no later chance to use background work, so wait for the vectors.
      const { hits, note } = semantic ? await semantic.search(query, filter, count, { wait: true }) : { hits: kb.search(query, filter, count), note: undefined };
      if (note) console.error(note);
      if (values.json) {
        return console.log(
          JSON.stringify(
            hits.map((h) => ({
              id: h.entry.id,
              score: h.score,
              title: h.entry.title,
              snippet: h.snippet,
              ...(h.via ? { matched: h.via } : {}),
              ...(h.similarity !== undefined ? { similarity: h.similarity } : {}),
            })),
            null,
            2,
          ),
        );
      }
      if (hits.length === 0) return console.log("No matches.");
      for (const hit of hits) {
        const how = hit.via ? `  (${hit.via === "both" ? "words + meaning" : hit.via === "meaning" ? "meaning" : "words"})` : "";
        console.log(`${hit.score.toFixed(2).padStart(6)}  ${hit.entry.id}  ${hit.entry.title}${how}\n        ${hit.snippet}`);
      }
      return;
    }

    case "index": {
      const { config, kb } = open();
      const semantic = openSemantic(config, kb);
      if (!semantic) fail('Search by meaning is not turned on. Add "semanticSearch": true to the config file (see docs/semantic-search.md).');
      console.error("Preparing search by meaning. The first run downloads the model (about 23 MB) and can take a minute.");
      await semantic.sync();
      const { total, embedded, failure } = semantic.status();
      if (failure) fail(`Could not prepare search by meaning: ${failure}`);
      console.log(`${embedded} of ${total} entries are ready for search by meaning.`);
      return;
    }

    case "show": {
      if (!rest[0]) fail("Usage: pocket show <id>");
      const { kb } = open();
      const entry = kb.getEntry(rest[0]);
      if (!entry) fail(`No entry with id "${rest[0]}".`);
      return console.log(serializeEntry(entry, entry.body));
    }

    case "types": {
      const { kb } = open();
      console.log(`Layers (least to most specific): ${kb.scopes().join(" -> ")}`);
      const all = kb.listEntries();
      for (const t of kb.types.list()) {
        console.log(`${t.name.padEnd(16)} ${String(all.filter((e) => e.type === t.name).length).padStart(3)}  ${t.description}`);
      }
      return;
    }

    default:
      fail(`Unknown command "${command}".\n\n${HELP}`);
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
