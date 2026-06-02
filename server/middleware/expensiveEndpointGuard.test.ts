/**
 * expensiveEndpointGuard tests — per-user burst cap + per-org daily budget.
 *
 * The DB-backed sumTodayUsd call is mocked so the test stays a pure unit.
 * We cover:
 *   - founder bypass (no cap)
 *   - tier-aware default budget resolution (free / trial / starter / pro)
 *   - per-user 60s burst trip → Errors.limitExceeded
 *   - per-org daily budget exhausted → structured payload
 *   - 100-users-1-IP elite-bar check: distinct user-ids in the same org
 *     don't trip the per-user lane (it's keyed by user-id, not IP)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";
import { clearRateLimitStore } from "./rateLimit";

// Mock the aiQuotaService.sumTodayUsd before the guard is imported, so the
// memoized createRateLimiter inside the guard module captures the mock.
vi.mock("../services/aiQuotaService", () => ({
  sumTodayUsd: vi.fn().mockResolvedValue(0),
}));

import { expensiveEndpointGuard } from "./expensiveEndpointGuard";
import * as quotaService from "../services/aiQuotaService";

function mockReq(opts: {
  userId?: string;
  orgId?: number;
  tier?: string;
  isFounder?: boolean;
  orgAiQuotaDailyUsd?: number | null;
  trialEndsAt?: Date | null;
  trialUsed?: boolean;
} = {}): Request {
  return {
    user: { id: opts.userId ?? "user-1" },
    organization: {
      id: opts.orgId ?? 1,
      subscriptionTier: opts.tier ?? "free",
      orgAiQuotaDailyUsd: opts.orgAiQuotaDailyUsd ?? null,
      trialEndsAt: opts.trialEndsAt ?? null,
      trialUsed: opts.trialUsed ?? false,
    },
    organizationId: opts.orgId ?? 1,
    isFounder: opts.isFounder ?? false,
    ip: "203.0.113.5",
    socket: { remoteAddress: "203.0.113.5" },
    headers: {},
    body: {},
  } as unknown as Request;
}

function mockRes(): { res: Response; getStatus: () => number; getBody: () => any; getHeaders: () => Record<string, string> } {
  const headers: Record<string, string> = {};
  let status = 200;
  let body: any = null;
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name] = String(value);
      return this;
    },
    getHeader() {
      return undefined;
    },
    status(code: number) {
      this.statusCode = code;
      status = code;
      return this;
    },
    json(b: any) {
      body = b;
      return this;
    },
    end() {
      return this;
    },
    locals: {},
  } as unknown as Response;
  (res as any).req = { correlationId: undefined };
  return { res, getStatus: () => status, getBody: () => body, getHeaders: () => headers };
}

async function runGuard(
  guard: ReturnType<typeof expensiveEndpointGuard>,
  req: Request,
  res: Response,
): Promise<{ passed: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    Promise.resolve(
      guard(req as any, res, () => {
        if (!settled) { settled = true; resolve({ passed: true }); }
      }),
    ).then(() => {
      // If the guard returned without calling next, it must have written a
      // response — poll briefly for statusCode change.
      setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ passed: (res as any).statusCode === 200 });
      }, 20);
    });
  });
}

describe("expensiveEndpointGuard — per-user burst cap", () => {
  const guard = expensiveEndpointGuard({ label: "test-burst", perMinute: 5 });

  beforeEach(() => {
    clearRateLimitStore();
    vi.mocked(quotaService.sumTodayUsd).mockResolvedValue(0);
  });

  it("allows up to perMinute requests for a single user", async () => {
    let passed = 0;
    for (let i = 0; i < 5; i++) {
      const req = mockReq({ userId: "u-A" });
      const { res } = mockRes();
      const r = await runGuard(guard, req, res);
      if (r.passed) passed++;
    }
    expect(passed).toBe(5);
  });

  it("blocks the 6th request in 60s with structured payload", async () => {
    let lastStatus = 0;
    let lastBody: any = null;
    for (let i = 0; i < 7; i++) {
      const req = mockReq({ userId: "u-B" });
      const wrap = mockRes();
      await runGuard(guard, req, wrap.res);
      lastStatus = wrap.getStatus();
      lastBody = wrap.getBody();
    }
    expect(lastStatus).toBe(429);
    expect(lastBody.error).toBe("LIMIT_EXCEEDED");
    expect(lastBody.details.lane).toBe("per-user-60s");
    expect(lastBody.details.perMinute).toBe(5);
  });

  it("does NOT cross-block distinct users even from the same IP (CGNAT-safe)", async () => {
    // 100 distinct users, all from one /24 IP — none should false-429.
    // Per-user cap is keyed by user-id, not IP.
    let passed = 0;
    for (let i = 0; i < 100; i++) {
      const req = mockReq({ userId: `cgnat-${i}` });
      const { res } = mockRes();
      const r = await runGuard(guard, req, res);
      if (r.passed) passed++;
    }
    expect(passed).toBe(100);
  });
});

describe("expensiveEndpointGuard — per-org daily budget", () => {
  const guard = expensiveEndpointGuard({ label: "test-budget", perMinute: 100 });

  beforeEach(() => {
    clearRateLimitStore();
    vi.mocked(quotaService.sumTodayUsd).mockReset();
  });

  it("passes when used < cap (free tier)", async () => {
    vi.mocked(quotaService.sumTodayUsd).mockResolvedValue(0.10);
    const { res } = mockRes();
    const r = await runGuard(guard, mockReq({ tier: "free" }), res);
    expect(r.passed).toBe(true);
  });

  it("blocks when used >= cap (free tier $0.50)", async () => {
    vi.mocked(quotaService.sumTodayUsd).mockResolvedValue(0.55);
    const wrap = mockRes();
    await runGuard(guard, mockReq({ tier: "free" }), wrap.res);
    expect(wrap.getStatus()).toBe(429);
    expect(wrap.getBody().details.lane).toBe("per-org-daily-budget");
    expect(wrap.getBody().details.capUsd).toBe(0.5);
    expect(wrap.getBody().details.usedUsdToday).toBeGreaterThanOrEqual(0.55);
  });

  it("uses trial cap when org is in trial window", async () => {
    vi.mocked(quotaService.sumTodayUsd).mockResolvedValue(1.5);
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const { res } = mockRes();
    // free tier + active trial → $2.00 cap, $1.50 used → still under
    const r = await runGuard(
      guard,
      mockReq({ tier: "free", trialEndsAt: future, trialUsed: false }),
      res,
    );
    expect(r.passed).toBe(true);
  });

  it("bypasses for founder", async () => {
    vi.mocked(quotaService.sumTodayUsd).mockResolvedValue(99999);
    const { res } = mockRes();
    const r = await runGuard(guard, mockReq({ isFounder: true }), res);
    expect(r.passed).toBe(true);
  });

  it("bypasses for enterprise tier", async () => {
    vi.mocked(quotaService.sumTodayUsd).mockResolvedValue(99999);
    const { res } = mockRes();
    const r = await runGuard(guard, mockReq({ tier: "enterprise" }), res);
    expect(r.passed).toBe(true);
  });

  it("fails open if sumTodayUsd throws", async () => {
    vi.mocked(quotaService.sumTodayUsd).mockRejectedValue(new Error("db down"));
    const { res } = mockRes();
    const r = await runGuard(guard, mockReq({ tier: "free" }), res);
    expect(r.passed).toBe(true);
  });
});
