/**
 * X-A slice 1 — the borrower portal-link lifecycle, in one place.
 *
 * Two consumers share this core, and that sharing is the point:
 *
 *   • POST /api/notes/:id/portal-link/refresh (routes-borrower.ts) — the
 *     lender-side manual rebind.
 *   • financeAgent's notice builder — every emailed reminder ensures the
 *     link it embeds is LIVE, rotating an expired token before it ships.
 *     Without this, migration 0229's legacy 90-day sunset would become a
 *     scheduled lockout: the expired screen says "ask your lender to send
 *     a fresh link", and the lender's own reminders would keep embedding
 *     the same dead token (fleet-6 verifier catch). Rotation-at-send makes
 *     that instruction true by construction — a re-sent notice is always a
 *     working link, and legacy (Math.random-minted) tokens age out of
 *     circulation as reminder cycles run.
 *
 * A rebind ROTATES (crypto-strong token), STAMPS the org's trust-tier TTL
 * (orgTrust.portalLinkTtlDays), and REVOKES every borrower session minted
 * from the old link — a rebind that left old sessions breathing would be
 * rotation theater.
 */
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { storage, db } from "../storage";
import { borrowerSessions } from "@shared/schema";
import { logger } from "../utils/logger";
import { resolveOrgTrustTier, resolveOrgTrustCaps } from "./orgTrust";

const DAY_MS = 24 * 60 * 60 * 1000;

export const PORTAL_LINK_EXPIRED_ERROR = "portal_link_expired";
export const PORTAL_LINK_EXPIRED_MESSAGE =
  "This portal link has expired. Ask your lender to send you a fresh link — your loan and payment history are unaffected.";

/**
 * The pure expiry gate. NULL means "no expiry recorded" and stays VALID
 * (migration-safe fail-open); an unparseable stored value never locks a
 * borrower out on bad data.
 */
export function portalLinkExpired(
  note: { accessTokenExpiresAt?: Date | string | null },
  now: Date = new Date(),
): boolean {
  const raw = note.accessTokenExpiresAt;
  if (raw == null) return false; // no expiry recorded — migration-safe fail-open
  const expiresAt = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(expiresAt.getTime())) return false; // unparseable — never lock out on bad data
  return expiresAt.getTime() < now.getTime();
}

/**
 * Rotate + re-expire the note's portal link and revoke sessions minted from
 * the old one. Returns null when the note doesn't exist in the org (the
 * caller decides how to surface that).
 */
export async function rebindPortalLink(
  orgId: number,
  noteId: number,
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  const note = await storage.getNote(orgId, noteId);
  if (!note) return null;

  const tier = await resolveOrgTrustTier(orgId);
  const ttlDays = resolveOrgTrustCaps(tier).portalLinkTtlDays;
  const accessToken = `note_${crypto.randomBytes(32).toString("hex")}`;
  const expiresAt = new Date(Date.now() + ttlDays * DAY_MS);

  await storage.updateNote(noteId, { accessToken, accessTokenExpiresAt: expiresAt }, orgId);
  // Rebind revokes: sessions minted from the OLD link die with it.
  await db.delete(borrowerSessions).where(eq(borrowerSessions.noteId, noteId));

  logger.info("Borrower portal link rebound", {
    organizationId: orgId,
    metadata: { noteId, ttlDays, trustTier: tier },
  });

  return { accessToken, expiresAt };
}

/**
 * Ensure the note's portal link is live before it gets embedded somewhere a
 * borrower will follow it. A note with no token, or a token still inside its
 * window, passes through untouched (no rotation churn); an EXPIRED token is
 * rebound and the refreshed fields are returned on a copy of the note.
 */
export async function ensureLivePortalLink<
  T extends {
    id: number;
    organizationId: number;
    accessToken: string | null;
    accessTokenExpiresAt?: Date | string | null;
  },
>(note: T): Promise<T> {
  if (!note.accessToken || !portalLinkExpired(note)) return note;
  const rebound = await rebindPortalLink(note.organizationId, note.id);
  if (!rebound) return note;
  return { ...note, accessToken: rebound.accessToken, accessTokenExpiresAt: rebound.expiresAt };
}
