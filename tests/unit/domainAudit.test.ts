/**
 * Tests for the shared continuous-audit substrate (Iris).
 *
 * Coverage:
 *   1. recordFinding UPSERT/dedupe — first fire inserts; same (detector,
 *      dedupe_key) re-fire updates last_seen_at + mutable fields, never
 *      duplicating; a re-fire of a resolved/stale finding re-opens it; an
 *      acknowledged finding stays acknowledged on re-fire.
 *   2. runDomainAudits isolation — one throwing detector never breaks others.
 *   3. staleFindings — open findings older than N days flip to 'stale';
 *      acknowledged/resolved are left alone.
 *   4. taxReserveDetector — green at zero revenue; warn when under floor;
 *      critical when empty; silent when funded.
 *   5. observationRateDetector — silent with no prior traffic; silent when
 *      still observing; warn on stall; critical on high-volume stall.
 *
 * The db is mocked as a tiny in-memory store that honours the exact query
 * shapes the substrate + detectors use.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── In-memory findings store + db mock ───────────────────────────────────────

interface Row {
  id: number;
  domain: string;
  detector: string;
  severity: string;
  title: string;
  detail: string;
  citedReason: string;
  status: string;
  dedupeKey: string;
  subjectRef: string | null;
  metadata: Record<string, unknown> | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
}

const FINDINGS: Row[] = [];
let nextId = 1;

// Controls for what financial-ledger / parcel queries return in detector tests.
const LEDGER = { revenueCents: 0, taxBucketCents: 0 };
const OBS = { last24h: 0, priorWeek: 0 };

vi.mock("../../server/db", () => {
  // Each insert/update/select returns a thennable builder. We only implement
  // the exact chains the substrate uses.
  const db: any = {
    insert: (_table: unknown) => ({
      values: (vals: any) => ({
        onConflictDoUpdate: ({ set }: { set: any }) => {
          const existing = FINDINGS.find(
            (f) => f.detector === vals.detector && f.dedupeKey === vals.dedupeKey,
          );
          if (!existing) {
            FINDINGS.push({
              id: nextId++,
              domain: vals.domain,
              detector: vals.detector,
              severity: vals.severity,
              title: vals.title,
              detail: vals.detail,
              citedReason: vals.citedReason,
              status: vals.status ?? "open",
              dedupeKey: vals.dedupeKey,
              subjectRef: vals.subjectRef ?? null,
              metadata: vals.metadata ?? null,
              firstSeenAt: vals.firstSeenAt ?? new Date(),
              lastSeenAt: vals.lastSeenAt ?? new Date(),
              resolvedAt: null,
            });
            return Promise.resolve();
          }
          // Apply the upsert `set`. The substrate passes a CASE sql for status
          // + resolvedAt — we emulate its semantics directly.
          existing.severity = set.severity;
          existing.title = set.title;
          existing.detail = set.detail;
          existing.citedReason = set.citedReason;
          existing.domain = set.domain;
          existing.subjectRef = set.subjectRef ?? null;
          existing.metadata = set.metadata ?? null;
          existing.lastSeenAt = set.lastSeenAt;
          // Re-open semantics: resolved/stale → open; resolvedAt cleared.
          if (existing.status === "resolved" || existing.status === "stale") {
            existing.status = "open";
            existing.resolvedAt = null;
          }
          return Promise.resolve();
        },
      }),
    }),

    update: (_t: unknown) => ({
      set: (vals: any) => ({
        where: (pred: any) => {
          // pred is a tagged marker object we set below in the where() mock.
          const matcher: (r: Row) => boolean = pred?.__match ?? (() => false);
          const updated: Row[] = [];
          for (const r of FINDINGS) {
            if (matcher(r)) {
              Object.assign(r, vals);
              updated.push(r);
            }
          }
          return {
            returning: (_sel?: unknown) =>
              Promise.resolve(updated.map((r) => ({ ...r }))),
          };
        },
      }),
    }),

    select: (_sel?: unknown) => {
      const step: any = {
        _where: (_: Row) => true,
        from: () => step,
        where: (pred: any) => {
          if (pred?.__match) step._where = pred.__match;
          return step;
        },
        orderBy: () =>
          Promise.resolve(FINDINGS.filter(step._where).map((r) => ({ ...r }))),
        groupBy: () => Promise.resolve([]),
        then: (onF: any, onR: any) =>
          Promise.resolve(FINDINGS.filter(step._where).map((r) => ({ ...r }))).then(
            onF,
            onR,
          ),
      };
      return step;
    },
  };
  return { db };
});

// drizzle-orm: make and/eq/lt/inArray/sql produce predicate markers our mock
// understands. eq/lt/inArray reference the column NAME via the proxy below.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );
  const colName = (c: any): string =>
    typeof c === "object" && c?.__col ? c.__col : String(c);
  return {
    ...actual,
    and: (...preds: any[]) => ({
      __match: (r: Row) =>
        preds.every((p) => (p?.__match ? p.__match(r) : true)),
    }),
    eq: (col: any, val: any) => ({
      __match: (r: Row) => (r as any)[colName(col)] === val,
    }),
    lt: (col: any, val: any) => ({
      __match: (r: Row) => (r as any)[colName(col)] < val,
    }),
    gte: (_col: any, _val: any) => ({ __match: (_r: Row) => true }),
    inArray: (col: any, vals: any[]) => ({
      __match: (r: Row) => vals.includes((r as any)[colName(col)]),
    }),
    sql: (() => {
      const expr = () => {
        const e: any = { op: "sql" };
        e.mapWith = () => e;
        return e;
      };
      const tag: any = (..._args: unknown[]) => expr();
      tag.raw = (_: string) => expr();
      return tag;
    })(),
  };
});

// Map column proxies → property names the in-memory rows use.
vi.mock("@shared/schema", () => {
  const mkCols = (names: Record<string, string>) => {
    const o: any = {};
    for (const [prop, col] of Object.entries(names)) o[prop] = { __col: col };
    return o;
  };
  return {
    domainAuditFindings: mkCols({
      id: "id",
      domain: "domain",
      detector: "detector",
      severity: "severity",
      status: "status",
      dedupeKey: "dedupeKey",
      lastSeenAt: "lastSeenAt",
      resolvedAt: "resolvedAt",
    }),
    financialLedger: mkCols({
      amountCents: "amountCents",
      category: "category",
      postedAt: "postedAt",
    }),
    parcelObservations: mkCols({ observedAt: "observedAt" }),
    DOMAIN_AUDIT_DOMAINS: ["finance", "future"],
  };
});

// financial-ledger.getBucketBalance → controllable.
vi.mock("../../server/services/financial-ledger", () => ({
  getBucketBalance: vi.fn(async () => LEDGER.taxBucketCents),
}));

import {
  recordFinding,
  resolveFinding,
  acknowledgeFinding,
  staleFindings,
  runDomainAudits,
  type DomainDetector,
  type FindingInput,
} from "../../server/services/audit/domainAudit";

function baseFinding(over: Partial<FindingInput> = {}): FindingInput {
  return {
    domain: "finance",
    detector: "t",
    severity: "warn",
    title: "t",
    detail: "d",
    citedReason: "c",
    dedupeKey: "k",
    ...over,
  };
}

beforeEach(() => {
  FINDINGS.length = 0;
  nextId = 1;
  LEDGER.revenueCents = 0;
  LEDGER.taxBucketCents = 0;
  OBS.last24h = 0;
  OBS.priorWeek = 0;
});
afterEach(() => vi.clearAllMocks());

// ── recordFinding upsert/dedupe ──────────────────────────────────────────────

describe("recordFinding — upsert/dedupe", () => {
  it("inserts a new finding on first fire", async () => {
    await recordFinding(baseFinding({ detector: "d1", dedupeKey: "k1" }));
    expect(FINDINGS).toHaveLength(1);
    expect(FINDINGS[0].status).toBe("open");
  });

  it("does NOT duplicate on same (detector, dedupe_key) — bumps last_seen_at + refreshes severity", async () => {
    await recordFinding(baseFinding({ detector: "d1", dedupeKey: "k1", severity: "warn" }));
    const firstSeen = FINDINGS[0].lastSeenAt;
    await new Promise((r) => setTimeout(r, 2));
    await recordFinding(
      baseFinding({ detector: "d1", dedupeKey: "k1", severity: "critical", detail: "worse" }),
    );
    expect(FINDINGS).toHaveLength(1);
    expect(FINDINGS[0].severity).toBe("critical");
    expect(FINDINGS[0].detail).toBe("worse");
    expect(FINDINGS[0].lastSeenAt.getTime()).toBeGreaterThanOrEqual(firstSeen.getTime());
  });

  it("treats a different dedupe_key as a distinct finding", async () => {
    await recordFinding(baseFinding({ detector: "d1", dedupeKey: "k1" }));
    await recordFinding(baseFinding({ detector: "d1", dedupeKey: "k2" }));
    expect(FINDINGS).toHaveLength(2);
  });

  it("re-opens a resolved finding when it fires again", async () => {
    await recordFinding(baseFinding({ detector: "d1", dedupeKey: "k1" }));
    await resolveFinding(FINDINGS[0].id);
    expect(FINDINGS[0].status).toBe("resolved");
    await recordFinding(baseFinding({ detector: "d1", dedupeKey: "k1" }));
    expect(FINDINGS[0].status).toBe("open");
    expect(FINDINGS[0].resolvedAt).toBeNull();
  });

  it("keeps an acknowledged finding acknowledged on re-fire", async () => {
    await recordFinding(baseFinding({ detector: "d1", dedupeKey: "k1" }));
    await acknowledgeFinding(FINDINGS[0].id);
    expect(FINDINGS[0].status).toBe("acknowledged");
    await recordFinding(baseFinding({ detector: "d1", dedupeKey: "k1" }));
    expect(FINDINGS[0].status).toBe("acknowledged");
  });
});

// ── staleFindings sweep ──────────────────────────────────────────────────────

describe("staleFindings", () => {
  it("marks open findings unseen past the cutoff as stale, leaves fresh + acknowledged alone", async () => {
    // stale candidate
    await recordFinding(baseFinding({ detector: "d1", dedupeKey: "old" }));
    FINDINGS[0].lastSeenAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    // fresh open
    await recordFinding(baseFinding({ detector: "d1", dedupeKey: "fresh" }));
    // acknowledged + old → must be left alone
    await recordFinding(baseFinding({ detector: "d1", dedupeKey: "ack" }));
    const ackRow = FINDINGS.find((f) => f.dedupeKey === "ack")!;
    ackRow.lastSeenAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await acknowledgeFinding(ackRow.id);

    const n = await staleFindings(7);
    expect(n).toBe(1);
    expect(FINDINGS.find((f) => f.dedupeKey === "old")!.status).toBe("stale");
    expect(FINDINGS.find((f) => f.dedupeKey === "fresh")!.status).toBe("open");
    expect(FINDINGS.find((f) => f.dedupeKey === "ack")!.status).toBe("acknowledged");
  });
});

// ── runDomainAudits isolation ────────────────────────────────────────────────

describe("runDomainAudits — isolation", () => {
  it("one throwing detector does not break the others", async () => {
    const good: DomainDetector = {
      id: "good",
      domain: "finance",
      run: async () => [baseFinding({ detector: "good", dedupeKey: "g" })],
    };
    const bad: DomainDetector = {
      id: "bad",
      domain: "future",
      run: async () => {
        throw new Error("boom");
      },
    };
    const result = await runDomainAudits([bad, good]);
    expect(result.detectorsRun).toBe(2);
    expect(result.detectorsFailed).toBe(1);
    expect(result.findingsRecorded).toBe(1);
    expect(result.failures[0].detector).toBe("bad");
    expect(FINDINGS).toHaveLength(1);
    expect(FINDINGS[0].detector).toBe("good");
  });
});

// ── taxReserveDetector ───────────────────────────────────────────────────────

describe("taxReserveDetector", () => {
  async function loadDetector() {
    // Stub the trailing-12mo revenue query by mocking the select chain result.
    // The detector sums financial_ledger; our select mock returns FINDINGS by
    // default, so we override the module's revenue path via getBucketBalance +
    // a spy on db.select for the ledger sum. Simpler: re-mock db.select for
    // ledger to return [{ total: revenueCents }].
    const dbMod = await import("../../server/db");
    (dbMod.db as any).select = (_sel?: unknown) => {
      const step: any = {
        from: () => step,
        where: () => step,
        then: (onF: any, onR: any) =>
          Promise.resolve([{ total: LEDGER.revenueCents }]).then(onF, onR),
      };
      return step;
    };
    const { taxReserveDetector } = await import(
      "../../server/services/audit/detectors/taxReserveDetector"
    );
    return taxReserveDetector;
  }

  it("is green at zero revenue (no tax liability to reserve)", async () => {
    LEDGER.revenueCents = 0;
    LEDGER.taxBucketCents = 0;
    const det = await loadDetector();
    expect(await det.run()).toEqual([]);
  });

  it("is green when the bucket meets the 25% floor", async () => {
    LEDGER.revenueCents = 100_000; // $1,000
    LEDGER.taxBucketCents = 30_000; // $300 ≥ 25% floor ($250)
    const det = await loadDetector();
    expect(await det.run()).toEqual([]);
  });

  it("warns when the bucket is positive but below the 25% floor", async () => {
    LEDGER.revenueCents = 100_000; // $1,000 → floor $250
    LEDGER.taxBucketCents = 10_000; // $100 < $250
    const det = await loadDetector();
    const out = await det.run();
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("warn");
    expect(out[0].dedupeKey).toBe("tax_reserve:underfunded");
    expect(out[0].domain).toBe("finance");
  });

  it("is critical when the bucket is empty while revenue exists", async () => {
    LEDGER.revenueCents = 100_000;
    LEDGER.taxBucketCents = 0;
    const det = await loadDetector();
    const out = await det.run();
    expect(out[0].severity).toBe("critical");
  });
});

// ── observationRateDetector ──────────────────────────────────────────────────

describe("observationRateDetector", () => {
  async function loadDetector() {
    // The detector issues two COUNT(*) queries (last24h, then priorWeek). We
    // serve them in order from OBS.
    const dbMod = await import("../../server/db");
    let call = 0;
    (dbMod.db as any).select = (_sel?: unknown) => {
      const n = call === 0 ? OBS.last24h : OBS.priorWeek;
      call += 1;
      const step: any = {
        from: () => step,
        where: () => step,
        then: (onF: any, onR: any) =>
          Promise.resolve([{ n }]).then(onF, onR),
      };
      return step;
    };
    const { observationRateDetector } = await import(
      "../../server/services/audit/detectors/observationRateDetector"
    );
    return observationRateDetector;
  }

  it("is silent when there is no prior-week traffic (fresh cluster)", async () => {
    OBS.last24h = 0;
    OBS.priorWeek = 0;
    const det = await loadDetector();
    expect(await det.run()).toEqual([]);
  });

  it("is silent while still observing", async () => {
    OBS.last24h = 5;
    OBS.priorWeek = 50;
    const det = await loadDetector();
    expect(await det.run()).toEqual([]);
  });

  it("warns on a stall (prior traffic, 0 in last 24h)", async () => {
    OBS.last24h = 0;
    OBS.priorWeek = 20;
    const det = await loadDetector();
    const out = await det.run();
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("warn");
    expect(out[0].dedupeKey).toBe("observation_rate:stalled");
    expect(out[0].domain).toBe("future");
  });

  it("is critical on a high-volume stall", async () => {
    OBS.last24h = 0;
    OBS.priorWeek = 500; // >= 100 high-volume threshold
    const det = await loadDetector();
    const out = await det.run();
    expect(out[0].severity).toBe("critical");
  });
});
