#!/usr/bin/env node
import { cpSync, existsSync, readdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { diffLines } from "./diff.js";
import { serializeEntry } from "./frontmatter.js";
import { KnowledgeBase } from "./kb.js";
import { ProposalStore, approveProposal, rejectProposal, type Proposal } from "./proposals.js";
import { ENTRY_STATUSES, type EntryStatus } from "./types.js";

const HELP = `pocket: manage a body-of-knowledge content repo

Usage: pocket <command> [options]

Content
  validate                      Check every entry. Exits 1 on errors (--strict: on warnings too).
  list [--type t] [--tag t] [--status s] [--scope s]
  search <query> [--type t] [--limit n]
  show <id>                     Print one entry.
  types                         List entry types and layers.
  init <dir>                    Create a new content repo from the bundled template.

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
  console.log(`Proposal   ${proposal.proposalId} (${proposal.state})`);
  console.log(`Action     ${proposal.action} entry "${proposal.entryId}" in scope "${proposal.scope}"`);
  console.log(`Proposed   by ${proposal.proposedBy} at ${proposal.createdAt}`);
  console.log(`Rationale  ${proposal.rationale}`);
  if (proposal.decisionNote) console.log(`Decision   ${proposal.decisionNote}`);
  console.log("");

  const current = kb.getEntry(proposal.entryId);
  const proposedMeta = serializeEntry(proposal.entry.meta, "").trimEnd();
  if (proposal.action === "add" || !current) {
    console.log(proposedMeta);
    console.log("");
    console.log(proposal.entry.body);
    return;
  }

  const metaChanges = diffLines(serializeEntry(current, "").trimEnd(), proposedMeta).filter((l) => !l.startsWith(" "));
  const bodyChanges = diffLines(current.body.trim(), proposal.entry.body).filter((l) => !l.startsWith(" "));
  console.log(`Changes against version ${current.version}:`);
  console.log(metaChanges.length > 0 ? metaChanges.join("\n") : "(no metadata changes)");
  console.log("");
  console.log(bodyChanges.length > 0 ? bodyChanges.join("\n") : "(no body changes)");
}

async function proposalsCommand(args: string[]): Promise<void> {
  const [action, id] = args;
  const { kb, store } = open();

  if (action === "list") {
    const pending = store.list();
    if (values.json) return console.log(JSON.stringify(pending, null, 2));
    if (pending.length === 0) return console.log("No pending proposals.");
    for (const p of pending) {
      console.log(`${p.proposalId}  ${p.action.padEnd(6)} ${p.entryId}  (by ${p.proposedBy}) ${p.rationale}`);
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
      const { kb } = open();
      const limit = values.limit ? Number.parseInt(values.limit, 10) : 10;
      const hits = kb.search(query, values.type ? { type: values.type } : {}, Number.isFinite(limit) ? limit : 10);
      if (values.json) return console.log(JSON.stringify(hits.map((h) => ({ id: h.entry.id, score: h.score, title: h.entry.title, snippet: h.snippet })), null, 2));
      if (hits.length === 0) return console.log("No matches.");
      for (const hit of hits) console.log(`${hit.score.toFixed(2).padStart(6)}  ${hit.entry.id}  ${hit.entry.title}\n        ${hit.snippet}`);
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
