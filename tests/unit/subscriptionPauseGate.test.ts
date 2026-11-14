/**
 * Track A — subscription-pause mutation gate (Tahoe E11) route semantics.
 *
 * The 30/60/90-day pause is the cancellation dialog's 4th rung: "keep your
 * data, stop the bill, come back later." The promise only holds if this
 * middleware makes AcreOS truly read-only (no new mail/comps/Pax spend on a
 * non-billing org) while KEEPING the come-back paths open (billing portal,
 * resume, support). Zero coverage until now. Pinned contract:
 *
 *   - reads (GET/HEAD/OPTIONS) always pass — paused is read-only, not locked out;
 *   - every PAUSE_GATE_EXEMPT_PREFIX stays mutable while paused;
 *   - no-org and un-paused orgs pass;
 *   - a live pause blocks mutations with a 402 { error: "subscription_paused",
 *     subscriptionPauseEndsAt } so the banner can render the countdown;
 *   - an ELAPSED pause window passes (lazy resume — the worker/webhook may
 *     not have flipped the flag yet, the customer must not stay locked).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  subscriptionPauseGate,
  pathIsServicingContinuation,
  PAUSE_SERVICING_PATH_PATTERNS,
} from "../../server/middleware/subscriptionPauseGate";

const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 3600 * 1000).toISOString();

function run(overrides: {
  method?: string;
  path?: string;
  organization?: Record<string, unknown> | undefined;
}) {
  const req = {
    method: overrides.method ?? "POST",
    path: overrides.path ?? "/api/leads",
    url: overrides.path ?? "/api/leads",
    organization: overrides.organization,
  } as any;
  const res: any = {
    statusCode: undefined,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.body = payload;
      return res;
    },
  };
  const next = vi.fn();
  subscriptionPauseGate(req, res, next);
  return { res, next };
}

const pausedOrg = { id: 7, subscriptionPaused: true, subscriptionPauseEndsAt: FUTURE };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("subscriptionPauseGate — reads and exemptions always pass", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("%s passes even while paused (read-only, not locked out)", (method) => {
    const { res, next } = run({ method, organization: pausedOrg });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it.each([
    "/api/subscription/resume",
    "/api/billing/portal",
    "/api/credits/purchase",
    "/api/auth/refresh",
    "/api/webhook/stripe",
    "/api/founder/anything",
    "/api/audit/export",
    "/api/support/ticket",
    "/api/health",
  ])("a paused org can still MUTATE %s — the come-back paths stay open", (path) => {
    const { res, next } = run({ method: "POST", path, organization: pausedOrg });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it("a pre-org request passes through (auth handler rejects it, not us)", () => {
    const { next } = run({ organization: undefined });
    expect(next).toHaveBeenCalledOnce();
  });

  it("an un-paused org passes", () => {
    const { next } = run({ organization: { id: 7, subscriptionPaused: false } });
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("subscriptionPauseGate — a live pause blocks mutations", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "%s on a business route 402s with the countdown payload",
    (method) => {
      const { res, next } = run({ method, path: "/api/deals/1", organization: pausedOrg });
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(402);
      expect(res.body).toMatchObject({
        error: "subscription_paused",
        statusCode: 402,
        subscriptionPauseEndsAt: FUTURE,
      });
      // The copy must point at the resume path, not just refuse.
      expect(res.body.message).toContain("Resume");
    },
  );

  it("a pause with NO end date still blocks (payload carries null, banner shows no countdown)", () => {
    const { res, next } = run({
      organization: { id: 7, subscriptionPaused: true, subscriptionPauseEndsAt: null },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(402);
    expect(res.body.subscriptionPauseEndsAt).toBeNull();
  });

  it("an ELAPSED pause window passes — lazy resume before the worker flips the flag", () => {
    const { res, next } = run({
      organization: { id: 7, subscriptionPaused: true, subscriptionPauseEndsAt: PAST },
    });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });
});

describe("subscriptionPauseGate — servicing carve-out for notes the org already holds", () => {
  const SERVICING: Array<[string, string]> = [
    ["POST", "/api/notes/123/payments"],
    ["POST", "/api/notes/123/payoff/quotes"],
    ["POST", "/api/notes/123/loss-mit-case"],
    ["PATCH", "/api/loss-mit-cases/9"],
    ["POST", "/api/loss-mit-cases/9/actions"],
    ["POST", "/api/notes/123/workout-analyses"],
    ["PUT", "/api/notes/123/payments"],
    ["POST", "/api/notes/123/payments/"],
  ];

  it.each(SERVICING)("%s %s passes while paused", (method, path) => {
    const { res, next } = run({ method, path, organization: pausedOrg });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  const GENERAL: Array<[string, string]> = [
    ["POST", "/api/notes/acquired"],
    ["POST", "/api/notes"],
    ["POST", "/api/notes/from-deal/4"],
    ["POST", "/api/notes/5/splits"],
    ["PATCH", "/api/note-splits/5"],
    ["PATCH", "/api/note-assignments/5"],
    ["POST", "/api/notes/5/assignments"],
    ["POST", "/api/notes/5/basis"],
    ["POST", "/api/notes/5/yield"],
    ["POST", "/api/notes/5/paymentsXYZ"],
    ["POST", "/api/notes/payments"],
    ["POST", "/api/notes//payments"],
    ["POST", "/api/notes/5/payments/extra/deep"],
    ["POST", "/api/loss-mit-cases"],
    ["POST", "/api/deals/1"],
    ["POST", "/api/leads"],
    ["POST", "/api/campaigns"],
  ];

  it.each(GENERAL)("%s %s still 402s while paused", (method, path) => {
    const { res, next } = run({ method, path, organization: pausedOrg });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(402);
  });

  it("acceptance: a paused hybrid org's servicing writes succeed while its general writes 402", () => {
    const servicing = run({ method: "POST", path: "/api/notes/42/payments", organization: pausedOrg });
    const general = run({ method: "POST", path: "/api/deals/1", organization: pausedOrg });
    expect(servicing.next).toHaveBeenCalledOnce();
    expect(servicing.res.statusCode).toBeUndefined();
    expect(general.next).not.toHaveBeenCalled();
    expect(general.res.statusCode).toBe(402);
  });

  it("the predicate itself separates servicing from transfers", () => {
    expect(pathIsServicingContinuation("/api/notes/1/payments")).toBe(true);
    expect(pathIsServicingContinuation("/api/notes/1/splits")).toBe(false);
  });

  it("every pattern is anchored under a notes surface and none is a bare prefix", () => {
    for (const p of PAUSE_SERVICING_PATH_PATTERNS) {
      expect(p).toMatch(/^\/api\/(notes|loss-mit-cases)\//);
      expect(p.endsWith("/")).toBe(false);
    }
  });
});
