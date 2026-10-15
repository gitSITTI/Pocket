// Small, dependency-light helpers for the middle of the pipeline: choosing endpoints, applying the
// reviewer's overlay, and checking the finished spec against what was actually captured.

import { parse, stringify } from "yaml";

/** Remove the "ignore:" prefix from the chosen path templates in mitmproxy2swagger's first-pass output. */
export function includePaths(specText, include) {
  const wanted = new Set(include);
  const seen = new Set();
  const lines = specText.split("\n").map((line) => {
    const match = /^- ignore:(.*)$/.exec(line);
    if (match && wanted.has(match[1])) {
      seen.add(match[1]);
      return `- ${match[1]}`;
    }
    return line;
  });
  const missing = include.filter((path) => !seen.has(path) && !specText.split("\n").includes(`- ${path}`));
  if (missing.length > 0) throw new Error(`The capture has no path ${missing.join(", ")}. Check connector/decisions.json against the first-pass list.`);
  return lines.join("\n");
}

/** Objects merge key by key; arrays and other values are replaced. */
export function deepMerge(base, overlay) {
  if (!isObject(base) || !isObject(overlay)) return overlay;
  const result = { ...base };
  for (const [key, value] of Object.entries(overlay)) result[key] = key in base ? deepMerge(base[key], value) : value;
  return result;
}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

export function applyOverlay(specText, overlay) {
  const spec = parse(specText);
  const merged = deepMerge(spec, overlay);
  delete merged["x-path-templates"]; // working notes of the first pass, not part of the spec
  merged.servers = [{ url: spec.servers[0].url }];
  return stringify(merged, { lineWidth: 0 });
}

/**
 * Compare what the capture shows with what the spec says. A generated spec can silently miss things
 * (the first pass recorded only `limit` for the list endpoint, not `tag` or `cursor`), and a connector
 * built on it would then never offer them. Returns a list of problems, empty when nothing is missing.
 */
export function coverageProblems(har, specText, { apiPath, include }) {
  const spec = parse(specText);
  const problems = [];
  const templates = include.map((template) => ({ template, regex: new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`) }));

  for (const { request, response } of har.log.entries) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${apiPath}/`)) continue;
    const path = url.pathname.slice(apiPath.length);
    const match = templates.find((t) => t.regex.test(path));
    if (!match) continue; // deliberately ignored in decisions.json
    const operation = spec.paths?.[match.template]?.[request.method.toLowerCase()];
    const where = `${request.method} ${match.template}`;
    if (!operation) {
      problems.push(`${where} was captured but is not in the spec`);
      continue;
    }
    const declared = new Set((operation.parameters ?? []).map((p) => `${p.in}:${p.name}`));
    for (const name of url.searchParams.keys()) if (!declared.has(`query:${name}`)) problems.push(`${where}: query parameter "${name}" was used but is not declared`);
    for (const placeholder of match.template.match(/\{([^}]+)\}/g) ?? []) if (!declared.has(`path:${placeholder.slice(1, -1)}`)) problems.push(`${where}: path parameter ${placeholder} is not declared`);

    if (request.postData?.text) {
      const body = safeJson(request.postData.text);
      const properties = operation.requestBody?.content?.["application/json"]?.schema?.properties ?? {};
      for (const key of Object.keys(body ?? {})) if (!(key in properties)) problems.push(`${where}: body field "${key}" was sent but is not in the spec`);
    }
    if (!(String(response.status) in (operation.responses ?? {}))) problems.push(`${where}: response ${response.status} was seen but is not in the spec`);
  }
  return [...new Set(problems)];
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const READ_ONLY = new Set(["get", "head", "options"]);

/** Every operation in a spec, so a person can see what exists before choosing what to offer. */
export function listOperations(specText) {
  const spec = parse(specText);
  const found = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item?.[method];
      if (operation) found.push({ method: method.toUpperCase(), path, operationId: operation.operationId, readOnly: READ_ONLY.has(method) });
    }
  }
  return found;
}

/**
 * Mark the chosen operations for the generated server (it offers only operations with x-mcp: true).
 * Operations that change data are refused unless the caller says so, because a connector built from
 * someone else's API should start read-only.
 */
export function exposeOperations(specText, operationIds, { allowWrites = false } = {}) {
  const spec = parse(specText);
  const wanted = new Set(operationIds);
  for (const item of Object.values(spec.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item?.[method];
      if (!operation || !wanted.has(operation.operationId)) continue;
      if (!READ_ONLY.has(method) && !allowWrites) throw new Error(`${operation.operationId} is ${method.toUpperCase()}, which changes data. Pass --allow-writes to offer it.`);
      operation["x-mcp"] = true;
      wanted.delete(operation.operationId);
    }
  }
  if (wanted.size > 0) throw new Error(`The spec has no operationId ${[...wanted].join(", ")}`);
  return stringify(spec, { lineWidth: 0 });
}

/** The environment variable the generated server reads a bearer token from: BEARER_TOKEN_ plus the upper-cased scheme name. */
export function tokenEnvFor(specText) {
  const spec = parse(specText);
  const schemes = Object.entries(spec.components?.securitySchemes ?? {}).filter(([, scheme]) => scheme.type === "http" && scheme.scheme === "bearer");
  if (schemes.length !== 1) throw new Error(`Expected exactly one bearer security scheme, found ${schemes.length}`);
  return `BEARER_TOKEN_${schemes[0][0].replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
}
