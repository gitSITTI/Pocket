// The last step: does the generated connector really work? Start the demo app, start the generated
// MCP server against it, and make real tool calls over stdio the way an MCP client would.
//
//   node pipeline/verify.mjs [--token-env NAME]    (run `node pipeline/run.mjs` first to build the connector)
//
// NAME is the environment variable the generated server reads the bearer token from. It is
// BEARER_TOKEN_ plus the upper-cased security scheme name, which pipeline/run.mjs works out for you.
//
// For a real app this is the check only you can do, with your own account. See the checklist in
// docs/building-connectors.md.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DEMO_USER, startApp } from "../app/server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokenEnvIndex = process.argv.indexOf("--token-env");
const TOKEN_ENV = tokenEnvIndex === -1 ? "BEARER_TOKEN_SESSIONTOKEN" : process.argv[tokenEnvIndex + 1];
const entry = join(root, "build", "connector", "build", "index.js");
if (!existsSync(entry)) {
  console.error("The connector is not built. Run: node pipeline/run.mjs");
  process.exit(1);
}

let failed = false;
function check(ok, what, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : detail ? `\n       ${detail}` : ""}`);
  if (!ok) failed = true;
}

/** The generated server answers with text: "API Response (Status: 200):" and the JSON body, or "API Error: ...". */
function parse(result) {
  const text = result.content?.[0]?.text ?? "";
  const start = text.search(/[{[]/);
  return { text, ok: text.startsWith("API Response"), json: start === -1 ? undefined : safeParse(text.slice(start)) };
}
const safeParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

async function connect(app, token) {
  const client = new Client({ name: "verify", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env: { ...process.env, API_BASE_URL: `${app.url}/api`, [TOKEN_ENV]: token },
      stderr: "pipe",
    }),
  );
  return client;
}

const app = await startApp();
try {
  // A person signs in themselves and hands the connector the token. The connector never sees the password.
  const login = await fetch(`${app.url}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: DEMO_USER.username, password: DEMO_USER.password }) });
  const { token } = await login.json();
  const client = await connect(app, token);

  const tools = (await client.listTools()).tools;
  const names = tools.map((tool) => tool.name).sort();
  check(JSON.stringify(names) === JSON.stringify(["getMe", "getNote", "listNotes"]), "offers exactly the three read tools, and no write or sign-in tool", names.join(", "));
  const list = tools.find((tool) => tool.name === "listNotes");
  check(["limit", "tag", "cursor"].every((name) => name in (list?.inputSchema.properties ?? {})), "listNotes accepts limit, tag and cursor");
  check(tools.every((tool) => tool.description && tool.description.length > 10), "every tool has a description");

  const me = parse(await client.callTool({ name: "getMe", arguments: {} }));
  check(me.ok && me.json?.name === "Demo User", "getMe returns the signed-in account", me.text);

  // Walk every page with the cursor, as an agent would.
  const seen = [];
  let cursor;
  for (let page = 0; page < 10; page += 1) {
    const result = parse(await client.callTool({ name: "listNotes", arguments: { limit: 3, ...(cursor ? { cursor } : {}) } }));
    if (!result.ok) break;
    seen.push(...result.json.items.map((note) => note.id));
    cursor = result.json.next_cursor;
    if (cursor === null) break;
  }
  check(JSON.stringify(seen) === JSON.stringify(app.notes.map((note) => note.id)), "following next_cursor returns every note exactly once", `got ${seen.join(",")}`);

  const work = parse(await client.callTool({ name: "listNotes", arguments: { tag: "work" } }));
  check(work.ok && work.json.items.length > 0 && work.json.items.every((note) => note.tags.includes("work")), "the tag filter works", work.text);

  const one = parse(await client.callTool({ name: "getNote", arguments: { id: 2 } }));
  check(one.ok && one.json?.title === "Release plan" && one.json?.body.includes("Friday"), "getNote returns the full note", one.text);

  const missing = parse(await client.callTool({ name: "getNote", arguments: { id: 9999 } }));
  check(!missing.ok && /404/.test(missing.text), "a missing note is reported as an error", missing.text);
  await client.close();

  const wrong = await connect(app, "not-a-real-token");
  const denied = parse(await wrong.callTool({ name: "getMe", arguments: {} }));
  check(!denied.ok && /401/.test(denied.text), "a wrong token is rejected by the app and the error reaches the client", denied.text);
  await wrong.close();

  check(app.notes.length === 7 && app.events.length === 0, "the connector changed nothing and sent no analytics");
} finally {
  await app.close();
}

if (failed) {
  console.error("\nthe connector did not pass");
  process.exit(1);
}
console.log("\nthe connector works against the app");
