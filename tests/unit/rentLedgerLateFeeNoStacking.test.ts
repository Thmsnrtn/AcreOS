/**
 * W2-RENT — the rent ledger's two server defects found while lighting it up.
 *
 * 1. A LATE FEE STACKED PAST THE STATUTORY CAP. `proposeLateFee` computes the
 *    TOTAL fee a rule allows for one charge as of today (initial fee + per-day
 *    accrual, capped). The apply route ADDED that total to `late_fee_cents`
 *    without looking at what was already there, so confirming the dialog a
 *    second time on the same charge charged the whole total again — a tenant
 *    taken over the cap by two clicks. Every proposal the route file serves or
 *    charges is now net of the fee already on the charge.
 *
 * 2. SCHEDULED RENT BACK-FILLED THE SELLER'S MONTHS. A rent-roll import keeps
 *    the seller's lease start and seeds the import month's charge; the
 *    scheduled generator planned from the lease start, so the first "post rent"
 *    on an acquired building put every pre-acquisition month on the buyer's
 *    ledger as rent owed to them. Planning now starts at the first month
 *    already on the lease's ledger when there is one.
 *
 * Both are asserted through the REAL route handlers (`registerRentLedgerRoutes`
 * on a capturing app, db mocked — the paymentWorkflowEvents.test.ts pattern),
 * so the test reads what an operator would be shown and charged, not the name
 * of a helper. No DATABASE_URL required.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock("../../server/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, db: dbMock };
});

import { registerRentLedgerRoutes } from "../../server/routes-rent-ledger";
import { netOfLateFeesAlreadyCharged, proposeLateFee } from "../../shared/rental/lateFeeProposal";
import { planRentCharges } from "../../shared/rental/rentSchedule";

type Handler = (req: any, res: any) => Promise<unknown>;

/** Thenable query-chain stub: every builder method returns itself; awaiting resolves to `result`. */
function chain(result: unknown) {
  const link: any = {
    from: () => link,
    where: () => link,
    orderBy: () => link,
    innerJoin: () => link,
    limit: () => link,
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return link;
}

function handlerFor(method: string, path: string): Handler {
  const routes: Array<{ method: string; path: string; args: unknown[] }> = [];
  const capture = (m: string) => (p: string, ...args: unknown[]) => routes.push({ method: m, path: p, args });
  const app: any = {
    get: capture("get"),
    post: capture("post"),
    patch: capture("patch"),
    put: capture("put"),
    delete: capture("delete"),
  };
  registerRentLedgerRoutes(app);
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`${method.toUpperCase()} ${path} is not registered`);
  return route.args[route.args.length - 1] as Handler;
}

function fakeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const req = (over: Record<string, unknown> = {}) => ({
  params: { id: "11111111-1111-4111-8111-111111111111" },
  query: {},
  body: {},
  headers: {},
  organization: { id: 7, onboardingData: {} },
  user: { id: "user-1" },
  ...over,
});

// TX-shaped rule, as `late_fee_rules` returns it (numeric columns are strings).
const RULE_ROW = {
  state: "TX",
  capPctSmallProperty: "0.1",
  capPctLargeProperty: "0.12",
  capFlatCents: null,
  graceDays: 2,
  initialFeeCents: 5_000,
  perDayCents: 500,
  citation: "Tex. Prop. Code §92.019",
  summary: null,
};
const LEASE = {
  id: "22222222-2222-4222-8222-222222222222",
  organizationId: 7,
  propertyId: 42,
  monthlyRentCents: 140_000,
  state: "TX",
  unitLabel: "3B",
};
function chargeWithFee(lateFeeCents: number) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    leaseId: LEASE.id,
    organizationId: 7,
    chargedForMonth: "2026-06-01",
    dueDate: "2026-06-01",
    amountCents: 140_000,
    lateFeeCents,
    paidCents: 0,
    balanceCents: 140_000 + lateFeeCents,
    legalPosture: "late",
  };
}

// 2026-07-11 → the 2026-06-01 charge is 40 days late. Uncapped 5,000 +
// (40 − 2) × 500 = 24,000; one unit on record is a FLOOR, so the lower branch
// binds: 10% of $1,400.00 = $140.00. That is the rule's TOTAL for the charge.
const RULE_TOTAL_CENTS = 14_000;

/** charge → lease → rule → modelled units (none) → lease-derived floor of 1. */
function primeProposalReads(lateFeeCents: number) {
  dbMock.select
    .mockReturnValueOnce(chain([chargeWithFee(lateFeeCents)]))
    .mockReturnValueOnce(chain([LEASE]))
    .mockReturnValueOnce(chain([RULE_ROW]))
    .mockReturnValueOnce(chain([]));
  dbMock.execute.mockResolvedValueOnce({ rows: [{ c: 1 }] });
}

let updateSets: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
  for (const fn of Object.values(dbMock)) fn.mockReset();
  updateSets = [];
  dbMock.update.mockImplementation(() => ({
    set: (values: Record<string, unknown>) => {
      updateSets.push(values);
      return { where: () => Promise.resolve(undefined) };
    },
  }));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the fixture is what it claims (otherwise every assertion below is vacuous)", () => {
  it("the rule's total for a fee-free charge is $140.00 and is chargeable", async () => {
    primeProposalReads(0);
    const res = fakeRes();
    await handlerFor("get", "/api/rent-charges/:id/late-fee-proposal")(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.proposal.status).toBe("proposed");
    expect(res.body.proposal.proposedFeeCents).toBe(RULE_TOTAL_CENTS);
  });
});

describe("a late fee never stacks past the rule's total", () => {
  it("proposes only what remains when part of the fee is already on the charge", async () => {
    primeProposalReads(5_000);
    const res = fakeRes();
    await handlerFor("get", "/api/rent-charges/:id/late-fee-proposal")(req(), res);
    expect(res.body.proposal.status).toBe("proposed");
    expect(res.body.proposal.proposedFeeCents).toBe(RULE_TOTAL_CENTS - 5_000);
    expect(res.body.proposal.explanation).toContain("$50.00 in late fees is already on this charge");
  });

  it("proposes nothing once the rule's total is on the charge", async () => {
    primeProposalReads(RULE_TOTAL_CENTS);
    const res = fakeRes();
    await handlerFor("get", "/api/rent-charges/:id/late-fee-proposal")(req(), res);
    expect(res.body.proposal.status).toBe("already_charged");
    expect(res.body.proposal.proposedFeeCents).toBe(0);
  });

  it("a second apply tops the fee up to the total — it does not add the total again", async () => {
    primeProposalReads(5_000);
    const res = fakeRes();
    await handlerFor("post", "/api/rent-charges/:id/apply-late-fee")(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.charged).toBe(true);
    expect(res.body.feeCents).toBe(RULE_TOTAL_CENTS - 5_000);
    expect(updateSets).toHaveLength(1);
    // The ledger ends at the rule's total, never 5,000 + 14,000.
    expect(updateSets[0].lateFeeCents).toBe(RULE_TOTAL_CENTS);
    expect(updateSets[0].balanceCents).toBe(140_000 + RULE_TOTAL_CENTS);
  });

  it("an apply on a charge already at the total writes nothing", async () => {
    primeProposalReads(RULE_TOTAL_CENTS);
    const res = fakeRes();
    await handlerFor("post", "/api/rent-charges/:id/apply-late-fee")(req(), res);
    expect(res.body.charged).toBe(false);
    expect(res.body.feeCents).toBe(0);
    expect(updateSets).toHaveLength(0);
  });

  it("confirming the gross total on a part-charged charge is refused, and nothing is written", async () => {
    primeProposalReads(5_000);
    const res = fakeRes();
    await handlerFor("post", "/api/rent-charges/:id/apply-late-fee")(
      req({ body: { confirmFeeCents: RULE_TOTAL_CENTS } }),
      res,
    );
    expect(res.statusCode).toBe(409);
    expect(updateSets).toHaveLength(0);
  });

  it("the org-wide queue nets the same way", async () => {
    dbMock.select
      .mockReturnValueOnce(chain([{ charge: chargeWithFee(5_000), lease: LEASE }]))
      .mockReturnValueOnce(chain([RULE_ROW]))
      .mockReturnValueOnce(chain([]));
    dbMock.execute.mockResolvedValueOnce({ rows: [{ c: 1 }] });
    const res = fakeRes();
    await handlerFor("get", "/api/rent/late-fee-proposals")(req(), res);
    expect(res.body.proposals).toHaveLength(1);
    expect(res.body.proposals[0].proposal.proposedFeeCents).toBe(RULE_TOTAL_CENTS - 5_000);
    expect(res.body.totals.proposedFeeCents).toBe(RULE_TOTAL_CENTS - 5_000);
  });
});

describe("netOfLateFeesAlreadyCharged (the pure rule)", () => {
  const rule = {
    state: "TX",
    capPctSmallProperty: 0.1,
    capPctLargeProperty: 0.12,
    capFlatCents: null,
    graceDays: 2,
    initialFeeCents: 5_000,
    perDayCents: 500,
    citation: "Tex. Prop. Code §92.019",
  };
  const gross = proposeLateFee({ rule, monthlyRentCents: 140_000, daysLate: 40, knownUnitCountFloor: 1, state: "TX" });

  it("leaves a proposal alone when nothing is on the charge", () => {
    expect(netOfLateFeesAlreadyCharged(gross, 0)).toBe(gross);
  });

  it("never proposes a negative fee when more than the total is already charged", () => {
    const net = netOfLateFeesAlreadyCharged(gross, gross.proposedFeeCents + 1_000);
    expect(net.status).toBe("already_charged");
    expect(net.proposedFeeCents).toBe(0);
  });

  it("does not turn a refusal into a proposal", () => {
    const inGrace = proposeLateFee({ rule, monthlyRentCents: 140_000, daysLate: 1, knownUnitCountFloor: 1, state: "TX" });
    expect(netOfLateFeesAlreadyCharged(inGrace, 5_000)).toBe(inGrace);
  });
});

describe("scheduled rent never back-fills before the ledger's first month", () => {
  // An imported in-place lease: the seller's start date, and the import
  // month's charge already on the ledger.
  const imported = {
    startDate: "2023-05-01",
    endDate: null,
    rentDueDayOfMonth: 1,
    monthlyRentCents: 140_000,
  };

  it("plans only months from the first one already on the ledger", () => {
    const plan = planRentCharges({ lease: imported, existingMonths: ["2026-07-01"], throughDate: "2026-09-15" });
    expect(plan.create.map((c) => c.chargedForMonth)).toEqual(["2026-08-01", "2026-09-01"]);
  });

  it("a lease with nothing on its ledger still plans from its own start", () => {
    const plan = planRentCharges({
      lease: { ...imported, startDate: "2026-06-01" },
      existingMonths: [],
      throughDate: "2026-08-15",
    });
    expect(plan.create.map((c) => c.chargedForMonth)).toEqual(["2026-06-01", "2026-07-01", "2026-08-01"]);
  });

  it("through the real preview route: an imported lease shows no seller-era months", async () => {
    dbMock.select
      .mockReturnValueOnce(chain([{ ...LEASE, ...imported, status: "active", isSection8: false, hapPortionCents: null, tenantPortionCents: null }]))
      .mockReturnValueOnce(chain([{ leaseId: LEASE.id, chargedForMonth: "2026-07-01" }]))
      .mockReturnValueOnce(chain([]));
    const res = fakeRes();
    await handlerFor("get", "/api/rent-charges/scheduled-preview")(req({ query: { throughDate: "2026-09-15" } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.chargeCount).toBe(2);
    expect(res.body.leases[0].create.map((c: { chargedForMonth: string }) => c.chargedForMonth)).toEqual([
      "2026-08-01",
      "2026-09-01",
    ]);
    expect(res.body.totalToPostCents).toBe(280_000);
    // There is no manual-charge route: the wire copy must not tell anyone to post one.
    expect(res.body.prorationPolicy).toContain("AcreOS cannot post a manual charge yet");
    expect(res.body.prorationPolicy).not.toMatch(/Post those periods manually/);
  });

  it("a skipped partial month says it cannot be posted here, not 'post it manually'", () => {
    const plan = planRentCharges({
      lease: { ...imported, startDate: "2026-06-15" },
      existingMonths: [],
      throughDate: "2026-07-15",
    });
    const partial = plan.skipped.find((s) => s.code === "partial_first_period")!;
    expect(partial.reason).toContain("AcreOS cannot post a manual charge yet");
    expect(partial.reason).not.toMatch(/post this first charge manually/);
  });
});
