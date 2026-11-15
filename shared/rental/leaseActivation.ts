/**
 * Lease activation — the transition that ends the draft-forever state (S-04).
 *
 * A lease created on /leases was born `draft` and nothing in the product
 * could ever move it: the PATCH and tenant-attach routes existed server-side
 * with no client caller, so UI-created leases sat in draft forever while the
 * operator believed rent charges, expiry alerts and the deposit lifecycle
 * were running on them. None were:
 *
 *   - rent-charge generation reads only GENERATABLE_LEASE_STATUSES leases;
 *   - the lease-expiry detector scans `active` leases only;
 *   - the security-deposit clock resolves its trigger from a lease whose
 *     lifecycle actually moves (ended/terminated, or a move-out inspection
 *     against a real tenancy).
 *
 * This module is the single, pure statement of the activation rule so the
 * server route, the rent-charge generator and the tests all read the same
 * words:
 *
 *   - activation is a transition OUT of `draft` / `pending_signature` INTO
 *     `active` — never a resurrection of an ended/terminated/renewed lease;
 *   - a lease with no tenant attached may not activate. The tenancy is the
 *     thing the charges and clocks run FOR; an active lease with nobody on
 *     it would generate rent owed by no one and a deposit clock for a
 *     deposit nobody paid. Attach a tenant first (POST
 *     /api/leases/:id/tenants), then activate.
 *
 * The federal lead-paint gate is NOT duplicated here: it needs the property
 * row, so it stays in the route (the same gate PATCH applies), evaluated
 * before this rule's result is acted on.
 *
 * Pure — no DB, no clock, no I/O — so the rule is testable without a
 * database, in the idiom of shared/rental/rentSchedule.ts.
 */

import type { LeaseStatus } from "../schema/rental";

/**
 * Leases whose rent should be on the ledger. The rent-charge generator
 * (server/services/rental/rentChargeGenerator.ts) reads this list — it
 * lives here so "activated ⇒ charges run" is one fact in one place, not
 * two lists that can drift apart.
 */
export const GENERATABLE_LEASE_STATUSES = ["active", "pending_signature"] as const;

/** The status an activation lands on. A member of GENERATABLE_LEASE_STATUSES. */
export const LEASE_ACTIVATION_TARGET = "active" as const satisfies LeaseStatus;

/** Statuses a lease may be activated FROM. Terminal/superseded states refuse. */
const LEASE_ACTIVATABLE_FROM_STATUSES = ["draft", "pending_signature"] as const;

export type LeaseActivationRefusalCode =
  | "LEASE_NOT_ACTIVATABLE_FROM_STATUS"
  | "LEASE_HAS_NO_TENANT";

export type LeaseActivationDecision =
  | { ok: true; fromStatus: LeaseStatus; toStatus: typeof LEASE_ACTIVATION_TARGET }
  | { ok: false; code: LeaseActivationRefusalCode; reason: string };

/**
 * Decide whether `lease` may activate, given how many tenants are attached.
 * `tenantCount` is the count of lease_tenants links for the lease in the
 * caller's org — the route supplies it; this function never reads it.
 */
export function evaluateLeaseActivation(args: {
  status: LeaseStatus | string;
  tenantCount: number;
}): LeaseActivationDecision {
  const { status, tenantCount } = args;
  if (!(LEASE_ACTIVATABLE_FROM_STATUSES as readonly string[]).includes(status)) {
    return {
      ok: false,
      code: "LEASE_NOT_ACTIVATABLE_FROM_STATUS",
      reason:
        status === LEASE_ACTIVATION_TARGET
          ? "This lease is already active — its rent charges and clocks are already running."
          : `A lease in status "${status}" cannot be activated. Only a draft or pending-signature lease can; ` +
            "an ended, terminated or renewed lease is a closed record, and a renewal is the way forward from one.",
    };
  }
  if (!Number.isFinite(tenantCount) || tenantCount < 1) {
    return {
      ok: false,
      code: "LEASE_HAS_NO_TENANT",
      reason:
        "Attach at least one tenant before activating. Rent charges are owed by the tenants on the lease, " +
        "and the security-deposit clock tracks a real tenancy — an active lease with no tenant would run both against nobody.",
    };
  }
  return { ok: true, fromStatus: status as LeaseStatus, toStatus: LEASE_ACTIVATION_TARGET };
}
