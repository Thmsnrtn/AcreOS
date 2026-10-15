import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
const h = vi.hoisted(() => ({ select: vi.fn(), locked: vi.fn(), find: vi.fn(), brand: vi.fn(), transaction: vi.fn(), update: vi.fn(), set: vi.fn(), where: vi.fn(), returning: vi.fn(), insert: vi.fn(), values: vi.fn() }));
vi.mock("../../server/db", () => ({ db: { query: { decisionsInboxItems: { findFirst: h.find }, brandProfiles: { findFirst: h.brand } }, transaction: h.transaction } }));
vi.mock("../../server/auth/clerkAuth", () => ({ isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(), requireFounder: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../../server/services/cmo/storage", () => ({ getStorage: vi.fn() }));
import { registerCmoRoutes } from "../../server/routes-cmo";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const app = express(); app.use(express.json()); registerCmoRoutes(app);
import { cmoReviewRevision } from "../../server/services/cmo/reviewRevision";
const item = { id: 1, itemType: "cmo_ad_review", status: "pending", actionPayload: { bundleId: "bundle-1" }, contextBundle: { renders: [{ id: "render-1" }] } };
const render = { id: "render-1", status: "ready", bundleId: "bundle-1", aspectRatio: "9:16", storagePath: "local:test.mp4" };
const approvalBody = { inboxItemId: 1, reviewRevision: cmoReviewRevision(item, [render]) };
const tx = { select: h.select, update: h.update, insert: h.insert };
beforeEach(() => {
  vi.resetAllMocks();
  h.find.mockResolvedValue(item);
  const chain = { from: () => chain, where: () => chain, orderBy: () => chain, for: h.locked };
  h.select.mockReturnValue(chain);
  h.locked.mockResolvedValueOnce([item]).mockResolvedValueOnce([render]);
  h.brand.mockResolvedValue({ id: 1 });
  h.transaction.mockImplementation((execute: (executor: typeof tx) => Promise<unknown>) => execute(tx));
  h.update.mockReturnValue({ set: h.set }); h.set.mockReturnValue({ where: h.where }); h.where.mockReturnValue({ returning: h.returning });
  h.returning.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([{ id: "render-1" }]);
  h.insert.mockReturnValue({ values: h.values });
});
describe("CMO approval queue transaction boundary", () => {
  it("claims one decision and stages both destinations on the transaction executor", async () => {
    const response = await request(app).post("/api/founder/cmo/approve").send(approvalBody);
    expect(response.status).toBe(200); expect(response.body.broadcastQueued).toBe(2);
    expect(h.transaction).toHaveBeenCalledOnce();
    expect(h.values.mock.calls.map(([event]) => event.payload.platform)).toEqual(["meta", "tiktok"]);
    expect(h.values.mock.calls.every(([event]) => event.eventType === "cmo.broadcast" && event.payload.inboxItemId === 1)).toBe(true);
  });
  it("does not enqueue when another request already claimed the decision", async () => {
    h.returning.mockReset().mockResolvedValueOnce([]);
    const response = await request(app).post("/api/founder/cmo/approve").send(approvalBody);
    expect(response.status).toBe(409); expect(h.insert).not.toHaveBeenCalled();
  });
  it("does not report approval success or enqueue when a review asset disappeared", async () => {
    h.returning.mockReset().mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);
    const response = await request(app).post("/api/founder/cmo/approve").send(approvalBody);
    expect(response.status).toBe(500); expect(h.insert).not.toHaveBeenCalled();
  });
  it("approval binds the pending snapshot and only ready renders of that bundle", async () => {
    await request(app).post("/api/founder/cmo/approve").send({ ...approvalBody, platforms: ["meta"] });
    const queries = h.where.mock.calls.map(([predicate]) => new PgDialect().sqlToQuery(predicate as SQL));
    expect(queries[0].sql).toContain('"context_bundle" =');
    expect(queries[1].params).toContain("bundle-1"); expect(queries[1].params).toContain("ready");
    expect(h.set.mock.calls[0][0].contextBundle).toBeDefined();
  });
  it("refuses contradictory bundle identities before mutating anything", async () => {
    h.find.mockResolvedValue({ id: 1, itemType: "cmo_ad_review", status: "pending", actionPayload: { bundleId: "bundle-1" }, contextBundle: { bundleId: "other", renders: [{ id: "render-1" }] } });
    const response = await request(app).post("/api/founder/cmo/approve").send(approvalBody);
    expect(response.status).toBe(400); expect(h.transaction).not.toHaveBeenCalled();
  });
  it("refuses a stale displayed revision before any mutation", async () => {
    const response = await request(app).post("/api/founder/cmo/approve").send({ ...approvalBody, reviewRevision: "0".repeat(64) });
    expect(response.status).toBe(409); expect(h.update).not.toHaveBeenCalled(); expect(h.insert).not.toHaveBeenCalled();
  });
  it("refuses changed render metadata even when the inbox context is unchanged", async () => {
    h.locked.mockReset().mockResolvedValueOnce([item]).mockResolvedValueOnce([{ ...render, storagePath: "local:replacement.mp4" }]);
    const response = await request(app).post("/api/founder/cmo/approve").send(approvalBody);
    expect(response.status).toBe(409); expect(h.update).not.toHaveBeenCalled();
  });
  it("queues portrait only for TikTok and records the approved render/platform pairs", async () => {
    const square = { ...render, id: "square", aspectRatio: "1:1" };
    const current = { ...item, contextBundle: { renders: [{ id: render.id }, { id: square.id }] } };
    h.find.mockResolvedValue(current);
    h.locked.mockReset().mockResolvedValueOnce([current]).mockResolvedValueOnce([render, square]);
    h.returning.mockReset().mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([{ id: render.id }, { id: square.id }]);
    const response = await request(app).post("/api/founder/cmo/approve").send({ inboxItemId: 1, reviewRevision: cmoReviewRevision(current, [render, square]) });
    expect(response.status).toBe(200); expect(response.body.broadcastQueued).toBe(3);
    expect(h.values.mock.calls.map(([event]) => [event.payload.renderId, event.payload.platform])).toEqual([[render.id, "meta"], [square.id, "meta"], [render.id, "tiktok"]]);
    const params = new PgDialect().sqlToQuery(h.set.mock.calls[0][0].contextBundle as SQL).params;
    const approved = JSON.parse(params.find(value => typeof value === "string" && value.includes("approvedDestinations")) as string);
    expect(approved.approvedDestinations).toEqual([{ renderId: render.id, platform: "meta" }, { renderId: square.id, platform: "meta" }, { renderId: render.id, platform: "tiktok" }]);
  });
  it("refuses a selected platform with no eligible render", async () => {
    const square = { ...render, aspectRatio: "1:1" };
    h.locked.mockReset().mockResolvedValueOnce([item]).mockResolvedValueOnce([square]);
    const response = await request(app).post("/api/founder/cmo/approve").send({ ...approvalBody, platforms: ["tiktok"], reviewRevision: cmoReviewRevision(item, [square]) });
    expect(response.status).toBe(400); expect(h.update).not.toHaveBeenCalled();
  });
  it("a late rejection cannot revoke an already approved review", async () => {
    h.find.mockResolvedValue({ id: 1, itemType: "cmo_ad_review", status: "approved" });
    const response = await request(app).post("/api/founder/cmo/reject").send({ inboxItemId: 1 });
    expect(response.status).toBe(409); expect(h.transaction).not.toHaveBeenCalled(); expect(h.insert).not.toHaveBeenCalled();
  });
  it("a concurrent loser rejects nothing and writes no rejection note", async () => {
    h.returning.mockReset().mockResolvedValueOnce([]);
    const response = await request(app).post("/api/founder/cmo/reject").send({ inboxItemId: 1 });
    expect(response.status).toBe(409); expect(h.insert).not.toHaveBeenCalled();
  });
  it("claims rejection, writes its note, and rejects only ready bundle assets on the transaction", async () => {
    h.returning.mockReset().mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([{ id: 4 }]).mockResolvedValueOnce([{ id: "render-1" }]);
    h.values.mockReturnValue({ returning: h.returning });
    const response = await request(app).post("/api/founder/cmo/reject").send({ inboxItemId: 1, tags: ["quality"] });
    expect(response.status).toBe(200); expect(response.body.rejectionNoteId).toBe(4);
    expect(h.transaction).toHaveBeenCalledOnce();
    const queries = h.where.mock.calls.map(([predicate]) => new PgDialect().sqlToQuery(predicate as SQL));
    expect(queries[0].params).toContain("pending"); expect(queries[0].sql).toContain('"context_bundle" =');
    expect(queries[1].params).toContain("ready"); expect(queries[1].params).toContain("bundle-1");
  });
});
