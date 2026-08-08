// ---------------------------------------------------------------------------
// Buy-and-hold landlord workflow-event emitters (audit Wave 1, beta→core).
//
// `emitRentalEvent` has lived in the workflow engine but had ZERO call sites, so
// the four landlord templates a customer installed
// (tpl_landlord_rent_received_receipt / tpl_landlord_maintenance_request_triage /
// tpl_landlord_lease_renewal_countdown / tpl_lease_expiring) sat idle forever —
// the whole landlord automation lane was dead. This module is the ONE seam the
// landlord lifecycle goes through to make `rent.received`,
// `maintenance.request_received`, `lease.renewal_countdown_60d` and
// `lease.expiring_60d` real, wired onto write-paths that already exist:
//   - a rent payment posted to the ledger        → rent.received
//     (routes-rent-ledger.ts POST /api/leases/:id/payments, alongside the
//      pre-existing payment.received emit — both fire for one payment, on purpose)
//   - a maintenance ticket created               → maintenance.request_received
//     (routes-maintenance-tickets.ts POST /api/maintenance-tickets)
//   - a lease ~60 days from its end date         → lease.renewal_countdown_60d
//                                                   AND lease.expiring_60d
//     (the new daily leaseExpiryDetector job)
//
// Sibling of certificateEvents.ts / wholesaleEvents.ts / rehabEvents.ts; same
// rules:
//   1. FIRE-AND-FORGET. A workflow failure must never fail a ledger/ticket write
//      or a detector scan. Every emitter swallows its own errors and never throws.
//   2. NO FABRICATION. The payload carries ONLY columns the rows genuinely hold
//      plus context resolved from real joins (the lease/ticket → property address,
//      the leaseTenants→tenants primary contact, the org name, a REAL YTD SUM of
//      the lease's payments this calendar year, the next OPEN charge's due date).
//      Every nullable field passes through as its real value or null, never a
//      fabricated 0/placeholder. A null tenant email suppresses the receipt /
//      acknowledgment recipient honestly (a landlord-logged ticket has NO tenant
//      email to acknowledge). The four templates were corrected in the same
//      change to drop the fields no row supplies — critically the market-rent /
//      suggested-renewal-rent placeholders, which would have meant touching the
//      residential-comps data plane, a STANDING HARD-STOP for buy_and_hold.
//
// entityType/entityId: every rental entity hangs off a real PROPERTY
// (rentalLeases.propertyId and maintenanceTickets.propertyId are both non-null
// FKs to properties.id), so emitRentalEvent uses entityType "property" and
// entityId is that properties.id. The uuid keys (leaseId, paymentId, ticketId)
// ride in `data`.
//
// When an emit call site is added, shared/workflow-live-triggers.ts must list the
// event in the SAME change — tests/unit/workflowActionHonesty.test.ts DERIVES the
// live set from these call sites and pins both directions.
// ---------------------------------------------------------------------------

import { and, asc, desc, eq, gt, gte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  leaseTenants,
  tenants,
  properties,
  organizations,
  rentCharges,
  rentPayments,
} from "@shared/schema";
import { emitRentalEvent } from "./workflow-engine";
import { logger } from "../utils/logger";

// ── Small pure helpers ──────────────────────────────────────────────────────

/** cents → dollars, or null when the column is genuinely absent (never a 0). */
const dollars = (cents: number | null | undefined): number | null =>
  cents == null ? null : Math.round(cents) / 100;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * A rent charge's `charged_for_month` (YYYY-MM-01) → a human month label
 * ("May 2026"), or null when there is no charge to label (an unapplied credit).
 * Deterministic — no locale, no wall-clock guess.
 */
function rentPeriodLabelFor(chargedForMonth: string | null | undefined): string | null {
  if (!chargedForMonth) return null;
  const m = /^(\d{4})-(\d{2})/.exec(String(chargedForMonth));
  if (!m) return null;
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return null;
  return `${MONTH_NAMES[idx]} ${m[1]}`;
}

// ── Resolvers (the real joins the payloads are built from) ───────────────────

/** The lease's primary tenant (leaseTenants.isPrimary), or null when unlinked. */
async function resolvePrimaryTenant(
  organizationId: number,
  leaseId: string,
): Promise<{ name: string; email: string | null } | null> {
  const [row] = await db
    .select({
      firstName: tenants.firstName,
      lastName: tenants.lastName,
      email: tenants.email,
    })
    .from(leaseTenants)
    .innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
    .where(and(eq(leaseTenants.leaseId, leaseId), eq(leaseTenants.organizationId, organizationId)))
    .orderBy(desc(leaseTenants.isPrimary))
    .limit(1);
  if (!row) return null;
  return { name: `${row.firstName} ${row.lastName}`.trim(), email: row.email ?? null };
}

/** A specific tenant (the ticket submitter), or null when none / not found. */
async function resolveTenantById(
  organizationId: number,
  tenantId: string,
): Promise<{ name: string; email: string | null } | null> {
  const [row] = await db
    .select({ firstName: tenants.firstName, lastName: tenants.lastName, email: tenants.email })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  return { name: `${row.firstName} ${row.lastName}`.trim(), email: row.email ?? null };
}

/** properties.address (genuinely nullable) or null. Never a fabricated street. */
async function resolvePropertyAddress(
  organizationId: number,
  propertyId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ address: properties.address })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
    .limit(1);
  return row?.address ?? null;
}

/** The org's display name, or null. Rides the receipt/renewal signature line. */
async function resolveOrgName(organizationId: number): Promise<string | null> {
  const [row] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.name ?? null;
}

/**
 * The three receipt extras that need a real read, never a guess:
 *   - ytdPaidCents  : SUM of this lease's rent payments in the calendar year of
 *                     the payment (a real ledger sum, 0 when nothing else posted).
 *   - nextDueDate   : the next OPEN charge (balance > 0) due AFTER this payment,
 *                     or null when there is none.
 *   - lateFeeApplied: whether the charge this payment landed on carries a real
 *                     late fee (rent_charges.late_fee_cents > 0); false when the
 *                     payment applied to no charge (nothing to be late against).
 */
async function resolveRentReceiptExtras(
  organizationId: number,
  leaseId: string,
  rentChargeId: string | null,
  receivedAt: string,
): Promise<{ ytdPaidCents: number; nextDueDate: string | null; lateFeeApplied: boolean }> {
  const year = String(receivedAt ?? new Date().toISOString().slice(0, 10)).slice(0, 4);
  const yearStart = `${year}-01-01`;

  const [ytdRow] = await db
    .select({ cents: sql<string>`COALESCE(SUM(${rentPayments.amountCents}), 0)` })
    .from(rentPayments)
    .where(
      and(
        eq(rentPayments.organizationId, organizationId),
        eq(rentPayments.leaseId, leaseId),
        gte(rentPayments.receivedAt, yearStart),
      ),
    );
  const ytdPaidCents = Number(ytdRow?.cents ?? 0) || 0;

  const [dueRow] = await db
    .select({ due: rentCharges.dueDate })
    .from(rentCharges)
    .where(
      and(
        eq(rentCharges.organizationId, organizationId),
        eq(rentCharges.leaseId, leaseId),
        gt(rentCharges.balanceCents, 0),
        gt(rentCharges.dueDate, receivedAt),
      ),
    )
    .orderBy(asc(rentCharges.dueDate))
    .limit(1);
  const nextDueDate = dueRow?.due ? String(dueRow.due).slice(0, 10) : null;

  let lateFeeApplied = false;
  if (rentChargeId) {
    const [chargeRow] = await db
      .select({ lateFee: rentCharges.lateFeeCents })
      .from(rentCharges)
      .where(and(eq(rentCharges.id, rentChargeId), eq(rentCharges.organizationId, organizationId)))
      .limit(1);
    lateFeeApplied = (Number(chargeRow?.lateFee ?? 0) || 0) > 0;
  }

  return { ytdPaidCents, nextDueDate, lateFeeApplied };
}

// ── Pure payload builders (the honesty-critical surface — real fields only) ──

export interface ResolvedRentReceived {
  leaseId: string;
  paymentId: string;
  amountCents: number;
  /** rent_charges.charged_for_month of the oldest charge touched, or null. */
  rentPeriodMonth: string | null;
  tenant: { name: string; email: string | null } | null;
  propertyAddress: string | null;
  orgName: string | null;
  ytdPaidCents: number;
  nextDueDate: string | null;
  lateFeeApplied: boolean;
}

/**
 * rent.received payload. Drives tpl_landlord_rent_received_receipt AND the
 * cross-vertical tpl_mobile_home_lot_rent_receipt — every placeholder both
 * interpolate is bound here to a real field or null.
 */
function buildRentReceivedPayload(ctx: ResolvedRentReceived): Record<string, any> {
  return {
    leaseId: ctx.leaseId,
    paymentId: ctx.paymentId,
    rentAmount: dollars(ctx.amountCents),
    rentPeriodLabel: rentPeriodLabelFor(ctx.rentPeriodMonth),
    tenantName: ctx.tenant?.name ?? null,
    // Null suppresses the receipt recipient honestly — no fabricated address.
    tenantEmail: ctx.tenant?.email ?? null,
    propertyAddress: ctx.propertyAddress,
    ytdPaid: dollars(ctx.ytdPaidCents),
    nextDueDate: ctx.nextDueDate,
    // A real boolean for workflow CONDITIONS — no longer interpolated as text.
    lateFeeApplied: ctx.lateFeeApplied,
    orgName: ctx.orgName,
  };
}

export interface MaintenanceTicketRow {
  id: string;
  organizationId: number;
  propertyId: number;
  submittedByTenantId: string | null;
  title: string;
  description: string | null;
  category: string | null;
  severity: string;
}

export interface ResolvedMaintenanceContext {
  tenant: { name: string; email: string | null } | null;
  propertyAddress: string | null;
  orgName: string | null;
}

/**
 * maintenance.request_received payload. urgencyLevel binds the REAL
 * maintenance_tickets.severity enum (not an invented rationale). The dropped
 * fabrications (urgencyRationale / suggestedVendor / estimatedCost /
 * responseTimeSla) are simply never added.
 */
function buildMaintenanceRequestPayload(
  ticket: MaintenanceTicketRow,
  ctx: ResolvedMaintenanceContext,
): Record<string, any> {
  return {
    ticketId: ticket.id,
    propertyAddress: ctx.propertyAddress,
    requestCategory: ticket.category ?? null,
    urgencyLevel: ticket.severity,
    // The fuller report text if present, else the required title.
    requestDescription: ticket.description ?? ticket.title,
    tenantName: ctx.tenant?.name ?? null,
    // Null when the landlord logged the ticket → the tenant-acknowledgment email
    // has no recipient and is suppressed. Never a fabricated address.
    tenantEmail: ctx.tenant?.email ?? null,
    orgName: ctx.orgName,
  };
}

export interface ResolvedLeaseContext {
  organizationId: number;
  propertyId: number;
  leaseId: string;
  /** rentalLeases.endDate — non-null for a qualifying lease (never m2m). */
  endDate: string | null;
  monthlyRentCents: number;
  state: string;
  tenant: { name: string; email: string | null } | null;
  propertyAddress: string | null;
  orgName: string | null;
}

/**
 * The lease payload shared by lease.renewal_countdown_60d and
 * lease.expiring_60d. Drives tpl_landlord_lease_renewal_countdown, the
 * cross-vertical tpl_multifamily_unit_turn, and tpl_lease_expiring — none of
 * which now interpolate a market/suggested rent (residential-comps hard-stop).
 */
function buildLeasePayload(ctx: ResolvedLeaseContext): Record<string, any> {
  return {
    leaseId: ctx.leaseId,
    propertyAddress: ctx.propertyAddress,
    tenantName: ctx.tenant?.name ?? null,
    tenantEmail: ctx.tenant?.email ?? null,
    leaseEndDate: ctx.endDate,
    currentRent: dollars(ctx.monthlyRentCents),
    state: ctx.state,
    orgName: ctx.orgName,
  };
}

// ── Emitters ─────────────────────────────────────────────────────────────────

export interface RentReceivedInput {
  organizationId: number;
  leaseId: string;
  paymentId: string;
  /** rentalLeases.propertyId — the numeric entity handle (properties.id). */
  propertyId: number;
  amountCents: number;
  /** rent_payments.received_at (YYYY-MM-DD). */
  receivedAt: string;
  /** The oldest charge the payment touched (rent_payments.rentChargeId), or null. */
  rentChargeId: string | null;
  /** That charge's charged_for_month (YYYY-MM-DD), or null for an unapplied credit. */
  rentPeriodMonth: string | null;
}

/**
 * Emit rent.received for a payment ALREADY committed to the ledger. Fires a
 * SECOND event alongside the pre-existing payment.received emit — one payment,
 * two events, on purpose: payment.received drives the generic money lane, this
 * drives the landlord receipt lane. Fire-and-forget: resolves off the request
 * path and never throws back into the response.
 */
export function emitRentReceived(input: RentReceivedInput): void {
  void (async () => {
    const [tenant, propertyAddress, orgName, extras] = await Promise.all([
      resolvePrimaryTenant(input.organizationId, input.leaseId),
      resolvePropertyAddress(input.organizationId, input.propertyId),
      resolveOrgName(input.organizationId),
      resolveRentReceiptExtras(input.organizationId, input.leaseId, input.rentChargeId, input.receivedAt),
    ]);
    emitRentalEvent(
      "rent.received",
      input.organizationId,
      input.propertyId,
      buildRentReceivedPayload({
        leaseId: input.leaseId,
        paymentId: input.paymentId,
        amountCents: input.amountCents,
        rentPeriodMonth: input.rentPeriodMonth,
        tenant,
        propertyAddress,
        orgName,
        ytdPaidCents: extras.ytdPaidCents,
        nextDueDate: extras.nextDueDate,
        lateFeeApplied: extras.lateFeeApplied,
      }),
    );
  })().catch((err) => {
    logger.warn(`[rentalEvents] emit rent.received failed for payment ${input.paymentId}`, {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  });
}

/**
 * Emit maintenance.request_received for a ticket just created. Fire-and-forget:
 * resolves the property/tenant/org context off the request path and never throws.
 */
export function emitMaintenanceRequestReceived(ticket: MaintenanceTicketRow): void {
  void (async () => {
    const [tenant, propertyAddress, orgName] = await Promise.all([
      ticket.submittedByTenantId
        ? resolveTenantById(ticket.organizationId, ticket.submittedByTenantId)
        : Promise.resolve(null),
      resolvePropertyAddress(ticket.organizationId, ticket.propertyId),
      resolveOrgName(ticket.organizationId),
    ]);
    emitRentalEvent(
      "maintenance.request_received",
      ticket.organizationId,
      ticket.propertyId,
      buildMaintenanceRequestPayload(ticket, { tenant, propertyAddress, orgName }),
    );
  })().catch((err) => {
    logger.warn(`[rentalEvents] emit maintenance.request_received failed for ticket ${ticket.id}`, {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  });
}

/**
 * Emit BOTH lease events (lease.renewal_countdown_60d AND lease.expiring_60d)
 * for a lease that has reached its ~60-day window. Pure + synchronous: the
 * caller (leaseExpiryDetector) resolves the context and owns the once-per
 * (lease, endDate) dedupe. Never throws.
 */
export function emitLeaseExpiryEvents(ctx: ResolvedLeaseContext): void {
  try {
    const payload = buildLeasePayload(ctx);
    emitRentalEvent("lease.renewal_countdown_60d", ctx.organizationId, ctx.propertyId, payload);
    emitRentalEvent("lease.expiring_60d", ctx.organizationId, ctx.propertyId, payload);
  } catch (err) {
    logger.warn(`[rentalEvents] emit lease expiry events failed for lease ${ctx.leaseId}`, {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

/** Row shape the detector resolves lease context from (real columns only). */
export interface ExpiringLeaseRow {
  id: string;
  organizationId: number;
  propertyId: number;
  endDate: string | null;
  monthlyRentCents: number;
  state: string;
}

/**
 * Resolve the full lease context (primary tenant, property address, org name)
 * for a scanned lease row. Used by the detector before emitLeaseExpiryEvents.
 */
export async function resolveLeaseContext(row: ExpiringLeaseRow): Promise<ResolvedLeaseContext> {
  const [tenant, propertyAddress, orgName] = await Promise.all([
    resolvePrimaryTenant(row.organizationId, row.id),
    resolvePropertyAddress(row.organizationId, row.propertyId),
    resolveOrgName(row.organizationId),
  ]);
  return {
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    leaseId: row.id,
    endDate: row.endDate,
    monthlyRentCents: row.monthlyRentCents,
    state: row.state,
    tenant,
    propertyAddress,
    orgName,
  };
}
