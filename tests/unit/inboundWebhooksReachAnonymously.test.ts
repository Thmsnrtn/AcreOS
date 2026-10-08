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
 *     it on the request as `req.organization` — a phantom org created inside
 *     a request acting for the number's owner.
 *
 * The same was true of every other provider callback registered after the
 * catch-all: Lob delivery events, Stripe Connect events, SES bounce/complaint
 * notifications, SendGrid events, inbound email and title-partner status
 * updates. Each authenticates the provider itself and now registers before the
 * catch-all. The Meta lead-ads pair joined them on 2026-10-08, once its
 * destination org was decided (the founder's own, or refuse — see
 * metaLeadAdsFounderOrg.test.ts); KNOWN_SHADOWED is now empty.
 *
 * ── WHAT THIS FILE PROVES, AND OVER WHAT POPULATION ─────────────────────────
 * It boots the REAL route graph (registerRoutes, as bootSmoke.test.ts does,
 * behind the same JSON parser server/index.ts mounts — it keeps req.rawBody)
 * and reads the population from the booted router stack — not from source
 * text, so registration order inside any registrar, wrappers and template
 * paths are all seen exactly as Express sees them.
 *
 *   1. request level: an unauthenticated request to each callback in
 *      MUST_REACH_VERIFIER is answered by THAT callback's own verifier —
 *      identified by something only the verifier says — never by the
 *      catch-all. Each request is one the handler would ACCEPT if the
 *      verifier were removed, so dropping a verifier turns its case red;
 *   2. stack level: every provider callback in the booted app (a path under
 *      `/api/webhooks/` or ending `/webhook`, that does not itself declare a
 *      session) is either preceded by NO session-requiring `/api` middleware,
 *      or is on KNOWN_SHADOWED — a down-only list of callbacks still behind
 *      the catch-all on purpose; and every unshadowed callback is in
 *      MUST_REACH_VERIFIER, so a new anonymous callback cannot arrive without
 *      a request-level proof that it refuses an unverified caller;
 *   3. the shadow detector is proven against a canary app, so an empty
 *      KNOWN_SHADOWED cannot read as "the detector went blind".
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import http from "node:http";
import crypto from "node:crypto";

type Layer = {
  name: string;
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: Array<{ name: string }> };
  match(path: string): boolean;
};
type AppWithRouter = Express & { router: { stack: Layer[] } };

/** Middleware that requires a session — or provisions an org from one. */
const SESSION_GUARDS = new Set(["isAuthenticated", "getOrCreateOrg"]);

/** Log lines emitted during the request-level cases (logger.warn / logger.error / logger.info). */
const logged: string[] = [];

/** Env each verifier needs to be EXERCISED rather than refused for lack of config. */
const TEST_ENV: Record<string, string> = {
  LOB_WEBHOOK_SECRET: "lob-test-secret",
  STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_reach_test",
  // The route builds a Stripe client before verifying; any key shape will do —
  // signature verification is local and makes no API call.
  STRIPE_SECRET_KEY: "sk_test_reach_unused",
  SES_EVENTS_SNS_TOPIC_ARNS: "arn:aws:sns:us-east-1:123:ses-events",
  // Any well-formed Ed25519 public key: the request below carries no signature.
  SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY: crypto
    .generateKeyPairSync("ed25519")
    .publicKey.export({ type: "spki", format: "der" })
    .toString("base64"),
  INBOUND_EMAIL_WEBHOOK_SECRET: "inbound-test-secret",
  META_WEBHOOK_VERIFY_TOKEN: "meta-verify-test-token",
  META_APP_SECRET: "meta-app-test-secret",
};

type Res = { status: number; body: any; text: string };
type Case = {
  method: "GET" | "POST";
  path: string;
  /** The concrete URL to call (defaults to path). */
  url?: string;
  send: (r: request.Test) => request.Test;
  /** Something only THIS route's verifier produces. */
  refusedByVerifier: (res: Res, logs: string[]) => boolean;
  why: string;
};

const msgOf = (res: Res) => String(res.body?.message ?? res.text);

/**
 * Every provider callback that is reachable without a session, and how to
 * prove its own verifier answers. Each request is shaped so that, WITHOUT the
 * verifier, the handler would accept it.
 */
const MUST_REACH_VERIFIER: Case[] = [
  {
    method: "POST",
    path: "/api/webhooks/twilio/sms",
    send: (r) => r.type("form").send("From=%2B15550001111&To=%2B15550002222&Body=STOP&MessageSid=SMx"),
    // No X-Twilio-Signature header → verifyInboundTwilioSms refuses before any DB read.
    refusedByVerifier: (res) => /Missing Twilio signature/.test(msgOf(res)),
    why: "Twilio signature (per-org token for the To number)",
  },
  {
    method: "POST",
    path: "/api/webhooks/twilio/sms-status",
    send: (r) => r.type("form").send("MessageSid=SMx&MessageStatus=delivered"),
    // No TWILIO_AUTH_TOKEN in the unit env → verifyTwilioSignature fails closed.
    refusedByVerifier: (res) => /Twilio signature verification unavailable/.test(msgOf(res)),
    why: "Twilio signature (platform token)",
  },
  {
    method: "POST",
    path: "/api/webhooks/twilio/recording-status",
    send: (r) => r.type("form").send("CallSid=CAx&RecordingStatus=completed&RecordingUrl=https%3A%2F%2Fx"),
    refusedByVerifier: (res) => /Twilio signature verification unavailable/.test(msgOf(res)),
    why: "Twilio signature (platform token)",
  },
  {
    method: "POST",
    path: "/api/webhooks/lob",
    send: (r) => r.set("Content-Type", "application/json").send(JSON.stringify({ event_type: { id: "postcard.unknown_kind" }, reference_id: "psc_x" })),
    refusedByVerifier: (res, logs) => res.status === 401 && logs.some((l) => l.includes("[lob-webhook] rejected unverified post")),
    why: "Lob HMAC over timestamp + raw body",
  },
  {
    method: "POST",
    path: "/api/stripe/connect/webhook",
    send: (r) =>
      r
        .set("Content-Type", "application/json")
        .set("stripe-signature", "t=1,v1=00")
        .send(JSON.stringify({ id: "evt_x", object: "event", type: "reach.unhandled", data: { object: {} } })),
    refusedByVerifier: (res) =>
      res.status === 400 && /^Webhook Error/.test(msgOf(res)) && !/raw body unavailable/.test(msgOf(res)),
    why: "Stripe signature over the raw body",
  },
  {
    method: "POST",
    path: "/api/webhooks/ses/events",
    send: (r) =>
      r.set("Content-Type", "text/plain").send(
        JSON.stringify({
          Type: "Notification",
          MessageId: "reach-ses-1",
          TopicArn: TEST_ENV.SES_EVENTS_SNS_TOPIC_ARNS,
          Message: JSON.stringify({ notificationType: "Delivery" }),
          Timestamp: new Date().toISOString(),
        }),
      ),
    // Our own topic but no SNS signature: the signature check must refuse it.
    refusedByVerifier: (res, logs) => res.status === 401 && logs.some((l) => l.includes("[ses-events] SNS signature invalid")),
    why: "pinned SNS topic + SNS message signature",
  },
  {
    method: "POST",
    path: "/api/webhooks/sendgrid/events",
    send: (r) => r.set("Content-Type", "application/json").send("[]"),
    refusedByVerifier: (res) => res.status === 401 && res.body?.error === "UNAUTHORIZED",
    why: "SendGrid signed event webhook (Ed25519)",
  },
  {
    method: "POST",
    path: "/api/webhooks/inbound-email",
    send: (r) => r.set("Content-Type", "application/json").send(JSON.stringify({ from: "a@example.com", to: "b@example.com" })),
    refusedByVerifier: (res) => res.status === 401 && /Missing inbound email signature/.test(msgOf(res)),
    why: "SNS (pinned topic + signature) or HMAC fallback",
  },
  {
    method: "POST",
    path: "/api/webhooks/title-orders/:orderId/status",
    url: "/api/webhooks/title-orders/1/status",
    send: (r) => r.set("Content-Type", "application/json").send(JSON.stringify({ status: "in_progress" })),
    refusedByVerifier: (res) => res.status === 401 && res.body?.error === "UNAUTHORIZED",
    why: "partner API key + per-partner HMAC",
  },
  {
    method: "GET",
    path: "/api/webhooks/meta-lead-ads",
    url: "/api/webhooks/meta-lead-ads?hub.mode=subscribe&hub.verify_token=not-the-token&hub.challenge=reach-challenge",
    send: (r) => r,
    // A well-formed subscribe with the WRONG token: the token comparison is the
    // only thing between this caller and the echoed challenge.
    refusedByVerifier: (res) => res.status === 403 && res.text === "Forbidden" && !res.text.includes("reach-challenge"),
    why: "Meta hub.verify_token (META_WEBHOOK_VERIFY_TOKEN)",
  },
  {
    method: "POST",
    path: "/api/webhooks/meta-lead-ads",
    send: (r) =>
      r.set("Content-Type", "application/json").send(
        JSON.stringify({
          object: "page",
          entry: [{ id: "p1", changes: [{ field: "leadgen", value: { leadgen_id: "lg-reach", form_id: "f", ad_id: "a" } }] }],
        }),
      ),
    // A real leadgen delivery with no X-Hub-Signature-256 header.
    refusedByVerifier: (res, logs) =>
      res.status === 401 && logs.some((l) => l.includes("[MetaWebhookSig] request missing X-Hub-Signature-256")),
    why: "Meta X-Hub-Signature-256 over the raw body (META_APP_SECRET)",
  },
];

/**
 * Provider callbacks STILL behind the catch-all. Down-only: remove an entry
 * when its route moves ahead of the catch-all; never add one — register a new
 * callback before the catch-all, with its verifier, and add it above.
 *
 * Emptied 2026-10-08: the Meta lead-ads pair was the last entry. It was held
 * because its POST wrote each lead into a GUESSED org (DEFAULT_ORG_ID, else 1);
 * it now writes only into the founder's own org or refuses, and moved ahead.
 * The canary below keeps the detector honest while this set is empty.
 */
const KNOWN_SHADOWED = new Set<string>();

/** The population floor: Twilio x3 + the six moved + the Meta lead-ads pair. */
const POPULATION_FLOOR = 11;

const isProviderCallbackPath = (p: string) => /^\/api\/webhooks\/./.test(p) || /\/webhook$/.test(p);
/** A concrete path a route pattern matches, for asking a `use` layer whether it applies. */
const concrete = (p: string) => p.replace(/:[A-Za-z_]\w*/g, "x");

/** The parser server/index.ts mounts: JSON with the raw bytes kept as req.rawBody. */
function productionParsers(a: Express) {
  a.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf;
      },
    }),
  );
  a.use(express.urlencoded({ extended: false }));
}

/** Every provider callback on a router stack, with the session guards that run ahead of it. */
function providerCallbacks(stack: Layer[]) {
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

let app: AppWithRouter;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  const { logger } = await import("../../server/utils/logger");
  for (const level of ["warn", "error", "info"] as const) {
    const orig = logger[level].bind(logger) as (...a: unknown[]) => void;
    vi.spyOn(logger, level).mockImplementation(((message: string, ...rest: unknown[]) => {
      logged.push(String(message));
      orig(message, ...rest);
    }) as never);
  }
  const { registerRoutes } = await import("../../server/routes");
  app = express() as AppWithRouter;
  productionParsers(app);
  await registerRoutes(http.createServer(app), app);
}, 180_000);

afterAll(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("provider callbacks reach their own verifier, not the session catch-all", () => {
  for (const c of MUST_REACH_VERIFIER) {
    it(`an unauthenticated ${c.method} ${c.path} is refused by its verifier (${c.why})`, async () => {
      logged.length = 0;
      const url = c.url ?? c.path;
      const res = (await c.send(c.method === "GET" ? request(app).get(url) : request(app).post(url))) as unknown as Res;
      expect(msgOf(res), `${c.path} was refused by the /api session catch-all before its handler ran`).not.toMatch(
        /No valid session/,
      );
      expect(
        c.refusedByVerifier(res, [...logged]),
        `${c.method} ${c.path} was not refused by its own verifier — got ${res.status} ${msgOf(res).slice(0, 160)}`,
      ).toBe(true);
    }, 60_000);
  }

  it("Stripe Connect verifies the exact signed bytes behind the global JSON parser", async () => {
    // server/index.ts parses application/json before the route's express.raw,
    // so req.body arrives as an object. A correctly signed event must still
    // verify — from req.rawBody — or the route can never accept anything.
    const Stripe = (await import("stripe")).default;
    const payload = JSON.stringify({ id: "evt_reach_ok", object: "event", type: "reach.unhandled", data: { object: {} } });
    const header = new Stripe("sk_test_reach").webhooks.generateTestHeaderString({
      payload,
      secret: TEST_ENV.STRIPE_CONNECT_WEBHOOK_SECRET,
    });
    logged.length = 0;
    const res = await request(app)
      .post("/api/stripe/connect/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", header)
      .send(payload);
    expect(msgOf(res)).not.toMatch(/Webhook Error/);
    expect(logged).toContain("Stripe Connect webhook event received");
  }, 60_000);
});

describe("the population: every provider callback in the booted app", () => {
  it("finds the callbacks it claims to govern (vacuity floor)", () => {
    const keys = providerCallbacks(app.router.stack).map((c) => c.key);
    for (const c of MUST_REACH_VERIFIER) expect(keys).toContain(`${c.method} ${c.path}`);
    for (const k of Array.from(KNOWN_SHADOWED)) expect(keys).toContain(k);
    expect(keys.length).toBeGreaterThanOrEqual(POPULATION_FLOOR);
  });

  it("no provider callback is behind the session catch-all unless already known (down-only)", () => {
    const shadowed = providerCallbacks(app.router.stack).filter((c) => c.shadowedBy.length > 0).map((c) => c.key);
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

  it("every callback reachable without a session has a request-level verifier proof", () => {
    const proven = new Set(MUST_REACH_VERIFIER.map((c) => `${c.method} ${c.path}`));
    const open = providerCallbacks(app.router.stack).filter((c) => c.shadowedBy.length === 0).map((c) => c.key);
    expect(
      open.filter((k) => !proven.has(k)),
      "an anonymous provider callback has no case in MUST_REACH_VERIFIER proving it refuses an unverified caller",
    ).toEqual([]);
  });

  it("the shadow detector sees a catch-all (canary)", () => {
    // KNOWN_SHADOWED may shrink to nothing; the detector must still be shown
    // to work, on an app built with the same shape server/routes.ts uses.
    const isAuthenticated = (_q: unknown, _s: unknown, n: () => void) => n();
    const getOrCreateOrg = (_q: unknown, _s: unknown, n: () => void) => n();
    const canary = express() as AppWithRouter;
    canary.post("/api/webhooks/before", (_q, s) => s.end());
    canary.use("/api", isAuthenticated, getOrCreateOrg, express.Router());
    canary.post("/api/webhooks/after/:id", (_q, s) => s.end());
    canary.post("/api/provider/webhook", (_q, s) => s.end());
    const byKey = new Map(providerCallbacks(canary.router.stack).map((c) => [c.key, c.shadowedBy.length]));
    expect(byKey.get("POST /api/webhooks/before")).toBe(0);
    expect(byKey.get("POST /api/webhooks/after/:id")).toBeGreaterThan(0);
    expect(byKey.get("POST /api/provider/webhook")).toBeGreaterThan(0);
  });
});
