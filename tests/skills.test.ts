import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approveProposal } from "../src/proposals.js";
import { checkSkillName, entryToSkillMd, exportSkills, importSkills, parseSkillMd } from "../src/skills.js";
import { fixture, tempDir, writeEntry } from "./helpers.js";

function skillText(front: string, body = "Step one. Step two."): string {
  return `---\n${front}\n---\n\n${body}\n`;
}

function writeSkill(root: string, folder: string, text: string, extraFiles: Record<string, string> = {}): string {
  const dir = join(root, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), text);
  for (const [name, content] of Object.entries(extraFiles)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe("skill names", () => {
  it("follow the specification", () => {
    for (const ok of ["pdf-processing", "a", "data-analysis-2", "x".repeat(64)]) expect(checkSkillName(ok), ok).toBeUndefined();
    for (const bad of ["", "PDF-Processing", "-pdf", "pdf-", "pdf--processing", "pdf processing", "pdf_processing", "x".repeat(65), "café"]) {
      expect(checkSkillName(bad), bad).toBeDefined();
    }
  });
});

describe("reading a SKILL.md", () => {
  it("accepts the minimal form and the optional fields", () => {
    const minimal = parseSkillMd(skillText("name: pdf-processing\ndescription: Works with PDFs."), "pdf-processing");
    expect(minimal.ok).toBe(true);

    const full = parseSkillMd(
      skillText(
        'name: pdf-processing\ndescription: Works with PDFs.\nlicense: Apache-2.0\ncompatibility: Needs python\nallowed-tools: Bash(git:*) Read\nmetadata:\n  author: example-org\n  version: 2\nmodel: sonnet',
      ),
      "pdf-processing",
    );
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.skill).toMatchObject({
      license: "Apache-2.0",
      compatibility: "Needs python",
      allowedTools: "Bash(git:*) Read",
      metadata: { author: "example-org", version: "2" },
      ignoredKeys: ["model"],
    });
  });

  it("explains what is wrong", () => {
    const cases: [string, string, RegExp][] = [
      ["no frontmatter", "Just text.", /no YAML frontmatter/],
      ["missing description", skillText("name: pdf-processing"), /description: required/],
      ["description too long", skillText(`name: pdf-processing\ndescription: ${"x".repeat(1025)}`), /1025 characters, the limit is 1024/],
      ["bad name", skillText("name: PDF\ndescription: d"), /^name:/],
      ["name differs from folder", skillText("name: other-name\ndescription: d"), /must match the folder name/],
      ["compatibility too long", skillText(`name: pdf-processing\ndescription: d\ncompatibility: ${"c".repeat(501)}`), /compatibility: 501/],
      ["nested metadata", skillText("name: pdf-processing\ndescription: d\nmetadata:\n  a:\n    b: 1"), /metadata\.a: must be text/],
      ["empty body", "---\nname: pdf-processing\ndescription: d\n---\n", /no instructions/],
      ["broken yaml", "---\nname: [unclosed\n---\nbody", /invalid YAML/],
    ];
    for (const [label, text, expected] of cases) {
      const result = parseSkillMd(text, "pdf-processing");
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.errors.join("\n"), label).toMatch(expected);
    }
  });
});

describe("exporting", () => {
  function skillFixture() {
    const f = fixture();
    writeEntry(f.layers.main!, {
      id: "pdf-processing",
      type: "skill",
      title: "PDF processing",
      summary: "Extract text from PDFs.",
      body: "# PDF processing\n\nUse a library.",
      extraFrontmatter: "status: active\ntags: [pdf, documents]\nlicense: Apache-2.0\nsource: https://example.org/pdf\ncompatibility: Needs python\nallowed-tools: Read\n",
    });
    writeEntry(f.layers.main!, { id: "still-a-draft", type: "skill", extraFrontmatter: "status: draft\n" });
    writeEntry(f.layers.main!, { id: "bad--name", type: "skill", extraFrontmatter: "status: active\n" });
    writeEntry(f.layers.main!, { id: "not-a-skill", type: "process", extraFrontmatter: "status: active\n" });
    return f;
  }

  it("writes active skill entries and reports the ones it cannot", () => {
    const f = skillFixture();
    const out = tempDir();
    const items = exportSkills(f.kb, out);

    expect(items.find((i) => i.id === "pdf-processing")?.path).toBe(join(out, "pdf-processing", "SKILL.md"));
    const skipped = items.find((i) => i.id === "bad--name");
    expect(skipped?.path).toBeUndefined();
    expect(skipped?.errors[0]).toMatch(/not a valid skill name/);
    expect(items.map((i) => i.id).sort()).toEqual(["bad--name", "pdf-processing"]);
    expect(existsSync(join(out, "still-a-draft"))).toBe(false);
    expect(existsSync(join(out, "not-a-skill"))).toBe(false);
  });

  it("writes a file the specification accepts, with provenance carried along", () => {
    const f = skillFixture();
    const out = tempDir();
    exportSkills(f.kb, out);
    const text = readFileSync(join(out, "pdf-processing", "SKILL.md"), "utf8");

    const parsed = parseSkillMd(text, "pdf-processing");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.skill).toMatchObject({
      name: "pdf-processing",
      description: "Extract text from PDFs.",
      license: "Apache-2.0",
      compatibility: "Needs python",
      allowedTools: "Read",
    });
    expect(parsed.skill.metadata).toMatchObject({
      "pocket-title": "PDF processing",
      "pocket-tags": "pdf, documents",
      "pocket-source": "https://example.org/pdf",
    });
    expect(parsed.skill.body).toBe("# PDF processing\n\nUse a library.");
  });

  it("can include other statuses", () => {
    const f = skillFixture();
    const items = exportSkills(f.kb, tempDir(), { statuses: "all" });
    expect(items.map((i) => i.id)).toContain("still-a-draft");
    expect(exportSkills(f.kb, tempDir(), { statuses: ["draft"] }).map((i) => i.id)).toEqual(["still-a-draft"]);
  });

  it("refuses to overwrite a linked SKILL.md and leaves other files in the folder alone", () => {
    const f = skillFixture();
    const out = tempDir();
    mkdirSync(join(out, "pdf-processing"));
    writeFileSync(join(out, "elsewhere.md"), "other");
    symlinkSync(join(out, "elsewhere.md"), join(out, "pdf-processing", "SKILL.md"));
    const items = exportSkills(f.kb, out);
    expect(items.find((i) => i.id === "pdf-processing")?.errors[0]).toMatch(/symbolic link/);
    expect(readFileSync(join(out, "elsewhere.md"), "utf8")).toBe("other");

    const out2 = tempDir();
    mkdirSync(join(out2, "pdf-processing"));
    writeFileSync(join(out2, "pdf-processing", "notes.txt"), "keep me");
    exportSkills(f.kb, out2);
    expect(readFileSync(join(out2, "pdf-processing", "notes.txt"), "utf8")).toBe("keep me");
  });

  it("uses the full description when the summary had to be shortened", () => {
    const f = fixture();
    const long = `${"Long description. ".repeat(40).trim()}`;
    writeEntry(f.layers.main!, { id: "long-one", type: "skill", summary: "Short form.", extraFrontmatter: `description: ${long}\n` });
    const entry = f.kb.getEntry("long-one")!;
    const rendered = entryToSkillMd(entry);
    expect(rendered.ok).toBe(true);
    if (rendered.ok) expect(parseSkillMd(rendered.skill.text, "long-one")).toMatchObject({ ok: true, skill: { description: long } });
  });
});

describe("importing", () => {
  const front = "name: pdf-processing\ndescription: Extract text and fill forms in PDF files.\nlicense: MIT\nmetadata:\n  author: example-org";

  it("turns a skill folder into a pending proposal with provenance", () => {
    const f = fixture();
    const root = tempDir();
    const text = skillText(front, "# PDF processing\n\nRun the script.");
    writeSkill(root, "pdf-processing", text, { "scripts/run.sh": "echo hi", "references/guide.md": "more" });

    const items = importSkills(f.kb, f.store, root, { source: "https://example.org/skills" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "pdf-processing", outcome: "proposed", errors: [] });
    expect(items[0]!.warnings.join("\n")).toContain("Not imported");
    expect(items[0]!.warnings.join("\n")).toContain("references, scripts");

    const [pending] = f.store.list();
    expect(pending!.proposalId).toBe(items[0]!.proposalId);
    expect(pending!.entry.meta).toMatchObject({
      id: "pdf-processing",
      type: "skill",
      title: "PDF processing",
      summary: "Extract text and fill forms in PDF files.",
      status: "draft",
      source: "https://example.org/skills",
      license: "MIT",
      sourceHash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
      extra: { metadata: { author: "example-org" } },
    });
    expect(pending!.entry.body).toBe("# PDF processing\n\nRun the script.");
    expect(pending!.proposedBy).toBe("pocket import skills");
    expect(f.kb.getEntry("pdf-processing")).toBeUndefined();
  });

  it("needs a source, and lets --license override the file", () => {
    const f = fixture();
    const root = tempDir();
    writeSkill(root, "pdf-processing", skillText(front));
    expect(() => importSkills(f.kb, f.store, root, { source: "  " })).toThrow(/source is required/);

    importSkills(f.kb, f.store, root, { source: "https://example.org/s", license: "Apache-2.0" });
    expect(f.store.list()[0]!.entry.meta.license).toBe("Apache-2.0");
  });

  it("finds one skill folder, or the skill folders inside a folder, and says when there are none", () => {
    const f = fixture();
    const single = tempDir();
    writeFileSync(join(single, "SKILL.md"), skillText("name: x\ndescription: d"));
    // The folder name is the temp directory, so the name will not match: that is reported, not hidden.
    expect(importSkills(f.kb, f.store, single, { source: "s", dryRun: true })[0]!.errors[0]).toMatch(/must match the folder name/);

    const many = tempDir();
    writeSkill(many, "alpha-skill", skillText("name: alpha-skill\ndescription: First."));
    writeSkill(many, "beta-skill", skillText("name: beta-skill\ndescription: Second."));
    writeSkill(many, ".hidden-skill", skillText("name: hidden-skill\ndescription: Hidden."));
    mkdirSync(join(many, "no-skill-here"));
    const items = importSkills(f.kb, f.store, many, { source: "s" });
    expect(items.map((i) => i.name)).toEqual(["alpha-skill", "beta-skill"]);

    expect(() => importSkills(f.kb, f.store, tempDir(), { source: "s" })).toThrow(/No SKILL.md found/);
  });

  it("reports an invalid skill without blocking the others", () => {
    const f = fixture();
    const root = tempDir();
    writeSkill(root, "good-skill", skillText("name: good-skill\ndescription: Fine."));
    writeSkill(root, "wrong-skill", skillText("name: other\ndescription: Mismatch."));
    const items = importSkills(f.kb, f.store, root, { source: "s" });
    expect(items.map((i) => i.outcome)).toEqual(["proposed", "invalid"]);
    expect(f.store.list()).toHaveLength(1);
  });

  it("creates nothing in a dry run", () => {
    const f = fixture();
    const root = tempDir();
    writeSkill(root, "pdf-processing", skillText(front));
    const items = importSkills(f.kb, f.store, root, { source: "s", dryRun: true });
    expect(items[0]).toMatchObject({ outcome: "proposed" });
    expect(items[0]!.proposalId).toBeUndefined();
    expect(f.store.list()).toHaveLength(0);
  });

  it("will not follow a linked SKILL.md or read a huge one", () => {
    const f = fixture();
    const root = tempDir();
    const secret = join(tempDir(), "secret.md");
    writeFileSync(secret, skillText("name: linked-skill\ndescription: d"));
    mkdirSync(join(root, "linked-skill"));
    symlinkSync(secret, join(root, "linked-skill", "SKILL.md"));
    writeSkill(root, "huge-skill", skillText("name: huge-skill\ndescription: d", "x".repeat(300 * 1024)));
    const items = importSkills(f.kb, f.store, root, { source: "s" });
    expect(items.find((i) => i.name === "linked-skill")?.errors[0]).toMatch(/regular file/);
    expect(items.find((i) => i.name === "huge-skill")?.errors[0]).toMatch(/byte limit/);
    expect(f.store.list()).toHaveLength(0);
  });

  it("keeps a long description whole", () => {
    const f = fixture();
    const root = tempDir();
    const long = "This skill does many things. ".repeat(30).trim();
    writeSkill(root, "wordy-skill", skillText(`name: wordy-skill\ndescription: ${long}`));
    const items = importSkills(f.kb, f.store, root, { source: "s" });
    expect(items[0]!.warnings.join("\n")).toContain("summary was shortened");
    const meta = f.store.list()[0]!.entry.meta;
    expect(meta.summary).toHaveLength(500);
    expect(meta.summary.endsWith("...")).toBe(true);
    expect(meta.extra.description).toBe(long);
  });

  it("proposes an update when the skill already exists, and nothing when it is unchanged", () => {
    const f = fixture();
    const root = tempDir();
    writeSkill(root, "pdf-processing", skillText(front, "First version."));
    const first = importSkills(f.kb, f.store, root, { source: "https://example.org/s" });
    approveProposal(f.kb, f.store, first[0]!.proposalId!, { status: "active" });
    expect(f.kb.getEntry("pdf-processing")?.version).toBe(1);

    const again = importSkills(f.kb, f.store, root, { source: "https://example.org/s" });
    expect(again[0]!.outcome).toBe("unchanged");

    writeSkill(root, "pdf-processing", skillText(front, "Second version."));
    const changed = importSkills(f.kb, f.store, root, { source: "https://example.org/s" });
    expect(changed[0]!.outcome).toBe("proposed-update");
    const proposal = f.store.get(changed[0]!.proposalId!);
    expect(proposal).toMatchObject({ action: "update", baseVersion: 1 });
    expect(proposal.entry.body).toBe("Second version.");
    // The title and tags a person already set are kept; only the imported material changes.
    expect(proposal.entry.meta.title).toBe(f.kb.getEntry("pdf-processing")!.title);
  });

  it("removes a pre-approved tool list that the new version no longer has", () => {
    const f = fixture();
    const root = tempDir();
    writeSkill(root, "pdf-processing", skillText(`${front}\nallowed-tools: Bash(git:*)`, "One."));
    const first = importSkills(f.kb, f.store, root, { source: "s" });
    approveProposal(f.kb, f.store, first[0]!.proposalId!);
    expect(f.kb.getEntry("pdf-processing")?.extra["allowed-tools"]).toBe("Bash(git:*)");

    writeSkill(root, "pdf-processing", skillText(front, "One."));
    const next = importSkills(f.kb, f.store, root, { source: "s" });
    expect(next[0]!.outcome).toBe("proposed-update");
    expect(f.store.get(next[0]!.proposalId!).entry.meta.extra).not.toHaveProperty("allowed-tools");
  });

  it("will not turn a different type of entry into a skill", () => {
    const f = fixture();
    writeEntry(f.layers.main!, { id: "pdf-processing", type: "process" });
    const root = tempDir();
    writeSkill(root, "pdf-processing", skillText(front));
    const items = importSkills(f.kb, f.store, root, { source: "s" });
    expect(items[0]!.outcome).toBe("invalid");
    expect(items[0]!.errors[0]).toMatch(/already exists with type "process"/);
  });

  it("proposes nothing when you import your own export again", () => {
    const f = fixture();
    const root = tempDir();
    writeSkill(root, "pdf-processing", skillText(front, "Steps."));
    const first = importSkills(f.kb, f.store, root, { source: "https://example.org/s" });
    approveProposal(f.kb, f.store, first[0]!.proposalId!, { status: "active" });

    // The exported file is formatted differently, so its hash differs, but nothing a person cares about does.
    const out = tempDir();
    exportSkills(f.kb, out);
    const again = importSkills(f.kb, f.store, out, { source: "https://example.org/s" });
    expect(again[0]!.outcome).toBe("unchanged");
    expect(f.store.list()).toHaveLength(0);
  });

  it("round-trips through export and import", () => {
    const original = fixture();
    writeEntry(original.layers.main!, {
      id: "pdf-processing",
      type: "skill",
      title: "PDF processing",
      summary: "Extract text from PDFs.",
      body: "# Heading\n\nSteps here.",
      extraFrontmatter: "status: active\ntags: [pdf, documents]\nlicense: MIT\n",
    });
    const out = tempDir();
    exportSkills(original.kb, out);

    const fresh = fixture();
    const items = importSkills(fresh.kb, fresh.store, out, { source: "round trip" });
    expect(items[0]!.outcome).toBe("proposed");
    const meta = fresh.store.list()[0]!.entry.meta;
    expect(meta).toMatchObject({
      id: "pdf-processing",
      title: "PDF processing",
      summary: "Extract text from PDFs.",
      tags: ["pdf", "documents"],
      license: "MIT",
    });
    expect(fresh.store.list()[0]!.entry.body).toBe("# Heading\n\nSteps here.");
  });
});
