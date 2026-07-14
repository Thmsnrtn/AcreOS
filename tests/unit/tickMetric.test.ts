/**
 * Tick metric — kernel-restructure step 5 (founder directive 2026-07-13).
 *
 * Pins the two numbers every cycle opens with:
 *   (a) customer-visible/revenue-relevant outcomes shipped this week —
 *       completed outward dispatches only (internal review/debug machinery
 *       excluded), with the breakdown honest about what is NOT counted.
 *   (b) founder decisions consumed vs. the CONSTITUTIONAL budget —
 *       escalated cascade resolutions + founder overrides, trailing 7 days
 *       only, budget read from the sovereign-protocol immutables loader.
 *   (c) verification COVERAGE (Jarvis Phase 1 CP4) — passed verdicts over
 *       everything that entered the verify pipeline this week: completed
 *       dispatches with a review_status, completed imports and sent mail
 *       with a verify_status.
 *
 * Honesty invariants: empty tables read as a genuine zero (never inflated,
 * never hidden), the zero-shipped breakdown still names the blind spots,
 * "verified: 0/0" says so explicitly, and a genuine read failure makes the
 * whole metric THROW so callers render "unmeasured" — never a fabricated 0.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory row stores per table. Tests seed these; the db mock returns them
// verbatim (WHERE clauses are ignored) so the service's own in-process
// window/status filtering is what the assertions pin.
// ---------------------------------------------------------------------------

const STORES = {
  dispatches: [] as Array<{
    status: string;
    sourceType: string;
    completedAt: Date | null;
    reviewStatus?: string | null;
  }>,
  cascades: [] as Array<{ founderEscalated: boolean; createdAt: Date }>,
  overrides: [] as Array<{ createdAt: Date }>,
  imports: [] as Array<{
    status: string;
    verifyStatus: string | null;
    completedAt: Date | null;
  }>,
  mail: [] as Array<{
    status: string;
    verifyStatus: string | null;
    sentAt: Date | null;
  }>,
};

// Tables whose read should throw — pins the honesty contract that a genuine
// read failure makes the whole metric throw (callers render "unmeasured").
const FAIL_TABLES = new Set<string>();

vi.mock("../../server/db", () => {
  const tableName = (tableLike: any): string | null => {
    if (!tableLike) return null;
    const sym = Object.getOwnPropertySymbols(tableLike).find((s) =>
      String(s).includes("Name"),
    );
    if (sym && typeof tableLike[sym] === "string") return tableLike[sym];
    return null;
  };

  const buildSelectChain = () => {
    const chain: any = {
      _table: null as string | null,
      from(t: any) {
        this._table = tableName(t);
        return this;
      },
      where(_w: any) {
        return this;
      },
      then(onFulfilled: (rows: any[]) => any, onRejected?: (e: any) => any) {
        return Promise.resolve(this._execute()).then(onFulfilled, onRejected);
      },
      _execute(): any[] {
        if (this._table && FAIL_TABLES.has(this._table)) {
          throw new Error(`simulated read failure: ${this._table}`);
        }
        if (this._table === "solene_dispatch_queue") return [...STORES.dispatches];
        if (this._table === "cascade_resolutions") return [...STORES.cascades];
        if (this._table === "founder_overrides") return [...STORES.overrides];
        if (this._table === "import_jobs") return [...STORES.imports];
        if (this._table === "mail_shipments") return [...STORES.mail];
        return [];
      },
    };
    return chain;
  };

  return { db: { select: (_proj?: any) => buildSelectChain() } };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// founderNarrative pulls the model router at module load — stub it so the
// pure openWithTickMetric helper can be imported without a model client.
vi.mock("../../server/services/aiRouter", () => ({
  routeCriticalTask: vi.fn(),
}));

import { getTickMetric, renderTickMetricLine } from "../../server/services/solene/tickMetric";
import { openWithTickMetric } from "../../server/services/founderNarrative";
import { FOUNDER_MINUTES_BUDGET } from "@sovereign/immutables";

const NOW = new Date("2026-07-13T12:00:00Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

beforeEach(() => {
  STORES.dispatches.length = 0;
  STORES.cascades.length = 0;
  STORES.overrides.length = 0;
  STORES.imports.length = 0;
  STORES.mail.length = 0;
  FAIL_TABLES.clear();
  vi.clearAllMocks();
});

describe("getTickMetric", () => {
  it("honest zeros: empty tables read 0 shipped / 0 decisions — and the breakdown still names the blind spots", async () => {
    const m = await getTickMetric(NOW);

    expect(m.revenueRelevantShippedThisWeek).toBe(0);
    expect(m.founderDecisionsThisWeek).toBe(0);
    expect(m.shippedBreakdown).toContain("no completed outward dispatches");
    expect(m.shippedBreakdown).toContain("deploys and merged PRs not counted yet");
    // CP4 honest zero: nothing entered the verify pipeline → an explicit 0/0.
    expect(m.verifiedPassed).toBe(0);
    expect(m.verifiedFlagged).toBe(0);
    expect(m.verifiablesTotal).toBe(0);
    expect(m.verificationBreakdown).toBe("nothing verifiable this week");
  });

  it("budget comes from the constitution loader (5), never a local constant", async () => {
    const m = await getTickMetric(NOW);

    expect(m.founderDecisionsBudget).toBe(5);
    expect(m.founderDecisionsBudget).toBe(FOUNDER_MINUTES_BUDGET.classABDecisionsPerWeek);
    expect(m.budgetSource).toBe("constitution");
  });

  it("decisions are counted in the trailing-7-day window only (escalations + overrides)", async () => {
    STORES.cascades.push(
      { founderEscalated: true, createdAt: daysAgo(1) }, // counted
      { founderEscalated: true, createdAt: daysAgo(6) }, // counted
      { founderEscalated: true, createdAt: daysAgo(8) }, // outside window
      { founderEscalated: false, createdAt: daysAgo(1) }, // resolved without founder
    );
    STORES.overrides.push(
      { createdAt: daysAgo(2) }, // counted
      { createdAt: daysAgo(10) }, // outside window
    );

    const m = await getTickMetric(NOW);
    expect(m.founderDecisionsThisWeek).toBe(3);
  });

  it("shipped counts completed outward dispatches this week; internal machinery and stale/unfinished rows do not count", async () => {
    STORES.dispatches.push(
      { status: "completed", sourceType: "auto_dispatch", completedAt: daysAgo(1) }, // counted
      { status: "completed", sourceType: "founder_manual", completedAt: daysAgo(3) }, // counted
      { status: "completed", sourceType: "detector", completedAt: daysAgo(6) }, // counted
      // Internal machinery — improves the machine, not the customer.
      { status: "completed", sourceType: "code_review", completedAt: daysAgo(1) },
      { status: "completed", sourceType: "self_debug", completedAt: daysAgo(1) },
      { status: "completed", sourceType: "adversarial_test", completedAt: daysAgo(1) },
      // Not shipped: failed / still running / outside the window.
      { status: "failed", sourceType: "auto_dispatch", completedAt: daysAgo(1) },
      { status: "in_progress", sourceType: "auto_dispatch", completedAt: null },
      { status: "completed", sourceType: "auto_dispatch", completedAt: daysAgo(8) },
    );

    const m = await getTickMetric(NOW);
    expect(m.revenueRelevantShippedThisWeek).toBe(3);
    expect(m.shippedBreakdown).toContain("3 completed outward dispatches");
    expect(m.shippedBreakdown).toContain("internal review/debug machinery excluded");
    expect(m.shippedBreakdown).toContain("deploys and merged PRs not counted yet");
  });

  it("verification coverage counts per component: dispatch review_status + import/mail verify_status", async () => {
    STORES.dispatches.push(
      // Verifiable: completed + a review_status of any kind. Only 'passed'
      // counts toward N; pending/skipped/flagged honestly dilute coverage.
      { status: "completed", sourceType: "auto_dispatch", completedAt: daysAgo(1), reviewStatus: "passed" },
      { status: "completed", sourceType: "auto_dispatch", completedAt: daysAgo(2), reviewStatus: "flagged" },
      { status: "completed", sourceType: "auto_dispatch", completedAt: daysAgo(3), reviewStatus: "pending" },
      { status: "completed", sourceType: "auto_dispatch", completedAt: daysAgo(4), reviewStatus: "skipped" },
      // NOT verifiable: never entered the pipeline (null review_status),
      // or never completed at all.
      { status: "completed", sourceType: "auto_dispatch", completedAt: daysAgo(1), reviewStatus: null },
      { status: "failed", sourceType: "auto_dispatch", completedAt: daysAgo(1), reviewStatus: "passed" },
    );
    STORES.imports.push(
      { status: "completed", verifyStatus: "passed", completedAt: daysAgo(1) }, // counted
      { status: "completed", verifyStatus: "flagged", completedAt: daysAgo(2) }, // total only
      { status: "completed", verifyStatus: null, completedAt: daysAgo(1) }, // no verify enqueued
      { status: "running", verifyStatus: "pending", completedAt: null }, // not completed
    );
    STORES.mail.push(
      { status: "sent", verifyStatus: "passed", sentAt: daysAgo(1) }, // counted
      { status: "sent", verifyStatus: "flagged", sentAt: daysAgo(3) }, // total only
      { status: "sent", verifyStatus: null, sentAt: daysAgo(1) }, // no verify enqueued
      { status: "queued", verifyStatus: null, sentAt: null }, // never sent
    );

    const m = await getTickMetric(NOW);
    expect(m.verifiedPassed).toBe(3); // 1 dispatch + 1 import + 1 mail
    expect(m.verifiedFlagged).toBe(3);
    expect(m.verifiablesTotal).toBe(8); // 4 dispatches + 2 imports + 2 mail
    expect(m.verificationBreakdown).toBe(
      "dispatches 1/4 passed, imports 1/2 passed, mail 1/2 passed; 3 flagged; " +
        "work that never entered the verify pipeline is not counted",
    );
  });

  it("verification coverage applies the same trailing-7-day window per component", async () => {
    STORES.dispatches.push(
      { status: "completed", sourceType: "auto_dispatch", completedAt: daysAgo(6), reviewStatus: "passed" }, // counted
      { status: "completed", sourceType: "auto_dispatch", completedAt: daysAgo(8), reviewStatus: "passed" }, // outside window
    );
    STORES.imports.push(
      { status: "completed", verifyStatus: "passed", completedAt: daysAgo(6) }, // counted
      { status: "completed", verifyStatus: "passed", completedAt: daysAgo(10) }, // outside window
    );
    STORES.mail.push(
      { status: "sent", verifyStatus: "passed", sentAt: daysAgo(6) }, // counted
      { status: "sent", verifyStatus: "passed", sentAt: daysAgo(8) }, // outside window
    );

    const m = await getTickMetric(NOW);
    expect(m.verifiedPassed).toBe(3);
    expect(m.verifiablesTotal).toBe(3);
    expect(m.verificationBreakdown).toContain("dispatches 1/1 passed");
    expect(m.verificationBreakdown).toContain("imports 1/1 passed");
    expect(m.verificationBreakdown).toContain("mail 1/1 passed");
  });

  it("a component with nothing verifiable is named honestly, not dropped", async () => {
    STORES.dispatches.push({
      status: "completed",
      sourceType: "auto_dispatch",
      completedAt: daysAgo(1),
      reviewStatus: "passed",
    });

    const m = await getTickMetric(NOW);
    expect(m.verifiablesTotal).toBe(1);
    expect(m.verificationBreakdown).toBe(
      "dispatches 1/1 passed, imports 0 verifiable, mail 0 verifiable; " +
        "work that never entered the verify pipeline is not counted",
    );
  });

  it("HONESTY: a read failure on ANY coverage table makes the whole metric throw — never a fabricated number", async () => {
    for (const table of ["solene_dispatch_queue", "import_jobs", "mail_shipments"]) {
      FAIL_TABLES.clear();
      FAIL_TABLES.add(table);
      await expect(getTickMetric(NOW)).rejects.toThrow(`simulated read failure: ${table}`);
    }
  });
});

describe("renderTickMetricLine", () => {
  it("renders the canonical opener — shipped, decisions, and verified: N/M", async () => {
    STORES.dispatches.push({
      status: "completed",
      sourceType: "auto_dispatch",
      completedAt: daysAgo(1),
      reviewStatus: "passed",
    });
    STORES.imports.push({ status: "completed", verifyStatus: "passed", completedAt: daysAgo(2) });
    STORES.cascades.push({ founderEscalated: true, createdAt: daysAgo(1) });
    STORES.overrides.push({ createdAt: daysAgo(2) });

    const line = renderTickMetricLine(await getTickMetric(NOW));
    expect(line).toBe(
      "Shipped for customers this week: 1 (1 completed outward dispatch; internal review/debug machinery excluded; deploys and merged PRs not counted yet). " +
        "Founder decisions consumed: 2 of 5 budget. " +
        "Verified: 2/2 (dispatches 1/1 passed, imports 1/1 passed, mail 0 verifiable; work that never entered the verify pipeline is not counted).",
    );
  });

  it("honest zero renders as a real 0, with the blind spots named", async () => {
    const line = renderTickMetricLine(await getTickMetric(NOW));
    expect(line).toContain("Shipped for customers this week: 0 (no completed outward dispatches");
    expect(line).toContain("Founder decisions consumed: 0 of 5 budget.");
    // CP4 honest zero: coverage of an empty pipeline is 0/0, said out loud.
    expect(line).toContain("Verified: 0/0 (nothing verifiable this week).");
  });
});

describe("openWithTickMetric — The Letter opens with the two numbers", () => {
  const METRIC_LINE =
    "Shipped for customers this week: 2 (2 completed outward dispatches; internal review/debug machinery excluded; deploys and merged PRs not counted yet). Founder decisions consumed: 1 of 5 budget. Verified: 1/2 (dispatches 1/2 passed, imports 0 verifiable, mail 0 verifiable; work that never entered the verify pipeline is not counted).";

  it("injects the metric line as the first content line after the title", () => {
    const md =
      "# Founder letter — June 2026\n\n**Green month.**\n\n## What I did this month\n- thing";
    const out = openWithTickMetric(md, METRIC_LINE);
    const content = out.split("\n").filter((l) => l.trim() !== "");
    expect(content[0]).toBe("# Founder letter — June 2026");
    expect(content[1]).toBe(METRIC_LINE);
    expect(content[2]).toBe("**Green month.**");
  });

  it("prepends the metric line when the markdown has no title", () => {
    const out = openWithTickMetric("Just prose, no heading.", METRIC_LINE);
    expect(out.startsWith(METRIC_LINE)).toBe(true);
    expect(out).toContain("Just prose, no heading.");
  });
});
