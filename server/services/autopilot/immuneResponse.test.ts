/**
 * Tests for the immune-response wire (step-away gap #4).
 *
 * Coverage:
 *  - audit failure → honest "audit FAILED" line, report row still persisted
 *  - clean audit → "no advisories" line, no motor attempt, no ask
 *  - witnessed class → ONE founder ask; deduped when an immune ask is open
 *  - auto class + environment not capable → honest refusal reason recorded
 *  - auto class + capable → runGatedSelfPatch invoked, restore() always runs
 *  - securityAutoMergeEarned rides the ops domain (execute_gated+)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── db mock: capture immune-report inserts ──────────────────────────────────
const REPORTS: any[] = [];
vi.mock("../../db", () => ({
  db: {
    insert: (_table: unknown) => ({
      values: (row: any) => ({
        returning: (_proj: unknown) => {
          REPORTS.push(row);
          return Promise.resolve([{ id: REPORTS.length }]);
        },
      }),
    }),
    select: () => ({
      from: (_t: unknown) => ({
        orderBy: (_o: unknown) => ({
          limit: (_n: number) => Promise.resolve(REPORTS.length ? [REPORTS[REPORTS.length - 1]] : []),
        }),
      }),
    }),
  },
}));

// ── trust ledger mock ────────────────────────────────────────────────────────
const LEVELS = ["observe", "draft", "execute_gated", "autonomous_gated"] as const;
let opsLevel: (typeof LEVELS)[number] = "observe";
vi.mock("./domainAutonomy", () => ({
  getDomainLevel: vi.fn(async () => opsLevel),
  levelRank: (l: string) => LEVELS.indexOf(l as (typeof LEVELS)[number]),
}));

// ── founder collab mock ──────────────────────────────────────────────────────
// Typed with its parameter: the assertions below read
// `askFounderMock.mock.calls[0][0]`, and a zero-arg vi.fn() makes every call
// tuple `[]`, so indexing it is a type error on a mock the test genuinely
// passes an argument to.
const askFounderMock = vi.fn(async (_input: Record<string, unknown>) => ({
  askId: 1,
  pagerFired: true,
  pagerEventId: 1,
  deduped: false,
}));
let openAsks: Array<{ questionSummary: string }> = [];
vi.mock("../solene/founderCollab", () => ({
  askFounder: (...args: any[]) => askFounderMock(args[0]),
  listOpenAsks: vi.fn(async () => openAsks),
}));

// ── selfPatch motor mocks ────────────────────────────────────────────────────
let capable = false;
const restoreMock = vi.fn(async () => undefined);
vi.mock("./selfPatchGitOps", () => ({
  assertSelfPatchCapable: vi.fn(async () => ({
    capable,
    reason: capable ? "ok" : "not a git work tree (deployed image without a repo checkout)",
  })),
  createSelfPatchGitOps: vi.fn(() => ({ restore: restoreMock })),
}));

// Same shape as askFounderMock above: the assertions read
// `.mock.calls[0][1]` and `[0][2]`, which a zero-arg vi.fn() types as `[]`.
const runGatedSelfPatchMock = vi.fn(async (_audit?: unknown, _autoMerge?: boolean, _suffix?: string) => ({
  ran: true,
  reason: "safe-class dependency patch PR opened",
  prUrl: "https://github.com/x/y/pull/1",
  witnessedCount: 0,
}));
vi.mock("./selfPatch", () => ({
  runGatedSelfPatch: (...args: any[]) => runGatedSelfPatchMock(args[0], args[1], args[2]),
}));

import { runImmuneResponse, securityAutoMergeEarned, IMMUNE_ASK_MARKER } from "./immuneResponse";

// ── audit fixtures (npm audit --json shape parseAudit reads) ─────────────────
const CLEAN_AUDIT = JSON.stringify({ vulnerabilities: {} });
const MIXED_AUDIT = JSON.stringify({
  vulnerabilities: {
    // Non-major fix available → auto candidate (routes by earned autonomy).
    lodash: { severity: "moderate", fixAvailable: { name: "lodash", version: "4.17.21", isSemVerMajor: false } },
    // High with only a breaking fix → always witnessed.
    minimist: { severity: "high", fixAvailable: { name: "minimist", version: "2.0.0", isSemVerMajor: true } },
    // No fix → skip.
    leftpad: { severity: "low", fixAvailable: false },
  },
});

beforeEach(() => {
  REPORTS.length = 0;
  openAsks = [];
  opsLevel = "observe";
  capable = false;
  vi.clearAllMocks();
});

describe("securityAutoMergeEarned", () => {
  it("is NOT earned at observe/draft (cold start)", async () => {
    opsLevel = "observe";
    expect(await securityAutoMergeEarned()).toBe(false);
    opsLevel = "draft";
    expect(await securityAutoMergeEarned()).toBe(false);
  });

  it("is earned at execute_gated and above", async () => {
    opsLevel = "execute_gated";
    expect(await securityAutoMergeEarned()).toBe(true);
    opsLevel = "autonomous_gated";
    expect(await securityAutoMergeEarned()).toBe(true);
  });
});

describe("runImmuneResponse — sensing honesty", () => {
  it("records an honest FAILED line when the audit itself dies", async () => {
    const r = await runImmuneResponse({ runAudit: async () => { throw new Error("npm exploded"); } });
    expect(r.ok).toBe(false);
    expect(r.line).toContain("FAILED");
    expect(r.line).toContain("not clean");
    // The gap is still on the ledger.
    expect(REPORTS).toHaveLength(1);
    expect(REPORTS[0].line).toContain("FAILED");
  });

  it("clean audit → no-advisories line, no motor, no ask", async () => {
    const r = await runImmuneResponse({ runAudit: async () => CLEAN_AUDIT });
    expect(r.ok).toBe(true);
    expect(r.line).toBe("Dependency health: no advisories.");
    expect(r.selfPatch.reason).toBe("no auto-class advisories");
    expect(askFounderMock).not.toHaveBeenCalled();
    expect(r.askCreated).toBe(false);
    expect(REPORTS).toHaveLength(1);
  });
});

describe("runImmuneResponse — witnessed class routing", () => {
  it("cold start routes everything witnessed and raises ONE founder ask", async () => {
    const r = await runImmuneResponse({ runAudit: async () => MIXED_AUDIT });
    // observe → nothing auto; lodash (fixable) + minimist (breaking-high) both witnessed.
    expect(r.plan?.autoCount).toBe(0);
    expect(r.plan?.witnessedCount).toBe(2);
    expect(r.plan?.skipCount).toBe(1);
    expect(askFounderMock).toHaveBeenCalledTimes(1);
    const ask = askFounderMock.mock.calls[0][0] as any;
    expect(ask.questionSummary).toContain(IMMUNE_ASK_MARKER);
    expect(ask.urgency).toBe("urgent"); // minimist is high
    expect(r.askCreated).toBe(true);
    expect(REPORTS[0].askCreated).toBe(true);
  });

  it("dedups against an already-open immune ask (no daily re-nag)", async () => {
    openAsks = [{ questionSummary: `${IMMUNE_ASK_MARKER} (2)` }];
    const r = await runImmuneResponse({ runAudit: async () => MIXED_AUDIT });
    expect(askFounderMock).not.toHaveBeenCalled();
    expect(r.askCreated).toBe(false);
  });
});

describe("runImmuneResponse — motor half", () => {
  it("earned + auto class + environment NOT capable → honest refusal, no patch attempt", async () => {
    opsLevel = "execute_gated";
    capable = false;
    const r = await runImmuneResponse({ runAudit: async () => MIXED_AUDIT });
    expect(r.plan?.autoCount).toBe(1); // lodash auto-PRs once earned
    expect(r.selfPatch.ran).toBe(false);
    expect(r.selfPatch.reason).toContain("not capable");
    expect(runGatedSelfPatchMock).not.toHaveBeenCalled();
  });

  it("earned + capable → runs the gated self-patch and always restores the tree", async () => {
    opsLevel = "execute_gated";
    capable = true;
    const r = await runImmuneResponse({ runAudit: async () => MIXED_AUDIT, branchSuffix: "test-1" });
    expect(runGatedSelfPatchMock).toHaveBeenCalledTimes(1);
    expect(runGatedSelfPatchMock.mock.calls[0][1]).toBe(true); // autoMergeEarned threaded through
    expect(runGatedSelfPatchMock.mock.calls[0][2]).toBe("test-1");
    expect(restoreMock).toHaveBeenCalledTimes(1);
    expect(r.selfPatch.ran).toBe(true);
    expect(r.selfPatch.prUrl).toContain("/pull/1");
    expect(REPORTS[0].selfPatchPrUrl).toContain("/pull/1");
  });
});
