/**
 * idempotencyMiddleware holds a key "in flight" until the FIRST attempt has
 * produced its response — not until its socket closes.
 *
 * Releasing on "close" meant a client that gave up while the handler was still
 * running (the ordinary reason a client retries) released the marker, and its
 * retry ran the handler a second time. Also pinned: a marker past its TTL stops
 * blocking, and the local store is bounded.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { idempotencyMiddleware } from "../../server/middleware/idempotency";

const servers: http.Server[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) s.closeAllConnections?.(), s.close();
});

function harness(handlerMs: number) {
  let runs = 0;
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { organization: unknown }).organization = { id: 7 };
    next();
  });
  app.post("/things", idempotencyMiddleware, (_req, res) => {
    runs++;
    setTimeout(() => res.status(201).json({ id: runs }), handlerMs);
  });
  return { app, runs: () => runs };
}

function abortedPost(app: express.Express, key: string, abortAfterMs: number): Promise<void> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const port = (server.address() as AddressInfo).port;
      const req = http.request({ host: "127.0.0.1", port, path: "/things", method: "POST", headers: { "Idempotency-Key": key } });
      req.on("error", () => resolve());
      req.end();
      setTimeout(() => {
        req.destroy();
        resolve();
      }, abortAfterMs);
    });
  });
}

describe("abort, then retry", () => {
  it("a retry while the aborted first attempt is still running gets 409, and the handler runs ONCE", async () => {
    const { app, runs } = harness(400);
    const key = `abort-${Date.now()}`;
    await abortedPost(app, key, 50);
    const retry = await request(app).post("/things").set("Idempotency-Key", key);
    expect(retry.status).toBe(409);
    expect(retry.body).toMatchObject({ error: "IDEMPOTENCY_IN_PROGRESS", statusCode: 409 });
    await new Promise((r) => setTimeout(r, 500)); // first attempt finishes
    const later = await request(app).post("/things").set("Idempotency-Key", key);
    expect(later.status).toBe(201);
    expect(later.body).toEqual({ id: 1 });
    expect(runs()).toBe(1);
  });

  it("a marker past its TTL no longer blocks (a first attempt that never answered)", async () => {
    let runs = 0;
    const app = express();
    app.post("/hang", idempotencyMiddleware, (_req, res) => {
      runs++;
      if (runs > 1) res.status(201).json({ ok: true }); // the first never answers
    });
    const key = `ttl-${Date.now()}`;
    const real = Date.now();
    void request(app).post("/hang").set("Idempotency-Key", key).timeout(200).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect((await request(app).post("/hang").set("Idempotency-Key", key)).status).toBe(409);
    vi.spyOn(Date, "now").mockReturnValue(real + 6 * 60 * 1000);
    expect((await request(app).post("/hang").set("Idempotency-Key", key)).status).toBe(201);
  });
});

describe("the local store is bounded", () => {
  it("past 10,000 keys the oldest stops replaying", async () => {
    const mk = (key: string) => {
      const res = {
        statusCode: 200,
        status(c: number) { this.statusCode = c; return this; },
        json: vi.fn(function (this: unknown) { return this; }),
        on: () => undefined,
      };
      const req = { headers: { "idempotency-key": key }, organization: { id: 99 } };
      return { req, res };
    };
    const prefix = `cap-${Date.now()}-`;
    for (let i = 0; i < 10_050; i++) {
      const { req, res } = mk(prefix + i);
      await new Promise<void>((done) => idempotencyMiddleware(req as never, res as never, () => { (res as { json: (b: unknown) => void }).json({ i }); done(); }));
    }
    const first = mk(prefix + 0);
    const nextCalled = await new Promise<boolean>((done) => {
      idempotencyMiddleware(first.req as never, first.res as never, () => done(true));
      setTimeout(() => done(false), 50);
    });
    expect(nextCalled, "the oldest key was still replayed").toBe(true);
  }, 60_000);
});
