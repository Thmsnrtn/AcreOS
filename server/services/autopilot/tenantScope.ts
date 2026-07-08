/**
 * TenantScope — the typed accountable scope of a governed action (Foundry move #2).
 *
 * KERNEL (domain-agnostic). Today AcreOS is a single tenant operating ITSELF:
 * the autopilot's outward actions (publish a guide, send a marketing touch) are
 * AcreOS's own, so historically they carried `orgId: null` — an OVERLOADED null
 * that meant "the platform self." That ambiguity is ruinous to retrofit once a
 * global ledger is populated: you can no longer tell "platform-self action" from
 * "unknown / unscoped action" after the fact.
 *
 * This replaces the overloaded null with an explicit discriminated union, so:
 *   • every gate / ledger / receipt records WHICH scope acted, unambiguously;
 *   • an outward action can never be "null by accident" — the type system forces
 *     a scope, and `assertOutwardScope` hard-errors on a malformed one (the
 *     doc's "orgId=null for an outward action = a hard error", adapted: a bare/
 *     corrupt scope is the error; `platform` is a legitimate, explicit scope).
 *
 * Single-tenant today; the SEAM is what's load-bearing. When the kernel later
 * acts on behalf of N principals, `org` scopes carry their orgId and the same
 * machinery distinguishes them from platform-self with zero schema retrofit.
 */

export type TenantScope =
  | { readonly kind: "platform" }
  | { readonly kind: "org"; readonly orgId: number };

/** The platform operating itself (AcreOS as its own single tenant). */
export const PLATFORM_SCOPE: TenantScope = Object.freeze({ kind: "platform" });

/** A specific customer organization. Validates a positive integer org id. */
export function orgScope(orgId: number): TenantScope {
  if (!Number.isInteger(orgId) || orgId <= 0) {
    throw new Error(`orgScope: orgId must be a positive integer, got ${String(orgId)}`);
  }
  return Object.freeze({ kind: "org", orgId });
}

export function isPlatformScope(scope: TenantScope): boolean {
  return scope.kind === "platform";
}

export function isOrgScope(scope: TenantScope): scope is { kind: "org"; orgId: number } {
  return scope.kind === "org";
}

/**
 * The org id for DB columns / per-org metering (the AI cost ceiling). Platform
 * scope maps to `null` — the historical column value, so existing rows + the
 * "platform-internal calls are unmetered" path are unchanged. The DIFFERENCE is
 * that callers now hold a typed scope, not a bare nullable number.
 */
export function scopeOrgId(scope: TenantScope): number | null {
  return scope.kind === "org" ? scope.orgId : null;
}

/** Stable, log-safe description, e.g. "platform" or "org:123". */
export function describeScope(scope: TenantScope): string {
  return scope.kind === "org" ? `org:${scope.orgId}` : "platform";
}

/**
 * Invariant guard for OUTWARD actions: the scope must be well-formed (platform,
 * or an org with a positive integer id). Throws a hard error otherwise — an
 * outward action with no/corrupt accountable scope is a programming error, never
 * a policy decision. `platform` is permitted (AcreOS operating itself); the
 * guard exists for the multi-tenant future where a scope could be constructed
 * from untrusted data.
 */
export function assertOutwardScope(scope: TenantScope | null | undefined, actionKind: string): void {
  if (scope == null || typeof scope !== "object") {
    throw new Error(`assertOutwardScope: outward action "${actionKind}" has no accountable scope`);
  }
  if (scope.kind === "platform") return;
  if (scope.kind === "org" && Number.isInteger(scope.orgId) && scope.orgId > 0) return;
  throw new Error(
    `assertOutwardScope: outward action "${actionKind}" has a malformed scope ${JSON.stringify(scope)}`,
  );
}
