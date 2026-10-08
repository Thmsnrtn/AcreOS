/**
 * A first-run refusal says what unlocks it.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * Three refusals a new account meets early had no path forward:
 *   - Pax: `402 { error: "Insufficient credits", required, balance }` — no
 *     message, no link; the rail printed "Insufficient credits." and stopped.
 *   - Teammate invite on Pro: `402 seat_purchase_required` telling the owner to
 *     "increase your seat count from billing" — a control no page renders.
 *   - First campaign on Free: the rate-limit sentence (planLimitIsNotARateLimit
 *     covers that one, through the real gate).
 *
 * WHO is refused is an owner decision and is not changed here: no credit
 * amount, seat count, price or entitlement is touched. What is pinned is that
 * each refusal carries a machine-readable code, a sentence naming the plan or
 * action that unlocks it, and a `details.nextStep` link the client renders.
 *
 * The invite case runs through the REAL route handler, because the copy is
 * only true if it is the copy the route actually sends for the state that
 * produced it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { refusePaxCredits, refuseCreditShortage, PAX_CREDITS_REQUIRED } from "../../server/utils/firstRunRefusals";
import { refusalFromBody } from "../../client/src/lib/refusal";

const ROOT = path.resolve(__dirname, "../..");

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as null | { error: string; message: string; details: Record<string, any> },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data as typeof res.body;
      return res;
    },
    getHeader: () => undefined,
  };
  return res;
}

/** Every href a refusal may send someone to — each is a real client route. */
const KNOWN_DESTINATIONS = /^(\/settings#account|\/settings\/byok|\/support|\/settings#billing(\?tier=(starter|pro|scale))?)$/;

describe("Pax credit refusal", () => {
  it("past the trial: names the price, the balance, and Add credits", () => {
    const res = mockRes();
    refusePaxCredits(res as never, {
      lane: "balance",
      requiredCents: 2,
      balanceCents: 0,
      subscriptionTier: "free",
      byokAvailable: false,
    });
    expect(res.statusCode).toBe(402);
    expect(res.body!.error).toBe(PAX_CREDITS_REQUIRED);
    expect(res.body!.message).toBe(
      "This message needs $0.02 of prepaid credit and this account has $0.00. Add credits to keep chatting.",
    );
    expect(res.body!.details.nextStep).toEqual({ label: "Add credits", href: "/settings#account" });
  });

  it("inside the trial, it never promises that buying credits helps (that lane never reads the balance)", () => {
    for (const byokAvailable of [false, true]) {
      const res = mockRes();
      refusePaxCredits(res as never, {
        lane: "trial",
        requiredCents: 2,
        balanceCents: 10_000,
        subscriptionTier: byokAvailable ? "starter" : "free",
        byokAvailable,
      });
      expect(res.body!.message).not.toMatch(/Add credits to keep chatting/);
      expect(res.body!.details.nextStep.href).toBe(byokAvailable ? "/settings/byok" : "/settings#billing?tier=starter");
    }
  });

  it("the chat routes answer an unaffordable turn through it — not a bare 402", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "server/routes-ai.ts"), "utf8"));
    const refusals = src.match(/\brefusePaxCredits\s*\(/g)?.length ?? 0;
    // /api/ai/chat and /api/ai/chat/stream.
    expect(refusals, "a chat route lost its credit refusal").toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/error:\s*["']Insufficient credits["']/);
    // The reason comes from the credit service's own decision.
    expect(src.match(/creditService\.evaluateCredits\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // An unset AI-turn gate (it fails open) is passed as unknown, never as "no".
    expect(src).not.toMatch(/aiTurnGate\?\.byokAvailable\s*===\s*true/);
  });

  it("when the AI-turn gate left no answer, BYOK availability comes from the tier table", () => {
    const paid = mockRes();
    refusePaxCredits(paid as never, { lane: "balance", requiredCents: 2, balanceCents: 0, subscriptionTier: "pro", byokAvailable: undefined });
    expect(paid.body!.details.byokAvailable).toBe(true);
    expect(paid.body!.message).toMatch(/or add your own AI provider key\.$/);
    const free = mockRes();
    refusePaxCredits(free as never, { lane: "balance", requiredCents: 2, balanceCents: 0, subscriptionTier: "free", byokAvailable: undefined });
    expect(free.body!.details.byokAvailable).toBe(false);
    expect(free.body!.message).not.toMatch(/AI provider key/);
  });

  it("deal AI chat answers an unaffordable turn through the same helper", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "server/routes-deals.ts"), "utf8"));
    expect(src).toMatch(/\brefusePaxCredits\s*\(/);
    expect(src).not.toMatch(/error:\s*["']Insufficient credits["']/);
  });
});

describe("seat refusal ladder", () => {
  it("skips tiers that are not visible, like nextPaidTier", () => {
    // With today's tables Pro always admits a teammate before any hidden tier
    // is reached, so this is pinned on the loop itself.
    const src = stripComments(fs.readFileSync(path.join(ROOT, "server/utils/firstRunRefusals.ts"), "utf8"));
    const loop = src.slice(src.indexOf("export function refuseSeatInvite("));
    expect(loop).toMatch(/if \(!isTierVisible\(step\)\) continue;/);
  });
});

describe("campaign send credit shortage", () => {
  it("is a credit refusal with an Add credits step, not the rate-limit voice", () => {
    const res = mockRes();
    refuseCreditShortage(res as never, {
      status: 429,
      what: "This email send",
      requiredCents: 120,
      balanceCents: 45,
      details: { needed: 120, action: "email_send" },
    });
    expect(res.statusCode).toBe(429);
    expect(res.body!.error).toBe("CREDITS_REQUIRED");
    expect(res.body!.message).toBe(
      "This email send needs $1.20 of prepaid credit and this account has $0.45. Add credits, or send to fewer recipients.",
    );
    expect(res.body!.message).not.toMatch(/faster than|wait a few|slow down/i);
    expect(res.body!.details).toMatchObject({ needed: 120, action: "email_send", nextStep: { label: "Add credits", href: "/settings#account" } });
  });

  it("both campaign send paths use it — no credit shortage left on the rate-limit helper", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "server/routes-campaigns.ts"), "utf8"));
    expect(src.match(/\brefuseCreditShortage\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/limitExceeded\(\s*res,\s*\{\s*needed:/);
  });
});

describe("refusal hrefs are in-app paths only", () => {
  it.each(["javascript:alert(1)", "//evil.example/x", "https://evil.example", "/\\evil.example"])("%s falls back", (href) => {
    const viaStep = refusalFromBody({ error: "seat_purchase_required", message: "m", details: { nextStep: { label: "Go", href } } });
    expect(viaStep!.action.href).toBe("/settings#billing");
    const viaPlan = refusalFromBody({ error: "PLAN_LIMIT_REACHED", message: "m", details: { resourceType: "leads", currentTier: "free", nextTier: "starter", upgradeUrl: href } });
    expect(viaPlan!.action.href).toBe("/settings#billing");
  });
  it("an in-app path passes through", () => {
    expect(refusalFromBody({ error: "x", message: "m", details: { nextStep: { label: "Go", href: "/support" } } })!.action.href).toBe("/support");
  });
});

// ── The invite route, for real ─────────────────────────────────────────────

const h = vi.hoisted(() => ({
  org: { id: 7, subscriptionTier: "pro", seatCount: 1 } as Record<string, unknown>,
  counts: [1, 0] as number[],
  calls: 0,
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: "user-1" };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: unknown, next: () => void) => {
    req.organization = h.org;
    req.organizationId = h.org.id;
    next();
  },
}));
vi.mock("../../server/utils/permissions", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../server/utils/permissions");
  const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return { ...actual, requireAdminOrAbove: pass, requireOwner: pass, requirePermission: pass, attachPermissionContext: pass };
});
vi.mock("../../server/storage", () => {
  // active team members, then pending invitations — the two counts the
  // seat preflight reads, in that order.
  const select = () => {
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = () => Promise.resolve([{ count: h.counts[h.calls++ % 2] }]);
    return q;
  };
  return { storage: {}, db: { select } };
});

async function invite(org: Record<string, unknown>, active: number, pending: number) {
  h.org = org;
  h.counts = [active, pending];
  h.calls = 0;
  const { registerOrganizationRoutes } = await import("../../server/routes-organization");
  const app = express();
  app.use(express.json());
  registerOrganizationRoutes(app);
  return request(app).post("/api/organization/invitations").send({ email: "teammate@example.com", role: "member" });
}

describe("teammate invite refusal (through the real route)", () => {
  beforeEach(() => {
    h.calls = 0;
  });

  it("a Pro org on the default seat count is told it needs a seat and where to get one", async () => {
    const res = await invite({ id: 7, subscriptionTier: "pro", seatCount: 1 }, 1, 0);
    expect(res.status).toBe(402);
    expect(res.body.error).toBe("seat_purchase_required");
    expect(res.body.message).toBe(
      "Inviting 1 teammate needs 2 seats and this organization is set up for 1. Seat counts are set by " +
        "support today — contact support to add a seat.",
    );
    expect(res.body.details).toMatchObject({ projected: 2, seatCount: 1, additionalSeatsNeeded: 1 });
    expect(res.body.details.nextStep).toEqual({ label: "Contact support", href: "/support" });
  });

  it("a Free org learns seats start on Pro — and that support, not the upgrade, sets the count", async () => {
    const res = await invite({ id: 7, subscriptionTier: "free", seatCount: 1 }, 1, 0);
    expect(res.status).toBe(402);
    expect(res.body.error).toBe("upgrade_required");
    expect(res.body.message).toBe(
      "Free doesn't include teammate seats; they start on Pro. Seat counts are set by support today — " +
        "contact support to add teammates.",
    );
    expect(res.body.details.seatsStartOn).toBe("pro");
    expect(res.body.details.nextStep).toEqual({ label: "Contact support", href: "/support" });
  });

  it("no seat refusal promises that upgrading alone unlocks an invite (seat_count stays 1 after an upgrade)", async () => {
    // Upgrading does not raise seat_count and nothing in the app can, so a
    // refusal whose only step is a plan page would send the owner round in a
    // circle: upgrade, try again, refused again.
    const PROMISES_UPGRADE = /upgrade to|teammate seats start on|see (pro|scale|starter)/i;
    for (const org of [
      { id: 7, subscriptionTier: "free", seatCount: 1 },
      { id: 7, subscriptionTier: "starter", seatCount: 1 },
      { id: 7, subscriptionTier: "pro", seatCount: 1 },
    ]) {
      const res = await invite(org, 1, 0);
      expect(res.body.message, org.subscriptionTier).not.toMatch(PROMISES_UPGRADE);
      expect(res.body.message, org.subscriptionTier).toMatch(/contact support/);
      expect(res.body.details.nextStep.href, org.subscriptionTier).toBe("/support");
    }
  });

  it("every invite refusal carries a next step the client renders, to a real destination", async () => {
    for (const org of [
      { id: 7, subscriptionTier: "free", seatCount: 1 },
      { id: 7, subscriptionTier: "starter", seatCount: 1 },
      { id: 7, subscriptionTier: "pro", seatCount: 1 },
    ]) {
      const res = await invite(org, 1, 0);
      expect(res.status, `${org.subscriptionTier}: expected a refusal`).toBe(402);
      const view = refusalFromBody(res.body);
      expect(view, `${org.subscriptionTier}: the client cannot render this refusal`).not.toBeNull();
      expect(view!.description).toBe(res.body.message);
      expect(view!.action.href).toMatch(KNOWN_DESTINATIONS);
    }
  });
});
