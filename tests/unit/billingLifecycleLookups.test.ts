/**
 * Billing/lifecycle lookups: founder digest MRR, in-app trial cohort, quiet
 * paying customers, and the trial allowance on cost-bearing actions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

// Reads the repository tree; the sweep budget, not the 30s default.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
const src = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

// ─── 2. founder digest ───────────────────────────────────────────────────────
describe("founder digest MRR", () => {
  const S = vi.hoisted(() => ({ inserted: [] as any[], snapshot: null as null | { mrrCents: number } }));

  vi.mock("../../server/utils/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }));
  vi.mock("../../server/services/finance/runwayModel", () => ({
    liveMrrDetail: vi.fn(async () => ({ cents: 123_400, payingOrgs: 3 })),
  }));
  vi.mock("../../server/services/founder", () => ({ getFounderEmails: () => [] }));
  vi.mock("../../server/services/emailService", () => ({ emailService: { sendEmail: vi.fn() } }));
  vi.mock("../../server/utils/openaiClient", () => ({
    requireOpenAIClient: () => ({
      chat: { completions: { create: async () => ({ choices: [{ message: { content: "{}" } }] }) } },
    }),
  }));
  vi.mock("../../server/db", () => {
    const chain = (rows: any[]): any =>
      new Proxy({}, {
        get: (_t, prop) => {
          if (prop === "then") return (res: any) => res(rows);
          return () => chain(rows);
        },
      });
    return {
      db: {
        select: (cols?: any) => (cols && "mrrCents" in cols ? chain(S.snapshot ? [S.snapshot] : []) : chain([{ c: 0, total: 0 }])),
        insert: () => ({ values: (v: any) => { S.inserted.push(v); return chain([{ id: 1 }]); } }),
        update: () => chain([]),
        query: {
          decisionsInboxItems: { findFirst: async () => undefined },
          organizations: { findFirst: async () => undefined },
          churnRiskScores: { findFirst: async () => undefined },
          founderDigestHistory: { findMany: async () => [] },
        },
      },
    };
  });

  beforeEach(() => { S.inserted.length = 0; S.snapshot = null; });

  it("reports MRR from the canonical source, never from a column organizations lacks", async () => {
    const { founderDigestService } = await import("../../server/services/founderDigest");
    await founderDigestService.generate();
    const row = S.inserted.find((r) => "dataSnapshot" in r);
    expect(row.mrrCents).toBe(123_400);
    expect(row.dataSnapshot.mrrCents).toBe(123_400);
  });

  it("does not pretend last month equals this month", async () => {
    const { founderDigestService } = await import("../../server/services/founderDigest");
    await founderDigestService.generate();
    expect(S.inserted.find((r) => "dataSnapshot" in r).dataSnapshot.mrrLastMonthCents).toBeNull();
    S.inserted.length = 0;
    S.snapshot = { mrrCents: 99_000 };
    await founderDigestService.generate();
    expect(S.inserted.find((r) => "dataSnapshot" in r).dataSnapshot.mrrLastMonthCents).toBe(99_000);
  });

  it("source never reads a monthly_price_cents column", () => {
    expect(src("server/services/founderDigest.ts")).not.toMatch(/monthly_price_cents|monthlyPriceCents/);
  });
});

// ─── 3. in-app trial cohort ──────────────────────────────────────────────────
describe("trial engine cohort", () => {
  it("both cohorts render a predicate that admits an active free-tier in-app trial", async () => {
    vi.resetModules();
    const captured: any[] = [];
    vi.doMock("../../server/db", () => ({
      db: {
        select: () => ({ from: () => ({ where: (w: any) => { captured.push(w); return Promise.resolve([]); } }) }),
      },
    }));
    vi.doMock("../../server/utils/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    const { runTrialExpiryCycle } = await import("../../server/services/trialEngine");
    await runTrialExpiryCycle();
    expect(captured.length).toBeGreaterThanOrEqual(2);
    const dialect = new PgDialect();
    for (const w of captured) {
      const { sql: text, params } = dialect.sqlToQuery(w);
      // active + free tier + no Stripe subscription = the in-app trial shape
      expect(text).toMatch(/"subscription_status" = \$\d+/);
      expect(text).toMatch(/"subscription_tier" = \$\d+/);
      expect(text).toMatch(/"stripe_subscription_id" is null/i);
      expect(params).toContain("active");
      expect(params).toContain("free");
    }
  });
});

// ─── 4. quiet paying customer ────────────────────────────────────────────────
describe("churn engine quiet payer", () => {
  it("documents a threshold below the weighted-score alert and emits a churn_signal", () => {
    const s = src("server/services/churnEngine.ts");
    expect(s).toMatch(/QUIET_PAYER_DAYS\s*=\s*14/);
    expect(s).toMatch(/recordSense\(\s*"churn_signal"/);
    expect(s).toMatch(/risk >= ALERT_RISK_THRESHOLD \|\| quietPayer/);
  });
});

// ─── trial allowance on cost-bearing actions ─────────────────────────────────
describe("every hasEnoughCredits caller is classified", () => {
  // class "allowance": cheap compute; the trial allowance may fund it, and the
  //   charge path RECORDS trial-funded usage (usageMeteringService.recordUsage
  //   or deductOrFundFromTrial) so the cap shrinks.
  // class "own-credit": real physical/third-party money; only the org's own
  //   balance may pay.
  const CLASSIFIED: Record<string, "allowance" | "own-credit"> = {
    "server/routes-documents.ts": "allowance",
    "server/routes-properties.ts": "allowance",
    "server/routes-realtime.ts": "allowance",
    "server/routes-deals.ts": "allowance",
    "server/routes-ai.ts": "allowance",
    "server/utils/openaiClient.ts": "allowance",
    "server/services/directMailService.ts": "own-credit",
  };

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  }
  const callers = walk(path.join(ROOT, "server"))
    .map((f) => path.relative(ROOT, f))
    .filter((f) => f !== "server/services/credits.ts")
    .filter((f) => /\.hasEnough(Own)?Credits\(/.test(src(f)));

  it("the population is the classified set (a new caller must be classified)", () => {
    expect(callers.sort()).toEqual(Object.keys(CLASSIFIED).sort());
  });

  for (const [file, cls] of Object.entries(CLASSIFIED)) {
    it(`${file} (${cls})`, () => {
      const s = src(file);
      if (cls === "own-credit") {
        expect(s).toMatch(/\.hasEnoughOwnCredits\(/);
        expect(s).not.toMatch(/\.hasEnoughCredits\(/);
      } else {
        // never a bare deductCredits after the allowance gate
        expect(s).not.toMatch(/\.deductCredits\(/);
        expect(s).toMatch(/\.recordUsage\(|\.deductOrFundFromTrial\(/);
      }
    });
  }
});

describe("campaign sends never bill a simulated send", () => {
  it("sms and email chargeable flags exclude simulation", () => {
    const s = src("server/routes-campaigns.ts");
    const flags = s.match(/const chargeable = [^;]+;/g) ?? [];
    expect(flags.length).toBe(2);
    for (const f of flags) expect(f).toMatch(/!simulated/);
  });
});

describe("limit copy", () => {
  it("creditPool points at Settings → Usage & Credits, not a Usage page", () => {
    const raw = fs.readFileSync(path.join(ROOT, "server/services/creditPool.ts"), "utf8");
    expect(raw).not.toMatch(/on the Usage page/);
    expect(raw).toMatch(/Settings → Usage & Credits/);
  });
});
