/**
 * Delegated-release rules — what must hold before (and again AT) the moment a
 * WitnessGrant, rather than a founder tap, releases a frozen action.
 *
 * The pure policy engine (witnessGrant.ts) decides whether a grant's bounds
 * cover a draft: domain, cost, hand, drafting role. These are the facts it
 * cannot see because they live in the database and the founder's controls:
 *
 *   1. CONTROLS — nothing is released while the env panic stop is engaged,
 *      dispatch is switched off, the hand's domain is paused, or the domain
 *      sits at OBSERVE (the panic stop's quarantine). A founder's "pause" or
 *      "stop" therefore reaches delegated sends, not only new dispatches.
 *   2. THE HAND'S DELEGATED RULES — the role tools' rules, re-read from the
 *      frozen args against live data:
 *        apply_refund — the hand's own eligibility (org-owned purchase,
 *          ≤ cost, never refunded before, inside or outside the autopilot);
 *        send_email   — the recipient is the OWNER of the organization the
 *          draft names (users.id = organizations.owner_id), and nobody else;
 *        reply_support_ticket — the hand resolves its recipient from the
 *          ticket row itself; nothing more to check here.
 *
 * autoWitness.ts runs both before it spends a grant slot; executeHandWitnessed
 * runs both again at execution for every delegated release, so a pause that
 * lands between the sweep and the send still wins.
 */
import { eq } from "drizzle-orm";
import { organizations } from "@shared/schema";
import { users } from "@shared/models/auth";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import type { AutopilotDomain } from "./policyGate";

/** The email of the user who owns `organizationId` (organizations.owner_id is users.id). */
export async function ownerEmailOf(organizationId: number): Promise<string | null> {
  const db = unscopedForPlatformOps("Delegated-release recipient rule: AcreOS system mail may only go to the owner of the org it names");
  const [org] = await db.select({ ownerId: organizations.ownerId }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return null;
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, org.ownerId)).limit(1);
  return u?.email ?? null;
}

/** Why the founder's controls forbid a delegated release in `domain` right now, or null. */
export async function delegationBlockedByControls(domain: AutopilotDomain): Promise<string | null> {
  const { isPanicStopped, getEffectiveSettings } = await import("./settings");
  if (isPanicStopped()) return "the panic stop is engaged";
  const settings = await getEffectiveSettings();
  if (!settings.dispatchEnabled) return "the autopilot's hands are switched off (dispatch disabled)";
  const { getControlState } = await import("./founderControls");
  const controls = await getControlState();
  if ((controls.pausedDomains as string[]).includes(domain)) return `the founder paused ${domain}`;
  const { getDomainLevel } = await import("./domainAutonomy");
  const level = await getDomainLevel(domain);
  if (level === "observe") return `${domain} is at OBSERVE (quarantined) — nothing is released on its behalf`;
  return null;
}

/** Why a hand's own delegated rules refuse this frozen action, or null. */
export async function delegatedHandRefusal(handName: string, args: Record<string, unknown>): Promise<string | null> {
  if (handName === "apply_refund") {
    const { refundEligibility } = await import("./hands/apply-refund");
    const e = await refundEligibility(args);
    return e.ok ? null : e.reason;
  }
  if (handName === "send_email") {
    const orgId = typeof args.organization_id === "number" ? args.organization_id : NaN;
    const to = typeof args.to === "string" ? args.to.trim().toLowerCase() : "";
    if (!Number.isFinite(orgId) || !to) return "a delegated email must name its organization and recipient";
    const owner = await ownerEmailOf(orgId);
    if (!owner) return `organization #${orgId} has no owner email on file`;
    if (owner.trim().toLowerCase() !== to) return `a delegated email may only go to the owner of organization #${orgId}, not ${to}`;
    return null;
  }
  if (handName === "reply_support_ticket") return null;
  // Every other hand is founder-tap only (witnessGrant.ts DELEGABLE_HANDS);
  // reaching here means the bounds check was bypassed — refuse.
  return `${handName} is never released by a grant`;
}
