// ============================================================================
// scripts/check-interactive-claims.test.mjs
// ----------------------------------------------------------------------------
// Tests for L1.5 filesystem-lock primitive. Verifies the pure-function
// decision core (findConflicts) plus the lock-file loader (loadActiveLocks)
// and the end-to-end CLI invocation with stdin staged-files protocol.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import {
  findConflicts,
  loadActiveLocks,
  matchesPattern,
} from "./check-interactive-claims.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, "check-interactive-claims.mjs");

let scratchDir;
let locksDir;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "solene-locks-test-"));
  locksDir = join(scratchDir, ".solene-locks");
  mkdirSync(locksDir, { recursive: true });
});

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

function writeLock(name, body) {
  writeFileSync(join(locksDir, name), JSON.stringify(body, null, 2), "utf-8");
}

function nowIso(offsetMin = 0) {
  return new Date(Date.now() + offsetMin * 60_000).toISOString();
}

// ── matchesPattern unit tests ───────────────────────────────────────────────

describe("matchesPattern", () => {
  it("exact path matches", () => {
    expect(matchesPattern("a/b.ts", "a/b.ts")).toBe(true);
  });

  it("single-segment glob matches", () => {
    expect(matchesPattern("a/foo.ts", "a/*.ts")).toBe(true);
    expect(matchesPattern("a/sub/foo.ts", "a/*.ts")).toBe(false);
  });

  it("double-star glob matches across segments", () => {
    expect(matchesPattern("server/services/iris/x.ts", "server/**/*.ts")).toBe(true);
    expect(matchesPattern("server/x.ts", "server/**/*.ts")).toBe(true);
  });

  it("non-matching path returns false", () => {
    expect(matchesPattern("client/x.tsx", "server/**/*.ts")).toBe(false);
  });
});

// ── loadActiveLocks tests ───────────────────────────────────────────────────

describe("loadActiveLocks", () => {
  it("returns empty when no locks directory", () => {
    const missingDir = join(scratchDir, "no-such-dir");
    expect(loadActiveLocks(missingDir)).toEqual([]);
  });

  it("returns empty when locks directory is empty", () => {
    expect(loadActiveLocks(locksDir)).toEqual([]);
  });

  it("loads a non-expired lock", () => {
    writeLock("agent-a.json", {
      agentId: "agent-a",
      agentRole: "iris",
      claimedAt: nowIso(0),
      ttlMinutes: 30,
      fileSurfacePatterns: ["server/x.ts"],
      note: "test",
    });
    const locks = loadActiveLocks(locksDir);
    expect(locks).toHaveLength(1);
    expect(locks[0].agentId).toBe("agent-a");
  });

  it("filters out expired locks", () => {
    writeLock("expired.json", {
      agentId: "expired",
      agentRole: "iris",
      claimedAt: nowIso(-60),
      ttlMinutes: 30, // expired 30 min ago
      fileSurfacePatterns: ["server/x.ts"],
    });
    writeLock("fresh.json", {
      agentId: "fresh",
      agentRole: "soren",
      claimedAt: nowIso(0),
      ttlMinutes: 30,
      fileSurfacePatterns: ["client/x.tsx"],
    });
    const locks = loadActiveLocks(locksDir);
    expect(locks).toHaveLength(1);
    expect(locks[0].agentId).toBe("fresh");
  });

  it("skips malformed lock files", () => {
    writeFileSync(join(locksDir, "broken.json"), "{ this is not json", "utf-8");
    writeLock("ok.json", {
      agentId: "ok",
      agentRole: "iris",
      claimedAt: nowIso(0),
      ttlMinutes: 30,
      fileSurfacePatterns: ["server/x.ts"],
    });
    const locks = loadActiveLocks(locksDir);
    expect(locks).toHaveLength(1);
    expect(locks[0].agentId).toBe("ok");
  });
});

// ── findConflicts decision-core tests ───────────────────────────────────────

describe("findConflicts", () => {
  it("no locks → no conflicts", () => {
    const conflicts = findConflicts({
      stagedFiles: ["server/x.ts"],
      locks: [],
      currentAgentId: null,
    });
    expect(conflicts).toEqual([]);
  });

  it("staged file outside any pattern → no conflict", () => {
    const conflicts = findConflicts({
      stagedFiles: ["docs/readme.md"],
      locks: [
        {
          agentId: "other",
          agentRole: "iris",
          fileSurfacePatterns: ["server/**/*.ts"],
        },
      ],
      currentAgentId: "me",
    });
    expect(conflicts).toEqual([]);
  });

  it("staged file matches OTHER agent's pattern → conflict", () => {
    const conflicts = findConflicts({
      stagedFiles: ["server/services/iris/x.ts"],
      locks: [
        {
          agentId: "other",
          agentRole: "iris",
          fileSurfacePatterns: ["server/**/*.ts"],
        },
      ],
      currentAgentId: "me",
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].agentId).toBe("other");
    expect(conflicts[0].file).toBe("server/services/iris/x.ts");
  });

  it("staged file matches SAME agent's pattern → allowed", () => {
    const conflicts = findConflicts({
      stagedFiles: ["server/services/iris/x.ts"],
      locks: [
        {
          agentId: "me",
          agentRole: "iris",
          fileSurfacePatterns: ["server/**/*.ts"],
        },
      ],
      currentAgentId: "me",
    });
    expect(conflicts).toEqual([]);
  });

  it("glob pattern matches correctly", () => {
    const conflicts = findConflicts({
      stagedFiles: ["server/services/foo/bar.ts", "client/src/a.tsx"],
      locks: [
        {
          agentId: "other",
          agentRole: "iris",
          fileSurfacePatterns: ["server/**/*.ts"],
        },
      ],
      currentAgentId: "me",
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].file).toBe("server/services/foo/bar.ts");
  });

  it("no currentAgentId → any matching lock conflicts", () => {
    const conflicts = findConflicts({
      stagedFiles: ["x.ts"],
      locks: [
        { agentId: "a", agentRole: "iris", fileSurfacePatterns: ["x.ts"] },
      ],
      currentAgentId: null,
    });
    expect(conflicts).toHaveLength(1);
  });
});

// ── CLI end-to-end tests via subprocess ─────────────────────────────────────

function runCli({ stagedFiles, env = {} }) {
  const input = stagedFiles.join("\n") + "\n";
  try {
    const stdout = execFileSync("node", [SCRIPT_PATH], {
      input,
      encoding: "utf-8",
      env: {
        ...process.env,
        SOLENE_REPO_ROOT: scratchDir,
        // Strip any inherited bypass envs unless the test sets them.
        SOLENE_BYPASS_INTERACTIVE_CLAIMS: "",
        SOLENE_AGENT_ID: "",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

describe("CLI end-to-end", () => {
  it("exits 0 when no locks exist", () => {
    const result = runCli({ stagedFiles: ["server/x.ts"] });
    expect(result.code).toBe(0);
  });

  it("exits 1 when staged file is claimed by another agent", () => {
    writeLock("other.json", {
      agentId: "other-agent",
      agentRole: "iris",
      claimedAt: nowIso(0),
      ttlMinutes: 30,
      fileSurfacePatterns: ["server/x.ts"],
      note: "test claim",
    });
    const result = runCli({
      stagedFiles: ["server/x.ts"],
      env: { SOLENE_AGENT_ID: "me" },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("other-agent");
    expect(result.stderr).toContain("server/x.ts");
  });

  it("exits 0 when staged file is claimed by SAME agent", () => {
    writeLock("me.json", {
      agentId: "me",
      agentRole: "iris",
      claimedAt: nowIso(0),
      ttlMinutes: 30,
      fileSurfacePatterns: ["server/x.ts"],
    });
    const result = runCli({
      stagedFiles: ["server/x.ts"],
      env: { SOLENE_AGENT_ID: "me" },
    });
    expect(result.code).toBe(0);
  });

  it("ignores expired locks", () => {
    writeLock("expired.json", {
      agentId: "other-agent",
      agentRole: "iris",
      claimedAt: nowIso(-120),
      ttlMinutes: 30,
      fileSurfacePatterns: ["server/x.ts"],
    });
    const result = runCli({
      stagedFiles: ["server/x.ts"],
      env: { SOLENE_AGENT_ID: "me" },
    });
    expect(result.code).toBe(0);
  });

  it("SOLENE_BYPASS_INTERACTIVE_CLAIMS=1 allows commit despite conflict", () => {
    writeLock("other.json", {
      agentId: "other-agent",
      agentRole: "iris",
      claimedAt: nowIso(0),
      ttlMinutes: 30,
      fileSurfacePatterns: ["server/x.ts"],
    });
    const result = runCli({
      stagedFiles: ["server/x.ts"],
      env: {
        SOLENE_AGENT_ID: "me",
        SOLENE_BYPASS_INTERACTIVE_CLAIMS: "1",
      },
    });
    expect(result.code).toBe(0);
  });

  it("glob pattern in lock matches staged subpath", () => {
    writeLock("other.json", {
      agentId: "other-agent",
      agentRole: "iris",
      claimedAt: nowIso(0),
      ttlMinutes: 30,
      fileSurfacePatterns: ["server/**/*.ts"],
    });
    const result = runCli({
      stagedFiles: ["server/services/foo.ts"],
      env: { SOLENE_AGENT_ID: "me" },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("server/services/foo.ts");
  });
});
