import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approveProposal, proposeAdd, proposeUpdate, rejectProposal } from "../src/proposals.js";
import { fixture, writeEntry } from "./helpers.js";

const addInput = {
  id: "new-entry",
  type: "process",
  title: "New entry",
  summary: "Proposed by an agent.",
  body: "Details.",
  rationale: "Because we learned something.",
  proposedBy: "test-agent",
};

describe("proposing", () => {
  it("writes a pending proposal and does not touch the content", () => {
    const { layers, kb, store } = fixture();
    const result = proposeAdd(kb, store, addInput);
    expect(result.ok).toBe(true);
    expect(store.list()).toHaveLength(1);
    expect(existsSync(join(layers.main!, "process", "new-entry.md"))).toBe(false);
    expect(kb.getEntry("new-entry")).toBeUndefined();
  });

  it("rejects bad input with reasons instead of creating a proposal", () => {
    const { kb, store } = fixture();
    for (const bad of [
      { ...addInput, id: "Bad Id" },
      { ...addInput, type: "nonsense" },
      { ...addInput, body: "   " },
      { ...addInput, scope: "nowhere" },
    ]) {
      const result = proposeAdd(kb, store, bad);
      expect(result.ok).toBe(false);
    }
    expect(store.list()).toHaveLength(0);
  });

  it("refuses to add an id that already exists", () => {
    const { layers, kb, store } = fixture();
    writeEntry(layers.main!, { id: "taken" });
    const result = proposeAdd(kb, store, { ...addInput, id: "taken" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/already exists/);
  });

  it("rejects an update to a missing entry, a stale base version, or no change", () => {
    const { layers, kb, store } = fixture();
    writeEntry(layers.main!, { id: "doc", title: "Doc" });
    const base = { rationale: "r" };
    expect(proposeUpdate(kb, store, { ...base, id: "missing", patch: { title: "x" } }).ok).toBe(false);
    expect(proposeUpdate(kb, store, { ...base, id: "doc", baseVersion: 7, patch: { title: "x" } }).ok).toBe(false);
    expect(proposeUpdate(kb, store, { ...base, id: "doc", patch: { title: "Doc" } }).ok).toBe(false);
    expect(store.list()).toHaveLength(0);
  });
});

describe("approving", () => {
  it("writes a new entry at version 1, then archives the proposal", () => {
    const { layers, kb, store } = fixture();
    const result = proposeAdd(kb, store, addInput);
    if (!result.ok) throw new Error(result.errors.join("; "));

    const approved = approveProposal(kb, store, result.proposal.proposalId, { status: "active" });
    expect(approved.version).toBe(1);
    expect(approved.path).toBe(join(layers.main!, "process", "new-entry.md"));

    const written = readFileSync(approved.path, "utf8");
    expect(written).toMatch(/^---\nid: new-entry\n/);
    expect(written).toMatch(/status: active/);
    expect(written).toMatch(/version: 1/);
    expect(kb.getEntry("new-entry")?.body).toBe("Details.\n");
    expect(kb.issues()).toEqual([]);

    expect(store.list()).toHaveLength(0);
    expect(store.get(result.proposal.proposalId).state).toBe("approved");
    expect(readdirSync(join(store.dir, "archive"))).toHaveLength(1);
  });

  it("keeps extra frontmatter keys flat and never writes an 'extra:' key", () => {
    const { kb, store } = fixture(["main"], {
      types: [
        { name: "runbook", description: "Ops steps", requiredFields: ["owner"] },
        { name: "process", description: "A process" },
      ],
    });
    const result = proposeAdd(kb, store, {
      ...addInput,
      id: "ops-runbook",
      type: "runbook",
      extra: { owner: "team-a", severity: 2 },
    });
    if (!result.ok) throw new Error(result.errors.join("; "));
    const approved = approveProposal(kb, store, result.proposal.proposalId);

    const text = readFileSync(approved.path, "utf8");
    expect(text).not.toMatch(/^extra:/m);
    expect(text).toMatch(/^owner: team-a$/m);
    expect(text).toMatch(/^severity: 2$/m);
    expect(kb.getEntry("ops-runbook")?.extra).toEqual({ owner: "team-a", severity: 2 });
    expect(kb.issues()).toEqual([]);
  });

  it("applies an update, bumps the version and keeps created", () => {
    const { kb, store, layers } = fixture();
    writeEntry(layers.main!, { id: "doc", title: "Old title", extraFrontmatter: "created: 2026-01-02\n" });
    const result = proposeUpdate(kb, store, {
      id: "doc",
      baseVersion: 1,
      patch: { title: "New title", body: "Rewritten." },
      rationale: "Clearer.",
    });
    if (!result.ok) throw new Error(result.errors.join("; "));

    const approved = approveProposal(kb, store, result.proposal.proposalId);
    expect(approved.version).toBe(2);
    const entry = kb.getEntry("doc")!;
    expect(entry.title).toBe("New title");
    expect(entry.body).toBe("Rewritten.\n");
    expect(entry.version).toBe(2);
    expect(entry.created).toBe("2026-01-02");
    expect(entry.filePath).toBe(join(layers.main!, "process", "doc.md"));
  });

  it("refuses a stale update if the entry changed after the proposal", () => {
    const { kb, store, layers } = fixture();
    writeEntry(layers.main!, { id: "doc" });
    const first = proposeUpdate(kb, store, { id: "doc", patch: { title: "From agent one" }, rationale: "r" });
    const second = proposeUpdate(kb, store, { id: "doc", patch: { title: "From agent two" }, rationale: "r" });
    if (!first.ok || !second.ok) throw new Error("setup failed");

    approveProposal(kb, store, first.proposal.proposalId);
    expect(() => approveProposal(kb, store, second.proposal.proposalId)).toThrow(/Stale proposal/);
    expect(kb.getEntry("doc")?.title).toBe("From agent one");
    expect(store.list()).toHaveLength(1); // the stale one is still pending until rejected
  });

  it("refuses an add if the id appeared in the meantime", () => {
    const { kb, store, layers } = fixture();
    const result = proposeAdd(kb, store, addInput);
    if (!result.ok) throw new Error("setup failed");
    writeEntry(layers.main!, { id: "new-entry" });
    expect(() => approveProposal(kb, store, result.proposal.proposalId)).toThrow(/now exists/);
  });

  it("writes an override into another layer without touching the original", () => {
    const { kb, store, layers } = fixture(["global", "project"]);
    const original = writeEntry(layers.global!, { id: "shared", title: "Global" });
    const before = readFileSync(original, "utf8");
    const result = proposeUpdate(kb, store, { id: "shared", scope: "project", patch: { title: "Project" }, rationale: "r" });
    if (!result.ok) throw new Error(result.errors.join("; "));
    const approved = approveProposal(kb, store, result.proposal.proposalId);
    expect(approved.path).toBe(join(layers.project!, "process", "shared.md"));
    expect(readFileSync(original, "utf8")).toBe(before);
    expect(kb.getEntry("shared")?.title).toBe("Project");
  });

  it("cannot approve the same proposal twice, and cannot use a malformed id", () => {
    const { kb, store } = fixture();
    const result = proposeAdd(kb, store, addInput);
    if (!result.ok) throw new Error("setup failed");
    approveProposal(kb, store, result.proposal.proposalId);
    expect(() => approveProposal(kb, store, result.proposal.proposalId)).toThrow(/already approved/);
    expect(() => store.get("../../etc/passwd")).toThrow(/Not a valid proposal id/);
  });

  it("re-validates against the current types when approving", () => {
    const { kb, store, config } = fixture();
    const result = proposeAdd(kb, store, addInput);
    if (!result.ok) throw new Error("setup failed");
    // Tamper with the stored proposal so it points at a type that does not exist.
    const file = join(store.dir, `${result.proposal.proposalId}.json`);
    const stored = JSON.parse(readFileSync(file, "utf8"));
    stored.entry.meta.type = "nonsense";
    writeFileSync(file, JSON.stringify(stored));
    expect(() => approveProposal(kb, store, result.proposal.proposalId)).toThrow(/no longer validates/);
    expect(config.contentDirs).toHaveLength(1);
  });
});

describe("rejecting", () => {
  it("records the decision and writes nothing", () => {
    const { kb, store, layers } = fixture();
    const result = proposeAdd(kb, store, addInput);
    if (!result.ok) throw new Error("setup failed");
    rejectProposal(store, result.proposal.proposalId, "Not useful.");
    const decided = store.get(result.proposal.proposalId);
    expect(decided.state).toBe("rejected");
    expect(decided.decisionNote).toBe("Not useful.");
    expect(store.list()).toHaveLength(0);
    expect(existsSync(join(layers.main!, "process", "new-entry.md"))).toBe(false);
  });
});
