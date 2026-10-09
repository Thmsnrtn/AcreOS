/**
 * Founder Service
 * Handles founder identification and access control
 *
 * Founders have unrestricted access to all features, bypassing tier/usage limits.
 * A user is treated as a founder if EITHER their email matches FOUNDER_EMAIL/FOUNDER_EMAILS
 * OR their Clerk user ID matches FOUNDER_USER_IDS. Both are env-driven, no DB seed.
 */

import { clock } from "../utils/clock";

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
 * Resolve the set of founder Clerk user IDs to target for direct delivery
 * (e.g. VAPID push to the founder's locked phone). Combines the env-configured
 * FOUNDER_USER_IDS with a DB lookup of users whose email matches a founder
 * email — so push reaches the founder even if only the email var is set.
 * Best-effort: a DB failure falls back to the env-only set rather than throwing,
 * because this runs on the alert-delivery hot path and must never block an alert.
 */
export async function getFounderUserIds(): Promise<string[]> {
  const ids = new Set<string>(FOUNDER_USER_IDS);
  try {
    const { db } = await import("../db");
    const { users } = await import("@shared/schema");
    const { inArray } = await import("drizzle-orm");
    if (FOUNDER_EMAILS.length > 0) {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.email, FOUNDER_EMAILS))
        .limit(10);
      for (const r of rows) {
        if (r.id) ids.add(r.id);
      }
    }
  } catch {
    /* env-only fallback */
  }
  return [...ids];
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
 * THE canonical resolver of the founder's own organisation — strict.
 *
 * Owner decision 2026-10-08: anything that belongs to AcreOS-the-company and
 * must land in a tenant table (first use: leads from AcreOS's own Meta lead
 * ads, the founder-only ad rail) lands in the FOUNDER's organisation, and the
 * write is REFUSED when that organisation cannot be named unambiguously. It
 * never guesses: no "org 1", no `DEFAULT_ORG_ID`, no "first membership row".
 *
 * The rule:
 *   1. founder identities = users whose email is a founder email
 *      (FOUNDER_EMAIL/FOUNDER_EMAILS) or whose id is in FOUNDER_USER_IDS —
 *      the same identity rule as `isFounderIdentity`;
 *   2. candidates = organisations OWNED by one of those identities
 *      (`organizations.owner_id`). Membership is NOT ownership: a founder
 *      invited into a customer's workspace (support, a demo) does not make
 *      that workspace the founder's;
 *   3. exactly one candidate → it. `FOUNDER_PRIMARY_ORG_ID`, when set, only
 *      SELECTS among the candidates — a pin naming an org the founder does not
 *      own is refused, so a stale or mistyped env var cannot route founder
 *      data into a customer's tenant;
 *   4. zero candidates, several without a pin, or a failed lookup → refusal.
 *
 * Each SQL predicate is re-checked in JS on the returned rows, so the
 * "customer orgs never receive this" property does not rest on one `where`.
 *
 * Not cached: callers on a write path ask per write, so an operator fixing
 * the configuration takes effect without a restart.
 */
export type FounderOrgResolution =
  | { ok: true; organizationId: number; via: "sole-owned" | "pinned" }
  | {
      ok: false;
      reason:
        | "no-founder-identity"
        | "no-founder-org"
        | "ambiguous"
        | "pin-not-founder-owned"
        | "lookup-failed";
      candidates: number[];
    };

export async function resolveFounderOrganization(): Promise<FounderOrgResolution> {
  try {
    const { db } = await import("../db");
    const { users, organizations } = await import("@shared/schema");
    const { inArray } = await import("drizzle-orm");

    const founderIds = new Set<string>(FOUNDER_USER_IDS);
    if (FOUNDER_EMAILS.length > 0) {
      const rows = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.email, FOUNDER_EMAILS));
      for (const r of rows) {
        if (r.id && isFounderEmail(r.email)) founderIds.add(r.id);
      }
    }
    if (founderIds.size === 0) return { ok: false, reason: "no-founder-identity", candidates: [] };

    const owned = await db
      .select({ id: organizations.id, ownerId: organizations.ownerId })
      .from(organizations)
      .where(inArray(organizations.ownerId, [...founderIds]));
    const candidates = [
      ...new Set(owned.filter((o) => founderIds.has(o.ownerId)).map((o) => o.id)),
    ].sort((a, b) => a - b);

    if (candidates.length === 0) return { ok: false, reason: "no-founder-org", candidates };

    const pinRaw = (process.env.FOUNDER_PRIMARY_ORG_ID || "").trim();
    if (pinRaw) {
      const pin = Number(pinRaw);
      if (Number.isInteger(pin) && candidates.includes(pin)) {
        return { ok: true, organizationId: pin, via: "pinned" };
      }
      return { ok: false, reason: "pin-not-founder-owned", candidates };
    }

    if (candidates.length > 1) return { ok: false, reason: "ambiguous", candidates };
    return { ok: true, organizationId: candidates[0], via: "sole-owned" };
  } catch {
    return { ok: false, reason: "lookup-failed", candidates: [] };
  }
}

/**
 * Resolve the founder's primary organization id. Used by services and
 * routes that need an `organizationId` for inserts but aren't run in the
 * context of a specific tenant (on-call alerts, founder-only collaboration /
 * agent lifecycle / trust events). Defers first to resolveFounderOrganization
 * (the strict canonical rule above); otherwise reads `FOUNDER_PRIMARY_ORG_ID` from env if
 * set; otherwise looks up the founder's org via users → teamMembers. Cached
 * after the first SUCCESSFUL resolution.
 *
 * NO HARD-CODED FALLBACK (2026-10-07). This used to resolve to org 1 when
 * neither source answered, "so callers never blow up on a NOT NULL
 * organization_id constraint". On any database where row 1 is a customer —
 * a fresh deploy, staging, a restore — that wrote the platform's system
 * alerts, agent events and on-call pages INTO A CUSTOMER'S WORKSPACE, where
 * that customer could read them. A row with nowhere legitimate to go is not
 * written; the caller is told (`FounderOrgUnresolvedError`), logs, and the
 * `acreos_founder_org_unresolved_total` counter moves.
 */
let _cachedFounderOrgId: number | null = null;
/** Until when a failed lookup is remembered (the env var is still read first). */
let _unresolvedUntil = 0;
const UNRESOLVED_CACHE_MS = 60_000;

/** No founder org could be resolved — neither FOUNDER_PRIMARY_ORG_ID nor a founder membership. */
class FounderOrgUnresolvedError extends Error {
  readonly code = "FOUNDER_ORG_UNRESOLVED";
  constructor() {
    super(
      "No founder organization is configured: set FOUNDER_PRIMARY_ORG_ID, or make a FOUNDER_EMAILS user a member of the founder's organization.",
    );
    this.name = "FounderOrgUnresolvedError";
  }
}

/**
 * The founder's primary org id, or `null` when none can be resolved. Never a
 * guess. Prefer this where "no founder org" has a sensible branch (skip and
 * report); use `getFounderPrimaryOrgId()` where it is an error.
 */
export async function resolveFounderPrimaryOrgId(): Promise<number | null> {
  if (_cachedFounderOrgId !== null) return _cachedFounderOrgId;

  // Inside the miss window the lookups are not repeated (the env var below is
  // still read, so setting it takes effect at once).
  const inMissWindow = clock.nowMs() < _unresolvedUntil;
  if (!inMissWindow) {
    const canonical = await resolveFounderOrganization();
    if (canonical.ok) {
      _cachedFounderOrgId = canonical.organizationId;
      return _cachedFounderOrgId;
    }
  }

  const fromEnv = process.env.FOUNDER_PRIMARY_ORG_ID;
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (Number.isInteger(parsed) && parsed > 0) {
      _cachedFounderOrgId = parsed;
      return parsed;
    }
  }

  // A miss is remembered briefly, so callers on hot paths do not re-query the
  // users/teamMembers lookup on every call while no founder org exists.
  if (inMissWindow) return null;

  try {
    const { db } = await import("../db");
    const { users, teamMembers } = await import("@shared/schema");
    const { inArray } = await import("drizzle-orm");
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
    /* unresolved — reported below */
  }

  _unresolvedUntil = clock.nowMs() + UNRESOLVED_CACHE_MS;
  void import("../metrics")
    .then((m) => m.recordFounderOrgUnresolved())
    .catch(() => {});
  return null;
}

/** As `resolveFounderPrimaryOrgId`, but throws `FounderOrgUnresolvedError` instead of answering null. */
export async function getFounderPrimaryOrgId(): Promise<number> {
  const id = await resolveFounderPrimaryOrgId();
  if (id === null) throw new FounderOrgUnresolvedError();
  return id;
}
