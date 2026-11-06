/**
 * Wholesale disposition packet + outcome record (Leg 4), against a REAL
 * database built from this repository. FALSIFYING: on pre-leg code neither
 * route exists.
 *
 * PACKET
 *   1. the buyer price is the deal's accepted contract price + the frozen
 *      target fee, checked against the buyer ceiling re-computed from the
 *      frozen inputs;
 *   2. RE-DERIVED at draft time: renegotiate the contract price and the next
 *      packet's price moves — nothing was stored to go stale;
 *   3. drafting writes nothing (scenarios, decisions, outcomes, blasts) and
 *      sends nothing;
 *   4. refusals: no accepted contract price; no wholesale decision; another
 *      org's property is a 404.
 * OUTCOME (graded through the existing loop)
 *   5. assignment: the fee is read from the SIGNED assignment, days-to-close is
 *      derived, and the variance against the frozen `profit` prediction is
 *      computed by outcomesForDecision; an unsigned assignment is refused;
 *   6. double close: the spread net of the funder fee; refused unless both_closed;
 *   7. walked: abandoned, fee 0, profit unmeasured (null, never zero);
 *   8. a non-wholesale decision, a future close date and another org's
 *      assignment are refused, writing nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("wholesaleDisposition.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `wdp-${Math.random().toString(36).slice(2, 10)}`;
const USER_ID = `${tag}-user`;
let org = 0;
let other = 0;
const ids = { prop: 0, propNoDeal: 0, propNoDecision: 0, otherProp: 0, deal: 0, decision: 0, otherDeal: 0 };

const INPUTS = {
  arvCents: 30_000_000,
  rehabEstimateCents: 4_000_000,
  targetFeeCents: 1_000_000,
  sellerRulePct: 75,
  sellerContingencyPct: 10,
  buyerRulePct: 70,
  buyerContingencyPct: 10,
};
// buyer-side MAO = 300k × 70% − 44k = $166,000

async function q(text: TemplateStringsArray, ...vals: unknown[]) {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const r = await db.execute(sql(text, ...vals));
  return (r as unknown as { rows: Array<Record<string, any>> }).rows;
}

async function appFor(organizationId: number) {
  const { default: underwriting } = await import("../../server/routes-wholesale-underwriting");
  const { default: disposition } = await import("../../server/routes-wholesale-disposition");
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: organizationId };
    req.organizationId = organizationId;
    req.user = { id: USER_ID };
    next();
  });
  a.use("/api/wholesale", underwriting);
  a.use("/api/wholesale", disposition);
  return a;
}
const packet = async (propertyId: number, organizationId = org) =>
  request(await appFor(organizationId)).get(`/api/wholesale/properties/${propertyId}/disposition-packet`);
const outcome = async (decisionId: number, body: Record<string, unknown>, organizationId = org) =>
  request(await appFor(organizationId)).post(`/api/wholesale/decisions/${decisionId}/outcome`).send(body);
const counts = async () => ({
  scenarios: (await q`SELECT count(*)::int AS n FROM scenarios WHERE organization_id = ${org}`)[0].n,
  decisions: (await q`SELECT count(*)::int AS n FROM decision_snapshots WHERE organization_id = ${org}`)[0].n,
  outcomes: (await q`SELECT count(*)::int AS n FROM outcomes WHERE organization_id = ${org}`)[0].n,
  blasts: (await q`SELECT count(*)::int AS n FROM buyer_blasts WHERE organization_id = ${org}`)[0].n,
});
const today = () => new Date().toISOString().slice(0, 10);

async function decide(propertyId: number): Promise<number> {
  const res = await request(await appFor(org))
    .post("/api/wholesale/underwrite")
    .send({
      propertyId,
      inputs: INPUTS,
      evidence: {
        comps: [{ address: "12 Oak St", soldPriceCents: 29_500_000, soldOn: "2026-09-14" }],
        arvBasis: "One renovated 3/2 sale two streets over.",
        feeBasis: "My floor for a full-kitchen rehab.",
      },
      kind: "offer",
      choice: "Offer up to $156,000",
      rationale: "The buyer's number binds and the fee holds.",
      reviewDueAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.decisionId;
}

describe.runIf(realDbAvailable)("wholesale disposition packet + outcome — real database", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    const [a] = await db.insert(organizations).values({ name: `${tag}-a`, slug: `${tag}-a`, ownerId: `${tag}-oa` } as never).returning();
    const [b] = await db.insert(organizations).values({ name: `${tag}-b`, slug: `${tag}-b`, ownerId: `${tag}-ob` } as never).returning();
    org = a.id;
    other = b.id;
    const mk = async (o: number, key: string) =>
      (await q`INSERT INTO properties (organization_id, apn, county, state, size_acres, status, address, city)
               VALUES (${o}, ${`${tag}-${key}`}, 'Harris', 'TX', '0.2', 'under_contract', ${`9 ${key} St`}, 'Houston') RETURNING id`)[0].id;
    ids.prop = await mk(org, "main");
    ids.propNoDeal = await mk(org, "nodeal");
    ids.propNoDecision = await mk(org, "nodecision");
    ids.otherProp = await mk(other, "other");
    const deal = async (o: number, p: number, accepted: string | null) =>
      (await q`INSERT INTO deals (organization_id, property_id, type, status, accepted_amount)
               VALUES (${o}, ${p}, 'acquisition', 'under_contract', ${accepted}) RETURNING id`)[0].id;
    ids.deal = await deal(org, ids.prop, "140000");
    await deal(org, ids.propNoDecision, "140000");
    ids.otherDeal = await deal(other, ids.otherProp, "140000");
    ids.decision = await decide(ids.prop);
    await decide(ids.propNoDeal);
  });

  afterAll(async () => {
    const { pool } = await import("../../server/db");
    for (const o of [org, other].filter(Boolean)) {
      await q`DELETE FROM outcomes WHERE organization_id = ${o}`;
      await q`DELETE FROM decision_snapshots WHERE organization_id = ${o}`;
      await q`DELETE FROM scenarios WHERE organization_id = ${o}`;
      await q`DELETE FROM contract_assignments WHERE organization_id = ${o}`;
      await q`DELETE FROM double_close_deals WHERE organization_id = ${o}`;
      await q`DELETE FROM deals WHERE organization_id = ${o}`;
      await q`DELETE FROM properties WHERE organization_id = ${o}`;
      await q`DELETE FROM organizations WHERE id = ${o}`;
    }
    await pool.end();
  });

  describe("the packet", () => {
    it("1+3. price = contract price + frozen fee, checked against the re-computed buyer ceiling; drafting writes nothing", async () => {
      const before = await counts();
      const res = await packet(ids.prop);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.price).toEqual({
        contractPriceCents: 14_000_000,
        targetFeeCents: 1_000_000,
        buyerPriceCents: 15_000_000,
        buyerSideMaoCents: 16_600_000,
        withinBuyerCeiling: true,
      });
      expect(res.body.decisionId).toBe(ids.decision);
      expect(res.body.subject).toContain("$150,000");
      expect(res.body.html).toContain("12 Oak St");
      expect(res.body.html).toContain("$300,000");
      expect(await counts()).toEqual(before);
    });

    it("2. re-derived at draft time — a renegotiated contract price moves the packet; above the buyer's ceiling is flagged", async () => {
      await q`UPDATE deals SET accepted_amount = '160000', updated_at = now() WHERE id = ${ids.deal}`;
      const res = await packet(ids.prop);
      expect(res.body.price.buyerPriceCents).toBe(17_000_000);
      expect(res.body.price.withinBuyerCeiling).toBe(false);
      await q`UPDATE deals SET accepted_amount = '140000', updated_at = now() WHERE id = ${ids.deal}`;
      expect((await packet(ids.prop)).body.price.buyerPriceCents).toBe(15_000_000);
    });

    it("4. refuses with no accepted contract price, with no wholesale decision, and across orgs", async () => {
      const noDeal = await packet(ids.propNoDeal);
      expect(noDeal.status).toBe(409);
      expect(noDeal.body.message).toMatch(/contract price/);
      const noDecision = await packet(ids.propNoDecision);
      expect(noDecision.status).toBe(409);
      expect(noDecision.body.message).toMatch(/Underwrite/);
      expect((await packet(ids.otherProp)).status).toBe(404);
      expect((await packet(ids.prop, other)).status).toBe(404);
    });
  });

  describe("the outcome", () => {
    it("5. assignment: fee read from the SIGNED assignment, days derived, graded against the frozen prediction", async () => {
      const [unsigned] = await q`INSERT INTO contract_assignments (organization_id, deal_id, end_buyer_name, assignment_fee_cents, status)
        VALUES (${org}, ${ids.deal}, 'Cash Co', 1250000, 'sent_for_signature') RETURNING id`;
      const before = await counts();
      const refused = await outcome(ids.decision, { exit: "assignment", assignmentId: unsigned.id, closedOn: today() });
      expect(refused.status).toBe(409);
      expect(await counts()).toEqual(before);

      await q`UPDATE contract_assignments SET status = 'signed' WHERE id = ${unsigned.id}`;
      const res = await outcome(ids.decision, { exit: "assignment", assignmentId: unsigned.id, closedOn: today() });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ realizedFeeCents: 1_250_000, daysToClose: 0, exit: "assignment" });
      expect(res.body.body.kind).toBe("sold");
      expect(res.body.body.summary).toMatch(/Realised fee \$12,500/);

      const { outcomesForDecision } = await import("../../server/services/outcomes/outcomeStore");
      const [graded] = await outcomesForDecision(org, ids.decision);
      const profit = graded.variance.find((v) => v.metricId === "profit");
      expect(profit, JSON.stringify(graded.variance)).toBeDefined();
      expect(profit!.state).toBe("compared");
      expect(profit!.predicted).toBe(1_000_000);
      expect(profit!.actual).toBe(1_250_000);
      expect(profit!.delta).toBe(250_000);
    });

    it("6. double close: spread net of the funder fee; refused unless both_closed", async () => {
      const [dc] = await q`INSERT INTO double_close_deals (organization_id, property_id, a_seller_name, a_side_purchase_price_cents, bc_side_purchase_price_cents, transactional_funder_fee_cents, status)
        VALUES (${org}, ${ids.prop}, 'Sam Seller', 14000000, 15500000, 150000, 'a_side_closed') RETURNING id`;
      expect((await outcome(ids.decision, { exit: "double_close", doubleCloseId: dc.id, closedOn: today() })).status).toBe(409);
      await q`UPDATE double_close_deals SET status = 'both_closed' WHERE id = ${dc.id}`;
      const res = await outcome(ids.decision, { exit: "double_close", doubleCloseId: dc.id, closedOn: today() });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.realizedFeeCents).toBe(15_500_000 - 14_000_000 - 150_000);
    });

    it("7. walked: abandoned, fee 0, profit unmeasured (null, never zero)", async () => {
      const res = await outcome(ids.decision, { exit: "walked", closedOn: today() });
      expect(res.status).toBe(200);
      expect(res.body.body.kind).toBe("abandoned");
      expect(res.body.body.actuals).toEqual([
        { id: "assignment_fee", value: 0, unit: "cents" },
        { id: "profit", value: null, unit: "cents" },
      ]);
    });

    it("8. refuses a non-wholesale decision, a future date and another org's assignment — writing nothing", async () => {
      const { recordDecision } = await import("../../server/services/decisions/decisionStore");
      const plain = await recordDecision(
        org,
        { subjectType: "property", subjectId: ids.prop, kind: "pass", choice: "x", rationale: "plain decision", actorType: "user", actorRef: USER_ID, authority: "org_member:test", strategyPackId: null, strategyPackVersion: null, assumptions: [], alternatives: [], reviewDueAt: null } as never,
        new Date(),
        [],
      );
      const [otherAssignment] = await q`INSERT INTO contract_assignments (organization_id, deal_id, end_buyer_name, assignment_fee_cents, status)
        VALUES (${other}, ${ids.otherDeal}, 'X', 999, 'signed') RETURNING id`;
      const before = await counts();
      expect((await outcome(plain.id, { exit: "walked", closedOn: today() })).status).toBe(422);
      expect((await outcome(ids.decision, { exit: "walked", closedOn: "2099-01-01" })).status).toBe(422);
      expect((await outcome(ids.decision, { exit: "walked", closedOn: "2026-02-30" })).status).toBe(422);
      expect((await outcome(ids.decision, { exit: "assignment", assignmentId: otherAssignment.id, closedOn: today() })).status).toBe(404);
      expect((await outcome(ids.decision, { exit: "walked", closedOn: today() }, other)).status).toBe(404);
      expect(await counts()).toEqual(before);
    });
  });
});
