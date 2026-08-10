/**
 * Dated obligations registry (master-handoff O1, generalizing audit F-18-1).
 *
 * WHY
 * ───
 * A solo operator's single biggest during-absence risk is a time-based failure
 * that nothing watches. vendorCredentialExpiry.ts caught one shape of it — a
 * sole-source vendor key lapsing on a known date — but the shape is general:
 * statute re-reviews fall due, licenses renew, drills age out. Same failure
 * (a KNOWN calendar date passes with nothing watching), same remedy (a static
 * registry + a pure countdown), so one registry now carries them all,
 * consumed by (a) the step-away readiness verdict, (b) the daily paging loop
 * in founderBriefing, and (c) the Controls-door "Obligations year view".
 *
 * STATIC, not a DB table — the same defense vendorCredentialExpiry carried:
 * a handful of rows; a table would be over-built. SEED ONLY KNOWN DATES:
 * every `due` must trace to a real provisioning fact or a recorded, dated
 * policy. An invented date is worse than none (refuse-not-fabricate).
 *
 * Deliberately NOT here: the DR restore-drill cadence. Its "due date" derives
 * from the last dr_drills row — a live-DB fact, not a static calendar fact —
 * so it stays a live check in stepAwayReadiness.
 *
 * When an obligation is discharged (key renewed, review done), update or
 * remove its row here in the same change — a stale row pages the founder
 * about work already finished.
 */
import { STATUTE_REGISTER } from "@shared/governance/statuteRegister";

export type ObligationKind =
  | "vendor_credential"
  | "license_review"
  | "governance_review"
  | "ops_drill"
  | "custom";

export interface DatedObligation {
  /** What lapses or falls due, named plainly (this is the line the founder reads). */
  what: string;
  /** ISO YYYY-MM-DD the obligation falls due. */
  due: string;
  /** Who acts on it (today always "founder" — a solo shop — but say so per row). */
  owner: string;
  kind: ObligationKind;
  /** What single product capability depends solely on this (vendor_credential rows). */
  soleSourceFor?: string;
  /**
   * vendor_credential rows only: the env var whose presence means the
   * credential is live. An UNSET key is already-degraded, not an impending
   * lapse, and is excluded from `imminentObligations` (would spam the verdict).
   */
  envVar?: string;
  /** vendor_credential rows only: the vendor name (drives the sole-source coverage gate). */
  vendor?: string;
  /** Days-before-due milestones that page; defaults to DEFAULT_PAGE_THRESHOLDS. */
  pageThresholds?: readonly number[];
  /** Context / renewal path — becomes the "fix" line on the readiness check. */
  note: string;
}

/** A vendor_credential row with its credential fields present (runtime-guarded). */
export interface VendorCredentialObligation extends DatedObligation {
  kind: "vendor_credential";
  vendor: string;
  envVar: string;
  soleSourceFor: string;
}

export function isVendorCredential(o: DatedObligation): o is VendorCredentialObligation {
  return (
    o.kind === "vendor_credential" &&
    typeof o.vendor === "string" &&
    typeof o.envVar === "string" &&
    typeof o.soleSourceFor === "string"
  );
}

const VENDOR_CREDENTIAL_OBLIGATIONS: readonly DatedObligation[] = [
  // Migrated verbatim from vendorCredentialExpiry.ts (audit F-18-1); that
  // module is now a thin adapter over this registry.
  {
    what: "ATTOM API key (ATTOM_API_KEY)",
    due: "2026-08-28",
    owner: "founder",
    kind: "vendor_credential",
    vendor: "ATTOM",
    envVar: "ATTOM_API_KEY",
    soleSourceFor: "residential comps + property valuation (server/services/residentialComps.ts)",
    note:
      "Provisioned 2026-07-29 on the API Free Trial (30 days); lapses ~2026-08-28 unless " +
      "converted to a paid plan. See docs/company/live-operation-keys.md. On lapse, residential " +
      "comps degrade to the honest-unkeyed path (no fabrication) but the capability is lost.",
  },
];

// Statute re-reviews are DERIVED from the register, not copied, so each due
// date lives in exactly one place. nextReviewDue is set there ONLY where a
// dated review exists (policy: reviewedAt + 365d — documented at the field).
const GOVERNANCE_REVIEW_OBLIGATIONS: readonly DatedObligation[] = STATUTE_REGISTER.filter(
  (e) => e.nextReviewDue,
).map((e) => ({
  what: `Statute review: ${e.id}`,
  due: e.nextReviewDue!,
  owner: "founder",
  kind: "governance_review" as const,
  note:
    `Annual re-review (reviewedAt ${e.reviewedAt} + 365d) of the ${e.reviewStatus} decision on ` +
    `${e.citation} — see shared/governance/statuteRegister.ts (${e.id}).`,
}));

export const DATED_OBLIGATIONS: readonly DatedObligation[] = [
  ...VENDOR_CREDENTIAL_OBLIGATIONS,
  ...GOVERNANCE_REVIEW_OBLIGATIONS,
];

export interface ObligationStatus extends DatedObligation {
  /** Whole days until due relative to the given `now` (negative = past due). */
  daysLeft: number;
}

/**
 * Pure: every registered obligation with days-until relative to `now`,
 * soonest first. `now` is injected so this is deterministic and unit-testable.
 */
export function obligationStatus(now: Date): ObligationStatus[] {
  const nowMs = now.getTime();
  return DATED_OBLIGATIONS.map((o) => {
    const dueAtMs = Date.parse(`${o.due}T23:59:59Z`);
    return { ...o, daysLeft: Math.floor((dueAtMs - nowMs) / 86_400_000) };
  }).sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * Obligations within `withinDays` of `now` (default 14) — the ones an
 * operator should act on before stepping away. A vendor_credential row whose
 * key is UNSET is excluded: it is already-degraded, not an impending lapse.
 * Rows without an envVar (reviews, drills) have no configuration gate.
 * `envLookup` is injected for testability; defaults to process.env.
 */
export function imminentObligations(
  now: Date,
  withinDays = 14,
  envLookup: (k: string) => string | undefined = (k) => process.env[k],
): ObligationStatus[] {
  return obligationStatus(now).filter(
    (o) => o.daysLeft <= withinDays && (o.envVar === undefined || !!envLookup(o.envVar)),
  );
}

/** Default page thresholds (days before due) for the daily monitor. */
export const DEFAULT_PAGE_THRESHOLDS = [14, 7, 2, 0] as const;

/** The milestones that page for a given obligation (per-row override or default). */
export function pageThresholdsFor(o: DatedObligation): readonly number[] {
  return o.pageThresholds ?? DEFAULT_PAGE_THRESHOLDS;
}
