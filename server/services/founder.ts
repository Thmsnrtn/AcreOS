/**
 * Founder Service
 * Handles founder identification and access control
 *
 * Founders have unrestricted access to all features, bypassing tier/usage limits.
 * A user is treated as a founder if EITHER their email matches FOUNDER_EMAIL/FOUNDER_EMAILS
 * OR their Clerk user ID matches FOUNDER_USER_IDS. Both are env-driven, no DB seed.
 */

// Founder emails from environment variables only
// Set FOUNDER_EMAIL (single) and/or FOUNDER_EMAILS (comma-separated) in your .env
const PRIMARY_FOUNDER_EMAIL = (process.env.FOUNDER_EMAIL || "").trim().toLowerCase();

const ADDITIONAL_FOUNDER_EMAILS = (process.env.FOUNDER_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

// Combined list of all founder emails (deduped, empty strings excluded)
const FOUNDER_EMAILS = [
  ...new Set([PRIMARY_FOUNDER_EMAIL, ...ADDITIONAL_FOUNDER_EMAILS].filter(Boolean)),
];

// Founder Clerk user IDs (comma-separated). Identity-stable across email changes.
const FOUNDER_USER_IDS = new Set(
  (process.env.FOUNDER_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

/**
 * Get all founder emails (for services that need to send to founders)
 */
export function getFounderEmails(): string[] {
  return FOUNDER_EMAILS;
}

/**
 * Get primary founder email
 */
export function getPrimaryFounderEmail(): string | null {
  return PRIMARY_FOUNDER_EMAIL || FOUNDER_EMAILS[0] || null;
}

/**
 * Check if an email belongs to a founder account
 */
export function isFounderEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return FOUNDER_EMAILS.includes(email.toLowerCase());
}

/**
 * Check if a Clerk user ID belongs to a founder account.
 * Identity-stable across email changes; preferred for new authorization paths.
 */
export function isFounderUserId(userId: string | undefined | null): boolean {
  if (!userId) return false;
  return FOUNDER_USER_IDS.has(userId);
}

/**
 * Combined founder check: matches by email OR Clerk user ID. Use this in
 * middleware and authorization-decision sites instead of calling the two
 * sub-checks individually.
 */
export function isFounderIdentity(args: {
  email?: string | null;
  userId?: string | null;
}): boolean {
  return isFounderEmail(args.email) || isFounderUserId(args.userId);
}

/**
 * Check if a user ID belongs to a founder (requires lookup)
 * For use when you only have the user ID, not the email
 */
export async function isFounderById(userId: string, storage: any): Promise<boolean> {
  try {
    const user = await storage.getUser(userId);
    return isFounderEmail(user?.email);
  } catch {
    return false;
  }
}
