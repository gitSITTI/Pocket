#!/usr/bin/env node
// Runs search by meaning the way a user would, against the built package (run `npm run build` first).
// It needs the optional package: npm install --no-save @huggingface/transformers
//
//   node scripts/semantic-smoke.mjs
//
// A tiny model from tests/fixtures/toy-model stands in for a real one, so nothing is downloaded.
// It checks `pocket index`, `pocket search` and the MCP search tool over stdio.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "pocket-smoke-"));
let failed = false;

function check(ok, what, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : detail ? `\n       ${detail}` : ""}`);
  if (!ok) failed = true;
}

try {
  mkdirSync(join(work, "content", "process"), { recursive: true });
  const entry = (id, title, summary, body) =>
    writeFileSync(join(work, "content", "process", `${id}.md`), `---\nid: ${id}\ntype: process\ntitle: ${title}\nsummary: ${summary}\nstatus: active\n---\n\n${body}\n`);
  entry("release-checklist", "Release checklist", "Steps before we ship.", "Run the tests, then tag the release.");
  entry("retry-policy", "Retry policy", "How to repeat a failed call.", "Use backoff for a transient failure.");
  entry("code-review", "Code review", "How we review a pull request.", "Leave feedback, then approve.");
  const config = join(work, "pocket.config.json");
  writeFileSync(config, JSON.stringify({ contentDirs: [{ scope: "main", path: "./content" }], semanticSearch: { model: join(root, "tests", "fixtures", "toy-model") } }));

  const cli = (...args) => spawnSync(process.execPath, [join(root, "dist", "cli.js"), "--config", config, ...args], { encoding: "utf8", cwd: work });

  // The command line.
  const index = cli("index");
  check(index.status === 0 && /3 of 3 entries are ready/.test(index.stdout), "pocket index prepares every entry", index.stderr + index.stdout);
  const cache = JSON.parse(readFileSync(join(work, ".pocket", "embeddings", "vectors.json"), "utf8"));
  check(Object.keys(cache.vectors).length === 3, "the vectors are cached under .pocket/embeddings");

  const search = cli("search", "publish deployment", "--json");
  const results = JSON.parse(search.stdout || "[]");
  check(results[0]?.id === "release-checklist" && results[0]?.matched === "meaning", "pocket search finds a release entry by meaning, with no shared word", search.stderr + search.stdout);

  // The MCP server over stdio. The first search may arrive while vectors are still being made.
  const client = new Client({ name: "smoke", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, "dist", "server.js")], cwd: work, env: { ...process.env, POCKET_CONFIG: config }, stderr: "pipe" }));
  let answer;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await client.callTool({ name: "search", arguments: { query: "publish deployment" } });
    answer = JSON.parse(result.content[0].text);
    if (answer.results[0]?.matched) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  check(answer?.results[0]?.id === "release-checklist" && answer.results[0].matched === "meaning", "the search tool finds it by meaning over stdio", JSON.stringify(answer));
  check(!answer?.note, "the answer carries no warning once vectors are ready", answer?.note);
  await client.close();
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failed) {
  console.error("\nsearch by meaning did not work end to end");
  process.exit(1);
}
console.log("\nsearch by meaning works end to end");
