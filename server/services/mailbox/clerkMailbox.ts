/**
 * Clerk-backed mailbox tokens — R1c native inbox (Clerk rewire, 2026-07-15).
 *
 * Clerk owns login + OAuth, so the native inbox rides Clerk's OAuth token
 * vending instead of a standalone Google/Microsoft app. The customer links
 * their Google/Microsoft account (with mail scopes) through Clerk; AcreOS
 * NEVER stores the tokens — it reads a fresh one from Clerk on-demand
 * (Clerk manages refresh). This is the reshape's minimal-custody posture at
 * its floor: zero credential custody on our side, and one fewer platform key
 * (no GOOGLE_CLIENT_ID in AcreOS env).
 *
 * SECURITY: the token returned here is used only to make the upstream
 * Gmail/Graph call. Never log, serialize, or persist it.
 */

import { createClerkClient } from "@clerk/express";
import { logger } from "../../utils/logger";

const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

/** Our mailbox provider → the Clerk OAuth strategy (bare, for account match). */
const CLERK_STRATEGY: Record<string, string> = {
  gmail: "google",
  outlook: "microsoft",
};

/**
 * The token-vending API types the provider as the `oauth_`-prefixed literal
 * union (OAuthProvider), so keep a typed map for that call specifically.
 */
const CLERK_TOKEN_PROVIDER: Record<string, "oauth_google" | "oauth_microsoft"> = {
  gmail: "oauth_google",
  outlook: "oauth_microsoft",
};

export function clerkStrategyFor(provider: string): string | null {
  return CLERK_STRATEGY[provider] ?? null;
}

/**
 * Find the user's linked Clerk external account for a mailbox provider, or
 * null when they haven't connected that account (the client initiates the
 * link via Clerk's createExternalAccount). Returns the linked email too.
 */
export async function getLinkedMailAccount(
  userId: string,
  provider: string,
): Promise<{ emailAddress: string } | null> {
  const strat = CLERK_STRATEGY[provider];
  if (!strat) return null;
  try {
    const user = await clerkClient.users.getUser(userId);
    const acct = user.externalAccounts.find(
      (a) => a.provider === strat || a.provider === `oauth_${strat}`,
    );
    if (!acct?.emailAddress) return null;
    return { emailAddress: acct.emailAddress };
  } catch (err) {
    logger.warn(`[mailbox] Clerk getUser failed for ${provider}`, err instanceof Error ? err : undefined);
    return null;
  }
}

/**
 * A fresh OAuth access token for the user's linked mailbox, or null. Read
 * on-demand at the point of a Gmail/Graph call — never stored. (Used by the
 * on-demand read/send slices.)
 */
export async function getMailboxAccessToken(userId: string, provider: string): Promise<string | null> {
  const tokenProvider = CLERK_TOKEN_PROVIDER[provider];
  if (!tokenProvider) return null;
  try {
    const res = await clerkClient.users.getUserOauthAccessToken(userId, tokenProvider);
    // Clerk backend v2 returns a paginated { data: [...] } shape.
    const list = Array.isArray(res) ? res : (res?.data ?? []);
    return list[0]?.token ?? null;
  } catch (err) {
    logger.warn(`[mailbox] Clerk token vend failed for ${provider}`, err instanceof Error ? err : undefined);
    return null;
  }
}
