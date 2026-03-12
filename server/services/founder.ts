/**
 * Founder Service
 * Handles founder identification and access control
 * 
 * Founders have unrestricted access to all features, bypassing tier/usage limits
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

/**
 * Check if an email belongs to a founder account
 */
export function isFounderEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return FOUNDER_EMAILS.includes(email.toLowerCase());
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
