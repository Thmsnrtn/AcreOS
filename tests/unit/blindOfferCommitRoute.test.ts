/**
 * `POST /api/data-intel/blind-offer/commit` — the route half of the land loop.
 *
 * The arithmetic contract (what gets frozen equals what the operator saw) is
 * pinned in `blindOfferCommitsADecision.test.ts`. This file pins the route's
 * OBLIGATIONS, which are three, and each is a place a commit endpoint can go
 * quietly wrong:
 *
 *   1. TENANCY. `propertyId` arrives from a query string the client copies into
 *      a POST body. It is fetched org-scoped, and a parcel belonging to another
 *      org is a 404 — not a decision recorded against someone else's land.
 *   2. THE SAME LAND-STATUS GUARD AS THE COMPUTE PATH. `POST /blind-offer`
 *      refuses to calculate on an Indian-Country or federal-trust parcel. A
 *      decision to OFFER on one must be refused at least as hard; a guard that
 *      covers the calculator and not the commitment is worse than none, because
 *      it reads as covered.
 *   3. IT IS NOT BEST-EFFORT. The flip analyzer records its decision inside a
 *      try/catch because an offer row is created either way and a bookkeeping
 *      failure must not cost the operator their draft. Here the decision IS the
 *      deliverable, so a failed write must fail the request. Reporting
 *      "Decision recorded" over a write that did not happen is precisely the
 *      defect ledger 41 closed on the privacy surface.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const ORG_ID = 42;
const USER_ID = "user_owner";
const OWN_PROPERTY = 7;
const FOREIGN_PROPERTY = 8;
const TRUST_PROPERTY = 9;

const FEE_ROW = [{ id: OWN_PROPERTY, landStatus: "fee", address: "1 Test Rd", county: "Mohave", state: "AZ" }];
const TRUST_ROW = [{ id: TRUST_PROPERTY, landStatus: "tribal_trust", address: "1 Test Rd", county: "Mohave", state: "AZ" }];

const { selectFn, nextRow, recordScenario, recordDecision } = vi.hoisted(() => {
  // The row the org-scoped lookup will return. Set per test rather than
  // decoded from the drizzle condition: inspecting a query builder's internals
  // would make this file a test of drizzle, and the route's tenancy claim is
  // asserted separately below by checking that the WHERE names the org.
  const nextRow: { current: unknown[] } = { current: [] };
  return {
    nextRow,
    selectFn: vi.fn(() => ({
      from: () => ({ where: (cond: unknown) => { whereConds.push(cond); return Promise.resolve(nextRow.current); } }),
    })),
    recordScenario: vi.fn(async () => ({ id: 501, computedAt: new Date(), body: {} })),
    recordDecision: vi.fn(async () => ({ id: 901, decidedAt: new Date(), body: {} })),
  };
});

/** Every WHERE the route built — proof the lookup happened at all. */
const whereConds: unknown[] = [];

vi.mock("../../server/db", () => ({ db: { select: selectFn } }));
vi.mock("../../server/services/economics/scenarioStore", () => ({ recordScenario }));
vi.mock("../../server/services/decisions/decisionStore", () => ({ recordDecision }));

const { default: dataIntelRouter } = await import("../../server/routes-data-intelligence");

function app(orgOverride?: Record<string, unknown>) {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: ORG_ID, underwritingDefaults: undefined, ...orgOverride };
    req.user = { id: USER_ID };
    next();
  });
  a.use("/api/data-intel", dataIntelRouter);
  return a;
}

const goodBody = {
  propertyId: OWN_PROPERTY,
  offerAmount: 40_000,
  salePrice: 100_000,
  tier: "standard" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  whereConds.length = 0;
  nextRow.current = FEE_ROW;
  recordScenario.mockResolvedValue({ id: 501, computedAt: new Date(), body: {} } as never);
  recordDecision.mockResolvedValue({ id: 901, decidedAt: new Date(), body: {} } as never);
});

describe("it records a decision, with the scenario behind it", () => {
  it("writes the scenario FIRST and cites it on the decision", async () => {
    // Order matters: a decision that references a scenario id which does not
    // exist yet is a dangling reference in an append-only table.
    const res = await request(app()).post("/api/data-intel/blind-offer/commit").send(goodBody);

    expect(res.status).toBe(200);
    expect(recordScenario).toHaveBeenCalledTimes(1);
    expect(recordDecision).toHaveBeenCalledTimes(1);

    const decisionCall = recordDecision.mock.calls[0] as unknown as [number, any, Date, number[]];
    expect(decisionCall[0], "the decision must be org-scoped").toBe(ORG_ID);
    expect(decisionCall[3], "the decision does not cite the scenario").toEqual([501]);
    expect(res.body).toMatchObject({ decisionSnapshotId: 901, scenarioId: 501 });

    expect(whereConds.length, "the route did not look the parcel up").toBeGreaterThan(0);
  });

  it("names a real authority and a real actor, not a generic one", async () => {
    await request(app()).post("/api/data-intel/blind-offer/commit").send(goodBody);
    const input = (recordDecision.mock.calls[0] as unknown as [number, any])[1];
    expect(input.actorType).toBe("user");
    expect(input.actorRef).toBe(USER_ID);
    expect(
      input.authority,
      "a generic 'autonomous'/'system' authority would be false — this route is " +
        "reachable only by an authenticated org member acting by hand",
    ).toBe("org_member:blind_offer_commit");
    expect(input.kind).toBe("offer");
    expect(input.subjectType).toBe("property");
    expect(input.subjectId).toBe(OWN_PROPERTY);
  });

  it("records the two tiers NOT taken as alternatives", async () => {
    await request(app())
      .post("/api/data-intel/blind-offer/commit")
      .send({
        ...goodBody,
        alternatives: [
          { choice: "aggressive — $32,000", reason: "Not taken. Lower acceptance." },
          { choice: "competitive — $52,800", reason: "Not taken. Thinner margin." },
        ],
      });
    const input = (recordDecision.mock.calls[0] as unknown as [number, any])[1];
    expect(input.alternatives).toHaveLength(2);
    expect(input.alternatives[0].reason).toMatch(/Not taken/);
  });

  it("never manufactures a review date", async () => {
    // A made-up date would make the outcome prompt nag about every offer ever
    // committed, which is exactly what the prompt refuses to do.
    await request(app()).post("/api/data-intel/blind-offer/commit").send(goodBody);
    const input = (recordDecision.mock.calls[0] as unknown as [number, any])[1];
    expect(input.reviewDueAt).toBeNull();
  });

  it("passes the org's own land rules through to the scenario", async () => {
    await request(app({ underwritingDefaults: { landDeal: { closingAtBuyPct: 5 } } }))
      .post("/api/data-intel/blind-offer/commit")
      .send(goodBody);
    const req = (recordScenario.mock.calls[0] as unknown as [number, any])[1];
    expect(req.inputs.closingAtBuyCents, "the org rule did not reach the engine inputs").toBe(
      200_000,
    );
    const orgRule = req.assumptions.find((a: any) => a.key === "closingAtBuyPct");
    expect(orgRule.origin, "the org's own rule is being recorded as our default").toBe("user");
    const ourDefault = req.assumptions.find((a: any) => a.key === "dispositionCostPct");
    expect(ourDefault.origin).toBe("platform-default");
  });
});

describe("it refuses what it must refuse", () => {
  it("404s a parcel belonging to another org, and records nothing", async () => {
    nextRow.current = []; // the org-scoped lookup finds nothing
    const res = await request(app())
      .post("/api/data-intel/blind-offer/commit")
      .send({ ...goodBody, propertyId: FOREIGN_PROPERTY });
    expect(res.status).toBe(404);
    expect(recordScenario).not.toHaveBeenCalled();
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("refuses a non-fee-simple parcel, like the compute path does", async () => {
    nextRow.current = TRUST_ROW;
    const res = await request(app())
      .post("/api/data-intel/blind-offer/commit")
      .send({ ...goodBody, propertyId: TRUST_PROPERTY });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(recordDecision, "a decision was recorded on a trust parcel").not.toHaveBeenCalled();
  });

  it("the parcel lookup names organization_id, not the id alone", async () => {
    // The tenancy claim, checked in SOURCE rather than by walking a drizzle
    // condition's internals — a walk of the query builder would be a test of
    // drizzle, and rendering SQL needs a dialect. What the runtime cases above
    // prove is that a lookup returning nothing is a 404; what this proves is
    // that the lookup is scoped, which is the half that makes the 404 mean
    // something. An id-only lookup is exactly the shape that produced the
    // buyer-qualification IDOR.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { stripCommentsPreservingLines } = await import("../../scripts/lib/strip-comments.mjs");
    const src = stripCommentsPreservingLines(
      fs.readFileSync(path.resolve(__dirname, "../../server/routes-data-intelligence.ts"), "utf8"),
    );
    const i = src.indexOf('router.post("/blind-offer/commit"');
    expect(i, "the commit route moved or was renamed").toBeGreaterThan(-1);
    const body = src.slice(i, i + 2500);
    expect(body).toContain("eq(properties.id, input.propertyId)");
    expect(
      body,
      "the parcel lookup does not name properties.organizationId",
    ).toContain("eq(properties.organizationId, org.id)");
  });

  it("rejects a malformed body before touching the database", async () => {
    const res = await request(app())
      .post("/api/data-intel/blind-offer/commit")
      .send({ propertyId: OWN_PROPERTY, offerAmount: -1, salePrice: 100_000, tier: "standard" });
    expect(res.status).toBe(422);
    expect(selectFn).not.toHaveBeenCalled();
  });

  it("FAILS the request when the decision write fails — it is not best-effort", async () => {
    // The whole point of the endpoint is the record. Swallowing this and
    // returning 201 would tell the operator their reasoning was frozen when it
    // was not, which is the defect ledger 41 closed one surface over.
    recordDecision.mockRejectedValueOnce(new Error("db down"));
    const res = await request(app()).post("/api/data-intel/blind-offer/commit").send(goodBody);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body?.decisionSnapshotId).toBeUndefined();
  });

  it("vacuity: the happy path really does reach the writers", async () => {
    // Every refusal above asserts the writers were NOT called. If the route
    // were broken outright they would all pass.
    const res = await request(app()).post("/api/data-intel/blind-offer/commit").send(goodBody);
    expect(res.status).toBe(200);
    expect(recordScenario).toHaveBeenCalled();
    expect(recordDecision).toHaveBeenCalled();
  });
});
