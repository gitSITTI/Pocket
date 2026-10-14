import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/mcp.js";
import { SemanticSearch, type Embedder } from "../src/semantic.js";
import { fixture, writeEntry } from "./helpers.js";

/** "ship" and "release" mean the same thing here; everything else is its own word. */
const embedder: Embedder = {
  id: "fake:mcp",
  async embed(texts) {
    return texts.map((text) => {
      const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
      const vector = new Float32Array(3);
      for (const word of words) vector[["ship", "release", "deploy"].includes(word) ? 0 : 1]! += 1;
      vector[2] = 0.01;
      return vector;
    });
  },
};

async function connect(withSemantic: boolean, embed: Embedder = embedder) {
  const f = fixture();
  writeEntry(f.layers.main!, { id: "release-checklist", title: "Release checklist", summary: "Before we ship.", body: "Tag it." });
  const semantic = withSemantic ? new SemanticSearch(f.kb, embed, { warn: () => {} }) : undefined;
  const server = createServer(f.kb, f.store, semantic);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, semantic };
}

const call = async (client: Client, query: string) => {
  const result = await client.callTool({ name: "search", arguments: { query } });
  return JSON.parse((result.content as { text: string }[])[0]!.text);
};

describe("the search tool with search by meaning", () => {
  it("is described as searching by words and by meaning only when it is on", async () => {
    const on = (await (await connect(true)).client.listTools()).tools.find((t) => t.name === "search")!;
    const off = (await (await connect(false)).client.listTools()).tools.find((t) => t.name === "search")!;
    expect(on.description).toMatch(/by words and by meaning/);
    expect(off.description).toMatch(/Full-text/);
  });

  it("is unchanged when it is off: no extra fields", async () => {
    const { client } = await connect(false);
    const found = await call(client, "release");
    expect(found.count).toBe(1);
    expect(found.results[0]).not.toHaveProperty("matched");
    expect(found.results[0]).not.toHaveProperty("similarity");
    expect(found).not.toHaveProperty("note");
  });

  it("finds an entry by meaning and says how it matched", async () => {
    const { client, semantic } = await connect(true);
    await semantic!.sync();
    const found = await call(client, "deploy");
    expect(found.results[0]).toMatchObject({ id: "release-checklist", matched: "meaning" });
    expect(found.results[0].similarity).toBeGreaterThan(0);
    expect(found).not.toHaveProperty("note");
  });

  it("tells the agent when it is answering by keyword only", async () => {
    const broken: Embedder = { id: "broken:mcp", embed: async () => { throw new Error("no model"); } };
    const { client } = await connect(true, broken);
    const found = await call(client, "release");
    expect(found.results.map((r: { id: string }) => r.id)).toEqual(["release-checklist"]);
    expect(found.note).toMatch(/keyword results/);
  });
});
