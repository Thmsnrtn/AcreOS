/**
 * BOOT SMOKE — construct the app and register EVERY route, exactly as boot does.
 *
 * THE GAP THIS CLOSES. On 2026-08-25 production was down for hours because
 * `server/routes-decisions.ts` declared `router.get("/:id(\\d+)")`. Express 5
 * ships path-to-regexp v8, which REMOVED inline regex params, so that pattern
 * does not compile a route — it THROWS, at route REGISTRATION, during boot,
 * before the process binds :5000. Every machine crash-looped with exit_code=1
 * and wrote zero application log lines.
 *
 * It shipped through a completely green pipeline, and the reason is structural
 * rather than an oversight: **nothing in this repo ever executed route
 * registration.** 12,921 tests mount routers individually or mock them.
 * `npm run check` sees a well-typed string. `npm run build` bundles a string
 * literal happily. Three gates, none of which runs the thing that broke.
 *
 * This file is the one place the whole graph is actually built.
 *
 * WHY NOT "just import every router module" — measured, not assumed. Only 667
 * route registrations sit at module scope; 1,907 sit inside `register*Routes(app)`
 * function bodies that run only when registerRoutes CALLS them. Import-only
 * executes ~26% of registration, so a bad pattern inside any registrar would
 * sail through it. It would also need a hand-maintained exclusion list (importing
 * server/index.ts boots the app and binds a port). registerRoutes is
 * self-bounding and needs no list.
 *
 * WHY THIS IS SAFE IN CI — measured by instrumenting net.Socket.connect,
 * dns.lookup, fs writes and http.Server.listen around a real run:
 *   connects: one TCP attempt to localhost:5432 (lazy pg pool, fail-open)
 *   listen(): 0     fs writes: 0     outbound HTTP/HTTPS: 0
 * Nothing is emailed, no SMS, no webhook, no provider call. `server/db.ts`
 * throws at module load without DATABASE_URL, but needs only a parseable
 * STRING — tests/setup.ts already sets one, and `new pg.Pool()` does not
 * connect eagerly.
 *
 * RELATIONSHIP TO routePathsCompile.test.ts: complementary, neither subsumes
 * the other. That gate re-derives path literals with a regex and hands them to
 * the real compiler — fast, and it covers paths this file would only reach if
 * the surrounding code runs. This file compiles the paths Express ACTUALLY
 * receives, including template-literal registrations and anything built at
 * runtime, and it also catches registration failures that are not about path
 * syntax at all (a handler that is `undefined` because of a default-vs-named
 * import mismatch throws "argument handler must be a function" with the exact
 * same outage signature, and no static gate can see it).
 *
 * MEASURED 2026-08-27: ~16-23s, ~510MB RSS, 2,536 app layers.
 */
import { describe, it, expect } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import http from "node:http";

/** Express 5 exposes the router as `app.router`. Narrow rather than `any`. */
type AppWithRouter = Express & { router: { stack: unknown[] } };

/**
 * A FLOOR, deliberately not a down-only ratchet.
 *
 * The house ratchet shape is wrong for this number: route count legitimately
 * GROWS, so `count > baseline` must be fine and only `count <` is a defect.
 * Set well below the measured 2,536 so ordinary churn cannot trip it, and high
 * enough that a registerRoutes reduced to a no-op cannot pass.
 */
const MIN_APP_LAYERS = 1800;

describe("the app boots: every route registers", () => {
  it("registerRoutes completes and mounts the full route graph", async () => {
    // Imported INSIDE the test so a module-evaluation throw is attributed here
    // rather than collapsing the file. That matters because it is how the
    // outage actually presented: routes.ts statically imports 100+ router
    // modules, each running its router.get(...) calls at import time.
    const { registerRoutes } = await import("../../server/routes");

    const app = express() as AppWithRouter;
    const httpServer = http.createServer(app);

    // No try/catch. A throw here IS the failure, and its stack names the
    // offending file:line exactly as the crash-loop would have.
    await registerRoutes(httpServer, app);

    // VACUITY GUARD, first. A registerRoutes that early-returns — or gets
    // wrapped in a swallow, or gated behind an env flag someone adds later —
    // would otherwise pass at zero routes, which reads as a clean boot.
    expect(
      app.router.stack.length,
      "registerRoutes returned without mounting the route graph. This test " +
        "proves nothing over an empty app: fix the registration, do not lower " +
        "MIN_APP_LAYERS.",
    ).toBeGreaterThan(MIN_APP_LAYERS);
  }, 120_000);

  it("the booted app actually serves the liveness probe", async () => {
    // Registration succeeding is necessary; being ROUTABLE is the property
    // that was actually lost in the outage — Fly's proxy reported "instance
    // refused connection" because nothing ever answered on :5000.
    // /api/healthz (server/routes.ts:516) is pure: no DB, no upstream fan-out.
    // supertest binds an ephemeral loopback port only.
    const { registerRoutes } = await import("../../server/routes"); // warm cache
    const app = express();
    await registerRoutes(http.createServer(app), app);

    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
  }, 120_000);
});
