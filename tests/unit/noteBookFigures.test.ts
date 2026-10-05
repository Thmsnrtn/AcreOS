/**
 * W10.2b audit — book-wide note money figures come from the whole book.
 *
 * The note personas' widgets (the map strip and the dashboard sets) summed
 * GET /api/notes — the capped newest-5,000 list kept as the table payload —
 * into "outstanding", "monthly income", "financed", a balance-weighted rate
 * and "most delinquent". Past 5,000 notes every one of those was wrong.
 * They now read GET /api/notes/book-figures, one SQL aggregate over the
 * org's active notes (server/storage/noteBookFigures.ts). Held here:
 *   - the statements are org-bound and status-filtered, with no LIMIT on the
 *     aggregate, and the population matches /api/notes (no sample filter);
 *   - each figure is the client's own arithmetic, in SQL;
 *   - the route is mounted, before /api/notes/:id;
 *   - the widgets render the endpoint's figure — not a sum of a list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, sql, type SQL } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

type Recorded = {
  fields?: Record<string, unknown>;
  from?: unknown;
  where?: unknown;
  orderBy: unknown[];
  joins: Array<{ table: unknown; on: unknown }>;
  limit?: number;
};
const rec = vi.hoisted(() => ({ queries: [] as any[], answers: [] as unknown[][] }));

vi.mock("../../server/db", () => ({
  db: {
    select: (fields?: Record<string, unknown>) => {
      const q: any = { fields, orderBy: [], joins: [] };
      rec.queries.push(q);
      const chain: any = {
        from: (t: unknown) => ((q.from = t), chain),
        where: (w: unknown) => ((q.where = w), chain),
        leftJoin: (table: unknown, on: unknown) => (q.joins.push({ table, on }), chain),
        orderBy: (...o: unknown[]) => (q.orderBy.push(...o), chain),
        limit: (n: number) => ((q.limit = n), chain),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(rec.answers.shift() ?? []).then(res, rej),
      };
      return chain;
    },
  },
}));

import { noteBookFigures } from "../../server/storage/noteBookFigures";
import { originationWindow, resolveTimeZone } from "../../server/storage/zonedMonths";

const ORG = 7;
const NOW = new Date("2026-10-05T12:00:00Z");
const DAY = 86_400_000;
const dialect = new PgDialect();
const render = (s: unknown) => dialect.sqlToQuery(sql`${s}` as SQL);
const queries = () => rec.queries as Recorded[];

function expectOrgBound(where: unknown, tbl: string) {
  const w = render(where);
  const m = w.sql.match(new RegExp(`"${tbl}"\\."organization_id" = \\$(\\d+)`));
  expect(m, `no "${tbl}"."organization_id" predicate in: ${w.sql}`).not.toBeNull();
  expect(w.params[Number(m![1]) - 1]).toBe(ORG);
}
function expectActive(where: unknown) {
  const w = render(where);
  const m = w.sql.match(/"notes"\."status" = \$(\d+)/);
  expect(m, w.sql).not.toBeNull();
  expect(w.params[Number(m![1]) - 1]).toBe("active");
}

beforeEach(() => {
  rec.queries.length = 0;
  rec.answers.length = 0;
});

describe("noteBookFigures — one aggregate over the org's active notes", () => {
  it("canary: the org check fails on another org or none", () => {
    expect(() => expectOrgBound(sql`"notes"."organization_id" = ${99}`, "notes")).toThrow();
    expect(() => expectOrgBound(sql`"notes"."status" = 'active'`, "notes")).toThrow();
  });

  it("the aggregate is org-bound, active-only, unlimited, and carries no sample filter (same population as /api/notes)", async () => {
    await noteBookFigures(ORG, NOW);
    const agg = queries().find((q) => q.fields && "activeCount" in q.fields)!;
    expect(agg).toBeDefined();
    expect(getTableName(agg.from as never)).toBe("notes");
    expectOrgBound(agg.where, "notes");
    expectActive(agg.where);
    expect(agg.limit).toBeUndefined();
    expect(agg.joins).toEqual([]);
    expect(render(agg.where).sql).not.toMatch(/sample/i);
  });

  it("each figure is the client's arithmetic in SQL", async () => {
    await noteBookFigures(ORG, NOW);
    const f = queries().find((q) => q.fields && "activeCount" in q.fields)!.fields!;
    const s = (k: string) => render(f[k]).sql;
    expect(s("activeCount")).toBe("count(*)");
    expect(s("totalOutstanding")).toBe('coalesce(sum("notes"."current_balance"), 0)');
    expect(s("totalMonthly")).toBe('coalesce(sum("notes"."monthly_payment"), 0)');
    // `originalPrincipal || currentBalance || 0`: original_principal is a NOT
    // NULL numeric (a string client-side, truthy even at "0"), so coalesce
    // picks exactly what the || chain picked.
    expect(s("totalFinanced")).toBe('coalesce(sum(coalesce("notes"."original_principal", "notes"."current_balance", 0)), 0)');
    expect(s("rateWeightedBalance")).toBe(
      'sum("notes"."current_balance" * "notes"."interest_rate") filter (where "notes"."current_balance" > 0 and "notes"."interest_rate" > 0)',
    );
    expect(s("rateWeight")).toBe('sum("notes"."current_balance") filter (where "notes"."current_balance" > 0 and "notes"."interest_rate" > 0)');
    expect(s("averageRate")).toBe('avg("notes"."interest_rate") filter (where "notes"."interest_rate" > 0)');
    expect(s("averageTermMonths")).toBe('avg("notes"."term_months") filter (where "notes"."term_months" > 0)');
    expect(s("totalServiceFees")).toBe('coalesce(sum("notes"."service_fee"), 0)');
    expect(s("taxEscrowCount")).toBe('count(*) filter (where "notes"."tax_escrow_enabled")');
    const d = render(f.delinquentCount);
    expect(d.sql).toMatch(/coalesce\("notes"\."delinquency_status", ''\) not in \('', 'current'\) or "notes"\."next_payment_date" <= \$1/);
    // A whole day late (the client's floor(days) > 0), bound as UTC ISO.
    expect(d.params).toEqual([new Date(NOW.getTime() - DAY).toISOString()]);
  });

  it("figures come back as numbers; the weighted rate is null when nothing carries a rate and a balance", async () => {
    rec.answers.push(
      [
        {
          activeCount: 6200,
          totalOutstanding: "12500000.50",
          totalMonthly: "310000.25",
          totalFinanced: "15000000",
          rateWeightedBalance: "112500004.5",
          rateWeight: "12500000.50",
          averageRate: "8.75",
          averageTermMonths: "119.6",
          delinquentCount: 41,
          totalServiceFees: "1200",
          taxEscrowCount: 300,
        },
      ],
      [],
    );
    const out = await noteBookFigures(ORG, NOW);
    expect(out).toMatchObject({
      activeCount: 6200,
      totalOutstanding: 12500000.5,
      totalMonthly: 310000.25,
      totalFinanced: 15000000,
      averageRate: 8.75,
      averageTermMonths: 119.6,
      delinquentCount: 41,
      totalServiceFees: 1200,
      taxEscrowCount: 300,
      mostDelinquent: null,
    });
    expect(out.weightedRate).toBeCloseTo(112500004.5 / 12500000.5, 10);

    rec.answers.push([{ activeCount: 2, totalOutstanding: "0", totalMonthly: "0", totalFinanced: "0", rateWeightedBalance: null, rateWeight: null, averageRate: null, averageTermMonths: null, delinquentCount: 0, totalServiceFees: "0", taxEscrowCount: 0 }], []);
    const none = await noteBookFigures(ORG, NOW);
    expect(none.weightedRate).toBeNull();
    expect(none.averageRate).toBeNull();
    expect(none.averageTermMonths).toBeNull();

    // A zero weight is no yield either — never a division by zero.
    rec.answers.push([{ activeCount: 1, rateWeightedBalance: "0", rateWeight: "0" }], []);
    expect((await noteBookFigures(ORG, NOW)).weightedRate).toBeNull();
  });

  it("most delinquent: a whole day late or more, oldest due date first, LIMIT 1 — days late as the client counted them", async () => {
    const due = new Date(NOW.getTime() - 9 * DAY - 3_600_000); // 9 days and an hour
    rec.answers.push([{ activeCount: 1 }], [{ id: 42, borrowerId: 5, nextPaymentDate: due, borrowerFirstName: "Ada", borrowerLastName: "Lovelace" }]);
    const out = await noteBookFigures(ORG, NOW);
    expect(out.mostDelinquent).toEqual({
      id: 42,
      borrowerId: 5,
      borrowerName: "Ada Lovelace",
      nextPaymentDate: due.toISOString(),
      daysLate: 9,
    });
    const worst = queries().find((q) => q.limit !== undefined)!;
    expect(getTableName(worst.from as never)).toBe("notes");
    expectOrgBound(worst.where, "notes");
    expectActive(worst.where);
    const w = render(worst.where);
    expect(w.sql).toMatch(/"notes"\."next_payment_date" <= \$\d+/);
    expect(w.params).toContain(new Date(NOW.getTime() - DAY).toISOString());
    expect(render(sql.join(worst.orderBy as SQL[], sql`, `)).sql).toBe(
      '"notes"."next_payment_date" asc, "notes"."created_at" desc, "notes"."id" desc',
    );
    expect(worst.limit).toBe(1);
    // The borrower's name: this org's live lead only.
    expect(worst.joins).toHaveLength(1);
    expect(getTableName(worst.joins[0].table as never)).toBe("leads");
    expectOrgBound(worst.joins[0].on, "leads");
    expect(render(worst.joins[0].on).sql).toMatch(/"leads"\."id" = "notes"\."borrower_id"/);
    expect(render(worst.joins[0].on).sql).toMatch(/"leads"\."deleted_at" is null/);
  });

  it("an unnamed borrower stays unnamed (no invented name)", async () => {
    rec.answers.push([{ activeCount: 1 }], [{ id: 43, borrowerId: null, nextPaymentDate: new Date(NOW.getTime() - 2 * DAY), borrowerFirstName: null, borrowerLastName: null }]);
    expect((await noteBookFigures(ORG, NOW)).mostDelinquent).toMatchObject({ id: 43, borrowerName: null, daysLate: 2 });
  });
});

// ── The Finance hero's figures (W10.2b audit, P1) ──────────────────────────
// PersonaFinanceHero summed the capped /api/notes list (via
// personaFinanceMetrics) into capital deployed, weighted rate/term, notes
// written, a 12-month origination strip, escrow, serviced UPB, fee income,
// book yield and forecast inflow. Each is now SQL over the whole book, with
// the population the old JS used: the originator's and escrow figures over
// EVERY note (any status), the rest over active notes.
const NY = "America/New_York";
const wholeBook = () => queries().find((q) => q.fields && "notesWritten" in q.fields)!;

describe("noteBookFigures — the Finance hero's whole-book figures", () => {
  it("the every-note aggregate is org-bound, carries NO status filter, no LIMIT, no join", async () => {
    await noteBookFigures(ORG, NOW, NY);
    const q = wholeBook();
    expect(q, "no every-note aggregate").toBeDefined();
    expect(getTableName(q.from as never)).toBe("notes");
    expectOrgBound(q.where, "notes");
    // computeOriginatorMetrics / the escrow sums read ALL notes, any status.
    expect(render(q.where).sql).not.toMatch(/status/);
    expect(render(q.where).sql).not.toMatch(/sample/i);
    expect(q.limit).toBeUndefined();
    expect(q.joins).toEqual([]);
  });

  it("each every-note figure is the old JS arithmetic in SQL", async () => {
    await noteBookFigures(ORG, NOW, NY);
    const f = wholeBook().fields!;
    const s = (k: string) => render(f[k]).sql;
    expect(s("notesWritten")).toBe("count(*)"); // notes.length
    expect(s("capitalDeployed")).toBe('coalesce(sum("notes"."original_principal"), 0)');
    expect(s("rateTimesPrincipal")).toBe('sum("notes"."interest_rate" * "notes"."original_principal")');
    expect(s("termTimesPrincipal")).toBe('sum("notes"."term_months" * "notes"."original_principal")');
    // notes.filter(n => n.taxEscrowEnabled): a null flag is not enabled.
    expect(s("escrowAccounts")).toBe('count(*) filter (where "notes"."tax_escrow_enabled")');
    expect(s("escrowUnderManagement")).toBe('coalesce(sum("notes"."tax_escrow_balance") filter (where "notes"."tax_escrow_enabled"), 0)');
  });

  it("the active aggregate adds the investor's unfiltered UPB-weighted coupon and the fee-schedule count", async () => {
    await noteBookFigures(ORG, NOW, NY);
    const f = queries().find((q) => q.fields && "activeCount" in q.fields)!.fields!;
    // computeInvestorMetrics weighted EVERY active note (no rate/balance > 0 filter).
    expect(render(f.rateTimesBalance).sql).toBe('sum("notes"."interest_rate" * "notes"."current_balance")');
    // active.some(n => num(n.serviceFee) > 0)
    expect(render(f.feeScheduledCount).sql).toBe('count(*) filter (where "notes"."service_fee" > 0)');
  });

  it("the 12-month origination strip: one ISO-bound [from, to) sum per local month, over every note", async () => {
    await noteBookFigures(ORG, NOW, NY);
    const f = wholeBook().fields!;
    const win = originationWindow(NOW, NY);
    expect(win.map((w) => w.month)).toEqual([
      "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04",
      "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    // Local midnight on the 1st in New York: EDT (04:00Z) / EST (05:00Z).
    expect(win[0].from).toBe("2025-11-01T04:00:00.000Z");
    expect(win[1].from).toBe("2025-12-01T05:00:00.000Z");
    expect(win[11].from).toBe("2026-10-01T04:00:00.000Z");
    expect(win[11].to).toBe("2026-11-01T04:00:00.000Z");
    for (let i = 0; i < 12; i++) {
      const r = render(f[`volume${i}`]);
      expect(r.sql).toBe(
        'coalesce(sum("notes"."original_principal") filter (where "notes"."created_at" >= $1 and "notes"."created_at" < $2), 0)',
      );
      expect(r.params).toEqual([win[i].from, win[i].to]);
      for (const p of r.params) expect(typeof p).toBe("string"); // never a raw Date
    }
    // hasOriginationDates: any note dated inside the window.
    const n = render(f.originationsInWindow);
    expect(n.sql).toBe('count(*) filter (where "notes"."created_at" >= $1 and "notes"."created_at" < $2)');
    expect(n.params).toEqual([win[0].from, win[11].to]);
  });

  it("figures map back as the old JS did (weighted by Σ principal / Σ balance, null at zero weight)", async () => {
    rec.answers.push(
      [{ activeCount: 3, totalOutstanding: "200000", rateTimesBalance: "1900000", feeScheduledCount: 2 }],
      [],
      [{
        notesWritten: 7001, capitalDeployed: "900000", rateTimesPrincipal: "8100000", termTimesPrincipal: "108000000",
        escrowAccounts: 12, escrowUnderManagement: "4321.5",
        ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`volume${i}`, String(i * 1000)])),
        originationsInWindow: 9,
      }],
    );
    const out = await noteBookFigures(ORG, NOW, NY);
    expect(out).toMatchObject({
      bookYield: 9.5,
      feeScheduledCount: 2,
      notesWritten: 7001,
      capitalDeployed: 900000,
      principalWeightedRate: 9,
      principalWeightedTermMonths: 120,
      escrowAccounts: 12,
      escrowUnderManagement: 4321.5,
      originationsInWindow: 9,
      originationTimeZone: NY,
    });
    expect(out.originationVolume).toEqual(
      originationWindow(NOW, NY).map((w, i) => ({ month: w.month, amount: i * 1000 })),
    );

    rec.answers.push([{ activeCount: 0, totalOutstanding: "0", rateTimesBalance: null }], [], [{ notesWritten: 0, capitalDeployed: "0", rateTimesPrincipal: null, termTimesPrincipal: null }]);
    const none = await noteBookFigures(ORG, NOW, NY);
    expect(none.bookYield).toBeNull();
    expect(none.principalWeightedRate).toBeNull();
    expect(none.principalWeightedTermMonths).toBeNull();
    expect(none.originationVolume.every((v) => v.amount === 0)).toBe(true);
    expect(none.originationsInWindow).toBe(0);
  });

  it("an unknown or missing time zone buckets in UTC — and says so", async () => {
    expect(resolveTimeZone("Not/AZone")).toBe("UTC");
    expect(resolveTimeZone(undefined)).toBe("UTC");
    expect(resolveTimeZone(["America/New_York"])).toBe("UTC");
    expect(resolveTimeZone(NY)).toBe(NY);
    expect((await noteBookFigures(ORG, NOW, "Not/AZone")).originationTimeZone).toBe("UTC");
    expect(originationWindow(NOW, "UTC")[11]).toEqual({ month: "2026-10", from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" });
  });

  // Behavioural equivalence with the code it replaced: the client bucketed
  // `createdAt` by LOCAL month (`getFullYear()/getMonth()`) and built the
  // window with `new Date(y, m - i, 1)`. With the process zone set to the
  // viewer's, the old arithmetic and the server's window must agree.
  describe("matches the old client month window in the viewer's zone", () => {
    const savedTz = process.env.TZ;
    afterEach(() => {
      if (savedTz === undefined) delete process.env.TZ;
      else process.env.TZ = savedTz;
    });
    const oldClientWindow = (now: Date) =>
      Array.from({ length: 12 }, (_, k) => {
        const i = 11 - k;
        const a = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const b = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        return { month: `${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, "0")}`, from: a.toISOString(), to: b.toISOString() };
      });
    const ZONES = ["UTC", NY, "America/Los_Angeles", "Europe/London", "Asia/Kolkata", "Australia/Lord_Howe", "Australia/Sydney", "Pacific/Auckland", "Pacific/Chatham", "Pacific/Kiritimati", "America/St_Johns"];
    // 2029-04: the window spans Oct 2028 and Apr 2029, when these southern
    // zones change offset between UTC midnight and local midnight on the 1st.
    const NOWS = ["2026-10-05T12:00:00Z", "2026-10-31T23:30:00Z", "2026-03-01T03:00:00Z", "2026-01-01T00:30:00Z", "2025-12-31T13:45:00Z", "2029-04-15T00:00:00Z"];
    for (const tz of ZONES) {
      it(tz, () => {
        process.env.TZ = tz;
        for (const iso of NOWS) {
          const now = new Date(iso);
          expect(originationWindow(now, tz), `${tz} @ ${iso}`).toEqual(oldClientWindow(now));
        }
      });
    }
  });
});

// ── The route, and who reads it ─────────────────────────────────────────────
const ROOT = resolve(__dirname, "../..");
const src = (f: string) => stripComments(readFileSync(resolve(ROOT, f), "utf8"));

describe("GET /api/notes/book-figures is mounted and adopted", () => {
  it("is registered before /api/notes/:id and serves noteBookFigures", () => {
    const s = src("server/routes-finance.ts");
    const figures = s.indexOf('"/api/notes/book-figures"');
    const byId = s.indexOf('"/api/notes/:id"');
    expect(figures).toBeGreaterThan(-1);
    expect(byId).toBeGreaterThan(-1);
    expect(figures).toBeLessThan(byId);
    expect(s).toMatch(/\bnoteBookFigures\(/);
    // The viewer's zone reaches the month window (the hero's local months).
    expect(s).toMatch(/\bnoteBookFigures\(getOrganizationId\(req\), new Date\(\), req\.query\.tz\)/);
  });

  it("the client hook reads that endpoint", () => {
    expect(src("client/src/hooks/use-note-book-figures.ts")).toMatch(/["']\/api\/notes\/book-figures["']/);
  });

  // Every client surface that turned the note list into a book-wide figure,
  // and how many note widgets each holds.
  const WIDGET_FILES: Record<string, number> = {
    "client/src/components/maps/PersonaMapStrip.tsx": 3, // yield, origination, servicing
    "client/src/components/dashboard/type-specific-widgets.tsx": 3, // investor, originator, servicer
  };
  for (const [f, widgets] of Object.entries(WIDGET_FILES)) {
    it(`${f}: every note widget reads the book figures, and none sums a note list`, () => {
      const s = src(f);
      expect(s.match(/\buseNoteBookFigures\(\)/g) ?? []).toHaveLength(widgets);
      // The capped list is not read at all here any more.
      expect(s).not.toMatch(/["'`]\/api\/notes["'`]/);
      // The shapes the defect took: a reduce over notes, a filter for active notes.
      expect(s).not.toMatch(/\b(?:notes|active|activeNotes)\s*\.\s*reduce\(/);
      expect(s).not.toMatch(/\bn\.status\s*===\s*["']active["']/);
    });
  }

  it("the Finance page's headline figures are the book figures, not sums over its capped note list", () => {
    // Finance keeps the note list for its table (it needs the rows), so it may
    // filter it — but no money figure is reduced from it.
    const s = src("client/src/pages/finance.tsx");
    expect(s).toMatch(/\buseNoteBookFigures\(\)/);
    expect(s).not.toMatch(/\b(?:notes|activeNotes|enrichedNotes)\s*\.\s*reduce\(/);
    for (const [testId, field] of [
      ["text-active-notes", "activeCount"],
      ["text-portfolio-value", "totalOutstanding"],
      ["text-monthly-income", "totalMonthly"],
      ["text-total-principal", "totalFinanced"],
    ]) {
      const at = s.indexOf(`data-testid="${testId}"`);
      expect(at, testId).toBeGreaterThan(-1);
      expect(s.slice(at, s.indexOf("</div>", at)), testId).toMatch(new RegExp(`\\bf\\.${field}\\b`));
    }
    // On error the cards show "—", never a zero, and the page says why with a retry.
    expect(s).toMatch(/bookFigures \? pick\(bookFigures\) : bookFiguresError \? "—"/);
    expect(s).toMatch(/\{bookFiguresError && \(\s*<QueryErrorState[\s\S]*?onRetry=\{\(\) => void refetchBookFigures\(\)\}/);
  });
});
