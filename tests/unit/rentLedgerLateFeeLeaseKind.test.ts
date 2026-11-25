/**
 * W-14 — late fees are routed by the LEASE's kind, not the org's type.
 *
 * The two late-fee lanes (statutory residential / contractual commercial)
 * used to be gated on `organizations.onboardingData.businessType`, so a
 * MIXED book was misrouted both ways: a buy-and-hold org holding one
 * commercial lease could not get that lease's contractual proposal, and a
 * commercial org holding one residential lease could not get that lease's
 * statutory proposal. The kind now comes from the lease itself — presence
 * of any commercial-terms column on `rentalLeases` (the schema's own rule:
 * the columns are null on a residential lease, so presence IS the signal).
 *
 * Asserted through the REAL route handlers (`registerRentLedgerRoutes` on a
 * capturing app, db mocked — the rentLedgerLateFeeNoStacking.test.ts
 * pattern), so the tests read what an operator would be shown and charged.
 * No DATABASE_URL required.
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

const bhReq = (over: Record<string, unknown> = {}) => ({
  params: { id: RES_CHARGE_ID },
  query: {},
  body: {},
  headers: {},
  organization: { id: 7, onboardingData: { businessType: "buy_and_hold" } },
  user: { id: "user-1" },
  ...over,
});
const commercialOrgReq = (over: Record<string, unknown> = {}) =>
  bhReq({ organization: { id: 7, onboardingData: { businessType: "commercial" } }, ...over });

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
// Same arithmetic as rentLedgerLateFeeNoStacking: 40 days late on $1,400
// rent, one-unit floor → the rule's TOTAL for the charge is $140.00.
const RULE_TOTAL_CENTS = 14_000;

const NO_COMMERCIAL_TERMS = {
  rentableSqft: null,
  leaseType: null,
  camProRataBps: null,
  camEstimateMonthlyCents: null,
  camBaseYearStopCents: null,
  pctRentBps: null,
  pctRentBreakpointType: null,
  pctRentArtificialBreakpointCents: null,
  pctRentFrequency: null,
  lateFeeType: null,
  lateFeeFlatCents: null,
  lateFeePctBps: null,
  lateFeeGraceDays: null,
  lateFeeMaxCents: null,
  lateFeePerDayCents: null,
};

/** A residential lease: every commercial-terms column null. */
const RES_LEASE = {
  id: "22222222-2222-4222-8222-222222222222",
  organizationId: 7,
  propertyId: 42,
  monthlyRentCents: 140_000,
  state: "TX",
  unitLabel: "3B",
  ...NO_COMMERCIAL_TERMS,
};

/** A commercial lease with contractual late-fee terms set by the lease. */
const COMM_LEASE = {
  ...RES_LEASE,
  id: "33333333-3333-4333-8333-333333333333",
  unitLabel: "Suite 100",
  rentableSqft: 2_400,
  leaseType: "nnn" as const,
  lateFeeType: "flat" as const,
  lateFeeFlatCents: 25_000,
  lateFeeGraceDays: 5,
};

/** A commercial-kind lease whose late-fee terms were never set: neither lane may serve it. */
const COMM_LEASE_NO_FEE_TERMS = {
  ...RES_LEASE,
  id: "44444444-4444-4444-8444-444444444444",
  unitLabel: "Suite 200",
  rentableSqft: 1_800,
  leaseType: "gross" as const,
};

const RES_CHARGE_ID = "11111111-1111-4111-8111-111111111111";
const COMM_CHARGE_ID = "55555555-5555-4555-8555-555555555555";
const NO_FEE_CHARGE_ID = "66666666-6666-4666-8666-666666666666";

function chargeFor(lease: { id: string }, id: string, lateFeeCents = 0) {
  return {
    id,
    leaseId: lease.id,
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

/** charge → lease → rule → modelled units (none) → lease-derived floor of 1. */
function primeStatutoryReads(lease: object, lateFeeCents = 0, chargeId = RES_CHARGE_ID) {
  dbMock.select
    .mockReturnValueOnce(chain([chargeFor(lease as { id: string }, chargeId, lateFeeCents)]))
    .mockReturnValueOnce(chain([lease]))
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

describe("mixed book, direction 1 — a commercial lease in a non-commercial org", () => {
  it("reaches the contractual proposal from its own terms", async () => {
    dbMock.select
      .mockReturnValueOnce(chain([chargeFor(COMM_LEASE, COMM_CHARGE_ID)]))
      .mockReturnValueOnce(chain([COMM_LEASE]));
    const res = fakeRes();
    await handlerFor("post", "/api/rent-charges/:id/commercial-late-fee")(
      bhReq({ params: { id: COMM_CHARGE_ID } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.proposal.refusedReason).toBeNull();
    expect(res.body.proposal.basis).toBe("flat");
    // 40 days late, past the lease's 5-day contractual grace → the flat fee.
    expect(res.body.proposal.lateFeeCents).toBe(25_000);
  });

  it("is refused the statutory lane — a commercial lease never takes the statutory proposal", async () => {
    dbMock.select
      .mockReturnValueOnce(chain([chargeFor(COMM_LEASE, COMM_CHARGE_ID)]))
      .mockReturnValueOnce(chain([COMM_LEASE]));
    const res = fakeRes();
    await handlerFor("get", "/api/rent-charges/:id/late-fee-proposal")(
      bhReq({ params: { id: COMM_CHARGE_ID } }),
      res,
    );
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("LATE_FEE_NOT_APPLICABLE_COMMERCIAL");
    expect(res.body.message).toContain("/api/rent-charges/:id/commercial-late-fee");
    // Refused at the lease read — no rule was ever consulted for this lease.
    expect(dbMock.select).toHaveBeenCalledTimes(2);
  });
});

describe("mixed book, direction 2 — a residential lease in a commercial org", () => {
  it("reaches the statutory proposal", async () => {
    primeStatutoryReads(RES_LEASE);
    const res = fakeRes();
    await handlerFor("get", "/api/rent-charges/:id/late-fee-proposal")(commercialOrgReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.proposal.status).toBe("proposed");
    expect(res.body.proposal.proposedFeeCents).toBe(RULE_TOTAL_CENTS);
  });

  it("can be charged the confirmed statutory fee", async () => {
    primeStatutoryReads(RES_LEASE, 5_000);
    const res = fakeRes();
    await handlerFor("post", "/api/rent-charges/:id/apply-late-fee")(commercialOrgReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.charged).toBe(true);
    expect(res.body.feeCents).toBe(RULE_TOTAL_CENTS - 5_000);
    expect(updateSets).toHaveLength(1);
    expect(updateSets[0].lateFeeCents).toBe(RULE_TOTAL_CENTS);
  });

  it("is refused the contractual lane — the fence holds whatever the org type is", async () => {
    dbMock.select
      .mockReturnValueOnce(chain([chargeFor(RES_LEASE, RES_CHARGE_ID)]))
      .mockReturnValueOnce(chain([RES_LEASE]));
    const res = fakeRes();
    await handlerFor("post", "/api/rent-charges/:id/commercial-late-fee")(commercialOrgReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("LATE_FEE_USE_STATUTORY_RESIDENTIAL");
    expect(res.body.message).toContain("/api/rent-charges/:id/late-fee-proposal");
  });
});

describe("single-kind books behave exactly as before", () => {
  it("a commercial lease in a commercial org still gets its contractual proposal", async () => {
    dbMock.select
      .mockReturnValueOnce(chain([chargeFor(COMM_LEASE, COMM_CHARGE_ID)]))
      .mockReturnValueOnce(chain([COMM_LEASE]));
    const res = fakeRes();
    await handlerFor("post", "/api/rent-charges/:id/commercial-late-fee")(
      commercialOrgReq({ params: { id: COMM_CHARGE_ID } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.proposal.lateFeeCents).toBe(25_000);
  });

  it("a commercial lease in a commercial org is still refused the statutory lane", async () => {
    dbMock.select
      .mockReturnValueOnce(chain([chargeFor(COMM_LEASE, COMM_CHARGE_ID)]))
      .mockReturnValueOnce(chain([COMM_LEASE]));
    const res = fakeRes();
    await handlerFor("get", "/api/rent-charges/:id/late-fee-proposal")(
      commercialOrgReq({ params: { id: COMM_CHARGE_ID } }),
      res,
    );
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("LATE_FEE_NOT_APPLICABLE_COMMERCIAL");
  });

  it("a residential lease in a non-commercial org is still refused the contractual lane", async () => {
    dbMock.select
      .mockReturnValueOnce(chain([chargeFor(RES_LEASE, RES_CHARGE_ID)]))
      .mockReturnValueOnce(chain([RES_LEASE]));
    const res = fakeRes();
    await handlerFor("post", "/api/rent-charges/:id/commercial-late-fee")(bhReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("LATE_FEE_USE_STATUTORY_RESIDENTIAL");
  });

  it("a commercial lease cannot be charged a statutory fee through apply", async () => {
    dbMock.select
      .mockReturnValueOnce(chain([chargeFor(COMM_LEASE, COMM_CHARGE_ID)]))
      .mockReturnValueOnce(chain([COMM_LEASE]));
    const res = fakeRes();
    await handlerFor("post", "/api/rent-charges/:id/apply-late-fee")(
      bhReq({ params: { id: COMM_CHARGE_ID } }),
      res,
    );
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("LATE_FEE_NOT_APPLICABLE_COMMERCIAL");
    expect(updateSets).toHaveLength(0);
    expect(dbMock.update).not.toHaveBeenCalled();
  });
});

describe("a lease that matches neither lane still refuses, in plain words", () => {
  it("commercial kind but no late-fee terms: the contractual engine refuses rather than invent a fee", async () => {
    dbMock.select
      .mockReturnValueOnce(chain([chargeFor(COMM_LEASE_NO_FEE_TERMS, NO_FEE_CHARGE_ID)]))
      .mockReturnValueOnce(chain([COMM_LEASE_NO_FEE_TERMS]));
    const res = fakeRes();
    await handlerFor("post", "/api/rent-charges/:id/commercial-late-fee")(
      bhReq({ params: { id: NO_FEE_CHARGE_ID } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("no contractual late-fee term set");
  });

  it("…and the statutory lane refuses it too, because it IS a commercial lease", async () => {
    dbMock.select
      .mockReturnValueOnce(chain([chargeFor(COMM_LEASE_NO_FEE_TERMS, NO_FEE_CHARGE_ID)]))
      .mockReturnValueOnce(chain([COMM_LEASE_NO_FEE_TERMS]));
    const res = fakeRes();
    await handlerFor("get", "/api/rent-charges/:id/late-fee-proposal")(
      bhReq({ params: { id: NO_FEE_CHARGE_ID } }),
      res,
    );
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("LATE_FEE_NOT_APPLICABLE_COMMERCIAL");
  });
});

describe("the rules list is book-aware", () => {
  it("a commercial org holding one residential lease is served the rules", async () => {
    dbMock.select
      .mockReturnValueOnce(chain([COMM_LEASE, RES_LEASE]))
      .mockReturnValueOnce(chain([RULE_ROW]));
    const res = fakeRes();
    await handlerFor("get", "/api/late-fee-rules")(commercialOrgReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.rules).toHaveLength(1);
    expect(res.body.rules[0].state).toBe("TX");
  });

  it("a commercial org whose whole book is commercial is still refused", async () => {
    dbMock.select.mockReturnValueOnce(chain([COMM_LEASE, COMM_LEASE_NO_FEE_TERMS]));
    const res = fakeRes();
    await handlerFor("get", "/api/late-fee-rules")(commercialOrgReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("LATE_FEE_NOT_APPLICABLE_COMMERCIAL");
    // Refused at the book read — the rules table was never read.
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it("a commercial org with no leases at all is still refused", async () => {
    dbMock.select.mockReturnValueOnce(chain([]));
    const res = fakeRes();
    await handlerFor("get", "/api/late-fee-rules")(commercialOrgReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("LATE_FEE_NOT_APPLICABLE_COMMERCIAL");
  });

  it("a non-commercial org is served with no book read at all", async () => {
    dbMock.select.mockReturnValueOnce(chain([RULE_ROW]));
    const res = fakeRes();
    await handlerFor("get", "/api/late-fee-rules")(bhReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.rules).toHaveLength(1);
    // The single read IS the rules query — the guard short-circuited.
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });
});

describe("the org-wide queue routes each charge by its lease's kind", () => {
  it("proposes statutorily for the residential charge and reports the commercial charge on its own lane", async () => {
    dbMock.select
      .mockReturnValueOnce(chain([
        { charge: chargeFor(COMM_LEASE, COMM_CHARGE_ID), lease: COMM_LEASE },
        { charge: chargeFor(RES_LEASE, RES_CHARGE_ID, 5_000), lease: RES_LEASE },
      ]))
      .mockReturnValueOnce(chain([RULE_ROW]))
      .mockReturnValueOnce(chain([]));
    dbMock.execute.mockResolvedValueOnce({ rows: [{ c: 1 }] });
    const res = fakeRes();
    await handlerFor("get", "/api/rent/late-fee-proposals")(bhReq(), res);
    expect(res.statusCode).toBe(200);
    // Only the residential charge carries a statutory proposal…
    expect(res.body.proposals).toHaveLength(1);
    expect(res.body.proposals[0].rentChargeId).toBe(RES_CHARGE_ID);
    expect(res.body.proposals[0].proposal.proposedFeeCents).toBe(RULE_TOTAL_CENTS - 5_000);
    // …and the commercial charge is named on the contractual lane, not dropped.
    expect(res.body.commercialLaneCharges).toHaveLength(1);
    expect(res.body.commercialLaneCharges[0].rentChargeId).toBe(COMM_CHARGE_ID);
    expect(res.body.commercialLaneCharges[0].leaseId).toBe(COMM_LEASE.id);
    expect(res.body.commercialLaneCharges[0].reason).toContain("commercial-late-fee");
    // Totals: both overdue charges counted; fee totals stay statutory-only.
    expect(res.body.totals.overdueCharges).toBe(2);
    expect(res.body.totals.chargeableProposals).toBe(1);
    expect(res.body.totals.proposedFeeCents).toBe(RULE_TOTAL_CENTS - 5_000);
  });
});
