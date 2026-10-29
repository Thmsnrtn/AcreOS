/**
 * V-Tax-1 T1 tables (migration 0294; founder decision 2026-10-28: swap the
 * dead tax tables for purpose-built ones, table count unchanged).
 *
 *   - tax_county_watches: a county-scoped watch. The county's redemption
 *     period, sale type and auction cadence are DATA on the watch — each a
 *     stated value with its source and as-of, or absent (unknown). Never a
 *     national default. Org-private.
 *   - tax_lot_observations: every value a source stated for an imported tax
 *     lot's field, with its provenance, plus recorded absences (kind
 *     'searched_none'). The Notes note_field_observations pattern applied to
 *     tax lots. Append-only by trigger; a row leaves only with its lot.
 *     Org-private.
 */
import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { taxSaleListings } from "../schema";

/** A value someone stated, with where it came from. */
export interface StatedTerm<T> {
  value: T;
  /** Where the value came from, in words (e.g. "Travis County tax office sale notice 2026"). */
  source: string;
  /** The date the source states the value as of (YYYY-MM-DD), or null. */
  asOf: string | null;
}

export interface TaxWatchTerms {
  redemptionPeriodMonths?: StatedTerm<number>;
  saleType?: StatedTerm<"lien" | "deed" | "redeemable_deed">;
  auctionCadence?: StatedTerm<string>;
}

export const taxCountyWatches = pgTable(
  "tax_county_watches",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").notNull(),
    state: text("state").notNull(),
    county: text("county").notNull(),
    terms: jsonb("terms").$type<TaxWatchTerms>().notNull().default(sql`'{}'::jsonb`),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tax_county_watches_org_county_uidx").on(t.organizationId, t.state, sql`lower(${t.county})`)],
);

export type TaxCountyWatch = typeof taxCountyWatches.$inferSelect;
export type InsertTaxCountyWatch = typeof taxCountyWatches.$inferInsert;

export type TaxLotObservationSource = "tax_list" | "operator_correction" | "warehouse" | "auction";

export const taxLotObservations = pgTable(
  "tax_lot_observations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").notNull(),
    listingId: integer("listing_id")
      .notNull()
      .references(() => taxSaleListings.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    kind: text("kind").$type<"value" | "searched_none">().notNull(),
    value: jsonb("value"),
    source: text("source").$type<TaxLotObservationSource>().notNull(),
    sourceRef: jsonb("source_ref").$type<Record<string, unknown>>().notNull(),
    asOf: date("as_of"),
    confidence: text("confidence").$type<"high" | "medium" | "low">().notNull(),
    confidenceBasis: text("confidence_basis").notNull(),
    decayClass: text("decay_class").notNull(),
    importId: uuid("import_id"),
    recordedBy: text("recorded_by").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tax_lot_observations_org_listing_idx").on(t.organizationId, t.listingId, t.field, t.observedAt),
    check("tax_lot_observations_value_iff_kind", sql`(kind = 'value') = (value IS NOT NULL)`),
  ],
);

export type TaxLotObservation = typeof taxLotObservations.$inferSelect;
export type InsertTaxLotObservation = typeof taxLotObservations.$inferInsert;
