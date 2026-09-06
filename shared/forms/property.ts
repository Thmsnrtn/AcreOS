/**
 * Client-safe `insertPropertySchema` — hand-written zod, ZERO drizzle imports.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `@shared/schema` is a barrel that re-exports 84 drizzle schema modules —
 * 541 `pgTable(...)` definitions, every column, type, FK and index. Drizzle's
 * column builders are un-annotated call chains (`text("apn").notNull()`), so no
 * bundler can prove them side-effect-free and none of it tree-shakes. Measured:
 * importing a single plain constant from the barrel still lands 438/438 tables
 * in the client bundle. That is ~364 KB raw / ~71 KB gzip of Postgres DDL
 * shipped to every user on every route, for tables a browser can never query.
 *
 * `client/src/pages/properties.tsx` needed exactly ONE thing from that barrel:
 * the zod shape of a property insert, to drive a react-hook-form resolver. This
 * module is that shape, transcribed by hand from the `properties` pgTable, so
 * the page can import a form schema without dragging the DDL along.
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
 * The server still validates with the real drizzle-zod
 * `insertPropertySchema` (shared/schema.ts) — see `server/routes-properties.ts`
 * (`insertPropertySchema.parse(...)`, and `.partial()` for PATCH). This file is
 * the CLIENT's mirror of that contract. If the two drift:
 *   - a field this schema wrongly marks optional → the form submits without it
 *     and the server 422s at the end of a filled-in modal (silent client-side
 *     pass, server-side reject);
 *   - a field this schema wrongly marks required → the user is blocked from
 *     saving a row the database would happily accept;
 *   - a wrong primitive (e.g. `z.number()` where the column is `numeric()` and
 *     therefore a STRING) → the form value is rejected locally or coerced into a
 *     shape the API refuses.
 * None of those show up as a type error. They show up as a broken Add Property
 * modal in production.
 *
 * ── HOW IT WAS DERIVED (reproduce this when the table changes) ──────────────
 * Source of truth: `properties` in `shared/schema.ts` (the pgTable), and
 *   export const insertPropertySchema = createInsertSchema(properties).omit({
 *     id: true, createdAt: true, updatedAt: true, organizationId: true,
 *   });
 * drizzle-zod@0.8.3 `insertConditions` (node_modules/drizzle-zod/index.mjs):
 *   optional: !notNull || (notNull && hasDefault)
 *   nullable: !notNull
 * so, per column:
 *   .notNull() and NO .default()  → required, non-nullable
 *   .notNull().default(x)         → .optional()            (NOT nullable)
 *   everything else               → .nullable().optional()
 * and per column type (drizzle-zod columnToSchema, no `coerce` configured here):
 *   text/varchar (no length) → z.string()
 *   numeric()                → z.string()   ← Postgres numeric round-trips as a
 *                                             STRING in drizzle; do not "fix"
 *                                             these to z.number().
 *   integer/serial           → z.int().gte(INT32_MIN).lte(INT32_MAX)
 *   boolean                  → z.boolean()
 *   timestamp                → z.date()     ← NOT coerced: an ISO string is
 *                                             REJECTED, same as the server.
 *   jsonb (incl. `.$type<T>()`) → the generic `jsonValueSchema` below. `$type`
 *                                 is a TYPE-level annotation only; drizzle-zod
 *                                 does not validate the shape at runtime, and
 *                                 neither does this file. The `as z.ZodType<T>`
 *                                 casts reproduce that exact split: precise
 *                                 static type, permissive runtime check.
 *
 * Verified against the real schema on 2026-09-06: same 60 keys, and every key
 * agrees on accept/reject for `undefined`, `null` and a battery of primitives.
 * If you change the `properties` table, change this file in the same commit and
 * re-run that comparison.
 */

import { z } from "zod";

/* ────────────────────────────────────────────────────────────────────────────
 * Column-type primitives — one per drizzle column kind used by `properties`.
 * Named after the column builder they mirror so a diff against the pgTable is
 * mechanical.
 * ──────────────────────────────────────────────────────────────────────────── */

/** drizzle-zod's `literalSchema`, verbatim. */
const jsonLiteralSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** drizzle-zod's `jsonSchema`, verbatim — deliberately shallow, not recursive. */
const jsonValueSchema = z.union([
  jsonLiteralSchema,
  z.record(z.string(), z.any()),
  z.array(z.any()),
]);

/** The static type drizzle-zod infers for an un-`$type`d json column. */
export type Json = string | number | boolean | null | { [key: string]: any } | any[];

/** `text(...)` / `varchar(...)` with no length → plain string. */
const pgText = () => z.string();

/** `numeric(...)` → drizzle data type is `string`, NOT number. */
const pgNumeric = () => z.string();

/** `integer(...)` → int32-bounded integer (drizzle-zod adds the CONSTANTS bounds). */
const pgInteger = () => z.int().gte(-2147483648).lte(2147483647);

/** `boolean(...)` */
const pgBoolean = () => z.boolean();

/** `timestamp(...)` → `z.date()`; no coercion, strings are rejected. */
const pgTimestamp = () => z.date();

/**
 * `jsonb(...)` — runtime validation is the permissive `jsonValueSchema`, while
 * the static type is the column's `.$type<T>()`. This mirrors drizzle-zod 0.8.3
 * exactly (`GetZodType` maps a `$type`d json column to `z.ZodType<data, data>`
 * while `columnToSchema` returns the generic `jsonSchema`).
 */
const pgJsonb = <T>() => jsonValueSchema as unknown as z.ZodType<T, T>;

/* ────────────────────────────────────────────────────────────────────────────
 * `.$type<...>()` payload shapes, transcribed from the pgTable.
 * ──────────────────────────────────────────────────────────────────────────── */

export type PropertyUtilities = {
  electric?: boolean;
  water?: boolean;
  sewer?: boolean;
  gas?: boolean;
};

export type PropertyDueDiligenceData = {
  titleClear?: boolean;
  noLiens?: boolean;
  noEnvironmentalIssues?: boolean;
  accessVerified?: boolean;
  taxesCurrent?: boolean;
  checklistCompleted?: boolean;
  notes?: string;
  distress?: {
    taxDelinquent?: boolean;
    taxDelinquentYears?: number;
    taxPrincipalCents?: number;
    taxPenaltyCents?: number;
    taxInterestCents?: number;
    taxPayoffAsOf?: string;
    probate?: boolean;
    codeViolation?: boolean;
    source?: string;
    updatedAt?: string;
    lienState?: "tax-lien" | "tax-deed";
    lienSoldDate?: string;
    lienHolder?: string;
    redemptionDeadline?: string;
    auctionDate?: string;
    openingBid?: number;
  };
};

export type PropertyParcelBoundary = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

export type PropertyParcelCentroid = {
  lat: number;
  lng: number;
};

export type PropertyParcelData = {
  regridId?: string;
  owner?: string;
  ownerAddress?: string;
  taxAmount?: string;
  lastUpdated?: string;
};

/* ────────────────────────────────────────────────────────────────────────────
 * The schema. Field order and comments follow the pgTable section-by-section so
 * a side-by-side diff is possible. `id`, `organizationId`, `createdAt` and
 * `updatedAt` are absent because the original `.omit()`s them.
 * ──────────────────────────────────────────────────────────────────────────── */

export const insertPropertySchema = z.object({
  // ── Core property info ────────────────────────────────────────────────────
  apn: pgText(),                                        // text().notNull()
  legalDescription: pgText().nullable().optional(),
  county: pgText(),                                     // text().notNull()
  state: pgText(),                                      // text().notNull()
  address: pgText().nullable().optional(),
  city: pgText().nullable().optional(),
  zip: pgText().nullable().optional(),
  subdivision: pgText().nullable().optional(),
  lotNumber: pgText().nullable().optional(),

  // ── Subdivider vertical (parent/child parcel link) ────────────────────────
  parentParcelId: pgInteger().nullable().optional(),
  childLotNumber: pgText().nullable().optional(),
  subdivisionPlanId: pgText().nullable().optional(),    // varchar(), no length

  // ── Size & characteristics ────────────────────────────────────────────────
  sizeAcres: pgNumeric(),                               // numeric().notNull()
  zoning: pgText().nullable().optional(),
  terrain: pgText().nullable().optional(),
  roadAccess: pgText().nullable().optional(),
  utilities: pgJsonb<PropertyUtilities>().nullable().optional(),

  // ── Status & pipeline ─────────────────────────────────────────────────────
  // .notNull().default("prospect") → optional but NOT nullable.
  status: pgText().optional(),

  // ── Financial ─────────────────────────────────────────────────────────────
  assessedValue: pgNumeric().nullable().optional(),
  marketValue: pgNumeric().nullable().optional(),
  purchasePrice: pgNumeric().nullable().optional(),
  purchaseDate: pgTimestamp().nullable().optional(),
  listPrice: pgNumeric().nullable().optional(),
  soldPrice: pgNumeric().nullable().optional(),
  soldDate: pgTimestamp().nullable().optional(),

  // ── Counterparties ────────────────────────────────────────────────────────
  sellerId: pgInteger().nullable().optional(),
  buyerId: pgInteger().nullable().optional(),

  // ── Due diligence ─────────────────────────────────────────────────────────
  // .default("pending") WITHOUT .notNull() → still nullable AND optional.
  dueDiligenceStatus: pgText().nullable().optional(),
  dueDiligenceData: pgJsonb<PropertyDueDiligenceData>().nullable().optional(),

  // ── Marketing ─────────────────────────────────────────────────────────────
  description: pgText().nullable().optional(),
  highlights: pgJsonb<string[]>().nullable().optional(),
  photos: pgJsonb<string[]>().nullable().optional(),
  virtualTourUrl: pgText().nullable().optional(),

  // ── GPS coordinates (numeric → strings) ───────────────────────────────────
  latitude: pgNumeric().nullable().optional(),
  longitude: pgNumeric().nullable().optional(),

  // ── Parcel boundary data ──────────────────────────────────────────────────
  parcelBoundary: pgJsonb<PropertyParcelBoundary>().nullable().optional(),
  parcelCentroid: pgJsonb<PropertyParcelCentroid>().nullable().optional(),
  parcelData: pgJsonb<PropertyParcelData>().nullable().optional(),

  // ── Enrichment ────────────────────────────────────────────────────────────
  enrichmentData: pgJsonb<Json>().nullable().optional(), // jsonb(), no .$type<>
  enrichmentStatus: pgText().nullable().optional(),
  enrichedAt: pgTimestamp().nullable().optional(),

  // ── Structural fields (ATTOM/BatchData) ───────────────────────────────────
  bedrooms: pgInteger().nullable().optional(),
  bathrooms: pgNumeric().nullable().optional(),         // numeric → string
  squareFeet: pgInteger().nullable().optional(),
  yearBuilt: pgInteger().nullable().optional(),
  stories: pgInteger().nullable().optional(),
  garageSpaces: pgInteger().nullable().optional(),
  lotSizeSqFt: pgInteger().nullable().optional(),
  structureType: pgText().nullable().optional(),
  condition: pgText().nullable().optional(),
  afterRepairValue: pgNumeric().nullable().optional(),
  estimatedRepairCost: pgNumeric().nullable().optional(),
  monthlyRent: pgNumeric().nullable().optional(),
  capRate: pgNumeric().nullable().optional(),
  noi: pgNumeric().nullable().optional(),

  // ── Federal lead-paint disclosure trigger (derived from yearBuilt) ────────
  requiresLeadPaintDisclosure: pgBoolean().nullable().optional(),

  // ── Entity ownership ──────────────────────────────────────────────────────
  owningEntity: pgText().nullable().optional(),

  // ── Indian-Country / federal trust land status ────────────────────────────
  // .notNull().default("unknown") → optional but NOT nullable.
  landStatus: pgText().optional(),

  // ── Soft delete ───────────────────────────────────────────────────────────
  deletedAt: pgTimestamp().nullable().optional(),
  deletedBy: pgText().nullable().optional(),
});

/** Same shape `z.infer<typeof insertPropertySchema>` yields from the drizzle-zod original. */
export type InsertPropertyInput = z.infer<typeof insertPropertySchema>;
