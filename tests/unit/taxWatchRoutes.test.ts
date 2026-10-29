/**
 * V-Tax-1 T1 — the county watch routes over HTTP (real router; the watches
 * service is the seam).
 *   - the organization passed to the service is the SESSION's;
 *   - a watch the service cannot find for that org is a 404, and a malformed
 *     id is a 404 without reaching the service;
 *   - a stated term needs its source — a bare number is refused (422) and
 *     nothing is written; an unknown term key is refused;
 *   - members below admin are refused before anything is read.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ org: { id: 41 }, user: { id: "u-41" }, role: "owner", list: vi.fn(), set: vi.fn(), triage: vi.fn() }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.user = h.user; next(); } }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (req: any, _res: any, next: any) => { req.organization = h.org; req.organizationId = h.org.id; next(); } }));
vi.mock("../../server/middleware/roleGuard", () => ({
  requireRole: (roles: string[]) => (_req: any, res: any, next: any) => (roles.includes(h.role) ? next() : res.status(403).json({ error: "FORBIDDEN", message: "no", statusCode: 403 })),
}));
vi.mock("../../server/services/tax/taxWatches", () => ({
  listWatches: (...a: unknown[]) => h.list(...a),
  setWatchTerms: (...a: unknown[]) => h.set(...a),
  buildWatchTriage: (...a: unknown[]) => h.triage(...a),
}));

import { registerTaxWatchRoutes } from "../../server/routes-tax-watches";

const app = () => {
  const a = express();
  a.use(express.json());
  registerTaxWatchRoutes(a);
  return a;
};
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

beforeEach(() => {
  h.role = "owner";
  h.list.mockReset();
  h.set.mockReset();
  h.triage.mockReset();
});

describe("county watch routes", () => {
  it("lists the SESSION organization's watches", async () => {
    h.list.mockResolvedValue([]);
    const res = await request(app()).get("/api/tax-watches?organizationId=1");
    expect(res.status).toBe(200);
    expect(h.list).toHaveBeenCalledWith(41);
  });

  it("a watch outside the organization is a 404; a malformed id never reaches the service", async () => {
    h.triage.mockResolvedValue(null);
    expect((await request(app()).get(`/api/tax-watches/${ID}/triage`)).status).toBe(404);
    expect(h.triage).toHaveBeenCalledWith(41, ID);
    expect((await request(app()).get("/api/tax-watches/7/triage")).status).toBe(404);
    expect(h.triage).toHaveBeenCalledTimes(1);
  });

  it("a stated term needs its source; an unknown key is refused; nothing is written", async () => {
    const bare = await request(app()).put(`/api/tax-watches/${ID}/terms`).send({ redemptionPeriodMonths: { value: 6, asOf: null } });
    expect(bare.status).toBe(422);
    const extra = await request(app()).put(`/api/tax-watches/${ID}/terms`).send({ interestRate: { value: 18, source: "x x x", asOf: null } });
    expect(extra.status).toBe(422);
    expect(h.set).not.toHaveBeenCalled();
    h.set.mockResolvedValue({ id: ID });
    const ok = await request(app()).put(`/api/tax-watches/${ID}/terms`).send({ redemptionPeriodMonths: { value: 6, source: "SYNTHETIC county sale notice", asOf: "2026-09-01" } });
    expect(ok.status).toBe(200);
    expect(h.set).toHaveBeenCalledWith(41, ID, { redemptionPeriodMonths: { value: 6, source: "SYNTHETIC county sale notice", asOf: "2026-09-01" } });
  });

  it("a member below admin is refused before anything is read", async () => {
    h.role = "member";
    expect((await request(app()).get("/api/tax-watches")).status).toBe(403);
    expect(h.list).not.toHaveBeenCalled();
  });
});
