import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "../src/frontmatter.js";
import { createServer } from "../src/mcp.js";
import { fixture, writeEntry, type Fixture } from "./helpers.js";

async function connect(f: Fixture): Promise<Client> {
  const server = createServer(f.kb, f.store);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content[0]!.text;
}

describe("MCP server", () => {
  it("offers read tools and write tools by default", async () => {
    const client = await connect(fixture());
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["add_entry", "get_entry", "list_entries", "list_types", "search", "update_entry", "validate"]);
  });

  it("offers no write tools when read-only", async () => {
    const client = await connect(fixture(["main"], { readOnly: true }));
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("add_entry");
    expect(names).not.toContain("update_entry");
    expect(names).toHaveLength(5);
  });

  it("searches, reads and lists", async () => {
    const f = fixture();
    writeEntry(f.layers.main!, { id: "deploy-checklist", title: "Deployment checklist", body: "Run the smoke tests." });
    const client = await connect(f);

    const search = JSON.parse(textOf(await client.callTool({ name: "search", arguments: { query: "deployment" } })));
    expect(search.results[0].id).toBe("deploy-checklist");

    const entry = JSON.parse(textOf(await client.callTool({ name: "get_entry", arguments: { id: "deploy-checklist" } })));
    expect(entry.body).toContain("smoke tests");

    const list = JSON.parse(textOf(await client.callTool({ name: "list_entries", arguments: {} })));
    expect(list.count).toBe(1);

    const types = JSON.parse(textOf(await client.callTool({ name: "list_types", arguments: {} })));
    expect(types.types.find((t: { name: string }) => t.name === "process").entries).toBe(1);
    expect(types.scopes).toEqual(["main"]);
  });

  it("reports an unknown entry as an error result", async () => {
    const client = await connect(fixture());
    const result = await client.callTool({ name: "get_entry", arguments: { id: "nope" } });
    expect(result.isError).toBe(true);
  });

  it("turns add_entry into a pending proposal and changes nothing else", async () => {
    const f = fixture();
    const client = await connect(f);
    const result = await client.callTool({
      name: "add_entry",
      arguments: {
        id: "from-agent",
        type: "lesson-learned",
        title: "From an agent",
        summary: "Proposed over MCP.",
        body: "What we learned.",
        rationale: "It matters.",
        proposed_by: "test-client",
      },
    });
    const payload = JSON.parse(textOf(result));
    expect(payload.status).toBe("pending_human_approval");
    expect(f.store.list()).toHaveLength(1);
    expect(f.store.list()[0]?.proposedBy).toBe("test-client");
    expect(readdirSync(f.layers.main!)).toEqual([]);
    expect(f.kb.getEntry("from-agent")).toBeUndefined();
  });

  it("returns validation problems for a bad proposal", async () => {
    const f = fixture();
    const client = await connect(f);
    const result = await client.callTool({
      name: "add_entry",
      arguments: { id: "x", type: "nonsense", title: "t", summary: "s", body: "b", rationale: "r" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/unknown type/);
    expect(f.store.list()).toHaveLength(0);
  });

  it("rejects a stale update_entry", async () => {
    const f = fixture();
    writeEntry(f.layers.main!, { id: "doc" });
    const client = await connect(f);
    const result = await client.callTool({
      name: "update_entry",
      arguments: { id: "doc", base_version: 9, title: "New", rationale: "r" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/version 1/);
  });

  it("validates on request", async () => {
    const f = fixture();
    writeEntry(f.layers.main!, { id: "linker", body: "See [[ghost]]." });
    const client = await connect(f);
    const report = JSON.parse(textOf(await client.callTool({ name: "validate", arguments: {} })));
    expect(report.warnings).toBe(1);
    expect(report.errors).toBe(0);
  });
});

describe("schema/entry.schema.json", () => {
  const schema = JSON.parse(readFileSync(resolve("schema/entry.schema.json"), "utf8"));
  const validate = new Ajv({ allErrors: true }).compile(schema);

  function exampleFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? exampleFiles(join(dir, d.name)) : d.name.endsWith(".md") ? [join(dir, d.name)] : [],
    );
  }

  it("accepts every bundled example", () => {
    const files = exampleFiles(resolve("examples/content"));
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const file of files) {
      const split = splitFrontmatter(readFileSync(file, "utf8"))!;
      expect(validate(split.data), `${file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it("rejects the same mistakes the code rejects", () => {
    const ok = { id: "a", type: "process", title: "t", summary: "s" };
    expect(validate(ok)).toBe(true);
    expect(validate({ ...ok, id: "Bad Id" })).toBe(false);
    expect(validate({ ...ok, status: "published" })).toBe(false);
    expect(validate({ ...ok, created: "14/10/2026" })).toBe(false);
    expect(validate({ id: "a", type: "process", title: "t" })).toBe(false);
  });
});
