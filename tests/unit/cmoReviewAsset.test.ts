import { beforeEach, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { publicationFixture, publicationVideoBytes } from "../helpers/cmoPublicationFixture";
const h = vi.hoisted(() => ({ find: vi.fn(), read: vi.fn() }));
vi.mock("../../server/db", () => ({ db: { query: { cmoAdRenders: { findFirst: h.find } } } }));
vi.mock("../../server/auth/clerkAuth", () => ({ isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(), requireFounder: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../../server/services/cmo/storage", () => ({ getStorage: () => ({ read: h.read }) }));
import { registerCmoRoutes } from "../../server/routes-cmo";
const app = express(); registerCmoRoutes(app);
const query = { key: "fixture.mp4", renderId: "render", assetRevision: publicationFixture.video.sha256 };
beforeEach(() => {
  vi.resetAllMocks(); h.read.mockResolvedValue(publicationVideoBytes);
  h.find.mockResolvedValue({ id: "render", scriptId: "script", brandProfileId: 1, trackingId: "tracking", aspectRatio: "9:16", storagePath: "local:fixture.mp4", manifestJson: { publication: publicationFixture } });
});
it("serves precisely the digest-verified preview buffer without caching", async () => {
  const response = await request(app).get("/api/founder/cmo/asset").query(query);
  expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.headers["content-type"]).toContain("video/mp4");
  expect(response.body).toEqual(publicationVideoBytes); expect(h.read).toHaveBeenCalledOnce();
});
it("refuses altered video bytes without serving them", async () => {
  h.read.mockResolvedValue(Buffer.from("secret-replacement-video"));
  const response = await request(app).get("/api/founder/cmo/asset").query(query);
  expect(response.status).toBe(409); expect(response.text).not.toContain("secret-replacement-video");
});
it("refuses a stale requested digest before reading storage", async () => {
  const response = await request(app).get("/api/founder/cmo/asset").query({ ...query, assetRevision: "0".repeat(64) });
  expect(response.status).toBe(409); expect(h.read).not.toHaveBeenCalled();
});
it("cannot use another key with a reviewed render identity", async () => {
  const response = await request(app).get("/api/founder/cmo/asset").query({ ...query, key: "other.mp4" });
  expect(response.status).toBe(404); expect(h.read).not.toHaveBeenCalled();
});
