/**
 * Tests for Step-Away Readiness (the machine-verified "can I leave?" answer).
 *
 * Coverage:
 *  - fully-armed world → verdict ready, horizon from the Trust Ledger
 *  - a critical gap (no page channel at all) blocks the verdict
 *  - an UNREADABLE critical signal is never shown green (attention + blocked)
 *  - optional gaps (no grants, immune off) leave the verdict ready but are
 *    counted as worth-doing in the headline
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── togglable world state ────────────────────────────────────────────────────
let panicStopped = false;
let topic: string | null = "private-topic";
let loopThrows = false;
let loopSeverity: "healthy" | "degraded" | "stalled" = "healthy";
let capStatus = { monthToDateUsd: 12, capUsd: 50, redThresholdUsd: 45, exceeded: false, readFailed: false };
let pendingCount = 0;
let askCount = 0;
let grants: Array<{ expiresAt: Date; maxActions: number; usedCount: number }> = [];
let deadLetterRows: Array<{ id: number }> = [];
let patchCapable = { capable: true, reason: "ok" };
let ledgerLevels = ["execute_gated", "autonomous_gated", "draft", "observe", "observe"];

vi.mock("./settings", () => ({
  isPanicStopped: () => panicStopped,
  isSelfPatchEnabled: async () => process.env.SELF_PATCH_ENABLED === "true",
}));
// Platform Connections — nothing connected in these tests; env toggles drive.
let githubCreds: { token: string | null; repository: string | null } = { token: "ghp_t", repository: "tom/acreos" };
vi.mock("../connections/platformConnections", () => ({
  resolveConnection: async () => ({ value: null, source: "missing" as const }),
  resolveGithubCredentials: async () => githubCreds,
}));

// Release-freshness fetches: live /api/version + GitHub main tip.
let liveSha: string | null = "abc1234def";
let tipSha: string | null = "abc1234def5678901234567890123456789012ab";
const originalFetch = globalThis.fetch;
function armFetchMock() {
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes("/api/version")) {
      return { ok: liveSha !== null, json: async () => ({ sha: liveSha }) } as Response;
    }
    if (u.includes("api.github.com")) {
      return { ok: tipSha !== null, status: tipSha ? 200 : 500, json: async () => ({ sha: tipSha }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as any;
}
vi.mock("../solene/pagerService", () => ({ pageTopic: () => topic }));
vi.mock("./loopStall", () => ({
  observeLoopHealth: async () => {
    if (loopThrows) throw new Error("db down");
    return { severity: loopSeverity, signals: [], shouldPageFounder: false, summary: `loop ${loopSeverity}` };
  },
}));
vi.mock("../solene/capitalTracker", () => ({ getEnsembleCapStatus: async () => capStatus }));
vi.mock("./pendingHands", () => ({ listPendingHands: async () => Array.from({ length: pendingCount }, (_, i) => ({ id: i })) }));
vi.mock("../solene/founderCollab", () => ({ listOpenAsks: async () => Array.from({ length: askCount }, (_, i) => ({ id: i })) }));
vi.mock("./witnessGrantStore", () => ({ liveGrantsFor: async () => grants }));
vi.mock("../../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(deadLetterRows) }) }),
  },
}));
vi.mock("./selfPatchGitOps", () => ({ assertSelfPatchCapable: async () => patchCapable }));
vi.mock("./domainAutonomy", () => ({
  getTrustLedger: async () => ledgerLevels.map((level, i) => ({ domain: `d${i}`, level, cleanCycleCount: 0, threshold: 10, lastPromotedAt: null, lastDemotedAt: null, lastDemotionReason: null })),
  deriveAutonomyHorizonDays: (levels: string[]) => Math.min(21, Math.max(1, levels.length)), // simple stand-in
}));

import { buildStepAwayReadiness } from "./stepAwayReadiness";

beforeEach(() => {
  panicStopped = false;
  topic = "private-topic";
  loopThrows = false;
  loopSeverity = "healthy";
  capStatus = { monthToDateUsd: 12, capUsd: 50, redThresholdUsd: 45, exceeded: false, readFailed: false };
  pendingCount = 0;
  askCount = 0;
  grants = [{ expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), maxActions: 20, usedCount: 3 }];
  deadLetterRows = [];
  patchCapable = { capable: true, reason: "ok" };
  process.env.FOUNDER_EMAIL = "tom@example.com";
  process.env.SELF_PATCH_ENABLED = "true";
  githubCreds = { token: "ghp_t", repository: "tom/acreos" };
  liveSha = "abc1234def";
  tipSha = "abc1234def5678901234567890123456789012ab";
  armFetchMock();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("buildStepAwayReadiness", () => {
  it("fully armed → ready, all checks green, horizon derived from the ledger", async () => {
    const r = await buildStepAwayReadiness();
    expect(r.verdict).toBe("ready");
    expect(r.readyCount).toBe(r.totalCount);
    expect(r.horizonDays).toBe(5);
    expect(r.headline).toContain("step away");
  });

  it("no page channel at all → NOT ready (critical reachability gap)", async () => {
    topic = null;
    delete process.env.FOUNDER_EMAIL;
    const r = await buildStepAwayReadiness();
    expect(r.verdict).toBe("not_ready");
    const paging = r.checks.find((c) => c.key === "paging")!;
    expect(paging.status).toBe("action_needed");
    expect(paging.critical).toBe(true);
    // Singular/plural aware since 2026-07-08 ("1 thing needs you" /
    // "2 things need you").
    expect(r.headline).toMatch(/needs? you/);
  });

  it("push-only (no email fallback) is a gap, not a pass", async () => {
    delete process.env.FOUNDER_EMAIL;
    const r = await buildStepAwayReadiness();
    const paging = r.checks.find((c) => c.key === "paging")!;
    expect(paging.status).toBe("action_needed");
    expect(paging.detail).toContain("email fallback");
  });

  it("an unreadable critical signal is shown as attention, never green — and blocks", async () => {
    loopThrows = true;
    const r = await buildStepAwayReadiness();
    const loop = r.checks.find((c) => c.key === "loop_health")!;
    expect(loop.status).toBe("attention");
    expect(loop.detail).toContain("Could not verify");
    expect(r.verdict).toBe("not_ready");
  });

  it("a stalled loop blocks; a degraded loop also blocks (attention)", async () => {
    loopSeverity = "stalled";
    expect((await buildStepAwayReadiness()).verdict).toBe("not_ready");
    loopSeverity = "degraded";
    expect((await buildStepAwayReadiness()).verdict).toBe("not_ready");
  });

  it("engaged panic stop blocks with the un-overridable explanation", async () => {
    panicStopped = true;
    const r = await buildStepAwayReadiness();
    expect(r.verdict).toBe("not_ready");
    expect(r.checks.find((c) => c.key === "panic_stop")!.detail).toContain("ENGAGED");
  });

  it("unreadable spend reads as attention but explains the gates fail closed", async () => {
    capStatus = { ...capStatus, readFailed: true };
    const r = await buildStepAwayReadiness();
    const budget = r.checks.find((c) => c.key === "budget")!;
    expect(budget.status).toBe("attention");
    expect(budget.detail).toContain("failing CLOSED");
    expect(r.verdict).toBe("not_ready");
  });

  it("a fully-used cap is READY — the cap holding is the discipline working", async () => {
    capStatus = { ...capStatus, monthToDateUsd: 50, exceeded: true };
    const r = await buildStepAwayReadiness();
    expect(r.checks.find((c) => c.key === "budget")!.status).toBe("ready");
  });

  it("a STALE release blocks step-away (2026-07-03 incident class)", async () => {
    liveSha = "962a3d8"; // production behind
    tipSha = "92b7bdb0000000000000000000000000000000ab"; // main moved on
    const r = await buildStepAwayReadiness();
    const fresh = r.checks.find((c) => c.key === "release_fresh")!;
    expect(fresh.status).toBe("attention");
    expect(fresh.detail).toContain("STALE RELEASE");
    expect(r.verdict).toBe("not_ready");
  });

  it("an unreachable live site blocks step-away", async () => {
    liveSha = null;
    const r = await buildStepAwayReadiness();
    const fresh = r.checks.find((c) => c.key === "release_fresh")!;
    expect(fresh.status).toBe("attention");
    expect(r.verdict).toBe("not_ready");
  });

  it("no GitHub connection → freshness is worth-doing, never a false green, never a block", async () => {
    githubCreds = { token: null, repository: null };
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
    const r = await buildStepAwayReadiness();
    const fresh = r.checks.find((c) => c.key === "release_fresh")!;
    expect(fresh.status).toBe("action_needed");
    expect(fresh.critical).toBe(false);
    expect(r.verdict).toBe("ready");
  });

  it("optional gaps (no grants, immune off, queue busy) leave the verdict READY but counted", async () => {
    grants = [];
    pendingCount = 2;
    askCount = 1;
    delete process.env.SELF_PATCH_ENABLED;
    deadLetterRows = [{ id: 1 }];
    const r = await buildStepAwayReadiness();
    expect(r.verdict).toBe("ready");
    expect(r.headline).toContain("optional");
    expect(r.checks.find((c) => c.key === "delegation")!.status).toBe("action_needed");
    expect(r.checks.find((c) => c.key === "decisions_clear")!.detail).toContain("2 frozen action(s) + 1 open ask(s)");
    expect(r.checks.find((c) => c.key === "dead_letters")!.status).toBe("action_needed");
    expect(r.checks.find((c) => c.key === "immune")!.status).toBe("action_needed");
  });
});
