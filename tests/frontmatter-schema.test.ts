import { describe, expect, it } from "vitest";
import { serializeEntry, splitFrontmatter } from "../src/frontmatter.js";
import { TypeRegistry, parseMeta } from "../src/schema.js";
import { DEFAULT_TYPES } from "../src/types.js";

const types = new TypeRegistry([...DEFAULT_TYPES, { name: "runbook", description: "", requiredFields: ["owner"] }]);

const valid = {
  id: "my-entry",
  type: "process",
  title: "My entry",
  summary: "What it is.",
};

describe("frontmatter", () => {
  it("splits frontmatter from the body", () => {
    const result = splitFrontmatter("---\nid: a\n---\n\nHello\n");
    expect(result?.data).toEqual({ id: "a" });
    expect(result?.body).toBe("Hello\n");
  });

  it("returns null when there is no frontmatter", () => {
    expect(splitFrontmatter("# Just a README\n")).toBeNull();
  });

  it("throws on invalid YAML", () => {
    expect(() => splitFrontmatter("---\nid: [unclosed\n---\nbody")).toThrow(/invalid YAML/);
  });

  it("handles Windows line endings", () => {
    const result = splitFrontmatter("---\r\nid: a\r\n---\r\nHello\r\n");
    expect(result?.data).toEqual({ id: "a" });
    expect(result?.body.trim()).toBe("Hello");
  });

  it("round-trips an entry and keeps extra keys and dates as text", () => {
    const parsed = parseMeta({ ...valid, created: "2026-10-14", owner: "team-a", tags: ["x"] }, types);
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    const text = serializeEntry(parsed.meta, "Body");
    const again = splitFrontmatter(text)!;
    const reparsed = parseMeta(again.data, types);
    if (!reparsed.ok) throw new Error(reparsed.errors.join("; "));
    expect(reparsed.meta).toEqual(parsed.meta);
    expect(reparsed.meta.created).toBe("2026-10-14");
    expect(reparsed.meta.extra).toEqual({ owner: "team-a" });
    expect(again.body.trim()).toBe("Body");
  });
});

describe("schema", () => {
  it("accepts minimal valid frontmatter and fills defaults", () => {
    const result = parseMeta(valid, types);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.status).toBe("draft");
      expect(result.meta.version).toBe(1);
      expect(result.meta.tags).toEqual([]);
      expect(result.meta.links).toEqual([]);
    }
  });

  it.each([
    ["uppercase id", { id: "Bad_Id" }],
    ["id with a slash", { id: "../escape" }],
    ["empty title", { title: "" }],
    ["bad date", { created: "14/10/2026" }],
    ["bad status", { status: "published" }],
    ["version zero", { version: 0 }],
  ])("rejects %s", (_name, patch) => {
    expect(parseMeta({ ...valid, ...patch }, types).ok).toBe(false);
  });

  it("rejects an unknown type and names the known ones", () => {
    const result = parseMeta({ ...valid, type: "nonsense" }, types);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/unknown type "nonsense".*library/);
  });

  it("enforces required fields for a type", () => {
    const missing = parseMeta({ ...valid, type: "runbook" }, types);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.join(" ")).toMatch(/owner: required/);
    expect(parseMeta({ ...valid, type: "runbook", owner: "team-a" }, types).ok).toBe(true);
  });

  it("rejects frontmatter that is not a mapping", () => {
    expect(parseMeta("text", types).ok).toBe(false);
    expect(parseMeta(["a"], types).ok).toBe(false);
    expect(parseMeta(null, types).ok).toBe(false);
  });
});
