// Turns an app's traffic, or an API spec the vendor already publishes, into a working MCP connector,
// then checks the connector against the app.
//
//   node pipeline/run.mjs [--capture] [--skip-verify]
//   node pipeline/run.mjs --from-spec official/openapi.yaml --expose getMe,listNotes,getNote [--allow-writes]
//
// From traffic: (capture) -> first pass -> choose endpoints -> second pass -> reviewer's overlay ->
//   coverage check -> generate server -> install and build it -> verify with real tool calls.
// From a published spec: choose operations -> generate -> build -> verify.
//
// Needs: `npm install` in this folder (the generator), and for the traffic path
// `pip install mitmproxy2swagger==0.15.0` (or MITMPROXY2SWAGGER=/path/to/it). The committed
// capture/notebook.har is used unless --capture is given (which also needs Playwright; see capture.mjs).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyOverlay, coverageProblems, exposeOperations, includePaths, listOperations, tokenEnvFor } from "./spec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const build = join(root, "build");
const specFile = join(build, "spec.yaml");
const connectorDir = join(build, "connector");

const step = (name) => console.log(`\n== ${name}`);
const die = (message) => {
  console.error(`\nFAILED: ${message}`);
  process.exit(1);
};
const argValue = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", cwd: root, ...options });
  if (result.error) {
    if (result.error.code === "ENOENT") die(`"${command}" is not installed or not on PATH. See the header of pipeline/run.mjs.`);
    die(String(result.error));
  }
  if (result.status !== 0) die(`${command} ${args.join(" ")} exited with ${result.status}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  return result;
}

/** Recover a spec from a capture. Returns the address of the API the capture was made against. */
function specFromTraffic() {
  const har = join(root, "capture", "notebook.har");
  const decisions = JSON.parse(readFileSync(join(root, "connector", "decisions.json"), "utf8"));
  const overlay = JSON.parse(readFileSync(join(root, "connector", "overlay.json"), "utf8"));

  if (flag("capture")) {
    step("capture: use the app in a browser and record the traffic");
    run(process.execPath, [join(root, "capture", "capture.mjs"), "--out", har], { stdio: "inherit" });
  }

  const harData = JSON.parse(readFileSync(har, "utf8"));
  const origin = new URL(harData.log.entries[0].request.url).origin;
  const converter = process.env.MITMPROXY2SWAGGER ?? "mitmproxy2swagger";
  // Headers and examples stay off: they would copy tokens and personal data into the spec.
  const convert = () => run(converter, ["-i", har, "-f", "har", "-o", specFile, "-p", `${origin}${decisions.apiPath}`]);

  step("first pass: list the endpoints the capture shows");
  convert();

  step("choose endpoints (connector/decisions.json)");
  writeFileSync(specFile, includePaths(readFileSync(specFile, "utf8"), decisions.include));
  console.log(`included: ${decisions.include.join(", ")}`);
  console.log(`left out: ${Object.keys(decisions.ignoredBecause).join(", ")}`);

  step("second pass: infer parameters and shapes for the chosen endpoints");
  convert();

  step("apply the reviewer's overlay (connector/overlay.json)");
  const generated = readFileSync(specFile, "utf8");
  const missed = coverageProblems(harData, generated, decisions);
  console.log(`the generated spec on its own misses ${missed.length} thing(s) the capture shows:`);
  for (const problem of missed) console.log(`  - ${problem}`);
  writeFileSync(join(build, "spec.generated.yaml"), generated);
  writeFileSync(specFile, applyOverlay(generated, overlay));

  step("coverage check: everything captured must be in the final spec");
  const problems = coverageProblems(harData, readFileSync(specFile, "utf8"), decisions);
  if (problems.length > 0) die(`the final spec is missing:\n  - ${problems.join("\n  - ")}`);
  console.log("nothing missing");

  return `${origin}${decisions.apiPath}`;
}

/** Start from a spec the vendor publishes: no capture and no recovery, only a choice of what to offer. */
function specFromPublished(path) {
  step(`start from the published spec ${path}`);
  const published = readFileSync(resolve(root, path), "utf8");
  for (const op of listOperations(published)) console.log(`  ${op.readOnly ? "read " : "WRITE"} ${op.method.padEnd(6)} ${op.path}  (${op.operationId ?? "no operationId"})`);
  const expose = (argValue("expose") ?? "").split(",").filter(Boolean);
  if (expose.length === 0) die("pass --expose with the operationIds to offer, for example --expose getMe,listNotes");
  try {
    writeFileSync(specFile, exposeOperations(published, expose, { allowWrites: flag("allow-writes") }));
  } catch (error) {
    die(error.message);
  }
  console.log(`offering: ${expose.join(", ")}`);
  return undefined; // the spec's own servers entry is the default address
}

rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });
const fromSpec = argValue("from-spec");
const baseUrl = fromSpec ? specFromPublished(fromSpec) : specFromTraffic();

step("generate the MCP server (only operations marked x-mcp: true are offered)");
const generator = join(root, "node_modules", ".bin", "openapi-mcp-generator");
if (!existsSync(generator)) die("run `npm install` in demos/connector-from-traffic first");
run(generator, ["-i", specFile, "-o", connectorDir, "-n", "notebook-connector", ...(baseUrl ? ["-b", baseUrl] : []), "-t", "stdio", "--default-include", "false", "--force"]);
console.log(`generated ${connectorDir}`);

step("install and build the generated server");
run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"], { cwd: connectorDir });
run("npm", ["run", "build"], { cwd: connectorDir });
console.log("built");

if (!flag("skip-verify")) {
  step("verify against the running app with real tool calls");
  run(process.execPath, [join(root, "pipeline", "verify.mjs"), "--token-env", tokenEnvFor(readFileSync(specFile, "utf8"))], { stdio: "inherit" });
}
