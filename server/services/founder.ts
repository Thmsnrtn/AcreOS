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

/**
 * Resolve the founder's primary organization id. Used by services and
 * routes that need an `organizationId` for inserts but aren't run in the
 * context of a specific tenant (founder-only collaboration / agent
 * lifecycle / trust events). Reads `FOUNDER_PRIMARY_ORG_ID` from env if
 * set; otherwise looks up the founder's first owned org via
 * users → teamMembers. Cached after first resolution; resolves to 1
 * (the deployed founder org) as a last-resort fallback so callers never
 * blow up on a NOT NULL organization_id constraint.
 */
let _cachedFounderOrgId: number | null = null;

export async function getFounderPrimaryOrgId(): Promise<number> {
  if (_cachedFounderOrgId !== null) return _cachedFounderOrgId;

  const fromEnv = process.env.FOUNDER_PRIMARY_ORG_ID;
  if (fromEnv) {
    const parsed = parseInt(fromEnv, 10);
    if (Number.isFinite(parsed)) {
      _cachedFounderOrgId = parsed;
      return parsed;
    }
  }

  try {
    const { db } = await import("../db");
    const { users, teamMembers } = await import("@shared/schema");
    const { eq, inArray } = await import("drizzle-orm");
    const founderEmails = getFounderEmails();
    if (founderEmails.length > 0) {
      const founderUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.email, founderEmails))
        .limit(5);
      if (founderUsers.length > 0) {
        const userIds = founderUsers.map((u) => u.id);
        const memberships = await db
          .select({ organizationId: teamMembers.organizationId })
          .from(teamMembers)
          .where(inArray(teamMembers.userId, userIds))
          .limit(1);
        if (memberships[0]?.organizationId) {
          _cachedFounderOrgId = memberships[0].organizationId;
          return _cachedFounderOrgId;
        }
      }
    }
  } catch {
    /* fall through to sentinel */
  }

  // Last-resort fallback so a missing migration / fresh DB doesn't crash
  // an insert. Production has org id 1 as the founder workspace.
  _cachedFounderOrgId = 1;
  return 1;
}
