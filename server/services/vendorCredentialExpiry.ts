/**
 * Vendor credential expiry registry (audit F-18-1).
 *
 * WHY
 * ───
 * A solo operator's single biggest during-absence risk is a time-based failure
 * that nothing watches: a sole-source vendor API key that expires on a known
 * date, mid-absence, silently degrading the product. The known live example is
 * ATTOM — provisioned 2026-07-29 on the 30-day free trial, so it lapses on/
 * around 2026-08-28 (docs/company/live-operation-keys.md). Nothing monitored
 * that date. This is a small STATIC registry (not a DB table — that would be
 * over-built for a handful of keys) plus a pure query used by (a) the
 * step-away readiness verdict and (b) a paging hook, so an approaching lapse
 * shows up before the founder walks away and pages as it nears.
 *
 * When a key is renewed / converted to paid, update or remove its entry here.
 */

export interface VendorCredentialExpiry {
  /** Human vendor name. */
  vendor: string;
  /** The env var whose key expires. */
  envVar: string;
  /** ISO YYYY-MM-DD the credential lapses. */
  expiresOn: string;
  /** What single product capability depends solely on this key. */
  isSoleSourceFor: string;
  /** Context / renewal path. */
  note: string;
}

export const VENDOR_CREDENTIAL_EXPIRIES: readonly VendorCredentialExpiry[] = [
  {
    vendor: "ATTOM",
    envVar: "ATTOM_API_KEY",
    expiresOn: "2026-08-28",
    isSoleSourceFor: "residential comps + property valuation (server/services/residentialComps.ts)",
    note:
      "Provisioned 2026-07-29 on the API Free Trial (30 days); lapses ~2026-08-28 unless " +
      "converted to a paid plan. See docs/company/live-operation-keys.md. On lapse, residential " +
      "comps degrade to the honest-unkeyed path (no fabrication) but the capability is lost.",
  },
];

export interface CredentialExpiryStatus extends VendorCredentialExpiry {
  /** Whole days until expiry relative to the given `now` (negative = expired). */
  daysLeft: number;
}

/**
 * Pure: every registered expiry with days-until relative to `now`, soonest
 * first. `now` is injected so this is deterministic and unit-testable.
 */
export function credentialExpiryStatus(now: Date): CredentialExpiryStatus[] {
  const nowMs = now.getTime();
  return VENDOR_CREDENTIAL_EXPIRIES.map((v) => {
    const expiresAtMs = Date.parse(`${v.expiresOn}T23:59:59Z`);
    return { ...v, daysLeft: Math.floor((expiresAtMs - nowMs) / 86_400_000) };
  }).sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * Configured expiries within `withinDays` of `now` (default 14) — the ones an
 * operator should act on before stepping away. An UNSET key is excluded here:
 * it is already-degraded, not an impending lapse (and would spam the verdict).
 * `envLookup` is injected for testability; defaults to process.env.
 */
export function imminentCredentialExpiries(
  now: Date,
  withinDays = 14,
  envLookup: (k: string) => string | undefined = (k) => process.env[k],
): CredentialExpiryStatus[] {
  return credentialExpiryStatus(now).filter(
    (v) => v.daysLeft <= withinDays && !!envLookup(v.envVar),
  );
}

/** Page thresholds (days before expiry) for the daily monitor. */
export const EXPIRY_PAGE_THRESHOLDS = [14, 7, 2, 0] as const;
