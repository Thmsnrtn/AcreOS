// ============================================================================
// SHARED/SCHEMA/RENTAL.TS (BUY-AND-HOLD)
// ----------------------------------------------------------------------------
// Buy-and-hold vertical — tenants, leases, rent charges/payments, late fees,
// maintenance tickets, security deposits, FCRA attestations, screenings.
// Extracted from shared/schema.ts.
// ============================================================================

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  numeric,
  varchar,
  jsonb,
  index,
  uniqueIndex,
  date,
  real,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, properties } from "../schema";

// ============================================================================
// BUY-AND-HOLD VERTICAL — BH-1 schema foundation (Imelda)
// ----------------------------------------------------------------------------
// Imelda's deal-killer (imelda-landlord.md §9): no tenant entity, no lease
// entity, no rent ledger, no maintenance ticketing. "About 80% of my
// operational day has nothing to map onto in this product."
//
// Imelda explicitly warns: "don't half-build this. The middle path —
// shipping a thin tenant table and a fake rent ledger to *say* you do
// landlord — gets people sued."
//
// What we ship in BH-1..BH-9 (and what we explicitly defer):
//
//   SHIP:
//     1. tenants               — minimum-viable entity (Imelda §8.3)
//     2. leases                — including renewal-as-addendum modeling
//     3. lease_addendums       — pet, lead-paint, mold, Section 8 etc.
//     4. rent_charges          — recurring rent obligation per lease
//     5. rent_payments         — partial-payment-aware ledger
//     6. late_fee_rules        — state-specific (TX/CA/NY/FL/GA seed)
//     7. maintenance_tickets   — tenant → landlord → vendor
//     8. move_inspections      — move-in/move-out w/ photos + signature
//     9. security_deposits     — held/applied ledger w/ statutory timing
//
//   DEFER (explicit; Imelda flags each as legally fraught):
//     - Tenant screening + FCRA adverse-action notices
//     - Eviction notice generator (state-specific legal forms)
//     - Section 8 / HAP contract handling
//     - Plaid bank-account aggregation
//
// The deferred surfaces will land when the platform has dedicated legal
// review. Shipping them carelessly (Imelda §2.16: "you've helped a
// landlord file a defective notice") is worse than shipping nothing.
// ============================================================================

// ----------------------------------------------------------------------------
// TENANTS — Imelda §2.6: "When I'm talking to a tenant applicant, anything
// I write down is FCRA-discoverable in an adverse-action dispute. […]
// Cramming both into one `leads` table is how you end up with a
// fair-housing complaint."
//
// Tenants live in their own table, separate from leads. FCRA-relevant
// fields (consumer-report flags, applicant outcome) are explicitly
// scoped — operators record only structured outcomes, not free-form
// "seems unstable" notes.
// ----------------------------------------------------------------------------

export const TENANT_STATUSES = [
  "applicant",          // pre-screening
  "approved",           // approved, pre-lease
  "active",             // currently leased
  "former",             // moved out
  "denied",             // application denied (FCRA adverse-action triggered)
  "eviction",           // eviction filed
] as const;
export type TenantStatus = typeof TENANT_STATUSES[number];

// RS-1 (post-may1-resweep): per-lookup permissible-purpose attestation
// table. Cordelia §3 + Caspian §1: every tenant-screening lookup must
// record purpose + requesting user + attestation version BEFORE the
// screening fields on `tenants` are updated. Without this row the route
// guards reject the screening update.
//
// FCRA permissible purposes (15 USC §1681b):
//   - tenant_screening   — application for residential lease
//   - account_review     — periodic review of existing tenant
//   - written_consent    — applicant gave explicit written consent
//   - legitimate_business_need — narrow; document the need
export const tenantScreenings = pgTable(
  "tenant_screenings",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    tenantId: varchar("tenant_id").notNull(),
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "set null" }),

    // Cordelia §3 attestation
    purposeOfUse: text("purpose_of_use").notNull(),  // tenant_screening | account_review | written_consent | legitimate_business_need
    purposeJustification: text("purpose_justification"),  // free text when purpose=legitimate_business_need
    requestingUserId: text("requesting_user_id").notNull(),  // id of operator who attested
    attestationVersion: text("attestation_version").notNull(),  // bumped when terms-of-use change
    attestedAt: timestamp("attested_at", { withTimezone: true }).defaultNow().notNull(),

    // Outcome (set after the lookup completes)
    outcome: text("outcome"),  // approved | denied | pending
    creditScore: integer("credit_score"),
    hasPriorEviction: boolean("has_prior_eviction"),
    hasCriminalRecord: boolean("has_criminal_record"),
    incomeMonthlyCents: bigint("income_monthly_cents", { mode: "number" }),
    criteriaMet: boolean("criteria_met"),

    // CRA / vendor — when integrated. For self-input today, leave null.
    craUsed: text("cra_used"),  // e.g. 'transunion_smartmove'
    craReportId: text("cra_report_id"),

    // FCRA adverse-action notice tracking
    adverseActionNoticeSentAt: timestamp("adverse_action_notice_sent_at", { withTimezone: true }),
    adverseActionTemplateVersion: text("adverse_action_template_version"),
    adverseActionDeliveryStatus: text("adverse_action_delivery_status"),  // sent | delivered | bounced | undeliverable

    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("tenant_screenings_org_tenant_idx").on(table.organizationId, table.tenantId),
    index("tenant_screenings_org_attested_idx").on(table.organizationId, table.attestedAt),
    index("tenant_screenings_outcome_idx").on(table.organizationId, table.outcome),
  ],
);

export type TenantScreening = typeof tenantScreenings.$inferSelect;
export type InsertTenantScreening = typeof tenantScreenings.$inferInsert;

// RS-1: org-level FCRA attestation timestamp + version. Operators
// re-attest annually (>365d-stale rejects the screening route).
export const fcraAttestations = pgTable(
  "fcra_attestations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    userId: text("user_id").notNull(),
    attestationVersion: text("attestation_version").notNull(),
    attestedAt: timestamp("attested_at", { withTimezone: true }).defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // FW-WYNNE-2 (push-forward 2026-05-08): substantive attestation
    // form. Replaces the bare-checkbox shape with structured intent.
    // jsonb so we can evolve the form without schema churn. NULL ⇒
    // legacy checkbox-only attestation.
    substantiveForm: jsonb("substantive_form").$type<{
      permissiblePurpose: "tenant_screening" | "skip_trace" | "account_review" | "written_consent" | "legitimate_business_need" | "collection";
      specificUseCase: string; // free-text 50+ chars
      dataCategoriesUsed: string[]; // ["credit", "criminal", "eviction", "income", "address", "phone", "email"]
      operatorRole: string; // "owner" | "property_manager" | "leasing_agent" | "screening_specialist"
      acknowledgedAdverseActionDuty: boolean;
      acknowledgedDataRetentionPolicy: boolean;
    }>(),
  },
  (table) => [
    index("fcra_attestations_org_user_idx").on(table.organizationId, table.userId),
    index("fcra_attestations_attested_idx").on(table.organizationId, table.attestedAt),
  ],
);

export type FcraAttestation = typeof fcraAttestations.$inferSelect;
export type InsertFcraAttestation = typeof fcraAttestations.$inferInsert;

export const tenants = pgTable(
  "tenants",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),

    // Identity
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    // SMS/TCPA consent — Imelda §3 inbox: "TCPA exposure on landlord SMS
    // is real, and several PMs have been sued."
    smsConsent: boolean("sms_consent").notNull().default(false),
    smsConsentAt: timestamp("sms_consent_at", { withTimezone: true }),

    // Encrypted Tax ID for 1099 if vendor (rare for tenants but supported)
    dateOfBirth: date("date_of_birth"),  // for screening + age verification
    governmentIdLast4: text("government_id_last4"),  // mask only

    // Pipeline
    status: text("status").$type<TenantStatus>().notNull().default("applicant"),
    sourceChannel: text("source_channel"),  // 'zillow' | 'apartments_com' | 'avail' | 'website' | 'referral' | 'walk_in'

    // Structured screening result — Imelda §2.6: "I cannot write 'seems
    // unstable' in a tenant-applicant note. I can write 'credit score 612,
    // prior eviction 2022, denied per company criteria.'"
    screeningCompletedAt: timestamp("screening_completed_at", { withTimezone: true }),
    screeningCreditScore: integer("screening_credit_score"),
    screeningHasPriorEviction: boolean("screening_has_prior_eviction"),
    screeningHasCriminalRecord: boolean("screening_has_criminal_record"),
    screeningIncomeMonthlyCents: bigint("screening_income_monthly_cents", { mode: "number" }),
    screeningCriteriaMet: boolean("screening_criteria_met"),
    // FCRA adverse-action: when status='denied', this is the timestamp of
    // the adverse-action notice send (Imelda §2.5: "$100-1,000 per violation
    // plus attorney fees").
    adverseActionNoticeSentAt: timestamp("adverse_action_notice_sent_at", { withTimezone: true }),

    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("tenants_org_status_idx").on(table.organizationId, table.status),
    index("tenants_org_email_idx").on(table.organizationId, table.email),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

// ----------------------------------------------------------------------------
// LEASES — Imelda §2.7: "the renewal isn't a new lease in Texas, it's an
// addendum to the original. The signing system needs to model 'lease +
// amendments over time' and let me see version 1, 2, 3 of a tenancy
// without losing the original."
// ----------------------------------------------------------------------------

export const LEASE_STATUSES = [
  "draft",
  "pending_signature",
  "active",
  "ended",
  "terminated",        // ended early — eviction or break-lease
  "renewed",           // superseded by a renewal lease (parent)
] as const;
export type LeaseStatus = typeof LEASE_STATUSES[number];

export const LEASE_LIABILITY_MODELS = [
  "joint_and_several",  // 3 grad students share, all liable for full rent
  "per_unit",           // 4-plex: tenant per unit, separately liable
] as const;
export type LeaseLiabilityModel = typeof LEASE_LIABILITY_MODELS[number];

// Note: there's a pre-existing thin `leases` stub at line ~12886 that
// predates the buy-and-hold vertical. We name the new full-fidelity table
// `rental_leases` to avoid the collision; the legacy `leases` table stays
// for the routes-maintenance.ts reference and can be removed in a future
// cleanup PR.
export const rentalLeases = pgTable(
  "rental_leases",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "cascade" }).notNull(),

    // For multi-unit: which unit on the property. Null for SFR.
    unitLabel: text("unit_label"),

    // Lease lineage — renewals reference the parent lease.
    parentLeaseId: varchar("parent_lease_id"),  // soft FK to self
    versionNumber: integer("version_number").notNull().default(1),

    status: text("status").$type<LeaseStatus>().notNull().default("draft"),
    liabilityModel: text("liability_model").$type<LeaseLiabilityModel>().notNull().default("joint_and_several"),

    startDate: date("start_date").notNull(),
    endDate: date("end_date"),  // null = month-to-month

    monthlyRentCents: bigint("monthly_rent_cents", { mode: "number" }).notNull(),
    rentDueDayOfMonth: integer("rent_due_day_of_month").notNull().default(1),
    securityDepositCents: bigint("security_deposit_cents", { mode: "number" }).notNull().default(0),
    petDepositCents: bigint("pet_deposit_cents", { mode: "number" }).notNull().default(0),

    // Section 8 — Imelda §2.10: "the housing authority pays me a HAP
    // portion (say $1,100) directly via ACH on the 1st. The tenant pays me
    // a tenant portion (say $300)." Two payors with different schedules.
    // We model the splits but do NOT ship the HUD-specific recert /
    // failed-inspection workflow in this PR (Imelda's deferred list).
    isSection8: boolean("is_section_8").notNull().default(false),
    hapPortionCents: bigint("hap_portion_cents", { mode: "number" }),
    tenantPortionCents: bigint("tenant_portion_cents", { mode: "number" }),

    state: text("state").notNull(),  // for late-fee rule lookup
    notes: text("notes"),

    // Glenn Okonkwo audit: hard-gated when properties.requiresLeadPaintDisclosure
    // is true. The lease cannot transition to 'pending_signature' / 'active'
    // without a confirmed lead_paint addendum (federal 24 CFR §35.92).
    leadPaintDisclosureAttachedAt: timestamp("lead_paint_disclosure_attached_at", { withTimezone: true }),

    // ── E-sign wiring (Wave D) ────────────────────────────────────────────
    // `pending_signature` existed as a lease status and the HMAC signing rail
    // (generated_documents + signers[] + signing_consent_audit) existed
    // separately; nothing joined them, so a lease could sit in
    // 'pending_signature' forever with no document, no signer and no consent
    // trail. These columns ARE the join.
    //
    // Legal signing is a founder/operator-only hard stop: nothing here is ever
    // written by an automation. `signaturePacketSentAt` + `signatureRequestedBy`
    // record WHO initiated and WHEN, and AcreOS never delivers the packet —
    // the operator distributes the signing links on their own identity (no
    // re-fronting platform send rails).
    signingDocumentId: integer("signing_document_id"),  // soft FK → generated_documents.id
    signaturePacketSentAt: timestamp("signature_packet_sent_at", { withTimezone: true }),
    signatureRequestedBy: text("signature_requested_by"),  // user id of the operator who initiated
    // Stamped only once every signer has signed AND an E-SIGN §101(c) consent
    // audit row exists for each of them. Never inferred.
    executedAt: timestamp("executed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("rental_leases_org_status_idx").on(table.organizationId, table.status),
    index("rental_leases_property_idx").on(table.propertyId, table.status),
    index("rental_leases_parent_idx").on(table.parentLeaseId),
    index("rental_leases_org_signing_doc_idx").on(table.organizationId, table.signingDocumentId),
  ],
);

export type RentalLease = typeof rentalLeases.$inferSelect;
export type InsertRentalLease = typeof rentalLeases.$inferInsert;

// Many-to-many between tenants and leases (joint-and-several has multiple
// tenants per lease). The percentage column lets per-unit liability
// allocate rent across separately-liable tenants.
export const leaseTenants = pgTable(
  "lease_tenants",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    leaseId: varchar("lease_id").notNull(),
    tenantId: varchar("tenant_id").notNull(),
    rentSharePct: numeric("rent_share_pct").notNull().default("1"),  // 1.0 for joint, 0.5/0.5 etc for per_unit
    isPrimary: boolean("is_primary").notNull().default(true),
    // Glenn Okonkwo audit: joint-and-several liability requires EXPLICIT
    // per-tenant consent in most jurisdictions. Defaulting every co-tenant
    // to "yes, I will pay the other tenants' rent if they default" is how
    // a judge sets aside cross-collection in landlord/tenant court.
    // Default false — operator must affirm per-tenant before relying on
    // the lease's liabilityModel='joint_and_several' for collection.
    holdsJointAndSeveral: boolean("holds_joint_and_several").notNull().default(false),
    jointAndSeveralAcknowledgedAt: timestamp("joint_and_several_acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("lease_tenants_lease_tenant_uk").on(table.leaseId, table.tenantId),
    index("lease_tenants_org_idx").on(table.organizationId),
  ],
);

export type LeaseTenant = typeof leaseTenants.$inferSelect;
export type InsertLeaseTenant = typeof leaseTenants.$inferInsert;

export const LEASE_ADDENDUM_KINDS = [
  "lead_paint",         // FEDERAL — pre-1978 properties, EPA $16K/violation
  "pet",
  "smoking",
  "mold",
  "bedbug",
  "smoke_detector",
  "section_8_hap",
  "renewal",            // amendment extending the original lease
  "rent_increase",
  "early_termination",
  "other",
] as const;
export type LeaseAddendumKind = typeof LEASE_ADDENDUM_KINDS[number];

export const leaseAddendums = pgTable(
  "lease_addendums",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    leaseId: varchar("lease_id").notNull(),
    kind: text("kind").$type<LeaseAddendumKind>().notNull(),
    title: text("title").notNull(),
    bodyMarkdown: text("body_markdown"),
    documentPath: text("document_path"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    effectiveDate: date("effective_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("lease_addendums_lease_idx").on(table.leaseId, table.kind),
  ],
);

export type LeaseAddendum = typeof leaseAddendums.$inferSelect;
export type InsertLeaseAddendum = typeof leaseAddendums.$inferInsert;

// ----------------------------------------------------------------------------
// RENT LEDGER — Imelda §2.4: "Maria in Unit 3B owes $1,400 and pays $700
// on the 5th and $700 on the 18th, my system needs to know that the first
// $700 doesn't satisfy the rent and doesn't stop the late-fee clock unless
// I say so."
// ----------------------------------------------------------------------------

export const rentCharges = pgTable(
  "rent_charges",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    leaseId: varchar("lease_id").notNull(),

    // The month the rent is charged for (always day 1).
    chargedForMonth: date("charged_for_month").notNull(),
    dueDate: date("due_date").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    // For Section 8: hap_portion + tenant_portion when applicable.
    hapPortionCents: bigint("hap_portion_cents", { mode: "number" }),
    tenantPortionCents: bigint("tenant_portion_cents", { mode: "number" }),

    // Updated as payments come in. balance_cents = amount_cents -
    // sum(payments).
    paidCents: bigint("paid_cents", { mode: "number" }).notNull().default(0),
    balanceCents: bigint("balance_cents", { mode: "number" }).notNull(),

    // Late-fee accrual.
    lateFeeCents: bigint("late_fee_cents", { mode: "number" }).notNull().default(0),
    lateFeeAppliedAt: timestamp("late_fee_applied_at", { withTimezone: true }),

    // Imelda §2.5: "accepting partial rent after filing a notice to vacate
    // can void the notice and force me to start over." Track legal posture.
    legalPosture: text("legal_posture").notNull().default("ok"),  // 'ok' | 'late' | 'notice_served' | 'eviction_filed'
    legalPostureAt: timestamp("legal_posture_at", { withTimezone: true }),

    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("rent_charges_lease_month_uk").on(table.leaseId, table.chargedForMonth),
    index("rent_charges_org_balance_idx").on(table.organizationId, table.balanceCents, table.dueDate),
  ],
);

export type RentCharge = typeof rentCharges.$inferSelect;
export type InsertRentCharge = typeof rentCharges.$inferInsert;

export const rentPayments = pgTable(
  "rent_payments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    leaseId: varchar("lease_id").notNull(),
    rentChargeId: varchar("rent_charge_id"),  // nullable — payment may not apply to a specific month yet

    // Source: 'tenant' | 'hap' (housing authority for Section 8)
    payorType: text("payor_type").notNull().default("tenant"),
    payorTenantId: varchar("payor_tenant_id"),  // for joint leases — which tenant paid

    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    receivedAt: date("received_at").notNull(),
    method: text("method"),  // 'ach' | 'check' | 'cash' | 'card' | 'money_order' | 'other'
    referenceNumber: text("reference_number"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),

    // Partial payment handling — operator confirms acceptance.
    isPartial: boolean("is_partial").notNull().default(false),
    acceptedDespitePartial: boolean("accepted_despite_partial"),

    // ── Multi-charge allocation (Wave D) ──────────────────────────────────
    // A payment used to credit exactly ONE charge (the oldest open one) and
    // silently swallow any excess via max(0, …). It now spreads across every
    // open charge; `rentChargeId` above keeps pointing at the FIRST (oldest)
    // charge touched for backwards compatibility, and the authoritative
    // breakdown lives in rent_payment_allocations.
    allocatedCents: bigint("allocated_cents", { mode: "number" }).notNull().default(0),
    // Money that outlived every open charge. Held as an explicit credit rather
    // than absorbed into a balance or dropped.
    unappliedCents: bigint("unapplied_cents", { mode: "number" }).notNull().default(0),
    allocationOrderRule: text("allocation_order_rule"),  // see shared/rental/paymentAllocation.ts

    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("rent_payments_lease_idx").on(table.leaseId, table.receivedAt),
    index("rent_payments_charge_idx").on(table.rentChargeId),
    index("rent_payments_org_received_idx").on(table.organizationId, table.receivedAt),
  ],
);

export type RentPayment = typeof rentPayments.$inferSelect;
export type InsertRentPayment = typeof rentPayments.$inferInsert;

// ----------------------------------------------------------------------------
// RENT PAYMENT ALLOCATIONS — one row per (payment, charge) line.
// ----------------------------------------------------------------------------
// Why this needs a table and not a rollup column: a rent balance is an
// assertion a landlord makes to a tenant, and in a dispute the question is
// never "what is the balance" but "how did you get that balance". A tenant who
// paid $2,800 against three open months is entitled to know which month each
// dollar cured and how much of it went to a late fee rather than to rent. That
// is per-(payment, charge) data with a per-line rent/fee split; no aggregate on
// rent_charges or rent_payments can reconstruct it after the fact.
//
// Rows are append-only history: they are written inside the payment
// transaction and never mutated afterwards. The ORDER (oldest charge first,
// rent before late fees) is stamped on every line so a ledger read can explain
// itself even if the allocation rule is ever revised.
export const rentPaymentAllocations = pgTable(
  "rent_payment_allocations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    paymentId: varchar("payment_id").notNull(),   // soft FK → rent_payments.id
    rentChargeId: varchar("rent_charge_id").notNull(),  // soft FK → rent_charges.id
    leaseId: varchar("lease_id").notNull(),

    /** 1-based position in the application order — a readable ledger line. */
    sequence: integer("sequence").notNull(),
    appliedToRentCents: bigint("applied_to_rent_cents", { mode: "number" }).notNull(),
    appliedToLateFeeCents: bigint("applied_to_late_fee_cents", { mode: "number" }).notNull(),
    appliedCents: bigint("applied_cents", { mode: "number" }).notNull(),
    balanceBeforeCents: bigint("balance_before_cents", { mode: "number" }).notNull(),
    balanceAfterCents: bigint("balance_after_cents", { mode: "number" }).notNull(),

    /** Identifier of the ordering rule that produced this line. */
    orderRule: text("order_rule").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Org-LEADING composite (L3 shard-readiness lint) + the dominant read:
    // "every allocation line for this payment, in order".
    index("rent_payment_allocations_org_payment_idx").on(table.organizationId, table.paymentId, table.sequence),
    // "every payment that touched this charge" — the ledger's explain view.
    index("rent_payment_allocations_org_charge_idx").on(table.organizationId, table.rentChargeId),
    index("rent_payment_allocations_lease_idx").on(table.leaseId),
    // A payment may touch a charge at most once per allocation run.
    uniqueIndex("rent_payment_allocations_payment_charge_uk").on(table.paymentId, table.rentChargeId),
  ],
);

export type RentPaymentAllocation = typeof rentPaymentAllocations.$inferSelect;
export type InsertRentPaymentAllocation = typeof rentPaymentAllocations.$inferInsert;

// State late-fee rules — Imelda §2.4: "in Texas, late fees are now capped
// at 12% of monthly rent for properties with 4+ units, 10% for fewer,
// after a 2-day grace. That's a state-specific rule."
export const lateFeeRules = pgTable(
  "late_fee_rules",
  {
    state: text("state").primaryKey(),  // 2-letter
    capPctSmallProperty: numeric("cap_pct_small_property"),    // < 4 units
    capPctLargeProperty: numeric("cap_pct_large_property"),    // 4+ units
    capFlatCents: bigint("cap_flat_cents", { mode: "number" }),  // some states cap absolute
    graceDays: integer("grace_days").notNull().default(0),
    initialFeeCents: bigint("initial_fee_cents", { mode: "number" }),  // optional flat initial
    perDayCents: bigint("per_day_cents", { mode: "number" }),          // optional per-day after grace
    citation: text("citation"),
    summary: text("summary"),
    attorneyReviewedAt: timestamp("attorney_reviewed_at", { withTimezone: true }),
    attorneyReviewedBy: text("attorney_reviewed_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export type LateFeeRule = typeof lateFeeRules.$inferSelect;
export type InsertLateFeeRule = typeof lateFeeRules.$inferInsert;

// ----------------------------------------------------------------------------
// MAINTENANCE TICKETS — Imelda §2.8: "Buildium has a tenant portal where my
// tenant submits a leaky disposal with a photo, it routes to me, I dispatch
// to my plumber Roberto, Roberto closes the ticket with an invoice, the
// invoice posts to that property's expense ledger. That's a four-actor
// workflow (tenant, landlord, vendor, accountant). AcreOS has none of
// those actors except landlord."
//
// FF-3 already shipped contractors (vendor entity + W-9 + 1099-NEC), so we
// reuse that here as the vendor side.
// ----------------------------------------------------------------------------

export const TICKET_STATUSES = [
  "open",
  "triaging",
  "dispatched",
  "in_progress",
  "awaiting_parts",
  "completed",
  "cancelled",
] as const;
export type TicketStatus = typeof TICKET_STATUSES[number];

export const TICKET_SEVERITIES = [
  "emergency",       // no heat / no water / sewage backup / fire risk
  "urgent",          // appliance fail, locked out
  "standard",        // routine repair
  "cosmetic",        // paint, scuff
] as const;
export type TicketSeverity = typeof TICKET_SEVERITIES[number];

export const maintenanceTickets = pgTable(
  "maintenance_tickets",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "cascade" }).notNull(),
    leaseId: varchar("lease_id"),
    submittedByTenantId: varchar("submitted_by_tenant_id"),

    title: text("title").notNull(),
    description: text("description"),
    category: text("category"),  // 'plumbing' | 'hvac' | 'electrical' | 'appliance' | 'roof' | 'landscaping' | 'pest' | 'other'
    severity: text("severity").$type<TicketSeverity>().notNull().default("standard"),
    status: text("status").$type<TicketStatus>().notNull().default("open"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    assignedContractorId: varchar("assigned_contractor_id"),  // FK to contractors (FF-3)
    repairNotes: text("repair_notes"),
    invoiceCents: bigint("invoice_cents", { mode: "number" }),
    invoicePaidAt: timestamp("invoice_paid_at", { withTimezone: true }),

    photos: jsonb("photos").$type<Array<{ url: string; caption?: string; timestamp?: string }>>().default([]),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("maintenance_tickets_org_status_idx").on(table.organizationId, table.status, table.severity),
    index("maintenance_tickets_property_idx").on(table.propertyId, table.status),
    index("maintenance_tickets_contractor_idx").on(table.assignedContractorId),
  ],
);

export type MaintenanceTicket = typeof maintenanceTickets.$inferSelect;
export type InsertMaintenanceTicket = typeof maintenanceTickets.$inferInsert;

// ----------------------------------------------------------------------------
// MOVE-IN / MOVE-OUT INSPECTIONS — Imelda §8.1: "Lowest effort, highest
// visible value. The infra exists. Add a 'tenant signature' step (use the
// existing HMAC signing) and an attachment to a property record."
// ----------------------------------------------------------------------------

export const INSPECTION_KINDS = ["move_in", "move_out", "annual", "drive_by"] as const;
export type InspectionKind = typeof INSPECTION_KINDS[number];

export const moveInspections = pgTable(
  "move_inspections",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "cascade" }).notNull(),
    leaseId: varchar("lease_id"),
    tenantId: varchar("tenant_id"),

    kind: text("kind").$type<InspectionKind>().notNull(),
    inspectionDate: date("inspection_date").notNull(),
    conductedBy: text("conducted_by"),

    // Checklist items per area: { area: string; condition: 'good'|'fair'|'damaged'; notes?: string; photoCount?: number }
    checklist: jsonb("checklist").$type<Array<{
      area: string;
      condition: "excellent" | "good" | "fair" | "damaged";
      notes?: string;
      photoCount?: number;
    }>>().notNull().default([]),
    photos: jsonb("photos").$type<Array<{ url: string; caption?: string; area?: string; timestamp?: string }>>().notNull().default([]),
    // Glenn Okonkwo audit: photo count is hard-gated at lease execution.
    // Without timestamped photos, security-deposit deduction defenses are
    // weak — the tenant's attorney argues "you can't prove what condition
    // the unit was in." A move-in inspection MUST have ≥ 1 photo to count.
    photoCount: integer("photo_count").notNull().default(0),

    tenantSignedAt: timestamp("tenant_signed_at", { withTimezone: true }),
    landlordSignedAt: timestamp("landlord_signed_at", { withTimezone: true }),
    signingPacketId: varchar("signing_packet_id"),  // HMAC signing flow id

    // Move-out: damages tally for security-deposit deduction.
    damagesTotalCents: bigint("damages_total_cents", { mode: "number" }),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("move_inspections_property_idx").on(table.propertyId, table.kind),
    index("move_inspections_lease_idx").on(table.leaseId),
  ],
);

export type MoveInspection = typeof moveInspections.$inferSelect;
export type InsertMoveInspection = typeof moveInspections.$inferInsert;

// Security-deposit ledger — Texas has 30-day statutory return + itemized
// deduction list, etc.
export const securityDeposits = pgTable(
  "security_deposits",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    leaseId: varchar("lease_id").notNull(),
    tenantId: varchar("tenant_id").notNull(),

    heldCents: bigint("held_cents", { mode: "number" }).notNull(),
    receivedAt: date("received_at"),

    // Move-out reconciliation
    moveOutInspectionId: varchar("move_out_inspection_id"),
    deductions: jsonb("deductions").$type<Array<{
      description: string;
      amountCents: number;
      category?: string;
    }>>().default([]),
    deductionsTotalCents: bigint("deductions_total_cents", { mode: "number" }).default(0),
    refundCents: bigint("refund_cents", { mode: "number" }),
    refundedAt: date("refunded_at"),

    // ── The statutory clock (Wave D) ──────────────────────────────────────
    // This column shipped with a comment and no writer: no route ever set it,
    // so the deadline that carries the largest single landlord-tenant exposure
    // (forfeiture of the right to withhold anything, plus statutory damages)
    // rendered as blank in every UI. It is now populated at move-out from
    // shared/regulatory/depositReturnRules.ts.
    statutoryDeadline: date("statutory_deadline"),  // state-driven (Texas 30d)
    /** The trigger date the clock was computed from — move-out, not lease end. */
    moveOutDate: date("move_out_date"),
    /** Days the rule allowed, retained so a stored deadline stays explainable. */
    statutoryDeadlineDays: integer("statutory_deadline_days"),
    statutoryDeadlineCitation: text("statutory_deadline_citation"),
    /**
     * Populated INSTEAD of statutoryDeadline when the jurisdiction has no
     * encoded rule. Surfaced verbatim to the operator. AcreOS refuses to
     * substitute a default: an invented deposit deadline is the one fabrication
     * that would directly create the liability it claims to track.
     */
    statutoryDeadlineUnknownReason: text("statutory_deadline_unknown_reason"),
    statutoryDeadlineSetAt: timestamp("statutory_deadline_set_at", { withTimezone: true }),

    // ── Itemised disposition letter ───────────────────────────────────────
    // Generated from the reconciled deductions; AcreOS has no send rail for it
    // (BYO identity only), so delivery is manual and `deliveredAt` is stamped
    // only when the operator records their own delivery. Never claimed as sent.
    dispositionLetterMarkdown: text("disposition_letter_markdown"),
    dispositionLetterVersion: text("disposition_letter_version"),
    dispositionLetterGeneratedAt: timestamp("disposition_letter_generated_at", { withTimezone: true }),
    dispositionLetterDeliveredAt: timestamp("disposition_letter_delivered_at", { withTimezone: true }),
    dispositionLetterDeliveryMethod: text("disposition_letter_delivery_method"),  // operator-recorded: mail | hand | email

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("security_deposits_lease_uk").on(table.leaseId),
    // Org-LEADING composite (L3 shard-readiness) + the deposit-clock read:
    // "every deposit in this org with a live deadline, soonest first".
    index("security_deposits_org_deadline_idx").on(table.organizationId, table.statutoryDeadline),
  ],
);

export type SecurityDeposit = typeof securityDeposits.$inferSelect;
export type InsertSecurityDeposit = typeof securityDeposits.$inferInsert;

