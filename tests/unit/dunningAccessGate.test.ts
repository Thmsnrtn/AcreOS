/**
 * Track A — dunning read-only gate (W4.4) route semantics.
 *
 * The day-8 dunning email promises "read-only for some features"; this
 * middleware is the ONLY thing that keeps that promise. Getting it wrong in
 * either direction is expensive: gate too much and a past-due customer
 * can't reach the billing page to FIX the payment (churn machine); gate too
 * little and the email is a bluff. These tests pin the exact contract:
 *
 *   - reads always pass, whatever the dunning stage;
 *   - every DUNNING_GATE_EXEMPT_PREFIX (billing, subscription, auth,
 *     webhooks, support, ...) passes even for a restricted org's mutation;
 *   - no-org and founder requests pass;
 *   - ONLY stage "restricted" blocks a business mutation, with a 402
 *     PAYMENT_REQUIRED carrying { reason: "dunning_restricted", billingUrl };
 *   - warning/grace_period pass (accessLevel "full"), and suspended/
 *     cancelled ALSO pass here — they're handled by the day-15 free-tier
 *     downgrade, and "cancelled" covers voluntary cancels that must keep
 *     working within free limits.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// The middleware only needs DUNNING_STAGES from the (huge) schema module —
// mock it with the stage map verbatim so the test stays a unit test.
vi.mock("@shared/schema", () => ({
  DUNNING_STAGES: {
    none: { name: "Active", accessLevel: "full" },
    grace_period: { name: "Grace Period", accessLevel: "full" },
    warning: { name: "Payment Warning", accessLevel: "full" },
    restricted: { name: "Restricted", accessLevel: "limited" },
    suspended: { name: "Suspended", accessLevel: "none" },
    cancelled: { name: "Cancelled", accessLevel: "none" },
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { dunningAccessGate } from "../../server/middleware/dunningAccessGate";

function makeReq(overrides: {
  method?: string;
  path?: string;
  organization?: { id: number; dunningStage?: string | null } | undefined;
  isFounder?: boolean;
}) {
  return {
    method: overrides.method ?? "POST",
    path: overrides.path ?? "/api/leads",
    url: overrides.path ?? "/api/leads",
    organization: overrides.organization,
    isFounder: overrides.isFounder ?? false,
  } as any;
}

function makeRes() {
  const res: any = {
    statusCode: undefined as number | undefined,
    body: undefined as any,
    getHeader: () => undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function run(reqOverrides: Parameters<typeof makeReq>[0]) {
  const req = makeReq(reqOverrides);
  const res = makeRes();
  const next = vi.fn();
  dunningAccessGate(req, res, next);
  return { res, next };
}

const restrictedOrg = { id: 7, dunningStage: "restricted" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dunningAccessGate — reads and exemptions always pass", () => {
  it("GET passes even for a restricted org (read-only means reads WORK)", () => {
    const { res, next } = run({ method: "GET", path: "/api/leads", organization: restrictedOrg });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it("HEAD/OPTIONS are not gated either", () => {
    for (const method of ["HEAD", "OPTIONS"]) {
      const { next } = run({ method, path: "/api/leads", organization: restrictedOrg });
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it.each([
    "/api/subscription/resume",
    "/api/billing/portal",
    "/api/credits/purchase",
    "/api/auth/switch-org",
    "/api/webhook/stripe",
    "/api/stripe/checkout",
    "/api/founder/anything",
    "/api/audit/export",
    "/api/support/ticket",
    "/api/health",
  ])("restricted org can still MUTATE %s — the fix-the-payment paths stay open", (path) => {
    const { res, next } = run({ method: "POST", path, organization: restrictedOrg });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it("a pre-org request passes through (auth handler rejects it, not us)", () => {
    const { next } = run({ method: "POST", path: "/api/leads", organization: undefined });
    expect(next).toHaveBeenCalledOnce();
  });

  it("founders are never gated", () => {
    const { next } = run({
      method: "POST",
      path: "/api/leads",
      organization: restrictedOrg,
      isFounder: true,
    });
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("dunningAccessGate — only the restricted window blocks mutations", () => {
  it("stage=restricted 402s a business mutation with the dunning_restricted payload", () => {
    const { res, next } = run({ method: "POST", path: "/api/leads", organization: restrictedOrg });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({
      error: "PAYMENT_REQUIRED",
      statusCode: 402,
      details: {
        reason: "dunning_restricted",
        dunningStage: "restricted",
        billingUrl: "/settings#billing",
      },
    });
    // The message must route the customer to the fix, not just scold them.
    expect(res.body.message).toContain("Billing");
  });

  it.each(["DELETE", "PUT", "PATCH"])("%s is gated the same as POST", (method) => {
    const { res, next } = run({ method, path: "/api/deals/1", organization: restrictedOrg });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(402);
  });

  it.each(["none", "grace_period", "warning"])(
    "stage=%s has full access — mutations pass",
    (dunningStage) => {
      const { res, next } = run({
        method: "POST",
        path: "/api/leads",
        organization: { id: 7, dunningStage },
      });
      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBeUndefined();
    },
  );

  it.each(["suspended", "cancelled"])(
    "stage=%s does NOT gate here — day-15 downgrade owns it (and voluntary cancels must keep working)",
    (dunningStage) => {
      const { res, next } = run({
        method: "POST",
        path: "/api/leads",
        organization: { id: 7, dunningStage },
      });
      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBeUndefined();
    },
  );

  it("a null/unknown dunningStage is treated as active — never blocks", () => {
    for (const dunningStage of [null, undefined, "totally_bogus"]) {
      const { next } = run({
        method: "POST",
        path: "/api/leads",
        organization: { id: 7, dunningStage: dunningStage as any },
      });
      expect(next).toHaveBeenCalledOnce();
    }
  });
});
