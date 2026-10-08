/**
 * A provider callback must reach its own authenticity check — not the `/api`
 * catch-all's session check — when it arrives with no session.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 * `server/routes.ts` mounts `app.use('/api', isAuthenticated, getOrCreateOrg,
 * <router>)`. Express runs that middleware for EVERY `/api/*` request that
 * reaches it, so a route registered later inherits a session requirement it
 * never declared (apiCatchAllOrdering.test.ts documents the trap). The three
 * Twilio callbacks — inbound SMS (replies AND STOP opt-outs), delivery status
 * and recording status — were registered by `registerMiscRoutes`, long after
 * the catch-all. Twilio carries no session, so:
 *
 *   - in production every inbound SMS was answered "401 No valid session"
 *     before `verifyInboundTwilioSms` ran: no reply stored, no STOP honoured
 *     in-app, no delivery status recorded;
 *   - under E2E test auth (where a cookieless request resolves to the shared
 *     fixed test user) the catch-all's `getOrCreateOrg` PROVISIONED AN
 *     ORGANIZATION for that user inside the provider's callback, and stamped
 *     it on the request as `req.organization`. The year simulation's tenant
 *     tap saw that phantom org's `team_members` row inside a request acting
 *     for the number's owner, and flagged it as cross-tenant.
 *
 * ── WHAT THIS FILE PROVES, AND OVER WHAT POPULATION ─────────────────────────
 * It boots the REAL route graph (registerRoutes, as bootSmoke.test.ts does)
 * and reads the population from the booted router stack — not from source
 * text, so registration order inside any registrar, wrappers and template
 * paths are all seen exactly as Express sees them.
 *
 *   1. request level: a cookieless POST to each Twilio callback is answered by
 *      the Twilio verifier, never by the catch-all;
 *   2. stack level: every provider callback in the booted app (a path under
 *      `/api/webhooks/` or ending `/webhook`, that does not itself declare a
 *      session) is either preceded by NO session-requiring `/api` middleware,
 *      or is on KNOWN_SHADOWED — a down-only list of callbacks that are still
 *      behind the catch-all and still need adjudicating one by one (each one
 *      that moves opens a handler to anonymous callers, so each move needs its
 *      own verifier read first).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import http from "node:http";

type Layer = {
  name: string;
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: Array<{ name: string }> };
  match(path: string): boolean;
};
type AppWithRouter = Express & { router: { stack: Layer[] } };

/** Middleware that requires a session — or provisions an org from one. */
const SESSION_GUARDS = new Set(["isAuthenticated", "getOrCreateOrg"]);

/** The Twilio callbacks this file was written for. Each must reach its verifier. */
const MUST_REACH_VERIFIER: Array<{ path: string; verifierRefusal: RegExp }> = [
  // No X-Twilio-Signature header → verifyInboundTwilioSms refuses before any DB read.
  { path: "/api/webhooks/twilio/sms", verifierRefusal: /Missing Twilio signature/ },
  // No TWILIO_AUTH_TOKEN in the unit env → verifyTwilioSignature fails closed.
  { path: "/api/webhooks/twilio/sms-status", verifierRefusal: /Twilio signature verification unavailable/ },
  { path: "/api/webhooks/twilio/recording-status", verifierRefusal: /Twilio signature verification unavailable/ },
];

/**
 * Provider callbacks STILL behind the catch-all (measured 2026-10-08 against
 * the booted app). Down-only: remove an entry when its route moves ahead of
 * the catch-all; never add one — register a new callback before the catch-all.
 */
const KNOWN_SHADOWED = new Set([
  "POST /api/webhooks/title-orders/:orderId/status",
  "POST /api/webhooks/lob",
  "POST /api/stripe/connect/webhook",
  "POST /api/webhooks/inbound-email",
  "POST /api/webhooks/sendgrid/events",
  "POST /api/webhooks/ses/events",
  "GET /api/webhooks/meta-lead-ads",
  "POST /api/webhooks/meta-lead-ads",
]);

const isProviderCallbackPath = (p: string) => /^\/api\/webhooks\/./.test(p) || /\/webhook$/.test(p);
/** A concrete path a route pattern matches, for asking a `use` layer whether it applies. */
const concrete = (p: string) => p.replace(/:[A-Za-z_]\w*/g, "x");

let app: AppWithRouter;

beforeAll(async () => {
  const { registerRoutes } = await import("../../server/routes");
  app = express() as AppWithRouter;
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  await registerRoutes(http.createServer(app), app);
}, 180_000);

/** Every provider callback in the booted app, with whether a session guard runs ahead of it. */
function providerCallbacks() {
  const stack = app.router.stack;
  const out: Array<{ key: string; shadowedBy: number[] }> = [];
  stack.forEach((layer, i) => {
    if (!layer.route) return;
    for (const path of ([] as string[]).concat(layer.route.path)) {
      if (!isProviderCallbackPath(path)) continue;
      // A route that declares its own session is not a provider callback.
      if (layer.route.stack.some((h) => SESSION_GUARDS.has(h.name))) continue;
      const shadowedBy: number[] = [];
      for (let j = 0; j < i; j++) {
        const g = stack[j];
        if (!g.route && SESSION_GUARDS.has(g.name) && g.match(concrete(path))) shadowedBy.push(j);
      }
      for (const m of Object.keys(layer.route.methods)) out.push({ key: `${m.toUpperCase()} ${path}`, shadowedBy });
    }
  });
  return out;
}

describe("Twilio callbacks reach their own verifier, not the session catch-all", () => {
  for (const { path, verifierRefusal } of MUST_REACH_VERIFIER) {
    it(`a cookieless POST ${path} is answered by the Twilio verifier`, async () => {
      const res = await request(app)
        .post(path)
        .type("form")
        .send("From=%2B15550001111&To=%2B15550002222&Body=STOP&MessageSid=SMx");
      const message = String(res.body?.message ?? res.text);
      expect(message, `${path} was refused by the /api session catch-all before its handler ran`).not.toMatch(
        /No valid session/,
      );
      expect(message).toMatch(verifierRefusal);
    }, 60_000);
  }
});

describe("the population: every provider callback in the booted app", () => {
  it("finds the callbacks it claims to govern (vacuity floor)", () => {
    const keys = providerCallbacks().map((c) => c.key);
    for (const { path } of MUST_REACH_VERIFIER) expect(keys).toContain(`POST ${path}`);
    expect(keys.length).toBeGreaterThanOrEqual(MUST_REACH_VERIFIER.length + KNOWN_SHADOWED.size);
  });

  it("the shadow detector sees the catch-all (it would go red on a shadowed callback)", () => {
    // Every KNOWN_SHADOWED entry must still be detected as shadowed: if the
    // detector stopped matching `use` layers, this list would read as "moved"
    // rather than as the detector going blind.
    const byKey = new Map(providerCallbacks().map((c) => [c.key, c]));
    for (const key of Array.from(KNOWN_SHADOWED)) {
      const c = byKey.get(key);
      if (!c) continue; // removed route — the down-only check below reports it
      expect(c.shadowedBy.length, `${key} is no longer behind the catch-all — remove it from KNOWN_SHADOWED`).toBeGreaterThan(0);
    }
  });

  it("no provider callback is behind the session catch-all unless already known (down-only)", () => {
    const shadowed = providerCallbacks().filter((c) => c.shadowedBy.length > 0).map((c) => c.key);
    const unexpected = shadowed.filter((k) => !KNOWN_SHADOWED.has(k));
    expect(
      unexpected,
      "a provider callback is registered after `app.use('/api', isAuthenticated, …)`: it will 401 every " +
        "real delivery (the provider has no session) and, under test auth, provision an org inside the " +
        "callback. Register it before the catch-all in server/routes.ts.",
    ).toEqual([]);
    const stale = Array.from(KNOWN_SHADOWED).filter((k) => !shadowed.includes(k));
    expect(stale, "these left the catch-all's shadow — remove them from KNOWN_SHADOWED").toEqual([]);
  });
});
