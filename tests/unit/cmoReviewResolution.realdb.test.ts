import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";
useRealDb("cmoReviewResolution.realdb.test.ts");
vi.mock("../../server/auth/clerkAuth", () => ({ isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(), requireFounder: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../../server/services/agentRejectionContext", () => ({ recordRejection: vi.fn() }));
const tag = `cmo-review-proof-${randomUUID()}`;
let brandId: number;
let dashboardBrandId: number | undefined;
let scriptId: string;
const itemIds: number[] = [];
const app = express(); app.use(express.json());

describe.runIf(realDbAvailable)("video review resolution on real PostgreSQL", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
  beforeAll(async () => {
    const { db } = await import("../../server/db"); const { brandProfiles, cmoScripts } = await import("@shared/schema");
    const [brand] = await db.insert(brandProfiles).values({ slug: tag, displayName: "Fixture", oneLiner: "Fixture", audiencePrimary: "Fixture", brandKit: { primaryColor: "black", secondaryColor: "white", fonts: { display: "sans", body: "sans" } }, voice: { provider: "elevenlabs", voiceId: null, stability: 0, similarityBoost: 0 } }).returning();
    brandId = brand.id;
    // The real dashboard requires the canonical brand. Create it only in this isolated test DB if absent;
    // never modify an existing row, and clean up only a row this fixture actually inserted.
    const [dashboardBrand] = await db.insert(brandProfiles).values({ slug: "acreos", displayName: "Fixture", oneLiner: "Fixture", audiencePrimary: "Fixture", brandKit: { primaryColor: "black", secondaryColor: "white", fonts: { display: "sans", body: "sans" } }, voice: { provider: "elevenlabs", voiceId: null, stability: 0, similarityBoost: 0 } }).onConflictDoNothing({ target: brandProfiles.slug }).returning({ id: brandProfiles.id });
    dashboardBrandId = dashboardBrand?.id;
    const [script] = await db.insert(cmoScripts).values({ brandProfileId: brandId, intent: "Fixture", funnelStage: "cold", hookArchetype: "fixture", hook: "Fixture", body: "Fixture", cta: "Fixture", lengthTargetSec: 15, brollQueries: [], scriptJson: {}, model: "fixture" }).returning();
    scriptId = script.id;
    const { registerCmoRoutes } = await import("../../server/routes-cmo"); registerCmoRoutes(app);
  });
  afterAll(async () => {
    const { db } = await import("../../server/db"); const { decisionsInboxItems, cmoRejectionNotes, cmoAdRenders, brandProfiles, outbox } = await import("@shared/schema"); const { eq, inArray, sql } = await import("drizzle-orm");
    for (const id of itemIds) await db.delete(outbox).where(sql`${outbox.payload}->>'inboxItemId' = ${String(id)}`);
    if (itemIds.length) await db.delete(decisionsInboxItems).where(inArray(decisionsInboxItems.id, itemIds));
    if (brandId) { await db.delete(cmoRejectionNotes).where(eq(cmoRejectionNotes.brandProfileId, brandId)); await db.delete(cmoAdRenders).where(eq(cmoAdRenders.brandProfileId, brandId)); await db.delete(brandProfiles).where(eq(brandProfiles.id, brandId)); }
    if (dashboardBrandId) await db.delete(brandProfiles).where(eq(brandProfiles.id, dashboardBrandId));
  });
  async function fixture(status = "ready") {
    const { db } = await import("../../server/db"); const { cmoAdRenders, decisionsInboxItems } = await import("@shared/schema");
    const bundleId = randomUUID();
    const [render] = await db.insert(cmoAdRenders).values({ scriptId, brandProfileId: brandId, bundleId, trackingId: randomUUID(), aspectRatio: "9:16", durationSec: 15, storagePath: "local:fixture.mp4", manifestJson: {}, status, costBreakdown: { scriptCents: 0, scoringCents: 0, voiceCents: 0, assetsCents: 0, renderCents: 0, totalCents: 0 } }).returning();
    // The actual legacy producer put bundleId in actionPayload, not context.
    const [item] = await db.insert(decisionsInboxItems).values({ itemType: "cmo_ad_review", sophieAnalysis: "Fixture", recommendedAction: "approve_and_broadcast", recommendedActionLabel: "Fixture", actionPayload: { bundleId }, contextBundle: { brandSlug: tag, renders: [{ id: render.id }] } }).returning();
    itemIds.push(item.id); return { item, render };
  }
  async function servedRevision(id: number): Promise<string> {
    const response = await request(app).get("/api/founder/cmo/dashboard");
    expect(response.status).toBe(200);
    const pending = response.body.pending.find((entry: { inboxItem: { id: number } }) => entry.inboxItem.id === id);
    expect(pending.reviewRevision).toMatch(/^[a-f0-9]{64}$/);
    return pending.reviewRevision;
  }
  it("concurrent approve/reject has one winner and a consistent card, render and outbox", async () => {
    const { item, render } = await fixture();
    const reviewRevision = await servedRevision(item.id);
    const results = await Promise.all([
      request(app).post("/api/founder/cmo/approve").send({ inboxItemId: item.id, reviewRevision, platforms: ["meta"] }),
      request(app).post("/api/founder/cmo/reject").send({ inboxItemId: item.id }),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const { db } = await import("../../server/db"); const { decisionsInboxItems, cmoAdRenders, outbox } = await import("@shared/schema"); const { eq, sql } = await import("drizzle-orm");
    const [card] = await db.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.id, item.id));
    const [asset] = await db.select().from(cmoAdRenders).where(eq(cmoAdRenders.id, render.id));
    const jobs = await db.select().from(outbox).where(sql`${outbox.payload}->>'inboxItemId' = ${String(item.id)}`);
    expect(asset.status).toBe(card.status); expect(jobs).toHaveLength(card.status === "approved" ? 1 : 0);
  });
  it("all four generic resolvers leave the pending video card and ready asset intact", async () => {
    const { item, render } = await fixture();
    const { decisionsInboxService } = await import("../../server/services/decisionsInbox");
    for (const resolve of [
      () => decisionsInboxService.approve(item.id),
      () => decisionsInboxService.reject(item.id, "fixture"),
      () => decisionsInboxService.defer(item.id),
      () => decisionsInboxService.override(item.id, "fixture"),
    ]) await expect(resolve()).rejects.toMatchObject({ code: "CMO_REVIEW_REQUIRED" });
    const { db } = await import("../../server/db");
    const { decisionsInboxItems, cmoAdRenders, outbox } = await import("@shared/schema");
    const { eq, sql } = await import("drizzle-orm");
    const [card] = await db.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.id, item.id));
    const [asset] = await db.select().from(cmoAdRenders).where(eq(cmoAdRenders.id, render.id));
    expect(card.status).toBe("pending"); expect(asset.status).toBe("ready");
    expect(await db.select().from(outbox).where(sql`${outbox.payload}->>'inboxItemId' = ${String(item.id)}`)).toHaveLength(0);
  });
  it("an existing but no-longer-ready asset refuses approval before the claim", async () => {
    const { item } = await fixture("rejected");
    const reviewRevision = await servedRevision(item.id);
    expect((await request(app).post("/api/founder/cmo/approve").send({ inboxItemId: item.id, reviewRevision, platforms: ["meta"] })).status).toBe(400);
    const { db } = await import("../../server/db"); const { decisionsInboxItems, outbox } = await import("@shared/schema"); const { eq, sql } = await import("drizzle-orm");
    const [card] = await db.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.id, item.id));
    expect(card.status).toBe("pending");
    expect(await db.select().from(outbox).where(sql`${outbox.payload}->>'inboxItemId' = ${String(item.id)}`)).toHaveLength(0);
  });  it("a render metadata change after the served review refuses approval without queueing", async () => {
    const { item, render } = await fixture();
    const reviewRevision = await servedRevision(item.id);
    const { db } = await import("../../server/db");
    const { cmoAdRenders, decisionsInboxItems, outbox } = await import("@shared/schema");
    const { eq, sql } = await import("drizzle-orm");
    await db.update(cmoAdRenders).set({ storagePath: "local:replacement.mp4" }).where(eq(cmoAdRenders.id, render.id));
    const response = await request(app).post("/api/founder/cmo/approve").send({ inboxItemId: item.id, reviewRevision, platforms: ["meta"] });
    expect(response.status).toBe(409);
    const [card] = await db.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.id, item.id));
    expect(card.status).toBe("pending");
    expect(await db.select().from(outbox).where(sql`${outbox.payload}->>'inboxItemId' = ${String(item.id)}`)).toHaveLength(0);
  });

});
