/**
 * Tests for the Solene dispatch runner's ensemble-awareness preamble
 * injection (Layer 1 keystone #3 — structural ensemble awareness).
 *
 * Coverage:
 *  - loadTeamStatePreamble extracts the AUTO block from a fixture file
 *  - loadTeamStatePreamble returns the fallback when the file is missing
 *  - loadTeamStatePreamble returns the fallback when markers are absent
 *  - loadTeamStatePreamble truncates over-large files
 *  - loadActiveClaimsBlock renders the expected markdown shape
 *  - loadActiveClaimsBlock excludes the current dispatch's own claim
 *  - loadActiveClaimsBlock returns the empty-list copy when nothing else
 *    is in flight
 *  - buildSystemPrompt includes both preambles + hard-rules + role brief
 *    in the correct order
 *
 * The Anthropic SDK is never called here — buildSystemPrompt + the
 * loaders are pure(ish) prompt-construction helpers. We mock the
 * filesystem reads + listActiveClaims so the test is deterministic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Stub listActiveClaims so the loader test can drive the rendered output
// without touching Postgres.
const listActiveClaimsMock = vi.fn();
vi.mock("./agentClaims", () => ({
  listActiveClaims: () => listActiveClaimsMock(),
}));

// db is imported transitively via agentClaims in some paths; stub it so
// no real connection is opened during the suite.
vi.mock("../../db", () => ({
  db: {},
}));

// dispatchQueue + capitalTracker + executor are imported at module top of
// dispatchRunner.ts. We only exercise the prompt-builder helpers, so stub
// them with no-op exports.
vi.mock("./dispatchQueue", () => ({
  completeDispatch: vi.fn(),
  failDispatch: vi.fn(),
}));
vi.mock("./capitalTracker", () => ({
  recordCapitalEvent: vi.fn(),
}));
vi.mock("./dispatchToolExecutor", () => ({
  DISPATCH_TOOL_SCHEMAS: [],
  executeDispatchTool: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────

const FIXTURE_BLOCK = [
  "<!-- generated 2026-06-03T00:00:00Z -->",
  "",
  "## Auto-generated team state",
  "",
  "### Active agents",
  "- **Iris** — d7dcc2e9 · 2026-06-02T23:27:11Z · phase 0 hardening",
  "- **Soren** — fd65d25c · 2026-06-02T23:45:14Z · seo + cleanup",
].join("\n");

const FIXTURE_FILE_CONTENTS = [
  "# Solene — Team State Map",
  "",
  "Some preamble that should NOT make it into the prompt.",
  "",
  "<!-- AUTO -->",
  FIXTURE_BLOCK,
  "<!-- /AUTO -->",
  "",
  "## Solene-maintained sections",
  "Footer that should NOT be in the prompt either.",
].join("\n");

let tmpDir: string;
let fixturePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "solene-dispatch-test-"));
  fixturePath = path.join(tmpDir, "solene-team-state.md");
  process.env.SOLENE_DISPATCH_TEAM_STATE_PATH = fixturePath;
  await fs.writeFile(fixturePath, FIXTURE_FILE_CONTENTS, "utf8");
  listActiveClaimsMock.mockReset();
  listActiveClaimsMock.mockResolvedValue([]);
  // Reset module cache so the env-driven TEAM_STATE_PATH constant is
  // recomputed for each test (the module reads it at top level).
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.SOLENE_DISPATCH_TEAM_STATE_PATH;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────
// loadTeamStatePreamble
// ─────────────────────────────────────────────────────────────────────────

describe("loadTeamStatePreamble", () => {
  it("extracts the AUTO block from a well-formed team-state file", async () => {
    const mod = await import("./dispatchRunner");
    const out = await mod.loadTeamStatePreamble();
    expect(out).toContain("Auto-generated team state");
    expect(out).toContain("Iris");
    expect(out).toContain("Soren");
    // Header preamble + Solene-maintained footer must NOT leak in.
    expect(out).not.toContain("# Solene — Team State Map");
    expect(out).not.toContain("Solene-maintained sections");
    expect(out).not.toContain("<!-- AUTO -->");
    expect(out).not.toContain("<!-- /AUTO -->");
  });

  it("returns the fallback when the file is missing", async () => {
    await fs.rm(fixturePath);
    const mod = await import("./dispatchRunner");
    const out = await mod.loadTeamStatePreamble();
    expect(out).toBe(
      "(team-state map unavailable — proceeding with no team context preamble)",
    );
  });

  it("returns the fallback when AUTO markers are absent", async () => {
    await fs.writeFile(
      fixturePath,
      "# Some other file with no markers at all",
      "utf8",
    );
    const mod = await import("./dispatchRunner");
    const out = await mod.loadTeamStatePreamble();
    expect(out).toBe(
      "(team-state map unavailable — proceeding with no team context preamble)",
    );
  });

  it("truncates over-large files with a … [truncated] suffix", async () => {
    // 12 KB of body inside the markers — exceeds 8 KB cap.
    const huge = "x".repeat(12 * 1024);
    await fs.writeFile(
      fixturePath,
      `header\n<!-- AUTO -->\n${huge}\n<!-- /AUTO -->\nfooter`,
      "utf8",
    );
    const mod = await import("./dispatchRunner");
    const out = await mod.loadTeamStatePreamble();
    expect(out).toContain("… [truncated]");
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(
      8 * 1024 + 64, // 8 KB + the truncation suffix slack
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// loadActiveClaimsBlock
// ─────────────────────────────────────────────────────────────────────────

function fakeClaim(overrides: {
  id: number;
  dispatchId: number | null;
  agentRole: string;
  patterns: string[];
  claimedAgoSec?: number;
  ttlMinutes?: number;
}): unknown {
  const claimedAt = new Date(
    Date.now() - 1000 * (overrides.claimedAgoSec ?? 30),
  );
  return {
    id: overrides.id,
    dispatchId: overrides.dispatchId,
    agentRole: overrides.agentRole,
    claimedAt,
    releasedAt: null,
    ttlMinutes: overrides.ttlMinutes ?? 60,
    fileSurfacePatterns: overrides.patterns,
    claimStatus: "active" as const,
    note: null,
  };
}

describe("loadActiveClaimsBlock", () => {
  it("renders each row as `- **role** (dispatch #N, claimed Xs ago, ttl Ymin): patterns`", async () => {
    listActiveClaimsMock.mockResolvedValueOnce([
      fakeClaim({
        id: 1,
        dispatchId: 42,
        agentRole: "iris",
        patterns: ["server/services/iris/*", "shared/schema/iris-*.ts"],
        claimedAgoSec: 90,
        ttlMinutes: 60,
      }),
      fakeClaim({
        id: 2,
        dispatchId: 43,
        agentRole: "soren",
        patterns: ["client/src/pages/landing/*"],
        claimedAgoSec: 5,
        ttlMinutes: 30,
      }),
    ]);
    const mod = await import("./dispatchRunner");
    // currentDispatchId = 99 → both claims should appear.
    const out = await mod.loadActiveClaimsBlock(99);
    expect(out).toContain("- **iris** (dispatch #42, claimed");
    expect(out).toContain("ttl 60min): server/services/iris/*, shared/schema/iris-*.ts");
    expect(out).toContain("- **soren** (dispatch #43, claimed");
    expect(out).toContain("ttl 30min): client/src/pages/landing/*");
  });

  it("excludes the current dispatch's own claim row", async () => {
    listActiveClaimsMock.mockResolvedValueOnce([
      fakeClaim({
        id: 1,
        dispatchId: 42,
        agentRole: "iris",
        patterns: ["server/services/iris/*"],
      }),
      fakeClaim({
        id: 2,
        dispatchId: 99,
        agentRole: "solene",
        patterns: ["server/services/solene/*"],
      }),
    ]);
    const mod = await import("./dispatchRunner");
    const out = await mod.loadActiveClaimsBlock(99);
    expect(out).toContain("iris");
    expect(out).not.toContain("solene");
    expect(out).not.toContain("dispatch #99");
  });

  it("returns the empty-list copy when nothing else is in flight", async () => {
    listActiveClaimsMock.mockResolvedValueOnce([]);
    const mod = await import("./dispatchRunner");
    const out = await mod.loadActiveClaimsBlock(99);
    expect(out).toBe(
      "_No other agents currently in flight. Working tree is yours to claim._",
    );
  });

  it("returns the empty-list copy when only own-claim row exists", async () => {
    listActiveClaimsMock.mockResolvedValueOnce([
      fakeClaim({
        id: 1,
        dispatchId: 99,
        agentRole: "solene",
        patterns: ["server/services/solene/*"],
      }),
    ]);
    const mod = await import("./dispatchRunner");
    const out = await mod.loadActiveClaimsBlock(99);
    expect(out).toBe(
      "_No other agents currently in flight. Working tree is yours to claim._",
    );
  });

  it("renders ad-hoc dispatch label when claim has no dispatch_id", async () => {
    listActiveClaimsMock.mockResolvedValueOnce([
      fakeClaim({
        id: 1,
        dispatchId: null,
        agentRole: "krieger",
        patterns: ["client/src/components/*"],
      }),
    ]);
    const mod = await import("./dispatchRunner");
    const out = await mod.loadActiveClaimsBlock(99);
    expect(out).toContain("- **krieger** (ad-hoc dispatch, claimed");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// buildSystemPrompt
// ─────────────────────────────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  it("emits both preambles + hard-rules + role brief, in order", async () => {
    listActiveClaimsMock.mockResolvedValueOnce([
      fakeClaim({
        id: 1,
        dispatchId: 42,
        agentRole: "iris",
        patterns: ["server/services/iris/*"],
      }),
    ]);
    const mod = await import("./dispatchRunner");
    const prompt = await mod.buildSystemPrompt(
      "IRIS — operate as CTO; ship phase 0 hardening.",
      "iris",
      99,
      2.5,
      900_000,
    );

    // All four headings must appear, AND in the documented order.
    const teamIdx = prompt.indexOf(
      "# Team-state preamble (auto-generated, 15-min refresh)",
    );
    const claimsIdx = prompt.indexOf(
      "# Active agent claims — DO NOT TOUCH files matching these patterns",
    );
    const modeIdx = prompt.indexOf("# Solene autonomous-dispatch mode");
    const hardRulesIdx = prompt.indexOf("## Hard rules");
    const briefIdx = prompt.indexOf("## Your role brief");
    expect(teamIdx).toBeGreaterThanOrEqual(0);
    expect(claimsIdx).toBeGreaterThan(teamIdx);
    expect(modeIdx).toBeGreaterThan(claimsIdx);
    expect(hardRulesIdx).toBeGreaterThan(modeIdx);
    expect(briefIdx).toBeGreaterThan(hardRulesIdx);

    // Substantive content from each block must be present.
    expect(prompt).toContain("Auto-generated team state"); // from fixture AUTO block
    expect(prompt).toContain("- **iris** (dispatch #42"); // from claims
    expect(prompt).toContain("Cost cap: $2.50"); // hard rules
    expect(prompt).toContain("Dispatch id: 99");
    expect(prompt).toContain("IRIS — operate as CTO"); // role brief
  });

  it("still emits a prompt with both blocks when both loaders fall back", async () => {
    // Missing team-state file + no claims → both fallbacks should render.
    await fs.rm(fixturePath);
    listActiveClaimsMock.mockResolvedValueOnce([]);
    const mod = await import("./dispatchRunner");
    const prompt = await mod.buildSystemPrompt(
      "general-purpose brief",
      "general-purpose",
      7,
      1,
      60_000,
    );
    expect(prompt).toContain(
      "(team-state map unavailable — proceeding with no team context preamble)",
    );
    expect(prompt).toContain(
      "_No other agents currently in flight. Working tree is yours to claim._",
    );
    expect(prompt).toContain("# Solene autonomous-dispatch mode");
    expect(prompt).toContain("general-purpose brief");
  });
});
