// ============================================================================
// SHARED/SCHEMA/SUBDIVISION.TS
// ----------------------------------------------------------------------------
// Subdivider vertical — plans, permits, lot pricing, CCR templates.
// Extracted from shared/schema.ts.
// ============================================================================

import {
  pgTable,
  text,
  serial,
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
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, properties } from "../schema";

// ============================================================================
// SUBDIVIDER VERTICAL — SD-1 schema foundation (Brigid)
// ----------------------------------------------------------------------------
// Brigid's deal-killer: "One parent parcel becomes many child lots, and
// AcreOS does not know that. […] Until a parent parcel can hold child lots
// in the database, every subdivider feature you build sits on top of a
// workaround." (brigid-subdivider.md §7)
//
// SD-1 ships seven tables on top of the new properties.parent_parcel_id
// link added above:
//   1. subdivision_plans          — saved GeoJSON polygon configs (A/B plans)
//   2. permit_checklists          — per-(parent, county) permit workflow
//   3. permit_gates               — individual permit-gate rows under a checklist
//   4. lot_basis_allocations      — parent cost basis split across child lots
//   5. lot_pricing_rules          — per-rules-set premium grid for asking prices
//   6. county_subdivision_timelines — reference data: lead times by county
//   7. cc_r_templates             — covenant template library w/ merge fields
//
// Conventions match the wholesaler vertical (varchar PKs defaulting to
// gen_random_uuid() rendered as `uuid` in prod; integer FKs to existing
// serial tables; reused `attorney_reviewed_at` review-stamp pattern).
// ============================================================================

export const SUBDIVISION_PLAN_STATUSES = [
  "draft",         // Brigid's working sketch
  "engineer_review",  // sent to civil engineer
  "county_submitted", // submitted to planning commission
  "recorded",      // final plat recorded — locks the plan
  "abandoned",     // we picked Plan B over this one
] as const;
export type SubdivisionPlanStatus = typeof SUBDIVISION_PLAN_STATUSES[number];

export const subdivisionPlans = pgTable(
  "subdivision_plans",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    parentParcelId: integer("parent_parcel_id").references(() => properties.id, { onDelete: "cascade" }).notNull(),

    name: text("name").notNull(),  // "Plan A — 12 lots", "Plan B — 8 lots, two estate"
    versionNumber: integer("version_number").notNull().default(1),
    status: text("status").$type<SubdivisionPlanStatus>().notNull().default("draft"),

    // GeoJSON FeatureCollection: parent boundary, road centerlines, lot polygons.
    // Frontend (mapbox-gl-draw) round-trips through this column.
    geojson: jsonb("geojson").$type<{
      type: "FeatureCollection";
      features: Array<{
        type: "Feature";
        id?: string;
        geometry: {
          type: "Polygon" | "MultiPolygon" | "LineString";
          coordinates: number[][][] | number[][][][] | number[][];
        };
        properties: {
          kind: "parent_boundary" | "road_centerline" | "lot" | "setback_overlay";
          lotNumber?: string;
          frontageFeet?: number;
          areaAcres?: number;
          notes?: string;
        };
      }>;
    }>(),

    lotCount: integer("lot_count"),
    totalRoadFeet: integer("total_road_feet"),
    totalAcres: numeric("total_acres"),

    // Carrying-cost projections (Brigid §3: "I burn $7-12k a month while
    // the plat sits in the planning queue"). Stored on the plan so re-plats
    // (Plan A vs Plan B) can compare burn projections side-by-side. The
    // Subdivision tab surfaces parent-basis + these as a to-date burn tile.
    engineeringCostCents: bigint("engineering_cost_cents", { mode: "number" }),
    surveyCostCents: bigint("survey_cost_cents", { mode: "number" }),
    roadConstructionCostBondCents: bigint("road_construction_cost_bond_cents", { mode: "number" }),

    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("subdivision_plans_org_parent_idx").on(table.organizationId, table.parentParcelId),
    index("subdivision_plans_status_idx").on(table.organizationId, table.status),
  ],
);

export type SubdivisionPlan = typeof subdivisionPlans.$inferSelect;
export type InsertSubdivisionPlan = typeof subdivisionPlans.$inferInsert;

// ----------------------------------------------------------------------------
// PERMIT CHECKLISTS + GATES — Brigid §2: Williamson TN has 14 gates,
// Hickman fewer, Maury different again. Each gate is a row with status,
// submitted date, expected return, fee, contact, attached doc.
// ----------------------------------------------------------------------------

export const PERMIT_GATE_STATUSES = [
  "not_started",
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "on_hold",
  "skipped",  // doesn't apply (e.g. on-sewer parcel skips perc tests)
] as const;
export type PermitGateStatus = typeof PERMIT_GATE_STATUSES[number];

export const permitChecklists = pgTable(
  "permit_checklists",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    parentParcelId: integer("parent_parcel_id").references(() => properties.id, { onDelete: "cascade" }).notNull(),

    countyState: text("county_state").notNull(),  // 'TN'
    countyName: text("county_name").notNull(),    // 'Williamson'
    templateKey: text("template_key"),            // 'tn_residential_subdivision_v1'

    title: text("title"),
    notes: text("notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("permit_checklists_org_parent_idx").on(table.organizationId, table.parentParcelId),
    index("permit_checklists_county_idx").on(table.countyState, table.countyName),
  ],
);

export const permitGates = pgTable(
  "permit_gates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    checklistId: varchar("checklist_id").notNull(),  // FK to permit_checklists, soft (uuid<>varchar)

    sequence: integer("sequence").notNull(),  // ordering — pre-app first, recording last
    gateKey: text("gate_key").notNull(),      // 'preliminary_plat', 'percolation_tests', etc.
    label: text("label").notNull(),
    status: text("status").$type<PermitGateStatus>().notNull().default("not_started"),

    submittedAt: date("submitted_at"),
    expectedReturnAt: date("expected_return_at"),
    completedAt: date("completed_at"),
    feeCents: bigint("fee_cents", { mode: "number" }),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    referenceNumber: text("reference_number"),
    notes: text("notes"),

    documentVersionId: integer("document_version_id"),  // optional FK to documentVersions

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("permit_gates_org_checklist_idx").on(table.organizationId, table.checklistId, table.sequence),
    index("permit_gates_status_idx").on(table.organizationId, table.status, table.expectedReturnAt),
  ],
);

export type PermitChecklist = typeof permitChecklists.$inferSelect;
export type InsertPermitChecklist = typeof permitChecklists.$inferInsert;
export type PermitGate = typeof permitGates.$inferSelect;
export type InsertPermitGate = typeof permitGates.$inferInsert;

// ----------------------------------------------------------------------------
// LOT BASIS ALLOCATIONS — Brigid §3.3: "the IRS lets me use either
// reasonable method; my CPA picks acreage-weighted with a road-impact
// adjustment. This is a tax-time requirement; my CPA needs basis-per-lot
// for every closing or I get a phone call I don't want at 11pm in March."
// ----------------------------------------------------------------------------

export const BASIS_ALLOCATION_METHODS = [
  "acreage",       // default — split parent basis pro-rata by acres
  "frontage",      // by road frontage feet
  "appraisal",     // by lot appraisal share of total appraisal
  "override",      // operator-specified percentages, must sum to 1.0
] as const;
export type BasisAllocationMethod = typeof BASIS_ALLOCATION_METHODS[number];

export const lotBasisAllocations = pgTable(
  "lot_basis_allocations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    parentParcelId: integer("parent_parcel_id").references(() => properties.id, { onDelete: "cascade" }).notNull(),
    childParcelId: integer("child_parcel_id").references(() => properties.id, { onDelete: "cascade" }).notNull(),

    method: text("method").$type<BasisAllocationMethod>().notNull().default("acreage"),
    // The denominator (parent total acreage / total frontage / total appraisal /
    // 1.0 for override) at the time of allocation, frozen.
    denominator: numeric("denominator").notNull(),
    // The numerator for this specific child lot.
    numerator: numeric("numerator").notNull(),
    // Computed share = numerator / denominator (stored for query speed).
    sharePct: numeric("share_pct").notNull(),
    // Allocated basis in cents (= parentTotalBasis * sharePct).
    allocatedBasisCents: bigint("allocated_basis_cents", { mode: "number" }).notNull(),
    // For "override": optional explicit share the operator typed in.
    overrideShare: numeric("override_share"),
    notes: text("notes"),

    // Realization — flips when the lot is sold and COGS is recorded.
    realizedAt: timestamp("realized_at", { withTimezone: true }),
    realizedSalePriceCents: bigint("realized_sale_price_cents", { mode: "number" }),
    realizedCogsCents: bigint("realized_cogs_cents", { mode: "number" }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("lot_basis_alloc_parent_child_uk").on(table.parentParcelId, table.childParcelId),
    index("lot_basis_alloc_org_parent_idx").on(table.organizationId, table.parentParcelId),
  ],
);

export type LotBasisAllocation = typeof lotBasisAllocations.$inferSelect;
export type InsertLotBasisAllocation = typeof lotBasisAllocations.$inferInsert;

// ----------------------------------------------------------------------------
// LOT PRICING RULES — Brigid §5: "corner +10%, frontage > 150ft +8%, water
// feature +15%, cul-de-sac +5%, lot < 1.5ac -10%". One rules-set per
// subdivision (or org-default), then applied to all child lots.
// ----------------------------------------------------------------------------

export const lotPricingRules = pgTable(
  "lot_pricing_rules",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    // Optional — null means "org default rules-set".
    parentParcelId: integer("parent_parcel_id").references(() => properties.id, { onDelete: "cascade" }),

    name: text("name").notNull(),         // "Standard rural" / "Premium tier"
    isDefault: boolean("is_default").notNull().default(false),
    // Base price source: 'avm_per_acre' (use parent AVM/acre) or 'fixed_per_acre'
    // (operator-supplied $/acre baseline).
    basePriceSource: text("base_price_source").notNull().default("avm_per_acre"),
    fixedPerAcreCents: bigint("fixed_per_acre_cents", { mode: "number" }),

    // Premium rules array — { attribute, operator, threshold?, premiumPct }.
    // attribute: corner | frontage_ft | water_feature | cul_de_sac | acres | view |
    //            wooded | road_paved
    // operator: "==" | ">" | "<" | ">=" | "<="
    // premiumPct: signed decimal, e.g. 0.10 = +10%, -0.10 = -10%
    rules: jsonb("rules").$type<Array<{
      attribute: string;
      operator: "==" | ">" | "<" | ">=" | "<=";
      threshold?: number | string | boolean;
      premiumPct: number;
      label?: string;
    }>>().notNull().default([]),

    // Frozen grid of computed asking prices once the operator clicks "Lock".
    lockedGrid: jsonb("locked_grid").$type<Array<{
      childParcelId: number;
      basePriceCents: number;
      premiumPct: number;
      askingPriceCents: number;
      override?: boolean;
    }>>(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),

    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("lot_pricing_rules_org_parent_idx").on(table.organizationId, table.parentParcelId),
    uniqueIndex("lot_pricing_rules_org_default_uk").on(table.organizationId, table.isDefault).where(sql`is_default = true`),
  ],
);

export type LotPricingRules = typeof lotPricingRules.$inferSelect;
export type InsertLotPricingRules = typeof lotPricingRules.$inferInsert;

// ----------------------------------------------------------------------------
// COUNTY SUBDIVISION TIMELINES — Brigid §7: "Williamson is fourteen months
// end-to-end. Hickman is four. Maury is six. […] I bid acquisitions on the
// carry cost of those timelines."
//
// One row per (state, county). p50 / p90 lead times in days for each gate.
// Refined by user data over time but seeded with planning-office estimates.
// ----------------------------------------------------------------------------

export const countySubdivisionTimelines = pgTable(
  "county_subdivision_timelines",
  {
    id: serial("id").primaryKey(),
    state: text("state").notNull(),       // 'TN'
    countyName: text("county_name").notNull(),

    // End-to-end estimate — pre-app to recording.
    p50TotalDays: integer("p50_total_days"),
    p90TotalDays: integer("p90_total_days"),

    // Gate-level lead times (days). Null = gate doesn't apply in this county.
    preApplicationLeadDays: integer("pre_application_lead_days"),
    sketchPlanLeadDays: integer("sketch_plan_lead_days"),
    preliminaryPlatLeadDays: integer("preliminary_plat_lead_days"),
    percolationLeadDays: integer("percolation_lead_days"),
    finalPlatLeadDays: integer("final_plat_lead_days"),
    recordingLeadDays: integer("recording_lead_days"),

    // Operational notes — perc-test seasonal windows, planner caseload, etc.
    percolationSeasonNote: text("percolation_season_note"),
    typicalRevisionRounds: integer("typical_revision_rounds"),

    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    plannerSiteUrl: text("planner_site_url"),

    source: text("source"),               // "Williamson Co Planning Office, 2026-Q2"
    sourceUpdatedAt: date("source_updated_at"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("county_timelines_state_county_uk").on(table.state, table.countyName),
  ],
);

export type CountySubdivisionTimeline = typeof countySubdivisionTimelines.$inferSelect;
export type InsertCountySubdivisionTimeline = typeof countySubdivisionTimelines.$inferInsert;

// ----------------------------------------------------------------------------
// CC&R TEMPLATES — Brigid §6: "a template engine with merge fields, period.
// […] No AI here, please. I do not want a generative model writing CC&Rs
// that get recorded in perpetuity against my buyers' titles."
// ----------------------------------------------------------------------------

export const CCR_TEMPLATE_KINDS = [
  "restrictive_covenants",
  "road_maintenance_agreement",
  "hoa_bylaws",
  "architectural_review_standards",
  "septic_maintenance",
  "well_sharing_agreement",
  "private_road_easement",
  "drainage_easement",
] as const;
export type CcrTemplateKind = typeof CCR_TEMPLATE_KINDS[number];

export const ccrTemplates = pgTable(
  "cc_r_templates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    // Null org = global template seeded for all orgs. Org-specific overrides
    // copy from global with a non-null orgId.
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),

    kind: text("kind").$type<CcrTemplateKind>().notNull(),
    name: text("name").notNull(),
    state: text("state"),                   // jurisdiction (TN, etc.) — null = generic
    bodyMarkdown: text("body_markdown").notNull(),

    // Schema of merge fields the template expects: project_name, recording_county,
    // lot_count, assessment_amount_cents, arb_committee_size, etc.
    mergeFields: jsonb("merge_fields").$type<Array<{
      key: string;
      label: string;
      type: "string" | "number" | "currency_cents" | "date" | "boolean";
      required: boolean;
      placeholder?: string;
    }>>().notNull().default([]),

    // Brigid: review-stamps so paralegals can update without a code deploy.
    attorneyReviewedAt: timestamp("attorney_reviewed_at", { withTimezone: true }),
    attorneyReviewedBy: text("attorney_reviewed_by"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ccr_templates_org_kind_idx").on(table.organizationId, table.kind),
    index("ccr_templates_state_kind_idx").on(table.state, table.kind),
  ],
);

export type CcrTemplate = typeof ccrTemplates.$inferSelect;
export type InsertCcrTemplate = typeof ccrTemplates.$inferInsert;

