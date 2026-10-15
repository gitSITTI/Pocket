import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KnowledgeBase } from "../src/kb.js";
import { loadConfig } from "../src/config.js";
import { fixture, writeEntry } from "./helpers.js";

describe("KnowledgeBase", () => {
  it("loads entries and ignores Markdown without frontmatter", () => {
    const { layers, kb } = fixture();
    writeEntry(layers.main!, { id: "one" });
    writeFileSync(join(layers.main!, "README.md"), "# Not an entry\n");
    kb.refresh();
    expect(kb.listEntries().map((e) => e.id)).toEqual(["one"]);
    expect(kb.issues()).toEqual([]);
  });

  it("lets later layers override earlier ones on the same id", () => {
    const { layers, kb } = fixture(["global", "project"]);
    writeEntry(layers.global!, { id: "shared", title: "Global version" });
    writeEntry(layers.global!, { id: "only-global" });
    writeEntry(layers.project!, { id: "shared", title: "Project version" });
    const shared = kb.getEntry("shared");
    expect(shared?.title).toBe("Project version");
    expect(shared?.scope).toBe("project");
    expect(kb.getEntry("only-global")?.scope).toBe("global");
    expect(kb.listEntries()).toHaveLength(2);
  });

  it("reports duplicate ids within one layer as an error", () => {
    const { layers, kb } = fixture();
    writeEntry(layers.main!, { id: "dup", file: "process/dup.md" });
    writeEntry(layers.main!, { id: "dup", file: "skill/dup.md", type: "skill" });
    const issues = kb.issues();
    expect(issues.some((i) => i.level === "error" && /duplicate id/.test(i.message))).toBe(true);
  });

  it("reports invalid entries with the file and reason", () => {
    const { layers, kb } = fixture();
    writeEntry(layers.main!, { id: "ok" });
    writeEntry(layers.main!, { id: "bad-type", type: "nonsense", file: "misc/bad-type.md" });
    writeFileSync(join(layers.main!, "broken.md"), "---\nid: [oops\n---\nbody");
    const errors = kb.issues().filter((i) => i.level === "error");
    expect(errors.some((i) => i.file === join("misc", "bad-type.md") && /unknown type/.test(i.message))).toBe(true);
    expect(errors.some((i) => i.file === "broken.md" && /invalid YAML/.test(i.message))).toBe(true);
    expect(kb.listEntries().map((e) => e.id)).toEqual(["ok"]);
  });

  it("warns about broken links in frontmatter and in the body, and about file names", () => {
    const { layers, kb } = fixture();
    writeEntry(layers.main!, {
      id: "linker",
      extraFrontmatter: "links: [missing-one]\n",
      body: "See [[missing-two]] and [[linker]].",
      file: "process/other-name.md",
    });
    const messages = kb.issues().map((i) => i.message);
    expect(messages).toContain('links to unknown entry "missing-one"');
    expect(messages).toContain('links to unknown entry "missing-two"');
    expect(messages.some((m) => /file name should match the id/.test(m))).toBe(true);
    expect(messages.some((m) => m.includes('"linker"'))).toBe(false);
  });

  it("warns when a content directory does not exist", () => {
    const { config } = fixture();
    const kb = new KnowledgeBase({ ...config, contentDirs: [{ scope: "main", path: join(config.proposalsDir, "nope") }] });
    expect(kb.issues()[0]?.message).toMatch(/does not exist/);
  });

  it("picks up file changes without a restart", () => {
    const { layers, kb } = fixture();
    writeEntry(layers.main!, { id: "first" });
    expect(kb.listEntries()).toHaveLength(1);
    const path = writeEntry(layers.main!, { id: "second" });
    // Make the change visible even on filesystems with coarse timestamps.
    utimesSync(path, new Date(), new Date(Date.now() + 5000));
    expect(kb.getEntry("second")).toBeDefined();
    expect(kb.listEntries()).toHaveLength(2);
  });

  it("filters by type, tag, status and scope", () => {
    const { layers, kb } = fixture(["global", "project"]);
    writeEntry(layers.global!, { id: "a", type: "skill", extraFrontmatter: "tags: [Alpha]\nstatus: active\n" });
    writeEntry(layers.project!, { id: "b", type: "process", extraFrontmatter: "tags: [beta]\n" });
    expect(kb.listEntries({ type: "skill" }).map((e) => e.id)).toEqual(["a"]);
    expect(kb.listEntries({ tag: "alpha" }).map((e) => e.id)).toEqual(["a"]);
    expect(kb.listEntries({ status: "draft" }).map((e) => e.id)).toEqual(["b"]);
    expect(kb.listEntries({ scope: "project" }).map((e) => e.id)).toEqual(["b"]);
  });
});

describe("search", () => {
  it("ranks a title match above a passing mention in the body", () => {
    const { layers, kb } = fixture();
    writeEntry(layers.main!, { id: "deploys", title: "Deployment checklist", body: "Steps for shipping." });
    writeEntry(layers.main!, { id: "notes", title: "Meeting notes", body: "We mentioned the deployment once, in passing." });
    const hits = kb.search("deployment");
    expect(hits.map((h) => h.entry.id)).toEqual(["deploys", "notes"]);
  });

  it("folds simple plurals and ignores accents and case", () => {
    const { layers, kb } = fixture();
    writeEntry(layers.main!, { id: "rollouts", title: "Deployments", body: "Café timeouts matter." });
    expect(kb.search("DEPLOYMENT")[0]?.entry.id).toBe("rollouts");
    expect(kb.search("cafe timeout")[0]?.entry.id).toBe("rollouts");
  });

  it("returns nothing for an empty or unmatched query", () => {
    const { layers, kb } = fixture();
    writeEntry(layers.main!, { id: "x" });
    expect(kb.search("")).toEqual([]);
    expect(kb.search("zzzzqqq")).toEqual([]);
  });

  it("applies filters and limits, and returns a snippet", () => {
    const { layers, kb } = fixture();
    writeEntry(layers.main!, { id: "p1", type: "process", body: "Alpha step one.\nBeta step two." });
    writeEntry(layers.main!, { id: "s1", type: "skill", body: "Alpha technique." });
    expect(kb.search("alpha", { type: "skill" }).map((h) => h.entry.id)).toEqual(["s1"]);
    expect(kb.search("alpha", {}, 1)).toHaveLength(1);
    expect(kb.search("beta")[0]?.snippet).toBe("Beta step two.");
  });
});

describe("bundled examples", () => {
  it("validate with no errors or warnings", () => {
    const config = loadConfig({ cwd: resolve("."), env: { POCKET_CONTENT_DIR: "examples/content" } });
    const kb = new KnowledgeBase(config);
    expect(kb.issues()).toEqual([]);
    expect(kb.listEntries().map((e) => e.type).sort()).toEqual([
      "contract",
      "lesson-learned",
      "lesson-learned",
      "library",
      "pipeline",
      "process",
      "process",
      "process",
      "process",
      "script",
      "skill",
    ]);
  });

  it("include process entries on reverse engineering and writing up finished work", () => {
    const config = loadConfig({ cwd: resolve("."), env: { POCKET_CONTENT_DIR: "examples/content" } });
    const kb = new KnowledgeBase(config);
    expect(kb.search("reverse engineer")[0]?.entry.id).toBe("example-reverse-engineering");
    expect(kb.getEntry("example-process-audit")?.links).toContain("example-reverse-engineering");
  });

  it("include the connector recipe and the lesson about generated API descriptions", () => {
    const config = loadConfig({ cwd: resolve("."), env: { POCKET_CONTENT_DIR: "examples/content" } });
    const kb = new KnowledgeBase(config);
    expect(kb.search("build an MCP connector for an app")[0]?.entry.id).toBe("example-build-connector");
    expect(kb.search("generated api description missing query parameters")[0]?.entry.id).toBe("example-generated-spec-gaps");
    // Every link between the examples points at an entry that exists.
    for (const id of ["example-build-connector", "example-generated-spec-gaps"]) {
      for (const link of kb.getEntry(id)?.links ?? []) expect(kb.getEntry(link), `${id} -> ${link}`).toBeDefined();
    }
  });

  it("are findable by search", () => {
    const config = loadConfig({ cwd: resolve("."), env: { POCKET_CONTENT_DIR: "examples/content" } });
    const kb = new KnowledgeBase(config);
    expect(kb.search("retry backoff")[0]?.entry.id).toBe("example-retry-with-backoff");
  });
});

describe("loadConfig", () => {
  it("falls back to a single default layer", () => {
    const config = loadConfig({ cwd: "/work", env: {} });
    expect(config.contentDirs).toEqual([{ scope: "default", path: "/work/content" }]);
    expect(config.proposalsDir).toBe("/work/.pocket/proposals");
    expect(config.types.map((t) => t.name)).toContain("lesson-learned");
  });

  it("reads a config file, resolves paths from its folder, and merges types", () => {
    const { root } = fixture();
    mkdirSync(join(root, "conf"), { recursive: true });
    writeFileSync(
      join(root, "conf", "pocket.config.json"),
      JSON.stringify({
        contentDirs: [
          { scope: "global", path: "../g" },
          { scope: "project", path: "../p" },
        ],
        types: [
          { name: "runbook", description: "Ops steps", requiredFields: ["owner"] },
          { name: "process", requiredFields: ["owner"] },
        ],
        readOnly: true,
      }),
    );
    const config = loadConfig({ cwd: "/elsewhere", env: { POCKET_CONFIG: join(root, "conf", "pocket.config.json") } });
    expect(config.contentDirs.map((d) => d.path)).toEqual([join(root, "g"), join(root, "p")]);
    expect(config.readOnly).toBe(true);
    expect(config.types.find((t) => t.name === "runbook")?.requiredFields).toEqual(["owner"]);
    const process = config.types.find((t) => t.name === "process");
    expect(process?.requiredFields).toEqual(["owner"]);
    expect(process?.description).not.toBe(""); // the built-in description is kept
  });

  it("rejects duplicate scopes and missing explicit config files", () => {
    const { root } = fixture();
    const path = join(root, "dup.json");
    writeFileSync(path, JSON.stringify({ contentDirs: [{ scope: "a", path: "." }, { scope: "a", path: "." }] }));
    expect(() => loadConfig({ cwd: root, env: { POCKET_CONFIG: path } })).toThrow(/duplicate scope/);
    expect(() => loadConfig({ cwd: root, env: { POCKET_CONFIG: join(root, "missing.json") } })).toThrow(/not found/);
  });

  it("lets environment variables turn on read-only mode", () => {
    expect(loadConfig({ cwd: "/work", env: { POCKET_READ_ONLY: "1" } }).readOnly).toBe(true);
  });
});
