import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DEMO_USER, startApp } from "../demos/connector-from-traffic/app/server.mjs";
import { applyOverlay, coverageProblems, deepMerge, exposeOperations, includePaths, listOperations, tokenEnvFor } from "../demos/connector-from-traffic/pipeline/spec.mjs";

/**
 * Cheap checks on the connector demo (demos/connector-from-traffic). The full chain, which needs
 * Python, mitmproxy2swagger and a generated server, runs in its own CI job. These cover the parts
 * that are plain code and the committed files the chain depends on.
 */
const demo = join(import.meta.dirname, "..", "demos", "connector-from-traffic");
const read = (path: string): string => readFileSync(join(demo, path), "utf8");
const readJson = (path: string) => JSON.parse(read(path));
const har = readJson("capture/notebook.har");
const decisions = readJson("connector/decisions.json");
const overlay = readJson("connector/overlay.json");

/** What mitmproxy2swagger produced for the committed capture, trimmed to the parts these tests use. */
const firstPass = `
openapi: 3.0.0
info: { title: notebook.har Mitmproxy2Swagger, version: 1.0.0 }
servers:
  - url: http://127.0.0.1:4010/api
paths:
  /session:
    post:
      responses: { '200': { description: OK }, '401': { description: Unauthorized } }
      requestBody: { content: { application/json: { schema: { type: object, properties: { username: { type: string }, password: { type: string } } } } } }
  /me:
    get:
      responses: { '200': { description: OK } }
  /notes:
    get:
      responses:
        '200':
          description: OK
          content: { application/json: { schema: { type: object, properties: { items: { type: array, items: { type: object } }, next_cursor: { type: string }, total: { type: number } } } } }
      parameters:
        - { name: limit, in: query, required: false, schema: { type: number } }
    post:
      responses: { '201': { description: Created } }
      requestBody: { content: { application/json: { schema: { type: object, properties: { title: { type: string }, body: { type: string }, tags: { type: array, items: { type: string } } } } } } }
  /notes/{id}:
    get:
      responses: { '200': { description: OK } }
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
x-path-templates:
  - ignore:/events
  - ignore:/notes/2
`;

describe("the committed capture", () => {
  it("is a recording of the demo app and nothing else", () => {
    const urls: string[] = har.log.entries.map((entry: { request: { url: string } }) => entry.request.url);
    expect(urls.length).toBeGreaterThan(8);
    expect(urls.every((url) => url.startsWith("http://127.0.0.1:4010/api/"))).toBe(true);
  });

  it("holds only the demo's own made-up credentials", () => {
    const text = JSON.stringify(har);
    expect([...text.matchAll(/Bearer [A-Za-z0-9._-]+/g)].map((m) => m[0])).toEqual(expect.arrayContaining([`Bearer ${DEMO_USER.token}`]));
    expect(new Set([...text.matchAll(/Bearer [A-Za-z0-9._-]+/g)].map((m) => m[0]))).toEqual(new Set([`Bearer ${DEMO_USER.token}`]));
    expect(text).not.toMatch(/"cookies":\s*\[\s*\{/);
  });

  it("shows the calls the demo is meant to teach: a failed login, paging, a filter, a detail read and a write", () => {
    const calls = har.log.entries.map((entry: { request: { method: string; url: string }; response: { status: number } }) => `${entry.request.method} ${new URL(entry.request.url).pathname}${new URL(entry.request.url).search} ${entry.response.status}`);
    expect(calls).toEqual(expect.arrayContaining(["POST /api/session 401", "POST /api/session 200", "GET /api/notes?limit=3&cursor=3 200", "GET /api/notes?limit=3&tag=work 200", "GET /api/notes/2 200", "POST /api/notes 201"]));
  });
});

describe("the reviewer's decisions", () => {
  it("leave out analytics and offer only reading", () => {
    expect(decisions.include).not.toContain("/events");
    const marked = Object.entries(overlay.paths).flatMap(([path, item]) =>
      Object.entries(item as Record<string, { "x-mcp"?: boolean; operationId?: string }>).filter(([, operation]) => operation["x-mcp"] === true).map(([method]) => `${method.toUpperCase()} ${path}`),
    );
    expect(marked.sort()).toEqual(["GET /me", "GET /notes", "GET /notes/{id}"]);
  });

  it("cover every endpoint chosen", () => {
    expect(Object.keys(overlay.paths).sort()).toEqual([...decisions.include].sort());
  });
});

describe("includePaths", () => {
  it("removes the ignore prefix from the chosen paths only", () => {
    const text = includePaths("x-path-templates:\n- ignore:/events\n- ignore:/me\n- ignore:/notes/2\n", ["/me"]);
    expect(text).toContain("- /me");
    expect(text).toContain("- ignore:/events");
    expect(text).toContain("- ignore:/notes/2");
  });

  it("says so when a chosen path was never captured", () => {
    expect(() => includePaths("x-path-templates:\n- ignore:/me\n", ["/missing"])).toThrow(/no path \/missing/);
  });
});

describe("deepMerge", () => {
  it("merges objects key by key and replaces lists", () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, list: [1, 2] }, { a: { c: 3 }, list: [9] })).toEqual({ a: { b: 1, c: 3 }, list: [9] });
  });
});

describe("the spec recovered from the capture", () => {
  const context = { apiPath: decisions.apiPath, include: decisions.include };

  it("misses the query parameters the first pass did not notice", () => {
    expect(coverageProblems(har, firstPass, context)).toEqual([
      'GET /notes: query parameter "cursor" was used but is not declared',
      'GET /notes: query parameter "tag" was used but is not declared',
    ]);
  });

  it("is complete once the reviewer's overlay is applied", () => {
    expect(coverageProblems(har, applyOverlay(firstPass, overlay), context)).toEqual([]);
  });

  it("catches an endpoint, a body field and a response code that are missing", () => {
    const spec = parse(applyOverlay(firstPass, overlay));
    delete spec.paths["/me"];
    delete spec.paths["/notes"].post.requestBody.content["application/json"].schema.properties.tags;
    delete spec.paths["/notes"].post.responses["201"];
    const problems = coverageProblems(har, JSON.stringify(spec), context);
    expect(problems).toEqual(expect.arrayContaining(["GET /me was captured but is not in the spec", 'POST /notes: body field "tags" was sent but is not in the spec', "POST /notes: response 201 was seen but is not in the spec"]));
  });

  it("drops the first pass's working notes and keeps one server address", () => {
    const spec = parse(applyOverlay(firstPass, overlay));
    expect(spec).not.toHaveProperty("x-path-templates");
    expect(spec.servers).toEqual([{ url: "http://127.0.0.1:4010/api" }]);
    expect(spec.security).toEqual([{ sessionToken: [] }]);
  });
});

describe("working from a spec the vendor publishes", () => {
  const published = read("official/openapi.yaml");

  it("lists every operation and which ones change data", () => {
    expect(listOperations(published).map((op) => `${op.readOnly ? "read" : "write"} ${op.method} ${op.operationId}`)).toEqual([
      "write POST createSession",
      "read GET getMe",
      "read GET listNotes",
      "write POST createNote",
      "read GET getNote",
    ]);
  });

  it("offers only what was chosen", () => {
    const spec = parse(exposeOperations(published, ["getMe", "listNotes", "getNote"]));
    const offered = Object.values(spec.paths).flatMap((item) => Object.values(item as Record<string, { operationId?: string; "x-mcp"?: boolean }>).filter((op) => op["x-mcp"]).map((op) => op.operationId));
    expect(offered.sort()).toEqual(["getMe", "getNote", "listNotes"]);
  });

  it("starts read-only: a write needs an explicit yes", () => {
    expect(() => exposeOperations(published, ["createNote"])).toThrow(/changes data/);
    expect(parse(exposeOperations(published, ["createNote"], { allowWrites: true })).paths["/notes"].post["x-mcp"]).toBe(true);
  });

  it("rejects an operation that is not in the spec", () => {
    expect(() => exposeOperations(published, ["nope"])).toThrow(/no operationId nope/);
  });

  it("works out which environment variable carries the token", () => {
    expect(tokenEnvFor(published)).toBe("BEARER_TOKEN_SESSIONTOKEN");
    expect(tokenEnvFor("components:\n  securitySchemes:\n    my-api.key:\n      type: http\n      scheme: bearer\n")).toBe("BEARER_TOKEN_MY_API_KEY");
    expect(() => tokenEnvFor("components:\n  securitySchemes:\n    k:\n      type: apiKey\n      in: header\n      name: x\n")).toThrow(/exactly one bearer/);
  });
});

describe("the demo app", () => {
  const call = async (base: string, path: string, init: RequestInit = {}) => {
    const response = await fetch(`${base}/api${path}`, init);
    return { status: response.status, body: (response.status === 204 ? null : await response.json()) as any };
  };
  const auth = { authorization: `Bearer ${DEMO_USER.token}` };

  it("answers only to a signed-in caller, pages with a cursor and filters by tag", async () => {
    const app = await startApp();
    try {
      expect((await call(app.url, "/notes")).status).toBe(401);
      expect((await call(app.url, "/session", { method: "POST", body: JSON.stringify({ username: "demo", password: "nope" }) })).status).toBe(401);

      const first = await call(app.url, "/notes?limit=3", { headers: auth });
      expect(first.body.items.map((n: { id: number }) => n.id)).toEqual([1, 2, 3]);
      expect(first.body.next_cursor).toBe("3");
      const last = await call(app.url, "/notes?limit=3&cursor=6", { headers: auth });
      expect(last.body.next_cursor).toBeNull();

      const work = await call(app.url, "/notes?tag=work", { headers: auth });
      expect(work.body.items.every((n: { tags: string[] }) => n.tags.includes("work"))).toBe(true);
      expect((await call(app.url, "/notes/999", { headers: auth })).status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
