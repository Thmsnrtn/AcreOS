// ============================================================================
// shared/accountViews.ts — the response shapes of the three account endpoints
// every signed-in screen reads:
//
//   GET /api/auth/user     → AuthUserView       (server/auth/routes.ts)
//   GET /api/organization  → OrganizationView   (server/routes-organization.ts)
//   GET /api/team          → TeamMemberView[]   (server/routes-organization.ts)
//
// Each is an explicit ALLOWLIST of columns, never "the row minus some
// columns". A column added to `users`, `organizations` or `team_members`
// later is therefore absent from these responses until someone names it
// here — a new column is private by default. `tests/unit/accountViewDtos.test.ts`
// pins the exact served key set per endpoint and role, written out
// independently of the lists below, so widening a list goes red there.
//
// Every field below is read by a named client surface (listed beside it).
// To expose another column: add it here, name the surface that reads it, and
// add that reader to the test's expectations. Secret material, account-
// security state, billing-processor identifiers and internal scoring stay
// out; a surface that needs to know only whether such a value is set gets a
// derived boolean, not the value.
//
// ISOMORPHIC: imported by the server (to project) and the client (to type its
// queries), so a client read of a field that is not served is a type error.
// ============================================================================

import type { Organization, TeamMember } from "./schema";
import type { User } from "./models/auth";

/** The five team roles (mirrors `ROLES` in server/utils/permissions.ts). */
export type ViewerRole = "owner" | "admin" | "member" | "va" | "viewer";

// ─── GET /api/auth/user ─────────────────────────────────────────────────────

/**
 * Columns of `users` served to the signed-in user about themselves.
 *
 *   id                          App.tsx (Sentry/analytics identity), notification-center, pax, finance (attestation), team-chat-panel
 *   email                       App.tsx, dev-banner, email-settings-content, finance, welcome-back
 *   firstName / lastName        today, email-settings-content, finance, welcome-back
 *   persona                     App.tsx, use-persona, MobileBottomNav
 *   paxDisclosureAcknowledgedAt pax (first-interaction banner)
 */
const AUTH_USER_VIEW_FIELDS = [
  "id",
  "email",
  "firstName",
  "lastName",
  "persona",
  "paxDisclosureAcknowledgedAt",
] as const satisfies readonly (keyof User)[];

export type AuthUserViewField = (typeof AUTH_USER_VIEW_FIELDS)[number];

/** `isFounder` is derived (founder identity), never a column; present only when true. */
export type AuthUserView = Pick<User, AuthUserViewField> & { isFounder?: true };

export function toAuthUserView(user: User, isFounder: boolean): AuthUserView {
  const view = pick(user, AUTH_USER_VIEW_FIELDS) as AuthUserView;
  if (isFounder) view.isFounder = true;
  return view;
}

// ─── GET /api/organization ──────────────────────────────────────────────────

/**
 * Columns of `organizations` served to every member of the org. The same set
 * for every role: each field is rendered by a surface that every role reaches
 * (the Settings plan card renders tier, status and trial state to all roles).
 * Billing, tax identity, seats and credits are served by their own endpoints
 * (/api/stripe/*, /api/credits/balance, /api/organization/tax-identity, …),
 * which carry their own role checks — none of them is read from here.
 *
 *   id                  layout-sidebar + usePaxNeedsYou (realtime channel), use-sovereign-dashboard
 *   name                settings, onboarding-v2, AssignmentPanel
 *   subscriptionTier    settings, getting-started-checklist
 *   subscriptionStatus  settings (plan card)
 *   trialUsed           settings (plan card)
 *   isFounder           settings, low-balance-alert
 *   investorType        layout-sidebar, notes, getting-started-checklist
 *   onboardingCompleted onboarding state (e2e production audit reads it)
 *   onboardingData      layout-sidebar, properties, rent-roll, CmaPanel, finance-commissions, checklist
 *   settings            settings, dashboard-settings, feature-hints, AssignmentPanel, checklist
 */
const ORGANIZATION_VIEW_FIELDS = [
  "id",
  "name",
  "subscriptionTier",
  "subscriptionStatus",
  "trialUsed",
  "isFounder",
  "investorType",
  "onboardingCompleted",
  "onboardingData",
  "settings",
] as const satisfies readonly (keyof Organization)[];

export type OrganizationViewField = (typeof ORGANIZATION_VIEW_FIELDS)[number];
export type OrganizationView = Pick<Organization, OrganizationViewField>;

/**
 * Per-role allowlist. Identical today (see above); keyed by role so a field
 * that only owners/admins need is added to their entry rather than to all.
 */
const ORGANIZATION_VIEW_FIELDS_BY_ROLE: Record<ViewerRole, readonly OrganizationViewField[]> = {
  owner: ORGANIZATION_VIEW_FIELDS,
  admin: ORGANIZATION_VIEW_FIELDS,
  member: ORGANIZATION_VIEW_FIELDS,
  va: ORGANIZATION_VIEW_FIELDS,
  viewer: ORGANIZATION_VIEW_FIELDS,
};

export function toOrganizationView(org: Organization, role: ViewerRole): OrganizationView {
  return pick(org, ORGANIZATION_VIEW_FIELDS_BY_ROLE[role]) as OrganizationView;
}

// ─── GET /api/team ──────────────────────────────────────────────────────────

/**
 * Columns of `team_members` served in the roster.
 *
 *   id          settings (role editor), lead-assignment, tasks, team-chat-panel
 *   userId      leads, lead-detail-content, conversation-tray, settings, team-chat-panel
 *   displayName every roster consumer
 *   role        settings, lead-assignment
 *   isActive    lead-assignment
 *   email       settings, leads, lead-detail-content, lead-assignment, team-chat-panel
 *               (as a fallback label) — teammates' addresses only for the
 *               roles below; everyone always sees their own.
 */
const TEAM_MEMBER_VIEW_FIELDS = [
  "id",
  "userId",
  "displayName",
  "role",
  "isActive",
  "email",
] as const satisfies readonly (keyof TeamMember)[];

export type TeamMemberViewField = (typeof TEAM_MEMBER_VIEW_FIELDS)[number];
export type TeamMemberView = Pick<TeamMember, TeamMemberViewField>;

/** Roles that see teammates' email addresses in the roster. */
const ROLES_SEEING_TEAMMATE_EMAILS: readonly ViewerRole[] = ["owner", "admin", "member"];

/** Whether a role sees teammates' email addresses (the rule toTeamMemberView applies). */
export function teamViewerSeesEmails(role: ViewerRole): boolean {
  return ROLES_SEEING_TEAMMATE_EMAILS.includes(role);
}

export function toTeamMemberView(
  member: TeamMember,
  viewer: { userId: string; role: ViewerRole },
): TeamMemberView {
  const view = pick(member, TEAM_MEMBER_VIEW_FIELDS) as TeamMemberView;
  const isSelf = member.userId === viewer.userId;
  if (!isSelf && !teamViewerSeesEmails(viewer.role)) view.email = null;
  return view;
}

// ─── shared ─────────────────────────────────────────────────────────────────

function pick<T extends object, K extends keyof T>(row: T, fields: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const field of fields) {
    if (field in row) out[field] = row[field];
  }
  return out;
}
