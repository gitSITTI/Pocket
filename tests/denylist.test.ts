import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers.js";

const SCRIPT = resolve("scripts/denylist-check.sh");
const TERM = "zebracorn";

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/** A throwaway git repo with a private term list. Pass null for no list at all. */
function repo(denylist: string | null = `# private terms\n\n${TERM}\n   \n`): string {
  const dir = tempDir();
  git(dir, "init", "-q");
  git(dir, "config", "user.name", "Test User");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, ".gitignore"), "/.denylist\n");
  if (denylist !== null) writeFileSync(join(dir, ".denylist"), denylist);
  return dir;
}

function run(dir: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("sh", [SCRIPT, ...args], {
    cwd: dir,
    encoding: "utf8",
    // GITHUB_ACTIONS is set when these tests run in CI; default it off so output is the local kind.
    env: { ...process.env, GITHUB_ACTIONS: "", ...env },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function write(dir: string, name: string, text: string): void {
  writeFileSync(join(dir, name), text);
  git(dir, "add", name);
}

function commit(dir: string, message: string): void {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}

describe("denylist-check: staged files", () => {
  it("passes when nothing matches, ignoring blank and comment lines in the list", () => {
    const dir = repo();
    write(dir, "clean.txt", "hello world\n");
    expect(run(dir, ["staged"]).code).toBe(0);
  });

  it("blocks a term case-insensitively and points to the line without printing the term", () => {
    const dir = repo();
    write(dir, "note.txt", "line one\nI saw a ZebraCorn today\nline three\n");
    const { code, out } = run(dir, ["staged"]);
    expect(code).toBe(1);
    expect(out).toContain("note.txt:2");
    expect(out.toLowerCase()).not.toContain(TERM);
  });

  it("blocks a file whose name contains a term", () => {
    const dir = repo();
    write(dir, `${TERM}-plan.txt`, "harmless text\n");
    const { code, out } = run(dir, ["staged"]);
    expect(code).toBe(1);
    expect(out).toContain("(file name)");
  });

  it("does not match when only a comment in the list resembles the text", () => {
    const dir = repo("# zebra\n");
    write(dir, "note.txt", "a zebra walked by\n");
    const { code, out } = run(dir, ["staged"]);
    expect(code).toBe(0);
    expect(out).toContain("has no terms");
  });
});

describe("denylist-check: commit messages and history", () => {
  it("checks a commit message file", () => {
    const dir = repo();
    const bad = join(dir, "msg-bad");
    const good = join(dir, "msg-good");
    writeFileSync(bad, `Fix the ${TERM.toUpperCase()} thing\n`);
    writeFileSync(good, "Fix the thing\n");
    const rejected = run(dir, ["message", bad]);
    expect(rejected.code).toBe(1);
    expect(rejected.out).toContain("commit message");
    expect(rejected.out.toLowerCase()).not.toContain(TERM);
    expect(run(dir, ["message", good]).code).toBe(0);
  });

  it("scans every tracked file and name in tree mode", () => {
    const dir = repo();
    writeFileSync(join(dir, "leak.txt"), `secret ${TERM}\n`);
    commit(dir, "add a file");
    const { code, out } = run(dir, ["tree"]);
    expect(code).toBe(1);
    expect(out).toContain("leak.txt:1");
    expect(out.toLowerCase()).not.toContain(TERM);
  });

  it("scans commit messages and authors in history mode", () => {
    const dir = repo();
    writeFileSync(join(dir, "a.txt"), "fine\n");
    commit(dir, "first, clean commit");
    expect(run(dir, ["history"]).code).toBe(0);

    writeFileSync(join(dir, "b.txt"), "also fine\n");
    commit(dir, `mentions ${TERM} in the message`);
    const byMessage = run(dir, ["history"]);
    expect(byMessage.code).toBe(1);
    expect(byMessage.out).toContain("commit ");
    expect(byMessage.out.toLowerCase()).not.toContain(TERM);

    const other = repo();
    git(other, "config", "user.name", `Dr ${TERM}`);
    writeFileSync(join(other, "a.txt"), "fine\n");
    commit(other, "clean message");
    expect(run(other, ["history"]).code).toBe(1);
  });

  it("works on a repo with no commits yet", () => {
    const dir = repo();
    expect(run(dir, ["history"]).code).toBe(0);
    expect(run(dir, ["tree"]).code).toBe(0);
  });
});

describe("denylist-check: output and configuration", () => {
  it("hides locations in GitHub Actions because the log is public", () => {
    const dir = repo();
    writeFileSync(join(dir, `${TERM}.txt`), `contains ${TERM}\n`);
    commit(dir, "add");
    const { code, out } = run(dir, ["tree"], { GITHUB_ACTIONS: "true" });
    expect(code).toBe(1);
    expect(out).toContain("hidden");
    expect(out).not.toContain(".txt");
    expect(out.toLowerCase()).not.toContain(TERM);
  });

  it("does nothing, successfully, when there is no term list", () => {
    const dir = repo(null);
    write(dir, "note.txt", `contains ${TERM}\n`);
    const { code, out } = run(dir, ["staged"]);
    expect(code).toBe(0);
    expect(out).toContain("did not run");
  });

  it("reads terms from DENYLIST_FILE when set", () => {
    const dir = repo(null);
    const elsewhere = join(tempDir(), "terms.txt");
    writeFileSync(elsewhere, `${TERM}\r\n`); // Windows line endings are handled
    write(dir, "note.txt", `contains ${TERM}\n`);
    expect(run(dir, ["staged"], { DENYLIST_FILE: elsewhere }).code).toBe(1);
  });

  it("rejects an unknown mode", () => {
    expect(run(repo(), ["bogus"]).code).toBe(2);
  });
});

describe("git hooks", () => {
  /** A repo wired to this project's hooks, with a stand-in for gitleaks that always passes. */
  function hooked(): { dir: string; env: Record<string, string> } {
    const dir = repo();
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, ".githooks"));
    copyFileSync(SCRIPT, join(dir, "scripts/denylist-check.sh"));
    for (const hook of ["pre-commit", "commit-msg"]) {
      copyFileSync(resolve(".githooks", hook), join(dir, ".githooks", hook));
      chmodSync(join(dir, ".githooks", hook), 0o755);
    }
    git(dir, "config", "core.hooksPath", ".githooks");
    const shimDir = tempDir();
    writeFileSync(join(shimDir, "gitleaks"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(shimDir, "gitleaks"), 0o755);
    return { dir, env: { PATH: `${shimDir}:${process.env.PATH}`, GITHUB_ACTIONS: "" } };
  }

  function tryCommit(dir: string, env: Record<string, string>, message: string) {
    return spawnSync("git", ["commit", "-q", "-m", message], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
  }

  it("pre-commit blocks a private term and lets clean changes through", () => {
    const { dir, env } = hooked();
    write(dir, "bad.txt", `contains ${TERM}\n`);
    const blocked = tryCommit(dir, env, "add bad file");
    expect(blocked.status).not.toBe(0);
    expect(`${blocked.stdout}${blocked.stderr}`.toLowerCase()).not.toContain(TERM);

    git(dir, "reset", "-q", "bad.txt");
    write(dir, "good.txt", "all fine\n");
    expect(tryCommit(dir, env, "add good file").status).toBe(0);
  });

  it("commit-msg blocks a private term in the message", () => {
    const { dir, env } = hooked();
    write(dir, "good.txt", "all fine\n");
    expect(tryCommit(dir, env, `about ${TERM}`).status).not.toBe(0);
    expect(tryCommit(dir, env, "about something else").status).toBe(0);
  });
});
