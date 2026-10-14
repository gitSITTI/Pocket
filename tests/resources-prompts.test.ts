import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PromptListChangedNotificationSchema, ResourceListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createChangeNotifier, createServer } from "../src/mcp.js";
import { fixture, tempDir, writeEntry, type Fixture } from "./helpers.js";

async function connect(f: Fixture): Promise<{ client: Client; server: ReturnType<typeof createServer> }> {
  const server = createServer(f.kb, f.store);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, server };
}

function sample(overrides: Parameters<typeof fixture>[1] = {}): Fixture {
  const f = fixture(["main"], overrides);
  writeEntry(f.layers.main!, {
    id: "release-checklist",
    type: "process",
    title: "Release checklist",
    summary: "Steps before shipping a release.",
    body: "1. Run the tests.\n2. Tag the release.",
    extraFrontmatter: "status: active\nversion: 3\nupdated: 2026-01-02\n",
  });
  writeEntry(f.layers.main!, { id: "draft-process", type: "process", summary: "Not ready yet.", extraFrontmatter: "status: draft\n" });
  writeEntry(f.layers.main!, { id: "old-process", type: "process", summary: "Replaced.", extraFrontmatter: "status: deprecated\n" });
  writeEntry(f.layers.main!, { id: "http-helper", type: "script", summary: "A helper.", extraFrontmatter: "status: active\n" });
  return f;
}

describe("resources", () => {
  it("are advertised along with prompts", async () => {
    const { client } = await connect(fixture());
    const capabilities = client.getServerCapabilities();
    expect(capabilities?.resources).toBeDefined();
    expect(capabilities?.prompts?.listChanged).toBe(true);
    expect((await client.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate)).toEqual(["pocket://entry/{id}"]);
  });

  it("list every entry with a hint about how much it matters", async () => {
    const { client } = await connect(sample());
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      "pocket://entry/draft-process",
      "pocket://entry/http-helper",
      "pocket://entry/old-process",
      "pocket://entry/release-checklist",
    ]);

    const release = resources.find((r) => r.name === "release-checklist")!;
    expect(release).toMatchObject({
      title: "Release checklist",
      description: "Steps before shipping a release.",
      mimeType: "text/markdown",
      annotations: { audience: ["user", "assistant"], priority: 0.8, lastModified: "2026-01-02T00:00:00Z" },
    });
    const draft = resources.find((r) => r.name === "draft-process")!;
    expect(draft.annotations?.priority).toBe(0.3);
    expect(draft.description).toBe("(draft) Not ready yet.");
    expect(resources.find((r) => r.name === "old-process")!.annotations?.priority).toBe(0.1);
  });

  it("read back as the entry's Markdown", async () => {
    const { client } = await connect(sample());
    const result = await client.readResource({ uri: "pocket://entry/release-checklist" });
    expect(result.contents).toHaveLength(1);
    const content = result.contents[0]!;
    expect(content).toMatchObject({ uri: "pocket://entry/release-checklist", mimeType: "text/markdown" });
    const text = (content as { text: string }).text;
    expect(text).toMatch(/^---\nid: release-checklist\n/);
    expect(text).toContain("title: Release checklist");
    expect(text).toContain("1. Run the tests.");
  });

  it("report a missing entry as not found and refuse addresses that are not valid", async () => {
    const { client } = await connect(sample());
    await expect(client.readResource({ uri: "pocket://entry/nothing-here" })).rejects.toMatchObject({ code: -32002 });
    for (const uri of ["pocket://entry/Bad_Id", "pocket://entry/..%2F..%2Fsecret", "pocket://entry/a%20b"]) {
      await expect(client.readResource({ uri }), uri).rejects.toMatchObject({ code: -32602 });
    }
  });

  it("complete ids", async () => {
    const { client } = await connect(sample());
    const result = await client.complete({
      ref: { type: "ref/resource", uri: "pocket://entry/{id}" },
      argument: { name: "id", value: "d" },
    });
    expect(result.completion.values).toEqual(["draft-process"]);
  });

  it("follow the files without reconnecting", async () => {
    const f = sample();
    const { client } = await connect(f);
    expect((await client.listResources()).resources).toHaveLength(4);
    writeEntry(f.layers.main!, { id: "brand-new", type: "process", extraFrontmatter: "status: active\n" });
    expect((await client.listResources()).resources.map((r) => r.name)).toContain("brand-new");
    expect((await client.readResource({ uri: "pocket://entry/brand-new" })).contents).toHaveLength(1);
  });

  it("are still offered when the server is read-only", async () => {
    const { client } = await connect(sample({ readOnly: true }));
    expect(client.getServerCapabilities()?.resources).toBeDefined();
    expect((await client.listResources()).resources).toHaveLength(4);
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(["release-checklist"]);
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain("add_entry");
  });
});

describe("prompts", () => {
  it("offer only active entries of the configured types", async () => {
    const { client } = await connect(sample());
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["release-checklist"]);
    expect(prompts[0]).toMatchObject({
      title: "Release checklist",
      description: "Steps before shipping a release.",
      arguments: [{ name: "context", required: false }],
    });
  });

  it("can cover other types", async () => {
    const f = fixture(["main"], { promptTypes: ["process", "script"] });
    writeEntry(f.layers.main!, { id: "a-process", type: "process", extraFrontmatter: "status: active\n" });
    writeEntry(f.layers.main!, { id: "a-script", type: "script", extraFrontmatter: "status: active\n" });
    const { client } = await connect(f);
    expect((await client.listPrompts()).prompts.map((p) => p.name).sort()).toEqual(["a-process", "a-script"]);
  });

  it("turn into one message holding the entry", async () => {
    const { client } = await connect(sample());
    const result = await client.getPrompt({ name: "release-checklist" });
    expect(result.description).toBe("Steps before shipping a release.");
    expect(result.messages).toHaveLength(1);
    const message = result.messages[0]!;
    expect(message.role).toBe("user");
    const text = (message.content as { type: string; text: string }).text;
    expect(text).toContain('Follow "Release checklist"');
    expect(text).toContain("pocket://entry/release-checklist, version 3");
    expect(text).toContain("1. Run the tests.\n2. Tag the release.");
    expect(text).not.toContain("Apply it to this");
  });

  it("add what the person says they are applying it to", async () => {
    const { client } = await connect(sample());
    const result = await client.getPrompt({ name: "release-checklist", arguments: { context: "  the v2 launch  " } });
    const text = (result.messages[0]!.content as { text: string }).text;
    expect(text.endsWith("Apply it to this:\nthe v2 launch")).toBe(true);
  });

  it("refuse drafts, deprecated entries and unknown names", async () => {
    const { client } = await connect(sample());
    for (const name of ["draft-process", "old-process", "http-helper", "nothing"]) {
      await expect(client.getPrompt({ name }), name).rejects.toMatchObject({ code: -32602 });
    }
  });

  it("follow the files without reconnecting", async () => {
    const f = sample();
    const { client } = await connect(f);
    writeEntry(f.layers.main!, { id: "second-process", type: "process", extraFrontmatter: "status: active\n" });
    expect((await client.listPrompts()).prompts.map((p) => p.name).sort()).toEqual(["release-checklist", "second-process"]);
  });
});

describe("change notifications", () => {
  it("tell the client when the files change, once per change", async () => {
    const f = sample();
    const { client, server } = await connect(f);
    const received: string[] = [];
    client.setNotificationHandler(ResourceListChangedNotificationSchema, () => void received.push("resources"));
    client.setNotificationHandler(PromptListChangedNotificationSchema, () => void received.push("prompts"));

    f.kb.refresh(); // the fixture wrote its entries after the knowledge base first looked
    const check = createChangeNotifier(f.kb, server);
    expect(check()).toBe(false);

    writeEntry(f.layers.main!, { id: "arrived-later", type: "process", extraFrontmatter: "status: active\n" });
    expect(check()).toBe(true);
    expect(check()).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received.sort()).toEqual(["prompts", "resources"]);
  });

  it("are not missed when a tool call already noticed the change", async () => {
    const f = sample();
    const { client, server } = await connect(f);
    f.kb.refresh();
    const check = createChangeNotifier(f.kb, server);
    writeEntry(f.layers.main!, { id: "seen-by-a-tool", type: "process", extraFrontmatter: "status: active\n" });
    await client.callTool({ name: "list_entries", arguments: {} });
    expect(check()).toBe(true);
  });
});

describe("prompt types in the config file", () => {
  function writeConfig(extra: Record<string, unknown>): string {
    const dir = tempDir();
    const path = join(dir, "pocket.config.json");
    writeFileSync(path, JSON.stringify({ contentDirs: [{ scope: "main", path: "content" }], ...extra }));
    return path;
  }

  it("default to process and can be changed", () => {
    expect(loadConfig({ configPath: writeConfig({}) }).promptTypes).toEqual(["process"]);
    expect(loadConfig({ configPath: writeConfig({ promptTypes: ["process", "lesson-learned"] }) }).promptTypes).toEqual(["process", "lesson-learned"]);
    expect(loadConfig({ cwd: tempDir(), env: {} }).promptTypes).toEqual(["process"]);
  });

  it("must be valid type names", () => {
    expect(() => loadConfig({ configPath: writeConfig({ promptTypes: ["Not Valid"] }) })).toThrow(/prompt type names/);
  });
});
