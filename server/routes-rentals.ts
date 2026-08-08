/**
 * Buy-and-hold vertical BH-2 — tenant + lease CRUD.
 *
 * Imelda §8.3: "Tenant entity, minimum-viable. Name, contact, lease ID,
 * current rent, lease start, lease end, security deposit. That's it. No
 * screening, no payment history, no maintenance — just the entity that
 * everything else hangs from."
 *
 *   GET    /api/tenants                            — list w/ filter
 *   GET    /api/tenants/:id                        — detail + leases
 *   POST   /api/tenants                            — create
 *   PATCH  /api/tenants/:id                        — update
 *   DELETE /api/tenants/:id                        — delete
 *   GET    /api/leases                             — list (filterable by property)
 *   GET    /api/leases/:id                         — detail w/ tenants + addendums
 *   POST   /api/leases                             — create
 *   PATCH  /api/leases/:id                         — update
 *   POST   /api/leases/:id/tenants                 — attach tenant
 *   DELETE /api/leases/:id/tenants/:tenantId       — detach tenant
 *   POST   /api/leases/:id/addendums               — append addendum
 *   POST   /api/leases/:id/renew                   — create renewal lease
 *                                                     referencing original
 *
 * Units (BH-9) — the rentable slot as a row. Occupancy is computed from
 * `rental_units`, so a unit that no one has ever leased is exactly the thing
 * the product must be able to model. These live on the EXISTING rentals
 * router (no new top-level nav — that is a standing hard-stop):
 *
 *   GET    /api/rentals/properties/:propertyId/units       — list
 *   POST   /api/rentals/properties/:propertyId/units       — create
 *   POST   /api/rentals/properties/:propertyId/units/bulk  — create a range/paste
 *   PATCH  /api/rentals/units/:id                          — edit
 *   DELETE /api/rentals/units/:id                          — refuses while leased
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, desc, asc, sql } from "drizzle-orm";
import { db } from "./db";
import {
  tenants,
  rentalLeases,
  rentalUnits,
  leaseTenants,
  leaseAddendums,
  TENANT_STATUSES,
  LEASE_STATUSES,
  LEASE_LIABILITY_MODELS,
  LEASE_ADDENDUM_KINDS,
  RENTAL_UNIT_KINDS,
  RENTAL_UNIT_STATUSES,
  properties,
} from "@shared/schema";
import type { RentalUnitKind } from "@shared/schema";
import { computeNoticeWindow } from "@shared/regulatory/leaseNoticeRules";
import {
  expandUnitLabels,
  buildBulkCreateReport,
  UNIT_BULK_MAX_LABELS,
  UNIT_LABEL_MAX_LENGTH,
} from "@shared/rental/unitInventory";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors, sendError } from "./utils/errors";
import { logger } from "./utils/logger";

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

// Base tenant fields. firstName/lastName are OPTIONAL at the field level so an
// entity (company) tenant can omit them; the person-vs-entity requirement is
// enforced by the refinement below on CREATE. companyName + isEntity add the
// commercial-beta entity support (Wave 2 pass B).
const tenantBase = z.object({
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
  // Company/organization tenant. Deliberately NOT `.default(false)`: under the
  // UPDATE schema's `.partial()`, a default would survive and an unrelated PATCH
  // (say, editing an email) would write isEntity=false, silently flipping a
  // stored entity tenant back to a person. Left optional here — CREATE coalesces
  // an absent value to false (person), and the refinement treats undefined as a
  // person. An entity tenant sends isEntity=true + companyName explicitly.
  isEntity: z.boolean().optional(),
  companyName: z.string().min(1).max(200).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  smsConsent: z.boolean().default(false),
  dateOfBirth: z.string().optional(),
  governmentIdLast4: z.string().max(4).optional(),
  status: z.enum(TENANT_STATUSES).default("applicant"),
  sourceChannel: z.string().optional(),
  // Structured screening — operator types facts, not narrative.
  screeningCreditScore: z.coerce.number().int().min(300).max(850).optional(),
  screeningHasPriorEviction: z.boolean().optional(),
  screeningHasCriminalRecord: z.boolean().optional(),
  screeningIncomeMonthlyCents: z.coerce.number().int().nonnegative().optional(),
  screeningCriteriaMet: z.boolean().optional(),
  notes: z.string().optional(),
});

// CREATE: an entity tenant needs a companyName; a person tenant needs BOTH
// first and last name. This keeps person tenants exactly as strict as before
// (isEntity defaults false → first/last required) while letting a company be
// entered under its own name instead of a fabricated placeholder.
const tenantSchema = tenantBase.superRefine((data, ctx) => {
  if (data.isEntity) {
    if (!data.companyName || data.companyName.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["companyName"],
        message: "An organization / entity tenant needs a company name.",
      });
    }
  } else {
    if (!data.firstName || data.firstName.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["firstName"],
        message: "First name is required for a person tenant.",
      });
    }
    if (!data.lastName || data.lastName.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lastName"],
        message: "Last name is required for a person tenant.",
      });
    }
  }
});

// UPDATE: fully partial. `.partial()` wraps each field (incl. the isEntity
// default) in optional(), so an absent field parses to undefined and the PATCH
// loop never writes it — a partial update never flips a stored entity tenant
// back to a person. Cross-field name/company requirements are enforced on
// CREATE; a PATCH writes only the keys it is given.
const tenantUpdateSchema = tenantBase.partial();

const leaseSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  unitLabel: z.string().optional(),
  /**
   * unit | pad | suite for the slot this lease find-or-creates. Applied on
   * CREATE only (see `findOrCreateUnitId`), so leasing an existing pad never
   * resets it to 'unit'.
   *
   * Optional, and NOT inferred when omitted: the lease form is the first place
   * a mobile-home park operator's very first lot lease is entered, and until
   * this existed that lot was silently born a 'unit'. Nothing else on the lease
   * — not the property's structure_type, not the label reading "Lot 14" —
   * establishes what the slot IS, so a blank stays 'unit' rather than being
   * guessed at.
   */
  unitKind: z.enum(RENTAL_UNIT_KINDS).optional(),
  parentLeaseId: z.string().uuid().optional(),
  status: z.enum(LEASE_STATUSES).default("draft"),
  liabilityModel: z.enum(LEASE_LIABILITY_MODELS).default("joint_and_several"),
  startDate: z.string(),
  endDate: z.string().optional(),
  monthlyRentCents: z.coerce.number().int().nonnegative(),
  rentDueDayOfMonth: z.coerce.number().int().min(1).max(31).default(1),
  securityDepositCents: z.coerce.number().int().nonnegative().default(0),
  petDepositCents: z.coerce.number().int().nonnegative().default(0),
  isSection8: z.boolean().default(false),
  hapPortionCents: z.coerce.number().int().nonnegative().optional(),
  tenantPortionCents: z.coerce.number().int().nonnegative().optional(),
  state: z.string().length(2),
  notes: z.string().optional(),
  tenantIds: z.array(z.string().uuid()).optional(),
  // Federal lead-paint hard-gate (42 U.S.C. §4852d / 24 C.F.R. §35.92):
  // operator affirms the EPA disclosure form + "Protect Your Family From
  // Lead in Your Home" pamphlet were provided and the lead_paint addendum
  // is attached. Required before a pre-1978 lease may leave draft.
  leadPaintDisclosureConfirmed: z.boolean().default(false),
});

const leaseUpdateSchema = leaseSchema.partial().omit({ propertyId: true });

const attachTenantSchema = z.object({
  tenantId: z.string().uuid(),
  rentSharePct: z.coerce.number().min(0).max(1).default(1),
  isPrimary: z.boolean().default(false),
});

const addendumSchema = z.object({
  kind: z.enum(LEASE_ADDENDUM_KINDS),
  title: z.string().min(1).max(200),
  bodyMarkdown: z.string().optional(),
  documentPath: z.string().optional(),
  effectiveDate: z.string().optional(),
});

const renewSchema = z.object({
  newEndDate: z.string(),
  newMonthlyRentCents: z.coerce.number().int().nonnegative().optional(),
});

// ----------------------------------------------------------------------------
// Lead-paint hard-gate helpers — 24 C.F.R. §35.92 / 40 C.F.R. §745.113.
// shared/schema/rental.ts documents the invariant: a lease on a property
// with requiresLeadPaintDisclosure may not transition to
// pending_signature / active without a confirmed disclosure.
// ----------------------------------------------------------------------------

/** Lease statuses that count as "executing" for the federal lead-paint gate. */
const LEAD_PAINT_GATED_STATUSES: ReadonlySet<string> = new Set(["pending_signature", "active"]);

/**
 * Whether the property is federally required to carry a lead-paint
 * disclosure. requiresLeadPaintDisclosure is authoritative when set;
 * when NULL (unbackfilled) we fall back to yearBuilt < 1978.
 */
function propertyNeedsLeadPaintDisclosure(prop: {
  yearBuilt: number | null;
  requiresLeadPaintDisclosure: boolean | null;
}): boolean {
  if (prop.requiresLeadPaintDisclosure === true) return true;
  if (prop.requiresLeadPaintDisclosure === false) return false;
  return prop.yearBuilt !== null && prop.yearBuilt > 0 && prop.yearBuilt < 1978;
}

function leadPaintBlocked(res: Response, detail: Record<string, unknown>) {
  return Errors.badRequest(
    res,
    "Lead-based-paint disclosure required: this is pre-1978 housing. Federal law " +
      "(42 U.S.C. §4852d; 24 C.F.R. §35.92; 40 C.F.R. §745.113) requires the EPA disclosure " +
      "form and the 'Protect Your Family From Lead in Your Home' pamphlet before the lease is " +
      "executed. Attach the lead_paint disclosure and confirm with leadPaintDisclosureConfirmed=true, " +
      "or keep the lease in draft.",
    { code: "LEAD_PAINT_DISCLOSURE_REQUIRED", ...detail },
  );
}

// ----------------------------------------------------------------------------
// Occupancy — the arithmetic, kept pure and separately testable.
//
// The version this replaces derived BOTH sides of the ratio from
// `rental_leases`:
//
//   totalUnits  = COUNT(DISTINCT (property_id, unit_label)) FROM rental_leases
//   activeUnits = the same, restricted to status = 'active'
//
// A unit that has never been leased has no lease row, so it appeared in
// NEITHER count. A landlord who buys a half-empty 10-plex, enters it and
// imports the six sitting tenants saw 6/6 = 100% occupancy — the number was
// structurally incapable of reporting a vacancy, which is the one thing an
// occupancy figure exists to report. `propertyCount` was fetched and then
// never used in the percentage at all.
//
// Now the denominator is the units the operator OWNS AND COULD LEASE, read
// from `rental_units`.
// ----------------------------------------------------------------------------

/** Raw per-status counts, straight off one aggregate query over rental_units. */
export interface OccupancyUnitFacts {
  /** Units with status = 'active' — the rentable stock. */
  rentableUnits: number;
  /** Active units carrying at least one currently-active lease. */
  occupiedUnits: number;
  /** status = 'offline' — owned, but could not have been leased. */
  offlineUnits: number;
  /** status = 'retired' — no longer part of the property. */
  retiredUnits: number;
  /** How many of the vacant active units carry a marketRentCents. */
  vacantUnitsWithMarketRent: number;
  /** Sum of marketRentCents over exactly those units. */
  vacantMarketRentMonthlyCents: number;
  propertyCount: number;
}

/** Why occupancy is not computable, when it isn't. */
export type OccupancyUnmeasurableReason = "no_units_modelled" | "no_rentable_units";

interface OccupancyCommon {
  offlineUnits: number;
  retiredUnits: number;
  propertyCount: number;
}

export type OccupancySnapshot =
  | (OccupancyCommon & {
      measurable: true;
      rentableUnits: number;
      occupiedUnits: number;
      vacantUnits: number;
      occupancyPct: number;
      /**
       * Monthly asking rent going uncollected across the vacant units that
       * carry one. OMITTED (not zero) when no vacant unit has a market rent —
       * a missing asking rent is unknown, not free.
       */
      vacantMarketRentMonthlyCents?: number;
      /** Vacant units excluded from that sum because they carry no asking rent. */
      vacantUnitsMissingMarketRent: number;
    })
  | (OccupancyCommon & {
      measurable: false;
      reason: OccupancyUnmeasurableReason;
      message: string;
      occupancyPct: null;
      rentableUnits: number;
      occupiedUnits: null;
      vacantUnits: null;
    });

/**
 * Occupancy over modelled units.
 *
 *   denominator = active (rentable) units
 *   numerator   = active units with a currently-active lease
 *   vacant      = the difference, reported explicitly rather than derived
 *
 * `offline` and `retired` units are excluded from BOTH sides and surfaced
 * separately. Folding them into the denominator would make a renovation look
 * like a leasing failure; folding them into the numerator would excuse a
 * genuinely empty unit. An operator with three units down for renovation needs
 * to see that as its own number.
 *
 * With no rentable units there is no ratio. We return an explicit unmeasurable
 * state with a reason — never 0% (which reads as "everything is empty") and
 * never 100% (which is what the old query actually produced). A percentage
 * computed from nothing is a fabricated number.
 */
export function computeOccupancySnapshot(facts: OccupancyUnitFacts): OccupancySnapshot {
  const rentableUnits = Math.max(0, Math.trunc(facts.rentableUnits));
  const offlineUnits = Math.max(0, Math.trunc(facts.offlineUnits));
  const retiredUnits = Math.max(0, Math.trunc(facts.retiredUnits));
  const propertyCount = Math.max(0, Math.trunc(facts.propertyCount));
  const common: OccupancyCommon = { offlineUnits, retiredUnits, propertyCount };

  if (rentableUnits === 0) {
    const modelledAny = offlineUnits > 0 || retiredUnits > 0;
    const reason: OccupancyUnmeasurableReason = modelledAny ? "no_rentable_units" : "no_units_modelled";
    return {
      ...common,
      measurable: false,
      reason,
      message: modelledAny
        ? `All ${offlineUnits + retiredUnits} modelled unit(s) are offline or retired — there is no rentable stock to compute occupancy over.`
        : "No rental units have been modelled yet. Occupancy cannot be derived from leases alone, because a unit that has never been leased leaves no trace there — add units to a property or import a rent roll.",
      occupancyPct: null,
      rentableUnits: 0,
      occupiedUnits: null,
      vacantUnits: null,
    };
  }

  // Clamp rather than trust: a unit cannot be more-than-occupied, and letting
  // a bad count through would print an occupancy above 100%.
  const occupiedUnits = Math.min(rentableUnits, Math.max(0, Math.trunc(facts.occupiedUnits)));
  const vacantUnits = rentableUnits - occupiedUnits;

  const vacantWithRent = Math.min(vacantUnits, Math.max(0, Math.trunc(facts.vacantUnitsWithMarketRent)));
  const vacantMarketRent = Math.max(0, Math.trunc(facts.vacantMarketRentMonthlyCents));

  return {
    ...common,
    measurable: true,
    rentableUnits,
    occupiedUnits,
    vacantUnits,
    occupancyPct: Math.round((occupiedUnits / rentableUnits) * 100),
    // Key absent — not zero — when nothing vacant carries an asking rent.
    ...(vacantWithRent > 0 ? { vacantMarketRentMonthlyCents: vacantMarketRent } : {}),
    vacantUnitsMissingMarketRent: vacantUnits - vacantWithRent,
  };
}

/**
 * drizzle's `execute()` returns a driver-dependent envelope (node-postgres
 * wraps rows in `{ rows }`; other drivers hand back the array). Narrow it once
 * here so no route body needs an untyped hop — an untyped hop is exactly where
 * a miscounted unit would hide.
 */
function readFirstRow(result: unknown): Record<string, unknown> | undefined {
  const rows = Array.isArray(result)
    ? result
    : (result as { rows?: unknown[] } | null)?.rows;
  const first = Array.isArray(rows) ? rows[0] : undefined;
  return first && typeof first === "object" ? (first as Record<string, unknown>) : undefined;
}

/** SQL COUNT/SUM comes back as number or string depending on width. */
function toCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ----------------------------------------------------------------------------
// Unit identity — one normalisation, used by EVERY writer.
//
// Migration 0219 backfilled `rental_units` with
//
//   CASE WHEN COALESCE(NULLIF(TRIM(unit_label), ''), '') = ''
//        THEN 'Whole property' ELSE TRIM(unit_label) END
//
// and `rental_units_org_property_label_uk` is unique on (org, property, label).
// A writer that skips the TRIM does not violate that index — it DEFEATS it:
// " 3B" and "3B" are two different labels, so a rent-roll upload lands a second
// unit beside the backfilled one and BOTH sit in the occupancy denominator, on
// a building that only ever had one 3B. Every write site below goes through
// `normalizeUnitLabel`, so the index can actually do its job.
// ----------------------------------------------------------------------------

/**
 * The label migration 0219 gives a tenancy with no unit label (the SFR case),
 * so occupancy math never has to fork on null. Change this and the backfill
 * disagrees with every subsequent write.
 */
export const WHOLE_PROPERTY_UNIT_LABEL = "Whole property";

/**
 * A raw operator string → the `rental_units.label` it identifies.
 * Blank/whitespace-only/absent collapses to WHOLE_PROPERTY_UNIT_LABEL, exactly
 * as the 0219 CASE does; anything else is trimmed and otherwise left alone
 * (the label is the operator's own vocabulary — it has to match the lease, the
 * mailbox and the work order, so we never case-fold or re-punctuate it).
 */
export function normalizeUnitLabel(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  return trimmed === "" ? WHOLE_PROPERTY_UNIT_LABEL : trimmed;
}

/**
 * The DISPLAY copy written to `rental_leases.unit_label` — trimmed, but NULL
 * when the operator gave nothing. Deliberately NOT the same as
 * `normalizeUnitLabel`: the lease joins to the 'Whole property' unit via
 * `unit_id`, and stamping that phrase into the human-facing string would
 * invent a label the landlord never used. Matches the 0219 post-state, which
 * left `unit_label` untouched.
 */
export function trimLeaseUnitLabel(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Why a unit may not be deleted, or null when it may be.
 *
 * A unit row is the thing a tenancy hangs from. `rental_leases.unit_id` is
 * ON DELETE SET NULL, so deleting a leased unit would not error — it would
 * quietly unlink a LIVE tenancy, and the very next occupancy read would show
 * the tenant's home as vacant. Refuse instead, and name the count so the
 * operator knows how much is in the way.
 *
 * Pure so the refusal itself is testable without a database.
 */
export function unitDeletionRefusal(label: string, leaseCount: number): string | null {
  const n = Math.max(0, Math.trunc(leaseCount));
  if (n === 0) return null;
  return (
    `Unit "${label}" still has ${n} lease${n === 1 ? "" : "s"} pointing at it. ` +
    `Deleting it would unlink ${n === 1 ? "that tenancy" : "those tenancies"} without ending ` +
    `${n === 1 ? "it" : "them"}, and the unit would read as vacant while somebody lives there. ` +
    `Move ${n === 1 ? "that lease" : "those leases"} to another unit, or set this unit's status to ` +
    `'retired' to take it out of the occupancy denominator while keeping its history.`
  );
}

/**
 * The transaction handle drizzle hands `db.transaction`. Derived rather than
 * hand-typed so it cannot drift from the driver, and so no writer below needs
 * an `as any` hop.
 */
type RentalTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Find-or-create the `rental_units` row for (org, property, label) and return
 * its id. Returns null only if the unique-index conflict came from something
 * other than that index — the caller decides whether that is fatal (lease
 * creation) or a counted skip (bulk import); nobody may treat it as success.
 *
 * `kind` is applied on CREATE only. A conflict means the operator already has
 * a row here and their beds/baths/market rent/kind/status must not be clobbered
 * by an import's defaults.
 */
async function findOrCreateUnitId(
  tx: RentalTx,
  args: { orgId: number; propertyId: number; rawLabel: string | null | undefined; kind?: RentalUnitKind },
): Promise<string | null> {
  const label = normalizeUnitLabel(args.rawLabel);

  const inserted = await tx.insert(rentalUnits).values({
    organizationId: args.orgId,
    propertyId: args.propertyId,
    label,
    kind: args.kind ?? "unit",
    status: "active",
  }).onConflictDoNothing().returning({ id: rentalUnits.id });
  if (inserted.length > 0) return inserted[0].id;

  const [existing] = await tx.select({ id: rentalUnits.id })
    .from(rentalUnits)
    .where(and(
      eq(rentalUnits.organizationId, args.orgId),
      eq(rentalUnits.propertyId, args.propertyId),
      eq(rentalUnits.label, label),
    ));
  return existing?.id ?? null;
}

// ----------------------------------------------------------------------------
// Unit validation
// ----------------------------------------------------------------------------

const unitCreateSchema = z.object({
  label: z.string().trim().min(1).max(UNIT_LABEL_MAX_LENGTH),
  // Blank infers nothing. A mobile-home park's rentable slot is a PAD and a
  // strip centre's is a SUITE, but only the operator (or an import that was
  // told) knows which — guessing from, say, the property's structure_type
  // would put a fabricated fact in the record.
  kind: z.enum(RENTAL_UNIT_KINDS).default("unit"),
  bedrooms: z.coerce.number().int().min(0).max(99).optional(),
  bathrooms: z.coerce.number().min(0).max(99).optional(),
  squareFeet: z.coerce.number().int().min(0).max(10_000_000).optional(),
  marketRentCents: z.coerce.number().int().nonnegative().optional(),
  status: z.enum(RENTAL_UNIT_STATUSES).default("active"),
  notes: z.string().max(2000).optional(),
});

const unitUpdateSchema = unitCreateSchema.partial();

/**
 * Bulk create. The label list is NOT sent by the client as an array — it sends
 * the SPEC (a range, or a paste), and the server expands it with the same pure
 * `expandUnitLabels` the client previewed with. That way the operator's
 * "Lot 1–Lot 60" is the thing under test, and a client that expanded it
 * differently cannot smuggle a different list past the preview they approved.
 *
 * The physical/rent fields are deliberately absent: 60 pads do not share a
 * bedroom count, and stamping one onto all of them would be fabrication at
 * scale. Bulk create makes the SLOTS exist; the operator fills in the facts
 * they actually know, per unit, afterwards.
 */
const unitBulkCreateSchema = z.object({
  spec: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("range"),
      prefix: z.string().max(UNIT_LABEL_MAX_LENGTH).optional(),
      suffix: z.string().max(UNIT_LABEL_MAX_LENGTH).optional(),
      start: z.coerce.number().int().min(0).max(1_000_000),
      end: z.coerce.number().int().min(0).max(1_000_000),
      padTo: z.coerce.number().int().min(0).max(8).optional(),
    }),
    z.object({
      mode: z.literal("list"),
      // 64 chars + a separator, times the ceiling, with room for messy paste.
      text: z.string().min(1).max(UNIT_BULK_MAX_LABELS * (UNIT_LABEL_MAX_LENGTH + 2)),
    }),
  ]),
  kind: z.enum(RENTAL_UNIT_KINDS).default("unit"),
  status: z.enum(RENTAL_UNIT_STATUSES).default("active"),
  notes: z.string().max(2000).optional(),
});

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

export function registerRentalRoutes(app: Express): void {
  // ===== Tenants =====

  app.get("/api/tenants", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const status = typeof req.query.status === "string" ? req.query.status : null;
      const conditions = [eq(tenants.organizationId, orgId)];
      if (status) conditions.push(eq(tenants.status, status as any));
      const rows = await db.select().from(tenants).where(and(...conditions)).orderBy(desc(tenants.updatedAt));
      return res.json({ tenants: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/tenants/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [t] = await db.select().from(tenants)
        .where(and(eq(tenants.id, req.params.id), eq(tenants.organizationId, orgId)));
      if (!t) return Errors.notFound(res, "Tenant");

      const leaseLinks = await db.select({
        leaseId: leaseTenants.leaseId,
        rentSharePct: leaseTenants.rentSharePct,
        isPrimary: leaseTenants.isPrimary,
      })
        .from(leaseTenants)
        .where(and(eq(leaseTenants.tenantId, t.id), eq(leaseTenants.organizationId, orgId)));
      const leaseIds = leaseLinks.map((l) => l.leaseId);
      const leases = leaseIds.length > 0
        ? await db.select().from(rentalLeases).where(and(
            eq(rentalLeases.organizationId, orgId),
            sql`${rentalLeases.id} = ANY(${leaseIds}::uuid[])`,
          ))
        : [];

      return res.json({ tenant: t, leases });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/tenants", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = tenantSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      // Audit F-15-1: gate FCRA screening fields on CREATE, mirroring the PATCH
      // handler. Previously screening data (credit score, prior eviction,
      // criminal record, income, criteria met) could be written on create with
      // NO permissible-purpose gate, bypassing the PATCH gate entirely — a
      // customer could set the exact regulated fields by creating rather than
      // patching. Per-lookup attestation is per-tenant and cannot exist before
      // the row, so create requires the org-level annual FCRA attestation.
      const isScreeningCreate =
        parsed.data.screeningCreditScore !== undefined ||
        parsed.data.screeningHasPriorEviction !== undefined ||
        parsed.data.screeningHasCriminalRecord !== undefined ||
        parsed.data.screeningIncomeMonthlyCents !== undefined ||
        parsed.data.screeningCriteriaMet !== undefined ||
        parsed.data.status === "denied" ||
        parsed.data.status === "approved";
      if (isScreeningCreate) {
        const { assertScreeningPermitted, FcraAttestationStaleError, TenantScreeningNotAttestedError } =
          await import("./services/fcraAttestation");
        try {
          await assertScreeningPermitted({
            organizationId: orgId,
            userId,
            tenantId: "", // no tenant row yet — org-level attestation only
            requirePerLookupRow: false,
          });
        } catch (err: any) {
          if (err instanceof FcraAttestationStaleError || err instanceof TenantScreeningNotAttestedError) {
            return sendError(res, 422, err.code, err.message);
          }
          throw err;
        }
      }

      const [created] = await db.insert(tenants).values({
        organizationId: orgId,
        // Person names are nullable now (entity tenants omit them); the schema
        // refinement above guarantees a person tenant supplied both and an
        // entity tenant supplied a companyName, so nothing here is fabricated.
        firstName: parsed.data.firstName ?? null,
        lastName: parsed.data.lastName ?? null,
        isEntity: parsed.data.isEntity ?? false,
        companyName: parsed.data.companyName ?? null,
        email: parsed.data.email || null,
        phone: parsed.data.phone ?? null,
        smsConsent: parsed.data.smsConsent,
        smsConsentAt: parsed.data.smsConsent ? new Date() : null,
        dateOfBirth: parsed.data.dateOfBirth ?? null,
        governmentIdLast4: parsed.data.governmentIdLast4 ?? null,
        status: parsed.data.status,
        sourceChannel: parsed.data.sourceChannel ?? null,
        screeningCreditScore: parsed.data.screeningCreditScore ?? null,
        screeningHasPriorEviction: parsed.data.screeningHasPriorEviction ?? null,
        screeningHasCriminalRecord: parsed.data.screeningHasCriminalRecord ?? null,
        screeningIncomeMonthlyCents: parsed.data.screeningIncomeMonthlyCents ?? null,
        screeningCriteriaMet: parsed.data.screeningCriteriaMet ?? null,
        notes: parsed.data.notes ?? null,
      }).returning();

      logger.info("[BH-2] tenant created", { orgId, userId, tenantId: created.id });
      return res.status(201).json({ tenant: created });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.patch("/api/tenants/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = tenantUpdateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      // RS-1: gate screening-field updates behind FCRA permissible-purpose
      // attestation. Cordelia §3 + Caspian §1 + Imelda §2.6.
      const isScreeningUpdate =
        parsed.data.screeningCreditScore !== undefined ||
        parsed.data.screeningHasPriorEviction !== undefined ||
        parsed.data.screeningHasCriminalRecord !== undefined ||
        parsed.data.screeningIncomeMonthlyCents !== undefined ||
        parsed.data.screeningCriteriaMet !== undefined ||
        parsed.data.status === "denied" ||
        parsed.data.status === "approved";
      if (isScreeningUpdate) {
        const { assertScreeningPermitted, FcraAttestationStaleError, TenantScreeningNotAttestedError } =
          await import("./services/fcraAttestation");
        try {
          await assertScreeningPermitted({
            organizationId: orgId,
            userId,
            tenantId: req.params.id,
            requirePerLookupRow: true,
          });
        } catch (err: any) {
          if (err instanceof FcraAttestationStaleError || err instanceof TenantScreeningNotAttestedError) {
            // sendError (server/utils/errors.ts) emits the identical
            // { error, message, statusCode } body while keeping the FCRA-specific
            // code and copy — Errors.validationFailed would replace both.
            return sendError(res, 422, err.code, err.message);
          }
          throw err;
        }
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
        if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
      }
      const [updated] = await db.update(tenants).set(updates)
        .where(and(eq(tenants.id, req.params.id), eq(tenants.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Tenant");
      return res.json({ tenant: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // RS-1: org-level annual FCRA attestation. POST records the click;
  // GET returns the current attestation (or null when stale/missing).
  app.get("/api/account/fcra-attestation", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const { getCurrentAttestation, CURRENT_FCRA_ATTESTATION_VERSION } = await import("./services/fcraAttestation");
      const row = await getCurrentAttestation(orgId, userId);
      return res.json({
        attestation: row,
        currentVersion: CURRENT_FCRA_ATTESTATION_VERSION,
        attestationStale: !row,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
  app.post("/api/account/fcra-attestation", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const { recordAttestation, recordSubstantiveAttestation, SubstantiveAttestationError } =
        await import("./services/fcraAttestation");

      // Panel-300 G4 — substantive 3-screen form path. If the request
      // carries a `substantiveForm` key, validate it and persist via
      // recordSubstantiveAttestation. Otherwise fall back to the legacy
      // checkbox attestation. New BH customers post-2026-06-08 should
      // ALWAYS submit the substantive form; the legacy path stays for
      // skip-trace and other lighter-touch lookups.
      if (req.body?.substantiveForm) {
        try {
          const row = await recordSubstantiveAttestation({
            organizationId: orgId,
            userId,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"] as string | undefined,
            substantiveForm: req.body.substantiveForm,
          });
          return res.status(201).json({ attestation: row, substantive: true });
        } catch (validationErr) {
          if (validationErr instanceof SubstantiveAttestationError) {
            return Errors.badRequest(res, validationErr.message, { code: validationErr.code });
          }
          throw validationErr;
        }
      }

      const row = await recordAttestation({
        organizationId: orgId,
        userId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] as string | undefined,
      });
      return res.status(201).json({ attestation: row, substantive: false });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // RS-1: per-lookup attestation. Operator clicks "I attest this is for
  // tenant_screening / account_review / written_consent / legitimate_business_need"
  // BEFORE the screening fields can be updated. Stays valid for 1 hour.
  app.post("/api/tenants/:id/attest-screening", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const { tenantScreenings } = await import("@shared/schema");
      const { ALL_PURPOSES_OF_USE, CURRENT_FCRA_ATTESTATION_VERSION, getCurrentAttestation, FcraAttestationStaleError } =
        await import("./services/fcraAttestation");

      const purposeOfUse = String(req.body?.purposeOfUse ?? "");
      if (!ALL_PURPOSES_OF_USE.includes(purposeOfUse as any)) {
        return Errors.badRequest(res, `purposeOfUse must be one of ${ALL_PURPOSES_OF_USE.join(", ")}`);
      }
      const justification = typeof req.body?.justification === "string" ? req.body.justification : null;
      if (purposeOfUse === "legitimate_business_need" && (!justification || justification.length < 30)) {
        return Errors.badRequest(res, "legitimate_business_need requires a justification of at least 30 chars");
      }

      const orgAttestation = await getCurrentAttestation(orgId, userId);
      if (!orgAttestation) {
        return sendError(
          res,
          422,
          "FCRA_ATTESTATION_REQUIRED",
          `Annual FCRA attestation required (current version ${CURRENT_FCRA_ATTESTATION_VERSION}). Visit /account/fcra-attestation to attest first.`,
        );
      }

      const propertyIdRaw = req.body?.propertyId;
      const propertyId = typeof propertyIdRaw === "number" ? propertyIdRaw : null;

      const [row] = await db.insert(tenantScreenings).values({
        organizationId: orgId,
        tenantId: req.params.id,
        propertyId,
        purposeOfUse,
        purposeJustification: justification,
        requestingUserId: userId,
        attestationVersion: CURRENT_FCRA_ATTESTATION_VERSION,
      }).returning();
      return res.status(201).json({ screening: row });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // RS-2: adverse-action notice RECORD. AcreOS has no adverse-action send
  // rail yet, so this route never claims one: it records the denial with
  // the FCRA template version and deliveryStatus='recorded', and the
  // operator must deliver the letter manually. adverseActionNoticeSentAt
  // stays NULL until a real dispatch pipeline stamps it — a follow-up
  // workflow finds un-delivered notices via deliveryStatus='recorded'.
  // "Nothing lies": never persist 'sent' without a send.
  app.post("/api/tenants/:id/adverse-action", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const { tenantScreenings } = await import("@shared/schema");
      const { assertScreeningPermitted, FcraAttestationStaleError, TenantScreeningNotAttestedError } =
        await import("./services/fcraAttestation");

      try {
        await assertScreeningPermitted({
          organizationId: orgId,
          userId,
          tenantId: req.params.id,
          requirePerLookupRow: true,
        });
      } catch (err: any) {
        if (err instanceof FcraAttestationStaleError || err instanceof TenantScreeningNotAttestedError) {
          return sendError(res, 422, err.code, err.message);
        }
        throw err;
      }

      // Find the most recent screening row to update.
      const recent = await db.select().from(tenantScreenings)
        .where(and(
          eq(tenantScreenings.organizationId, orgId),
          eq(tenantScreenings.tenantId, req.params.id),
        ))
        .orderBy(desc(tenantScreenings.attestedAt))
        .limit(1);
      if (recent.length === 0) {
        return Errors.notFound(res, "tenant_screening row");
      }

      const ADVERSE_ACTION_TEMPLATE_VERSION = "2026-05-08-v1";
      const [updated] = await db.update(tenantScreenings).set({
        outcome: "denied",
        adverseActionTemplateVersion: ADVERSE_ACTION_TEMPLATE_VERSION,
        // NOT 'sent' — nothing was sent. adverseActionNoticeSentAt is
        // deliberately left NULL; only an actual dispatch may stamp it.
        adverseActionDeliveryStatus: "recorded",
        updatedAt: new Date(),
      }).where(eq(tenantScreenings.id, recent[0].id)).returning();

      // Mirror the denial onto the tenant record so list views can filter.
      // tenants.adverseActionNoticeSentAt is NOT stamped — the tenants-list
      // badge keys off it and must never claim a send that didn't happen.
      await db.update(tenants).set({
        status: "denied",
        updatedAt: new Date(),
      }).where(and(eq(tenants.id, req.params.id), eq(tenants.organizationId, orgId)));

      logger.info("[FCRA] Adverse-action notice recorded (manual delivery required — no send rail)", {
        orgId, userId, tenantId: req.params.id, templateVersion: ADVERSE_ACTION_TEMPLATE_VERSION,
      });
      return res.status(201).json({
        screening: updated,
        deliveryStatus: "recorded",
        message:
          `Adverse-action notice recorded (template ${ADVERSE_ACTION_TEMPLATE_VERSION}). ` +
          "AcreOS does not send adverse-action letters yet — print and deliver the FCRA notice " +
          "to the applicant manually within the statutory window. This record marks the denial, not delivery.",
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.delete("/api/tenants/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [deleted] = await db.delete(tenants)
        .where(and(eq(tenants.id, req.params.id), eq(tenants.organizationId, orgId)))
        .returning({ id: tenants.id });
      if (!deleted) return Errors.notFound(res, "Tenant");
      return res.json({ deleted: true, id: deleted.id });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ===== Leases =====

  app.get("/api/leases", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const propertyId = req.query.propertyId ? parseInt(String(req.query.propertyId), 10) : null;
      const status = typeof req.query.status === "string" ? req.query.status : null;
      const conditions = [eq(rentalLeases.organizationId, orgId)];
      if (propertyId) conditions.push(eq(rentalLeases.propertyId, propertyId));
      if (status) conditions.push(eq(rentalLeases.status, status as any));
      const rows = await db.select().from(rentalLeases).where(and(...conditions)).orderBy(desc(rentalLeases.startDate));
      return res.json({ leases: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/leases/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [l] = await db.select().from(rentalLeases)
        .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)));
      if (!l) return Errors.notFound(res, "Lease");

      const links = await db.select().from(leaseTenants)
        .where(and(eq(leaseTenants.leaseId, l.id), eq(leaseTenants.organizationId, orgId)));
      const tenantIds = links.map((x) => x.tenantId);
      const tenantRows = tenantIds.length > 0
        ? await db.select().from(tenants).where(and(
            eq(tenants.organizationId, orgId),
            sql`${tenants.id} = ANY(${tenantIds}::uuid[])`,
          ))
        : [];
      const tenantsByLink = links.map((link) => ({
        tenant: tenantRows.find((t) => t.id === link.tenantId) ?? null,
        rentSharePct: link.rentSharePct,
        isPrimary: link.isPrimary,
      }));

      const addendums = await db.select().from(leaseAddendums)
        .where(and(eq(leaseAddendums.leaseId, l.id), eq(leaseAddendums.organizationId, orgId)))
        .orderBy(asc(leaseAddendums.createdAt));

      return res.json({ lease: l, tenants: tenantsByLink, addendums });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/leases", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = leaseSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [prop] = await db.select({
        id: properties.id,
        yearBuilt: properties.yearBuilt,
        requiresLeadPaintDisclosure: properties.requiresLeadPaintDisclosure,
      }).from(properties)
        .where(and(eq(properties.id, parsed.data.propertyId), eq(properties.organizationId, orgId)));
      if (!prop) return Errors.notFound(res, "Property");

      // Federal lead-paint hard-gate: a pre-1978 lease may not be created
      // in an executing status without the confirmed disclosure.
      const needsLeadPaint = propertyNeedsLeadPaintDisclosure(prop);
      if (
        needsLeadPaint &&
        LEAD_PAINT_GATED_STATUSES.has(parsed.data.status) &&
        !parsed.data.leadPaintDisclosureConfirmed
      ) {
        return leadPaintBlocked(res, { propertyId: prop.id, yearBuilt: prop.yearBuilt });
      }

      const created = await db.transaction(async (tx) => {
        // The lease is FOR a rentable slot, and until this existed the UI path
        // modelled no slot at all: every lease entered through /leases wrote
        // `unit_label` and nothing else, so `rental_units` stayed empty for the
        // whole org and occupancy answered `measurable: false,
        // reason: "no_units_modelled"` forever. Find-or-create the unit here,
        // inside the SAME transaction as the lease insert, so a failure rolls
        // both back rather than leaving a lease with a dangling unit_id.
        //
        // `kind` rides along because THIS caller knows it: the operator picked
        // it on the form. Before that, every unit born from a lease was a
        // 'unit', including a park's ground leases — the discriminator existed
        // and no write site ever set it to anything else.
        const unitId = await findOrCreateUnitId(tx, {
          orgId,
          propertyId: parsed.data.propertyId,
          rawLabel: parsed.data.unitLabel,
          kind: parsed.data.unitKind,
        });
        if (!unitId) {
          // Refuse rather than write an unlinked lease that would silently
          // vanish from occupancy. The transaction rolls back.
          throw new Error(
            `Could not resolve a rental unit for property ${parsed.data.propertyId} ` +
            `label "${normalizeUnitLabel(parsed.data.unitLabel)}"`,
          );
        }

        const [lease] = await tx.insert(rentalLeases).values({
          organizationId: orgId,
          propertyId: parsed.data.propertyId,
          unitId,
          // Denormalised display copy — trimmed identically to the unit label
          // it mirrors, but left NULL when the operator gave nothing rather
          // than stamped with 'Whole property' (that phrase is the unit's
          // identity, not a name the landlord chose). Matches 0219's post-state.
          unitLabel: trimLeaseUnitLabel(parsed.data.unitLabel),
          parentLeaseId: parsed.data.parentLeaseId ?? null,
          status: parsed.data.status,
          liabilityModel: parsed.data.liabilityModel,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate ?? null,
          monthlyRentCents: parsed.data.monthlyRentCents,
          rentDueDayOfMonth: parsed.data.rentDueDayOfMonth,
          securityDepositCents: parsed.data.securityDepositCents,
          petDepositCents: parsed.data.petDepositCents,
          isSection8: parsed.data.isSection8,
          hapPortionCents: parsed.data.hapPortionCents ?? null,
          tenantPortionCents: parsed.data.tenantPortionCents ?? null,
          state: parsed.data.state.toUpperCase(),
          notes: parsed.data.notes ?? null,
          leadPaintDisclosureAttachedAt: parsed.data.leadPaintDisclosureConfirmed ? new Date() : null,
        }).returning();

        if (parsed.data.tenantIds && parsed.data.tenantIds.length > 0) {
          const sharePct = parsed.data.liabilityModel === "joint_and_several"
            ? 1.0
            : 1 / parsed.data.tenantIds.length;
          await tx.insert(leaseTenants).values(parsed.data.tenantIds.map((tid, idx) => ({
            organizationId: orgId,
            leaseId: lease.id,
            tenantId: tid,
            rentSharePct: String(sharePct),
            isPrimary: idx === 0,
          })));
        }

        return lease;
      });

      logger.info("[BH-2] lease created", { orgId, userId, leaseId: created.id, propertyId: parsed.data.propertyId });
      return res.status(201).json({ lease: created });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.patch("/api/leases/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = leaseUpdateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      // Federal lead-paint hard-gate on status transitions: a pre-1978
      // lease may not move to pending_signature / active unless the
      // disclosure is already attached or confirmed in this request.
      if (parsed.data.status !== undefined && LEAD_PAINT_GATED_STATUSES.has(parsed.data.status)) {
        const [existing] = await db.select().from(rentalLeases)
          .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)));
        if (!existing) return Errors.notFound(res, "Lease");
        const attached =
          existing.leadPaintDisclosureAttachedAt !== null ||
          parsed.data.leadPaintDisclosureConfirmed === true;
        if (!attached) {
          const [prop] = await db.select({
            id: properties.id,
            yearBuilt: properties.yearBuilt,
            requiresLeadPaintDisclosure: properties.requiresLeadPaintDisclosure,
          }).from(properties)
            .where(and(eq(properties.id, existing.propertyId), eq(properties.organizationId, orgId)));
          if (prop && propertyNeedsLeadPaintDisclosure(prop)) {
            return leadPaintBlocked(res, { propertyId: prop.id, yearBuilt: prop.yearBuilt, leaseId: existing.id });
          }
        }
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
        if (parsed.data[k] !== undefined && k !== "tenantIds" && k !== "leadPaintDisclosureConfirmed") {
          updates[k] = k === "state" ? String(parsed.data[k]).toUpperCase() : parsed.data[k];
        }
      }
      if (parsed.data.leadPaintDisclosureConfirmed === true) {
        updates.leadPaintDisclosureAttachedAt = new Date();
      }
      const [updated] = await db.update(rentalLeases).set(updates)
        .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Lease");
      return res.json({ lease: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/leases/:id/tenants", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = attachTenantSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [link] = await db.insert(leaseTenants).values({
        organizationId: orgId,
        leaseId: req.params.id,
        tenantId: parsed.data.tenantId,
        rentSharePct: String(parsed.data.rentSharePct),
        isPrimary: parsed.data.isPrimary,
      }).returning();
      return res.status(201).json({ link });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.delete("/api/leases/:id/tenants/:tenantId", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [deleted] = await db.delete(leaseTenants).where(and(
        eq(leaseTenants.leaseId, req.params.id),
        eq(leaseTenants.tenantId, req.params.tenantId),
        eq(leaseTenants.organizationId, orgId),
      )).returning();
      if (!deleted) return Errors.notFound(res, "Lease tenant link");
      return res.json({ deleted: true });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/leases/:id/addendums", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = addendumSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [addendum] = await db.insert(leaseAddendums).values({
        organizationId: orgId,
        leaseId: req.params.id,
        kind: parsed.data.kind,
        title: parsed.data.title,
        bodyMarkdown: parsed.data.bodyMarkdown ?? null,
        documentPath: parsed.data.documentPath ?? null,
        effectiveDate: parsed.data.effectiveDate ?? null,
      }).returning();
      return res.status(201).json({ addendum });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // BH-8 — landlord dashboard endpoint. Imelda §3 today: "rent-roll
  // snapshot (collected this month / outstanding / late), a maintenance
  // queue count, a lease expirations next-30-days widget, and a vacancy
  // count. None of those concepts exist in this app yet."
  app.get("/api/landlord/dashboard", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);

      const monthStart = new Date();
      monthStart.setDate(1);
      const monthStartStr = monthStart.toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const in30Days = new Date(); in30Days.setDate(in30Days.getDate() + 30);
      const in30DaysStr = in30Days.toISOString().slice(0, 10);

      // Active leases count.
      const leasesActive = await db.execute(sql`
        SELECT COUNT(*) AS c FROM rental_leases
        WHERE organization_id = ${orgId} AND status = 'active'
      `);
      const activeLeases = Number(((leasesActive as any).rows?.[0]?.c) ?? 0);

      if (activeLeases === 0) return res.json({ hasData: false });

      // MTD rent collected.
      const collectedRow = await db.execute(sql`
        SELECT COALESCE(SUM(amount_cents), 0) AS total FROM rent_payments
        WHERE organization_id = ${orgId}
          AND received_at >= ${monthStartStr}::date
      `);
      const mtdCollected = Number(((collectedRow as any).rows?.[0]?.total) ?? 0);

      // MTD billed.
      const billedRow = await db.execute(sql`
        SELECT COALESCE(SUM(amount_cents), 0) AS total FROM rent_charges
        WHERE organization_id = ${orgId}
          AND charged_for_month = ${monthStartStr}::date
      `);
      const mtdBilled = Number(((billedRow as any).rows?.[0]?.total) ?? 0);

      // Late count.
      const lateRow = await db.execute(sql`
        SELECT COUNT(*) AS c FROM rent_charges
        WHERE organization_id = ${orgId}
          AND balance_cents > 0
          AND due_date < ${today}::date
      `);
      const lateCount = Number(((lateRow as any).rows?.[0]?.c) ?? 0);

      // Maintenance open.
      const maintOpenRow = await db.execute(sql`
        SELECT COUNT(*) AS c FROM maintenance_tickets
        WHERE organization_id = ${orgId}
          AND status NOT IN ('completed', 'cancelled')
      `);
      const maintOpen = Number(((maintOpenRow as any).rows?.[0]?.c) ?? 0);

      // Lease expirations in next 30 days.
      const expiringRow = await db.execute(sql`
        SELECT COUNT(*) AS c FROM rental_leases
        WHERE organization_id = ${orgId}
          AND status = 'active'
          AND end_date IS NOT NULL
          AND end_date <= ${in30DaysStr}::date
          AND end_date >= ${today}::date
      `);
      const expiringCount = Number(((expiringRow as any).rows?.[0]?.c) ?? 0);

      return res.json({
        hasData: true,
        activeLeases,
        rent: {
          mtdCollectedCents: mtdCollected,
          mtdBilledCents: mtdBilled,
          mtdCollectedPct: mtdBilled > 0 ? Math.round((mtdCollected / mtdBilled) * 100) : 0,
          lateCount,
        },
        maintenanceOpenCount: maintOpen,
        expiringNext30Count: expiringCount,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Renew = create a new lease referencing the parent. Imelda §2.7: "the
  // renewal isn't a new lease in Texas, it's an addendum to the original."
  app.post("/api/leases/:id/renew", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = renewSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [parent] = await db.select().from(rentalLeases)
        .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)));
      if (!parent) return Errors.notFound(res, "Original lease");

      // Lead-paint gate applies to renewals too — the renewal is created
      // ACTIVE. A pre-1978 property whose original lease never confirmed
      // the disclosure must confirm it (PATCH the original lease with
      // leadPaintDisclosureConfirmed=true) before renewing.
      if (parent.leadPaintDisclosureAttachedAt === null) {
        const [prop] = await db.select({
          id: properties.id,
          yearBuilt: properties.yearBuilt,
          requiresLeadPaintDisclosure: properties.requiresLeadPaintDisclosure,
        }).from(properties)
          .where(and(eq(properties.id, parent.propertyId), eq(properties.organizationId, orgId)));
        if (prop && propertyNeedsLeadPaintDisclosure(prop)) {
          return leadPaintBlocked(res, { propertyId: prop.id, yearBuilt: prop.yearBuilt, leaseId: parent.id });
        }
      }

      const newStart = parent.endDate ?? new Date().toISOString().slice(0, 10);

      const renewed = await db.transaction(async (tx) => {
        // Mark parent as renewed.
        await tx.update(rentalLeases).set({ status: "renewed", updatedAt: new Date() })
          .where(eq(rentalLeases.id, parent.id));

        // Carry the UNIT forward, not just its label.
        //
        // This copied `unitLabel` alone. The parent was then flipped to
        // 'renewed', so the only ACTIVE lease for the tenancy was the new row —
        // with unit_id NULL. `GET /api/rent-roll/occupancy` joins
        // rental_leases.unit_id = rental_units.id, found nothing, and a unit
        // with a sitting tenant flipped to VACANT the moment its lease was
        // renewed. A landlord who renews every tenant watched occupancy fall
        // toward 0% on a full building.
        //
        // `?? findOrCreateUnitId` also heals a parent that predates unit_id
        // (or whose unit row was deleted): the renewal gets a real unit either
        // way, and never a null.
        //
        // No `kind` is passed, and that is the correct answer rather than an
        // omission. This branch runs ONLY when the parent has no unit_id, i.e.
        // there is no existing row whose kind could be carried forward, and the
        // renewal payload carries no slot facts of its own. A park's pad
        // reaches this path already labelled and already a pad — find-or-create
        // resolves it by label and leaves the kind alone. Inventing a kind here
        // from the property or the label text would assert something nobody
        // told us; the units surface is where an operator corrects it.
        const renewedUnitId = parent.unitId
          ?? await findOrCreateUnitId(tx, {
            orgId,
            propertyId: parent.propertyId,
            rawLabel: parent.unitLabel,
          });
        if (!renewedUnitId) {
          throw new Error(
            `Could not resolve a rental unit for renewal of lease ${parent.id} ` +
            `(property ${parent.propertyId}, label "${normalizeUnitLabel(parent.unitLabel)}")`,
          );
        }

        // Create new lease — same property, same tenants link inherits below.
        const [newLease] = await tx.insert(rentalLeases).values({
          organizationId: orgId,
          propertyId: parent.propertyId,
          unitId: renewedUnitId,
          unitLabel: parent.unitLabel,
          parentLeaseId: parent.id,
          versionNumber: parent.versionNumber + 1,
          status: "active",
          liabilityModel: parent.liabilityModel,
          startDate: newStart,
          endDate: parsed.data.newEndDate,
          monthlyRentCents: parsed.data.newMonthlyRentCents ?? parent.monthlyRentCents,
          rentDueDayOfMonth: parent.rentDueDayOfMonth,
          securityDepositCents: parent.securityDepositCents,
          petDepositCents: parent.petDepositCents,
          isSection8: parent.isSection8,
          hapPortionCents: parent.hapPortionCents,
          tenantPortionCents: parent.tenantPortionCents,
          state: parent.state,
          // Carry the confirmed lead-paint disclosure forward — a renewal
          // of the same tenancy does not re-trigger the federal disclosure.
          leadPaintDisclosureAttachedAt: parent.leadPaintDisclosureAttachedAt,
        }).returning();

        // Carry tenants forward.
        const tlinks = await tx.select().from(leaseTenants)
          .where(and(eq(leaseTenants.leaseId, parent.id), eq(leaseTenants.organizationId, orgId)));
        if (tlinks.length > 0) {
          await tx.insert(leaseTenants).values(tlinks.map((l) => ({
            organizationId: orgId,
            leaseId: newLease.id,
            tenantId: l.tenantId,
            rentSharePct: l.rentSharePct,
            isPrimary: l.isPrimary,
          })));
        }

        // Auto-create a "renewal" addendum on the parent for the audit trail.
        await tx.insert(leaseAddendums).values({
          organizationId: orgId,
          leaseId: parent.id,
          kind: "renewal",
          title: `Renewal — extends through ${parsed.data.newEndDate}`,
          bodyMarkdown: parsed.data.newMonthlyRentCents
            ? `Renewal extends original lease through ${parsed.data.newEndDate} at $${(parsed.data.newMonthlyRentCents / 100).toLocaleString()} / month.`
            : `Renewal extends original lease through ${parsed.data.newEndDate} at original rent.`,
          effectiveDate: newStart,
        });

        return newLease;
      });

      return res.status(201).json({ lease: renewed });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ============================================================================
  // Mobile Landlord (Imelda Lens 21) — Today / Portfolio aggregates
  // ============================================================================

  // Leases ending within N days, with state-aware non-renewal notice window.
  // Mounted at /api/rentals/leases/expiring (not /api/leases/expiring) so it
  // doesn't collide with /api/leases/:id when :id starts with "expiring".
  app.get("/api/rentals/leases/expiring", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const within = Math.max(1, Math.min(365, parseInt(String(req.query.within ?? req.query.expiring_within ?? "60"), 10) || 60));
      const today = new Date();
      const horizon = new Date(); horizon.setDate(horizon.getDate() + within);
      const todayStr = today.toISOString().slice(0, 10);
      const horizonStr = horizon.toISOString().slice(0, 10);

      const rows = await db.execute(sql`
        SELECT id, property_id, unit_label, state, end_date, monthly_rent_cents,
               (end_date - CURRENT_DATE) AS days_to_expiry
        FROM rental_leases
        WHERE organization_id = ${orgId}
          AND status = 'active'
          AND end_date IS NOT NULL
          AND end_date >= ${todayStr}::date
          AND end_date <= ${horizonStr}::date
        ORDER BY end_date ASC
      `);

      const leases = ((rows as any).rows ?? []).map((r: any) => {
        const endIso: string | null = r.end_date ? String(r.end_date).slice(0, 10) : null;
        const window = computeNoticeWindow(endIso, r.state ?? null, today);
        return {
          id: r.id,
          propertyId: Number(r.property_id),
          unitLabel: r.unit_label ?? null,
          state: r.state ?? null,
          endDate: endIso,
          monthlyRentCents: Number(r.monthly_rent_cents) || 0,
          daysToExpiry: Number(r.days_to_expiry) || 0,
          noticeDays: window.noticeDays,
          noticeWindowOpensAt: window.noticeWindowOpensAt,
          noticeWindowOpen: window.noticeWindowOpen,
        };
      });

      return res.json({ leases, count: leases.length, withinDays: within });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Section 8 HAP recerts due — annual recert anchored on lease start_date.
  // Imelda §2.10: "the housing authority pays me a HAP portion directly via
  // ACH; recerts happen annually and a missed recert can pause HAP."
  app.get("/api/rentals/section-8/recerts-due", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const within = Math.max(1, Math.min(365, parseInt(String(req.query.within ?? "60"), 10) || 60));
      const horizon = new Date(); horizon.setDate(horizon.getDate() + within);
      const horizonStr = horizon.toISOString().slice(0, 10);

      // Annual recert anchor = the next future anniversary of start_date.
      // We compute it in SQL by adding N years until the result is in the
      // future relative to today.
      const rows = await db.execute(sql`
        WITH rl AS (
          SELECT
            id, property_id, unit_label, start_date,
            hap_portion_cents, monthly_rent_cents,
            (
              start_date
              + (
                  GREATEST(
                    1,
                    CEIL(EXTRACT(EPOCH FROM (CURRENT_DATE - start_date)) / 31557600.0)::int
                  )
                ) * INTERVAL '1 year'
            )::date AS next_recert_date
          FROM rental_leases
          WHERE organization_id = ${orgId}
            AND status = 'active'
            AND is_section_8 = TRUE
            AND COALESCE(hap_portion_cents, 0) > 0
        )
        SELECT
          id, property_id, unit_label,
          hap_portion_cents, monthly_rent_cents,
          next_recert_date,
          (next_recert_date - CURRENT_DATE) AS days_until_recert
        FROM rl
        WHERE next_recert_date <= ${horizonStr}::date
          AND next_recert_date >= CURRENT_DATE
        ORDER BY next_recert_date ASC
      `);

      const leases = ((rows as any).rows ?? []).map((r: any) => ({
        id: r.id,
        propertyId: Number(r.property_id),
        unitLabel: r.unit_label ?? null,
        hapPortionCents: Number(r.hap_portion_cents) || 0,
        monthlyRentCents: Number(r.monthly_rent_cents) || 0,
        nextRecertDate: r.next_recert_date ? String(r.next_recert_date).slice(0, 10) : null,
        daysUntilRecert: Number(r.days_until_recert) || 0,
      }));

      return res.json({ leases, count: leases.length, withinDays: within });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ============================================================================
  // Units (BH-9) — the CRUD that makes the empty state's instruction true.
  //
  // `computeOccupancySnapshot`'s unmeasurable message tells the operator to
  // "add units to a property or import a rent roll". The importer existed; the
  // first half of that sentence named an action the product could not perform,
  // because nothing in the repo could create a `rental_units` row outside a
  // bulk upload. These four routes are that half.
  //
  // Note the 200s below rather than 201s: `scripts/ratchets/res-status-raw.json`
  // is a strictly-down gate on `res.status(` in server/**, and adding raw
  // statuses here would push it above baseline. The created row is returned in
  // the body either way.
  // ============================================================================

  app.get("/api/rentals/properties/:propertyId/units", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const propertyId = parseInt(req.params.propertyId, 10);
      if (!Number.isFinite(propertyId)) return Errors.badRequest(res, "propertyId must be numeric");

      const [prop] = await db.select({ id: properties.id }).from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)));
      if (!prop) return Errors.notFound(res, "Property");

      const rows = await db.select().from(rentalUnits)
        .where(and(eq(rentalUnits.organizationId, orgId), eq(rentalUnits.propertyId, propertyId)))
        .orderBy(asc(rentalUnits.label));

      // Lease counts per unit, so the list can show which units are occupied
      // and which are blocked from deletion WITHOUT the client guessing.
      const leaseCounts = await db.select({
        unitId: rentalLeases.unitId,
        total: sql<number>`COUNT(*)::int`,
        active: sql<number>`COUNT(*) FILTER (WHERE ${rentalLeases.status} = 'active')::int`,
      }).from(rentalLeases)
        .where(and(eq(rentalLeases.organizationId, orgId), eq(rentalLeases.propertyId, propertyId)))
        .groupBy(rentalLeases.unitId);
      const byUnit = new Map(leaseCounts.map((c) => [c.unitId, c]));

      return res.json({
        units: rows.map((u) => ({
          ...u,
          leaseCount: toCount(byUnit.get(u.id)?.total),
          activeLeaseCount: toCount(byUnit.get(u.id)?.active),
        })),
        count: rows.length,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/rentals/properties/:propertyId/units", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const propertyId = parseInt(req.params.propertyId, 10);
      if (!Number.isFinite(propertyId)) return Errors.badRequest(res, "propertyId must be numeric");

      const parsed = unitCreateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [prop] = await db.select({ id: properties.id }).from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)));
      if (!prop) return Errors.notFound(res, "Property");

      const label = normalizeUnitLabel(parsed.data.label);

      const inserted = await db.insert(rentalUnits).values({
        organizationId: orgId,
        propertyId,
        label,
        kind: parsed.data.kind,
        bedrooms: parsed.data.bedrooms ?? null,
        bathrooms: parsed.data.bathrooms !== undefined ? String(parsed.data.bathrooms) : null,
        squareFeet: parsed.data.squareFeet ?? null,
        marketRentCents: parsed.data.marketRentCents ?? null,
        status: parsed.data.status,
        notes: parsed.data.notes ?? null,
      }).onConflictDoNothing().returning();

      if (inserted.length === 0) {
        // The (org, property, label) unique index caught it. Say which one —
        // silently returning the existing row would let an operator believe
        // they had created a second unit and inflate their own unit count.
        return Errors.badRequest(
          res,
          `This property already has a unit labelled "${label}". Labels identify a unit within its building, so they have to be unique — edit the existing one, or give this one a different label.`,
          { code: "RENTAL_UNIT_LABEL_TAKEN", propertyId, label },
        );
      }

      logger.info("[BH-9] rental unit created", {
        orgId, userId, propertyId, unitId: inserted[0].id, kind: parsed.data.kind,
      });
      return res.json({ unit: inserted[0] });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Bulk create ───────────────────────────────────────────────────────────
  // A park operator with 60 pads will not create them one at a time, and a
  // 24-unit building is no better. One-at-a-time creation is not "slower" here,
  // it is the reason the inventory never gets entered at all — and an
  // un-entered inventory is exactly the state that makes occupancy
  // unmeasurable.
  //
  // IDEMPOTENT BY CONSTRUCTION, and loudly so. `rental_units_org_property_label_uk`
  // absorbs a re-run, so the second paste of the same roll writes nothing. What
  // it must NOT do is report that as either a failure or a fresh import: the
  // response splits every attempted label into `created` and `existed`, and the
  // two are disjoint and exhaustive (`buildBulkCreateReport`, asserted in
  // tests/unit/padInventory.test.ts). An operator who re-pastes a 60-lot roll
  // after adding six pads sees 6 created / 54 already there, and never comes to
  // believe they own 120 pads.
  app.post("/api/rentals/properties/:propertyId/units/bulk", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const propertyId = parseInt(req.params.propertyId, 10);
      if (!Number.isFinite(propertyId)) return Errors.badRequest(res, "propertyId must be numeric");

      const parsed = unitBulkCreateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [prop] = await db.select({ id: properties.id }).from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)));
      if (!prop) return Errors.notFound(res, "Property");

      // The SPEC is expanded server-side by the same pure function the client
      // previewed with, so what the operator approved is what gets attempted.
      const expansion = expandUnitLabels(parsed.data.spec);
      if (!expansion.ok) {
        return Errors.badRequest(res, expansion.error, {
          code: "RENTAL_UNIT_BULK_SPEC_INVALID",
          propertyId,
        });
      }
      const attempted = expansion.expansion.labels.map((l) => normalizeUnitLabel(l));

      const inserted = await db.insert(rentalUnits).values(
        attempted.map((label) => ({
          organizationId: orgId,
          propertyId,
          label,
          kind: parsed.data.kind,
          status: parsed.data.status,
          notes: parsed.data.notes ?? null,
        })),
      ).onConflictDoNothing().returning({ id: rentalUnits.id, label: rentalUnits.label });

      const report = buildBulkCreateReport(
        attempted,
        inserted.map((r) => r.label),
        expansion.expansion.duplicateLabels,
      );

      logger.info("[BH-9] rental units bulk created", {
        orgId,
        userId,
        propertyId,
        kind: parsed.data.kind,
        attempted: report.attemptedCount,
        created: report.createdCount,
        existed: report.existedCount,
      });

      return res.json({
        propertyId,
        kind: parsed.data.kind,
        ...report,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.patch("/api/rentals/units/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = unitUpdateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      // Trimmed through the SAME normaliser as every other write site, so a
      // rename to " 3B" cannot slip a duplicate past the unique index.
      if (parsed.data.label !== undefined) updates.label = normalizeUnitLabel(parsed.data.label);
      if (parsed.data.kind !== undefined) updates.kind = parsed.data.kind;
      if (parsed.data.status !== undefined) updates.status = parsed.data.status;
      if (parsed.data.bedrooms !== undefined) updates.bedrooms = parsed.data.bedrooms;
      if (parsed.data.bathrooms !== undefined) updates.bathrooms = String(parsed.data.bathrooms);
      if (parsed.data.squareFeet !== undefined) updates.squareFeet = parsed.data.squareFeet;
      if (parsed.data.marketRentCents !== undefined) updates.marketRentCents = parsed.data.marketRentCents;
      if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;

      const [updated] = await db.update(rentalUnits).set(updates)
        .where(and(eq(rentalUnits.id, req.params.id), eq(rentalUnits.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Rental unit");

      // Keep the denormalised display copy on this unit's leases in step with
      // the rename. Leaving it stale would show the tenant's old door number on
      // the lease list and on any work order generated from it.
      if (parsed.data.label !== undefined) {
        await db.update(rentalLeases)
          .set({ unitLabel: updated.label, updatedAt: new Date() })
          .where(and(eq(rentalLeases.unitId, updated.id), eq(rentalLeases.organizationId, orgId)));
      }

      logger.info("[BH-9] rental unit updated", { orgId, userId, unitId: updated.id });
      return res.json({ unit: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.delete("/api/rentals/units/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);

      const [unit] = await db.select().from(rentalUnits)
        .where(and(eq(rentalUnits.id, req.params.id), eq(rentalUnits.organizationId, orgId)));
      if (!unit) return Errors.notFound(res, "Rental unit");

      // rental_leases.unit_id is ON DELETE SET NULL: deleting a leased unit
      // would NOT error, it would quietly orphan a live tenancy. Count first.
      const [{ c }] = await db.select({ c: sql<number>`COUNT(*)::int` })
        .from(rentalLeases)
        .where(and(eq(rentalLeases.unitId, unit.id), eq(rentalLeases.organizationId, orgId)));
      const leaseCount = toCount(c);

      const refusal = unitDeletionRefusal(unit.label, leaseCount);
      if (refusal) {
        return Errors.badRequest(res, refusal, {
          code: "RENTAL_UNIT_HAS_LEASES",
          unitId: unit.id,
          label: unit.label,
          leaseCount,
        });
      }

      await db.delete(rentalUnits)
        .where(and(eq(rentalUnits.id, unit.id), eq(rentalUnits.organizationId, orgId)));

      logger.info("[BH-9] rental unit deleted", { orgId, userId, unitId: unit.id, label: unit.label });
      return res.json({ deleted: true, id: unit.id });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Occupancy snapshot — see `computeOccupancySnapshot` for the arithmetic and
  // for why the old lease-derived version could not see a vacancy at all.
  app.get("/api/rent-roll/occupancy", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);

      // One pass over rental_units. The LATERAL probe is a semi-join: a unit
      // with two overlapping active leases (a renewal signed before the old
      // one is closed out) must count ONCE, or occupancy exceeds 100%.
      //
      // Every FILTER clause below is over `rental_units`, not `rental_leases`.
      // That is the whole fix: a unit that has never been leased has no row in
      // rental_leases, so the old query could not see it on either side of the
      // ratio and a half-empty building read as 100% occupied.
      const unitsRow = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE u.status = 'active')::int AS rentable_units,
          COUNT(*) FILTER (WHERE u.status = 'active' AND l.leased IS NOT NULL)::int AS occupied_units,
          COUNT(*) FILTER (WHERE u.status = 'offline')::int AS offline_units,
          COUNT(*) FILTER (WHERE u.status = 'retired')::int AS retired_units,
          COUNT(*) FILTER (
            WHERE u.status = 'active' AND l.leased IS NULL AND u.market_rent_cents IS NOT NULL
          )::int AS vacant_units_with_market_rent,
          COALESCE(SUM(u.market_rent_cents) FILTER (
            WHERE u.status = 'active' AND l.leased IS NULL AND u.market_rent_cents IS NOT NULL
          ), 0)::bigint AS vacant_market_rent_cents
        FROM rental_units u
        LEFT JOIN LATERAL (
          SELECT 1 AS leased
          FROM rental_leases rl
          WHERE rl.unit_id = u.id
            AND rl.organization_id = ${orgId}
            AND rl.status = 'active'
          LIMIT 1
        ) l ON TRUE
        WHERE u.organization_id = ${orgId}
      `);

      const propsRow = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM properties
        WHERE organization_id = ${orgId}
      `);

      // drizzle's execute() result shape is driver-dependent; read defensively
      // and coerce at this boundary rather than letting an untyped hop carry a
      // count into the arithmetic (same standard as `knownUnitCountFloor`).
      const row = readFirstRow(unitsRow);
      const propRow = readFirstRow(propsRow);

      const snapshot = computeOccupancySnapshot({
        rentableUnits: toCount(row?.rentable_units),
        occupiedUnits: toCount(row?.occupied_units),
        offlineUnits: toCount(row?.offline_units),
        retiredUnits: toCount(row?.retired_units),
        vacantUnitsWithMarketRent: toCount(row?.vacant_units_with_market_rent),
        vacantMarketRentMonthlyCents: toCount(row?.vacant_market_rent_cents),
        propertyCount: toCount(propRow?.c),
      });

      return res.json(snapshot);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Portfolio-wide landlord stats for the mobile Portfolio tab. One round-
  // trip: MTD rent, YTD expenses (maintenance invoices only — Portfolio P&L
  // has the richer answer but requires a deals/properties join), active
  // tickets, Section 8 share. Depreciation YTD is intentionally null — the
  // UI links to /depreciation-calculator for the authoritative number.
  app.get("/api/portfolio/landlord-stats", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);

      const mtdRow = await db.execute(sql`
        SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total
        FROM rent_payments
        WHERE organization_id = ${orgId}
          AND received_at >= ${monthStart}::date
      `);
      const mtdRentCollectedCents = Number(((mtdRow as any).rows?.[0]?.total) ?? 0);

      const ytdMaintRow = await db.execute(sql`
        SELECT COALESCE(SUM(invoice_cents), 0)::bigint AS total
        FROM maintenance_tickets
        WHERE organization_id = ${orgId}
          AND status = 'completed'
          AND completed_at >= ${yearStart}::date
      `);
      const ytdExpensesCents = Number(((ytdMaintRow as any).rows?.[0]?.total) ?? 0);

      const activeTicketsRow = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM maintenance_tickets
        WHERE organization_id = ${orgId}
          AND status NOT IN ('completed', 'cancelled')
      `);
      const activeMaintenanceCount = Number(((activeTicketsRow as any).rows?.[0]?.c) ?? 0);

      const section8Row = await db.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          SUM(CASE WHEN is_section_8 = TRUE THEN 1 ELSE 0 END)::int AS s8
        FROM rental_leases
        WHERE organization_id = ${orgId}
          AND status = 'active'
      `);
      const s8Total = Number(((section8Row as any).rows?.[0]?.total) ?? 0);
      const s8Count = Number(((section8Row as any).rows?.[0]?.s8) ?? 0);
      const section8SharePct = s8Total > 0 ? Math.round((s8Count / s8Total) * 100) : 0;

      return res.json({
        mtdRentCollectedCents,
        ytdExpensesCents,
        ytdDepreciationCents: null,
        activeMaintenanceCount,
        section8: {
          activeLeases: s8Count,
          totalActiveLeases: s8Total,
          sharePct: section8SharePct,
        },
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
