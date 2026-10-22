/**
 * A new user gets ONE organization, however many requests their first screen
 * fires at once — and a user who owns several resolves to the same one on
 * every request.
 *
 * Measured on the customer-journey audit (issue #359): the synthetic user's
 * first authenticated page fired its queries in parallel, every one of them
 * reached getOrCreateOrg's "no org yet" branch, and each created an org —
 * four organizations, inside 70 ms, for one user. getOrganizationByOwner then
 * read `WHERE owner_id = $1` with no ORDER BY, so which of the four a request
 * resolved to followed heap order, and an UPDATE moves a row to the end of the
 * heap. Completing onboarding on one org therefore made the NEXT request
 * resolve to another, un-onboarded one: /today redirected back into the
 * wizard and the journey's "first-value CTA on /today" check failed on some
 * attempts and passed on others. A real signup's first screen fires the same
 * parallel queries.
 *
 * Runs against a real database (a mock cannot evaluate a lock or a scan
 * order); only authentication is replaced by a header, the middleware is the
 * real one.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("orgProvisioningIsSingular.db");

vi.mock("../../server/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/auth")>();
  return {
    ...real,
    isAuthenticated: (req: any, res: any, next: any) => {
      const id = req.header("x-test-user");
      if (!id) return res.status(401).json({ error: "unauthorized" });
      req.user = { id, email: req.header("x-test-email") ?? null, firstName: "Race" };
      next();
    },
  };
});
vi.mock("../../server/services/loginAnomalyDetector", () => ({ recordAndAlertIfNew: async () => undefined }));
vi.mock("../../server/services/emailChangeDetector", () => ({ detectAndAlertEmailChange: async () => undefined }));
vi.mock("../../server/services/onboardingAutonomy", () => ({ startJourney: async () => undefined }));

describe.runIf(realDbAvailable)("org provisioning — one org per user, resolved the same way every time", () => {
  const tag = `org-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const PARALLEL = 8;

  let app: import("express").Express;
  let db: typeof import("../../server/db").db;
  let schema: typeof import("../../shared/schema");
  let orm: typeof import("drizzle-orm");
  const owners: string[] = [];

  beforeAll(async () => {
    const express = (await import("express")).default;
    ({ db } = await import("../../server/db"));
    schema = await import("../../shared/schema");
    orm = await import("drizzle-orm");
    const { isAuthenticated } = await import("../../server/auth");
    const { getOrCreateOrg } = await import("../../server/middleware/getOrCreateOrg");
    app = express();
    app.get("/probe", isAuthenticated, getOrCreateOrg, (req: any, res) => {
      res.json({ organizationId: req.organizationId });
    });
  });

  afterAll(async () => {
    if (owners.length === 0) return;
    await db.delete(schema.organizations).where(orm.inArray(schema.organizations.ownerId, owners));
  });

  const ownedOrgIds = async (ownerId: string) =>
    (
      await db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(orm.eq(schema.organizations.ownerId, ownerId))
    ).map((r) => r.id);

  it(`${PARALLEL} simultaneous first requests create exactly one org, and all of them get it`, async () => {
    const userId = `${tag}-new`;
    owners.push(userId);
    const responses = await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        request(app).get("/probe").set({ "x-test-user": userId, "x-test-email": `${userId}@race.test` }),
      ),
    );
    // Vacuity guard: every request must have reached the handler — a request
    // refused before provisioning would make "one org" trivially true.
    expect(responses.map((r) => r.status)).toEqual(Array(PARALLEL).fill(200));

    const ids = await ownedOrgIds(userId);
    expect(ids).toHaveLength(1);
    expect(new Set(responses.map((r) => r.body.organizationId))).toEqual(new Set(ids));

    const members = await db
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(orm.eq(schema.teamMembers.userId, userId));
    expect(members).toHaveLength(1);
  });

  it("a user who owns several orgs resolves to the oldest on every request, even after the others are written", async () => {
    const userId = `${tag}-multi`;
    owners.push(userId);
    const rows = await db
      .insert(schema.organizations)
      .values(
        [0, 1, 2].map((i) => ({ name: `${tag}-multi-${i}`, slug: `${tag}-multi-${i}`, ownerId: userId })) as never,
      )
      .returning({ id: schema.organizations.id });
    const oldest = Math.min(...rows.map((r) => r.id));

    // Write the oldest one LAST so its new tuple version sits after the
    // others — the state completing onboarding left the journey user in. The
    // slug is written too because it is indexed: that makes the update
    // non-HOT, so the new version also gets a new index entry, and the move
    // shows through an index scan as well as a sequential one.
    for (const r of [...rows].sort((a, b) => b.id - a.id)) {
      await db
        .update(schema.organizations)
        .set({ name: `${tag}-touched-${r.id}`, slug: `${tag}-touched-${r.id}` } as never)
        .where(orm.eq(schema.organizations.id, r.id));
    }

    const { storage } = await import("../../server/storage");
    for (let i = 0; i < 3; i++) {
      expect((await storage.getOrganizationByOwner(userId))?.id).toBe(oldest);
      const r = await request(app).get("/probe").set({ "x-test-user": userId });
      expect(r.status).toBe(200);
      expect(r.body.organizationId).toBe(oldest);
    }
  });
});
