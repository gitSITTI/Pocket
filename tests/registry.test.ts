import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRegistryMetadata, syncVersions } from "../scripts/registry-metadata.mjs";

const root = join(import.meta.dirname, "..");
const read = (file: string): string => readFileSync(join(root, file), "utf8");
const pkg = (): Record<string, any> => JSON.parse(read("package.json"));
const server = (): Record<string, any> => JSON.parse(read("server.json"));

describe("MCP Registry metadata", () => {
  it("is consistent in the repository", () => {
    expect(checkRegistryMetadata({ pkg: pkg(), server: server() })).toEqual([]);
  });

  it("names the server the same way in both files", () => {
    expect(pkg().mcpName).toBe(server().name);
    expect(server().name).toMatch(/^io\.github\.[^/]+\/[^/]+$/);
  });

  it("can be started with npx under the package name", () => {
    expect(pkg().bin).toHaveProperty("pocket-bok", "dist/server.js");
  });

  it("documents the same environment variables as the configuration guide", () => {
    const inServerJson = server().packages[0].environmentVariables.map((v: { name: string }) => v.name).sort();
    const table = read("docs/configuration.md").split("## Environment variables")[1]!.split("\n## ")[0]!;
    const inGuide = [...table.matchAll(/^\| `(POCKET_[A-Z_]+)`/gm)].map((m) => m[1]).sort();
    expect(inServerJson).toEqual(inGuide);
  });

  it("keeps the lock file at the package version", () => {
    const lock = JSON.parse(read("package-lock.json"));
    expect(lock.name).toBe(pkg().name);
    expect(lock.version).toBe(pkg().version);
  });

  it("pins the publisher with a checksum in the publish workflow", () => {
    const workflow = read(".github/workflows/publish.yml");
    expect(workflow).toMatch(/MCP_PUBLISHER_VERSION: v\d+\.\d+\.\d+/);
    expect(workflow).toMatch(/MCP_PUBLISHER_SHA256: [0-9a-f]{64}\b/);
    expect(workflow).toContain("sha256sum --check --strict");
  });
});

describe("registry metadata checks", () => {
  const problems = (change: (p: Record<string, any>, s: Record<string, any>) => void, tag?: string): string[] => {
    const p = pkg();
    const s = server();
    change(p, s);
    return checkRegistryMetadata({ pkg: p, server: s, tag });
  };

  it("catch a name that does not match mcpName", () => {
    expect(problems((p) => (p.mcpName = "io.github.gitSITTI/other")).join("\n")).toMatch(/must equal server.json name/);
    expect(problems((p) => delete p.mcpName).join("\n")).toMatch(/needs an "mcpName"/);
  });

  it("catch a version that has drifted", () => {
    expect(problems((_p, s) => (s.version = "9.9.9")).join("\n")).toMatch(/server.json version "9.9.9"/);
    expect(problems((_p, s) => (s.packages[0].version = "9.9.9")).join("\n")).toMatch(/packages\[0\] version/);
    expect(problems((_p, s) => (s.version = "^0.1.0")).join("\n")).toMatch(/not a range/);
  });

  it("catch a description the registry would reject", () => {
    expect(problems((_p, s) => (s.description = "x".repeat(101))).join("\n")).toMatch(/1 to 100 characters \(it is 101\)/);
    expect(problems((_p, s) => (s.description = "")).join("\n")).toMatch(/1 to 100 characters/);
  });

  it("catch a package identifier that is not the npm package", () => {
    expect(problems((_p, s) => (s.packages[0].identifier = "someone-else")).join("\n")).toMatch(/must be the npm package name/);
  });

  it("catch a namespace that does not belong to the repository owner", () => {
    const found = problems((p, s) => {
      p.mcpName = "io.github.somebody/pocket";
      s.name = "io.github.somebody/pocket";
    });
    expect(found.join("\n")).toMatch(/must start with io\.github\.gitSITTI\//);
  });

  it("accept the owner in a different capitalization when comparing repositories", () => {
    expect(problems((p) => (p.repository.url = "git+https://github.com/gitsitti/pocket.git"))).toEqual([]);
    expect(problems((p) => (p.repository.url = "git+https://github.com/gitSITTI/Other.git")).join("\n")).toMatch(/different repositories/);
  });

  it("catch several bins when none is named like the package", () => {
    expect(problems((p) => delete p.bin["pocket-bok"]).join("\n")).toMatch(/cannot choose one/);
  });

  it("check the release tag", () => {
    const version = pkg().version as string;
    expect(problems(() => {}, `v${version}`)).toEqual([]);
    expect(problems(() => {}, "v0.0.0").join("\n")).toMatch(/does not match package.json version/);
    expect(problems(() => {}, version).join("\n")).toMatch(/expected "v/);
  });
});

describe("registry metadata sync", () => {
  it("copies the package version into server.json", () => {
    const p = { ...pkg(), version: "1.2.3" };
    const synced = syncVersions({ pkg: p, server: server() });
    expect(synced.version).toBe("1.2.3");
    expect(synced.packages[0].version).toBe("1.2.3");
    expect(synced.name).toBe(server().name);
    expect(checkRegistryMetadata({ pkg: p, server: synced })).toEqual([]);
  });
});

describe("registry metadata command", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [join(root, "scripts/registry-metadata.mjs"), ...args], { encoding: "utf8" });

  it("passes on the repository and fails on a wrong tag", () => {
    expect(run("check").status).toBe(0);
    const wrong = run("check", "--tag", "v0.0.0");
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain("does not match package.json version");
  });

  it("explains how to use it", () => {
    const result = run("nonsense");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage:");
  });
});
