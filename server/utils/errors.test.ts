import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Response } from "express";
import { Errors, sendError } from "./errors";

vi.mock("./logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

interface MockRes {
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string | string[] | number | undefined>;
  req?: { correlationId?: string };
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
  getHeader: (name: string) => string | string[] | number | undefined;
  setHeader: (name: string, value: string) => MockRes;
}

function mkRes(opts: { correlationId?: string; headerRequestId?: string } = {}): MockRes {
  const headers: Record<string, string | string[] | number | undefined> = {};
  if (opts.headerRequestId) headers["X-Request-ID"] = opts.headerRequestId;
  const res: MockRes = {
    headers,
    req: opts.correlationId ? { correlationId: opts.correlationId } : undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    getHeader(name) {
      return this.headers[name];
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}

// Cast helper — the helpers want a real Express `Response`, but our mock
// only implements the surface they actually touch.
function asRes(m: MockRes): Response {
  return m as unknown as Response;
}

describe("Errors helpers — Apple-voice rewrites", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("notFound: surfaces 'We couldn't find that <entity>' with what's-still-true tail", () => {
    const r = mkRes();
    Errors.notFound(asRes(r), "Lead");
    expect(r.statusCode).toBe(404);
    const body = r.body as { error: string; message: string; docsUrl?: string };
    expect(body.error).toBe("NOT_FOUND");
    expect(body.message).toBe(
      "We couldn't find that Lead — it may have been deleted, archived, or moved between organizations.",
    );
    expect(body.docsUrl).toBe("/help/article/not-found");
  });

  it("notFound: respects caller-supplied docsSlug", () => {
    const r = mkRes();
    Errors.notFound(asRes(r), "Property", { docsSlug: "missing-property" });
    const body = r.body as { docsUrl: string };
    expect(body.docsUrl).toBe("/help/article/missing-property");
  });

  it("unauthorized: 'session is no longer valid' + sign-in nudge", () => {
    const r = mkRes();
    Errors.unauthorized(asRes(r));
    expect(r.statusCode).toBe(401);
    const body = r.body as { message: string; docsUrl: string };
    expect(body.message).toBe(
      "Your session is no longer valid. Sign in again to pick up where you left off.",
    );
    expect(body.docsUrl).toBe("/help/article/session-expired");
  });

  it("forbidden (default): explains role limit and points to Settings → Team", () => {
    const r = mkRes();
    Errors.forbidden(asRes(r));
    expect(r.statusCode).toBe(403);
    const body = r.body as { message: string; docsUrl: string };
    expect(body.message).toBe(
      "Your role doesn't include this action. An organization owner can update permissions in Settings → Team.",
    );
    expect(body.docsUrl).toBe("/help/article/permissions");
  });

  it("forbidden: passes through explicit reason", () => {
    const r = mkRes();
    Errors.forbidden(asRes(r), "Only owners may delete the organization.");
    const body = r.body as { message: string };
    expect(body.message).toBe("Only owners may delete the organization.");
  });

  it("badRequest (no message): falls back to AcreOS voice default", () => {
    const r = mkRes();
    Errors.badRequest(asRes(r));
    expect(r.statusCode).toBe(400);
    const body = r.body as { message: string };
    expect(body.message).toBe(
      "We couldn't process that request — the input didn't match what we expected.",
    );
  });

  it("badRequest: still passes a supplied message through verbatim", () => {
    const r = mkRes();
    Errors.badRequest(asRes(r), "state and county are required");
    const body = r.body as { message: string };
    expect(body.message).toBe("state and county are required");
  });

  it("validationFailed: prefixes 'Some fields need a fix:' and attaches details", () => {
    const r = mkRes();
    const zodIssues = [{ path: ["email"], message: "Invalid email" }];
    Errors.validationFailed(asRes(r), zodIssues);
    expect(r.statusCode).toBe(422);
    const body = r.body as { message: string; details: unknown; docsUrl: string };
    expect(body.message).toBe("Some fields need a fix:");
    expect(body.details).toEqual(zodIssues);
    expect(body.docsUrl).toBe("/help/article/validation");
  });

  it("limitExceeded: 429 with rate-limit voice", () => {
    const r = mkRes();
    Errors.limitExceeded(asRes(r), { retryAfter: 5 });
    expect(r.statusCode).toBe(429);
    const body = r.body as { message: string; docsUrl: string; details: { retryAfter: number } };
    expect(body.message).toBe(
      "You're sending requests faster than the system can handle. Wait a few seconds and try again.",
    );
    expect(body.docsUrl).toBe("/help/article/rate-limit");
    expect(body.details.retryAfter).toBe(5);
  });

  // Every 429 used to carry the rate-limit sentence above, whatever was hit —
  // so a plan cap or an empty credit balance told the customer to "wait a few
  // seconds", which never clears either. The message must name the limit.
  describe("limitExceeded names the limit that was hit and how to raise it", () => {
    const RATE = "faster than the system can handle";
    const msgFor = (details: unknown) => {
      const r = mkRes();
      Errors.limitExceeded(asRes(r), details);
      expect(r.statusCode).toBe(429);
      return r.body as { message: string; docsUrl?: string };
    };

    it("a plan cap (usageLimitGate shape) names the resource, the plan and the upgrade", () => {
      const body = msgFor({
        resourceType: "campaigns", currentTier: "starter", currentCount: 5, currentLimit: 5,
        nextTier: "pro", nextTierLimit: 50, nextTierMonthlyPriceCents: 9900, upgradeUrl: "/settings#billing?tier=pro",
      });
      expect(body.message).not.toContain(RATE);
      expect(body.message).toMatch(/starter plan's limit for campaigns \(5\)/);
      expect(body.message).toMatch(/Upgrade/);
      // No rate-limit article: the client's CTA then falls through to upgradeUrl.
      expect(body.docsUrl).toBeUndefined();
    });

    it("a credit shortfall says credits ran out and where to buy more", () => {
      const body = msgFor({ needed: 12, action: "email_send" });
      expect(body.message).not.toContain(RATE);
      expect(body.message).toMatch(/enough AcreOS credits/);
      expect(body.message).toMatch(/12¢/);
      expect(body.message).toMatch(/credit pack/);
    });

    it("a caller's own message wins (string or details.message)", () => {
      expect(msgFor("AI request limit reached. Upgrade to continue.").message).toBe(
        "AI request limit reached. Upgrade to continue.",
      );
      expect(msgFor({ reason: "daily_budget_exhausted", message: "You've hit today's AI budget." }).message).toBe(
        "You've hit today's AI budget.",
      );
    });

    it("a real rate limit keeps the rate-limit voice and article", () => {
      const body = msgFor({ route: "login", retryAfterSeconds: 2, reason: "too_many_attempts_from_this_network" });
      expect(body.message).toContain(RATE);
      expect(body.docsUrl).toBe("/help/article/rate-limit");
    });

    it("an unknown shape is called a usage limit, never a rate limit", () => {
      expect(msgFor({}).message).not.toContain(RATE);
    });
  });

  it("internal (production): never leaks raw error; includes request ID + docs", () => {
    vi.stubEnv("NODE_ENV", "production");
    const r = mkRes({ correlationId: "req-abc-123" });
    Errors.internal(asRes(r), new Error("Postgres exploded with secrets"));
    expect(r.statusCode).toBe(500);
    const body = r.body as { message: string; requestId: string; docsUrl: string };
    expect(body.message).toBe(
      "Something broke on our end. It's been logged automatically — please try again in a moment.",
    );
    expect(body.requestId).toBe("req-abc-123");
    expect(body.docsUrl).toBe("/help/article/internal-error");
    expect(body.message).not.toContain("Postgres");
  });

  it("internal: falls back to X-Request-ID header when req.correlationId absent", () => {
    vi.stubEnv("NODE_ENV", "production");
    const r = mkRes({ headerRequestId: "hdr-xyz-789" });
    Errors.internal(asRes(r), new Error("boom"));
    const body = r.body as { requestId: string };
    expect(body.requestId).toBe("hdr-xyz-789");
  });

  it("internal (development): surfaces underlying error message for local debugging", () => {
    vi.stubEnv("NODE_ENV", "development");
    const r = mkRes();
    Errors.internal(asRes(r), new Error("undefined is not a function"));
    const body = r.body as { message: string };
    expect(body.message).toBe("undefined is not a function");
  });

  it("sendError: omits requestId on non-internal responses (privacy by default)", () => {
    const r = mkRes({ correlationId: "req-abc-123" });
    sendError(asRes(r), 400, "BAD_REQUEST", "nope");
    const body = r.body as { requestId?: string };
    expect(body.requestId).toBeUndefined();
  });

  it("status codes are preserved across the rewrite", () => {
    const cases: Array<{ run: (r: Response) => void; code: number }> = [
      { run: (r) => Errors.notFound(r, "X"), code: 404 },
      { run: (r) => Errors.badRequest(r), code: 400 },
      { run: (r) => Errors.validationFailed(r, []), code: 422 },
      { run: (r) => Errors.unauthorized(r), code: 401 },
      { run: (r) => Errors.forbidden(r), code: 403 },
      { run: (r) => Errors.limitExceeded(r, {}), code: 429 },
      { run: (r) => Errors.internal(r, new Error("x")), code: 500 },
    ];
    for (const { run, code } of cases) {
      const r = mkRes();
      run(asRes(r));
      expect(r.statusCode).toBe(code);
    }
  });
});
