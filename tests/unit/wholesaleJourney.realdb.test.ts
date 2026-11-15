/**
 * The wholesale journey, rehearsed end to end against a REAL database built
 * from this repository — Leg 5's local half.
 *
 * The staging walk (docs/evidence/2026-11-05/wholesale-journey-walk.md) is the
 * evidence for the later beta-lift PR; it needs a staging session this build
 * did not have. This test drives the SAME API sequence through the real
 * routes, so the walk is known to be possible in code before anyone runs it:
 *
 *   activate → buy box → candidate (triaged) → decision → contract (preview →
 *   draft) → compliance gate both directions (IL blocked, TX passes) →
 *   packet → blast PREVIEW (no send) → assignment signed → outcome recorded
 *   and graded.
 *
 * Found while rehearsing: an IL assignment on the contract chain is refused
 * BEFORE the compliance gate, because no reviewed IL assignment template
 * exists (STATE_NOT_CONFIGURED). The staging walk should expect that.
 *
 * The e-sign rail is the org's own provider and cannot run here; the
 * assignment's `signed` status is set the way the rail's completion would set
 * it, and the staging walk does it through the rail itself.
 *
 * NO SEND: the email transport is a spy that must never be called.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("wholesaleJourney.realdb.test.ts");

const sent = vi.hoisted(() => ({ emails: 0 }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/services/emailService", () => ({
  sendEmail: vi.fn(async () => {
    sent.emails += 1;
    return { success: true };
  }),
}));

const tag = `wjr-${Math.random().toString(36).slice(2, 10)}`;
const USER_ID = `${tag}-user`;
let org = 0;
const ids: Record<string, number> = {};

async function q(text: TemplateStringsArray, ...vals: unknown[]) {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const r = await db.execute(sql(text, ...vals));
  return (r as unknown as { rows: Array<Record<string, any>> }).rows;
}

let app: express.Express;
async function buildApp() {
  const { default: underwriting } = await import("../../server/routes-wholesale-underwriting");
  const { default: disposition } = await import("../../server/routes-wholesale-disposition");
  const { default: buyBox } = await import("../../server/routes-wholesale-buy-box");
  const { registerBuyerBlastRoutes } = await import("../../server/routes-buyer-blasts");
  const { registerContractChainRoutes } = await import("../../server/routes-contract-chain");
  const a = express();
  a.use(express.json());
  a.use(async (req: any, _res, next) => {
    const { storage } = await import("../../server/storage");
    req.organization = await storage.getOrganization(org);
    req.organizationId = org;
    req.user = { id: USER_ID };
    next();
  });
  a.use("/api/wholesale", underwriting);
  a.use("/api/wholesale", disposition);
  a.use("/api/wholesale", buyBox);
  registerBuyerBlastRoutes(a);
  registerContractChainRoutes(a);
  return a;
}

const INPUTS = { arvCents: 30_000_000, rehabEstimateCents: 4_000_000, targetFeeCents: 1_000_000, sellerRulePct: 75, sellerContingencyPct: 10, buyerRulePct: 70, buyerContingencyPct: 10 };
const counts = async () => ({
  blasts: (await q`SELECT count(*)::int AS n FROM buyer_blasts WHERE organization_id = ${org}`)[0].n,
  recipients: (await q`SELECT count(*)::int AS n FROM buyer_blast_recipients WHERE organization_id = ${org}`)[0].n,
});

describe.runIf(realDbAvailable)("the wholesale journey — rehearsed on a real database", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    // 1. ACTIVATE: a fresh wholesaler org, no sample data.
    const [o] = await db
      .insert(organizations)
      .values({
        name: `${tag} Wholesale LLC`,
        slug: tag,
        ownerId: `${tag}-owner`,
        legalEntityName: `${tag} Wholesale LLC`,
        onboardingCompleted: true,
        onboardingData: { businessType: "residential_wholesaler" },
      } as never)
      .returning();
    org = o.id;
    app = await buildApp();
  });

  afterAll(async () => {
    const { pool } = await import("../../server/db");
    if (org) {
      for (const t of ["buyer_blast_recipients", "buyer_blasts", "buyer_property_matches", "buyer_profiles", "outcomes", "decision_snapshots", "scenarios", "generated_documents", "contract_assignments", "deals", "properties", "leads"]) {
        await q`DELETE FROM ${(await import("drizzle-orm")).sql.identifier(t)} WHERE organization_id = ${org}`;
      }
      await q`DELETE FROM organizations WHERE id = ${org}`;
    }
    await pool.end();
  });

  it("walks the whole journey, and never sends", async () => {
    // 2. BUY BOX — the operator's own criteria, versioned.
    const box = await request(app).post("/api/wholesale/buy-box").send({ criteria: { states: ["TX"], maxPurchasePriceCents: 20_000_000, staleAfterDays: 30 } });
    expect(box.status, JSON.stringify(box.body)).toBe(200);

    // 3. CANDIDATES — typed by hand (bring-your-own), one TX, one IL.
    for (const [key, state, apn] of [["tx", "TX", "1"], ["il", "IL", "2"]] as const) {
      const [p] = await q`INSERT INTO properties (organization_id, apn, county, state, size_acres, status, address, city, zip, legal_description)
        VALUES (${org}, ${`${tag}-${apn}`}, ${state === "TX" ? "Harris" : "Cook"}, ${state}, '0.2', 'prospect', ${`9 ${key} St`}, ${state === "TX" ? "Houston" : "Chicago"}, '77002', 'Lot 1, Block 2')
        RETURNING id`;
      ids[key] = p.id;
      // The seller is a contact the operator typed in (bring-your-own).
      const [seller] = await q`INSERT INTO leads (organization_id, first_name, last_name, type) VALUES (${org}, 'Sam', ${`Seller ${key}`}, 'seller') RETURNING id`;
      await q`UPDATE properties SET seller_id = ${seller.id} WHERE id = ${p.id}`;
      const [d] = await q`INSERT INTO deals (organization_id, property_id, type, status, offer_amount)
        VALUES (${org}, ${p.id}, 'acquisition', 'negotiating', '140000') RETURNING id`;
      ids[`${key}Deal`] = d.id;
    }
    const triage = await request(app).get("/api/wholesale/candidates/triage");
    expect(triage.status).toBe(200);
    const verdicts = Object.fromEntries(triage.body.rows.map((r: { propertyId: number; verdict: string }) => [r.propertyId, r.verdict]));
    expect(verdicts[ids.tx]).toBe("fits");
    expect(verdicts[ids.il]).toBe("fails");

    // 4. DECISION — the wholesale desk, with evidence, citing a wholesale_mao scenario.
    const decision = await request(app)
      .post("/api/wholesale/underwrite")
      .send({
        propertyId: ids.tx,
        inputs: INPUTS,
        evidence: { comps: [{ address: "12 Oak St", soldPriceCents: 29_500_000, soldOn: "2026-09-14" }], arvBasis: "One renovated 3/2 two streets over.", feeBasis: "My floor for a full-kitchen rehab." },
        kind: "offer",
        choice: "Offer up to $156,000 to assign at $10,000",
        rationale: "The buyer's number binds and the fee holds.",
        reviewDueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      });
    expect(decision.status, JSON.stringify(decision.body)).toBe(200);
    ids.decision = decision.body.decisionId;

    // The seller accepts: the property is now under an assignable contract.
    for (const key of ["tx", "il"]) {
      await q`UPDATE properties SET status = 'under_contract' WHERE id = ${ids[key]}`;
      await q`UPDATE deals SET status = 'accepted', accepted_amount = '140000', closing_date = now() + interval '30 days', updated_at = now() WHERE id = ${ids[`${key}Deal`]}`;
      const [a] = await q`INSERT INTO contract_assignments (organization_id, deal_id, end_buyer_name, assignment_fee_cents, original_contract_date, status)
        VALUES (${org}, ${ids[`${key}Deal`]}, 'Cash Buyer Co', 1100000, current_date, 'draft') RETURNING id`;
      ids[`${key}Assignment`] = a.id;
    }

    // 5 + 6. CONTRACT, with the compliance gate in BOTH directions.
    const preview = (key: string) =>
      request(app).get(`/api/deals/${ids[`${key}Deal`]}/contract-preview`).query({ kind: "assignment_of_contract", assignmentId: String(ids[`${key}Assignment`]) });
    const draft = (key: string, contentHash: string) =>
      request(app).post(`/api/deals/${ids[`${key}Deal`]}/contract`).send({ kind: "assignment_of_contract", assignmentId: ids[`${key}Assignment`], confirmReviewed: true, reviewedContentHash: contentHash });
    const docs = () => q`SELECT deal_id FROM generated_documents WHERE organization_id = ${org}`;

    const txPreview = await preview("tx");
    expect(txPreview.status, JSON.stringify(txPreview.body)).toBe(200);
    expect(await docs(), "the preview writes nothing").toEqual([]);
    const txDraft = await draft("tx", txPreview.body.contentHash);
    expect(txDraft.status, JSON.stringify(txDraft.body)).toBeLessThan(300);
    expect((await docs()).map((d) => d.deal_id)).toEqual([ids.txDeal]);

    // IL on the contract chain stops even EARLIER than the compliance gate:
    // no reviewed IL assignment template exists, so nothing is assembled.
    // The state-rule block is shown on the offer path below (and pinned for
    // the document paths in offerCompliance.realdb.test.ts).
    const ilPreview = await preview("il");
    expect(ilPreview.status).toBe(422);
    expect(JSON.stringify(ilPreview.body)).toMatch(/STATE_NOT_CONFIGURED/);
    expect((await docs()).map((d) => d.deal_id), "nothing was written for IL").toEqual([ids.txDeal]);

    const ilBlast = await request(app).post(`/api/properties/${ids.il}/blast-buyers`).send({ subject: "s", body: "b", dryRun: true, minMatchScore: 0, financingType: "any" });
    expect(ilBlast.status).toBe(409);
    expect(ilBlast.body.error).toBe("wholesaler_compliance_blocked");

    // 7. MATCH / PACKET / BLAST PREVIEW — preview only, never a send.
    const [lead] = await q`INSERT INTO leads (organization_id, first_name, last_name, email, type) VALUES (${org}, 'Bea', 'Buyer', ${`${tag}@example.test`}, 'buyer') RETURNING id`;
    const [bp] = await q`INSERT INTO buyer_profiles (organization_id, lead_id, is_active, financial_info) VALUES (${org}, ${lead.id}, true, '{"financingType":"cash"}'::jsonb) RETURNING id`;
    await q`INSERT INTO buyer_property_matches (organization_id, buyer_profile_id, property_id, match_score) VALUES (${org}, ${bp.id}, ${ids.tx}, 90)`;

    const packet = await request(app).get(`/api/wholesale/properties/${ids.tx}/disposition-packet`);
    expect(packet.status, JSON.stringify(packet.body)).toBe(200);
    expect(packet.body.price).toMatchObject({ buyerPriceCents: 15_000_000, withinBuyerCeiling: true });

    const before = await counts();
    const txBlast = await request(app)
      .post(`/api/properties/${ids.tx}/blast-buyers`)
      .send({ subject: packet.body.subject, body: packet.body.html, dryRun: true, minMatchScore: 0, financingType: "cash" });
    expect(txBlast.status, JSON.stringify(txBlast.body)).toBe(200);
    expect(txBlast.body.recipientCount).toBe(1);
    expect(await counts()).toEqual(before);
    expect(sent.emails, "the journey sends nothing").toBe(0);

    // 8. ASSIGNMENT — signed (on staging, by the org's own e-sign rail).
    await q`UPDATE contract_assignments SET status = 'signed' WHERE id = ${ids.txAssignment}`;

    // 9. OUTCOME — realised fee read from the signed assignment, graded.
    const outcome = await request(app)
      .post(`/api/wholesale/decisions/${ids.decision}/outcome`)
      .send({ exit: "assignment", assignmentId: ids.txAssignment, closedOn: new Date().toISOString().slice(0, 10) });
    expect(outcome.status, JSON.stringify(outcome.body)).toBe(200);
    expect(outcome.body.realizedFeeCents).toBe(1_100_000);
    const { outcomesForDecision } = await import("../../server/services/outcomes/outcomeStore");
    const [graded] = await outcomesForDecision(org, ids.decision);
    expect(graded.variance.find((v) => v.metricId === "profit")).toMatchObject({ state: "compared", predicted: 1_000_000, actual: 1_100_000 });

    expect(sent.emails, "still nothing sent").toBe(0);
  });
});
