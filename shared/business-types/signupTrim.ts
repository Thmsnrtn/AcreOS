/**
 * Signup trim (W1.4) — which investor types a NEW signup can pick.
 *
 * ── WHAT IT DECIDES ─────────────────────────────────────────────────────────
 * Onboarding used to offer all fifteen business types: three on the front page
 * and twelve behind "Show all investor types". With the trim ON (the default)
 * a new signup is offered exactly `land_flipper`, `note_investor` and `hybrid`;
 * the other twelve are a WAITLIST ("we'll tell you when <type> opens"), not a
 * choice. With the trim OFF the full picker is back, unchanged.
 *
 * This module is the one place that rule lives. The client picker and every
 * server route that writes a business type read it, so the two cannot drift
 * into a picker that is cosmetic (client trimmed, server still accepting any
 * of the fifteen) or a server that refuses what the screen still offers.
 *
 * ── WHAT IT DOES NOT TOUCH ──────────────────────────────────────────────────
 * - The registry (`shared/business-types.ts`) and its maturity labels. Those,
 *   and the public claims in `publicClaims.ts`, are founder decisions. All
 *   fifteen verticals still exist and still work for the orgs that have them.
 * - Existing orgs. The rule bites only an org created AFTER the trim shipped
 *   (a NEW signup), and even then an org may keep the type it already has. An
 *   org on `residential_wholesaler` that re-runs the wizard stays on it.
 *
 * ── WHO IS A "NEW SIGNUP" ───────────────────────────────────────────────────
 * Decided by the org's `created_at` against the trim flag row's `created_at`
 * (the row is seeded by the deploy that shipped the trim). Both are written by
 * the database and neither is reachable from a customer request, so nothing a
 * signup can do moves an org from "new" to "existing". In particular finishing
 * or SKIPPING onboarding does not: `onboardingCompleted` is set by
 * `POST /api/onboarding/skip` with no type check, so it cannot be the
 * predicate (audit of #499). If either timestamp is unknown the org is not
 * shown to predate the trim, except an org with no `created_at` at all, which
 * no current insert path can produce (the column defaults to now()).
 * - Founders. A founder (`req.isFounder`) sets any type, for any org.
 *
 * ── THE FLAG ────────────────────────────────────────────────────────────────
 * `onboarding.signup_trim` is an ordinary `platform_feature_flags` row,
 * toggled from /founder/features. It DEFAULTS ON: a missing row means ON, on
 * the server and on the client, because the trimmed behaviour is the default
 * and a deploy that has not yet seeded the row must not quietly serve the full
 * picker. Only the explicit state `off` restores today's behaviour. The states
 * `founder-only` / `beta` / `tier:*` cannot be resolved for an anonymous
 * config read, so the client already treats them as "not enabled"; the server
 * resolves them the same way (see `signupTrimFlagVerdict`) so both sides agree.
 */

import {
  isBusinessType,
  type BusinessType,
} from "../models/persona-mapping";

/** `platform_feature_flags.key` for the trim. */
export const SIGNUP_TRIM_FLAG_KEY = "onboarding.signup_trim";

/** The only types a new signup can pick while the trim is ON. */
export const SIGNUP_OPEN_BUSINESS_TYPES: readonly BusinessType[] = [
  "land_flipper",
  "hybrid",
  "note_investor",
];

function isSignupOpenBusinessType(value: string | null | undefined): value is BusinessType {
  return isBusinessType(value) && SIGNUP_OPEN_BUSINESS_TYPES.includes(value);
}

export function isSignupWaitlistBusinessType(value: string | null | undefined): value is BusinessType {
  return isBusinessType(value) && !SIGNUP_OPEN_BUSINESS_TYPES.includes(value);
}

/**
 * Is the trim ON, given the stored state of its flag row (or `null` for no row)?
 *
 * Only `on` and "no row" mean ON. `off` is OFF. Every other state is OFF too —
 * exactly what `resolveFlagEnabled` (client/src/hooks/use-feature-flags.ts)
 * answers for a controlled flag that is not in the enabled list. Keep the two
 * in step; tests/unit/signupTrimRule.test.ts ("client and server read the flag
 * the same way") compares them state by state.
 */
export function signupTrimFlagVerdict(state: string | null | undefined): boolean {
  return state == null || state === "on";
}

/** Where a waitlist capture lands in the founder's feedback inbox (`source` column). */
export function signupWaitlistSource(type: BusinessType): string {
  return `signup_waitlist:${type}`;
}

export interface SignupTrimInput {
  /** Is the trim ON? (`signupTrimFlagVerdict` of the flag row.) */
  flagOn: boolean;
  /** The business type the request would write. Absent = the request writes none. */
  requested: string | null | undefined;
  /** The type the org already stores (`onboardingData.businessType`), if any. */
  stored: string | null | undefined;
  /**
   * True when the org was created before the trim shipped — i.e. NOT a new
   * signup (see `orgPredatesSignupTrim`). Finishing or skipping onboarding
   * does not make this true.
   */
  orgPredatesTrim: boolean;
  /** A founder sets any type for any org. */
  isFounder: boolean;
}

export type SignupTrimDecision =
  | { allowed: true }
  | {
      allowed: false;
      requested: BusinessType;
      open: readonly BusinessType[];
    };

type Instant = Date | string | number | null | undefined;
function toMillis(v: Instant): number | null {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Was this org created before the trim shipped?
 *
 * `orgCreatedAt` is `organizations.created_at`; `trimShippedAt` is the
 * `created_at` of the `onboarding.signup_trim` flag row (null when there is no
 * row). Unknown trim date: no org is shown to predate it. Unknown org date:
 * treated as predating, because every insert gets `created_at = now()`.
 */
export function orgPredatesSignupTrim(orgCreatedAt: Instant, trimShippedAt: Instant): boolean {
  const shipped = toMillis(trimShippedAt);
  if (shipped == null) return false;
  const created = toMillis(orgCreatedAt);
  if (created == null) return orgCreatedAt == null;
  return created < shipped;
}

/**
 * May this request write this business type?
 *
 * Refused only when ALL of these hold: the trim is on; the caller is not a
 * founder; the org was created after the trim shipped; the requested value is a real
 * business type that is not open; and it is not the type the org already has.
 *
 * A value that is not a business type at all is NOT this module's to refuse —
 * each route already validates its own input (400/422), and answering "not
 * open yet" to garbage would be a second, misleading error for the same fault.
 */
export function decideSignupBusinessType(input: SignupTrimInput): SignupTrimDecision {
  const { flagOn, requested, stored, orgPredatesTrim, isFounder } = input;
  if (!flagOn || isFounder || orgPredatesTrim) return { allowed: true };
  if (!isBusinessType(requested)) return { allowed: true };
  if (isSignupOpenBusinessType(requested)) return { allowed: true };
  if (requested === stored) return { allowed: true };
  return { allowed: false, requested, open: SIGNUP_OPEN_BUSINESS_TYPES };
}
