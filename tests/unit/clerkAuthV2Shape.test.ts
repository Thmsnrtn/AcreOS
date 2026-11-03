/**
 * Fix B — server auth reads @clerk/express 2.x's CALLABLE `req.auth`.
 *
 * @clerk/express 2.1.85 installs `req.auth` as a function
 * (`req.auth()` → SignedInAuthObject | SignedOutAuthObject). Before Fix B the
 * server read it as a plain object everywhere, so `req.auth?.userId` was
 * always `undefined`: the middleware's signed-in verdict was thrown away and
 * the ONLY way a cookie session authenticated was hydrateUser's manual
 * `__session` JWT fallback, gated on CLERK_JWT_KEY. With that key unset, every
 * authenticated request 401'd.
 *
 * Every request in this file builds `req.auth` in the shape the SDK really
 * installs (a callable), and the test-auth bypass is asserted to install it
 * too — the old bypass assigned a plain object, which is why the suite could
 * never see the break.
 *
 * The fallback is production's live auth path, so its behaviour is pinned
 * here end to end with a real RSA keypair: no crypto is mocked.
 *
 * Covers the package's tests 1 (v2 shape), 2 (fallback preservation) and
 * 3 (test-bypass shape). Test 4 (no object reads) is
 * clerkAuthNoObjectReads.test.ts; the MFA matrix runs under both shapes in
 * requireClerkMFA.test.ts.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

// ── Mocks (before importing the module under test) ───────────────────────────

const h = vi.hoisted(() => ({
  /** Rows the users SELECT resolves to; set per test. */
  selectRows: [] as Array<Record<string, unknown>>,
  /** Every value passed to eq(users.clerkUserId, <value>). */
  eqValues: [] as unknown[],
  inserted: [] as Array<Record<string, unknown>>,
  getUser: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
  isFounderIdentity: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
}));

vi.mock("../../server/db", () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => h.selectRows,
  };
  return {
    db: {
      select: () => selectChain,
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              const row = { id: "row_new", ...v };
              h.inserted.push(row);
              return [row];
            },
          }),
        }),
      }),
    },
  };
});
vi.mock("../../shared/models/auth", () => ({ users: { clerkUserId: "clerk_user_id" } }));
vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: unknown) => {
    h.eqValues.push(value);
    return { value };
  },
}));
vi.mock("../../server/services/founder", () => {
  h.isFounderIdentity = vi.fn(() => false);
  return { isFounderEmail: vi.fn(() => false), isFounderIdentity: h.isFounderIdentity };
});
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@clerk/express", () => {
  h.getUser = vi.fn(async (id: string) => ({
    emailAddresses: [{ id: "em_1", emailAddress: `${id}@Example.com` }],
    primaryEmailAddressId: "em_1",
    firstName: "F",
    lastName: "L",
    imageUrl: null,
  }));
  return {
    clerkMiddleware: vi.fn(),
    createClerkClient: vi.fn(() => ({
      sessions: { getSessionList: vi.fn(async () => ({ data: [] })) },
      users: { getUser: h.getUser },
    })),
  };
});

import {
  isAuthenticated,
  requireFounder,
  __setRevokedSidsForTests,
} from "../../server/auth/clerkAuth";
import { getClerkAuth } from "../../server/types/request";
import { requirePaxDisclosure } from "../../server/middleware/requirePaxDisclosure";
import { E2E_FOUNDER_COOKIE, E2E_FOUNDER_USER_ID } from "../../server/auth/testAuth";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const UNAUTHORIZED_BODY = { error: "Unauthorized", message: "No valid session" };

const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_PEM = signing.publicKey.export({ type: "spki", format: "pem" }).toString();
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });

function jwt(claims: Record<string, unknown>, privateKey = signing.privateKey): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "RS256", typ: "JWT" });
  const body = enc(claims);
  const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
}
const nowSec = () => Math.floor(Date.now() / 1000);

/** What @clerk/express 2.x installs for a signed-in request. */
function signedInAuth(userId: string, extra: Record<string, unknown> = {}) {
  return vi.fn(() => ({
    userId,
    sessionId: "sess_mw",
    factorVerificationAge: [2, 1] as [number, number],
    isAuthenticated: true,
    ...extra,
  }));
}
/** What @clerk/express 2.x installs for a signed-out request (incl. dev-browser-missing). */
function signedOutAuth() {
  return vi.fn(() => ({
    userId: null,
    sessionId: null,
    factorVerificationAge: null,
    isAuthenticated: false,
  }));
}

function makeReq(opts: { auth?: unknown; cookie?: string; user?: unknown } = {}): any {
  return { auth: opts.auth, headers: { cookie: opts.cookie }, user: opts.user };
}
function makeRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.setHeader = vi.fn();
  return res as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

async function run(req: any) {
  const res = makeRes();
  const next = vi.fn();
  await isAuthenticated(req, res, next);
  return { res, next };
}

const saved = {
  key: process.env.CLERK_JWT_KEY,
  e2e: process.env.E2E_TEST_AUTH,
  fly: process.env.FLY_APP_NAME,
  token: process.env.E2E_TEST_AUTH_TOKEN,
};

beforeEach(() => {
  h.selectRows = [{ id: "row_1", clerkUserId: "existing", email: "u@example.com" }];
  h.eqValues = [];
  h.inserted = [];
  h.getUser.mockClear();
  h.isFounderIdentity.mockClear();
  delete process.env.CLERK_JWT_KEY;
  delete process.env.E2E_TEST_AUTH;
  delete process.env.E2E_TEST_AUTH_TOKEN;
  delete process.env.FLY_APP_NAME;
  __setRevokedSidsForTests([]);
});
afterEach(() => {
  for (const [k, env] of [
    ["CLERK_JWT_KEY", saved.key],
    ["E2E_TEST_AUTH", saved.e2e],
    ["FLY_APP_NAME", saved.fly],
    ["E2E_TEST_AUTH_TOKEN", saved.token],
  ] as const) {
    if (env === undefined) delete process.env[k];
    else process.env[k] = env;
  }
  __setRevokedSidsForTests(null);
});

// ── 1. getClerkAuth normalizes the v2 shape ──────────────────────────────────

describe("getClerkAuth — the single normalization point", () => {
  it("invokes a callable req.auth (the @clerk/express 2.x shape) and returns its userId/sessionId/FVA", () => {
    const auth = signedInAuth("user_v2", { sessionId: "sess_v2", factorVerificationAge: [5, 0] });
    const out = getClerkAuth({ auth } as unknown as Request);
    expect(auth).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ userId: "user_v2", sessionId: "sess_v2", factorVerificationAge: [5, 0] });
  });

  it("normalizes a signed-out callable verdict to no userId/sessionId (null → undefined)", () => {
    const out = getClerkAuth({ auth: signedOutAuth() } as unknown as Request);
    expect(out).toEqual({ userId: undefined, sessionId: undefined, factorVerificationAge: null });
    expect(out?.userId ?? "fallback").toBe("fallback");
  });

  it("still accepts the legacy plain-object shape (hand-built test requests)", () => {
    const out = getClerkAuth({ auth: { userId: "user_obj", sessionId: "sess_obj" } } as unknown as Request);
    expect(out).toEqual({ userId: "user_obj", sessionId: "sess_obj", factorVerificationAge: null });
  });

  it("returns undefined when req.auth is absent or null, as before", () => {
    expect(getClerkAuth({} as Request)).toBeUndefined();
    expect(getClerkAuth({ auth: null } as unknown as Request)).toBeUndefined();
    expect(getClerkAuth({ auth: () => null } as unknown as Request)).toBeUndefined();
  });

  it("reading the callable as an object is exactly the pre-fix defect", () => {
    // The defect this package fixes, demonstrated against the real shape:
    const auth = signedInAuth("user_v2");
    expect((auth as unknown as { userId?: string }).userId).toBeUndefined();
    expect(getClerkAuth({ auth } as unknown as Request)?.userId).toBe("user_v2");
  });
});

// ── 1. Middleware path authenticates with CLERK_JWT_KEY unset ────────────────

describe("isAuthenticated / hydrateUser — middleware path (CLERK_JWT_KEY unset)", () => {
  it("authenticates a signed-in v2 verdict with no CLERK_JWT_KEY and no cookie (401'd before Fix B)", async () => {
    expect(process.env.CLERK_JWT_KEY).toBeUndefined();
    h.selectRows = [{ id: "row_mw", clerkUserId: "user_mw", email: "mw@example.com" }];
    const req = makeReq({ auth: signedInAuth("user_mw") });

    const { res, next } = await run(req);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual(h.selectRows[0]);
    expect(h.eqValues).toEqual(["user_mw"]);
  });

  it("also authenticates with a session cookie present (the browser case) — middleware verdict wins, no JWT needed", async () => {
    const req = makeReq({ auth: signedInAuth("user_mw"), cookie: "__session_abc=not-a-jwt" });
    const { res, next } = await run(req);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
    expect(h.eqValues).toEqual(["user_mw"]);
  });

  it("bootstraps the users row from clerkClient.users.getUser on first sight — same as the fallback path", async () => {
    h.selectRows = [];
    const req = makeReq({ auth: signedInAuth("user_first") });
    const { next } = await run(req);
    expect(h.getUser).toHaveBeenCalledWith("user_first");
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]).toMatchObject({ clerkUserId: "user_first", email: "user_first@example.com" });
    expect(req.user).toMatchObject({ clerkUserId: "user_first" });
    expect(next).toHaveBeenCalledWith();
  });
});

// ── 2. Fallback preservation ─────────────────────────────────────────────────

describe("JWT fallback preserved — middleware verdict signed-out (dev-instance simulation)", () => {
  it("valid __session JWT + CLERK_JWT_KEY → authenticated via the fallback", async () => {
    process.env.CLERK_JWT_KEY = PUBLIC_PEM;
    h.selectRows = [{ id: "row_fb", clerkUserId: "user_fb" }];
    const auth = signedOutAuth();
    const token = jwt({ sub: "user_fb", sid: "sess_fb", exp: nowSec() + 60 });
    const req = makeReq({ auth, cookie: `foo=1; __session_inst42=${token}` });

    const { res, next } = await run(req);

    expect(auth).toHaveBeenCalled(); // the middleware verdict WAS consulted first …
    expect(res.status).not.toHaveBeenCalled(); // … and its signed-out answer was not final
    expect(next).toHaveBeenCalledWith();
    expect(h.eqValues).toEqual(["user_fb"]);
  });

  it("the bare legacy __session cookie name still works through the fallback", async () => {
    process.env.CLERK_JWT_KEY = PUBLIC_PEM;
    const token = jwt({ sub: "user_bare", exp: nowSec() + 60 });
    const { next } = await run(makeReq({ auth: signedOutAuth(), cookie: `__session=${token}` }));
    expect(next).toHaveBeenCalledWith();
    expect(h.eqValues).toEqual(["user_bare"]);
  });

  it("the 30-second expiry grace is unchanged: 10s past exp accepted, 31s past exp refused", async () => {
    process.env.CLERK_JWT_KEY = PUBLIC_PEM;
    const inGrace = jwt({ sub: "user_grace", exp: nowSec() - 10 });
    const a = await run(makeReq({ auth: signedOutAuth(), cookie: `__session_x=${inGrace}` }));
    expect(a.next).toHaveBeenCalledWith();

    const pastGrace = jwt({ sub: "user_grace", exp: nowSec() - 31 });
    const b = await run(makeReq({ auth: signedOutAuth(), cookie: `__session_x=${pastGrace}` }));
    expect(b.next).not.toHaveBeenCalled();
    expect(b.res.status).toHaveBeenCalledWith(401);
    expect(b.res.json).toHaveBeenCalledWith(UNAUTHORIZED_BODY);
  });

  it("invalid signature → the same 401 status and body as today", async () => {
    process.env.CLERK_JWT_KEY = PUBLIC_PEM;
    const forged = jwt({ sub: "user_forged", exp: nowSec() + 60 }, other.privateKey);
    const { res, next } = await run(makeReq({ auth: signedOutAuth(), cookie: `__session_x=${forged}` }));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(UNAUTHORIZED_BODY);
    expect(h.eqValues).toEqual([]);
  });

  it("a token with no sub claim is refused, as today", async () => {
    process.env.CLERK_JWT_KEY = PUBLIC_PEM;
    const noSub = jwt({ exp: nowSec() + 60 });
    const { res } = await run(makeReq({ auth: signedOutAuth(), cookie: `__session_x=${noSub}` }));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(UNAUTHORIZED_BODY);
  });

  it("a revoked sid is still refused by the fallback's revoked-sid cache", async () => {
    process.env.CLERK_JWT_KEY = PUBLIC_PEM;
    __setRevokedSidsForTests(["sess_revoked"]);
    const token = jwt({ sub: "user_rev", sid: "sess_revoked", exp: nowSec() + 60 });
    const { res, next } = await run(makeReq({ auth: signedOutAuth(), cookie: `__session_x=${token}` }));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(UNAUTHORIZED_BODY);
  });

  it("no CLERK_JWT_KEY and no middleware user → the same 401 as today, even holding a validly-signed JWT", async () => {
    const token = jwt({ sub: "user_nokey", exp: nowSec() + 60 });
    const { res, next } = await run(makeReq({ auth: signedOutAuth(), cookie: `__session_x=${token}` }));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(UNAUTHORIZED_BODY);
    expect(h.eqValues).toEqual([]);
  });

  it("no CLERK_JWT_KEY, no middleware user, no cookie → the same 401 as today", async () => {
    const { res, next } = await run(makeReq({ auth: signedOutAuth() }));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(UNAUTHORIZED_BODY);
  });
});

// ── 3. Test-auth bypass installs the v2 shape ────────────────────────────────

describe("E2E test-auth bypass — installs the callable shape", () => {
  it("authenticates its test user, and req.auth is a FUNCTION, as @clerk/express 2.x installs it", async () => {
    process.env.E2E_TEST_AUTH = "1";
    h.selectRows = [{ id: "row_e2e", clerkUserId: E2E_FOUNDER_USER_ID }];
    const req = makeReq({ cookie: `__session=${E2E_FOUNDER_COOKIE}` });

    const { res, next } = await run(req);

    expect(typeof req.auth).toBe("function");
    expect(getClerkAuth(req)?.userId).toBe(E2E_FOUNDER_USER_ID);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
    expect(h.eqValues).toEqual([E2E_FOUNDER_USER_ID]);
  });

  it("stays off on a Fly machine (the bypass gate itself is unchanged)", async () => {
    process.env.E2E_TEST_AUTH = "1";
    process.env.FLY_APP_NAME = "acreos-staging";
    const req = makeReq({ cookie: `__session=${E2E_FOUNDER_COOKIE}` });
    const { res, next } = await run(req);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.auth).toBeUndefined();
  });
});

// ── requireFounder reads the middleware verdict through the helper ───────────

describe("requireFounder — middleware userId reaches the founder check", () => {
  it("passes the v2 verdict's userId (not only req.user.clerkUserId) to isFounderIdentity", () => {
    const req = makeReq({
      auth: signedInAuth("user_from_verdict"),
      user: { email: "f@example.com", clerkUserId: "user_from_row" },
    });
    const res = makeRes();
    requireFounder(req, res, vi.fn());
    expect(h.isFounderIdentity).toHaveBeenCalledWith({ email: "f@example.com", userId: "user_from_verdict" });
  });
});

// ── requirePaxDisclosure (census gap: cast-form read the census grep missed) ─

describe("requirePaxDisclosure — identity after isAuthenticated", () => {
  async function gate(req: any) {
    const res = makeRes();
    const next = vi.fn();
    await requirePaxDisclosure(req, res, next);
    return { res, next };
  }

  it("a v2 signed-in verdict reaches the disclosure check (401'd before Fix B)", async () => {
    h.selectRows = [{ ackAt: new Date("2026-10-01T00:00:00Z") }];
    const { res, next } = await gate(makeReq({ auth: signedInAuth("user_pax") }));
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(h.eqValues).toEqual(["user_pax"]);
  });

  it("a fallback-hydrated session (signed-out verdict, req.user set) is not re-rejected", async () => {
    h.selectRows = [{ ackAt: new Date("2026-10-01T00:00:00Z") }];
    const req = makeReq({ auth: signedOutAuth(), user: { id: "row_1", clerkUserId: "user_fb_pax" } });
    const { res, next } = await gate(req);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(h.eqValues).toEqual(["user_fb_pax"]);
  });

  it("unacknowledged disclosure still 428s", async () => {
    h.selectRows = [{ ackAt: null }];
    const { res, next } = await gate(makeReq({ auth: signedInAuth("user_pax") }));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(428);
  });

  it("no identity at all → the same 401 body as before", async () => {
    const { res, next } = await gate(makeReq({ auth: signedOutAuth() }));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized", message: "Session required for AI chat" });
  });
});
