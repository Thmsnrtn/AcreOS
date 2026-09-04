/**
 * Three live customer routes resolved a property by id and never asked whose
 * it was.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * All three sit behind `isAuthenticated, getOrCreateOrg` and nothing else, and
 * all three took an id straight from the request:
 *
 *   GET  /api/compliance/properties/:id/check
 *        → checkPropertyCompliance(parseInt(req.params.id))
 *        read every compliance alert carrying that property id, from any org.
 *
 *   POST /api/compliance/disclosures
 *        → generateDisclosure(parseInt(propertyId), type)
 *        read another organization's PROPERTY and generated a disclosure
 *        document from it — then the route wrote an audit entry under the
 *        CALLER's org, recording a disclosure about a property they do not own.
 *
 *   GET  /api/land-credit/backtest/:propertyId
 *        → backtestScore(req.params.propertyId)
 *        read another organization's land-credit score history.
 *
 * All three were invisible to the org-scope lint because they read through
 * Drizzle's relational API (`db.query.<table>.findFirst`), which the gate —
 * keyed on `.from(` — had never looked at. They surfaced the day it was
 * widened (2026-09-04).
 *
 * ── THE TWO SHAPES OF SCOPING, AND WHY THEY DIFFER ──────────────────────────
 * compliance_alerts and properties carry `organization_id`, so their reads
 * gain the predicate directly. `land_credit_scores` does NOT, by design — its
 * own header records that scores are "reachable only through the org-owned
 * property row", which is what lets parcel-identity cohorts be assembled
 * without walking org structure. So backtestScore checks the PARENT: read the
 * property scoped to the org FIRST, and answer nothing if it is not theirs.
 *
 * idempotent: true — pure source reads, no DB.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Comments stripped: each fix names the old signature right above itself. */
const code = (rel: string) =>
  read(rel)
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

function body(rel: string, marker: string, span = 1400): string {
  const src = code(rel);
  const at = src.indexOf(marker);
  expect(at, `${marker} is gone from ${rel} — this test reads nothing`).toBeGreaterThan(-1);
  return src.slice(at, at + span);
}

describe("compliance reads name the organization", () => {
  it("checkPropertyCompliance takes it and uses it", () => {
    const fn = body("server/services/complianceAI.ts", "async checkPropertyCompliance(");
    expect(fn).toContain("organizationId: number");
    expect(fn).toContain("eq(complianceAlerts.organizationId, organizationId)");
  });

  it("generateDisclosure takes it and uses it on BOTH reads", () => {
    const fn = body("server/services/complianceAI.ts", "async generateDisclosure(", 2000);
    expect(fn).toContain("organizationId: number");
    expect(
      fn,
      "the property read is what makes the document — an unscoped one generates " +
        "a disclosure about someone else's land",
    ).toContain("eq(properties.organizationId, organizationId)");
    expect(fn).toContain("eq(complianceAlerts.organizationId, organizationId)");
  });

  it("both routes pass their own org, not a caller-supplied one", () => {
    const routes = code("server/routes-compliance.ts");
    expect(routes).toContain("checkPropertyCompliance(org.id, parseInt(req.params.id))");
    expect(routes).toContain("generateDisclosure(org.id, parseInt(propertyId), disclosureType)");
    // `org` comes from getOrCreateOrg on the request, never from the body.
    expect(routes).toMatch(/const org = req\.organization;/);
  });
});

describe("the land-credit backtest checks the parent it has", () => {
  const fn = body("server/services/landCredit.ts", "async backtestScore(", 2200);

  it("takes the organization and reads the property under it", () => {
    expect(fn).toContain("organizationId: number");
    expect(fn).toContain("eq(properties.organizationId, organizationId)");
  });

  it("the ownership check comes BEFORE the scores are read", () => {
    // A check after the read is a read that already happened.
    const propertyAt = fn.indexOf("eq(properties.organizationId, organizationId)");
    const scoresAt = fn.indexOf("db.query.landCreditScores.findMany");
    expect(propertyAt).toBeGreaterThan(-1);
    expect(scoresAt).toBeGreaterThan(-1);
    expect(
      propertyAt,
      "the scores are read before the property's owner is verified",
    ).toBeLessThan(scoresAt);
    // And a property that is not theirs returns the empty answer.
    expect(fn).toMatch(/if \(!property\) return EMPTY;/);
  });

  it("it does not invent an organization column the table lacks", () => {
    // land_credit_scores has no organization_id, deliberately. A predicate on
    // one would not compile — this pins the REASON so the next author reaches
    // for the parent check rather than adding the column.
    expect(fn).not.toContain("landCreditScores.organizationId");
    // The table's own header states the design. Read from the declaration so
    // a future author who adds organization_id has to face this line, and
    // decide deliberately rather than by reflex.
    const schema = read("shared/schema/marketplace.ts");
    const at = schema.indexOf('landCreditScores = pgTable("land_credit_scores"');
    expect(at).toBeGreaterThan(-1);
    const decl = schema.slice(at, at + 900);
    expect(decl).toContain("reachable\n  // only through the org-owned property row");
    expect(decl, "the table gained an organization_id — revisit the parent check").not.toMatch(
      /organizationId: integer\("organization_id"\)/,
    );
  });

  it("the route passes its own org", () => {
    expect(code("server/routes-land-credit.ts")).toContain(
      "landCredit.backtestScore(org.id, req.params.propertyId)",
    );
  });
});

describe("the burn-down is real", () => {
  it("all three are gone from the untriaged register", () => {
    const register = JSON.parse(read("scripts/org-scope-route-widening.json")) as {
      rule1: { method: string[]; function: string[]; route: string[] };
    };
    const all = [...register.rule1.method, ...register.rule1.function, ...register.rule1.route];
    for (const key of [
      "server/services/complianceAI.ts::checkPropertyCompliance",
      "server/services/complianceAI.ts::generateDisclosure",
      "server/services/landCredit.ts::backtestScore",
    ]) {
      expect(all, `${key} was fixed — its register line must go in the same commit`).not.toContain(key);
    }
  });
});
