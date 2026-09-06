/**
 * The outcome of lead #42 was written onto prediction #42.
 *
 * `POST /api/seller-intent/:leadId/outcome` read `req.params.leadId`, named the
 * variable `leadId`, and passed it to a service method whose parameter was
 * `predictionId` — under a comment that said so out loud:
 *
 *     // recordOutcome(predictionId, outcome). finalPrice/notes are not accepted
 *     // by the service (they were silently dropped at runtime previously).
 *     await sellerIntentPredictorService.recordOutcome(leadId, outcome);
 *
 * Two ids of different entities share a numeric space, so nothing threw and
 * nothing logged. `seller_intent_predictions` row #42 — belonging to whichever
 * lead and whichever ORGANIZATION happened to own it — had its `actualOutcome`
 * and `predictionAccurate` overwritten with another lead's result. That data is
 * the model's own accuracy record.
 *
 * The tenancy defect and the identity defect were the same line. `recordOutcome`
 * took no organization at all, so the write was cross-tenant; and it could not
 * be scoped without first deciding **which of the two entities the caller
 * actually meant**. Taking a `leadId` honestly, and resolving the lead's latest
 * prediction within the caller's org, answers both.
 *
 * WHY THIS FILE EXISTS RATHER THAN A LINE IN A TENANCY TEST. A checker that
 * verifies "the org is passed" would have gone green on the old code the moment
 * an org argument was added to the wrong-entity call. The invariant worth
 * pinning is that the ROUTE's parameter and the SERVICE's parameter name the
 * same thing.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

const service = stripComments(
  fs.readFileSync(path.join(ROOT, "server/services/sellerIntentPredictor.ts"), "utf8"),
);
const routes = stripComments(
  fs.readFileSync(path.join(ROOT, "server/routes-seller-intent.ts"), "utf8"),
);
const orchestrator = stripComments(
  fs.readFileSync(path.join(ROOT, "server/services/negotiationOrchestrator.ts"), "utf8"),
);

describe("the route's id and the service's parameter name the same entity", () => {
  it("the endpoint is still keyed by leadId (vacuity guard)", () => {
    expect(routes, "the outcome endpoint is gone").toContain('"/:leadId/outcome"');
  });

  it("recordOutcome takes a leadId, not a predictionId", () => {
    const at = service.indexOf("async recordOutcome(");
    expect(at, "recordOutcome is gone — renamed?").toBeGreaterThan(-1);
    const sig = service.slice(at, service.indexOf(")", service.indexOf("(", at)));
    expect(
      sig,
      "recordOutcome takes a predictionId again while its only caller passes a " +
        "leadId. The two ids share a numeric space, so this mismatch does not " +
        "throw — it writes one lead's outcome onto another lead's prediction.",
    ).toContain("leadId");
    expect(sig, "recordOutcome lost its organization").toContain("organizationId");
    expect(sig).not.toContain("predictionId");
  });

  it("it resolves the prediction FROM the lead, within the org", () => {
    // Bounded at the SELECT's own `.limit(1);`, not at a fixed offset. A
    // window wide enough to include the UPDATE below is satisfied by the
    // UPDATE's org predicate — a mutation that stripped the org from the
    // SELECT survived this assertion until the bound was tightened.
    const at = service.indexOf("async recordOutcome(");
    const selectAt = service.indexOf("db.select().from(sellerIntentPredictions)", at);
    expect(selectAt, "the prediction lookup is gone").toBeGreaterThan(-1);
    const end = service.indexOf(".limit(1);", selectAt);
    expect(end, "the lookup is no longer bounded by limit(1)").toBeGreaterThan(-1);
    const body = service.slice(selectAt, end);
    expect(body).toContain("eq(sellerIntentPredictions.leadId, leadId)");
    expect(
      body,
      "the prediction lookup dropped the organization — the UPDATE below still " +
        "has one, which is what made a too-wide window read as passing",
    ).toContain("eq(sellerIntentPredictions.organizationId, organizationId)");
    // Latest, not arbitrary: a lead accumulates predictions over time and the
    // outcome belongs to the most recent one.
    expect(body, "the prediction is picked arbitrarily rather than latest-first")
      .toContain("orderBy(desc(sellerIntentPredictions.createdAt))");
  });

  it("the select and the update are two different checks", () => {
    // Stated separately so neither can stand in for the other.
    const at = service.indexOf("async recordOutcome(");
    const updateAt = service.indexOf("db.update(sellerIntentPredictions)", at);
    expect(updateAt, "the update is gone").toBeGreaterThan(-1);
    const body = service.slice(updateAt, service.indexOf("));", updateAt) + 3);
    expect(body).toContain("eq(sellerIntentPredictions.organizationId, organizationId)");
  });

  it("the write is anchored to the row it just resolved", () => {
    const at = service.indexOf("async recordOutcome(");
    const body = service.slice(at, at + 2200);
    expect(body).toContain("eq(sellerIntentPredictions.id, prediction.id)");
    expect(
      body,
      "the update is keyed by a caller-supplied id again",
    ).not.toMatch(/eq\(sellerIntentPredictions\.id,\s*(lead|prediction)Id\)/);
  });

  it("the route passes the caller's org and renders the refusal as 404", () => {
    // 2026-08-18: the argument ORDER changed — `recordOutcome` is now
    // organization-first, matching `negotiationOrchestrator.recordOutcome` and
    // the house convention, because two same-named methods taking two numbers
    // in opposite orders is a swap the compiler cannot see (see
    // `argumentOrderHazard.test.ts`). The INVARIANT this test was written for
    // is unchanged and still asserted: the route passes a LEAD id, the service
    // parameter is named `leadId`, and the caller's org travels with it.
    expect(routes).toContain("recordOutcome(getOrganizationId(req), leadId, outcome)");
    // Pin the order itself, or a future swap re-creates the bug this file
    // exists for — with the lead id landing in the organization slot.
    expect(
      routes,
      "the organization is no longer the FIRST argument to recordOutcome",
    ).toMatch(/recordOutcome\(\s*getOrganizationId\(req\)\s*,\s*leadId\s*,/);
    expect(routes).toContain("SellerIntentNotInOrgError");
    expect(routes).toContain('Errors.notFound(res, "Prediction")');
  });

  it("the event payload records both ids, not the one that was wrong", () => {
    // The agent event used to carry `predictionId` bound to the leadId value —
    // so the audit trail agreed with the bug. Both are named explicitly now.
    const at = service.indexOf("async recordOutcome(");
    const body = service.slice(at, at + 2600);
    expect(body).toContain("predictionId: prediction.id");
    expect(body).toContain("leadId");
  });
});

describe("the negotiation orchestrator checks the thread is the org's", () => {
  it("recordOutcome scopes its thread lookup", () => {
    // Same unit, same shape: the org and the threadId both arrive from the
    // caller, and nothing verified they belong together — so an outcome could
    // be filed against another org's thread and its strategyId read back out.
    const at = orchestrator.indexOf("async recordOutcome(");
    expect(at, "recordOutcome is gone").toBeGreaterThan(-1);
    const body = orchestrator.slice(at, at + 1800);
    expect(body).toContain("eq(negotiationThreads.organizationId, Number(organizationId))");
    expect(
      body,
      "the thread is resolved by id alone again",
    ).not.toMatch(/where\(\s*eq\(negotiationThreads\.id,[^)]*\)\s*\)/);
  });
});
