/**
 * Tests for Solene v3 team-system audit service.
 *
 * Coverage: each of the 6 dimension scanners with synthetic inputs
 * (positive case → finding fires, negative case → silent, multi-case
 * → multiple findings) plus integration smoke (driftMet threshold).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

interface RunRow {
  id: number;
  runStartedAt: Date;
  runEndedAt: Date | null;
  dimensionsScanned: string[];
  findingCount: number;
  driftSignalEmitted: boolean;
  skipReason: string | null;
}
interface FindingRow {
  id: number;
  runId: number;
  dimension: string;
  severity: string;
  description: string;
  evidence: Record<string, unknown>;
  firedAt: Date;
}

const RUNS: RunRow[] = [];
const FINDINGS: FindingRow[] = [];
let nextRunId = 1;
let nextFindingId = 1;

vi.mock("../../server/db", () => {
  const db = {
    insert: (_table: unknown) => ({
      values: (rows: any) => {
        if (Array.isArray(rows)) {
          return {
            onConflictDoNothing: (_: unknown) => {
              for (const r of rows as FindingRow[]) {
                const exists = FINDINGS.find(
                  (existing) =>
                    existing.runId === r.runId &&
                    existing.dimension === r.dimension &&
                    existing.description === r.description,
                );
                if (!exists) {
                  FINDINGS.push({
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
        const id = nextRunId++;
        RUNS.push({
          id,
          runStartedAt: rows.runStartedAt ?? new Date(),
          runEndedAt: null,
          dimensionsScanned: rows.dimensionsScanned ?? [],
          findingCount: 0,
          driftSignalEmitted: false,
          skipReason: null,
        });
        return { returning: (_: unknown) => Promise.resolve([{ id }]) };
      },
    }),
    update: (_t: unknown) => ({
      set: (values: any) => ({
        where: (_p: unknown) => {
          const r = RUNS[RUNS.length - 1];
          if (r) Object.assign(r, values);
          return Promise.resolve();
        },
      }),
    }),
    select: (_p?: unknown) => {
      const step: any = {
        from: () => step,
        where: () => step,
        orderBy: () => step,
        limit: () => Promise.resolve([]),
        then: (onF: any, onR: any) =>
          Promise.resolve([] as unknown[]).then(onF, onR),
      };
      return step;
    },
  };
  return { db };
});

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );
  return {
    ...actual,
    sql: (() => {
      const tag: any = (..._args: unknown[]) => ({ op: "sql" });
      tag.raw = (_: string) => ({ op: "sql.raw" });
      return tag;
    })(),
  };
});

import {
  runTeamSystemAudit,
  scanCrossTeamHandoffs,
  scanCoordinationQuality,
  scanAntiFragmentation,
  scanOutsideInBenchmark,
  scanTeamSynergy,
  scanEliteBarTrajectory,
  attributeCommitToMembers,
  parseLastClosedDate,
  parseGitLog,
  setCommitSourceForTest,
  setAuditFiringSourceForTest,
  setEliteBarSourceForTest,
  setBenchmarkFeedSourceForTest,
  TEAM_SYSTEM_DRIFT_THRESHOLDS,
  type CommitInfo,
  type AuditFiringSummary,
  type EliteBarFile,
  type BenchmarkItem,
} from "../../server/services/team-system-audit";

function reset() {
  RUNS.length = 0;
  FINDINGS.length = 0;
  nextRunId = 1;
  nextFindingId = 1;
  setCommitSourceForTest(null);
  setAuditFiringSourceForTest(null);
  setEliteBarSourceForTest(null);
  setBenchmarkFeedSourceForTest(null);
}

function commit(opts: Partial<CommitInfo> & { sha: string }): CommitInfo {
  return {
    sha: opts.sha,
    timestamp: opts.timestamp ?? new Date(),
    authorMessage: opts.authorMessage ?? "iris: routine",
    files: opts.files ?? [],
    diff: opts.diff,
  };
}

beforeEach(reset);
afterEach(() => vi.clearAllMocks());

// ============================================================================
// SCANNER 1 — cross_team_handoff
// ============================================================================
describe("scanCrossTeamHandoffs", () => {
  const auditsAllStale: AuditFiringSummary = {
    beatriceLastRunAt: new Date(Date.now() - 1000 * 60 * 60 * 72),
    soleneLastRunAt: new Date(Date.now() - 1000 * 60 * 60 * 72),
  };

  it("fires when an Iris money-touching commit has no Beatrice audit after", () => {
    const findings = scanCrossTeamHandoffs(
      [
        commit({
          sha: "abc12345",
          authorMessage: "iris: emailService refactor",
          files: ["server/services/email/emailService.ts"],
          timestamp: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
        }),
      ],
      auditsAllStale,
    );
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].dimension).toBe("cross_team_handoff");
    expect(findings[0].severity).toBe("fail");
  });

  it("does NOT fire when Beatrice fired after the commit", () => {
    const commitTs = new Date(Date.now() - 60 * 60 * 1000);
    const findings = scanCrossTeamHandoffs(
      [
        commit({
          sha: "deadbeef",
          authorMessage: "iris: emailService change",
          files: ["server/services/email/emailService.ts"],
          timestamp: commitTs,
        }),
      ],
      {
        beatriceLastRunAt: new Date(commitTs.getTime() + 1000 * 60),
        soleneLastRunAt: null,
      },
    );
    expect(findings.length).toBe(0);
  });

  it("fires a truth-engine warn when customer surface + $ figure ships with no Solene audit after", () => {
    const findings = scanCrossTeamHandoffs(
      [
        commit({
          sha: "feed1234",
          authorMessage: "soren: landing copy now claims $500 saved monthly",
          files: ["client/src/pages/landing/index.tsx"],
          timestamp: new Date(Date.now() - 30 * 60 * 1000),
        }),
      ],
      auditsAllStale,
    );
    const truth = findings.find((f) => f.severity === "warn");
    expect(truth).toBeDefined();
  });
});

// ============================================================================
// SCANNER 2 — coordination_quality
// ============================================================================
describe("scanCoordinationQuality", () => {
  it("fires when two different members modify the same file within 60 min", () => {
    const base = Date.now();
    const findings = scanCoordinationQuality([
      commit({
        sha: "aaaa1111",
        authorMessage: "iris: tweak shared util",
        files: ["server/utils/shared.ts", "server/services/iris/perfMonitor.ts"],
        timestamp: new Date(base),
      }),
      commit({
        sha: "bbbb2222",
        authorMessage: "soren: add util usage from learn page",
        files: ["server/utils/shared.ts", "client/src/pages/learn/index.tsx"],
        timestamp: new Date(base + 15 * 60 * 1000),
      }),
    ]);
    const f = findings.find((x) => x.description.includes("shared.ts"));
    expect(f).toBeDefined();
    expect(f!.severity).toBe("warn");
  });

  it("does NOT fire when the same member modifies the same file twice", () => {
    const base = Date.now();
    const findings = scanCoordinationQuality([
      commit({
        sha: "aaaa1111",
        authorMessage: "iris: first edit",
        files: ["server/services/iris/perfMonitor.ts"],
        timestamp: new Date(base),
      }),
      commit({
        sha: "bbbb2222",
        authorMessage: "iris: second edit",
        files: ["server/services/iris/perfMonitor.ts"],
        timestamp: new Date(base + 15 * 60 * 1000),
      }),
    ]);
    expect(findings.length).toBe(0);
  });

  it("fires an accidental-sweep finding for ≥4 cross-domain files", () => {
    const findings = scanCoordinationQuality([
      commit({
        sha: "swept123",
        authorMessage: "krieger: mobile tweaks",
        files: [
          "client/src/components/layout-mobile/header.tsx",
          "client/src/pages/learn/a.tsx",
          "client/src/pages/learn/b.tsx",
          "client/src/pages/learn/c.tsx",
          "client/src/pages/learn/d.tsx",
        ],
        timestamp: new Date(),
      }),
    ]);
    const sweep = findings.find((f) =>
      f.description.includes("Accidental file-sweep"),
    );
    expect(sweep).toBeDefined();
  });
});

// ============================================================================
// SCANNER 3 — anti_fragmentation
// ============================================================================
describe("scanAntiFragmentation", () => {
  it("fires when a customer surface commit adds a codename mention", () => {
    const findings = scanAntiFragmentation([
      commit({
        sha: "codename1",
        authorMessage: "soren: copy update",
        files: ["client/src/pages/learn/index.tsx"],
        timestamp: new Date(),
        diff: "+ Atlas suggests reviewing the deal\n- old copy\n",
      }),
    ]);
    const leak = findings.find((f) => f.description.includes("codename"));
    expect(leak).toBeDefined();
    expect(leak!.severity).toBe("fail");
  });

  it("fires a contradiction warn when recent adds a line older removed", () => {
    const recent = commit({
      sha: "newcommit",
      authorMessage: "iris: re-enable feature flag",
      files: ["server/services/iris/perfMonitor.ts"],
      timestamp: new Date(),
      diff: "+ export const FEATURE_FLAG_PAX_ONLY = true; // load-bearing\n",
    });
    const older = commit({
      sha: "oldcommit",
      authorMessage: "beatrice: pax flag clean",
      files: ["server/services/pax/continuousAudit.ts"],
      timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      diff: "- export const FEATURE_FLAG_PAX_ONLY = true; // load-bearing\n",
    });
    const findings = scanAntiFragmentation([recent, older]);
    const contradiction = findings.find((f) =>
      f.description.includes("possible contradiction"),
    );
    expect(contradiction).toBeDefined();
  });

  it("is silent on a clean stream with no diff overlap", () => {
    const findings = scanAntiFragmentation([
      commit({
        sha: "clean1",
        authorMessage: "iris: docs",
        files: ["docs/iris/perf.md"],
        timestamp: new Date(),
        diff: "+ totally new content here\n",
      }),
      commit({
        sha: "clean2",
        authorMessage: "soren: docs",
        files: ["docs/soren/seo.md"],
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
        diff: "- other content removed\n",
      }),
    ]);
    expect(findings.length).toBe(0);
  });
});

// ============================================================================
// SCANNER 4 — outside_in_benchmark
// ============================================================================
describe("scanOutsideInBenchmark", () => {
  it("surfaces a finding when a feed item's title matches a keyword", () => {
    const items: BenchmarkItem[] = [
      {
        source: "stripe-engineering",
        url: "https://stripe.com/blog/x",
        title: "How we made our deploy pipeline idempotent",
        publishedAt: new Date(),
      },
    ];
    const findings = scanOutsideInBenchmark(items);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe("info");
    expect(findings[0].description).toContain("stripe-engineering");
  });

  it("caps output at 5 findings", () => {
    const items: BenchmarkItem[] = Array.from({ length: 10 }, (_, i) => ({
      source: "linear-blog",
      url: `https://linear.app/blog/${i}`,
      title: `Postgres migration story ${i}`,
      publishedAt: new Date(Date.now() - i * 1000 * 60 * 60),
    }));
    const findings = scanOutsideInBenchmark(items);
    expect(findings.length).toBe(5);
  });

  it("is silent when no items pass the keyword filter", () => {
    const items: BenchmarkItem[] = [
      {
        source: "stripe-engineering",
        url: "x",
        title: "A short post about pottery",
        publishedAt: new Date(),
      },
    ];
    expect(scanOutsideInBenchmark(items).length).toBe(0);
  });
});

// ============================================================================
// SCANNER 5 — team_synergy
// ============================================================================
describe("scanTeamSynergy", () => {
  it("fires when cross-functional commit count drops >30% w/w", () => {
    const now = Date.now();
    const within = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000);
    const xfn = (sha: string, ts: Date): CommitInfo =>
      commit({
        sha,
        // Hit both Iris and Soren domains.
        files: [
          "server/services/iris/perfMonitor.ts",
          "client/src/pages/learn/x.tsx",
        ],
        timestamp: ts,
      });
    const findings = scanTeamSynergy([
      xfn("p1", within(8)),
      xfn("p2", within(9)),
      xfn("p3", within(10)),
      xfn("p4", within(11)),
      xfn("p5", within(12)),
      xfn("p6", within(13)),
      // No this-week cross-functional commits.
      commit({
        sha: "thisweek",
        files: ["server/services/iris/perfMonitor.ts"],
        timestamp: within(2),
      }),
    ]);
    const f = findings.find((x) => x.dimension === "team_synergy");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("warn");
  });

  it("is silent when synergy is stable", () => {
    const now = Date.now();
    const ts = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000);
    const xfn = (sha: string, t: Date): CommitInfo =>
      commit({
        sha,
        files: [
          "server/services/iris/perfMonitor.ts",
          "client/src/pages/learn/x.tsx",
        ],
        timestamp: t,
      });
    const findings = scanTeamSynergy([
      xfn("p1", ts(8)),
      xfn("p2", ts(9)),
      xfn("p3", ts(10)),
      xfn("t1", ts(1)),
      xfn("t2", ts(2)),
      xfn("t3", ts(3)),
    ]);
    expect(findings.length).toBe(0);
  });
});

// ============================================================================
// SCANNER 6 — elite_bar_trajectory
// ============================================================================
describe("scanEliteBarTrajectory", () => {
  it("fires warn for a member whose bar is >90 days plateaued", () => {
    const bars: EliteBarFile[] = [
      {
        member: "iris",
        path: "/x/iris.md",
        lastClosedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      },
    ];
    const f = scanEliteBarTrajectory(bars);
    expect(f.length).toBe(1);
    expect(f[0].severity).toBe("warn");
    expect(f[0].description).toContain("iris");
  });

  it("fires warn for a member with no closed entries at all", () => {
    const bars: EliteBarFile[] = [
      { member: "soren", path: "/x/soren.md", lastClosedAt: null },
    ];
    const f = scanEliteBarTrajectory(bars);
    expect(f.length).toBe(1);
    expect(f[0].description).toContain("not visibly moving");
  });

  it("is silent for a member that closed something in the last 90 days", () => {
    const bars: EliteBarFile[] = [
      {
        member: "krieger",
        path: "/x/krieger.md",
        lastClosedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    ];
    expect(scanEliteBarTrajectory(bars).length).toBe(0);
  });
});

// ============================================================================
// HELPERS
// ============================================================================
describe("attributeCommitToMembers", () => {
  it("attributes by commit prefix", () => {
    expect(
      attributeCommitToMembers(
        commit({
          sha: "x",
          authorMessage: "iris: routine",
          files: ["docs/random.md"],
        }),
      ),
    ).toContain("iris");
  });

  it("attributes by file-path patterns even without a prefix", () => {
    const members = attributeCommitToMembers(
      commit({
        sha: "x",
        authorMessage: "no prefix",
        files: ["server/services/pax/continuousAudit.ts"],
      }),
    );
    expect(members).toContain("beatrice");
  });
});

describe("parseLastClosedDate", () => {
  it("returns the latest YYYY-MM-DD under '## Closed this period'", () => {
    const body = [
      "# Iris",
      "",
      "## Closed this period",
      "",
      "- closed 2026-05-01: something",
      "- closed 2026-05-15: another",
      "",
      "## Other section",
      "- 2026-06-01: not counted",
    ].join("\n");
    const d = parseLastClosedDate(body);
    expect(d).not.toBeNull();
    expect(d!.toISOString().slice(0, 10)).toBe("2026-05-15");
  });

  it("returns null when the section is empty", () => {
    const body = [
      "## Closed this period",
      "",
      "_(Empty initially.)_",
      "",
      "## Other",
    ].join("\n");
    expect(parseLastClosedDate(body)).toBeNull();
  });
});

describe("parseGitLog", () => {
  it("parses one commit block correctly", () => {
    const raw =
      "__COMMIT__\nabc123\n1717000000\niris: x\nserver/x.ts\nserver/y.ts\n";
    const out = parseGitLog(raw);
    expect(out.length).toBe(1);
    expect(out[0].sha).toBe("abc123");
    expect(out[0].files).toEqual(["server/x.ts", "server/y.ts"]);
  });
});

// ============================================================================
// runTeamSystemAudit — integration: drift threshold
// ============================================================================
describe("runTeamSystemAudit drift threshold", () => {
  it("emits drift signal when ≥6 warns are produced", async () => {
    // Stub all sources to produce a stream of warn findings.
    setCommitSourceForTest(() => []);
    setAuditFiringSourceForTest(() =>
      Promise.resolve({
        beatriceLastRunAt: null,
        soleneLastRunAt: null,
      }),
    );
    // Six plateaued bars → six warns from elite_bar_trajectory alone.
    setEliteBarSourceForTest(() => [
      { member: "iris", path: "x", lastClosedAt: null },
      { member: "soren", path: "x", lastClosedAt: null },
      { member: "beatrice", path: "x", lastClosedAt: null },
      { member: "krieger", path: "x", lastClosedAt: null },
      { member: "solene", path: "x", lastClosedAt: null },
      {
        member: "iris",
        path: "x2",
        lastClosedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      },
    ]);

    const res = await runTeamSystemAudit({ scope: "continuous" });
    expect(res.findingCount).toBeGreaterThanOrEqual(
      TEAM_SYSTEM_DRIFT_THRESHOLDS.warnCount,
    );
    expect(res.driftSignalEmitted).toBe(true);
  });

  it("does NOT emit drift when zero findings", async () => {
    setCommitSourceForTest(() => []);
    setAuditFiringSourceForTest(() =>
      Promise.resolve({ beatriceLastRunAt: null, soleneLastRunAt: null }),
    );
    setEliteBarSourceForTest(() => [
      {
        member: "iris",
        path: "x",
        lastClosedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    ]);
    const res = await runTeamSystemAudit({ scope: "continuous" });
    expect(res.findingCount).toBe(0);
    expect(res.driftSignalEmitted).toBe(false);
  });

  it("weekly scope runs only the outside-in scanner", async () => {
    setBenchmarkFeedSourceForTest(() => Promise.resolve([]));
    const res = await runTeamSystemAudit({ scope: "weekly" });
    expect(res.dimensionsScanned).toEqual(["outside_in_benchmark"]);
  });
});
