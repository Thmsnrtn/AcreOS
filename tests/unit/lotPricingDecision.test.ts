/**
 * Locking a subdivision's price grid is an ACT whose reasoning was thrown away.
 *
 * `POST /api/parcels/:id/pricing-rules/lock` writes every child lot's
 * `listPrice`. That is the asking price the market sees — the moment the grid
 * stops being a preview and becomes a commitment, which is the criterion units
 * 22–29 settled on for adoption.
 *
 * What it preserved was `lockedGrid`: the OUTPUT rows — base, premium, asking
 * price, override flag. What it preserved of the REASONING was nothing:
 *
 *   - `rules` and `basePriceSource` live in the SAME MUTABLE ROW the lock
 *     updates. Editing the rules tomorrow leaves the grid intact and destroys
 *     the explanation for it. That is canonical law "historical decisions
 *     preserve what was known", violated by construction rather than by
 *     oversight — there was nowhere else for the rules to live.
 *   - the derived base-per-acre was never stored at all, so you cannot tell
 *     whether a lock used the parent's AVM or an operator's fixed $/acre.
 *   - no engine version, though the arithmetic lives in a versionable module
 *     (`@shared/subdivision/lotPricing.ts`) that can and will change.
 *
 * THE MIRROR IMAGE OF THE NOTE PAYOFF PATH. That path is pinned in
 * `MUST_NOT_ADOPT` precisely because `note_payoff_quotes` already carries
 * `engine_version` NOT NULL and verbatim `engine_input_json` — wiring it would
 * create a second owner of the same state. Lot pricing has neither, which is
 * what makes it the right surface and the payoff path the wrong one. The rule
 * is one sentence: **adopt where the reasoning would otherwise be LOST; never
 * where an equivalent versioned record already owns it.**
 *
 * WAVE V2 (2026-10-04) MADE THE LOCK GRADEABLE, and two invariants here were
 * rewritten to the new truth rather than deleted. This file used to pin "no
 * Scenario" and "reviewDueAt: null", for reasons that were right at the time:
 * a bare price grid carries no `total_cost` or `profit`, and an outcome
 * question whose answers do not fit is worse than none. What changed is that
 * the lock now carries the operator's sell-out economics (selling cost, months
 * to sell out, the parent's cost basis, subdivision costs, carry), and the
 * subdivider's own engine — `subdivision_lot_sale`, declaring `subdivider` —
 * turns the LOCKED prices into a predicted gross sell-out, total cost and
 * profit. The outcome vocabulary's `sold` measures exactly that `profit`, and
 * `still_open` is the honest answer while lots remain unsold. So the scenario
 * is no longer invented to satisfy a count: it is the prediction the lock
 * makes, and the operator's review date is the question it can now answer.
 * The original invariants survive as: the scenario comes from the subdivider's
 * OWN engine, predicts what an outcome measures, and the review date is the
 * operator's answer, never hard-coded.
 * (tests/unit/lotPricingLockRecordsScenario.test.ts proves the behaviour.)
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  LOT_PRICING_ENGINE_VERSION,
  computeLotPricingGrid,
} from "@shared/subdivision/lotPricing";
import { DECISION_KINDS } from "@shared/decisions/snapshot";
import { subdivisionLotSaleEngine } from "../../server/services/economics/engines/subdivisionLotSale";
import { OUTCOME_MEASURES } from "../../shared/outcomes/outcomeMeasures";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

const route = stripComments(
  fs.readFileSync(path.join(ROOT, "server/routes-lot-pricing.ts"), "utf8"),
);
/**
 * The lock handler ALONE — bounded at the next route registration rather than
 * run to end-of-file.
 *
 * The first version of this file sliced to EOF, and it cost a false pass: an
 * assertion that the RULE SET is frozen matched `computeLotPricingGrid(...,
 * rules.rules ?? []).map(...)` — the grid computation twenty lines earlier —
 * so deleting the frozen copy outright still passed. The mutation was verified
 * to have applied, which is the only reason it was caught. A window drawn wider
 * than the thing it claims to inspect is the recurring defect in this program's
 * own source scans.
 */
const lockHandler = (() => {
  const at = route.indexOf('"/api/parcels/:id/pricing-rules/lock"');
  if (at === -1) return "";
  const next = route.indexOf("app.post(", at + 10);
  return next === -1 ? route.slice(at) : route.slice(at, next);
})();

describe("the lock records the reasoning it used to discard", () => {
  it("finds the lock handler (vacuity guard)", () => {
    expect(lockHandler.length, "the lock route is gone — renamed?").toBeGreaterThan(1000);
    expect(lockHandler, "the lock no longer writes listPrice — is it still an act?")
      .toContain("listPrice");
  });

  it("records a decision", () => {
    expect(lockHandler).toContain("recordDecision(");
  });

  it("uses the EXISTING `price` kind rather than inventing one", () => {
    // DECISION_KINDS is deliberately closed: an open string would let every
    // feature invent its own kind and Decision Memory would stop being
    // comparable across time, which is the whole source of its value. "price —
    // set or change an asking/offer price" already describes this exactly.
    expect(DECISION_KINDS).toContain("price");
    expect(lockHandler).toMatch(/kind:\s*"price"/);
  });

  it("names a capability, not a generic system authority", () => {
    // BI72: automation must name the capability grant that permitted it, never
    // a global "autonomous mode". A user action names the role that acted.
    expect(lockHandler).toMatch(/authority:\s*"org_member:lot_pricing_lock"/);
    expect(lockHandler).toMatch(/actorType:\s*"user"/);
    expect(lockHandler).toContain("actorRef: userId");
  });

  it("freezes the three things the row could not keep", () => {
    // Each of these is in the snapshot BECAUSE the mutable row loses it.
    expect(lockHandler, "the derived base-per-acre is not frozen")
      .toContain("base_per_acre_cents");
    expect(lockHandler, "the engine version is not frozen")
      .toContain("LOT_PRICING_ENGINE_VERSION");
    // Asserted on the key the frozen copy emits, NOT on `rules.rules ?? []`,
    // which also appears in the grid computation above — matching that made
    // this assertion pass with the frozen copy deleted.
    expect(lockHandler, "the rule set is not copied — editing rules would erase the explanation")
      .toContain("key: `rule_${i}`");
  });

  it("distinguishes an operator's own base from a derived one", () => {
    // A fixed $/acre is the customer's number; an AVM-derived one is the
    // platform's. Flattening them would let a platform figure read back later
    // as what the customer believed — the failure `origin` exists to prevent.
    expect(lockHandler).toMatch(
      /origin:\s*rules\.basePriceSource === "fixed_per_acre" \? "user" : "derived"/,
    );
  });

  it("records overrides as ALTERNATIVES, since the derived price was available", () => {
    // A decision is reconstructable as a CHOICE only if what lost is recorded.
    // Here the rules-derived price genuinely was on offer, so these are real
    // alternatives rather than the empty list most decisions honestly carry.
    expect(lockHandler).toContain("alternatives:");
    expect(lockHandler).toMatch(/overridden\.map/);
  });
});

describe("the lock is a gradeable prediction, not a bare price change", () => {
  it("records a Scenario from the subdivider's OWN engine, and the decision cites it", () => {
    // Formerly "records no Scenario": a bare grid had no total_cost or profit,
    // and inventing an engine to move the adoption count would have rewarded
    // the wrong thing. The invariant that survives is that the scenario is the
    // subdivider's real prediction — from an engine that declares subdivider —
    // and not some other vertical's arithmetic borrowed for the count.
    expect(lockHandler).toMatch(/recordScenario\(orgId,\s*\{[\s\S]{0,400}engineId:\s*"subdivision_lot_sale"/);
    expect(subdivisionLotSaleEngine.id).toBe("subdivision_lot_sale");
    expect(subdivisionLotSaleEngine.verticals).toEqual(["subdivider"]);
    expect(lockHandler).toMatch(/recordDecision\([\s\S]{0,4000}\[scenario\.id\]/);
    const scen = lockHandler.indexOf("recordScenario(");
    expect(scen, "the scenario must be written before the decision that cites it")
      .toBeLessThan(lockHandler.indexOf("recordDecision("));
  });

  it("the scenario predicts what the outcome prompt measures", () => {
    // Formerly the reason for no review date: the outcome answers did not fit a
    // price grid. They fit now because the prediction does — `sold` asks what
    // the project actually made, which is `profit`, and the engine predicts it.
    expect(subdivisionLotSaleEngine.produces).toEqual(expect.arrayContaining(["profit", "total_cost"]));
    // The ids live in the shared definition the card renders (DEFECT-0287).
    const prompt = fs.readFileSync(path.join(ROOT, "client/src/components/today/OutcomePrompt.tsx"), "utf8");
    expect(prompt).toMatch(/kind:\s*"sold"[\s\S]{0,200}measures:\s*OUTCOME_MEASURES\.sold/);
    expect(OUTCOME_MEASURES.sold.metricId).toBe("profit");
  });

  it("carries the operator's review date — never hard-coded to null", () => {
    // Formerly "sets no review date". The rule that survives: the date is the
    // operator's answer, refused when missing, never a constant.
    expect(lockHandler).not.toMatch(/reviewDueAt:\s*null/);
    expect(lockHandler).toMatch(/reviewDueAt:\s*body\.reviewDueAt \? new Date\(body\.reviewDueAt\) : null/);
    // Required in the request schema: nullable ("no set date" is an answer)
    // but never omittable.
    const schema = route.slice(route.indexOf("const lockSchema"), route.indexOf("async function loadRecordedParentBasisCents"));
    expect(schema).toMatch(/reviewDueAt:\s*z\s*\.string\(\)\s*\.datetime\(\)\s*\.nullable\(\)\s*\.refine\(/);
    expect(schema).not.toMatch(/reviewDueAt:[^\n]*(optional|nullish|default)/);
  });
});

describe("the record cannot outlive the act it describes", () => {
  it("records AFTER the transaction, not before", () => {
    // Recording first would let a failed lock leave an immutable snapshot
    // asserting a price change that never happened — and a decision record is
    // not rewritable. A lock with no snapshot is a gap; a snapshot with no lock
    // is a lie. The offer path (unit 22) records first because its id must be
    // in the INSERT; here the link is a follow-up UPDATE, so it need not.
    const tx = lockHandler.indexOf("db.transaction(");
    const rec = lockHandler.indexOf("recordDecision(");
    const scen = lockHandler.indexOf("recordScenario(");
    expect(tx, "the lock no longer runs in a transaction").toBeGreaterThan(-1);
    expect(rec, "recordDecision is gone").toBeGreaterThan(-1);
    expect(scen, "recordScenario is gone").toBeGreaterThan(-1);
    expect(rec, "the decision is recorded BEFORE the lock commits").toBeGreaterThan(tx);
    // The scenario is a record too: written before the lock commits, it would
    // predict a sell-out at prices the market never saw.
    expect(scen, "the scenario is recorded BEFORE the lock commits").toBeGreaterThan(tx);
  });

  it("failing to record does not fail the lock", () => {
    // The operator's pricing must not fail because the reasoning could not be
    // written. A null link says so honestly; a 500 would lose the pricing too.
    expect(lockHandler).toMatch(/catch\s*\(err\)\s*\{[\s\S]{0,300}logger\.error/);
    expect(lockHandler).toContain("locked but its reasoning was NOT recorded");
  });

  it("the link is org-scoped on write", () => {
    // Every write in this repo carries its tenant. A decision id written onto
    // another org's row would be a cross-tenant reference.
    const at = lockHandler.indexOf("lockedDecisionSnapshotId: decision.id");
    expect(at, "the decision link is not written").toBeGreaterThan(-1);
    expect(lockHandler.slice(at, at + 300)).toContain("lotPricingRules.organizationId");
  });
});

describe("the pieces the record rests on are real", () => {
  it("the engine declares a version", () => {
    expect(LOT_PRICING_ENGINE_VERSION).toMatch(/^lot-pricing-\d+$/);
  });

  it("the schema carries the link column", () => {
    const schema = fs.readFileSync(path.join(ROOT, "shared/schema/subdivision.ts"), "utf8");
    expect(schema).toContain('lockedDecisionSnapshotId: integer("locked_decision_snapshot_id")');
  });

  it("the column is mirrored into the deploy migrator", () => {
    // A schema column with no mirror in scripts/migrate.mjs 500s on deploy —
    // this repo's most expensive recurring defect.
    const migrate = fs.readFileSync(path.join(ROOT, "scripts/migrate.mjs"), "utf8");
    expect(migrate).toContain('"lot_pricing_rules" ADD COLUMN IF NOT EXISTS "locked_decision_snapshot_id"');
  });

  it("the engine still computes what the record claims it computed", () => {
    // The snapshot's rationale names a base per acre and a premium rule count.
    // If the engine's arithmetic stopped matching that description the record
    // would be narrating something it did not do.
    const grid = computeLotPricingGrid(
      100_000, // $1,000/acre
      [
        { id: 1, childLotNumber: "1", sizeAcres: 2, attributes: { corner: true } },
        { id: 2, childLotNumber: "2", sizeAcres: 2, attributes: { corner: false } },
      ],
      [{ attribute: "corner", operator: "==", threshold: true, premiumPct: 0.1 }],
    );
    expect(grid[0].basePriceCents).toBe(200_000);
    expect(grid[0].premiumPct).toBeCloseTo(0.1);
    expect(grid[0].askingPriceCents).toBe(220_000);
    // The un-matched lot pays base — no premium invented.
    expect(grid[1].askingPriceCents).toBe(200_000);
  });
});
