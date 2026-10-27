/**
 * V-Notes-1 N2 — GET /api/notes/:id/record over HTTP (real router; the
 * record service is the seam).
 *   - a malformed id is a 404 without touching the service;
 *   - another organization's note (service → null) is the same 404 — the
 *     response never confirms a foreign id;
 *   - the organization passed to the service is the SESSION's;
 *   - the owner/admin role guard stands in front.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ org: { id: 77 }, user: { id: "u-77" }, role: "owner", build: vi.fn() }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.user = h.user; next(); } }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (req: any, _res: any, next: any) => { req.organization = h.org; req.organizationId = h.org.id; next(); } }));
vi.mock("../../server/middleware/roleGuard", () => ({
  requireRole: (roles: string[]) => (_req: any, res: any, next: any) => (roles.includes(h.role) ? next() : res.status(403).json({ error: "FORBIDDEN", message: "no", statusCode: 403 })),
}));
vi.mock("../../server/services/notes/noteRecord", () => ({ buildNoteRecord: (...a: unknown[]) => h.build(...a) }));

import { registerNoteRecordRoutes } from "../../server/routes-note-record";

const app = () => {
  const a = express();
  registerNoteRecordRoutes(a);
  return a;
};
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

beforeEach(() => {
  h.role = "owner";
  h.build.mockReset();
});

describe("GET /api/notes/:id/record", () => {
  it("returns the record built for the SESSION's organization", async () => {
    h.build.mockResolvedValue({ noteId: ID, terms: [] });
    const res = await request(app()).get(`/api/notes/${ID}/record?organizationId=1`);
    expect(res.status).toBe(200);
    expect(h.build).toHaveBeenCalledWith(77, ID);
  });

  it("another organization's note is a 404, the same as a missing one", async () => {
    h.build.mockResolvedValue(null);
    const res = await request(app()).get(`/api/notes/${ID}/record`);
    expect(res.status).toBe(404);
  });

  it("a malformed id is a 404 without reaching the service", async () => {
    const res = await request(app()).get("/api/notes/42/record");
    expect(res.status).toBe(404);
    expect(h.build).not.toHaveBeenCalled();
  });

  it("a member below admin is refused before anything is read", async () => {
    h.role = "member";
    const res = await request(app()).get(`/api/notes/${ID}/record`);
    expect(res.status).toBe(403);
    expect(h.build).not.toHaveBeenCalled();
  });
});
