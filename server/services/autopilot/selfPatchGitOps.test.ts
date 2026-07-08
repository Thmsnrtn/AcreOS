/**
 * Tests for the self-patch GitOps helpers (step-away gap #4).
 *
 * Coverage (pure surface only — the child-process runner is exercised through
 * the capability preflight contract, not by shelling out in unit scope):
 *  - diffLockfilePackages: version changes detected, additions/removals
 *    ignored (no from/to pair), malformed JSON degrades to []
 *  - assertSelfPatchCapable: refuses without GITHUB_TOKEN / GITHUB_REPOSITORY
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { diffLockfilePackages, assertSelfPatchCapable } from "./selfPatchGitOps";

function lock(packages: Record<string, { version: string }>): string {
  return JSON.stringify({ lockfileVersion: 3, packages });
}

describe("diffLockfilePackages", () => {
  it("reports a top-level version change", () => {
    const before = lock({ "node_modules/lodash": { version: "4.17.20" } });
    const after = lock({ "node_modules/lodash": { version: "4.17.21" } });
    expect(diffLockfilePackages(before, after)).toEqual([
      { name: "lodash", fromVersion: "4.17.20", toVersion: "4.17.21" },
    ]);
  });

  it("reports nested (transitive) changes under their full path name", () => {
    const before = lock({ "node_modules/a/node_modules/b": { version: "1.0.0" } });
    const after = lock({ "node_modules/a/node_modules/b": { version: "1.0.1" } });
    const diff = diffLockfilePackages(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0].name).toBe("a/node_modules/b");
    expect(diff[0].toVersion).toBe("1.0.1");
  });

  it("ignores unchanged packages, additions, and removals", () => {
    const before = lock({
      "node_modules/same": { version: "1.0.0" },
      "node_modules/removed": { version: "2.0.0" },
    });
    const after = lock({
      "node_modules/same": { version: "1.0.0" },
      "node_modules/added": { version: "3.0.0" },
    });
    expect(diffLockfilePackages(before, after)).toEqual([]);
  });

  it("ignores the root '' entry and non-node_modules keys", () => {
    const before = JSON.stringify({ packages: { "": { version: "1.0.0" } } });
    const after = JSON.stringify({ packages: { "": { version: "1.0.1" } } });
    expect(diffLockfilePackages(before, after)).toEqual([]);
  });

  it("degrades to [] on malformed JSON", () => {
    expect(diffLockfilePackages("not json", lock({}))).toEqual([]);
    expect(diffLockfilePackages(lock({}), "{broken")).toEqual([]);
  });
});

describe("assertSelfPatchCapable", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    saved.GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
  });

  afterEach(() => {
    if (saved.GITHUB_TOKEN === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = saved.GITHUB_TOKEN;
    if (saved.GITHUB_REPOSITORY === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = saved.GITHUB_REPOSITORY;
  });

  it("refuses without GITHUB_TOKEN", async () => {
    const r = await assertSelfPatchCapable();
    expect(r.capable).toBe(false);
    expect(r.reason).toContain("GITHUB_TOKEN");
  });

  it("refuses with a token but no GITHUB_REPOSITORY", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    const r = await assertSelfPatchCapable();
    expect(r.capable).toBe(false);
    expect(r.reason).toContain("GITHUB_REPOSITORY");
  });

  it("refuses a malformed GITHUB_REPOSITORY (must be owner/name)", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    process.env.GITHUB_REPOSITORY = "not-a-repo-slug";
    const r = await assertSelfPatchCapable();
    expect(r.capable).toBe(false);
    expect(r.reason).toContain("GITHUB_REPOSITORY");
  });
});
