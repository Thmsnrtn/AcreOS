/**
 * The founder wire step must save the CONNECT endpoint's signing secret under
 * the key the CONNECT route reads — and leave the platform secret alone.
 *
 * ── THE WART (found by the P3-4 test-mode settlement proof, 2026-11-15) ─────
 * Three facts composed into a Connect route that could never verify a wired
 * secret on a real deployment:
 *
 *   (a) `POST /api/founder/setup/wire/stripe` (server/routes-setup.ts) creates
 *       a Connect webhook endpoint (`connect: true`, pointed at
 *       /api/stripe/connect/webhook) and saved its secret with
 *       `saveCredential("STRIPE_WEBHOOK_SECRET", …)` — the PLATFORM key;
 *   (b) the Connect route (server/routes-billing.ts,
 *       registerStripeConnectWebhookRoute) verifies against
 *       `STRIPE_CONNECT_WEBHOOK_SECRET || STRIPE_WEBHOOK_SECRET`;
 *   (c) `loadConfigToEnv` (server/services/configManager.ts) never lets a DB
 *       value override a real env var — and on Fly `STRIPE_WEBHOOK_SECRET` IS
 *       a real env var (the platform endpoint's secret).
 *
 * So after a restart the wired Connect secret was shadowed twice over and the
 * Connect route verified connected-account events against the platform secret
 * (every delivery 400). Worse, in the RUNNING process `saveCredential` patches
 * process.env immediately, so until that restart the PLATFORM route verified
 * subscription events against the Connect secret.
 *
 * ── WHAT THIS FILE PROVES ───────────────────────────────────────────────────
 * It drives the REAL wire step (the setup router behind its founder guard, the
 * Stripe SDK's webhookEndpoints.list/create intercepted at the prototype — no
 * network), the REAL config store seam (an in-memory `platform_config` behind
 * `saveCredential` / `loadConfigToEnv`), a simulated restart into a Fly-shaped
 * env (platform secret set, Connect secret unset), and then the two REAL
 * webhook routes, asking each to verify a correctly signed payload:
 *
 *   1. the Connect route accepts a payload signed with the WIRED Connect
 *      secret, and rejects one signed with the platform secret;
 *   2. the platform route still accepts a payload signed with the platform
 *      secret and rejects one signed with the Connect secret — in the running
 *      process right after the wire step AND after the restart;
 *   3. the config store holds the secret under STRIPE_CONNECT_WEBHOOK_SECRET
 *      and the wire step wrote nothing under STRIPE_WEBHOOK_SECRET;
 *   4. precedence stays with the operator: a Connect secret set in env (the
 *      hand-configured staging case) is NOT overridden by the DB copy;
 *   5. fail-closed survives: with neither secret configured the Connect route
 *      refuses before any signature check.
 *
 * It does not pin the save by its key STRING in source — it pins what the
 * routes actually verify against, which is the property the wart broke.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import Stripe from "stripe";
import type { Table } from "drizzle-orm";

// ── In-memory platform_config, hoisted so the db mock factory can reach it ──
type ConfigRow = {
  key: string;
  encryptedValue: string | null;
  service: string;
  label: string;
  isSecret: boolean;
  isRequired: boolean;
  validationStatus: string | null;
  validationMessage: string | null;
  validatedAt: Date | null;
  updatedAt: Date;
};

const configStore = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  /** Every key `saveCredential` has written, in order (including re-writes). */
  const writes: string[] = [];
  return {
    rows,
    writes,
    reset() {
      rows.clear();
      writes.length = 0;
    },
  };
});

vi.mock("../../server/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const nameOf = (t: unknown) => getTableName(t as Table);

  /**
   * A thenable chain for every statement this test does not model: any method
   * returns the chain, awaiting it yields `result`. The Connect route's
   * idempotency claim (`insert … onConflictDoNothing().returning()`) and the
   * platform route's twin both land here and read "not claimed", so a verified
   * event is acknowledged as a duplicate — fine, the discriminator is whether
   * the SIGNATURE verified, which is logged before the claim.
   */
  function anyChain(result: unknown[] = []): unknown {
    const target = () => undefined;
    const chain: unknown = new Proxy(target, {
      get(_t, prop) {
        if (prop === "then") {
          return (onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onF, onR);
        }
        if (prop === "catch") return (onR?: (e: unknown) => unknown) => Promise.resolve(result).catch(onR);
        if (prop === "finally") return (f?: () => void) => Promise.resolve(result).finally(f);
        return () => chain;
      },
      apply() {
        return chain;
      },
    });
    return chain;
  }

  const db = {
    select() {
      return {
        from(table: unknown) {
          if (nameOf(table) === "platform_config") return anyChain([...configStore.rows.values()]);
          return anyChain([]);
        },
      };
    },
    insert(table: unknown) {
      return {
        values(v: Record<string, unknown>) {
          if (nameOf(table) !== "platform_config") return anyChain([]);
          return {
            // configManager.saveCredential's exact shape: upsert on `key`,
            // the conflict branch rewriting only `set`.
            onConflictDoUpdate(opts: { set: Record<string, unknown> }) {
              const key = String(v.key);
              const existing = configStore.rows.get(key);
              configStore.rows.set(key, existing ? { ...existing, ...opts.set } : { ...v });
              configStore.writes.push(key);
              return Promise.resolve();
            },
          };
        },
      };
    },
    update() {
      return anyChain([]);
    },
    delete(table: unknown) {
      return {
        where() {
          if (nameOf(table) === "platform_config") {
            // Not driven here; deleteCredential is out of scope.
            return Promise.resolve();
          }
          return anyChain([]);
        },
      };
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    execute: async () => ({ rows: [] }),
    query: new Proxy({}, { get: () => ({ findMany: async () => [], findFirst: async () => undefined }) }),
  };

  const pool = { on() {}, query: async () => ({ rows: [] }), end: async () => {} };
  return {
    db,
    pool,
    replicaPool: pool,
    dbReplica: null,
    dbReadOnly: db,
    dbReplicaUnsafe: db,
    DB_ROLES: { primary: "primary", replica: "replica_ro" },
    assertReplicaRoleAtBoundary: async () => ({ reported: null, matches: true }),
    withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
});

// ── Fixture values. Distinct on purpose: the whole defect is one standing in for the other. ──
const PLATFORM_SECRET_IN_ENV = "whsec_platform_from_fly_env";
const WIRED_CONNECT_SECRET = "whsec_connect_returned_by_stripe_on_create";
const OPERATOR_CONNECT_SECRET_IN_ENV = "whsec_connect_hand_set_by_operator";
const APP_URL = "https://wire-test.acreos.test";
const CONNECT_WEBHOOK_URL = `${APP_URL}/api/stripe/connect/webhook`;

/** The route-side Stripe client needs a key shape; verification is local and makes no call. */
const BASE_ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: "sk_test_wire_unused",
  APP_URL,
  // Deterministic field key so saveCredential's encrypt → loadConfigToEnv's
  // decrypt round-trips (tests/setup.ts sets a non-hex ENCRYPTION_KEY, which
  // fieldEncryption would otherwise try to read as hex and refuse).
  FIELD_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};

/** The env a Fly machine boots with: platform secret set, Connect secret NOT set. */
function flyShapedEnv(): void {
  process.env.STRIPE_WEBHOOK_SECRET = PLATFORM_SECRET_IN_ENV;
  delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
}

/** The parser server/index.ts mounts ahead of the Connect route: JSON with the raw bytes kept. */
function productionParsers(a: Express): void {
  a.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf;
      },
    }),
  );
}

/** A signed Stripe delivery for `secret`, as Stripe's own SDK would sign it. */
function signed(payload: string, secret: string): string {
  return new Stripe("sk_test_signer").webhooks.generateTestHeaderString({ payload, secret });
}

const CONNECT_EVENT = JSON.stringify({
  id: "evt_wire_connect",
  object: "event",
  type: "wire.unhandled",
  data: { object: {} },
});
const PLATFORM_EVENT = JSON.stringify({
  id: "evt_wire_platform",
  object: "event",
  type: "wire.unhandled",
  data: { object: {} },
});

const logged: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [...Object.keys(BASE_ENV), "STRIPE_WEBHOOK_SECRET", "STRIPE_CONNECT_WEBHOOK_SECRET"];

let setupApp: Express;
let connectApp: Express;
let platformApp: Express;
let loadConfigToEnv: () => Promise<void>;
let created: ReturnType<typeof vi.fn>;

type EndpointsProto = {
  list: (...a: unknown[]) => unknown;
  create: (...a: unknown[]) => unknown;
};

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const [k, v] of Object.entries(BASE_ENV)) process.env[k] = v;
  flyShapedEnv();

  const { logger } = await import("../../server/utils/logger");
  for (const level of ["warn", "error", "info"] as const) {
    vi.spyOn(logger, level).mockImplementation(((message: string) => {
      logged.push(String(message));
    }) as never);
  }

  // The Stripe SDK, intercepted where every client instance looks: the
  // WebhookEndpoints resource prototype. routes-setup builds its own
  // `new Stripe(key)` and calls `.webhookEndpoints.list/create` on it; both
  // land here and no request leaves the process. `webhooks.constructEvent`
  // is untouched, so the routes under test verify real signatures.
  const proto = (Stripe as unknown as { resources: { WebhookEndpoints: { prototype: EndpointsProto } } })
    .resources.WebhookEndpoints.prototype;
  vi.spyOn(proto, "list").mockImplementation(async () => ({ object: "list", data: [], has_more: false, url: "/v1/webhook_endpoints" }));
  created = vi.fn(async (params: { url: string; enabled_events: string[]; connect?: boolean }) => ({
    id: "we_wire_test",
    object: "webhook_endpoint",
    url: params.url,
    enabled_events: params.enabled_events,
    application: params.connect ? "ca_wire_test" : undefined,
    status: "enabled",
    livemode: false,
    // Stripe returns the signing secret ONLY on create — this is the value the
    // wire step must persist, and the value the Connect route must then use.
    secret: WIRED_CONNECT_SECRET,
  }));
  vi.spyOn(proto, "create").mockImplementation(created as unknown as EndpointsProto["create"]);

  // The real setup router behind its real founder guard. requireFounder reads
  // req.user.email; tests/setup.ts fixes FOUNDER_EMAIL before any import.
  const setupRouter = (await import("../../server/routes-setup")).default;
  setupApp = express();
  setupApp.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: { email: string } }).user = { email: String(process.env.FOUNDER_EMAIL) };
    next();
  });
  setupApp.use("/api/founder/setup", setupRouter);

  ({ loadConfigToEnv } = await import("../../server/services/configManager"));

  // The real Connect route, behind the production JSON parser.
  const { registerStripeConnectWebhookRoute } = await import("../../server/routes-billing");
  connectApp = express();
  productionParsers(connectApp);
  registerStripeConnectWebhookRoute(connectApp);

  // The real platform route (server/index.ts mounts it BEFORE the JSON parser).
  const { mountStripeWebhook } = await import("../../server/stripeWebhookRoute");
  platformApp = express();
  mountStripeWebhook(platformApp);
}, 180_000);

afterAll(() => {
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => {
  configStore.reset();
  created.mockClear();
  logged.length = 0;
  flyShapedEnv();
});

/** POST the Connect route a payload signed with `secret`; true when the signature verified. */
async function connectRouteAccepts(secret: string): Promise<boolean> {
  logged.length = 0;
  const res = await request(connectApp)
    .post("/api/stripe/connect/webhook")
    .set("Content-Type", "application/json")
    .set("stripe-signature", signed(CONNECT_EVENT, secret))
    .send(CONNECT_EVENT);
  const verified = logged.includes("Stripe Connect webhook event received");
  const refused = /Webhook Error/.test(String(res.body?.message ?? res.text));
  // Exactly one of the two, so a route that neither verified nor refused
  // (a 500 before the check, say) cannot read as either outcome.
  expect(verified !== refused, `Connect route gave an ambiguous answer: ${res.status} ${res.text.slice(0, 160)}`).toBe(true);
  return verified;
}

/** POST the platform route a payload signed with `secret`; true when the signature verified. */
async function platformRouteAccepts(secret: string): Promise<boolean> {
  const res = await request(platformApp)
    .post("/api/stripe/webhook")
    .set("Content-Type", "application/json")
    .set("stripe-signature", signed(PLATFORM_EVENT, secret))
    .send(PLATFORM_EVENT);
  if (res.status === 200 && res.body?.received === true) return true;
  expect(res.status, `platform route: ${res.text.slice(0, 160)}`).toBe(400);
  expect(String(res.body?.message)).toMatch(/signature verification failed/);
  return false;
}

/** Run the founder wire step for Stripe against the intercepted SDK. */
async function wireStripe(): Promise<{ status: string; message: string; details?: Record<string, unknown> }> {
  const res = await request(setupApp).post("/api/founder/setup/wire/stripe").send({});
  expect(res.status).toBe(200);
  return res.body;
}

/** The restart Fly performs: a fresh env (platform secret set, Connect unset), then the DB patch. */
async function restartIntoFlyEnv(): Promise<void> {
  flyShapedEnv();
  await loadConfigToEnv();
}

describe("the wire step itself", () => {
  it("creates a CONNECT endpoint at the Connect route's URL and reports its secret saved", async () => {
    const body = await wireStripe();
    expect(body.status, JSON.stringify(body)).toBe("ok");
    expect(created).toHaveBeenCalledTimes(1);
    const params = created.mock.calls[0][0] as { url: string; connect?: boolean };
    expect(params.url).toBe(CONNECT_WEBHOOK_URL);
    expect(params.connect).toBe(true);
    expect(body.details?.secret).toBe("saved");
  });

  it("persists the secret under STRIPE_CONNECT_WEBHOOK_SECRET and writes nothing under the platform key", async () => {
    await wireStripe();
    expect(configStore.writes, "the wire step provisions only the Connect endpoint, so it may write only its key").toEqual([
      "STRIPE_CONNECT_WEBHOOK_SECRET",
    ]);
    expect(configStore.rows.has("STRIPE_WEBHOOK_SECRET")).toBe(false);
    const row = configStore.rows.get("STRIPE_CONNECT_WEBHOOK_SECRET");
    expect(row).toBeDefined();
    // Encrypted at rest — never the plaintext.
    expect(String(row?.encryptedValue)).not.toContain(WIRED_CONNECT_SECRET);
    expect(String(row?.encryptedValue)).toMatch(/^enc:v1:/);
  });

  it("does not disturb the platform secret in the RUNNING process", async () => {
    // saveCredential patches process.env immediately. Under the wart that
    // patch overwrote STRIPE_WEBHOOK_SECRET, so the platform route started
    // verifying subscription events against the Connect secret until restart.
    await wireStripe();
    expect(process.env.STRIPE_WEBHOOK_SECRET).toBe(PLATFORM_SECRET_IN_ENV);
    expect(await platformRouteAccepts(PLATFORM_SECRET_IN_ENV)).toBe(true);
    expect(await platformRouteAccepts(WIRED_CONNECT_SECRET)).toBe(false);
  });
});

describe("after a restart into a Fly-shaped env (platform secret in env, Connect secret not)", () => {
  it("the Connect route verifies against the WIRED Connect secret — the regression the wart caused", async () => {
    await wireStripe();
    await restartIntoFlyEnv();

    expect(process.env.STRIPE_CONNECT_WEBHOOK_SECRET).toBe(WIRED_CONNECT_SECRET);
    expect(await connectRouteAccepts(WIRED_CONNECT_SECRET)).toBe(true);
    // …and NOT against the platform secret, which is what it did before.
    expect(await connectRouteAccepts(PLATFORM_SECRET_IN_ENV)).toBe(false);
  });

  it("the platform route is unchanged: it verifies against STRIPE_WEBHOOK_SECRET exactly as before", async () => {
    await wireStripe();
    await restartIntoFlyEnv();

    expect(process.env.STRIPE_WEBHOOK_SECRET).toBe(PLATFORM_SECRET_IN_ENV);
    expect(await platformRouteAccepts(PLATFORM_SECRET_IN_ENV)).toBe(true);
    expect(await platformRouteAccepts(WIRED_CONNECT_SECRET)).toBe(false);
  });

  it("CONTROL: without the wire step the Connect route falls back to the platform secret (the pre-fix deployment)", async () => {
    // Nothing in the store → loadConfigToEnv patches nothing → the route's
    // `|| STRIPE_WEBHOOK_SECRET` fallback is what verifies. This is the state
    // the wart left every Fly deployment in; it pins that the cases above are
    // discriminating, not merely green.
    await restartIntoFlyEnv();
    expect(process.env.STRIPE_CONNECT_WEBHOOK_SECRET).toBeUndefined();
    expect(await connectRouteAccepts(WIRED_CONNECT_SECRET)).toBe(false);
    expect(await connectRouteAccepts(PLATFORM_SECRET_IN_ENV)).toBe(true);
  });
});

describe("precedence stays with the operator", () => {
  it("a Connect secret set in env (staging's hand configuration) is not overridden by the wired DB copy", async () => {
    await wireStripe();
    // Restart with BOTH set in env — the P3-4 staging shape.
    flyShapedEnv();
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = OPERATOR_CONNECT_SECRET_IN_ENV;
    await loadConfigToEnv();

    expect(process.env.STRIPE_CONNECT_WEBHOOK_SECRET).toBe(OPERATOR_CONNECT_SECRET_IN_ENV);
    expect(await connectRouteAccepts(OPERATOR_CONNECT_SECRET_IN_ENV)).toBe(true);
    expect(await connectRouteAccepts(WIRED_CONNECT_SECRET)).toBe(false);
    expect(await platformRouteAccepts(PLATFORM_SECRET_IN_ENV)).toBe(true);
  });
});

describe("fail-closed survives", () => {
  it("with neither secret configured the Connect route refuses before any signature check", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    await loadConfigToEnv(); // empty store: patches nothing

    const res = await request(connectApp)
      .post("/api/stripe/connect/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signed(CONNECT_EVENT, WIRED_CONNECT_SECRET))
      .send(CONNECT_EVENT);
    expect(res.status).toBe(400);
    expect(String(res.body?.message)).toMatch(/Webhook secret not configured/);
    expect(logged).not.toContain("Stripe Connect webhook event received");
  });
});
