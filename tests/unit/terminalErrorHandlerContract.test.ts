/**
 * An uncaught throw must answer the same error contract a handled failure
 * does — including the request id, which is the whole reason the contract has
 * one.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * CLAUDE.md and server/utils/errors.ts define every API error as
 * `{ error, message, statusCode, details?, docsUrl?, requestId? }`, and
 * errors.ts stamps `requestId` from the correlation-id middleware onto 5xx
 * "so users can paste it into support".
 *
 * The terminal handler answered `res.status(status).json({ message })`. No
 * error code, no statusCode, no requestId, and in production the message
 * flattened to "Internal Server Error". The one case where a correlation id
 * matters most — an unhandled throw out of any of ~1,725 handlers — was the
 * one case that had none, and a client could not tell it apart from a handled
 * 500 (2026-09-04 review, CONFIRMED).
 *
 * ── WHY THIS TEST CAN EXIST AT ALL ──────────────────────────────────────────
 * The handler was an inline closure inside an async bootstrap function, so
 * nothing could call it. That is why it had never been tested, and why the
 * contract could drift there and nowhere else. Extracting it is the fix; this
 * is the assertion the extraction buys.
 *
 * idempotent: true — pure function calls, no server, no DB.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { terminalErrorHandler } from "../../server/middleware/terminalErrorHandler";

vi.mock("../../server/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

interface Captured {
  status?: number;
  body?: Record<string, unknown>;
}

function fakeRes(opts: { correlationId?: string; headersSent?: boolean } = {}): {
  res: Response;
  captured: Captured;
} {
  const captured: Captured = {};
  const res = {
    headersSent: opts.headersSent ?? false,
    req: opts.correlationId ? { correlationId: opts.correlationId } : {},
    getHeader: () => undefined,
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

const REQ = {} as Request;
const NEXT = (() => {}) as NextFunction;
const RID = "corr-abc-123";

const originalEnv = process.env.NODE_ENV;
beforeEach(() => {
  process.env.NODE_ENV = "production";
});
afterEach(() => {
  process.env.NODE_ENV = originalEnv;
});

describe("an unhandled throw carries the full contract", () => {
  it("500: error code, statusCode, message and the request id", () => {
    const { res, captured } = fakeRes({ correlationId: RID });
    terminalErrorHandler(new Error("boom in a handler"), REQ, res, NEXT);

    expect(captured.status).toBe(500);
    expect(captured.body).toMatchObject({
      error: "INTERNAL_ERROR",
      statusCode: 500,
      requestId: RID,
    });
    expect(typeof captured.body?.message).toBe("string");
    // The old handler's entire body. If this is all that comes back, the
    // contract is broken again.
    expect(Object.keys(captured.body ?? {})).not.toEqual(["message"]);
  });

  it("500: never leaks the raw error message in production", () => {
    const { res, captured } = fakeRes({ correlationId: RID });
    terminalErrorHandler(new Error("SELECT * FROM secrets WHERE id = 1"), REQ, res, NEXT);
    expect(String(captured.body?.message)).not.toContain("SELECT");
  });

  it("502 / 503 / 504 keep their own status and code rather than collapsing to 500", () => {
    for (const [status, code] of [
      [502, "BAD_GATEWAY"],
      [503, "SERVICE_UNAVAILABLE"],
      [504, "GATEWAY_TIMEOUT"],
    ] as const) {
      const { res, captured } = fakeRes({ correlationId: RID });
      terminalErrorHandler(
        Object.assign(new Error("pg://user:hunter2@db.internal/acreos"), { status }),
        REQ,
        res,
        NEXT,
      );
      expect(captured.status, `status ${status}`).toBe(status);
      expect(captured.body, `status ${status}`).toMatchObject({
        error: code,
        statusCode: status,
        requestId: RID,
      });
      // A distinctive raw string, so this measures leakage rather than
      // coincidence: the 502 copy legitimately contains the word "upstream".
      expect(String(captured.body?.message), `status ${status}`).not.toContain("hunter2");
    }
  });

  it("4xx keeps its status, names a code, and passes the message through", () => {
    for (const [status, code] of [
      [400, "BAD_REQUEST"],
      [401, "UNAUTHORIZED"],
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
      [409, "CONFLICT"],
      [422, "VALIDATION_FAILED"],
      [429, "LIMIT_EXCEEDED"],
    ] as const) {
      const { res, captured } = fakeRes({ correlationId: RID });
      terminalErrorHandler(
        Object.assign(new Error(`explained ${status}`), { statusCode: status }),
        REQ,
        res,
        NEXT,
      );
      expect(captured.status, `status ${status}`).toBe(status);
      expect(captured.body, `status ${status}`).toMatchObject({
        error: code,
        statusCode: status,
        message: `explained ${status}`,
        // 4xx carries it as well: an uncaught 403 is just as hard to explain
        // over a support thread as an uncaught 500.
        requestId: RID,
      });
    }
  });

  it("an error that names its own code keeps it", () => {
    const { res, captured } = fakeRes();
    terminalErrorHandler(
      Object.assign(new Error("no"), { status: 403, code: "SEAT_LIMIT_REACHED" }),
      REQ,
      res,
      NEXT,
    );
    expect(captured.body).toMatchObject({ error: "SEAT_LIMIT_REACHED", statusCode: 403 });
  });

  it("a nonsense status becomes 500 rather than being sent to the client", () => {
    for (const bad of [0, 99, 200, 600, NaN, "teapot", null, undefined]) {
      const { res, captured } = fakeRes();
      terminalErrorHandler(Object.assign(new Error("odd"), { status: bad }), REQ, res, NEXT);
      expect(captured.status, `status ${String(bad)}`).toBe(500);
    }
  });
});

describe("the legal-hold branch keeps its shape", () => {
  it("423 with the case_ref the client panel renders", () => {
    const err = Object.assign(new Error("Legal hold CASE-9 prevents deletion"), {
      name: "LegalHoldViolationError",
      code: "LEGAL_HOLD_ACTIVE",
      resourceType: "deal",
      resourceId: 42,
      hold: { id: 7, caseRef: "CASE-9", scope: "org" },
    });
    const { res, captured } = fakeRes({ correlationId: RID });
    terminalErrorHandler(err, REQ, res, NEXT);
    expect(captured.status).toBe(423);
    expect(captured.body).toMatchObject({
      error: "LEGAL_HOLD_ACTIVE",
      statusCode: 423,
      details: { holdId: 7, caseRef: "CASE-9", scope: "org", resourceType: "deal", resourceId: 42 },
    });
  });
});

describe("it stays quiet once the response is on the wire", () => {
  it("writes nothing when headers are already sent", () => {
    const { res, captured } = fakeRes({ headersSent: true });
    terminalErrorHandler(new Error("late"), REQ, res, NEXT);
    expect(captured.status).toBeUndefined();
    expect(captured.body).toBeUndefined();
  });
});

describe("it is the handler the server actually mounts", () => {
  it("server/index.ts mounts it, and mounts no inline replacement", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    // Comment lines are stripped first. The mount is described in a comment
    // directly above itself, so a substring scan reads its own documentation
    // as the mount and stays green with the handler commented out — which is
    // exactly what the first version of this assertion did.
    const raw = fs.readFileSync(path.resolve(__dirname, "../../server/index.ts"), "utf8");
    const src = raw
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect(src).toContain("app.use(terminalErrorHandler)");
    expect(raw).toContain('from "./middleware/terminalErrorHandler"');
    // The exact shape that broke the contract, in the file that used to have
    // it. A canonical handler with the old code still mounted beside it would
    // be two producers again.
    expect(src).not.toMatch(/res\.status\(status\)\.json\(\{\s*message\s*\}\)/);
  });
});
