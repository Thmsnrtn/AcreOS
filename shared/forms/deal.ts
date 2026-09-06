/**
 * Client-safe `insertDealSchema` — hand-written zod, ZERO drizzle imports.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `@shared/schema` is a barrel that re-exports 84 drizzle schema modules — 541
 * `pgTable(...)` definitions, every column, type, FK and index. Drizzle's column
 * builders are un-annotated call chains (`text("escrow_number")`), so no bundler
 * can prove them side-effect-free and none of it tree-shakes. Measured:
 * importing a single plain constant from the barrel still lands 438/438 tables
 * in the client bundle — ~364 KB raw / ~71 KB gzip of Postgres DDL shipped to
 * every user on every route, for tables a browser can never query.
 *
 * `client/src/pages/deals.tsx` needed exactly ONE thing from that barrel: the
 * zod shape of a deal insert, to drive a react-hook-form resolver
 * (`const dealFormSchema = insertDealSchema`). This module is that shape,
 * transcribed by hand from the `deals` pgTable, so the page can import a form
 * schema without dragging the DDL along.
 *
 * The saving is ALL-OR-NOTHING: severing eleven of twelve client→barrel value
 * imports saves zero bytes. Re-introducing `import { ... } from "@shared/schema"`
 * anywhere on the client re-imports the whole 364 KB. So:
 *
 *   DO NOT "simplify" this file back into a barrel import.
 *   DO NOT import drizzle, drizzle-zod, or @shared/schema from here — not even
 *   `import type`, because an accidental value import is one keystroke away.
 *   This module must import NOTHING but "zod".
 *
 * ── WHAT BREAKS IF IT DRIFTS ────────────────────────────────────────────────
 * The server still validates with the real drizzle-zod `insertDealSchema`
 * (`shared/schema.ts`): `server/routes-deals.ts` parses creates through
 * `insertDealSchema.parse({ ...req.body, organizationId: org.id })` and updates
 * through `insertDealSchema.partial()`; `server/services/importExport.ts`
 * extends it for CSV import. This file is the CLIENT's mirror of that contract.
 * If the two drift:
 *   - a field this schema wrongly marks optional → the form submits without it
 *     and the server 422s at the end of a filled-in modal (silent client-side
 *     pass, server-side reject);
 *   - a field this schema wrongly marks required → the user is blocked from
 *     saving a row the database would happily accept;
 *   - a wrong primitive (e.g. `z.number()` where the column is `numeric()` and
 *     therefore a STRING) → the form value is rejected locally, or coerced into
 *     a shape the API refuses.
 * None of those show up as a type error. They show up as a broken Add Deal
 * modal in production.
 *
 * ── HOW IT WAS DERIVED (reproduce this when the table changes) ──────────────
 * Source of truth: `deals` in `shared/schema.ts` (the pgTable), and
 *   export const insertDealSchema = createInsertSchema(deals).omit({
 *     id: true, createdAt: true, updatedAt: true, organizationId: true,
 *   });
 * so `id`, `createdAt`, `updatedAt` and `organizationId` are ABSENT here too —
 * organizationId is set server-side from the session, never by the client.
 *
 * drizzle-zod@0.8.3 `insertConditions` (node_modules/drizzle-zod/index.mjs):
 *   optional: !notNull || (notNull && hasDefault)
 *   nullable: !notNull
 * so, per column:
 *   .notNull() and NO .default()  → required, non-nullable
 *   .notNull().default(x)         → .optional()            (NOT nullable)
 *   everything else               → .nullable().optional()
 * and per column type (drizzle-zod `columnToSchema`, no `coerce` configured):
 *   text()      → z.string()          (no length check; "" is a valid value)
 *   numeric()   → z.string()   ← Postgres numeric round-trips as a STRING in
 *                                 drizzle. Do NOT "fix" these to z.number();
 *                                 the server would reject the number.
 *   integer()   → z.int().gte(INT32_MIN).lte(INT32_MAX)
 *   timestamp() → z.date()     ← mode 'date', NO coercion. An ISO string is
 *                                 rejected; deals.tsx already hands the resolver
 *                                 real `Date` objects.
 *   jsonb()     → drizzle-zod's loose `jsonSchema` union, which IGNORES the
 *                 column's `$type<>()` at runtime (it validates "any JSON") and
 *                 applies `$type` only in the inferred TS type. `jsonbColumn<T>()`
 *                 below reproduces BOTH halves of that: same runtime union,
 *                 same static type. Do not tighten it — a stricter client
 *                 schema would reject payloads the server accepts.
 *
 * Verified field-by-field against the real schema by probing
 * `insertDealSchema.shape` (24 fields, same names, same optional/nullable flags,
 * same primitives) — `tests/unit/clientFormSchemasMatchDrizzle.test.ts` pins it.
 */
import { z } from "zod";

/** Postgres int4 bounds, as drizzle-zod applies them to `integer()` columns. */
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/** `integer("...")` — drizzle-zod: `z.int().gte(INT32_MIN).lte(INT32_MAX)`. */
const pgInteger = () => z.int().gte(INT32_MIN).lte(INT32_MAX);

/**
 * `jsonb("...")` — drizzle-zod's exported `jsonSchema`, verbatim:
 *   z.union([literalSchema, z.record(z.string(), z.any()), z.array(z.any())])
 * It is deliberately loose: the column's `$type<>()` is a TYPE-level assertion
 * only, so drizzle-zod never validates the object's inner shape.
 */
const jsonLiteralSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const jsonSchema = z.union([
  jsonLiteralSchema,
  z.record(z.string(), z.any()),
  z.array(z.any()),
]);

/**
 * A nullable+optional `jsonb` column: the loose runtime validator above, cast to
 * the column's `$type<T>()` so `z.infer` matches drizzle-zod's inferred type
 * (which is where `Omit<InsertDeal, 'organizationId'>` in `useCreateDeal` gets
 * its shape). The cast changes nothing at runtime — the accept-set is identical.
 */
const jsonbColumn = <T>() =>
  jsonSchema.nullable().optional() as unknown as z.ZodOptional<z.ZodNullable<z.ZodType<T, T>>>;

/** `deals.documents` — `$type<{...}[]>()` on the jsonb column. */
export type DealDocument = {
  name: string;
  url: string;
  type: string;
  uploadedAt: string;
};

/** `deals.analysisResults` — `$type<{...}>()` on the jsonb column. */
export type DealAnalysisResults = {
  purchasePrice: number;
  downPayment: number;
  financedAmount: number;
  interestRate: number;
  holdingCostsMonthly: number;
  holdingPeriodMonths: number;
  improvementCosts: number;
  expectedSalePrice: number;
  totalInvestment: number;
  totalCost: number;
  grossProfit: number;
  netProfit: number;
  roiPercent: number;
  annualizedRoi: number;
  cashOnCashReturn: number;
  calculatedAt: string;
};

/** `deals.enrichmentData` — `$type<{...}>()` on the jsonb column. */
export type DealEnrichmentData = {
  enrichedAt?: string;
  lookupTimeMs?: number;
  hazards?: {
    floodZone?: string;
    floodRisk?: "low" | "medium" | "high";
    wetlandsPresent?: boolean;
    wetlandsPercentage?: number;
    earthquakeRisk?: "low" | "medium" | "high";
    wildfireRisk?: "low" | "medium" | "high";
    overallRiskScore?: number;
    overallRiskLevel?: "low" | "medium" | "high";
  };
  environment?: {
    soilType?: string;
    soilSuitability?: string;
    epaFacilitiesNearby?: number;
    epaRiskLevel?: "low" | "medium" | "high";
  };
  infrastructure?: {
    nearestHospitalMiles?: number;
    nearestFireStationMiles?: number;
    nearestSchoolMiles?: number;
    accessScore?: number;
  };
  demographics?: {
    population?: number;
    medianIncome?: number;
    medianHomeValue?: number;
  };
  scores?: {
    investmentScore?: number;
    developmentScore?: number;
    riskScore?: number;
    overallScore?: number;
  };
  errors?: Record<string, string>;
};

/**
 * Accepts EXACTLY what `createInsertSchema(deals).omit({ id, createdAt,
 * updatedAt, organizationId })` accepts. Field order mirrors the pgTable.
 */
export const insertDealSchema = z.object({
  // integer("property_id").references(...).notNull() → required, non-nullable.
  propertyId: pgInteger(),
  // text("type").notNull() — no default → required, non-nullable.
  type: z.string(),
  // text("status").notNull().default("negotiating") → optional, NOT nullable.
  // The default is applied by Postgres, not by zod: omitting `status` yields
  // `undefined`, it does NOT materialise "negotiating" client-side.
  status: z.string().optional(),

  // Offer details
  offerAmount: z.string().nullable().optional(),      // numeric() → STRING
  offerDate: z.date().nullable().optional(),
  counterAmount: z.string().nullable().optional(),    // numeric() → STRING
  acceptedAmount: z.string().nullable().optional(),   // numeric() → STRING

  // Closing details
  closingDate: z.date().nullable().optional(),
  closingCosts: z.string().nullable().optional(),     // numeric() → STRING
  titleCompany: z.string().nullable().optional(),
  escrowNumber: z.string().nullable().optional(),

  // Documents / analysis / enrichment (all jsonb, all validated loosely)
  documents: jsonbColumn<DealDocument[]>(),
  analysisResults: jsonbColumn<DealAnalysisResults>(),
  enrichmentData: jsonbColumn<DealEnrichmentData>(),
  enrichmentStatus: z.string().nullable().optional(),
  enrichedAt: z.date().nullable().optional(),

  notes: z.string().nullable().optional(),
  assignedTo: pgInteger().nullable().optional(),

  // agent_investor: client vs. own book (migration 0226).
  dealBook: z.string().nullable().optional(),

  // agent_investor: dual-agency disclosure TRACKER (migration 0226).
  // RECORD-ONLY — nothing here is generated, sent, or e-signed by AcreOS.
  dualAgencySide: z.string().nullable().optional(),
  disclosureAcknowledgedAt: z.date().nullable().optional(),
  disclosureDocRef: z.string().nullable().optional(),

  // Soft delete
  deletedAt: z.date().nullable().optional(),
  deletedBy: z.string().nullable().optional(),
});

/** Mirrors `InsertDeal` minus `organizationId` — the deal-form value type. */
export type DealInput = z.infer<typeof insertDealSchema>;
