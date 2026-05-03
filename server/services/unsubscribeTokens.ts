/**
 * unsubscribeTokens — opaque per-recipient tokens for one-click List-
 * Unsubscribe (RFC 8058).
 *
 * Eleonora deliverability foundation (Phase 1 §10 / Week 7-8).
 *
 * Tokens are 32-byte random hex strings with no embedded payload — the
 * server resolves them through the `unsubscribe_tokens` table at request
 * time. This avoids building a signed-token verifier (overkill for a
 * footer link) and lets the founder revoke tokens by deleting rows.
 *
 * Tokens are reused across sends to the same (email, org). The first
 * outbound message to a recipient mints the token; every subsequent
 * message reuses it. We do not expire tokens — RFC 8058 requires the
 * URL be valid for as long as the recipient might receive a message.
 */

import crypto from "node:crypto";
import { db } from "../db";
import { unsubscribeTokens } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "../utils/logger";

function mintTokenString(): string {
  return crypto.randomBytes(32).toString("hex");
}

export interface IssueOptions {
  email: string;
  organizationId?: number;
}

/**
 * Get-or-create a token for (email, org). Returns the existing unused
 * token if present so repeat sends reuse the same one — this is required
 * by RFC 8058 (the URL must remain stable).
 *
 * Email is normalized (trimmed + lowercased) on write to match the
 * normalization used by emailSuppressions.
 */
export async function issueToken(options: IssueOptions): Promise<string> {
  const email = options.email.trim().toLowerCase();
  if (!email) throw new Error("[unsubscribeTokens] email is required");

  // Look for an existing unused token for this (email, org).
  const where = options.organizationId != null
    ? and(
        eq(unsubscribeTokens.email, email),
        eq(unsubscribeTokens.organizationId, options.organizationId),
        isNull(unsubscribeTokens.usedAt),
      )
    : and(eq(unsubscribeTokens.email, email), isNull(unsubscribeTokens.usedAt));
  const existing = await db
    .select({ token: unsubscribeTokens.token })
    .from(unsubscribeTokens)
    .where(where)
    .limit(1);
  if (existing.length > 0) {
    return existing[0].token;
  }

  const token = mintTokenString();
  await db
    .insert(unsubscribeTokens)
    .values({
      token,
      email,
      organizationId: options.organizationId,
    })
    .onConflictDoNothing({ target: unsubscribeTokens.token });
  return token;
}

/**
 * Resolve a token to (email, org). Returns null if the token doesn't
 * exist. Caller is responsible for marking it `usedAt` after acting on
 * the unsubscribe — we don't do it here so resolving is read-only.
 */
export async function resolveToken(token: string): Promise<{
  email: string;
  organizationId: number | null;
  alreadyUsed: boolean;
} | null> {
  if (!token || token.length < 16) return null;
  try {
    const rows = await db
      .select()
      .from(unsubscribeTokens)
      .where(eq(unsubscribeTokens.token, token))
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      email: row.email,
      organizationId: row.organizationId ?? null,
      alreadyUsed: row.usedAt != null,
    };
  } catch (err) {
    logger.error(
      "[unsubscribeTokens] resolveToken failed",
      err instanceof Error ? err : undefined,
      { metadata: { token: token.slice(0, 8) + "…" } },
    );
    return null;
  }
}

export async function markTokenUsed(token: string): Promise<void> {
  await db
    .update(unsubscribeTokens)
    .set({ usedAt: new Date() })
    .where(eq(unsubscribeTokens.token, token));
}

/**
 * Build the full https URL the recipient sees in the List-Unsubscribe
 * header / footer link. Pulls the public host from APP_URL (already used
 * by emailService) so dev / staging / prod routing all work without extra
 * env vars.
 */
export function buildUnsubscribeUrl(token: string): string {
  const base = (process.env.APP_URL || "https://app.acreos.io").replace(/\/+$/, "");
  return `${base}/u/${token}`;
}
