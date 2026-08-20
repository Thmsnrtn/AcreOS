/**
 * A route's guard must match the authority it exercises.
 *
 * Two findings, one rule.
 *
 * ── 1. PROVING YOU OWN ROW 41 OF ONE TABLE IS NOT OWNING ROW 41 OF ANOTHER ───
 * `GET /api/buyer-qualification/:id/probability` verified that `:id` was a
 * `buyer_qualifications` row belonging to the caller's org — and then passed
 * that same integer into `estimateClosingProbability(buyerProfileId, …)`, which
 * resolved `eq(buyerProfiles.id, <a qualification id>)` with no org predicate.
 * Two tables, two independent serial sequences. Whenever they lined up the
 * caller read another tenant's buyer profile: budget band, `preApproved`,
 * urgency, financing type, acreage preferences. The `propertyId` on the same
 * call came straight off the query string and was never checked at all.
 *
 * It is also wrong for its own owner, which is probably why nobody noticed:
 * `grep -rn buyer-qualification client/src` returns nothing, so the endpoint is
 * dark. And the repository's own tenancy register HAD it —
 * `"server/services/buyerQualificationBot.ts::estimateClosingProbability"` sat
 * in `check-org-scoped-fetch.mjs`'s BASELINE_UNUSED_ORG. Frozen debt is a list
 * of live defects with the alarm turned off; fixing this one made the entry go
 * stale, which is how that gate reported the fix.
 *
 * ── 2. THE BULK FORM OF A DELETE WAS REACHABLE BY PEOPLE DENIED ITS UNIT FORM ─
 * `POST /api/clear-demo-data` carried `isAuthenticated, getOrCreateOrg` and
 * nothing else, and deletes the org's entire FK closure — leads, properties,
 * deals, notes, payments, activity log. `member`, `va` and `viewer` are each
 * blocked from deleting a SINGLE lead and could all call it. The confirmation
 * lived in the client, which is a dialog, not a permission.
 *
 * The second describe block below pins the general shape rather than the one
 * route: every role denied the unit delete must also be denied the bulk one.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

const ORG_ID = 42;
const QUALIFICATION_ID = 41;
const BUYER_PROFILE_ID = 77; // deliberately NOT the qualification id
const PROPERTY_ID = 900;

const { getQualificationById, estimateClosingProbability } = vi.hoisted(() => ({
  getQualificationById: vi.fn(),
  // Parameters are declared so `mock.calls[0]` is a 3-tuple rather than `[]` —
  // an argument-less mock makes every index access a type error, and this file
  // exists precisely to assert WHICH arguments arrive.
  estimateClosingProbability: vi.fn(
    async (_organizationId: number, _buyerProfileId: number, _propertyId: number) => ({
      probability: 55,
      factors: [] as string[],
      confidence: 70,
    }),
  ),
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: ORG_ID, ownerId: "user_owner" };
    req.user = { id: "user_owner" };
    next();
  },
}));
vi.mock("../../server/services/buyerQualificationBot", () => ({
  buyerQualificationBotService: { getQualificationById, estimateClosingProbability },
}));

const { default: buyerQualificationRouter } = await import(
  "../../server/routes-buyer-qualification"
);

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/buyer-qualification", buyerQualificationRouter);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  estimateClosingProbability.mockResolvedValue({ probability: 55, factors: [] as string[], confidence: 70 });
});

describe("the probability route resolves the buyer profile, not the qualification", () => {
  it("passes the org and the BUYER PROFILE id — not the id it proved ownership of", async () => {
    getQualificationById.mockResolvedValue({
      id: QUALIFICATION_ID,
      organizationId: ORG_ID,
      buyerProfileId: BUYER_PROFILE_ID,
    });

    const res = await request(app())
      .get(`/api/buyer-qualification/${QUALIFICATION_ID}/probability`)
      .query({ propertyId: String(PROPERTY_ID) });

    expect(res.status).toBe(200);
    expect(estimateClosingProbability).toHaveBeenCalledTimes(1);

    const args = estimateClosingProbability.mock.calls[0];
    expect(args[0], "the org must be passed so the service can scope its reads").toBe(ORG_ID);
    expect(
      args[1],
      "the second argument is a buyer_profiles id. Passing the qualification id " +
        "here is the cross-tenant read this test exists for.",
    ).toBe(BUYER_PROFILE_ID);
    expect(args[1]).not.toBe(QUALIFICATION_ID);
    expect(args[2]).toBe(PROPERTY_ID);
  });

  it("vacuity: the two ids differ in this fixture, so the assertion can fail", () => {
    // If the fixture ever set buyerProfileId === id, the case above would pass
    // against the defective implementation too.
    expect(BUYER_PROFILE_ID).not.toBe(QUALIFICATION_ID);
  });

  it("still 404s a qualification belonging to another org", async () => {
    // The pre-existing guard, restated: the fix must not have loosened it while
    // changing what the helper returns.
    getQualificationById.mockResolvedValue(undefined);
    const res = await request(app())
      .get(`/api/buyer-qualification/${QUALIFICATION_ID}/probability`)
      .query({ propertyId: String(PROPERTY_ID) });
    expect(res.status).toBe(404);
    expect(estimateClosingProbability).not.toHaveBeenCalled();
  });

  it("still rejects a missing propertyId before calling anything", async () => {
    getQualificationById.mockResolvedValue({
      id: QUALIFICATION_ID,
      organizationId: ORG_ID,
      buyerProfileId: BUYER_PROFILE_ID,
    });
    const res = await request(app()).get(
      `/api/buyer-qualification/${QUALIFICATION_ID}/probability`,
    );
    expect(res.status).toBe(400);
    expect(estimateClosingProbability).not.toHaveBeenCalled();
  });
});

describe("clearing the whole workspace is at least as guarded as deleting one row", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const adminSrc = () => fs.readFileSync(path.join(ROOT, "server/routes-admin.ts"), "utf8");

  /** The middleware chain a route is registered with, as source text. */
  function registrationOf(src: string, routePath: string): string | null {
    const i = src.indexOf(`api.post("${routePath}"`);
    if (i === -1) return null;
    return src.slice(i, src.indexOf("async (req", i));
  }

  it("the route carries a permission guard", () => {
    const chain = registrationOf(adminSrc(), "/api/clear-demo-data");
    expect(chain, "the clear-data route registration moved or was renamed").not.toBeNull();
    expect(
      chain,
      "POST /api/clear-demo-data deletes the org's entire FK closure. " +
        "isAuthenticated + getOrCreateOrg is 'any member of any org', which is " +
        "not a permission.",
    ).toContain('requirePermission("canDeleteOrg")');
  });

  it("FIRES when the guard is removed", () => {
    const stripped = adminSrc().replace(', requirePermission("canDeleteOrg")', "");
    expect(stripped, "the mutation did not apply — re-anchor it").not.toBe(adminSrc());
    const chain = registrationOf(stripped, "/api/clear-demo-data");
    expect(chain).not.toContain("requirePermission");
  });

  it("every role denied a single delete is denied the bulk one", async () => {
    // The rule, over the REAL permission table rather than the one route. A
    // role that may not delete one lead must not be able to delete every lead,
    // every property, every deal and every payment in one call.
    const { getPermissionsForRole, ROLES } = await import("../../server/utils/permissions");
    const roles = ROLES as readonly string[];
    expect(roles.length, "the role list collapsed").toBeGreaterThanOrEqual(4);

    let deniedUnitDelete = 0;
    for (const role of roles) {
      const p = getPermissionsForRole(role as never);
      if (p.canDeleteLeads && p.canDeleteProperties) continue;
      deniedUnitDelete += 1;
      expect(
        p.canDeleteOrg,
        `role "${role}" may not delete a single lead/property but holds ` +
          "canDeleteOrg, which is the permission guarding the bulk wipe",
      ).toBe(false);
    }
    expect(
      deniedUnitDelete,
      "no role is denied the unit delete, so the rule above checked nothing",
    ).toBeGreaterThan(0);
  });

  it("canDeleteOrg is genuinely narrower than membership", async () => {
    // Vacuity from the other side: if every role held it, the guard would be
    // decoration.
    const { getPermissionsForRole, ROLES } = await import("../../server/utils/permissions");
    const holders = (ROLES as readonly string[]).filter(
      (r) => getPermissionsForRole(r as never).canDeleteOrg,
    );
    expect(holders.length, "canDeleteOrg is held by every role").toBeLessThan(
      (ROLES as readonly string[]).length,
    );
    expect(holders.length, "canDeleteOrg is held by nobody — the route is unreachable").toBeGreaterThan(0);
  });
});
