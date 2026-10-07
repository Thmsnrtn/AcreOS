/**
 * A due-diligence checklist belongs to the organization that holds the
 * property, and the read says so itself (storage.getDueDiligenceChecklist
 * takes the organization). Against a real database built from the repo: the
 * predicate is evaluated by Postgres, not by a mock that agrees with any WHERE.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("dueDiligenceChecklistScope.db");

describe.runIf(realDbAvailable)("due-diligence checklists are read within the organization", () => {
  let storage: typeof import("../../server/storage").storage;
  let db: typeof import("../../server/db").db;
  let schema: typeof import("../../shared/schema");
  let eq: typeof import("drizzle-orm").eq;
  let inArray: typeof import("drizzle-orm").inArray;
  const tag = `ddscope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let orgA = 0;
  let orgB = 0;
  let propA = 0;

  beforeAll(async () => {
    ({ storage } = await import("../../server/storage"));
    ({ db } = await import("../../server/db"));
    schema = await import("../../shared/schema");
    ({ eq, inArray } = await import("drizzle-orm"));
    const [a] = await db.insert(schema.organizations).values({ name: `${tag}-a`, slug: `${tag}-a`, ownerId: `${tag}-owner-a` }).returning();
    const [b] = await db.insert(schema.organizations).values({ name: `${tag}-b`, slug: `${tag}-b`, ownerId: `${tag}-owner-b` }).returning();
    orgA = a.id;
    orgB = b.id;
    const [p] = await db
      .insert(schema.properties)
      .values({ organizationId: orgA, apn: `${tag}-apn`, county: "Llano", state: "TX", sizeAcres: "10" })
      .returning();
    propA = p.id;
  });

  afterAll(async () => {
    if (!orgA) return;
    await db.delete(schema.dueDiligenceChecklists).where(inArray(schema.dueDiligenceChecklists.organizationId, [orgA, orgB]));
    await db.delete(schema.properties).where(eq(schema.properties.id, propA));
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgA, orgB]));
  });

  it("the holder's checklist is never another organization's answer — in either order", async () => {
    // A starts its checklist and writes a private note.
    const mine = await storage.getOrCreateDueDiligenceChecklist(orgA, propA);
    await storage.updateDueDiligenceChecklist(mine.id, { notes: `${tag}-private` } as never, orgA);
    // B reading the same property id finds nothing of A's.
    expect(await storage.getDueDiligenceChecklist(orgB, propA)).toBeUndefined();
    // A reads its own row back.
    const again = await storage.getDueDiligenceChecklist(orgA, propA);
    expect(again?.id).toBe(mine.id);
    expect(again?.organizationId).toBe(orgA);
  });

  it("a row another organization started on the property is never served to the holder", async () => {
    await db.delete(schema.dueDiligenceChecklists).where(eq(schema.dueDiligenceChecklists.propertyId, propA));
    // B's row exists first (the repository does not check the property; the
    // route does — dueDiligenceChecklistRoute.test.ts).
    const theirs = await storage.getOrCreateDueDiligenceChecklist(orgB, propA);
    const mine = await storage.getOrCreateDueDiligenceChecklist(orgA, propA);
    expect(mine.id).not.toBe(theirs.id);
    expect(mine.organizationId).toBe(orgA);
    expect((await storage.getDueDiligenceChecklist(orgA, propA))?.id).toBe(mine.id);
  });
});
