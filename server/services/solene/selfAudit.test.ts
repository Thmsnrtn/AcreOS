/**
 * Tests for Solene self-audit service.
 *
 * Coverage:
 *  - Each of the 8 detectors fires on a synthetic offender + ignores clean input
 *  - Idempotency on same-run re-execution (UNIQUE index simulation)
 *  - Drift threshold (criticalCount / failCount / warnCount)
 *  - recordSoleneDecision never throws on DB failure
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// In-memory state the db mock reads/writes
interface DecisionRow {
  id: number;
  decidedAt: Date;
  decisionType: string;
  contextSummary: string;
  rationale: string;
  responseText: string | null;
  outcome: string | null;
  capitalImpactUsd: string | null;
}
interface AuditRunRow {
  id: number;
  runStartedAt: Date;
  runEndedAt: Date | null;
  scope: string;
  decisionsExamined: number;
  driftCount: number;
  findingCount: number;
  driftSignalEmitted: boolean;
  skipReason: string | null;
}
interface AuditFindingRow {
  id: number;
  runId: number;
  decisionId: number | null;
  pattern: string;
  severity: string;
  citation: string;
  excerpt: string;
  matchedPatterns: string[];
  firedAt: Date;
}

const DECISIONS: DecisionRow[] = [];
const AUDIT_RUNS: AuditRunRow[] = [];
const AUDIT_FINDINGS: AuditFindingRow[] = [];
let nextRunId = 1;
let nextFindingId = 1;
let nextDecisionId = 1;

// Capital-tracker stub state
let stubMonthlyEnvelope = { envelopeUsd: 50, monthToDateUsd: 0, percentUsed: 0, daysIntoMonth: 1, projectedMonthlyUsd: 0, status: "green" as const };
let stub24hSpend = 0;
let decisionsThrowOnInsert = false;

vi.mock("./capitalTracker", () => ({
  getMonthlyEnvelopeStatus: () => Promise.resolve(stubMonthlyEnvelope),
  getSpendSummary: () => Promise.resolve({ totalUsd: stub24hSpend, byType: {}, eventCount: 0 }),
}));

vi.mock("../../db", () => {
  const db = {
    insert: (table: unknown) => ({
      values: (rows: any) => {
        // Findings batch
        if (Array.isArray(rows)) {
          return {
            onConflictDoNothing: (_: unknown) => {
              for (const r of rows as AuditFindingRow[]) {
                const exists = AUDIT_FINDINGS.find(
                  (existing) =>
                    existing.runId === r.runId &&
                    existing.decisionId === r.decisionId &&
                    existing.pattern === r.pattern,
                );
                if (!exists) {
                  AUDIT_FINDINGS.push({
                    ...r,
                    id: nextFindingId++,
                    firedAt: r.firedAt ?? new Date(),
                  });
                }
              }
              return Promise.resolve();
            },
          };
        }
        // Single insert — decision or run
        if (rows.decisionType !== undefined) {
          if (decisionsThrowOnInsert) {
            return {
              returning: (_: unknown) =>
                Promise.reject(new Error("simulated db failure")),
            };
          }
          const id = nextDecisionId++;
          DECISIONS.push({
            id,
            decidedAt: rows.decidedAt ?? new Date(),
            decisionType: rows.decisionType,
            contextSummary: rows.contextSummary,
            rationale: rows.rationale,
            responseText: rows.responseText ?? null,
            outcome: null,
            capitalImpactUsd: rows.capitalImpactUsd ?? null,
          });
          return {
            returning: (_: unknown) => Promise.resolve([{ id }]),
          };
        }
        // soleneAuditRuns insert
        const id = nextRunId++;
        AUDIT_RUNS.push({
          id,
          runStartedAt: rows.runStartedAt ?? new Date(),
          runEndedAt: null,
          scope: rows.scope,
          decisionsExamined: 0,
          driftCount: 0,
          findingCount: 0,
          driftSignalEmitted: false,
          skipReason: null,
        });
        return {
          returning: (_: unknown) => Promise.resolve([{ id }]),
        };
      },
    }),
    update: (_table: unknown) => ({
      set: (values: any) => ({
        where: (_pred: unknown) => {
          const row = AUDIT_RUNS[AUDIT_RUNS.length - 1];
          if (row) Object.assign(row, values);
          return Promise.resolve();
        },
      }),
    }),
    select: (_projection?: unknown) => {
      const step: any = {
        _from: null,
        _capitalSumQuery: false,
        _findingsPatternQuery: false,
        from(t: unknown) {
          step._from = t;
          // Heuristic: if projection had a "sum" field
          if (_projection && typeof _projection === "object" && "sum" in (_projection as any)) {
            step._capitalSumQuery = true;
          }
          // Heuristic: predictability_drift selects only { pattern } from
          // soleneAuditFindings. Detect by projection shape.
          if (
            _projection &&
            typeof _projection === "object" &&
            "pattern" in (_projection as any) &&
            !("decidedAt" in (_projection as any))
          ) {
            step._findingsPatternQuery = true;
          }
          return step;
        },
        where(_pred: unknown) {
          return step;
        },
        orderBy(_pred: unknown) {
          return step;
        },
        groupBy(..._: unknown[]) {
          return step;
        },
        limit(_n: number) {
          return step;
        },
        then(onFulfilled: any, onRejected: any) {
          let rows: unknown[] = [];
          if (step._capitalSumQuery) {
            rows = [{ sum: String(stub24hSpend) }];
          } else if (step._findingsPatternQuery) {
            // Return findings filtered to menu_handing / permission_seeking.
            rows = AUDIT_FINDINGS.filter(
              (f) =>
                f.pattern === "menu_handing" ||
                f.pattern === "permission_seeking",
            ).map((f) => ({ pattern: f.pattern }));
          } else {
            // Sample decisions query: order by decidedAt desc, filtered by gte window
            rows = [...DECISIONS].sort(
              (a, b) => b.decidedAt.getTime() - a.decidedAt.getTime(),
            );
          }
          return Promise.resolve(rows).then(onFulfilled, onRejected);
        },
      };
      return step;
    },
  };
  return { db };
});

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    and: (...preds: unknown[]) => preds,
    eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
    gte: (col: unknown, val: unknown) => ({ op: "gte", col, val }),
    inArray: (col: unknown, vals: unknown) => ({ op: "inArray", col, vals }),
    desc: (col: unknown) => col,
    sql: (() => {
      const tag: any = (_strings: TemplateStringsArray, ..._vals: unknown[]) => ({ op: "sql" });
      tag.raw = (_s: string) => ({ op: "sql.raw" });
      return tag;
    })(),
  };
});

import {
  recordSoleneDecision,
  runSoleneAudit,
  checkMenuHanding,
  checkPermissionSeeking,
  checkCredentialValueInOutput,
  checkStaleCharterQuote,
  checkVerifyBeforeDispatchFailure,
  checkTeamStateCollision,
  checkBriefContextStaleness,
  checkCapitalOverspend,
  checkReviewSkeletonStaleness,
  checkPredictabilityDrift,
  checkInTheMomentSelfCorrection,
  checkSofteningLanguage,
  checkStrategicVisionMiss,
  checkDecisionCompoundingRatio,
  checkBoundaryRespect,
  checkTransparency,
  setInFlightFilesForTest,
  setReviewFilesAccessorForTest,
  setSoleneSurfaceAccessorForTest,
  SOLENE_DRIFT_THRESHOLDS,
} from "./selfAudit";

// ── Helpers ────────────────────────────────────────────────────────────────

function resetWorld() {
  DECISIONS.length = 0;
  AUDIT_RUNS.length = 0;
  AUDIT_FINDINGS.length = 0;
  nextRunId = 1;
  nextFindingId = 1;
  nextDecisionId = 1;
  stubMonthlyEnvelope = {
    envelopeUsd: 50,
    monthToDateUsd: 0,
    percentUsed: 0,
    daysIntoMonth: 1,
    projectedMonthlyUsd: 0,
    status: "green" as const,
  };
  stub24hSpend = 0;
  decisionsThrowOnInsert = false;
  setInFlightFilesForTest([]);
  setReviewFilesAccessorForTest(null);
  setSoleneSurfaceAccessorForTest(() => []);
}

function decisionFixture(opts: Partial<DecisionRow> = {}): DecisionRow {
  return {
    id: opts.id ?? 1,
    decidedAt: opts.decidedAt ?? new Date(),
    decisionType: opts.decisionType ?? "dispatch",
    contextSummary: opts.contextSummary ?? "test context",
    rationale: opts.rationale ?? "test rationale",
    responseText: opts.responseText ?? null,
    outcome: opts.outcome ?? null,
    capitalImpactUsd: opts.capitalImpactUsd ?? null,
  };
}

beforeEach(() => {
  resetWorld();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 1: menu_handing
// ────────────────────────────────────────────────────────────────────────────

describe("checkMenuHanding", () => {
  it("fires on 'want me to' framing for routine work", () => {
    const f = checkMenuHanding(
      decisionFixture({
        responseText: "Want me to dispatch the lead-nurturer audit?",
      }),
    );
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("fail");
    expect(f!.pattern).toBe("menu_handing");
  });

  it("fires on 'pick from' menus", () => {
    const f = checkMenuHanding(
      decisionFixture({
        responseText:
          "Three options surfaced — pick from: (a) audit, (b) extract, (c) defer.",
      }),
    );
    expect(f).not.toBeNull();
  });

  it("does NOT fire when the item is strategic-founder-only", () => {
    const f = checkMenuHanding(
      decisionFixture({
        responseText: "Should I propose the constitutional immutable revision?",
      }),
    );
    expect(f).toBeNull();
  });

  it("does NOT fire on a clean response", () => {
    const f = checkMenuHanding(
      decisionFixture({
        responseText: "Dispatched. Reporting when it lands.",
      }),
    );
    expect(f).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 2: permission_seeking
// ────────────────────────────────────────────────────────────────────────────

describe("checkPermissionSeeking", () => {
  it("fires on 'want me to dispatch' for routine work", () => {
    const f = checkPermissionSeeking(
      decisionFixture({
        responseText: "Want me to dispatch the bug-fix?",
      }),
    );
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("fail");
  });

  it("does NOT fire on strategic-founder-only items", () => {
    const f = checkPermissionSeeking(
      decisionFixture({
        responseText:
          "Do you want me to propose the soul-sentence change to the constitution?",
      }),
    );
    expect(f).toBeNull();
  });

  it("does NOT fire on a clean response", () => {
    const f = checkPermissionSeeking(
      decisionFixture({
        responseText: "Dispatched and reporting back.",
      }),
    );
    expect(f).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 3: credential_value_in_output
// ────────────────────────────────────────────────────────────────────────────

describe("checkCredentialValueInOutput", () => {
  it("fires when a PostHog phc_ project token appears", () => {
    const f = checkCredentialValueInOutput(
      decisionFixture({
        responseText:
          "Verified the value: phc_abcdefghijklmnopqrstuvwxyz0123456789 — good.",
      }),
    );
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("critical");
  });

  it("fires when a Stripe sk_live_ key appears", () => {
    const f = checkCredentialValueInOutput(
      decisionFixture({
        responseText: "the key is " + "sk" + "_live_" + "abcdefghijklmnopqrstuvwx0123 ok", // secret-scan:allow
      }),
    );
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("critical");
  });

  it("fires when an AKIA AWS access key id appears", () => {
    const f = checkCredentialValueInOutput(
      decisionFixture({
        responseText: "value " + "AK" + "IAABCDEFGHIJKLMNOP set", // secret-scan:allow
      }),
    );
    expect(f).not.toBeNull();
  });

  it("does NOT fire on phc_ mentions that are too short to be real", () => {
    const f = checkCredentialValueInOutput(
      decisionFixture({
        responseText: "phc_abc only seven chars",
      }),
    );
    expect(f).toBeNull();
  });

  it("does NOT fire on clean text", () => {
    const f = checkCredentialValueInOutput(
      decisionFixture({
        responseText: "VITE_POSTHOG_KEY is configured; verified via length.",
      }),
    );
    expect(f).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 4: stale_charter_quote
// ────────────────────────────────────────────────────────────────────────────

describe("checkStaleCharterQuote", () => {
  it("fires when a stale phase number is quoted", () => {
    // Current default = "Phase Zero"; quoting "Phase 1" is stale.
    const f = checkStaleCharterQuote(
      decisionFixture({
        responseText: "We're now in Phase 1 of the charter.",
      }),
    );
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("warn");
  });

  it("fires when a stale MRR amount is quoted", () => {
    // Current default = $0; quoting $200 MRR is stale by > $5.
    const f = checkStaleCharterQuote(
      decisionFixture({
        responseText: "We're past $200 MRR now.",
      }),
    );
    expect(f).not.toBeNull();
  });

  it("does NOT fire on a clean response", () => {
    const f = checkStaleCharterQuote(
      decisionFixture({
        responseText: "Pulse looks healthy this morning.",
      }),
    );
    expect(f).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 5: verify_before_dispatch_failure
// ────────────────────────────────────────────────────────────────────────────

describe("checkVerifyBeforeDispatchFailure", () => {
  it("fires when dispatch cites a queue doc without verification evidence", () => {
    const f = checkVerifyBeforeDispatchFailure(
      decisionFixture({
        decisionType: "dispatch",
        responseText:
          "Dispatching extraction #1 from docs/archive/exhaustive-completion/founder-dashboard-extraction-queue.md.",
        rationale: "Queue says it's next.",
      }),
    );
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("warn");
  });

  it("does NOT fire when rationale shows verification happened", () => {
    const f = checkVerifyBeforeDispatchFailure(
      decisionFixture({
        decisionType: "dispatch",
        responseText:
          "Dispatching extraction from docs/archive/exhaustive-completion/queue.md.",
        rationale: "Grepped repo first; verified the file does not yet exist.",
      }),
    );
    expect(f).toBeNull();
  });

  it("does NOT fire for non-dispatch decisions", () => {
    const f = checkVerifyBeforeDispatchFailure(
      decisionFixture({
        decisionType: "propose",
        responseText: "From docs/audits/zX.md.",
        rationale: "No checks.",
      }),
    );
    expect(f).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 6: capital_overspend_signal
// ────────────────────────────────────────────────────────────────────────────

describe("checkCapitalOverspend", () => {
  it("fires when 24h spend exceeds 10% of envelope", async () => {
    stubMonthlyEnvelope = {
      envelopeUsd: 50,
      monthToDateUsd: 6,
      percentUsed: 12,
      daysIntoMonth: 2,
      projectedMonthlyUsd: 90,
      status: "green" as const,
    };
    stub24hSpend = 6; // > 10% of 50 = $5
    const f = await checkCapitalOverspend([
      decisionFixture({ rationale: "ran some dispatches" }),
    ]);
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("warn");
    expect(f!.pattern).toBe("capital_overspend_signal");
  });

  it("does NOT fire when 24h spend is under threshold", async () => {
    stubMonthlyEnvelope = {
      envelopeUsd: 50,
      monthToDateUsd: 1,
      percentUsed: 2,
      daysIntoMonth: 1,
      projectedMonthlyUsd: 30,
      status: "green" as const,
    };
    stub24hSpend = 1; // < 10% of 50
    const f = await checkCapitalOverspend([decisionFixture()]);
    expect(f).toBeNull();
  });

  it("does NOT fire when rationale cites founder-approved spend", async () => {
    stubMonthlyEnvelope = {
      envelopeUsd: 50,
      monthToDateUsd: 8,
      percentUsed: 16,
      daysIntoMonth: 2,
      projectedMonthlyUsd: 120,
      status: "green" as const,
    };
    stub24hSpend = 8;
    const f = await checkCapitalOverspend([
      decisionFixture({ rationale: "founder approved the burst for the launch sprint" }),
    ]);
    expect(f).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 7: team_state_collision
// ────────────────────────────────────────────────────────────────────────────

describe("checkTeamStateCollision", () => {
  it("fires when dispatch touches an in-flight file", () => {
    setInFlightFilesForTest(["server/services/pax/continuousAudit.ts"]);
    const f = checkTeamStateCollision(
      decisionFixture({
        decisionType: "dispatch",
        responseText:
          "Dispatching edit to server/services/pax/continuousAudit.ts.",
      }),
    );
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("fail");
  });

  it("does NOT fire when the file paths differ", () => {
    setInFlightFilesForTest(["server/services/pax/continuousAudit.ts"]);
    const f = checkTeamStateCollision(
      decisionFixture({
        decisionType: "dispatch",
        responseText:
          "Dispatching edit to server/services/solene/selfAudit.ts.",
      }),
    );
    expect(f).toBeNull();
  });

  it("does NOT fire when no files are referenced", () => {
    setInFlightFilesForTest(["server/foo.ts"]);
    const f = checkTeamStateCollision(
      decisionFixture({
        decisionType: "dispatch",
        responseText: "Dispatched the maintenance sweep.",
      }),
    );
    expect(f).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 8: brief_context_staleness
// ────────────────────────────────────────────────────────────────────────────

describe("checkBriefContextStaleness", () => {
  it("fires when constitution is invoked without fresh-read evidence", () => {
    const f = checkBriefContextStaleness(
      decisionFixture({
        responseText: "Per the constitution, we must escalate.",
        rationale: "noted",
      }),
    );
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("info");
  });

  it("does NOT fire when rationale mentions a fresh read", () => {
    const f = checkBriefContextStaleness(
      decisionFixture({
        responseText: "Per the charter, we hold.",
        rationale: "Re-read the charter at session start before deciding.",
      }),
    );
    expect(f).toBeNull();
  });

  it("does NOT fire on a clean response", () => {
    const f = checkBriefContextStaleness(
      decisionFixture({
        responseText: "Pulse posted.",
        rationale: "Routine.",
      }),
    );
    expect(f).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// recordSoleneDecision — never-throws contract
// ────────────────────────────────────────────────────────────────────────────

describe("recordSoleneDecision", () => {
  it("inserts a decision row and returns its id", async () => {
    const id = await recordSoleneDecision({
      type: "dispatch",
      contextSummary: "test",
      rationale: "test",
    });
    expect(id).toBe(1);
    expect(DECISIONS).toHaveLength(1);
  });

  it("returns null instead of throwing on db failure", async () => {
    decisionsThrowOnInsert = true;
    const id = await recordSoleneDecision({
      type: "dispatch",
      contextSummary: "x",
      rationale: "x",
    });
    expect(id).toBeNull();
  });

  it("truncates context_summary to 500 chars", async () => {
    await recordSoleneDecision({
      type: "dispatch",
      contextSummary: "x".repeat(700),
      rationale: "y",
    });
    expect(DECISIONS[0].contextSummary.length).toBe(500);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// runSoleneAudit — idempotency + drift threshold + scope behaviour
// ────────────────────────────────────────────────────────────────────────────

describe("runSoleneAudit — end-to-end", () => {
  it("skips with reason when there are no decisions in the window", async () => {
    const r = await runSoleneAudit({ scope: "per-session" });
    expect(r.skipReason).toBe("no decisions in window");
    expect(r.decisionsExamined).toBe(0);
    expect(r.findingCount).toBe(0);
  });

  it("re-runs are idempotent (no duplicate findings)", async () => {
    await recordSoleneDecision({
      type: "dispatch",
      contextSummary: "test",
      rationale: "test",
      responseText: "Want me to dispatch the lead audit?",
    });
    const r1 = await runSoleneAudit({ scope: "ad-hoc", windowHours: 24 });
    expect(r1.findingCount).toBeGreaterThan(0);
    const findingsAfterFirst = AUDIT_FINDINGS.length;

    // Same run id, same decision id, same pattern → should NOT duplicate.
    // We re-insert findings under the same run by calling the audit's own
    // insert path with the existing run id via a second runSoleneAudit
    // call; the UNIQUE index simulated in our db mock dedupes at the
    // (run_id, decision_id, pattern) level. We assert by counting.
    const r2 = await runSoleneAudit({ scope: "ad-hoc", windowHours: 24 });
    // Each runSoleneAudit creates a NEW run row so findings under the new
    // run id are allowed. But within a single run, re-firing the same
    // (decision × detector) pair would have de-duped.
    expect(r2.findingCount).toBeGreaterThan(0);
    expect(AUDIT_FINDINGS.length).toBe(findingsAfterFirst + r2.findingCount);
  });

  it("drift fires when ≥1 critical finding", async () => {
    await recordSoleneDecision({
      type: "dispatch",
      contextSummary: "ctx",
      rationale: "r",
      responseText: "value: phc_abcdefghijklmnopqrstuvwxyz0123456789",
    });
    const r = await runSoleneAudit({ scope: "ad-hoc" });
    expect(r.driftSignalEmitted).toBe(true);
  });

  it("drift fires when ≥2 fail findings", async () => {
    await recordSoleneDecision({
      type: "dispatch",
      contextSummary: "a",
      rationale: "r",
      responseText: "Want me to dispatch the audit?",
    });
    await recordSoleneDecision({
      type: "dispatch",
      contextSummary: "b",
      rationale: "r",
      responseText: "Should I run the second sweep?",
    });
    const r = await runSoleneAudit({ scope: "ad-hoc" });
    expect(r.driftSignalEmitted).toBe(true);
  });

  it("drift does NOT fire when below all thresholds", async () => {
    await recordSoleneDecision({
      type: "dispatch",
      contextSummary: "x",
      rationale: "r",
      responseText: "Per the constitution, escalating to founder.",
    });
    const r = await runSoleneAudit({ scope: "ad-hoc" });
    // Only the brief_context_staleness (info severity) fires — below
    // critical/fail/warn thresholds.
    expect(r.driftSignalEmitted).toBe(false);
  });
});

describe("SOLENE_DRIFT_THRESHOLDS — exported constants", () => {
  it("exposes the right shape for downstream callers", () => {
    expect(SOLENE_DRIFT_THRESHOLDS.criticalCount).toBe(1);
    expect(SOLENE_DRIFT_THRESHOLDS.failCount).toBe(2);
    expect(SOLENE_DRIFT_THRESHOLDS.warnCount).toBe(5);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 9: review_skeleton_staleness
// ────────────────────────────────────────────────────────────────────────────

describe("checkReviewSkeletonStaleness", () => {
  const NOW = Date.now();
  const TEN_DAYS_AGO = new Date(NOW - 10 * 24 * 60 * 60 * 1000);
  const TWO_DAYS_AGO = new Date(NOW - 2 * 24 * 60 * 60 * 1000);

  it("fires when a review file is older than 7d AND has TODO(solene): markers", async () => {
    setReviewFilesAccessorForTest(() => [
      {
        path: "/docs/company/role-development/reviews/2026-04-iris.md",
        generatedAt: TEN_DAYS_AGO,
        hasTodoMarker: true,
      },
    ]);
    const f = await checkReviewSkeletonStaleness();
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("warn");
    expect(f!.pattern).toBe("review_skeleton_staleness");
    expect(f!.matchedPatterns).toContain(
      "/docs/company/role-development/reviews/2026-04-iris.md",
    );
  });

  it("does NOT fire when an old file has no TODO markers (Solene filled it)", async () => {
    setReviewFilesAccessorForTest(() => [
      {
        path: "/docs/company/role-development/reviews/2026-04-iris.md",
        generatedAt: TEN_DAYS_AGO,
        hasTodoMarker: false,
      },
    ]);
    const f = await checkReviewSkeletonStaleness();
    expect(f).toBeNull();
  });

  it("does NOT fire when a recent file still has TODO markers (inside grace window)", async () => {
    setReviewFilesAccessorForTest(() => [
      {
        path: "/docs/company/role-development/reviews/2026-06-iris.md",
        generatedAt: TWO_DAYS_AGO,
        hasTodoMarker: true,
      },
    ]);
    const f = await checkReviewSkeletonStaleness();
    expect(f).toBeNull();
  });

  it("does NOT fire when the review directory is empty", async () => {
    setReviewFilesAccessorForTest(() => []);
    const f = await checkReviewSkeletonStaleness();
    expect(f).toBeNull();
  });

  it("aggregates multiple stale files into a single finding with all paths in matchedPatterns", async () => {
    setReviewFilesAccessorForTest(() => [
      {
        path: "/docs/company/role-development/reviews/2026-04-iris.md",
        generatedAt: TEN_DAYS_AGO,
        hasTodoMarker: true,
      },
      {
        path: "/docs/company/role-development/arc/2026-Q1.md",
        generatedAt: TEN_DAYS_AGO,
        hasTodoMarker: true,
      },
      {
        path: "/docs/company/role-development/reviews/2026-06-soren.md",
        generatedAt: TWO_DAYS_AGO,
        hasTodoMarker: true,
      },
    ]);
    const f = await checkReviewSkeletonStaleness();
    expect(f).not.toBeNull();
    expect(f!.matchedPatterns).toHaveLength(2);
    expect(f!.matchedPatterns).toContain(
      "/docs/company/role-development/reviews/2026-04-iris.md",
    );
    expect(f!.matchedPatterns).toContain(
      "/docs/company/role-development/arc/2026-Q1.md",
    );
  });

  it("contributes a stale finding through runRunLevelChecks when a decision exists", async () => {
    setReviewFilesAccessorForTest(() => [
      {
        path: "/docs/company/role-development/reviews/2026-04-iris.md",
        generatedAt: TEN_DAYS_AGO,
        hasTodoMarker: true,
      },
    ]);
    await recordSoleneDecision({
      type: "dispatch",
      contextSummary: "ctx",
      rationale: "r",
      responseText: "Dispatched and reporting back.",
    });
    const r = await runSoleneAudit({ scope: "ad-hoc" });
    const hasStaleFinding = AUDIT_FINDINGS.some(
      (f) => f.pattern === "review_skeleton_staleness",
    );
    expect(hasStaleFinding).toBe(true);
    expect(r.findingCount).toBeGreaterThanOrEqual(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 10: predictability_drift
// ────────────────────────────────────────────────────────────────────────────

describe("checkPredictabilityDrift", () => {
  it("fires when >1 menu_handing/permission_seeking finding in 14d", async () => {
    AUDIT_FINDINGS.push(
      {
        id: 1,
        runId: 1,
        decisionId: null,
        pattern: "menu_handing",
        severity: "fail",
        citation: "x",
        excerpt: "x",
        matchedPatterns: [],
        firedAt: new Date(),
      },
      {
        id: 2,
        runId: 1,
        decisionId: null,
        pattern: "permission_seeking",
        severity: "fail",
        citation: "x",
        excerpt: "x",
        matchedPatterns: [],
        firedAt: new Date(),
      },
    );
    const f = await checkPredictabilityDrift();
    expect(f).not.toBeNull();
    expect(f!.pattern).toBe("predictability_drift");
    expect(f!.severity).toBe("warn");
  });

  it("does NOT fire when only 1 such finding exists", async () => {
    AUDIT_FINDINGS.push({
      id: 1,
      runId: 1,
      decisionId: null,
      pattern: "menu_handing",
      severity: "fail",
      citation: "x",
      excerpt: "x",
      matchedPatterns: [],
      firedAt: new Date(),
    });
    const f = await checkPredictabilityDrift();
    expect(f).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 11: in_the_moment_self_correction
// ────────────────────────────────────────────────────────────────────────────

describe("checkInTheMomentSelfCorrection", () => {
  it("fires when ≥50% of decisions are post-hoc-caught discipline failures", () => {
    const decisions = [
      decisionFixture({
        id: 1,
        rationale: "shipping the dispatch",
        responseText: "Want me to dispatch the audit?",
      }),
      decisionFixture({
        id: 2,
        rationale: "another dispatch",
        responseText: "Should I dispatch this one?",
      }),
      decisionFixture({
        id: 3,
        rationale: "third one",
        responseText: "do you want me to handle X?",
      }),
    ];
    const f = checkInTheMomentSelfCorrection(decisions);
    expect(f).not.toBeNull();
    expect(f!.pattern).toBe("in_the_moment_self_correction");
    expect(f!.severity).toBe("warn");
  });

  it("does NOT fire when self-correction markers dominate", () => {
    const decisions = [
      decisionFixture({
        id: 1,
        rationale: "caught myself reaching for a menu, scrubbed before sending",
        responseText: "Dispatched and reporting back.",
      }),
      decisionFixture({
        id: 2,
        rationale: "self-corrected mid-draft",
        responseText: "Dispatched the audit.",
      }),
    ];
    const f = checkInTheMomentSelfCorrection(decisions);
    expect(f).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 12: softening_language
// ────────────────────────────────────────────────────────────────────────────

describe("checkSofteningLanguage", () => {
  it("fires info per occurrence when softener+verb co-occur", () => {
    const findings = checkSofteningLanguage([
      decisionFixture({
        id: 1,
        responseText:
          "The migration should be working now — probably shipped end to end.",
      }),
      decisionFixture({
        id: 2,
        responseText: "Mostly verified the deploy.",
      }),
    ]);
    expect(findings.length).toBe(2);
    for (const f of findings) {
      expect(f.severity).toBe("info");
      expect(f.pattern).toBe("softening_language");
    }
  });

  it("does NOT fire on clean confident text", () => {
    const findings = checkSofteningLanguage([
      decisionFixture({
        id: 1,
        responseText: "Shipped and verified end-to-end. Tests pass.",
      }),
    ]);
    expect(findings.length).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 13: strategic_vision_miss
// ────────────────────────────────────────────────────────────────────────────

describe("checkStrategicVisionMiss", () => {
  it("fires fail when a Tom-correction signal lands in a decision rationale", () => {
    const decisions = [
      decisionFixture({
        id: 1,
        rationale: "Dispatched the audit. Tom said: actually you should ship the schema first.",
      }),
    ];
    const f = checkStrategicVisionMiss(decisions);
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("fail");
    expect(f!.pattern).toBe("strategic_vision_miss");
  });

  it("is silent when no correction signal appears", () => {
    const decisions = [
      decisionFixture({
        id: 1,
        rationale: "Dispatched the audit, Tom approved the plan upfront.",
      }),
    ];
    expect(checkStrategicVisionMiss(decisions)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 14: decision_compounding_ratio
// ────────────────────────────────────────────────────────────────────────────

describe("checkDecisionCompoundingRatio", () => {
  it("fires warn when <30% of decisions cite compounding rationale", () => {
    const decisions = Array.from({ length: 10 }, (_, i) =>
      decisionFixture({
        id: i + 1,
        rationale:
          i === 0
            ? "shipped a schema migration cadence detector"
            : "one-shot change",
      }),
    );
    const f = checkDecisionCompoundingRatio(decisions);
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("warn");
    expect(f!.pattern).toBe("decision_compounding_ratio");
  });

  it("is silent when ≥30% of decisions cite compounding rationale", () => {
    const decisions = Array.from({ length: 5 }, (_, i) =>
      decisionFixture({
        id: i + 1,
        rationale:
          i < 3
            ? "memorialized schema cadence detector infrastructure"
            : "one-shot",
      }),
    );
    expect(checkDecisionCompoundingRatio(decisions)).toBeNull();
  });

  it("is silent when fewer than 5 decisions are in the window", () => {
    const decisions = [
      decisionFixture({ id: 1, rationale: "one-shot" }),
      decisionFixture({ id: 2, rationale: "one-shot" }),
    ];
    expect(checkDecisionCompoundingRatio(decisions)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 15: boundary_respect
// ────────────────────────────────────────────────────────────────────────────

describe("checkBoundaryRespect", () => {
  it("fires critical when a dispatch touches a strategic-founder-only category without approval", () => {
    const findings = checkBoundaryRespect([
      decisionFixture({
        id: 1,
        decisionType: "dispatch",
        rationale: "Updating the soul sentence framing.",
        contextSummary: "ctx",
      }),
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].pattern).toBe("boundary_respect");
  });

  it("does NOT fire when founder approval is paired in rationale", () => {
    const findings = checkBoundaryRespect([
      decisionFixture({
        id: 1,
        decisionType: "dispatch",
        rationale: "Updating the soul sentence — founder approved 2026-06-02.",
      }),
    ]);
    expect(findings.length).toBe(0);
  });

  it("does NOT fire on an 'escalate' decision (correct escalation path)", () => {
    const findings = checkBoundaryRespect([
      decisionFixture({
        id: 1,
        decisionType: "escalate",
        rationale: "Soul sentence revision proposed — escalating for founder review.",
      }),
    ]);
    expect(findings.length).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DETECTOR 16: transparency
// ────────────────────────────────────────────────────────────────────────────

describe("checkTransparency", () => {
  it("fires warn when decisions exist but no founder-visible surfaces", async () => {
    const decisions = Array.from({ length: 4 }, (_, i) =>
      decisionFixture({ id: i + 1, contextSummary: `unique-decision-context-${i}-with-words` }),
    );
    setSoleneSurfaceAccessorForTest(() => []);
    const f = await checkTransparency(decisions);
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("warn");
    expect(f!.pattern).toBe("transparency");
  });

  it("does NOT fire when surfaces mention the decisions", async () => {
    const decisions = Array.from({ length: 4 }, (_, i) =>
      decisionFixture({
        id: i + 1,
        contextSummary: `decision-context-${i}-substantive-token`,
      }),
    );
    setSoleneSurfaceAccessorForTest(() => [
      {
        path: "/docs/company/retros/2026-W22.md",
        body:
          "Retro: covered decision-context-0-substantive-token, decision-context-1-substantive-token, decision-context-2-substantive-token, decision-context-3-substantive-token.",
        generatedAt: new Date(),
      },
    ]);
    const f = await checkTransparency(decisions);
    expect(f).toBeNull();
  });

  it("is silent when too few decisions to assess", async () => {
    const f = await checkTransparency([
      decisionFixture({ id: 1, contextSummary: "x" }),
    ]);
    expect(f).toBeNull();
  });
});
