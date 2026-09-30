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

/** The user's linked Clerk accounts for a mailbox provider (id + address). */
async function linkedAccounts(userId: string, provider: string): Promise<Array<{ id: string; emailAddress: string }>> {
  const strat = CLERK_STRATEGY[provider];
  if (!strat) return [];
  const user = await clerkClient.users.getUser(userId);
  return user.externalAccounts
    .filter((a) => (a.provider === strat || a.provider === `oauth_${strat}`) && Boolean(a.emailAddress))
    .map((a) => ({ id: a.id, emailAddress: a.emailAddress }));
}

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Which linked account to record for a new mailbox connection. With several
 * accounts of one provider linked, the caller must say which address —
 * picking "the first" is how a row could name one address and act as another
 * (quality directive 2026-09-29). Returns null when none matches.
 */
export async function getLinkedMailAccount(
  userId: string,
  provider: string,
  preferredEmail?: string,
): Promise<{ emailAddress: string } | { ambiguous: string[] } | null> {
  try {
    const accts = await linkedAccounts(userId, provider);
    if (preferredEmail) {
      const hit = accts.find((a) => sameAddress(a.emailAddress, preferredEmail));
      return hit ? { emailAddress: hit.emailAddress } : null;
    }
    if (accts.length === 0) return null;
    if (accts.length > 1) return { ambiguous: accts.map((a) => a.emailAddress) };
    return { emailAddress: accts[0].emailAddress };
  } catch (err) {
    logger.warn(`[mailbox] Clerk getUser failed for ${provider}`, err instanceof Error ? err : undefined);
    return null;
  }
}

/**
 * A fresh OAuth access token for EXACTLY this linked address, or null. The
 * token is matched to the Clerk external account whose address is the
 * mailbox row's — it used to be `list[0]`, the first token of any linked
 * account of that provider, so a row naming one address could read and send
 * as another. Read on-demand, never stored.
 */
export async function getMailboxAccessToken(
  userId: string,
  provider: string,
  emailAddress: string,
): Promise<string | null> {
  const tokenProvider = CLERK_TOKEN_PROVIDER[provider];
  if (!tokenProvider) return null;
  try {
    const acct = (await linkedAccounts(userId, provider)).find((a) => sameAddress(a.emailAddress, emailAddress));
    if (!acct) return null;
    const res = await clerkClient.users.getUserOauthAccessToken(userId, tokenProvider);
    // Clerk backend v2 returns a paginated { data: [...] } shape.
    const list = Array.isArray(res) ? res : (res?.data ?? []);
    return list.find((t) => t.externalAccountId === acct.id)?.token ?? null;
  } catch (err) {
    logger.warn(`[mailbox] Clerk token vend failed for ${provider}`, err instanceof Error ? err : undefined);
    return null;
  }
}
