/**
 * Founder Service
 * Handles founder identification and access control
 * 
 * Founders have unrestricted access to all features, bypassing tier/usage limits
 */

// Hardcoded founder email - always has founder access
const PRIMARY_FOUNDER_EMAIL = "thmsnrtn@gmail.com";

// Additional founder emails from environment variable
const ADDITIONAL_FOUNDER_EMAILS = (process.env.FOUNDER_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

// Combined list of all founder emails
const FOUNDER_EMAILS = [
  PRIMARY_FOUNDER_EMAIL.toLowerCase(),
  ...ADDITIONAL_FOUNDER_EMAILS
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
