/**
 * autopayAuthorizationChallenge — the server-issued proof that we actually
 * served this borrower this authorization text, just now.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeQL HIGH, PR #259, "User-controlled bypass of security check":
 * `POST /api/borrower/autopay/mandate` gated the creation of a NACHA ACH debit
 * authorization on `body.authorizationAccepted === true` — a value the client
 * supplies. The handler also cross-checked `body.displayedAuthorizationText`
 * against the canonical text, which is real defence, but BOTH fields are
 * client-asserted: a scripted or buggy client can echo text it fetched from a
 * public build and claim a consent no human ever gave.
 *
 * That matters more here than on an ordinary endpoint. The entire purpose of an
 * `ach_mandates` row is to PROVE, months later and possibly to an ODFI dispute
 * (R10 unauthorized-debit claim), that the borrower saw specific language and
 * affirmatively agreed to it. If the proof reduces to "the client said so", the
 * record is weakest exactly where it must be strongest.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SCHEME
 * ═══════════════════════════════════════════════════════════════════════════
 * `GET /api/borrower/autopay` — the only endpoint that renders the
 * authorization text — mints a challenge alongside it. The challenge is an
 * HMAC-SHA256-signed payload binding four things:
 *
 *   sid  borrower_sessions.id  — WHO the text was served to
 *   nid  notes.id              — WHICH loan it was served for
 *   tv   AUTHORIZATION_TEXT_VERSION — WHICH revision of the disclosure
 *   cid  a 16-byte random id   — the single-use handle
 *
 * plus an absolute `exp`. `POST /api/borrower/autopay/mandate` must present it.
 * The POST therefore cannot succeed unless the server itself served that exact
 * text version, to that session, for that note, minutes ago. The gate now
 * depends on a server-generated value; `authorizationAccepted` is demoted from
 * "the security check" to what it always should have been — the record of the
 * affirmative act.
 *
 * Construction is deliberately the SAME one already used for the borrower
 * statement session cookie (`services/borrower/statementAccess.ts`):
 * `base64url(JSON payload) + "." + base64url(HMAC-SHA256)`, compared with
 * `crypto.timingSafeEqual`. Signing material resolution mirrors
 * `services/mail/qrCodes.ts` — a preferred dedicated env var falling back to
 * SESSION_SECRET, and mint returns null rather than ever emitting an unsigned
 * challenge.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SINGLE USE, AND WHERE IT IS RECORDED
 * ═══════════════════════════════════════════════════════════════════════════
 * A signature alone cannot be single-use — verifying is pure, so a replay
 * verifies too. Consumption is recorded on the artifact the challenge produces:
 * `ach_mandates.authorization_challenge_id`, under a UNIQUE index. So
 *
 *   - the unique index IS the single-use guard (the same idiom as
 *     `ach_debit_attempts_period_uidx`, which is the double-charge guard);
 *   - the mandate row itself records which server-issued challenge it was
 *     created from, which is the fact that makes the consent provable later;
 *   - no challenge table, no rows to expire, no cleanup job. A challenge that
 *     is never redeemed simply stops verifying at `exp`.
 *
 * `claimAutopayAuthorizationChallenge` performs the pre-check (has any mandate
 * already recorded this cid?) so a replay is refused BEFORE any processor call;
 * the unique index remains the race-proof backstop.
 *
 * NEVER LOG THE TOKEN. `challengeId` is safe to log and is deliberately what
 * lands in the log line and the column — knowing a cid does not let anyone
 * forge a signature over it.
 */

import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { achMandates } from "@shared/schema/ach-autopay";
import { logger } from "../../utils/logger";

/**
 * How long a served authorization stays redeemable.
 *
 * 15 minutes. The borrower has to read five paragraphs of NACHA disclosure and
 * tick a box, which takes a minute or two — but a real person gets
 * interrupted, re-reads the revocation sentence, or goes to find their routing
 * number, so a 60-second window would refuse honest consent and make the
 * borrower's experience worse. An hour, on the other hand, stops meaning
 * "recently served": the whole claim of the challenge is that the server showed
 * this text a moment ago. 15 minutes is humane and still well inside the
 * 30-minute borrower session, so the challenge can never outlive the session it
 * is bound to.
 */
export const AUTOPAY_CHALLENGE_TTL_SECONDS = 15 * 60;

/** Payload version, so the format can change without accepting old shapes. */
const CHALLENGE_VERSION = 1;

/** Bytes of randomness in the single-use challenge id. */
const CHALLENGE_ID_BYTES = 16;

/**
 * What the challenge is bound to. Every field must match at redemption or the
 * mandate is refused.
 */
export interface AutopayChallengeBinding {
  /** `borrower_sessions.id` — the session the authorization text was served to. */
  sessionId: number;
  /** `notes.id` — the loan the authorization text was served for. */
  noteId: number;
  /** `AUTHORIZATION_TEXT_VERSION` of the text that was served. */
  textVersion: string;
}

export interface MintedAutopayChallenge {
  /** Opaque value handed to the client. NEVER logged. */
  token: string;
  /** The single-use id recorded on the mandate. Safe to log. */
  challengeId: string;
  /** ISO instant after which the token stops verifying. */
  expiresAt: string;
}

/**
 * Every reason a presented challenge is refused. Two of these names are also
 * members of `AchSetupRefusal` (achMandateSetup.ts) so the race-backstop path
 * and this pre-check speak one vocabulary to the client.
 */
export type AutopayChallengeRefusal =
  | "authorization_challenge_missing"
  | "authorization_challenge_invalid"
  | "authorization_challenge_expired"
  | "authorization_challenge_wrong_session"
  | "authorization_challenge_wrong_note"
  | "authorization_challenge_text_stale"
  | "authorization_challenge_used"
  | "authorization_challenge_unavailable";

export interface AutopayChallengeRefused {
  ok: false;
  reason: AutopayChallengeRefusal;
  /** Borrower-facing. Every one of these says autopay is unchanged. */
  message: string;
}

export interface AutopayChallengeAccepted {
  ok: true;
  /** Record this on the mandate. It is the single-use handle. */
  challengeId: string;
  expiresAt: Date;
}

export type AutopayChallengeResult = AutopayChallengeAccepted | AutopayChallengeRefused;

/**
 * Resolve signing material. Prefers a dedicated secret and falls back to the
 * borrower-session secret, then SESSION_SECRET — the same widening fallback
 * `services/mail/qrCodes.ts` uses. Returns null when nothing usable is
 * configured; callers degrade to "cannot offer setup", NEVER to an unsigned
 * challenge.
 */
function signingSecret(): string | null {
  const secret =
    process.env.AUTOPAY_CHALLENGE_SECRET ||
    process.env.BORROWER_SESSION_SECRET ||
    process.env.SESSION_SECRET;
  return secret && secret.length >= 16 ? secret : null;
}

/** True when this deployment can mint/verify autopay challenges at all. */
export function autopayChallengeSigningConfigured(): boolean {
  return signingSecret() !== null;
}

interface ChallengePayload {
  v: number;
  cid: string;
  sid: number;
  nid: number;
  tv: string;
  /** Absolute expiry, unix epoch seconds. */
  exp: number;
}

function sign(encoded: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
}

/**
 * Mint a challenge for an authorization we are about to render.
 *
 * Returns null ONLY when no signing material is configured. Minting is pure
 * crypto — no DB write — so the read endpoint can mint on every render without
 * accumulating rows, and an abandoned challenge costs nothing.
 */
export function mintAutopayAuthorizationChallenge(
  binding: AutopayChallengeBinding,
  now: Date = new Date(),
): MintedAutopayChallenge | null {
  const secret = signingSecret();
  if (!secret) return null;

  const challengeId = crypto.randomBytes(CHALLENGE_ID_BYTES).toString("hex");
  const expSeconds = Math.floor(now.getTime() / 1000) + AUTOPAY_CHALLENGE_TTL_SECONDS;
  const payload: ChallengePayload = {
    v: CHALLENGE_VERSION,
    cid: challengeId,
    sid: binding.sessionId,
    nid: binding.noteId,
    tv: binding.textVersion,
    exp: expSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return {
    token: `${encoded}.${sign(encoded, secret)}`,
    challengeId,
    expiresAt: new Date(expSeconds * 1000).toISOString(),
  };
}

const REFUSAL_MESSAGES: Record<AutopayChallengeRefusal, string> = {
  authorization_challenge_missing:
    "We can't record this authorization because the page didn't send the setup code we issued when we showed you the terms. Please reload your portal, read the authorization again, and try once more — autopay is unchanged and nothing was debited.",
  authorization_challenge_invalid:
    "We couldn't verify that this authorization came from your portal session. Please reload the page and try again — autopay is unchanged and nothing was debited.",
  authorization_challenge_expired:
    "This authorization step timed out. Please reload your portal, read the authorization again, and confirm — autopay is unchanged and nothing was debited.",
  authorization_challenge_wrong_session:
    "This authorization was started in a different sign-in session. Please reload your portal and start bank setup again — autopay is unchanged and nothing was debited.",
  authorization_challenge_wrong_note:
    "This authorization was issued for a different loan. Please reload your portal and start bank setup again — autopay is unchanged and nothing was debited.",
  authorization_challenge_text_stale:
    "Our authorization wording changed while this page was open. Please reload and read the updated authorization before continuing — autopay is unchanged and nothing was debited.",
  authorization_challenge_used:
    "This authorization step was already completed once. Please reload your portal to see your current bank setup — nothing was authorized twice and nothing was debited.",
  authorization_challenge_unavailable:
    "Bank autopay setup is temporarily unavailable on this system. Autopay is unchanged and nothing was debited.",
};

function refuse(reason: AutopayChallengeRefusal): AutopayChallengeRefused {
  return { ok: false, reason, message: REFUSAL_MESSAGES[reason] };
}

/**
 * Verify signature, expiry and all three bindings. PURE — no DB, no
 * consumption. `claimAutopayAuthorizationChallenge` adds the single-use check.
 *
 * Exported separately so the crypto and the binding rules are unit-testable
 * with no database at all.
 */
export function verifyAutopayAuthorizationChallenge(
  token: unknown,
  expected: AutopayChallengeBinding,
  now: Date = new Date(),
): AutopayChallengeResult {
  if (typeof token !== "string" || token.length === 0) {
    return refuse("authorization_challenge_missing");
  }
  const secret = signingSecret();
  if (!secret) {
    // Fail CLOSED. A deployment that cannot verify must not accept.
    return refuse("authorization_challenge_unavailable");
  }

  const dotIdx = token.lastIndexOf(".");
  if (dotIdx <= 0 || dotIdx === token.length - 1) {
    return refuse("authorization_challenge_invalid");
  }
  const encoded = token.slice(0, dotIdx);
  const presented = Buffer.from(token.slice(dotIdx + 1), "utf8");
  const expectedSig = Buffer.from(sign(encoded, secret), "utf8");
  if (
    presented.length !== expectedSig.length ||
    !crypto.timingSafeEqual(presented, expectedSig)
  ) {
    return refuse("authorization_challenge_invalid");
  }

  let payload: Partial<ChallengePayload>;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return refuse("authorization_challenge_invalid");
  }
  if (
    payload.v !== CHALLENGE_VERSION ||
    typeof payload.cid !== "string" ||
    payload.cid.length < 16 ||
    typeof payload.sid !== "number" ||
    typeof payload.nid !== "number" ||
    typeof payload.tv !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return refuse("authorization_challenge_invalid");
  }

  // Bindings before expiry: a token for the wrong loan is a harder failure
  // than a stale one, and the borrower-facing message should say so.
  if (payload.sid !== expected.sessionId) return refuse("authorization_challenge_wrong_session");
  if (payload.nid !== expected.noteId) return refuse("authorization_challenge_wrong_note");
  if (payload.tv !== expected.textVersion) return refuse("authorization_challenge_text_stale");

  if (payload.exp * 1000 <= now.getTime()) {
    return refuse("authorization_challenge_expired");
  }

  return { ok: true, challengeId: payload.cid, expiresAt: new Date(payload.exp * 1000) };
}

/**
 * Has any mandate already been created from this challenge id? Injected so the
 * route contract tests need no DATABASE_URL.
 */
export interface ConsumedChallengeLookup {
  /** The mandate id that already consumed `challengeId`, or null. */
  mandateIdForChallenge(challengeId: string): Promise<number | null>;
}

/**
 * The real lookup: `ach_mandates.authorization_challenge_id`, which carries a
 * UNIQUE index. Reading it is what makes the refusal happen before any
 * processor call; the index is what makes it true under concurrency.
 */
export const mandateChallengeLookup: ConsumedChallengeLookup = {
  async mandateIdForChallenge(challengeId: string): Promise<number | null> {
    const rows = await db
      .select({ id: achMandates.id })
      .from(achMandates)
      .where(eq(achMandates.authorizationChallengeId, challengeId))
      .limit(1);
    return rows.length > 0 ? rows[0].id : null;
  },
};

/**
 * Verify a presented challenge AND assert it has not already produced a
 * mandate. On success the caller must write `challengeId` to
 * `ach_mandates.authorization_challenge_id` in the same operation that creates
 * the mandate — that write is the consumption.
 */
export async function claimAutopayAuthorizationChallenge(
  token: unknown,
  expected: AutopayChallengeBinding,
  deps: { now?: Date; lookup?: ConsumedChallengeLookup } = {},
): Promise<AutopayChallengeResult> {
  const verified = verifyAutopayAuthorizationChallenge(token, expected, deps.now ?? new Date());
  if (!verified.ok) return verified;

  const lookup = deps.lookup ?? mandateChallengeLookup;
  const existingMandateId = await lookup.mandateIdForChallenge(verified.challengeId);
  if (existingMandateId !== null) {
    logger.warn("Autopay authorization challenge replayed — refusing a second mandate", {
      metadata: {
        // The token is never logged. The challenge id is not secret (it is a
        // stored column) and is the only handle that makes this auditable.
        challengeId: verified.challengeId,
        noteId: expected.noteId,
        existingMandateId,
      },
    });
    return refuse("authorization_challenge_used");
  }
  return verified;
}
