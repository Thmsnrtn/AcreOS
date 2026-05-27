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

  it("internal (production): never leaks raw error; includes request ID + docs", () => {
    vi.stubEnv("NODE_ENV", "production");
    const r = mkRes({ correlationId: "req-abc-123" });
    Errors.internal(asRes(r), new Error("Postgres exploded with secrets"));
    expect(r.statusCode).toBe(500);
    const body = r.body as { message: string; requestId: string; docsUrl: string };
    expect(body.message).toBe(
      "Something broke on our end. We've logged it; if it keeps happening, please share what you were doing at status.acreos.io.",
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
