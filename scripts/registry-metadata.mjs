#!/usr/bin/env node
// Keeps package.json and server.json (the MCP Registry metadata) consistent.
//
//   node scripts/registry-metadata.mjs check [--tag v1.2.3]   exit 1 when something is wrong
//   node scripts/registry-metadata.mjs sync                   copy the package.json version into server.json
//
// `npm version` runs `sync` for you (see the "version" script in package.json).
// The checks mirror what the registry enforces when you publish, so a mistake fails here
// instead of after the npm package is already out.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCHEMA_PREFIX = "https://static.modelcontextprotocol.io/schemas/";
const NAME_PATTERN = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function repoOwnerAndName(url) {
  const match = /^(?:git\+)?https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url ?? "");
  return match ? { owner: match[1], repo: match[2] } : null;
}

/**
 * @param {{ pkg: any, server: any, tag?: string }} input
 * @returns {string[]} problems, empty when everything is consistent
 */
export function checkRegistryMetadata({ pkg, server, tag }) {
  const problems = [];
  const bad = (message) => problems.push(message);

  if (!pkg.mcpName) bad('package.json needs an "mcpName" (the registry checks it against server.json "name").');
  else if (pkg.mcpName !== server.name) bad(`package.json mcpName "${pkg.mcpName}" must equal server.json name "${server.name}".`);

  if (typeof server.name !== "string" || server.name.length < 3 || server.name.length > 200 || !NAME_PATTERN.test(server.name)) {
    bad('server.json "name" must look like io.github.<owner>/<name> (3 to 200 characters).');
  }
  if (typeof server.description !== "string" || server.description.length < 1 || server.description.length > 100) {
    bad(`server.json "description" must be 1 to 100 characters (it is ${server.description?.length ?? 0}).`);
  }
  if (server.title !== undefined && (typeof server.title !== "string" || server.title.length < 1 || server.title.length > 100)) {
    bad('server.json "title" must be 1 to 100 characters.');
  }
  if (typeof server.$schema !== "string" || !server.$schema.startsWith(SCHEMA_PREFIX)) {
    bad(`server.json "$schema" should point at ${SCHEMA_PREFIX}...`);
  }

  if (!VERSION_PATTERN.test(server.version ?? "")) bad(`server.json version "${server.version}" must be one exact version, not a range.`);
  if (server.version !== pkg.version) bad(`server.json version "${server.version}" does not match package.json version "${pkg.version}". Run: node scripts/registry-metadata.mjs sync`);

  // The io.github.<owner>/ prefix has to belong to the repository's owner, or GitHub login will be refused.
  const fromPackage = repoOwnerAndName(typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url);
  const fromServer = repoOwnerAndName(server.repository?.url);
  if (!fromServer) bad('server.json "repository.url" must be a https://github.com/<owner>/<repo> address.');
  if (server.repository?.source !== "github") bad('server.json "repository.source" must be "github".');
  if (fromPackage && fromServer && `${fromPackage.owner}/${fromPackage.repo}`.toLowerCase() !== `${fromServer.owner}/${fromServer.repo}`.toLowerCase()) {
    bad("package.json repository and server.json repository point at different repositories.");
  }
  if (fromServer && server.name) {
    const prefix = `io.github.${fromServer.owner}/`.toLowerCase();
    if (!server.name.toLowerCase().startsWith(prefix)) bad(`server.json name must start with io.github.${fromServer.owner}/ to publish with GitHub login.`);
  }

  const packages = Array.isArray(server.packages) ? server.packages : [];
  if (packages.length === 0) bad("server.json lists no packages.");
  for (const [index, entry] of packages.entries()) {
    const where = `server.json packages[${index}]`;
    if (entry.registryType !== "npm") continue; // only npm is checked here
    if (entry.identifier !== pkg.name) bad(`${where} identifier "${entry.identifier}" must be the npm package name "${pkg.name}".`);
    if (entry.version !== pkg.version) bad(`${where} version "${entry.version}" does not match package.json version "${pkg.version}".`);
    if (entry.version === "latest") bad(`${where} version cannot be "latest".`);
    if (!entry.transport || entry.transport.type !== "stdio") bad(`${where} transport.type should be "stdio" for this server.`);
    for (const variable of entry.environmentVariables ?? []) {
      if (!variable.name || !variable.description) bad(`${where} each environment variable needs a name and a description.`);
    }
  }

  // `npx <package>` runs the bin named like the package, or the only bin. With several bins and none
  // named like the package it fails, which would break every client that launches the server with npx.
  const bins = typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : (pkg.bin ?? {});
  const bareName = String(pkg.name ?? "").replace(/^@[^/]+\//, "");
  if (Object.keys(bins).length > 1 && !(bareName in bins)) {
    bad(`package.json has several bins but none named "${bareName}", so "npx ${pkg.name}" cannot choose one.`);
  }
  if (!Array.isArray(pkg.files) || !pkg.files.includes("dist")) bad('package.json "files" should include "dist" so the build is published.');

  if (tag !== undefined && tag !== `v${pkg.version}`) {
    bad(`The release tag "${tag}" does not match package.json version "${pkg.version}" (expected "v${pkg.version}").`);
  }
  return problems;
}

/** Returns a copy of server.json with every version set to the package.json version. */
export function syncVersions({ pkg, server }) {
  return {
    ...server,
    version: pkg.version,
    packages: (server.packages ?? []).map((entry) => (entry.registryType === "npm" ? { ...entry, version: pkg.version } : entry)),
  };
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const serverPath = join(root, "server.json");
  const server = JSON.parse(readFileSync(serverPath, "utf8"));
  const [command, ...rest] = argv;

  if (command === "sync") {
    writeFileSync(serverPath, `${JSON.stringify(syncVersions({ pkg, server }), null, 2)}\n`);
    console.log(`server.json is now at version ${pkg.version}`);
    return 0;
  }
  if (command === "check") {
    const tagIndex = rest.indexOf("--tag");
    const tag = tagIndex >= 0 ? rest[tagIndex + 1] : undefined;
    const problems = checkRegistryMetadata({ pkg, server, tag });
    for (const problem of problems) console.error(`registry metadata: ${problem}`);
    if (problems.length === 0) console.log(`registry metadata ok: ${server.name} ${server.version}`);
    return problems.length === 0 ? 0 : 1;
  }
  console.error("usage: registry-metadata.mjs check [--tag vX.Y.Z] | sync");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
