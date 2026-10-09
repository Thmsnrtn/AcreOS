/**
 * Heirs' property / partial-interest owners are WARNED about before outreach.
 *
 * The detector (shared/regulatory/heirsProperty.ts) reads only markers a
 * county record carries — estate of, heirs, et al, a fraction, undivided, a
 * life estate, tenancy in common, deceased, ownerType "estate" — and never a
 * surname. It is adopted where outreach is decided: the mail quote every
 * mail send is confirmed against, and Pax's lead reachability read. A warning,
 * never a block, and never a silent removal.
 */
import { describe, expect, it, vi } from "vitest";
import { assessHeirsProperty, HEIRS_PROPERTY_WARNING } from "../../shared/regulatory/heirsProperty";

describe("the detector reads record markers only", () => {
  it.each([
    ["ESTATE OF JOHN SMITH", "estate_of"],
    ["SMITH JOHN EST", "estate_of"],
    ["UNKNOWN HEIRS OF MARY JONES", "heirs"],
    ["JONES MARY ET AL", "et_al"],
    ["JONES MARY ETAL", "et_al"],
    ["JONES MARY 1/3 INT", "fractional_interest"],
    ["JONES MARY UND 1/4", "undivided_interest"],
    ["JONES MARY LIFE EST", "life_estate"],
    ["JONES MARY & BOB TENANTS IN COMMON", "tenancy_in_common"],
    ["JONES MARY DECD", "deceased"],
  ])("%s → %s", (name, signal) => {
    const a = assessHeirsProperty({ names: [name] });
    expect(a.flagged).toBe(true);
    expect(a.signals).toContain(signal);
    expect(a.warning).toBe(HEIRS_PROPERTY_WARNING);
  });

  it.each(["Mary Jones", "Estes Family Farms LLC", "Heirloom Acres", "Tic Tac Ranch", "John Etalon"])("no marker, no warning: %s", (name) => {
    expect(assessHeirsProperty({ names: [name] })).toEqual({ flagged: false, signals: [], warning: null });
  });

  it("ownerType estate and a vesting note are markers too", () => {
    expect(assessHeirsProperty({ names: ["Mary Jones"], ownerType: "estate" }).signals).toEqual(["owner_type_estate"]);
    expect(assessHeirsProperty({ names: ["Mary Jones"], text: ["Vesting: undivided one-half interest"] }).signals).toContain("undivided_interest");
  });
});

describe("adoption: Pax's lead reachability carries the warning before outreach", () => {
  it("a flagged lead's summary leads with the warning; an ordinary lead's does not", async () => {
    const { leadReachabilityForPax } = await import("../../server/services/paxLeadReachability");
    const base = { tcpaConsent: false, doNotContact: false, optOutDate: null, phone: null, email: null, address: "1 Rd", city: "X", state: "TN", zip: "37000" } as any;
    const flagged = leadReachabilityForPax({ ...base, firstName: "MARY", lastName: "JONES ET AL" });
    expect(flagged.heirsProperty.flagged).toBe(true);
    expect(flagged.summary).toContain(HEIRS_PROPERTY_WARNING);
    const plain = leadReachabilityForPax({ ...base, firstName: "Mary", lastName: "Jones" });
    expect(plain.heirsProperty.flagged).toBe(false);
    expect(plain.summary).not.toContain("heirs");
  });
});

// ── the mail quote: the confirmation every mail send is made against ────────
const R = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => {
  const chain = (): any => {
    const c: any = { select: () => c, from: () => c, where: () => c, orderBy: () => c, limit: () => c, groupBy: () => c, innerJoin: () => c, leftJoin: () => c, then: (ok: any, no: any) => Promise.resolve(R.rows).then(ok, no) };
    return c;
  };
  return { db: { select: () => chain(), insert: () => ({ values: () => ({ returning: async () => [] }) }), update: () => ({ set: () => ({ where: async () => [] }) }) }, withTransaction: async (fn: any) => fn(chain()) };
});
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _s: unknown, next: () => void) => { req.organization = { id: 7, name: "Acme" }; req.organizationId = 7; next(); },
}));
vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_q: unknown, _s: unknown, next: () => void) => next(),
  RATE_LIMIT_CONFIGS: { public: { maxRequests: 100, windowMs: 60_000 } },
}));

describe("adoption: the mail quote names the flagged recipients", () => {
  it("counts and lists heirs'-property recipients, with the warning; removes none", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { registerOutreachMailRoutes } = await import("../../server/routes-outreach-mail");
    R.rows = [
      { id: 1, firstName: "MARY", lastName: "JONES ET AL", address: "1 Rd", city: "A", state: "TN", zip: "37000", lastContactedAt: null, notes: null },
      { id: 2, firstName: "Bob", lastName: "Lee", address: "2 Rd", city: "A", state: "TN", zip: "37000", lastContactedAt: null, notes: "Vesting: estate of Robert Lee" },
      { id: 3, firstName: "Ann", lastName: "Fox", address: "3 Rd", city: "A", state: "TN", zip: "37000", lastContactedAt: null, notes: null },
    ];
    const app = express();
    app.use(express.json());
    registerOutreachMailRoutes(app as any);
    const res = await request(app).post("/api/outreach/mail/quote").send({ audienceFilter: { states: ["TN"] }, pieceType: "postcard_4x6", speed: "standard" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.pieceCount).toBe(3);
    expect(res.body.heirsPropertyCount).toBe(2);
    expect(res.body.heirsPropertyLeadIds).toEqual([1, 2]);
    expect(res.body.heirsPropertyWarning).toBe(HEIRS_PROPERTY_WARNING);
  });
});
