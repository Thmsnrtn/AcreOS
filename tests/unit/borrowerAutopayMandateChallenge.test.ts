/**
 * borrowerAutopayMandateChallenge.test.ts — the invariants that keep a NACHA
 * ACH debit authorization from being creatable by a client that simply says
 * "the borrower agreed".
 *
 * CodeQL HIGH, PR #259: "User-controlled bypass of security check" at
 * POST /api/borrower/autopay/mandate. The gate was
 * `body.authorizationAccepted !== true`, cross-checked against an echo of the
 * displayed text — both client-asserted. The fix binds acceptance to a
 * server-issued, single-use, 15-minute challenge minted only by
 * GET /api/borrower/autopay (the endpoint that renders the text) and bound to
 * (borrower session id, note id, authorization text version).
 *
 * What is pinned here, in the order the brief demands it:
 *   • no token                       ⇒ refusal, and NO mandate row
 *   • expired token                  ⇒ refusal, and NO mandate row
 *   • REPLAYED token                 ⇒ refusal (single use actually enforced)
 *   • token for another note         ⇒ refusal
 *   • token for another session       ⇒ refusal
 *   • token whose text version moved ⇒ refusal
 *   • happy path                     ⇒ exactly ONE mandate
 *   • the pre-existing layers still refuse (accepted flag, text echo)
 *
 * "NO mandate row" is asserted against the only code path that can insert one
 * (`startAchMandateSetup`), which is stubbed here: the suite needs no
 * DATABASE_URL beyond the dummy in tests/setup.ts and never reaches Stripe.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ───────────────────────────────────────────────────────────────────────────
// Fixtures the mocks read from
// ───────────────────────────────────────────────────────────────────────────

const ORG_ID = 7;
const NOTE_ID = 42;
const OTHER_NOTE_ID = 43;
const SESSION_TOKEN = "test-borrower-session-token";
const SESSION_ID = 1;
const OTHER_SESSION_ID = 2;

type Session = {
  id: number;
  noteId: number;
  organizationId: number;
  email: string;
  expiresAt: Date;
  createdAt: Date;
};
const SESSIONS = new Map<string, Session>();

/** The note row every handler in this test loads. */
const NOTE_ROW = {
  id: NOTE_ID,
  organizationId: ORG_ID,
  borrowerId: 99,
  accessToken: "note-access-token",
  monthlyPayment: "1000.00",
  serviceFee: "25.00",
  taxEscrowEnabled: false,
  monthlyTaxEscrow: "0",
  nextPaymentDate: new Date("2026-09-01T00:00:00.000Z"),
  autoPayEnabled: false,
};

/** Mandate rows created by the stubbed startAchMandateSetup. */
const MANDATE_ROWS: Array<{ id: number; authorizationChallengeId: string | null }> = [];

/** Lender name returned by storage.getOrganization. */
const ORG_NAME = "Acme Lender";

vi.mock("../../server/storage", () => {
  const storage = {
    getBorrowerSession: async (token: string) => SESSIONS.get(token) ?? null,
    deleteBorrowerSession: async (token: string) => {
      SESSIONS.delete(token);
    },
    updateBorrowerSessionAccess: async (_token: string) => {},
    getOrganization: async (id: number) => ({ id, name: ORG_NAME, settings: {} }),
    getLead: async () => null,
    updateNote: async () => undefined,
  };

  // Drizzle chain mock for routes-borrower's own `notes` reads. Every select in
  // this suite's paths is "the note" (validateBorrowerSession's org pin, then
  // the handler), so one row set serves both.
  const makeStep: () => any = () => {
    const step: any = {
      from: () => makeStep(),
      where: () => makeStep(),
      orderBy: () => makeStep(),
      limit: () => makeStep(),
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve([NOTE_ROW]).then(onFulfilled, onRejected),
    };
    return step;
  };
  return { storage, db: { select: () => makeStep() } };
});

// `server/db` is used ONLY by the challenge service's consumed-challenge lookup
// in this suite (achMandateSetup is stubbed), so returning MANDATE_ROWS filtered
// by the requested challenge id exercises the real single-use pre-check.
let lastChallengeLookup: string | null = null;
vi.mock("../../server/db", () => {
  const makeStep: () => any = () => {
    const step: any = {
      from: () => makeStep(),
      where: (predicate: unknown) => {
        // Recover the challenge id the service asked about from the drizzle
        // predicate's bound parameter, so the mock filters the way SQL would.
        const p = predicate as { queryChunks?: unknown[] } | undefined;
        const chunks = Array.isArray(p?.queryChunks) ? p!.queryChunks! : [];
        for (const chunk of chunks) {
          const value = (chunk as { value?: unknown } | null)?.value;
          if (typeof value === "string") lastChallengeLookup = value;
        }
        return makeStep();
      },
      limit: () => makeStep(),
      then: (onFulfilled: any, onRejected: any) => {
        const rows = MANDATE_ROWS.filter(
          (m) => m.authorizationChallengeId !== null &&
            m.authorizationChallengeId === lastChallengeLookup,
        ).map((m) => ({ id: m.id }));
        return Promise.resolve(rows).then(onFulfilled, onRejected);
      },
    };
    return step;
  };
  return {
    db: { select: () => makeStep() },
    withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  };
});

// Stub the mandate service: the real pure helpers stay real (the canonical
// authorization text must be genuine), the DB/Stripe ones are replaced.
vi.mock("../../server/services/achMandateSetup", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/services/achMandateSetup")
  >("../../server/services/achMandateSetup");
  return {
    ...actual,
    resolveLenderConnectAccount: async () => ({
      ok: true as const,
      account: { accountId: "acct_test" },
    }),
    getAchMandateSummary: async () => ({
      armed: false,
      status: "none" as const,
      bankName: null,
      accountLast4: null,
      maxAmountCents: null,
      scheduleDescription: null,
      agreedAt: null,
      authorizationTextVersion: null,
    }),
    revokeAchMandatesForNote: async () => 0,
    confirmAchMandateSetup: async () => ({
      ok: false as const,
      reason: "not_found" as const,
      message: "not used in this suite",
    }),
    startAchMandateSetup: async (input: {
      authorizationChallengeId?: string;
    }) => {
      const id = MANDATE_ROWS.length + 1;
      MANDATE_ROWS.push({
        id,
        authorizationChallengeId: input.authorizationChallengeId ?? null,
      });
      return {
        ok: true as const,
        mandateId: id,
        setupUrl: "https://checkout.example/test",
        authorizationText: "stored verbatim by the real service",
        maxAmountCents: 117_875,
      };
    },
  };
});

vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  RATE_LIMIT_CONFIGS: { public: { maxRequests: 100, windowMs: 60_000 } },
}));

// Imported AFTER the mocks are registered.
import { registerBorrowerRoutes } from "../../server/routes-borrower";
import {
  AUTOPAY_CHALLENGE_TTL_SECONDS,
  mintAutopayAuthorizationChallenge,
  verifyAutopayAuthorizationChallenge,
  claimAutopayAuthorizationChallenge,
  autopayChallengeSigningConfigured,
} from "../../server/services/borrower/autopayAuthorizationChallenge";
import { AUTHORIZATION_TEXT_VERSION } from "../../server/services/achAutopay";

/**
 * The only cookie any borrower route reads (`req.cookies?.borrower_session`).
 *
 * The fake parser below deliberately does NOT build `req.cookies` by writing
 * keys taken from the header. A `Cookie` header is attacker-controlled, so
 * `req.cookies[k] = …` with `k` lifted out of it is a property write whose NAME
 * comes from remote input — CodeQL "remote property injection" (PR #259), and a
 * real hazard even in a fixture: a request carrying `__proto__=…` would write
 * through the prototype instead of the object. Nothing here needs a general
 * cookie jar, so the parser returns a VALUE for a name it was asked for and the
 * request object is assembled with a literal key. No dynamic write exists.
 */
const BORROWER_SESSION_COOKIE = "borrower_session";

/** Read one named cookie out of a `Cookie` header. Returns "" when absent. */
function readCookieHeaderValue(header: string | undefined, name: string): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0 || trimmed.slice(0, eq) !== name) continue;
    return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return "";
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const header = req.headers.cookie as string | undefined;
    req.cookies = { borrower_session: readCookieHeaderValue(header, BORROWER_SESSION_COOKIE) };
    next();
  });
  registerBorrowerRoutes(app);
  return app;
}

const BINDING = {
  sessionId: SESSION_ID,
  noteId: NOTE_ID,
  textVersion: AUTHORIZATION_TEXT_VERSION,
};

beforeEach(() => {
  SESSIONS.clear();
  MANDATE_ROWS.length = 0;
  lastChallengeLookup = null;
  SESSIONS.set(SESSION_TOKEN, {
    id: SESSION_ID,
    noteId: NOTE_ID,
    organizationId: ORG_ID,
    email: "borrower@example.com",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(),
  });
});

afterEach(() => {
  SESSIONS.clear();
  MANDATE_ROWS.length = 0;
});

// ═══════════════════════════════════════════════════════════════════════════
// The challenge itself — pure crypto + binding rules, no HTTP, no DB
// ═══════════════════════════════════════════════════════════════════════════

describe("autopay authorization challenge (pure)", () => {
  it("is signable in this environment and round-trips", () => {
    expect(autopayChallengeSigningConfigured()).toBe(true);
    const minted = mintAutopayAuthorizationChallenge(BINDING);
    expect(minted).not.toBeNull();
    const verified = verifyAutopayAuthorizationChallenge(minted!.token, BINDING);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.challengeId).toBe(minted!.challengeId);
  });

  it("mints a distinct single-use id every time", () => {
    const ids = new Set(
      Array.from({ length: 25 }, () => mintAutopayAuthorizationChallenge(BINDING)!.challengeId),
    );
    expect(ids.size).toBe(25);
  });

  it("expires after the declared TTL — humane, not unbounded", () => {
    // 15 minutes: long enough to read five paragraphs of NACHA disclosure with
    // an interruption, short enough that "recently served" still means something.
    expect(AUTOPAY_CHALLENGE_TTL_SECONDS).toBe(15 * 60);
    const now = new Date("2026-07-30T12:00:00.000Z");
    const minted = mintAutopayAuthorizationChallenge(BINDING, now)!;
    const justInside = new Date(now.getTime() + (AUTOPAY_CHALLENGE_TTL_SECONDS - 5) * 1000);
    const justOutside = new Date(now.getTime() + (AUTOPAY_CHALLENGE_TTL_SECONDS + 1) * 1000);
    expect(verifyAutopayAuthorizationChallenge(minted.token, BINDING, justInside).ok).toBe(true);
    const late = verifyAutopayAuthorizationChallenge(minted.token, BINDING, justOutside);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.reason).toBe("authorization_challenge_expired");
  });

  it("refuses a missing, malformed or tampered token", () => {
    const minted = mintAutopayAuthorizationChallenge(BINDING)!;
    for (const bad of [undefined, null, "", 42, {}, "no-dot", "a.b"]) {
      const r = verifyAutopayAuthorizationChallenge(bad, BINDING);
      expect(r.ok).toBe(false);
    }
    // A payload edited to claim another note, keeping the original signature.
    const [encoded, sig] = minted.token.split(".");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    payload.nid = OTHER_NOTE_ID;
    const forged =
      Buffer.from(JSON.stringify(payload), "utf8").toString("base64url") + "." + sig;
    const r = verifyAutopayAuthorizationChallenge(forged, BINDING);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("authorization_challenge_invalid");
  });

  it("refuses a token bound to another session, note, or text version", () => {
    const minted = mintAutopayAuthorizationChallenge(BINDING)!;
    const wrongSession = verifyAutopayAuthorizationChallenge(minted.token, {
      ...BINDING,
      sessionId: OTHER_SESSION_ID,
    });
    expect(wrongSession.ok).toBe(false);
    if (!wrongSession.ok) expect(wrongSession.reason).toBe("authorization_challenge_wrong_session");

    const wrongNote = verifyAutopayAuthorizationChallenge(minted.token, {
      ...BINDING,
      noteId: OTHER_NOTE_ID,
    });
    expect(wrongNote.ok).toBe(false);
    if (!wrongNote.ok) expect(wrongNote.reason).toBe("authorization_challenge_wrong_note");

    const staleText = verifyAutopayAuthorizationChallenge(minted.token, {
      ...BINDING,
      textVersion: "2027-01-01.v9",
    });
    expect(staleText.ok).toBe(false);
    if (!staleText.ok) expect(staleText.reason).toBe("authorization_challenge_text_stale");
  });

  it("claim refuses a challenge some mandate already recorded", async () => {
    const minted = mintAutopayAuthorizationChallenge(BINDING)!;
    const claimed = await claimAutopayAuthorizationChallenge(minted.token, BINDING, {
      lookup: { mandateIdForChallenge: async () => 17 },
    });
    expect(claimed.ok).toBe(false);
    if (!claimed.ok) expect(claimed.reason).toBe("authorization_challenge_used");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The endpoints
// ═══════════════════════════════════════════════════════════════════════════

async function readAutopay() {
  return request(makeApp())
    .get("/api/borrower/autopay")
    .set("Cookie", `borrower_session=${SESSION_TOKEN}`);
}

async function postMandate(body: Record<string, unknown>) {
  return request(makeApp())
    .post("/api/borrower/autopay/mandate")
    .set("Cookie", `borrower_session=${SESSION_TOKEN}`)
    .send(body);
}

describe("GET /api/borrower/autopay issues the challenge with the text", () => {
  it("returns the verbatim authorization plus a challenge bound to it", async () => {
    const res = await readAutopay();
    expect(res.status).toBe(200);
    expect(res.body.authorization).not.toBeNull();
    const auth = res.body.authorization;
    expect(typeof auth.challengeToken).toBe("string");
    expect(auth.challengeToken.length).toBeGreaterThan(40);
    expect(auth.challengeTtlSeconds).toBe(AUTOPAY_CHALLENGE_TTL_SECONDS);
    expect(new Date(auth.challengeExpiresAt).getTime()).toBeGreaterThan(Date.now());
    // The issued challenge really is bound to this session/note/version.
    const verified = verifyAutopayAuthorizationChallenge(auth.challengeToken, BINDING);
    expect(verified.ok).toBe(true);
  });

  it("never puts the raw token anywhere but the authorization block", async () => {
    const res = await readAutopay();
    const token = res.body.authorization.challengeToken;
    const withoutAuth = { ...res.body, authorization: null };
    expect(JSON.stringify(withoutAuth)).not.toContain(token);
  });
});

describe("POST /api/borrower/autopay/mandate — every refusal creates NO mandate", () => {
  it("refuses with NO mandate row when no challenge is presented", async () => {
    const read = await readAutopay();
    const res = await postMandate({
      authorizationAccepted: true,
      displayedAuthorizationText: read.body.authorization.authorizationText,
      // authorizationChallenge deliberately absent — the CodeQL scenario: a
      // client asserting consent it was never issued.
    });
    expect(res.status).toBe(400);
    expect(res.body.details?.reason).toBe("authorization_challenge_missing");
    expect(MANDATE_ROWS).toHaveLength(0);
  });

  it("refuses with NO mandate row when the challenge is expired", async () => {
    const read = await readAutopay();
    const stale = mintAutopayAuthorizationChallenge(
      BINDING,
      new Date(Date.now() - (AUTOPAY_CHALLENGE_TTL_SECONDS + 60) * 1000),
    )!;
    const res = await postMandate({
      authorizationAccepted: true,
      displayedAuthorizationText: read.body.authorization.authorizationText,
      authorizationChallenge: stale.token,
    });
    expect(res.status).toBe(400);
    expect(res.body.details?.reason).toBe("authorization_challenge_expired");
    expect(MANDATE_ROWS).toHaveLength(0);
  });

  it("refuses a REPLAYED challenge — single use is actually enforced", async () => {
    const read = await readAutopay();
    const body = {
      authorizationAccepted: true,
      displayedAuthorizationText: read.body.authorization.authorizationText,
      authorizationChallenge: read.body.authorization.challengeToken,
    };

    const first = await postMandate(body);
    expect(first.status).toBe(200);
    expect(MANDATE_ROWS).toHaveLength(1);
    // The consumed id is recorded on the mandate — that IS the consumption.
    expect(MANDATE_ROWS[0].authorizationChallengeId).toBeTruthy();

    // Byte-identical replay of a token that verified a moment ago.
    const replay = await postMandate(body);
    expect(replay.status).toBe(400);
    expect(replay.body.details?.reason).toBe("authorization_challenge_used");
    expect(MANDATE_ROWS).toHaveLength(1);
  });

  it("refuses a challenge minted for a different note", async () => {
    const read = await readAutopay();
    const otherNote = mintAutopayAuthorizationChallenge({
      ...BINDING,
      noteId: OTHER_NOTE_ID,
    })!;
    const res = await postMandate({
      authorizationAccepted: true,
      displayedAuthorizationText: read.body.authorization.authorizationText,
      authorizationChallenge: otherNote.token,
    });
    expect(res.status).toBe(400);
    expect(res.body.details?.reason).toBe("authorization_challenge_wrong_note");
    expect(MANDATE_ROWS).toHaveLength(0);
  });

  it("refuses a challenge minted for a different borrower session", async () => {
    const read = await readAutopay();
    const otherSession = mintAutopayAuthorizationChallenge({
      ...BINDING,
      sessionId: OTHER_SESSION_ID,
    })!;
    const res = await postMandate({
      authorizationAccepted: true,
      displayedAuthorizationText: read.body.authorization.authorizationText,
      authorizationChallenge: otherSession.token,
    });
    expect(res.status).toBe(400);
    expect(res.body.details?.reason).toBe("authorization_challenge_wrong_session");
    expect(MANDATE_ROWS).toHaveLength(0);
  });

  it("refuses a challenge whose text version no longer matches the canonical text", async () => {
    const read = await readAutopay();
    const oldVersion = mintAutopayAuthorizationChallenge({
      ...BINDING,
      textVersion: "2026-01-01.v0",
    })!;
    const res = await postMandate({
      authorizationAccepted: true,
      displayedAuthorizationText: read.body.authorization.authorizationText,
      authorizationChallenge: oldVersion.token,
    });
    expect(res.status).toBe(400);
    expect(res.body.details?.reason).toBe("authorization_challenge_text_stale");
    expect(MANDATE_ROWS).toHaveLength(0);
  });

  it("checks the SERVER-ISSUED challenge before the client's accepted flag", async () => {
    // Ordering is load-bearing, not cosmetic. With neither field satisfied the
    // refusal must name the CHALLENGE — proof that the guard standing nearest to
    // mandate creation is the value this server minted, and that the client
    // boolean is never the thing being relied on to let the request through.
    const res = await postMandate({ authorizationAccepted: false });
    expect(res.status).toBe(400);
    expect(res.body.details?.reason).toBe("authorization_challenge_missing");
    expect(MANDATE_ROWS).toHaveLength(0);
  });

  it("still refuses without the accepted flag, and without a matching text echo", async () => {
    const read = await readAutopay();
    const token = read.body.authorization.challengeToken;

    // Layer 1 kept: a valid challenge does NOT substitute for the affirmative act.
    const noFlag = await postMandate({
      authorizationAccepted: false,
      displayedAuthorizationText: read.body.authorization.authorizationText,
      authorizationChallenge: token,
    });
    expect(noFlag.status).toBe(400);
    expect(noFlag.body.details?.reason).toBe("authorization_not_accepted");
    expect(MANDATE_ROWS).toHaveLength(0);

    // Layer 2 kept: the echoed text must be byte-identical to the canonical text.
    const badEcho = await postMandate({
      authorizationAccepted: true,
      displayedAuthorizationText: "I authorize absolutely anything.",
      authorizationChallenge: token,
    });
    expect(badEcho.status).toBe(400);
    expect(badEcho.body.details?.reason).toBe("authorization_text_stale");
    expect(MANDATE_ROWS).toHaveLength(0);
  });

  it("happy path creates exactly one mandate and returns the setup URL", async () => {
    const read = await readAutopay();
    const res = await postMandate({
      authorizationAccepted: true,
      displayedAuthorizationText: read.body.authorization.authorizationText,
      authorizationChallenge: read.body.authorization.challengeToken,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.setupUrl).toBe("https://checkout.example/test");
    expect(MANDATE_ROWS).toHaveLength(1);
  });

  it("a fresh challenge from a second read still works after a refusal", async () => {
    // A borrower who timed out must not be locked out — they reload and retry.
    const stale = mintAutopayAuthorizationChallenge(
      BINDING,
      new Date(Date.now() - (AUTOPAY_CHALLENGE_TTL_SECONDS + 60) * 1000),
    )!;
    const firstRead = await readAutopay();
    const refused = await postMandate({
      authorizationAccepted: true,
      displayedAuthorizationText: firstRead.body.authorization.authorizationText,
      authorizationChallenge: stale.token,
    });
    expect(refused.status).toBe(400);

    const secondRead = await readAutopay();
    const ok = await postMandate({
      authorizationAccepted: true,
      displayedAuthorizationText: secondRead.body.authorization.authorizationText,
      authorizationChallenge: secondRead.body.authorization.challengeToken,
    });
    expect(ok.status).toBe(200);
    expect(MANDATE_ROWS).toHaveLength(1);
  });
});
