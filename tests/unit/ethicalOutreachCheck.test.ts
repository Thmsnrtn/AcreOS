/**
 * The ethical-outreach check: deceptive copy is refused at the mail queue;
 * a bare offer and careless probate copy are warned about in the quote.
 */
import { describe, expect, it, vi } from "vitest";
import { checkOutreachTemplate, refusesSend } from "../../shared/regulatory/ethicalOutreach";

const GOOD = "Hi, I buy rural land in Hardin County. Based on recent sales of similar 5-acre parcels nearby, I can offer $12,000 cash for your lot on Rt 9. If it isn't for sale, no problem.";

describe("the rules", () => {
  it("honest copy with an explained offer has no findings", () => {
    expect(checkOutreachTemplate({ text: GOOD })).toEqual([]);
  });

  it.each([
    ["FINAL NOTICE regarding your parcel", "official-notice look"],
    ["Notice of tax deed sale — respond now", "court/government notice"],
    ["Your account is past due", "owing money"],
    ["County Treasurer's Office notice for owners", "government office"],
    ["We guarantee the best price in the county", "guarantee"],
    ["As we discussed, here is my offer", "claimed conversation"],
    ["This offer expires in 48 hours", "manufactured deadline"],
    ["Last chance to sell before prices drop", "manufactured deadline"],
  ])("deceptive, refused: %s (%s)", (text) => {
    const f = checkOutreachTemplate({ text });
    expect(f.some((x) => x.rule === "deceptive" && x.severity === "refuse")).toBe(true);
    expect(refusesSend(f)).toBe(true);
  });

  it("an offer with no basis is a warning, not a refusal", () => {
    const f = checkOutreachTemplate({ text: "I'll pay $8,500 cash for your land." });
    expect(f.map((x) => [x.rule, x.severity])).toEqual([["offer_basis", "warn"]]);
    expect(refusesSend(f)).toBe(false);
  });

  it("probate: urgency and a missing pointer to the executor/attorney are warned", () => {
    const pushy = checkOutreachTemplate({ text: "Sorry for your loss. Sell the inherited land quickly and avoid probate costs." });
    expect(pushy.filter((x) => x.rule === "probate_care").length).toBe(2);
    const careful = checkOutreachTemplate({ text: "We're sorry for your loss. If the estate ever considers selling, please talk with the executor or your attorney first — there is no rush." });
    expect(careful.filter((x) => x.rule === "probate_care")).toEqual([]);
  });

  it("the audience flag alone triggers probate care", () => {
    expect(checkOutreachTemplate({ text: GOOD, audience: { probate: true } }).some((x) => x.rule === "probate_care")).toBe(true);
  });
});

// ── adoption: the mail queue refuses deceptive copy before any debit ────────
const Q = vi.hoisted(() => ({ writes: 0 }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => {
  const chain = (): any => {
    const c: any = { select: () => c, from: () => c, where: () => c, orderBy: () => c, limit: () => c, then: (ok: any, no: any) => Promise.resolve([]).then(ok, no) };
    return c;
  };
  return {
    db: { select: () => chain(), insert: () => { Q.writes++; return { values: () => ({ returning: async () => [] }) }; }, update: () => { Q.writes++; return { set: () => ({ where: async () => [] }) }; } },
    withTransaction: async (fn: any) => { Q.writes++; return fn(chain()); },
  };
});
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _s: unknown, next: () => void) => { req.organization = { id: 7, name: "Acme" }; req.organizationId = 7; req.user = { id: "u1" }; next(); },
}));
vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_q: unknown, _s: unknown, next: () => void) => next(),
  RATE_LIMIT_CONFIGS: { public: { maxRequests: 100, windowMs: 60_000 } },
}));

describe("adoption", () => {
  it("POST /api/outreach/mail/queue refuses deceptive copy with the findings, and writes nothing", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { registerOutreachMailRoutes } = await import("../../server/routes-outreach-mail");
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: "u1" }; next(); });
    registerOutreachMailRoutes(app as any);
    const res = await request(app)
      .post("/api/outreach/mail/queue")
      .set("Idempotency-Key", "k-1")
      .send({ audienceFilter: { states: ["TN"] }, pieceType: "postcard_4x6", speed: "standard", copy: "FINAL NOTICE: your parcel. We guarantee a fast close.", expectedAudienceDigest: "x" });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toMatch(/can't be mailed/);
    expect(Q.writes).toBe(0);
  });

  it("the quote carries the findings for the copy", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { registerOutreachMailRoutes } = await import("../../server/routes-outreach-mail");
    const app = express();
    app.use(express.json());
    registerOutreachMailRoutes(app as any);
    const res = await request(app).post("/api/outreach/mail/quote").send({ audienceFilter: { states: ["TN"] }, pieceType: "postcard_4x6", speed: "standard", copy: "I'll pay $8,500 cash for your land." });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.outreachCheck).toEqual([expect.objectContaining({ rule: "offer_basis", severity: "warn" })]);
  });
});
