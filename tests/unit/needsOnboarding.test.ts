/**
 * /api/me/needs-onboarding — the canonical "should this user be force-
 * routed through the wizard" decision.
 *
 * Regression test for the auth-loop incident: an earlier client-side
 * gate force-redirected every legacy user (including the founder) to
 * /onboarding-v2 on every page load because it only checked the new
 * `onboardingCompleted` column. Migration 0098 backfilled that column
 * for every legacy completion signal, and this endpoint now reads the
 * one true answer. Tests below pin the contract so a future change
 * can't silently re-open the loop.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// Mock the db before importing the router so the route picks up the
// stub instead of a real Postgres connection.
const mockSelect = vi.fn();
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => mockSelect(),
        }),
      }),
    }),
  },
}));

// Import after the mock so the router binds to the stub.
const { default: needsOnboardingRouter } = await import(
  "../../server/routes-needs-onboarding"
);

function makeReq(opts: { isFounder?: boolean; organizationId?: number } = {}) {
  return {
    isFounder: opts.isFounder ?? false,
    organization: opts.organizationId
      ? { id: opts.organizationId }
      : { id: 1 },
    organizationId: opts.organizationId ?? 1,
  } as unknown as Request;
}

function makeRes() {
  const res: { statusCode: number; body: any; json: any; status: any } = {
    statusCode: 200,
    body: undefined,
    json: (b: any) => {
      res.body = b;
      return res;
    },
    status: (s: number) => {
      res.statusCode = s;
      return res;
    },
  };
  return res as unknown as Response & { body: any; statusCode: number };
}

async function callGet(req: Request, res: Response) {
  // Express routers expose handlers on .stack — invoke directly to
  // avoid spinning up a full app instance.
  const handler = (needsOnboardingRouter as any).stack[0].route.stack[0].handle;
  await handler(req, res, () => {});
}

describe("/api/me/needs-onboarding", () => {
  beforeEach(() => {
    mockSelect.mockReset();
  });

  it("returns false for founders regardless of org state", async () => {
    // No DB call should be made at all
    const req = makeReq({ isFounder: true });
    const res = makeRes();
    await callGet(req, res);
    expect(res.body).toEqual({ needsOnboarding: false });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns false when the org has onboarding_completed=true (canonical)", async () => {
    mockSelect.mockResolvedValueOnce([{ onboardingCompleted: true }]);
    const req = makeReq();
    const res = makeRes();
    await callGet(req, res);
    expect(res.body).toEqual({ needsOnboarding: false });
  });

  it("returns true when the org has onboarding_completed=false", async () => {
    mockSelect.mockResolvedValueOnce([{ onboardingCompleted: false }]);
    const req = makeReq();
    const res = makeRes();
    await callGet(req, res);
    expect(res.body).toEqual({ needsOnboarding: true });
  });

  it("returns false (defensive) when the org row is missing", async () => {
    // Don't force a user into a wizard from a broken state.
    mockSelect.mockResolvedValueOnce([]);
    const req = makeReq();
    const res = makeRes();
    await callGet(req, res);
    expect(res.body).toEqual({ needsOnboarding: false });
  });

  it("returns false when onboarding_completed is null (legacy row)", async () => {
    // Migration 0098 backfills these — but if a row escaped the backfill,
    // we still don't want to loop a user. The strict `!== true` check
    // means null → needsOnboarding: true; this test pins that behavior
    // so a future change knows what it's changing.
    mockSelect.mockResolvedValueOnce([{ onboardingCompleted: null }]);
    const req = makeReq();
    const res = makeRes();
    await callGet(req, res);
    expect(res.body).toEqual({ needsOnboarding: true });
  });
});
