import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { storage, db } from "./storage";
import { withTransaction } from "./db";
import { eq, and, gte, desc } from "drizzle-orm";
import { notes, payments, type BorrowerSession, type Lead } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { createRateLimiter, RATE_LIMIT_CONFIGS } from "./middleware/rateLimit";
import { logger } from "./utils/logger";
import { addMonths } from "./utils/dateUtils";
import { splitPaymentCents, computeAppliedLateFeeCents } from "./services/notePaymentMath";
import { Errors, sendError } from "./utils/errors";
import { getOrganization, type AuthenticatedRequest } from "./types/request";
import {
  exchangeForBorrowerSession,
  verifyBorrowerSession,
  SESSION_TTL_SECONDS as STMT_SESSION_TTL_SECONDS,
  COOKIE_NAME as STMT_COOKIE_NAME,
  type BorrowerGrantResolver,
} from "./services/borrower/statementAccess";
import { emitPaymentEvent } from "./services/workflow-engine";
import {
  startAchMandateSetup,
  confirmAchMandateSetup,
  revokeAchMandatesForNote,
  getAchMandateSummary,
  resolveLenderConnectAccount,
  mandateCeilingCents,
  scheduleDescriptionForNote,
  type AchSetupNote,
  type AchSetupRefusal,
  type AchMandateSummary,
} from "./services/achMandateSetup";
import {
  AUTHORIZATION_TEXT_VERSION,
  buildAuthorizationText,
  scheduledDebitAmountCents,
} from "./services/achAutopay";
import {
  mintAutopayAuthorizationChallenge,
  claimAutopayAuthorizationChallenge,
  AUTOPAY_CHALLENGE_TTL_SECONDS,
} from "./services/borrower/autopayAuthorizationChallenge";
import {
  resolveOrgCardProcessor,
  prepareCustomerMoneyCall,
  customerMoneyReadOptions,
  buildBorrowerCardCheckoutParams,
} from "./services/customerMoneyRouting";
import { isCategorySimulated } from "./utils/simulationMode";

// ─────────────────────────────────────────────────────────────────────
// Workflow payment events (Wave B — "wire the engine")
// ─────────────────────────────────────────────────────────────────────
// The borrower portal posts to the seller-finance `payments` ledger in two
// places: the session-based verify-payment (the live path) and the
// deprecated token-based one. Both are Stripe-idempotent — they post at most
// one row per checkout session and return early when the row already exists
// — so emitting at each posting site yields exactly ONE event per payment
// row, never one per retry.
//
// Money-path discipline: the emit runs AFTER the balance-mutating write has
// committed (after storage.createPayment / after the withTransaction block),
// and is wrapped so a workflow fault can never fail, roll back or re-post a
// borrower payment.
//
// Unlike the note/rent ledgers, `payments.id` is a serial integer, so the
// real payment id IS the emitted entityId.
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days between the scheduled due date and the moment the payment
 * posted. Returns null when the note carries no next-payment date, so the
 * event never publishes a guessed lateness. 0 means on-time-or-early.
 */
export function daysLateForBorrowerPayment(
  dueDate: Date | null | undefined,
  paymentDate: Date,
): number | null {
  if (!dueDate) return null;
  const due = dueDate instanceof Date ? dueDate.getTime() : new Date(dueDate).getTime();
  const paid = paymentDate.getTime();
  if (Number.isNaN(due) || Number.isNaN(paid)) return null;
  const diffDays = Math.floor((paid - due) / DAY_MS);
  return diffDays > 0 ? diffDays : 0;
}

/** Everything the emit needs, read from rows that are already committed. */
export interface PostedBorrowerPayment {
  organizationId: number;
  noteId: number;
  paymentId: number;
  amountCents: number;
  principalCents: number;
  interestCents: number;
  lateFeeCents: number;
  /** notes.monthly_payment in cents — null when the note has none recorded. */
  scheduledPaymentCents: number | null;
  dueDate: Date | null;
  paymentDate: Date;
  remainingBalanceCents: number;
  paymentMethod: string;
  /** Which portal endpoint posted it — the live session path or the legacy token path. */
  source: string;
}

/** The `data` bag workflow conditions match on / templates interpolate. */
export function buildBorrowerPaymentEventData(p: PostedBorrowerPayment): Record<string, any> {
  const scheduled = p.scheduledPaymentCents;
  return {
    source: p.source,
    // Identity
    noteId: p.noteId,
    paymentId: p.paymentId,
    // Money
    amountCents: p.amountCents,
    amount: p.amountCents / 100,
    principalCents: p.principalCents,
    interestCents: p.interestCents,
    lateFeeCents: p.lateFeeCents,
    scheduledPaymentCents: scheduled,
    // Shape
    isFullPayment: scheduled === null ? null : p.amountCents >= scheduled,
    isPartial: scheduled === null ? null : p.amountCents < scheduled,
    paymentMethod: p.paymentMethod,
    paymentDate: p.paymentDate.toISOString(),
    dueDate: p.dueDate ? p.dueDate.toISOString() : null,
    daysLate: daysLateForBorrowerPayment(p.dueDate, p.paymentDate),
    // State after the payment
    remainingBalanceCents: p.remainingBalanceCents,
    remainingPrincipal: p.remainingBalanceCents / 100,
    isPaidOff: p.remainingBalanceCents <= 0,
  };
}

/**
 * Fire-and-forget workflow emit for a borrower payment that is ALREADY
 * committed. Never throws.
 */
export function emitBorrowerPaymentReceived(p: PostedBorrowerPayment): void {
  try {
    emitPaymentEvent(
      "payment.received",
      p.organizationId,
      p.paymentId,
      buildBorrowerPaymentEventData(p),
    );
  } catch (err) {
    // Swallowed on purpose — the borrower's money is banked and the response
    // must not change because a workflow misbehaved.
    logger.error(
      "Borrower payment workflow emit failed (payment already posted)",
      err instanceof Error ? err : undefined,
      { organizationId: p.organizationId, noteId: p.noteId, paymentId: p.paymentId },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Borrower ACH autopay (Wave C — "money moves")
// ─────────────────────────────────────────────────────────────────────
// Before this, POST /api/borrower/autopay wrote ONE boolean and the portal
// told the borrower "Autopay is on — we'll collect this payment
// automatically." Nothing ever debited; the flag's only reader was the cash
// flow forecaster, which used it to FORECAST money that was never collected.
//
// The toggle is now gated on a stored NACHA §2.3 authorization. It can only be
// turned ON when an `active` ach_mandates row with a confirmed processor
// instrument exists for the note (`getAchMandateSummary().armed`), and turning
// it OFF revokes that authorization — NACHA requires stopping on request, and
// leaving a live mandate behind an "off" switch is exactly the gap that
// produces an unauthorized debit later.
//
// NO ROUTE HERE MOVES MONEY. The only debit path is the hourly
// `ach_autopay_cycle` job (server/jobs/achAutopayRun.ts), whose
// (note_id, period_key, attempt_number) unique claim is the double-charge
// guard. A double-clicked toggle therefore cannot produce a debit at all, let
// alone two — the toggle only records intent plus authorization.

/** Terms the borrower is asked to authorize, derived from the note. */
export interface AutopayAuthorizationTerms {
  authorizationText: string;
  authorizationTextVersion: string;
  maxAmountCents: number;
  scheduleDescription: string;
  scheduledDebitCents: number;
}

/**
 * Build the exact authorization the portal renders. Shared by the status GET
 * (which shows it) and the setup POST (which cross-checks the text the client
 * actually displayed against it), so the borrower can never agree to one
 * disclosure and have a different one stored.
 */
export function buildAutopayAuthorizationTerms(
  note: Pick<
    AchSetupNote,
    "id" | "monthlyPayment" | "serviceFee" | "taxEscrowEnabled" | "monthlyTaxEscrow" | "nextPaymentDate"
  >,
  lenderName: string,
): AutopayAuthorizationTerms {
  const scheduledDebitCents = scheduledDebitAmountCents(note);
  const maxAmountCents = mandateCeilingCents(scheduledDebitCents);
  const scheduleDescription = scheduleDescriptionForNote(note);
  return {
    authorizationText: buildAuthorizationText({
      lenderName,
      amountCents: maxAmountCents,
      scheduleDescription,
      noteReference: `Note #${note.id}`,
    }),
    authorizationTextVersion: AUTHORIZATION_TEXT_VERSION,
    maxAmountCents,
    scheduleDescription,
    scheduledDebitCents,
  };
}

export type AchAvailability =
  | { available: true }
  | { available: false; reason: AchSetupRefusal; message: string };

/**
 * Can this lender actually take an ACH debit today? Answered so the portal can
 * DISABLE the toggle with a reason instead of offering something that will
 * silently never collect. The simulation check comes first and needs no network
 * call; the Connect check short-circuits on "not configured" without touching
 * Stripe, so the common unconfigured case stays a single DB read.
 */
export async function resolveAchAvailability(organizationId: number): Promise<AchAvailability> {
  if (isCategorySimulated("stripe")) {
    return {
      available: false,
      reason: "simulated",
      message:
        "Bank (ACH) autopay is switched off on this environment. No bank details are collected and nothing is debited.",
    };
  }
  const connect = await resolveLenderConnectAccount(organizationId);
  if (!connect.ok) {
    return { available: false, reason: connect.reason, message: connect.message };
  }
  return { available: true };
}

/**
 * The single sentence the borrower sees about autopay. Truthful in every state:
 * it never claims collection will happen unless a debit could actually be
 * created. `armed` is the only state that promises anything.
 */
export function autopayStatusMessage(input: {
  autopayEnabled: boolean;
  mandateStatus: AchMandateSummary["status"];
  armed: boolean;
  availability: AchAvailability;
}): string {
  if (input.autopayEnabled && input.armed) {
    return "Autopay is on — we'll debit your authorized bank account on each due date.";
  }
  if (input.armed) {
    return "Your bank account is authorized. Turn autopay on to have each payment collected automatically.";
  }
  if (input.mandateStatus === "pending") {
    return "Your bank is still verifying the account you added. Autopay stays off — and nothing is debited — until that finishes.";
  }
  if (input.mandateStatus === "revoked" || input.mandateStatus === "invalid") {
    return "Your previous bank authorization is no longer usable. Autopay is off until you authorize a bank account again.";
  }
  if (!input.availability.available) {
    return input.availability.message;
  }
  return "Autopay is off. Nothing is debited automatically until you authorize a bank account.";
}

// Borrower portal rate-limiters. Keyed by accessToken when present (the
// portal endpoints carry it as a URL param) and fall back to IP. Pure IP
// keying breaks borrowers on shared cellular NAT — same class of bug as
// the /api/auth limiter fixed 2026-05-10. The accessToken is unauthenticated
// but is a per-borrower secret, so using it as a key is a strict improvement.
function borrowerPortalKey(req: Request): string {
  const token = req.params?.accessToken || (req.body as { accessToken?: unknown } | undefined)?.accessToken;
  if (token && typeof token === "string" && token.length > 8) return `tok:${token}`;
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// Express request carrying the borrower-portal session attached by
// validateBorrowerSession. Mirrors AuthenticatedRequest (server/types/request.ts)
// for the unauthenticated-but-sessioned borrower surface.
interface BorrowerSessionRequest extends Request {
  borrowerSession?: BorrowerSession;
}

function requireBorrowerSession(req: Request): BorrowerSession {
  const session = (req as BorrowerSessionRequest).borrowerSession;
  if (!session) {
    throw new Error("Borrower session not found on request — is validateBorrowerSession middleware applied?");
  }
  return session;
}
const portalPaymentRateLimiter = createRateLimiter(RATE_LIMIT_CONFIGS.public, borrowerPortalKey);
// Deprecated sunsetting endpoint — raised from 2/min to a usable 10/min and
// keyed by accessToken so legitimate borrowers retrying on cellular don't 429.
const deprecatedPaymentRateLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60 * 1000 }, borrowerPortalKey);

// ─────────────────────────────────────────────────────────────────────
// Sigfried §1 — Borrower-portal sunset (RFC 8594)
// ─────────────────────────────────────────────────────────────────────
// The unauthenticated /api/portal/:accessToken/* endpoints are being
// retired in favor of session-based auth at /api/borrower/*. Per RFC
// 8594 we emit Sunset + Deprecation headers so any third-party caller
// gets explicit machine-readable notice. After the sunset date the
// endpoint returns 410 Gone.
//
// SECURITY (2026-07 audit): sunset pulled forward from 2026-08-01 to NOW.
// These routes authenticate on the URL token alone (no session, no email),
// and historical tokens were minted with Math.random() — predictable. With
// zero external borrowers on the platform, there is no migration to wait
// for; the env var can extend the window if a real integration surfaces.
const BORROWER_PORTAL_SUNSET_DATE =
  process.env.BORROWER_PORTAL_SUNSET_DATE || "2026-07-04";

// Successor URI advertised in the Link header per RFC 8594 §3.
const BORROWER_PORTAL_SUCCESSOR = "/portal/v2";

function sunsetMiddleware(sunsetDateStr: string = BORROWER_PORTAL_SUNSET_DATE) {
  // Parse once at middleware-construction time. Date parsing of an
  // invalid string yields NaN — we fail loudly rather than silently
  // rendering an "Invalid Date" header.
  const sunsetDate = new Date(sunsetDateStr);
  if (Number.isNaN(sunsetDate.getTime())) {
    throw new Error(
      `Invalid BORROWER_PORTAL_SUNSET_DATE: ${sunsetDateStr} (expected ISO 8601)`
    );
  }
  // RFC 7231 §7.1.1.1 IMF-fixdate format for HTTP Date-style headers.
  const sunsetHttpDate = sunsetDate.toUTCString();

  return function sunsetHeaders(req: Request, res: Response, next: NextFunction) {
    // After the sunset date — endpoint is gone. RFC 7231 §6.5.9.
    if (Date.now() > sunsetDate.getTime()) {
      logger.warn("Sunset endpoint accessed after sunset date", {
        path: req.originalUrl,
        sunsetDate: sunsetDate.toISOString(),
        ip: req.ip || req.socket.remoteAddress,
      });
      return sendError(
        res,
        410,
        "endpoint_sunset",
        "This endpoint is no longer available. Please use the new portal at /portal/v2.",
        { sunsetDate: sunsetDate.toISOString() },
      );
    }

    // RFC 8594 — Sunset header in IMF-fixdate format.
    res.setHeader("Sunset", sunsetHttpDate);
    // RFC draft-ietf-httpapi-deprecation-header — Deprecation header.
    // "true" is the spec-allowed legacy value; clients that want a
    // date can read Sunset.
    res.setHeader("Deprecation", "true");
    // Successor advertisement — RFC 8288 Link header with rel="successor-version".
    res.setHeader(
      "Link",
      `<${BORROWER_PORTAL_SUCCESSOR}>; rel="successor-version"`
    );
    next();
  };
}

// Middleware to validate borrower session from cookie or header.
//
// SEC (Lens 23): the session row carries an `organizationId` snapshot from
// when it was minted. Before this defense was added, every downstream
// handler loaded `notes.id = session.noteId` and trusted whatever org the
// note happened to be in at request time. If a note was ever moved across
// orgs (admin tool, manual SQL, future feature), the active borrower
// session would silently follow the note into the new org and start
// writing payments and messages there.
//
// We re-assert `note.organization_id === session.organization_id` here,
// once, so every downstream route gets the defense for free without
// having to remember the AND clause. If the org doesn't match, the
// session is destroyed and the borrower must re-authenticate against
// the new org.
async function validateBorrowerSession(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionToken = req.cookies?.borrower_session || req.headers['x-borrower-session'] as string;
    if (!sessionToken) {
      return Errors.unauthorized(res);
    }
    const session = await storage.getBorrowerSession(sessionToken);
    if (!session) {
      res.clearCookie('borrower_session');
      return Errors.unauthorized(res);
    }
    if (new Date(session.expiresAt) < new Date()) {
      await storage.deleteBorrowerSession(sessionToken);
      res.clearCookie('borrower_session');
      return Errors.unauthorized(res);
    }

    // SEC: re-assert org pin. session.organizationId is set at create-time
    // (post-migration 0081). Compare against the note's current organization;
    // if a note crossed orgs in the meantime, the session is no longer
    // trustworthy for the new tenant and must be re-issued.
    if (session.organizationId != null) {
      const [linkedNote] = await db
        .select({ id: notes.id, organizationId: notes.organizationId })
        .from(notes)
        .where(eq(notes.id, session.noteId));
      if (!linkedNote || linkedNote.organizationId !== session.organizationId) {
        logger.warn("Borrower session org mismatch — note crossed orgs or was deleted", {
          metadata: {
            sessionId: session.id,
            sessionOrgId: session.organizationId,
            noteId: session.noteId,
            currentNoteOrgId: linkedNote?.organizationId ?? null,
          },
        });
        await storage.deleteBorrowerSession(sessionToken);
        res.clearCookie('borrower_session');
        return Errors.unauthorized(res);
      }
    }

    await storage.updateBorrowerSessionAccess(sessionToken);
    (req as BorrowerSessionRequest).borrowerSession = session;
    next();
  } catch (err) {
    logger.error("Borrower session validation error", err);
    return Errors.internal(res, err);
  }
}

export function registerBorrowerRoutes(app: Express): void {
  const api = app;

  // BORROWER PORTAL (Public)
  // ============================================
  
  api.post("/api/borrower/verify", async (req, res) => {
    try {
      const { accessToken, email } = req.body;
      
      if (!accessToken || !email) {
        return Errors.badRequest(res, "Access token and email are required");
      }
      
      // Look up note by access token
      const note = await storage.getNoteByAccessToken(accessToken);
      
      // Security: Use generic "not found" for all failure cases to avoid information leakage
      // Do NOT expose whether access token exists or email matches
      if (!note) {
        return Errors.notFound(res, "loan");
      }
      
      // Verify borrower email - return same generic error if mismatch
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (!borrower || borrower.email?.toLowerCase() !== email.toLowerCase()) {
          return Errors.notFound(res, "loan");
        }
      } else {
        // No borrower linked - cannot verify, treat as not found
        return Errors.notFound(res, "loan");
      }
      
      // Create a session for the borrower
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
      
      await storage.createBorrowerSession({
        noteId: note.id,
        // SEC (Lens 23): pin org at session-mint time so every read can
        // re-assert note.organizationId === session.organizationId.
        organizationId: note.organizationId,
        sessionToken,
        email: email.toLowerCase(),
        ipAddress: req.ip || req.socket.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
        expiresAt,
      });
      
      // Set session cookie (httpOnly for security)
      res.cookie('borrower_session', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/',
      });
      
      // Get payments for this note
      const notePayments = await storage.getPayments(note.organizationId, note.id);
      
      // Get property info if linked
      let property = null;
      if (note.propertyId) {
        property = await storage.getProperty(note.organizationId, note.propertyId);
      }
      
      // Get borrower info
      let borrower = null;
      if (note.borrowerId) {
        borrower = await storage.getLead(note.organizationId, note.borrowerId);
      }
      
      // The portal is AcreOS-branded but AcreOS collects nothing here — the
      // lender does, on the lender's own processor (founder ruling
      // 2026-07-29). The borrower is entitled to know whose money this is
      // before they hand over a card, so the lender's name ships with the
      // loan data and is rendered next to the pay button.
      const lenderOrg = await storage.getOrganization(note.organizationId);

      res.json({
        note: { ...note, property },
        payments: notePayments,
        borrower: borrower ? { firstName: borrower.firstName, lastName: borrower.lastName } : null,
        lenderName: lenderOrg?.name || null,
        sessionToken, // Also return in response for clients that prefer header-based auth
      });
    } catch (err) {
      Errors.internal(res, err);
    }
  });
  
  // ─────────────────────────────────────────────────────────────────────
  // F3.4 fix — borrower-statement creds out of URL.
  // ─────────────────────────────────────────────────────────────────────
  // Beatrice's pre-deploy audit (2026-06-03) flagged
  // `GET /api/borrower/statements/generate?accessToken=...&email=...`
  // as a credential-in-URL leak: proxy/Sentry/Cloudflare logs all
  // capture the query string.
  //
  // Replacement flow:
  //   1. Email-link landing page POSTs (accessToken, email) here.
  //   2. We mint a signed, IP-bound, 30-min cookie ("borrower_stmt_session").
  //   3. The statement-fetch GET reads the cookie via verifyBorrowerSession;
  //      returns 401 when absent/invalid/expired.
  //
  // Distinct from the DB-backed /api/borrower/verify session — keeps
  // the statement-access flow self-contained and stateless.
  api.post("/api/borrower/auth/exchange", async (req, res) => {
    try {
      const { accessToken, email } = req.body ?? {};
      if (
        typeof accessToken !== "string" ||
        typeof email !== "string" ||
        !accessToken ||
        !email
      ) {
        return Errors.badRequest(res, "accessToken and email are required");
      }

      const ip = req.ip || req.socket.remoteAddress || "unknown";

      const resolver: BorrowerGrantResolver = {
        async resolve({ accessToken, email }) {
          const note = await storage.getNoteByAccessToken(accessToken);
          if (!note) return { ok: false, reason: "not_found" };
          if (!note.borrowerId) return { ok: false, reason: "no_borrower" };
          const borrower = await storage.getLead(
            note.organizationId,
            note.borrowerId,
          );
          if (
            !borrower ||
            borrower.email?.toLowerCase() !== email.toLowerCase()
          ) {
            return { ok: false, reason: "email_mismatch" };
          }
          return { ok: true, scope: `note:${note.id}` };
        },
      };

      const result = await exchangeForBorrowerSession(
        { accessToken, email, ip },
        resolver,
      );

      if (!result.ok || !result.sessionCookie) {
        return Errors.unauthorized(res);
      }

      res.cookie(STMT_COOKIE_NAME, result.sessionCookie, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: STMT_SESSION_TTL_SECONDS * 1000,
        path: "/",
      });

      return res.status(204).end();
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Check borrower session status
  api.get("/api/borrower/session", validateBorrowerSession, async (req, res) => {
    try {
      const session = requireBorrowerSession(req);

      // SEC (2026-09-04): this used to load the note with
      // `storage.getNoteByAccessToken(session.noteId.toString())` — the
      // session's NUMERIC note id passed to a lookup keyed on
      // `notes.access_token`, an opaque per-note secret. Two things were wrong
      // and the second is the serious one:
      //
      //   1. Namespace confusion. A note id is not an access token, so the
      //      primary lookup matched only by coincidence and the by-id branch
      //      below it was doing the real work.
      //   2. `notes.access_token` is CLIENT-SETTABLE and globally unique.
      //      `insertNoteSchema` omits only { id, createdAt, updatedAt }, and
      //      `createNote` honours `noteData.accessToken` verbatim — so any
      //      self-serve signup can POST /api/notes with
      //      `{ accessToken: "42" }` and own the token "42" forever. From then
      //      on, a legitimate borrower of a DIFFERENT organization's note #42
      //      was served the attacker's loan: balance, payment history, linked
      //      property and borrower name, on a Reg-Z consumer surface.
      //
      // It also defeated the defence `validateBorrowerSession` documents right
      // above: that middleware re-asserts `note.organization_id ===
      // session.organization_id` for `notes.id = session.noteId`, and the
      // token lookup returned a row it had never checked.
      //
      // The note is now loaded by id AND the session's own organization
      // snapshot, so the read cannot leave the tenant the session was minted
      // in even if the middleware's check is later moved or removed.
      const [note] = await db
        .select()
        .from(notes)
        .where(
          session.organizationId != null
            ? and(eq(notes.id, session.noteId), eq(notes.organizationId, session.organizationId))
            : eq(notes.id, session.noteId),
        )
        .limit(1);
      if (!note) {
        return Errors.notFound(res, "loan");
      }

      // Get payments for this note
      const notePayments = await storage.getPayments(note.organizationId, note.id);
      
      // Get property info if linked
      let property = null;
      if (note.propertyId) {
        property = await storage.getProperty(note.organizationId, note.propertyId);
      }
      
      // Get borrower info
      let borrower = null;
      if (note.borrowerId) {
        borrower = await storage.getLead(note.organizationId, note.borrowerId);
      }
      
      res.json({
        note: { ...note, property },
        payments: notePayments,
        borrower: borrower ? { firstName: borrower.firstName, lastName: borrower.lastName } : null,
        session: {
          email: session.email,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        },
      });
    } catch (err) {
      Errors.internal(res, err);
    }
  });
  
  // Borrower logout
  api.post("/api/borrower/logout", async (req, res) => {
    try {
      const sessionToken = req.cookies?.borrower_session || req.headers['x-borrower-session'] as string;
      
      if (sessionToken) {
        await storage.deleteBorrowerSession(sessionToken);
      }
      
      res.clearCookie('borrower_session', { path: '/' });
      res.json({ message: "Logged out successfully" });
    } catch (err) {
      Errors.internal(res, err);
    }
  });
  
  // Session-based payment endpoint (preferred for security)
  api.post("/api/borrower/payment", validateBorrowerSession, portalPaymentRateLimiter, async (req, res) => {
    try {
      const session = requireBorrowerSession(req);
      const { amount } = req.body;
      
      // Get note by session's noteId
      const noteResults = await db.select().from(notes).where(eq(notes.id, session.noteId));
      if (noteResults.length === 0) {
        return Errors.notFound(res, "loan");
      }
      const note = noteResults[0];
      
      const paymentAmount = amount ? Number(amount) : Number(note.monthlyPayment || 0);
      if (paymentAmount <= 0) {
        return Errors.badRequest(res, "Invalid payment amount");
      }
      
      // WHOSE ACCOUNT THIS LANDS IN — the lender's own, or nobody's.
      // Founder ruling 2026-07-29 ("be the rail, not the provider"): a
      // borrower's mortgage payment is CUSTOMER money. It moves on the org's
      // own connected processor, with no AcreOS cut and without transiting
      // AcreOS's balance. A lender who has not connected one is refused with
      // a reason — there is no platform fallback, ever.
      const routing = await resolveOrgCardProcessor(note.organizationId);
      if (!routing.ok) {
        logger.warn("Borrower card payment refused — lender has no usable card processor", {
          metadata: { noteId: note.id, organizationId: note.organizationId, reason: routing.reason },
        });
        return Errors.badRequest(res, routing.borrowerMessage, { reason: routing.reason });
      }

      // Get Stripe client
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();

      // Get borrower info for customer description
      let borrowerName = "Borrower";
      let borrowerEmail = session.email;
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (borrower) {
          borrowerName = `${borrower.firstName} ${borrower.lastName}`;
          borrowerEmail = borrower.email || session.email;
        }
      }

      const org = await storage.getOrganization(note.organizationId);

      // Create checkout session for one-time payment — a DIRECT charge on the
      // lender's account (`stripeAccount`), so the lender is merchant of
      // record and the funds never touch AcreOS.
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const { params, options } = prepareCustomerMoneyCall(
        "borrower.card.checkout.session",
        buildBorrowerCardCheckoutParams({
          noteId: note.id,
          organizationId: note.organizationId,
          lenderName: org?.name || "your lender",
          borrowerName,
          borrowerEmail,
          amountCents: Math.round(paymentAmount * 100),
          baseUrl,
          accessToken: note.accessToken || "",
          source: "session",
        }),
        routing.processor,
      );
      const stripeSession = await stripe.checkout.sessions.create(params, options);

      // Store the checkout session ID on the note for webhook verification
      await storage.updateNote(note.id, { pendingCheckoutSessionId: stripeSession.id }, note.organizationId);

      res.json({ url: stripeSession.url, sessionId: stripeSession.id, collectedBy: org?.name || null });
    } catch (err) {
      logger.error("Session-based portal payment error", err);
      Errors.internal(res, err);
    }
  });

  // Create Stripe checkout session for borrower portal payment
  // DEPRECATED: Use session-based auth at /api/borrower/payment instead
  // Rate limited: 2 requests per minute per IP (stricter than session-based)
  api.post("/api/portal/:accessToken/payment", sunsetMiddleware(), deprecatedPaymentRateLimiter, async (req, res) => {
    // Log deprecation warning
    logger.warn("Deprecated endpoint accessed: /api/portal/:accessToken/payment", {
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      accessToken: req.params.accessToken ? "[REDACTED]" : undefined,
    });
    
    // Set deprecation warning header
    res.setHeader("X-Deprecation-Warning", "This endpoint is deprecated. Use session-based auth at /api/borrower/payment instead.");
    
    try {
      const { accessToken } = req.params;
      const { amount } = req.body;
      
      if (!accessToken) {
        return Errors.badRequest(res, "Access token is required");
      }
      
      const note = await storage.getNoteByAccessToken(accessToken);
      if (!note) {
        return Errors.notFound(res, "loan");
      }
      
      const paymentAmount = amount ? Number(amount) : Number(note.monthlyPayment || 0);
      if (paymentAmount <= 0) {
        return Errors.badRequest(res, "Invalid payment amount");
      }
      
      // Same custody rule as the session-based path above — the deprecated
      // endpoint is not a loophole. Customer money moves on the lender's own
      // connected processor or it does not move.
      const routing = await resolveOrgCardProcessor(note.organizationId);
      if (!routing.ok) {
        logger.warn("Borrower card payment refused (legacy token path) — lender has no usable card processor", {
          metadata: { noteId: note.id, organizationId: note.organizationId, reason: routing.reason },
        });
        return Errors.badRequest(res, routing.borrowerMessage, { reason: routing.reason });
      }

      // Get Stripe client
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();

      // Get borrower info for customer description
      let borrowerName = "Borrower";
      let borrowerEmail = undefined;
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (borrower) {
          borrowerName = `${borrower.firstName} ${borrower.lastName}`;
          borrowerEmail = borrower.email || undefined;
        }
      }

      const org = await storage.getOrganization(note.organizationId);

      // Create checkout session for one-time payment — direct charge on the
      // lender's account.
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const { params, options } = prepareCustomerMoneyCall(
        "borrower.card.checkout.session.legacy",
        buildBorrowerCardCheckoutParams({
          noteId: note.id,
          organizationId: note.organizationId,
          lenderName: org?.name || "your lender",
          borrowerName,
          borrowerEmail,
          amountCents: Math.round(paymentAmount * 100),
          baseUrl,
          accessToken,
          source: "legacy_token",
        }),
        routing.processor,
      );
      const session = await stripe.checkout.sessions.create(params, options);

      // Store the checkout session ID on the note for webhook verification
      await storage.updateNote(note.id, { pendingCheckoutSessionId: session.id }, note.organizationId);

      res.json({ url: session.url, sessionId: session.id, collectedBy: org?.name || null });
    } catch (err) {
      logger.error("Portal payment error", err);
      Errors.internal(res, err);
    }
  });
  
  // Verify Stripe payment and create payment record
  api.post("/api/portal/:accessToken/verify-payment", sunsetMiddleware(), deprecatedPaymentRateLimiter, async (req, res) => {
    try {
      const { accessToken } = req.params;
      const { sessionId } = req.body;
      
      if (!accessToken || !sessionId) {
        return Errors.badRequest(res, "Access token and session ID are required");
      }
      
      const note = await storage.getNoteByAccessToken(accessToken);
      if (!note) {
        return Errors.notFound(res, "loan");
      }
      
      // Verify Stripe session — the charge lives on the LENDER'S account, so
      // the retrieve must be scoped there too. An unscoped retrieve looks in
      // AcreOS's account, finds nothing, and would tell a borrower who really
      // paid that they hadn't.
      const routing = await resolveOrgCardProcessor(note.organizationId);
      if (!routing.ok) {
        logger.warn("Borrower payment verification refused (legacy token path) — no lender processor to read from", {
          metadata: { noteId: note.id, organizationId: note.organizationId, reason: routing.reason },
        });
        return Errors.badRequest(res, routing.borrowerMessage, { reason: routing.reason });
      }

      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();

      const session = await stripe.checkout.sessions.retrieve(
        sessionId,
        undefined,
        customerMoneyReadOptions(routing.processor, "borrower.card.checkout.retrieve.legacy"),
      );

      if (session.payment_status !== 'paid') {
        return Errors.badRequest(res, "Payment not completed");
      }
      
      // Check if payment already recorded for this session
      const existingPayments = await storage.getPayments(note.organizationId, note.id);
      const alreadyRecorded = existingPayments.some(p => p.transactionId === sessionId);
      if (alreadyRecorded) {
        return res.json({ success: true, message: "Payment already recorded" });
      }
      
      const paymentAmount = session.amount_total ? session.amount_total / 100 : Number(note.monthlyPayment);

      // Integer-cent principal/interest split. The legacy path did float
      // math on the amortization-schedule entries and rounded with
      // .toFixed(2); we now read currentBalance + interestRate and do the
      // split in cents. Storage still takes decimal strings (legacy
      // `notes`/`payments` schema) — we only stringify at the writer
      // boundary so the math stays drift-free up to that point.
      const paymentAmountCents = Math.round(paymentAmount * 100);
      const currentBalanceCents = Math.round(Number(note.currentBalance || 0) * 100);
      const annualRateBps = Math.round(Number(note.interestRate || 0) * 100);
      const split = splitPaymentCents({
        paymentAmountCents,
        currentBalanceCents,
        annualRateBps,
      });
      const principalAmount = split.principalCents / 100;
      const interestAmount = split.interestCents / 100;

      // Late fee — assessed when payment posts past gracePeriodDays of
      // the next-payment due date. Configured per-note via note.lateFee
      // ($) + note.gracePeriodDays. Always 0 when the borrower paid
      // inside grace.
      const paymentDate = new Date();
      const dueDate = note.nextPaymentDate || new Date();
      const configuredLateFeeCents = Math.round(Number(note.lateFee || 0) * 100);
      const gracePeriodDays = note.gracePeriodDays ?? 10;
      const lateFeeAppliedCents = computeAppliedLateFeeCents({
        dueDate,
        paymentDate,
        gracePeriodDays,
        configuredLateFeeCents,
      });
      const lateFeeAmount = lateFeeAppliedCents / 100;

      // Schedule mark-paid still uses the schedule index as before — the
      // legacy borrower portal surfaces the schedule for visual progress,
      // not for split math.
      const schedule = note.amortizationSchedule || [];
      const nextPendingPayment = schedule.find(s => s.status === 'pending');

      // Create payment record — balance update happens inside the transaction
      // with optimistic locking (see storage.createPayment)
      const payment = await storage.createPayment({
        organizationId: note.organizationId,
        noteId: note.id,
        amount: paymentAmount.toString(),
        principalAmount: principalAmount.toString(),
        interestAmount: interestAmount.toString(),
        feeAmount: "0",
        lateFeeAmount: lateFeeAmount.toString(),
        paymentDate,
        dueDate,
        paymentMethod: 'card',
        transactionId: sessionId,
        status: 'completed',
      });

      const newBalance = Math.max(0, (currentBalanceCents - split.principalCents)) / 100;

      // Update schedule and next payment date (non-financial, safe outside payment tx)
      let updatedSchedule = schedule;
      if (nextPendingPayment) {
        updatedSchedule = schedule.map(s =>
          s.paymentNumber === nextPendingPayment.paymentNumber
            ? { ...s, status: 'paid' }
            : s
        );
      }

      const nextPaymentDate = addMonths(new Date(note.nextPaymentDate || new Date()), 1);

      await storage.updateNote(note.id, {
        amortizationSchedule: updatedSchedule,
        nextPaymentDate: nextPaymentDate,
      }, note.organizationId);

      // Payment row + balance are committed (storage.createPayment runs its
      // own transaction). Fire-and-forget workflow event — never throws.
      emitBorrowerPaymentReceived({
        organizationId: note.organizationId,
        noteId: note.id,
        paymentId: payment.id,
        amountCents: paymentAmountCents,
        principalCents: split.principalCents,
        interestCents: split.interestCents,
        lateFeeCents: lateFeeAppliedCents,
        scheduledPaymentCents: note.monthlyPayment != null
          ? Math.round(Number(note.monthlyPayment) * 100)
          : null,
        // The stored schedule date, NOT the `|| new Date()` fallback used for
        // the late-fee math — a missing due date stays null in the event.
        dueDate: note.nextPaymentDate ?? null,
        paymentDate,
        remainingBalanceCents: Math.max(0, currentBalanceCents - split.principalCents),
        paymentMethod: "card",
        source: "borrower_portal_legacy_token",
      });

      res.json({
        success: true,
        payment,
        newBalance,
        lateFeeApplied: lateFeeAmount,
      });
    } catch (err) {
      logger.error("Payment verification error", err);
      Errors.internal(res, err);
    }
  });

  // Session-based payment verification — borrower has already verified
  // via /api/borrower/verify, so the session tells us which note. No
  // accessToken in the URL → safer against log/referrer leakage.
  api.post("/api/borrower/verify-payment", validateBorrowerSession, portalPaymentRateLimiter, async (req, res) => {
    try {
      const session = requireBorrowerSession(req);
      const { sessionId } = req.body;
      if (!sessionId) return Errors.badRequest(res, "Session ID is required");

      const noteResults = await db.select().from(notes).where(eq(notes.id, session.noteId));
      if (noteResults.length === 0) return Errors.notFound(res, "loan");
      const note = noteResults[0];

      // The charge is a direct charge on the lender's connected account, so
      // read it back from that account — never from AcreOS's.
      const routing = await resolveOrgCardProcessor(note.organizationId);
      if (!routing.ok) {
        logger.warn("Borrower payment verification refused — no lender processor to read from", {
          metadata: { noteId: note.id, organizationId: note.organizationId, reason: routing.reason },
        });
        return Errors.badRequest(res, routing.borrowerMessage, { reason: routing.reason });
      }

      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      const stripeSession = await stripe.checkout.sessions.retrieve(
        sessionId,
        undefined,
        customerMoneyReadOptions(routing.processor, "borrower.card.checkout.retrieve"),
      );

      if (stripeSession.payment_status !== "paid") {
        return Errors.badRequest(res, "Payment not completed");
      }

      const paymentAmount = stripeSession.amount_total
        ? stripeSession.amount_total / 100
        : Number(note.monthlyPayment);

      // Integer-cent split — see deprecated /api/portal/.../verify-payment
      // writer above. The schedule-based split it replaces used .toFixed(2)
      // and produced .01 drift on long-running notes.
      const paymentAmountCents = Math.round(paymentAmount * 100);
      const currentBalanceCents = Math.round(Number(note.currentBalance || 0) * 100);
      const annualRateBps = Math.round(Number(note.interestRate || 0) * 100);
      const split = splitPaymentCents({
        paymentAmountCents,
        currentBalanceCents,
        annualRateBps,
      });
      const principalAmount = split.principalCents / 100;
      const interestAmount = split.interestCents / 100;

      // Late fee — see deprecated writer above for the same logic.
      const paymentDate = new Date();
      const dueDate = note.nextPaymentDate || new Date();
      const configuredLateFeeCents = Math.round(Number(note.lateFee || 0) * 100);
      const gracePeriodDays = note.gracePeriodDays ?? 10;
      const lateFeeAppliedCents = computeAppliedLateFeeCents({
        dueDate,
        paymentDate,
        gracePeriodDays,
        configuredLateFeeCents,
      });
      const lateFeeAmount = lateFeeAppliedCents / 100;

      const schedule = note.amortizationSchedule || [];
      const nextPendingPayment = schedule.find((s) => s.status === "pending");

      // Idempotent payment write — replaces the prior read-then-write
      // (storage.getPayments → .some(...).transactionId === sessionId →
      // storage.createPayment). That pattern races on concurrent Stripe
      // webhook redelivery: two coroutines both see "no existing row" and
      // both insert. The payments.transactionId unique constraint catches
      // the second one with a DB error, but only after the balance had
      // already been mutated in one of the racing transactions.
      //
      // The new path uses INSERT … ON CONFLICT (transaction_id) DO NOTHING
      // RETURNING * inside a single transaction. If the conflict fires
      // (returned []), we know the other coroutine already posted the
      // payment and we return 200 with the existing row — no second
      // balance mutation, no error to the borrower.
      const idempotentResult = await withTransaction(async (tx) => {
        const inserted = await tx
          .insert(payments)
          .values({
            organizationId: note.organizationId,
            noteId: note.id,
            amount: paymentAmount.toString(),
            principalAmount: principalAmount.toString(),
            interestAmount: interestAmount.toString(),
            feeAmount: "0",
            lateFeeAmount: lateFeeAmount.toString(),
            paymentDate,
            dueDate,
            paymentMethod: "card",
            transactionId: sessionId,
            status: "completed",
          })
          .onConflictDoNothing({ target: payments.transactionId })
          .returning();

        if (inserted.length === 0) {
          // Conflict — another coroutine inserted this transactionId
          // first. Fetch and return without touching the balance.
          const [existing] = await tx
            .select()
            .from(payments)
            .where(eq(payments.transactionId, sessionId));
          return { row: existing, created: false } as const;
        }

        const [row] = inserted;

        // We won the race — update the note balance + version inside the
        // same transaction with optimistic locking (matches the contract
        // storage.createPayment provided).
        const [lockedNote] = await tx
          .select()
          .from(notes)
          .where(eq(notes.id, note.id))
          .for("update");
        if (lockedNote) {
          const newBalanceCents = Math.max(0, Math.round(Number(lockedNote.currentBalance) * 100) - split.principalCents);
          const updated = await tx
            .update(notes)
            .set({
              currentBalance: (newBalanceCents / 100).toString(),
              status: newBalanceCents <= 0 ? "paid_off" : "active",
              version: (lockedNote.version ?? 1) + 1,
              updatedAt: new Date(),
            })
            .where(and(eq(notes.id, note.id), eq(notes.version, lockedNote.version ?? 1)))
            .returning();
          if (updated.length === 0) {
            throw new Error(`Optimistic lock conflict on note ${note.id} — concurrent update detected`);
          }
        }

        return { row, created: true } as const;
      });

      const payment = idempotentResult.row;

      if (!idempotentResult.created) {
        // Conflict path — the row already existed. Return 200 with the
        // existing payment so the client treats this as success (the
        // Stripe webhook will redeliver until we 200).
        return res.json({ success: true, payment, message: "Payment already recorded" });
      }

      const newBalance = Math.max(0, (currentBalanceCents - split.principalCents)) / 100;
      let updatedSchedule = schedule;
      if (nextPendingPayment) {
        updatedSchedule = schedule.map((s) =>
          s.paymentNumber === nextPendingPayment.paymentNumber ? { ...s, status: "paid" } : s,
        );
      }
      const nextPaymentDate = addMonths(new Date(note.nextPaymentDate || new Date()), 1);
      await storage.updateNote(
        note.id,
        { amortizationSchedule: updatedSchedule, nextPaymentDate },
        note.organizationId,
      );

      // The idempotent transaction has COMMITTED and we are on the
      // `created: true` branch (the conflict branch returned above), so this
      // fires exactly once per payment row — never on a Stripe redelivery.
      // Fire-and-forget: never throws.
      emitBorrowerPaymentReceived({
        organizationId: note.organizationId,
        noteId: note.id,
        paymentId: payment.id,
        amountCents: paymentAmountCents,
        principalCents: split.principalCents,
        interestCents: split.interestCents,
        lateFeeCents: lateFeeAppliedCents,
        scheduledPaymentCents: note.monthlyPayment != null
          ? Math.round(Number(note.monthlyPayment) * 100)
          : null,
        // The stored schedule date, NOT the `|| new Date()` fallback used for
        // the late-fee math — a missing due date stays null in the event.
        dueDate: note.nextPaymentDate ?? null,
        paymentDate,
        remainingBalanceCents: Math.max(0, currentBalanceCents - split.principalCents),
        paymentMethod: "card",
        source: "borrower_portal",
      });

      // Phase 3 Week 14 — Activation telemetry. First borrower payment
      // received. Idempotent FIRST-occurrence on (org, eventName).
      try {
        const { recordActivationEventAsync } = await import("./services/activation");
        recordActivationEventAsync({
          orgId: note.organizationId,
          userId: null,
          eventName: "first_borrower_payment_received",
          eventValue: { paymentId: payment.id, noteId: note.id, amount: paymentAmount },
        });
      } catch { /* non-fatal */ }

      res.json({ success: true, payment, newBalance, lateFeeApplied: lateFeeAmount });
    } catch (err) {
      logger.error("Payment verification error (session)", err);
      Errors.internal(res, err);
    }
  });

  // ============================================
  // BORROWER ACH AUTOPAY (Session-authenticated)
  // --------------------------------------------
  // Auth is the SAME `validateBorrowerSession` cookie/header session every
  // other money route on this surface uses (it re-asserts the note↔org pin), and
  // the same `portalPaymentRateLimiter`. No new auth scheme on a money endpoint.
  // ============================================

  // Everything the portal needs to tell the borrower the truth about autopay:
  // whether the flag is on, whether a debit could actually be created, the
  // stored authorization's state, and — when there is none yet — the VERBATIM
  // authorization text they would be agreeing to.
  api.get("/api/borrower/autopay", validateBorrowerSession, portalPaymentRateLimiter, async (req, res) => {
    try {
      const session = requireBorrowerSession(req);
      const [note] = await db.select().from(notes).where(eq(notes.id, session.noteId));
      if (!note) return Errors.notFound(res, "loan");

      const mandate = await getAchMandateSummary(note.organizationId, note.id);
      // Skip the availability probe when the mandate is already armed — the
      // instrument is confirmed, so a Stripe round-trip would tell us nothing
      // the borrower needs.
      let availability: AchAvailability = mandate.armed
        ? { available: true }
        : await resolveAchAvailability(note.organizationId);

      const org = await storage.getOrganization(note.organizationId);
      const terms = buildAutopayAuthorizationTerms(note, org?.name || "your lender");

      // Serving the authorization text is the ONLY place a challenge is minted.
      // That is the whole mechanism: the mandate POST can only succeed if the
      // server itself rendered this exact text version, to this session, for
      // this note, within AUTOPAY_CHALLENGE_TTL_SECONDS. Minting is pure crypto
      // — no row is written — so an abandoned read costs nothing.
      const offeringAuthorization = availability.available && !mandate.armed;
      const challenge = offeringAuthorization
        ? mintAutopayAuthorizationChallenge({
            sessionId: session.id,
            noteId: note.id,
            textVersion: terms.authorizationTextVersion,
          })
        : null;
      if (offeringAuthorization && !challenge) {
        // No signing material configured. Refuse to offer a setup flow we
        // could only gate on the client's word — that is the exact CodeQL
        // finding this challenge exists to close.
        logger.error(
          "Autopay authorization challenge cannot be signed — no signing material configured; not offering bank setup",
          undefined,
          { metadata: { noteId: note.id, organizationId: note.organizationId } },
        );
        availability = {
          available: false,
          reason: "authorization_challenge_unavailable",
          message:
            "Bank autopay setup is temporarily unavailable on this system. Autopay is off and nothing is debited automatically.",
        };
      }

      res.json({
        autopayEnabled: note.autoPayEnabled === true,
        nextPaymentDate: note.nextPaymentDate,
        mandate,
        achAvailable: availability.available,
        achUnavailableReason: availability.available ? null : availability.reason,
        achUnavailableMessage: availability.available ? null : availability.message,
        // Only offered when setup is actually possible — never render an
        // authorization we could not act on, and never one we could not later
        // prove we served (no challenge ⇒ no offer).
        authorization:
          availability.available && !mandate.armed && challenge
            ? {
                ...terms,
                // The client must send this back on POST /autopay/mandate.
                challengeToken: challenge.token,
                challengeExpiresAt: challenge.expiresAt,
                challengeTtlSeconds: AUTOPAY_CHALLENGE_TTL_SECONDS,
              }
            : null,
        scheduledDebitCents: terms.scheduledDebitCents,
        statusMessage: autopayStatusMessage({
          autopayEnabled: note.autoPayEnabled === true,
          mandateStatus: mandate.status,
          armed: mandate.armed,
          availability,
        }),
      });
    } catch (err) {
      logger.error("Autopay status read failed", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  // Phase 1 of mandate capture: record the borrower's agreement to the exact
  // authorization text, then hand back the hosted-Checkout URL that collects
  // the bank account. Records consent BEFORE the redirect (see
  // services/achMandateSetup.ts) so an abandoned setup is visible, not lost.
  //
  // THREE INDEPENDENT LAYERS, DEFENCE IN DEPTH (CodeQL HIGH, PR #259 —
  // "user-controlled bypass of security check"). This endpoint creates a NACHA
  // ACH debit authorization, so the gate must not reduce to a client boolean.
  //
  // THE ORDER BELOW IS THE POINT, and it is deliberate: the SERVER-ISSUED value
  // is verified FIRST, before any client-supplied field is consulted at all.
  // The nearest guard standing in front of mandate creation is therefore a value
  // this server minted, not anything the borrower's browser asserted.
  //
  //   1. `authorizationChallenge` (CHECKED FIRST) — a server-minted, single-use,
  //      15-minute HMAC token bound to (session id, note id, authorization text
  //      version), issued ONLY by GET /api/borrower/autopay, the sole endpoint
  //      that renders the text. This is THE security boundary. Its id is stored
  //      on the mandate under a unique index, so it is provable and unreplayable.
  //   2. `authorizationAccepted === true` (checked after) — records the
  //      AFFIRMATIVE ACT for the NACHA record. Deliberately demoted: evidence of
  //      intent and defence in depth, never the security check. A client that
  //      forges it still cannot get past layer 1.
  //   3. `displayedAuthorizationText` echo — proves the client HAD the exact
  //      text, byte for byte. Catches drift the version stamp can't see (the
  //      lender renamed, the ceiling moved) because it compares the string.
  //
  // Every refusal below leaves autopay unchanged and creates NO mandate row.
  api.post(
    "/api/borrower/autopay/mandate",
    validateBorrowerSession,
    portalPaymentRateLimiter,
    async (req, res) => {
      try {
        const session = requireBorrowerSession(req);
        const body = req.body as {
          authorizationAccepted?: unknown;
          displayedAuthorizationText?: unknown;
          authorizationChallenge?: unknown;
        };

        const [note] = await db.select().from(notes).where(eq(notes.id, session.noteId));
        if (!note) return Errors.notFound(res, "loan");

        // Already armed — do not mint a second authorization for the same note.
        const existing = await getAchMandateSummary(note.organizationId, note.id);
        if (existing.armed) {
          return Errors.badRequest(
            res,
            "This loan already has an authorized bank account. Turn autopay off first if you want to use a different account.",
            { reason: "mandate_already_active", accountLast4: existing.accountLast4 },
          );
        }

        const org = await storage.getOrganization(note.organizationId);
        const lenderName = org?.name || "your lender";
        const terms = buildAutopayAuthorizationTerms(note, lenderName);

        // LAYER 1, AND IT COMES FIRST — the server-issued challenge. This is the
        // security boundary, and it is verified BEFORE any client-supplied field
        // is consulted, so the guard nearest the sensitive action is a value the
        // server minted rather than one the browser asserted. Nothing below this
        // line can be reached by a client that did not first receive this exact
        // authorization version from GET /api/borrower/autopay, on this session,
        // for this note, within the last 15 minutes, and has not already redeemed
        // it. Missing, tampered, expired, replayed, wrong-session, wrong-note and
        // stale-text-version all refuse here — before any processor call, before
        // any mandate row exists, and before `authorizationAccepted` is even read.
        const claim = await claimAutopayAuthorizationChallenge(body.authorizationChallenge, {
          sessionId: session.id,
          noteId: note.id,
          textVersion: terms.authorizationTextVersion,
        });
        if (!claim.ok) {
          // Never log the token itself — only the refusal reason.
          logger.warn("Borrower ACH authorization challenge refused — no mandate created", {
            metadata: {
              noteId: note.id,
              organizationId: note.organizationId,
              reason: claim.reason,
              expectedTextVersion: terms.authorizationTextVersion,
            },
          });
          return Errors.badRequest(res, claim.message, { reason: claim.reason });
        }

        // LAYER 2 — the affirmative act. Only reachable once the server-issued
        // challenge above has already been verified and found unredeemed, so this
        // boolean cannot be the bypass: it records consent, it does not grant it.
        // Kept because the NACHA record must show the borrower ticked the box.
        if (body.authorizationAccepted !== true) {
          return Errors.badRequest(
            res,
            "We can't set up bank autopay until you agree to the authorization shown above.",
            { reason: "authorization_not_accepted" },
          );
        }

        // LAYER 3 — cross-check: the borrower must have agreed to the text we are
        // about to store, not an older revision cached in their tab. Refuse rather
        // than storing consent to language they never saw.
        if (
          typeof body.displayedAuthorizationText === "string" &&
          body.displayedAuthorizationText !== terms.authorizationText
        ) {
          logger.warn("Borrower ACH authorization text mismatch — refusing to store consent", {
            metadata: { noteId: note.id, version: terms.authorizationTextVersion },
          });
          return Errors.badRequest(
            res,
            "Your payment terms changed while this page was open. Please reload and read the updated authorization before continuing.",
            { reason: "authorization_text_stale" },
          );
        }

        const setupNote: AchSetupNote = note;
        const result = await startAchMandateSetup({
          note: setupNote,
          sessionEmail: session.email,
          lenderName,
          ipAddress: req.ip || req.socket.remoteAddress || null,
          userAgent: req.headers["user-agent"] || null,
          baseUrl: `${req.protocol}://${req.get("host")}`,
          authorizationAccepted: true,
          displayedAuthorizationText: terms.authorizationText,
          // Writing this id onto the mandate IS the consumption of the
          // challenge; its unique index is what makes single use true under
          // concurrency rather than merely checked.
          authorizationChallengeId: claim.challengeId,
        });

        if (!result.ok) {
          logger.warn("Borrower ACH mandate setup refused", {
            metadata: { noteId: note.id, reason: result.reason },
          });
          return Errors.badRequest(res, result.message, { reason: result.reason });
        }

        logger.info("Borrower ACH mandate setup started", {
          metadata: {
            noteId: note.id,
            organizationId: note.organizationId,
            mandateId: result.mandateId,
            maxAmountCents: result.maxAmountCents,
            // The challenge id, not the token. It is a stored column, so it is
            // the handle that ties this log line to the mandate record.
            authorizationChallengeId: claim.challengeId,
          },
        });

        res.json({
          success: true,
          mandateId: result.mandateId,
          setupUrl: result.setupUrl,
          authorizationText: result.authorizationText,
          maxAmountCents: result.maxAmountCents,
        });
      } catch (err) {
        logger.error("Borrower ACH mandate setup failed", err instanceof Error ? err : undefined);
        Errors.internal(res, err);
      }
    },
  );

  // Phase 2: the borrower is back from hosted Checkout. Promote the pending
  // mandate to `active` and — only if it really activated — arm autopay.
  // Idempotent: a replayed confirm (double-click, browser back) returns the
  // already-active mandate without a second write and without a second debit
  // (debits are created only by the job, one per note+period).
  api.post(
    "/api/borrower/autopay/mandate/confirm",
    validateBorrowerSession,
    portalPaymentRateLimiter,
    async (req, res) => {
      try {
        const session = requireBorrowerSession(req);
        const { setupReference } = req.body as { setupReference?: unknown };
        if (typeof setupReference !== "string" || setupReference.length === 0) {
          return Errors.badRequest(res, "A bank setup reference is required.");
        }

        const [note] = await db.select().from(notes).where(eq(notes.id, session.noteId));
        if (!note) return Errors.notFound(res, "loan");

        const confirmed = await confirmAchMandateSetup({ noteId: note.id, setupReference });
        if (!confirmed.ok) {
          logger.warn("Borrower ACH mandate confirm refused", {
            metadata: { noteId: note.id, reason: confirmed.reason },
          });
          return Errors.badRequest(res, confirmed.message, { reason: confirmed.reason });
        }

        // Mandate present ⇒ scheduled debit. Turning the flag on here (rather
        // than making the client do it in a second call) means a client that
        // dies after Checkout cannot leave an authorized account with autopay
        // silently off.
        const summary = await getAchMandateSummary(note.organizationId, note.id);
        if (summary.armed && note.autoPayEnabled !== true) {
          await storage.updateNote(note.id, { autoPayEnabled: true }, note.organizationId);
        }

        logger.info("Borrower ACH mandate confirmed", {
          metadata: {
            noteId: note.id,
            mandateId: confirmed.mandate.id,
            alreadyActive: confirmed.alreadyActive,
            armed: summary.armed,
          },
        });

        res.json({
          success: true,
          alreadyActive: confirmed.alreadyActive,
          autopayEnabled: summary.armed || note.autoPayEnabled === true,
          mandate: summary,
        });
      } catch (err) {
        logger.error("Borrower ACH mandate confirm failed", err instanceof Error ? err : undefined);
        Errors.internal(res, err);
      }
    },
  );

  // Session-based autopay toggle — identity is proven by the session,
  // no need to repeat borrowerEmail on every request.
  //
  // ON  requires an armed mandate. Without one this refuses instead of writing
  //     a boolean that promises a collection nothing will perform.
  // OFF revokes every live mandate on the note (NACHA stop-on-request).
  api.post("/api/borrower/autopay", validateBorrowerSession, portalPaymentRateLimiter, async (req, res) => {
    try {
      const session = requireBorrowerSession(req);
      const { enabled } = req.body as { enabled?: unknown };
      const wantEnabled = enabled === true;

      const noteResults = await db.select().from(notes).where(eq(notes.id, session.noteId));
      if (noteResults.length === 0) return Errors.notFound(res, "loan");
      const note = noteResults[0];

      const mandate = await getAchMandateSummary(note.organizationId, note.id);

      if (wantEnabled && !mandate.armed) {
        const availability: AchAvailability = await resolveAchAvailability(note.organizationId);
        logger.info("Autopay enable refused — no armed ACH authorization", {
          metadata: { noteId: note.id, mandateStatus: mandate.status, achAvailable: availability.available },
        });
        return Errors.badRequest(
          res,
          mandate.status === "pending"
            ? "Your bank is still verifying that account. Autopay can't be switched on — and nothing is debited — until verification finishes."
            : availability.available
              ? "Autopay needs an authorized bank account first. Add one and we'll collect each payment automatically."
              : availability.message,
          {
            reason: "no_active_mandate",
            mandateStatus: mandate.status,
            achAvailable: availability.available,
          },
        );
      }

      await storage.updateNote(note.id, { autoPayEnabled: wantEnabled }, note.organizationId);

      // Turning autopay off withdraws the authorization too. A live mandate
      // behind an "off" switch is how an unauthorized debit happens later.
      let revokedMandates = 0;
      if (!wantEnabled) {
        revokedMandates = await revokeAchMandatesForNote({
          organizationId: note.organizationId,
          noteId: note.id,
          reason: "Borrower turned autopay off in the borrower portal.",
        });
      }

      const after = await getAchMandateSummary(note.organizationId, note.id);
      res.json({
        success: true,
        autopayEnabled: wantEnabled,
        nextPaymentDate: note.nextPaymentDate,
        mandate: after,
        revokedMandates,
        statusMessage: autopayStatusMessage({
          autopayEnabled: wantEnabled,
          mandateStatus: after.status,
          armed: after.armed,
          availability: { available: true },
        }),
      });
    } catch (err) {
      logger.error("Autopay toggle error (session)", err);
      Errors.internal(res, err);
    }
  });

  // Toggle autopay for borrower portal
  // SECURITY (2026-07 audit): this route was missing the sunset gate its two
  // siblings carry — the only token-only write path with no retirement date.
  api.post("/api/portal/:accessToken/autopay", sunsetMiddleware(), deprecatedPaymentRateLimiter, async (req, res) => {
    try {
      const { accessToken } = req.params;
      const { enabled, email } = req.body;
      
      if (!accessToken) {
        return Errors.badRequest(res, "Access token is required");
      }
      
      const note = await storage.getNoteByAccessToken(accessToken);
      if (!note) {
        return Errors.notFound(res, "loan");
      }
      
      // Verify borrower email for security
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (!borrower || borrower.email?.toLowerCase() !== email?.toLowerCase()) {
          return Errors.forbidden(res, "We couldn't verify your access to this loan — check the email address on your payment reminder.");
        }
      } else {
        return Errors.forbidden(res, "We couldn't verify your access to this loan — check the email address on your payment reminder.");
      }
      
      // Same honesty gate as the session route: ON needs a stored, active
      // authorization. This endpoint is sunset, but for as long as an env var
      // can extend its window it must not be a back door to a flag that
      // promises a collection nothing performs.
      const wantEnabled = enabled === true;
      const mandate = await getAchMandateSummary(note.organizationId, note.id);
      if (wantEnabled && !mandate.armed) {
        return Errors.badRequest(
          res,
          "Autopay needs an authorized bank account first. Sign in to the borrower portal to authorize one.",
          { reason: "no_active_mandate", mandateStatus: mandate.status },
        );
      }

      await storage.updateNote(note.id, {
        autoPayEnabled: wantEnabled,
      }, note.organizationId);

      let revokedMandates = 0;
      if (!wantEnabled) {
        revokedMandates = await revokeAchMandatesForNote({
          organizationId: note.organizationId,
          noteId: note.id,
          reason: "Borrower turned autopay off (legacy token endpoint).",
        });
      }

      res.json({
        success: true,
        autopayEnabled: wantEnabled,
        nextPaymentDate: note.nextPaymentDate,
        revokedMandates,
      });
    } catch (err) {
      logger.error("Autopay toggle error", err);
      Errors.internal(res, err);
    }
  });
  
  // Get payoff quote for borrower portal.
  // SECURITY (2026-07 audit): this endpoint discloses borrower name, balance,
  // and payoff totals authenticated only by token+email in the QUERY STRING —
  // it was the sole borrower PII surface with NO rate limiter, making the
  // weak factor brute-forceable. Same limiter as the other portal routes.
  api.get("/api/borrower/payoff-quote", portalPaymentRateLimiter, async (req, res) => {
    try {
      const { accessToken, email } = req.query;
      
      if (!accessToken || !email) {
        return Errors.badRequest(res, "Access token and email are required");
      }
      
      const note = await storage.getNoteByAccessToken(accessToken as string);
      if (!note) {
        return Errors.notFound(res, "loan");
      }
      
      // Verify borrower email
      let borrower: Lead | undefined;
      if (note.borrowerId) {
        borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (!borrower || borrower.email?.toLowerCase() !== (email as string).toLowerCase()) {
          return Errors.forbidden(res, "We couldn't verify your access to this loan — check the email address on your payment reminder.");
        }
      } else {
        return Errors.forbidden(res, "We couldn't verify your access to this loan — check the email address on your payment reminder.");
      }

      // Calculate payoff amount
      const currentBalance = Number(note.currentBalance || 0);
      const interestRate = Number(note.interestRate || 0);
      const dailyRate = interestRate / 100 / 365;
      
      // Calculate accrued interest since last payment
      const lastPaymentDate = note.nextPaymentDate 
        ? new Date(new Date(note.nextPaymentDate).getTime() - 30 * 24 * 60 * 60 * 1000) 
        : new Date(note.startDate);
      const daysSinceLastPayment = Math.max(0, Math.floor((Date.now() - lastPaymentDate.getTime()) / (24 * 60 * 60 * 1000)));
      const accruedInterest = Number((currentBalance * dailyRate * daysSinceLastPayment).toFixed(2));
      
      // Any applicable fees (e.g., payoff processing fee)
      const payoffFee = 0; // Can be configured per organization
      
      const totalPayoff = Number((currentBalance + accruedInterest + payoffFee).toFixed(2));
      
      // Expiration date: 30 days from now
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + 30);
      
      // Check if PDF format requested
      if (req.query.format === "pdf") {
        const PDFDocument = (await import("pdfkit")).default;
        const doc = new PDFDocument({ margin: 50 });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="payoff-quote-${note.id}.pdf"`);
        doc.pipe(res);

        doc.fontSize(20).text("Payoff Quote", { align: "center" });
        doc.moveDown();

        doc.fontSize(12);
        const borrowerLabel = borrower ? `${borrower.firstName} ${borrower.lastName}` : "N/A";
        doc.text(`Note ID: ${note.id}`);
        doc.text(`Borrower: ${borrowerLabel}`);
        doc.text(`Quote Date: ${new Date().toLocaleDateString()}`);
        doc.text(`Good Through: ${expirationDate.toLocaleDateString()}`);
        doc.moveDown();

        doc.fontSize(14).text("Payoff Amount Breakdown", { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(12);
        doc.text(`Remaining Principal:   $${currentBalance.toLocaleString()}`);
        doc.text(`Accrued Interest:      $${accruedInterest.toLocaleString()}`);
        doc.text(`Processing Fee:        $${payoffFee.toLocaleString()}`);
        doc.moveDown(0.5);
        doc.fontSize(16).text(`Total Payoff Amount:   $${totalPayoff.toLocaleString()}`, { bold: true } as any);
        doc.moveDown();

        doc.fontSize(10).fillColor("gray");
        doc.text("Payment Instructions:", { underline: true });
        doc.text("Please contact your lender for wire transfer or payment instructions.");
        doc.text("This quote is valid for 30 days from the quote date above.");
        doc.moveDown();
        doc.text(`Generated: ${new Date().toISOString()}`, { align: "center" });

        doc.end();
        return;
      }

      res.json({
        principalBalance: currentBalance,
        accruedInterest,
        payoffFee,
        totalPayoff,
        goodThroughDate: expirationDate.toISOString(),
        quoteDate: new Date().toISOString(),
        daysValid: 30,
      });
    } catch (err) {
      logger.error("Payoff quote error", err);
      Errors.internal(res, err);
    }
  });
  
  // Generate PDF statement for borrower portal
  api.get("/api/borrower/statements/generate", async (req, res) => {
    try {
      // F3.4 fix — no more accessToken/email in the URL. Two auth
      // paths accepted:
      //   (a) DB-backed borrower_session cookie set by /api/borrower/verify
      //       (the existing post-login flow that real borrowers use)
      //   (b) signed borrower_stmt_session cookie set by the new
      //       /api/borrower/auth/exchange endpoint (for email-link
      //       landing pages that don't go through full /verify first)
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      // Repeated headers arrive as string[] — accept only a single string.
      const headerToken = req.headers["x-borrower-session"];
      const dbSessionToken: string =
        (typeof req.cookies?.borrower_session === "string" ? req.cookies.borrower_session : "") ||
        (typeof headerToken === "string" ? headerToken : "");
      const stmtCookie: string =
        typeof req.cookies?.[STMT_COOKIE_NAME] === "string" ? req.cookies[STMT_COOKIE_NAME] : "";

      let noteIdFromSession: string | null = null;

      // Both paths run their full cryptographic/DB verification on whatever
      // the client sent (empty string verifies to invalid) — the token value
      // never short-circuits a check, it is only ever an input to one.
      if (dbSessionToken !== "") {
        const dbSession = await storage.getBorrowerSession(dbSessionToken);
        if (dbSession && new Date(dbSession.expiresAt) >= new Date()) {
          noteIdFromSession = String(dbSession.noteId);
        }
      }

      if (noteIdFromSession === null) {
        const verified = verifyBorrowerSession(stmtCookie, ip);
        if (verified.valid && verified.statementSetScope?.startsWith("note:")) {
          noteIdFromSession = verified.statementSetScope.slice("note:".length);
        }
      }

      if (!noteIdFromSession) {
        return Errors.unauthorized(res);
      }

      const parsedNoteId = Number(noteIdFromSession);
      if (!Number.isFinite(parsedNoteId) || parsedNoteId <= 0) {
        return Errors.unauthorized(res);
      }

      const { type, year, startDate, endDate } = req.query;

      const [note] = await db
        .select()
        .from(notes)
        .where(eq(notes.id, parsedNoteId));
      if (!note) {
        return Errors.notFound(res, "Loan");
      }

      // Borrower context for the statement payload (no email check —
      // already done at session-mint time).
      let borrower = null;
      if (note.borrowerId) {
        borrower = await storage.getLead(note.organizationId, note.borrowerId);
      }
      if (!borrower) {
        return Errors.notFound(res, "Borrower");
      }

      // Get payments for this note
      const allPayments = await storage.getPayments(note.organizationId, note.id);
      
      // Get organization info for company details
      const org = await storage.getOrganization(note.organizationId);
      
      // Filter payments by date range if provided
      let filteredPayments = allPayments.filter(p => p.status === 'completed');
      if (startDate) {
        const start = new Date(startDate as string);
        filteredPayments = filteredPayments.filter(p => new Date(p.paymentDate) >= start);
      }
      if (endDate) {
        const end = new Date(endDate as string);
        filteredPayments = filteredPayments.filter(p => new Date(p.paymentDate) <= end);
      }
      
      // Calculate totals
      const totalPaid = filteredPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const totalPrincipal = filteredPayments.reduce((sum, p) => sum + Number(p.principalAmount || 0), 0);
      const totalInterest = filteredPayments.reduce((sum, p) => sum + Number(p.interestAmount || 0), 0);
      
      // Generate statement data based on type
      const statementType = type === '1098' ? '1098' : 'statement';
      
      if (statementType === '1098') {
        // 1098 Interest Statement for tax year
        const taxYear = year ? Number(year) : new Date().getFullYear() - 1;
        const yearStart = new Date(taxYear, 0, 1);
        const yearEnd = new Date(taxYear, 11, 31, 23, 59, 59);
        
        const yearPayments = allPayments.filter(p => {
          const payDate = new Date(p.paymentDate);
          return p.status === 'completed' && payDate >= yearStart && payDate <= yearEnd;
        });
        
        const yearInterest = yearPayments.reduce((sum, p) => sum + Number(p.interestAmount || 0), 0);
        
        res.json({
          type: '1098',
          taxYear,
          borrowerName: `${borrower.firstName} ${borrower.lastName}`,
          borrowerAddress: borrower.address || '',
          borrowerCity: borrower.city || '',
          borrowerState: borrower.state || '',
          borrowerZip: borrower.zip || '',
          lenderName: org?.name || 'Lender',
          lenderAddress: org?.settings?.companyAddress || '',
          interestPaid: yearInterest,
          principalBalance: Number(note.currentBalance),
          originalPrincipal: Number(note.originalPrincipal),
          loanOriginationDate: note.startDate,
        });
      } else {
        // Regular account statement
        res.json({
          type: 'statement',
          generatedDate: new Date().toISOString(),
          borrowerName: `${borrower.firstName} ${borrower.lastName}`,
          borrowerAddress: borrower.address || '',
          borrowerEmail: borrower.email || '',
          lenderName: org?.name || 'Lender',
          lenderPhone: org?.settings?.companyPhone || '',
          lenderEmail: org?.settings?.companyEmail || '',
          noteId: note.id,
          originalPrincipal: Number(note.originalPrincipal),
          currentBalance: Number(note.currentBalance),
          interestRate: Number(note.interestRate),
          termMonths: note.termMonths,
          monthlyPayment: Number(note.monthlyPayment),
          startDate: note.startDate,
          maturityDate: note.maturityDate,
          nextPaymentDate: note.nextPaymentDate,
          nextPaymentAmount: Number(note.monthlyPayment),
          autopayEnabled: note.autoPayEnabled || false,
          payments: filteredPayments.map(p => ({
            date: p.paymentDate,
            amount: Number(p.amount),
            principal: Number(p.principalAmount),
            interest: Number(p.interestAmount),
            method: p.paymentMethod,
          })),
          summary: {
            totalPaid,
            totalPrincipal,
            totalInterest,
            paymentsCount: filteredPayments.length,
          },
        });
      }
    } catch (err) {
      logger.error("Statement generation error", err);
      Errors.internal(res, err);
    }
  });
  
  // ============================================
  // §1026.41 PERIODIC STATEMENTS (Session-authenticated)
  // --------------------------------------------
  // The persisted-row endpoints. The /generate endpoint above is the
  // legacy on-demand JSON shape (kept for back-compat); these new
  // endpoints serve the actual regulatory-compliant
  // periodic_statements rows + PDF download.
  //
  // Multi-tenant safety: every read joins on session.noteId AND
  // notes.organizationId AGAINST session.organizationId (re-asserted
  // by validateBorrowerSession). A borrower for note A can never read
  // statements for note B even if they guess a row's UUID.
  // ============================================

  // List the borrower's last 24 statements (§1026.41 cycles). Ordered
  // newest-cycle first. The portal page calls this on mount.
  api.get("/api/borrower/periodic-statements", validateBorrowerSession, async (req, res) => {
    try {
      const session = requireBorrowerSession(req);
      // Sessions minted before migration 0081 carry no org pin — require a
      // fresh /api/borrower/verify so the tenant re-assert below can hold.
      if (session.organizationId == null) {
        return Errors.unauthorized(res);
      }
      const { periodicStatements } = await import("@shared/schema/reg-z");
      const { desc: descOp } = await import("drizzle-orm");

      const rows = await db
        .select({
          id: periodicStatements.id,
          cycleStart: periodicStatements.cycleStart,
          cycleEnd: periodicStatements.cycleEnd,
          dueDate: periodicStatements.dueDate,
          amountDueCents: periodicStatements.amountDueCents,
          principalBalanceCents: periodicStatements.principalBalanceCents,
          generatedAt: periodicStatements.generatedAt,
          deliveryStatus: periodicStatements.deliveryStatus,
        })
        .from(periodicStatements)
        .where(
          and(
            eq(periodicStatements.loanId, String(session.noteId)),
            eq(periodicStatements.organizationId, session.organizationId),
          ),
        )
        .orderBy(descOp(periodicStatements.cycleStart))
        .limit(24);

      res.json({ statements: rows });
    } catch (err) {
      logger.error("Failed to list periodic statements", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  // Download one statement as PDF. The renderer re-builds the document
  // from the persisted snapshot — a borrower's re-download is always
  // identical to what was originally sent (§1026.41 evidentiary record).
  api.get(
    "/api/borrower/periodic-statements/:statementId/pdf",
    validateBorrowerSession,
    async (req, res) => {
      try {
        const session = requireBorrowerSession(req);
        // Same org-pin requirement as the list endpoint above.
        if (session.organizationId == null) {
          return Errors.unauthorized(res);
        }
        const { periodicStatements } = await import("@shared/schema/reg-z");
        const { renderPeriodicStatementPdf } = await import(
          "./services/periodicStatements/pdf"
        );

        const rows = await db
          .select()
          .from(periodicStatements)
          .where(
            and(
              eq(periodicStatements.id, req.params.statementId),
              eq(periodicStatements.loanId, String(session.noteId)),
              eq(periodicStatements.organizationId, session.organizationId),
            ),
          )
          .limit(1);

        if (rows.length === 0) {
          return Errors.notFound(res, "statement");
        }

        const statement = rows[0];
        const org = await storage.getOrganization(session.organizationId);
        let borrowerName: string | undefined;
        let borrowerAddress: string | undefined;
        const note = await db
          .select()
          .from(notes)
          .where(eq(notes.id, session.noteId))
          .limit(1);
        if (note[0]?.borrowerId) {
          const borrower = await storage.getLead(session.organizationId, note[0].borrowerId);
          if (borrower) {
            borrowerName = `${borrower.firstName ?? ""} ${borrower.lastName ?? ""}`.trim();
            borrowerAddress = [borrower.address, borrower.city, borrower.state, borrower.zip]
              .filter(Boolean)
              .join(", ");
          }
        }

        const doc = await renderPeriodicStatementPdf({
          statement,
          orgName: org?.name ?? "Lender",
          borrowerName,
          borrowerAddress,
          contactPhone: (org?.settings as { companyPhone?: string } | undefined)?.companyPhone,
          contactEmail: (org?.settings as { companyEmail?: string } | undefined)?.companyEmail,
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="statement-${statement.cycleStart}.pdf"`,
        );
        doc.pipe(res);
        doc.end();
      } catch (err) {
        logger.error(
          "Failed to render periodic statement PDF",
          err instanceof Error ? err : undefined,
        );
        Errors.internal(res, err);
      }
    },
  );

  // ============================================
  // BORROWER MESSAGING (Session-authenticated)
  // ============================================

  // GET /api/borrower/messages — list message thread for the authenticated borrower
  api.get("/api/borrower/messages", validateBorrowerSession, async (req, res) => {
    try {
      const session = requireBorrowerSession(req);
      const msgs = await storage.getBorrowerMessages(session.noteId);
      // Mark lender messages as read since borrower is viewing them
      await storage.markBorrowerMessagesRead(session.noteId, "lender");
      res.json(msgs);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // POST /api/borrower/messages — borrower sends a message
  api.post("/api/borrower/messages", validateBorrowerSession, async (req, res) => {
    try {
      const session = requireBorrowerSession(req);
      const { content } = req.body as { content: string };
      if (!content || !content.trim()) {
        return Errors.badRequest(res, "Message content is required");
      }
      // Sanitize content — strip HTML tags and limit length to prevent XSS
      const sanitized = content.trim()
        .replace(/<[^>]*>/g, '') // Strip all HTML tags
        .replace(/[<>]/g, '')   // Remove any remaining angle brackets
        .slice(0, 5000);        // Cap message length
      if (!sanitized) {
        return Errors.badRequest(res, "Message content is required");
      }
      // Look up org for the note
      const noteResults = await db.select().from(notes).where(eq(notes.id, session.noteId));
      if (noteResults.length === 0) {
        return Errors.notFound(res, "loan");
      }
      const note = noteResults[0];
      const msg = await storage.createBorrowerMessage({
        noteId: session.noteId,
        orgId: note.organizationId,
        senderType: "borrower",
        content: sanitized,
        readAt: null,
      });
      res.status(201).json(msg);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // Generate borrower portal link
  api.post("/api/notes/:id/portal-link", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = getOrganization(req);
      const noteId = Number(req.params.id);
      
      const note = await storage.getNote(org.id, noteId);
      if (!note) {
        return Errors.notFound(res, "note");
      }
      
      // Use the access token for the portal URL
      const portalUrl = `${req.protocol}://${req.get('host')}/portal/${note.accessToken}`;
      
      res.json({ url: portalUrl });
    } catch (err) {
      Errors.internal(res, err);
    }
  });


}
