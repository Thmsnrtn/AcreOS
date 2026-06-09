import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Keep the proxy active (not the E2E 404 short-circuit) and quiet logs.
vi.mock("../../server/auth/testAuth", () => ({
  e2eTestAuthEnabled: () => false,
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createClerkProxyHandler, CLERK_UPSTREAM_TIMEOUT_MS } from "../../server/middleware/clerkProxy";

function makeApp(fetchImpl: typeof fetch) {
  const app = express();
  app.use("/__clerk", express.urlencoded({ extended: false }), express.json(), createClerkProxyHandler(fetchImpl));
  return app;
}

/** Build a minimal Response-like object the handler understands. */
function fakeUpstreamResponse(status: number, bodyText: string) {
  return {
    status,
    headers: {
      getSetCookie: () => [] as string[],
      forEach: (_cb: (v: string, k: string) => void) => {},
    },
    arrayBuffer: async () => new TextEncoder().encode(bodyText).buffer,
  } as unknown as Response;
}

describe("clerk-proxy double-send guard", () => {
  beforeEach(() => {
    delete (globalThis as any).__clerkCache;
  });

  it("sends exactly one response on the happy path", async () => {
    const fetchImpl = vi.fn(async () => fakeUpstreamResponse(200, '{"ok":true}'));
    const app = makeApp(fetchImpl as unknown as typeof fetch);

    const res = await request(app).post("/__clerk/v1/client/sessions/abc/tokens").send({});

    expect(res.status).toBe(200);
    expect(res.text).toBe('{"ok":true}');
  });

  it("uses a 10s upstream timeout (well below the 30s global wall)", () => {
    expect(CLERK_UPSTREAM_TIMEOUT_MS).toBe(10_000);
  });

  it("returns a clean 504 (not a hang, not a 502) when the upstream aborts on timeout", async () => {
    // Faithfully simulate AbortSignal.timeout firing: fetch rejects with an
    // AbortError. The handler must map this to a single clean 504 response.
    const fetchImpl = vi.fn(async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    });

    const app = makeApp(fetchImpl as unknown as typeof fetch);
    const res = await request(app).post("/__clerk/v1/client/sessions/abc/tokens").send({});

    expect(res.status).toBe(504);
    expect(res.body.statusCode).toBe(504);
  });

  it("never throws ERR_HTTP_HEADERS_SENT when a response was already sent before upstream settles", async () => {
    // Reproduce the exact prod race directly on the handler: the global
    // requestTimeout sent a 504 FIRST (so res.headersSent is already true),
    // THEN this handler's awaited fetch settles and tries to write again. Every
    // terminal write in the handler must become a no-op rather than throwing
    // ERR_HTTP_HEADERS_SENT.
    let upstreamResolve!: (r: Response) => void;
    const fetchImpl = vi.fn(
      () => new Promise<Response>((resolve) => { upstreamResolve = resolve; }),
    );

    const handler = createClerkProxyHandler(fetchImpl as unknown as typeof fetch);

    // Fake req/res. The res reports headersSent=true (a prior 504 went out) and
    // makes any write throw ERR_HTTP_HEADERS_SENT — exactly like a real
    // ServerResponse whose headers are already flushed.
    const writeAfterSend = () => {
      const e: any = new Error("Cannot set headers after they are sent to the client");
      e.code = "ERR_HTTP_HEADERS_SENT";
      throw e;
    };
    const req: any = {
      method: "POST",
      originalUrl: "/__clerk/v1/client/sessions/abc/tokens",
      headers: { "content-type": "application/json" },
      socket: { remoteAddress: "127.0.0.1" },
      body: {},
    };
    const res: any = {
      headersSent: true,
      writableEnded: true,
      setHeader: writeAfterSend,
      appendHeader: writeAfterSend,
      status: writeAfterSend,
      json: writeAfterSend,
      end: writeAfterSend,
    };

    const handlerPromise = handler(req, res);
    // Settle the upstream late, after the "prior 504" already went out.
    upstreamResolve(fakeUpstreamResponse(200, '{"late":true}'));

    // The handler must resolve WITHOUT throwing ERR_HTTP_HEADERS_SENT: the
    // headersSent guards short-circuit before any res.* write is attempted.
    await expect(handlerPromise).resolves.toBeUndefined();
    expect(res.headersSent).toBe(true);
  });
});
