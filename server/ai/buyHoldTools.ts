/**
 * Pax buy-and-hold tool family (promised bar item (c) for buy_and_hold).
 *
 * The reads and the two record changes go through the SAME service layer the
 * REST routes use: the rent ledger reads in routes-rent-ledger.ts read the
 * same tables shaped here, `recordRentPayment`
 * (services/rental/paymentPosting.ts) is the one payment writer, and
 * `generateScheduledCharges` (services/rental/rentChargeGenerator.ts) is the
 * one scheduled-charge writer. The organization always comes from the
 * session (`orgId`), never from a model-supplied argument.
 *
 * Tenant PII discipline: tenant identity/contact is exposed ONLY by
 * `paxGetTenants`, whose intent scope is `tenant_pii_read` — a PII scope, so
 * the chokepoint in tools.ts refuses even an unidentified caller who lacks
 * it. Even that tool never returns date of birth, government-id fragments or
 * screening fields. Every other tool in this family is shaped WITHOUT tenant
 * names, emails or phones (leases and the rent roll carry unit labels and
 * amounts, not people).
 *
 * FD5: there is NO tenant-facing send tool here — no notice, reminder or
 * message of any kind. Pax records and reads; a send to a tenant stays on
 * the operator's own surfaces behind a human tap.
 *
 * Money fence: `paxRecordRentPayment` is a LEDGER entry of money the
 * landlord already received on their own rails (their own Stripe Standard
 * account or outside AcreOS). It charges nothing, moves nothing, and holds
 * nothing — the same posture as paymentPosting.ts itself.
 *
 * Cross-book honesty (RW-D): every read states its coverage — the rent roll
 * covers only units, leases and charges entered or imported into THIS
 * account; a landlord with units managed elsewhere will not see them here.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import {
  decisionSnapshots,
  properties,
  rentCharges,
  rentPaymentAllocations,
  rentPayments,
  rentalLeases,
  rentalUnits,
  tenants,
} from "@shared/schema";
import { toolRefusal, type RefusalParts } from "@shared/refusal/plainRefusal";
import { clock } from "../utils/clock";

export type BuyHoldToolOutcome =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; refusal: RefusalParts };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_CAP = 100;

const RENT_BOOK_NOT_COVERED =
  "It covers only the units, leases and charges entered or imported into THIS account — " +
  "it does not include properties or tenants managed in another system, or any other account's rentals.";

function coverage(what: string): string {
  return `Coverage: ${what} ${RENT_BOOK_NOT_COVERED}`;
}

const noLease = (): BuyHoldToolOutcome => ({
  ok: false,
  refusal: {
    what: "No lease with that id is in this account",
    why: "It may have been removed, or the id came from another list",
    unlock: "Ask me to list your leases and pick the one you mean",
  },
});

const badLeaseId = (): BuyHoldToolOutcome => ({
  ok: false,
  refusal: {
    what: "That is not a lease id",
    why: "Lease ids are long identifiers, not a unit label or an address",
    unlock: "Ask me to list your leases and use the id it shows",
  },
});

async function loadLease(orgId: number, leaseId: unknown) {
  if (typeof leaseId !== "string" || !UUID.test(leaseId.trim())) return "bad_id" as const;
  const { db } = await import("../db");
  const [row] = await db
    .select()
    .from(rentalLeases)
    .where(and(eq(rentalLeases.id, leaseId.trim()), eq(rentalLeases.organizationId, orgId)))
    .limit(1);
  return row ?? null;
}

function shapeLease(row: typeof rentalLeases.$inferSelect) {
  return {
    id: row.id,
    propertyId: row.propertyId,
    unitId: row.unitId ?? null,
    unitLabel: row.unitLabel ?? null,
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate ?? null,
    monthlyRentCents: row.monthlyRentCents,
    rentDueDayOfMonth: row.rentDueDayOfMonth,
    securityDepositCents: row.securityDepositCents,
    state: row.state,
  };
}

/**
 * The rent roll: occupancy over rental_units (a never-leased unit counts as
 * vacant — the same denominator rule as GET /api/rent-roll/occupancy), plus
 * one line per unit with its active lease and open balance. No tenant PII.
 */
export async function paxGetRentRoll(orgId: number): Promise<BuyHoldToolOutcome> {
  const { db } = await import("../db");
  const units = await db
    .select()
    .from(rentalUnits)
    .where(eq(rentalUnits.organizationId, orgId))
    .orderBy(asc(rentalUnits.label));
  const leases = await db
    .select()
    .from(rentalLeases)
    .where(and(eq(rentalLeases.organizationId, orgId), eq(rentalLeases.status, "active")));
  const openCharges = await db
    .select()
    .from(rentCharges)
    .where(eq(rentCharges.organizationId, orgId));
  const props = await db
    .select()
    .from(properties)
    .where(eq(properties.organizationId, orgId));

  const addressByProperty = new Map(props.map((p) => [p.id, p.address ?? null]));
  const leaseByUnit = new Map<string, typeof rentalLeases.$inferSelect>();
  for (const l of leases) if (l.unitId) leaseByUnit.set(l.unitId, l);
  const balanceByLease = new Map<string, number>();
  const overdueByLease = new Map<string, number>();
  const today = clock.now().toISOString().slice(0, 10);
  for (const c of openCharges) {
    if (c.balanceCents > 0) {
      balanceByLease.set(c.leaseId, (balanceByLease.get(c.leaseId) ?? 0) + c.balanceCents);
      if (String(c.dueDate).slice(0, 10) < today) {
        overdueByLease.set(c.leaseId, (overdueByLease.get(c.leaseId) ?? 0) + c.balanceCents);
      }
    }
  }

  const rentable = units.filter((u) => u.status === "active");
  const lines = units.slice(0, LIST_CAP).map((u) => {
    const lease = (u.id ? leaseByUnit.get(u.id) : undefined) ?? null;
    return {
      unitId: u.id,
      propertyId: u.propertyId,
      propertyAddress: addressByProperty.get(u.propertyId) ?? null,
      label: u.label,
      kind: u.kind,
      status: u.status,
      marketRentCents: u.marketRentCents ?? null,
      occupied: lease !== null,
      leaseId: lease?.id ?? null,
      monthlyRentCents: lease?.monthlyRentCents ?? null,
      openBalanceCents: lease ? (balanceByLease.get(lease.id) ?? 0) : 0,
      overdueCents: lease ? (overdueByLease.get(lease.id) ?? 0) : 0,
    };
  });
  const occupied = rentable.filter((u) => leaseByUnit.has(u.id)).length;
  return {
    ok: true,
    data: {
      coverage: coverage(
        `this answer reads THIS account's rent roll only — ${units.length} unit${units.length === 1 ? "" : "s"} on record, ${lines.length} shown. ` +
          "An empty rent roll is reported as empty, never as fully paid or fully occupied.",
      ),
      asOf: today,
      occupancy: {
        rentableUnits: rentable.length,
        occupiedUnits: occupied,
        vacantUnits: rentable.length - occupied,
        offlineUnits: units.filter((u) => u.status === "offline").length,
        retiredUnits: units.filter((u) => u.status === "retired").length,
        occupancyPct: rentable.length === 0 ? null : Math.round((occupied / rentable.length) * 1000) / 10,
      },
      totalOpenBalanceCents: [...balanceByLease.values()].reduce((s, v) => s + v, 0),
      totalOverdueCents: [...overdueByLease.values()].reduce((s, v) => s + v, 0),
      units: lines,
    },
  };
}

export async function paxGetRentalLeases(
  orgId: number,
  args: { status?: string },
): Promise<BuyHoldToolOutcome> {
  const { db } = await import("../db");
  const conditions = [eq(rentalLeases.organizationId, orgId)];
  const status = typeof args.status === "string" ? args.status.trim() : "";
  if (status) conditions.push(eq(rentalLeases.status, status as (typeof rentalLeases.$inferSelect)["status"]));
  const rows = await db
    .select()
    .from(rentalLeases)
    .where(and(...conditions))
    .orderBy(desc(rentalLeases.startDate))
    .limit(LIST_CAP + 1);
  const shown = rows.slice(0, LIST_CAP);
  return {
    ok: true,
    data: {
      coverage: coverage(
        `this answer lists THIS account's leases only (${shown.length} shown${status ? `, status ${status}` : ", every status"}). ` +
          "Tenant names are not on this list — ask for the tenants list, which is permission-scoped to tenant records.",
      ),
      asOf: clock.now().toISOString().slice(0, 10),
      leases: shown.map(shapeLease),
      capped: rows.length > LIST_CAP,
    },
  };
}

/**
 * Tenants — the ONE PII-bearing tool in this family. Its intent scope is
 * `tenant_pii_read`, and even here the shaped record carries identity and
 * contact only: no date of birth, no government-id fragment, no screening
 * fields (credit score, eviction or criminal flags stay on the screening
 * surfaces, behind their own posture).
 */
export async function paxGetTenants(
  orgId: number,
  args: { status?: string },
): Promise<BuyHoldToolOutcome> {
  const { db } = await import("../db");
  const conditions = [eq(tenants.organizationId, orgId)];
  const status = typeof args.status === "string" ? args.status.trim() : "";
  if (status) conditions.push(eq(tenants.status, status as (typeof tenants.$inferSelect)["status"]));
  const rows = await db
    .select()
    .from(tenants)
    .where(and(...conditions))
    .orderBy(asc(tenants.lastName))
    .limit(LIST_CAP + 1);
  const shown = rows.slice(0, LIST_CAP);
  return {
    ok: true,
    data: {
      coverage: coverage(
        `this answer lists THIS account's tenant records only (${shown.length} shown${status ? `, status ${status}` : ", every status"}). ` +
          "It shows names and contact details as recorded; it never shows screening results, dates of birth or ID numbers.",
      ),
      asOf: clock.now().toISOString().slice(0, 10),
      tenants: shown.map((t) => ({
        id: t.id,
        displayName: t.isEntity ? (t.companyName ?? null) : [t.firstName, t.lastName].filter(Boolean).join(" ") || null,
        isEntity: t.isEntity,
        email: t.email ?? null,
        phone: t.phone ?? null,
        status: t.status,
        smsConsent: t.smsConsent,
      })),
      capped: rows.length > LIST_CAP,
    },
  };
}

/** One lease's ledger: charges, payments, allocations and late posture. */
export async function paxGetLeaseLedger(orgId: number, leaseId: unknown): Promise<BuyHoldToolOutcome> {
  const lease = await loadLease(orgId, leaseId);
  if (lease === "bad_id") return badLeaseId();
  if (!lease) return noLease();
  const { db } = await import("../db");
  const charges = await db
    .select()
    .from(rentCharges)
    .where(and(eq(rentCharges.leaseId, lease.id), eq(rentCharges.organizationId, orgId)))
    .orderBy(asc(rentCharges.chargedForMonth));
  const payments = await db
    .select()
    .from(rentPayments)
    .where(and(eq(rentPayments.leaseId, lease.id), eq(rentPayments.organizationId, orgId)))
    .orderBy(desc(rentPayments.receivedAt));
  const allocations = await db
    .select()
    .from(rentPaymentAllocations)
    .where(and(eq(rentPaymentAllocations.leaseId, lease.id), eq(rentPaymentAllocations.organizationId, orgId)))
    .orderBy(asc(rentPaymentAllocations.sequence));
  const today = clock.now().toISOString().slice(0, 10);
  const open = charges.filter((c) => c.balanceCents > 0);
  return {
    ok: true,
    data: {
      coverage: coverage(
        "this answer reads the ledger of ONE lease in THIS account — the charges, payments and allocations recorded here. " +
          "It shows what is recorded, not money that may have moved outside AcreOS and was never recorded.",
      ),
      asOf: today,
      lease: shapeLease(lease),
      totals: {
        chargedCents: charges.reduce((s, c) => s + c.amountCents + c.lateFeeCents, 0),
        paidCents: charges.reduce((s, c) => s + c.paidCents, 0),
        openBalanceCents: open.reduce((s, c) => s + c.balanceCents, 0),
        overdueCents: open
          .filter((c) => String(c.dueDate).slice(0, 10) < today)
          .reduce((s, c) => s + c.balanceCents, 0),
      },
      charges: charges.map((c) => ({
        id: c.id,
        chargedForMonth: c.chargedForMonth,
        dueDate: c.dueDate,
        chargeType: c.chargeType,
        amountCents: c.amountCents,
        lateFeeCents: c.lateFeeCents,
        paidCents: c.paidCents,
        balanceCents: c.balanceCents,
        legalPosture: c.legalPosture,
        legalPostureAt: c.legalPostureAt ?? null,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        amountCents: p.amountCents,
        receivedAt: p.receivedAt,
        method: p.method ?? null,
        payorType: p.payorType,
        isPartial: p.isPartial,
        allocatedCents: p.allocatedCents,
        unappliedCents: p.unappliedCents,
      })),
      allocations: allocations.map((a) => ({
        paymentId: a.paymentId,
        rentChargeId: a.rentChargeId,
        sequence: a.sequence,
        appliedCents: a.appliedCents,
        appliedToRentCents: a.appliedToRentCents,
        appliedToLateFeeCents: a.appliedToLateFeeCents,
        balanceAfterCents: a.balanceAfterCents,
      })),
    },
  };
}

/** The latest buy_and_hold underwriting decision recorded for a property. */
export async function paxGetRentalUnderwritingDecision(
  orgId: number,
  args: { property_id?: unknown },
): Promise<BuyHoldToolOutcome> {
  const propertyId = typeof args.property_id === "number" ? args.property_id : Number(args.property_id);
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    return {
      ok: false,
      refusal: {
        what: "That is not a property number",
        why: "Underwriting decisions are recorded against a property in this account, by its number",
        unlock: "Ask me for your properties and use the number shown there",
      },
    };
  }
  const { db } = await import("../db");
  const rows = await db
    .select()
    .from(decisionSnapshots)
    .where(
      and(
        eq(decisionSnapshots.organizationId, orgId),
        eq(decisionSnapshots.subjectType, "property"),
        eq(decisionSnapshots.subjectId, propertyId),
        eq(decisionSnapshots.strategyPackId, "buy_and_hold"),
      ),
    )
    .orderBy(desc(decisionSnapshots.decidedAt))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return {
      ok: true,
      data: {
        coverage: coverage(
          "this answer reads THIS account's recorded buy-and-hold underwriting decisions only.",
        ),
        propertyId,
        decision: null,
        statement:
          "No buy-and-hold underwriting decision is recorded for this property in this account. " +
          "Say exactly that — do not reconstruct one from the property's numbers.",
      },
    };
  }
  const scenario = (row.scenarios ?? []).find((s) => s.engineId === "rental_acquisition") ?? (row.scenarios ?? [])[0] ?? null;
  return {
    ok: true,
    data: {
      coverage: coverage(
        "this answer reads THIS account's recorded buy-and-hold underwriting decisions only — the decision as frozen when it was made, on the inputs the operator gave. " +
          "It is not a lender determination and carries no DSCR or screening claim.",
      ),
      propertyId,
      decision: {
        id: row.id,
        kind: row.kind,
        choice: row.choice,
        rationale: row.rationale,
        decidedAt: row.decidedAt,
        reviewDueAt: row.reviewDueAt ?? null,
        scenario: scenario
          ? {
              engineId: scenario.engineId,
              engineVersion: scenario.engineVersion,
              label: scenario.label,
              predicted: scenario.predicted,
            }
          : null,
      },
    },
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Record a rent payment the landlord ALREADY received — a ledger entry via
 * the one writer (paymentPosting.recordRentPayment, inside a transaction,
 * with the route's post-commit workflow emits). Never charges anything.
 */
export async function paxRecordRentPayment(
  orgId: number,
  userId: string | null | undefined,
  args: Record<string, unknown>,
): Promise<BuyHoldToolOutcome & { receipt?: { before: unknown; after: unknown; description: string } }> {
  const lease = await loadLease(orgId, args.lease_id);
  if (lease === "bad_id") return badLeaseId();
  if (!lease) return noLease();
  const amountCents = typeof args.amount_cents === "number" ? args.amount_cents : Number(args.amount_cents);
  const receivedAt = typeof args.received_at === "string" ? args.received_at : "";
  const today = clock.now().toISOString().slice(0, 10);
  if (!Number.isInteger(amountCents) || amountCents <= 0 || !DATE.test(receivedAt)) {
    return {
      ok: false,
      refusal: {
        what: "Nothing was recorded on the lease ledger",
        why: "A payment record needs a positive whole-cent amount and the date it was received (YYYY-MM-DD)",
        unlock: "Give the amount in cents and the real received date, then I will record it",
      },
    };
  }
  if (receivedAt > today) {
    return {
      ok: false,
      refusal: {
        what: "Nothing was recorded on the lease ledger",
        why: "That date is in the future — a payment is recorded once the landlord has received it",
        unlock: "Tell me again once it has been received, with the real date",
      },
    };
  }
  const method = typeof args.method === "string" && args.method ? args.method : null;
  const payorType = args.payor_type === "hap" ? "hap" : "tenant";
  const acceptedDespitePartial = args.accepted_despite_partial === true;
  const { db } = await import("../db");
  const { recordRentPayment, PartialPaymentUnderNoticeError } = await import(
    "../services/rental/paymentPosting"
  );
  let posted;
  try {
    posted = await db.transaction((tx) =>
      recordRentPayment(tx, {
        organizationId: orgId,
        leaseId: lease.id,
        amountCents,
        receivedAt,
        method,
        referenceNumber: typeof args.reference_number === "string" ? args.reference_number : null,
        payorType,
        payorTenantId: null,
        acceptedDespitePartial,
        notes: typeof args.notes === "string" ? args.notes : null,
        operationKey: null,
      }),
    );
  } catch (err) {
    if (err instanceof PartialPaymentUnderNoticeError) {
      return {
        ok: false,
        refusal: {
          what: "Nothing was recorded on the lease ledger",
          why:
            "This payment would leave a charge that is under a notice to vacate still short, and in several states " +
            "accepting partial rent after serving notice voids the notice and the process has to start over",
          unlock: "Confirm you accept it anyway (accepted_despite_partial) and I will record it, or record it once the full amount is received",
        },
      };
    }
    throw err;
  }
  // Post-commit workflow emits — the same pair the REST route fires, only
  // after the transaction has committed (a workflow fault must never roll
  // back banked rent; paymentPosting's own contract).
  try {
    const { emitRentPaymentReceived, emitRentReceived } = await import("../services/rentalEvents");
    const firstCharge = posted.firstCharge;
    emitRentPaymentReceived({
      organizationId: orgId,
      leaseId: lease.id,
      paymentId: posted.payment.id,
      rentChargeId: firstCharge?.chargeId ?? null,
      amountCents,
      isPartial: posted.isPartial,
      payorType,
      method,
      receivedAt,
      dueDate: firstCharge?.dueDate ?? null,
      chargeAmountCents: posted.firstChargeAmountCents,
      chargeBalanceAfterCents: firstCharge?.balanceCents ?? null,
      legalPosture: firstCharge?.legalPosture ?? null,
      allocatedCents: posted.allocation.appliedCents,
      unappliedCents: posted.allocation.unappliedCents,
      allocationLineCount: posted.allocation.allocations.length,
      allocationExplanation: posted.allocation.explanation,
    });
    emitRentReceived({
      organizationId: orgId,
      leaseId: lease.id,
      paymentId: posted.payment.id,
      propertyId: lease.propertyId,
      amountCents,
      receivedAt,
      rentChargeId: firstCharge?.chargeId ?? null,
      rentPeriodMonth: firstCharge?.chargedForMonth ?? null,
    });
  } catch {
    /* the payment stands; a workflow emit fault never un-records rent */
  }
  void userId;
  return {
    ok: true,
    data: {
      message:
        "Recorded the payment on the lease ledger. This records money the landlord already received on their own rails — " +
        "AcreOS charged nothing and holds nothing.",
      leaseId: lease.id,
      paymentId: posted.payment.id,
      amountCents,
      allocatedCents: posted.allocation.appliedCents,
      unappliedCents: posted.allocation.unappliedCents,
      isPartial: posted.isPartial,
      charges: posted.charges,
    },
    receipt: {
      before: { leaseId: lease.id },
      after: {
        leaseId: lease.id,
        paymentId: posted.payment.id,
        amountCents,
        allocatedCents: posted.allocation.appliedCents,
        unappliedCents: posted.allocation.unappliedCents,
      },
      description: `Recorded a rent payment of ${amountCents} cents received ${receivedAt} on lease ${lease.unitLabel ?? lease.id} (ledger record only — no charge was made)`,
    },
  };
}

/**
 * Generate the scheduled rent charges a lease's own schedule implies, via
 * the one generator (idempotent; partial periods are skipped, never
 * prorated by invention). Ledger only — no collection is started.
 */
export async function paxGenerateScheduledRentCharges(
  orgId: number,
  userId: string | null | undefined,
  args: Record<string, unknown>,
): Promise<BuyHoldToolOutcome & { receipt?: { before: unknown; after: unknown; description: string } }> {
  let leaseId: string | undefined;
  if (args.lease_id !== undefined && args.lease_id !== null && args.lease_id !== "") {
    const lease = await loadLease(orgId, args.lease_id);
    if (lease === "bad_id") return badLeaseId();
    if (!lease) return noLease();
    leaseId = lease.id;
  }
  const throughDate =
    typeof args.through_date === "string" && DATE.test(args.through_date)
      ? args.through_date
      : clock.now().toISOString().slice(0, 10);
  const { generateScheduledCharges } = await import("../services/rental/rentChargeGenerator");
  const result = await generateScheduledCharges({
    organizationId: orgId,
    throughDate,
    leaseId,
    userId: userId ?? undefined,
  });
  return {
    ok: true,
    data: {
      message:
        "Generated the scheduled rent charges the lease schedule implies. These are ledger charges only — " +
        "nothing was collected and no tenant was contacted.",
      throughDate,
      leaseId: leaseId ?? null,
      inserted: result.inserted,
      insertedTotalCents: result.insertedTotalCents,
      skippedDuplicate: result.skippedDuplicate,
      leasesConsidered: result.leasesConsidered,
      skippedPartialPeriods: result.skippedPartialPeriods,
    },
    receipt: {
      before: { leaseId: leaseId ?? null, throughDate },
      after: { leaseId: leaseId ?? null, throughDate, inserted: result.inserted, insertedTotalCents: result.insertedTotalCents },
      description: `Generated ${result.inserted} scheduled rent charge${result.inserted === 1 ? "" : "s"} through ${throughDate}${leaseId ? ` on lease ${leaseId}` : " across this account's active leases"} (ledger only — nothing collected)`,
    },
  };
}

/** Plain-words converter for the executor. */
export function buyHoldOutcomeToResult(o: BuyHoldToolOutcome): {
  success: boolean;
  data?: Record<string, unknown>;
  refusal?: RefusalParts;
  error?: string;
} {
  return o.ok ? { success: true, data: o.data } : toolRefusal(o.refusal);
}
