// ============================================================================
// SHARED/SCHEMA/PARCEL-APID.TS
// ----------------------------------------------------------------------------
// D2c — the persisted APID ledger (migration 0291; tables approved 2026-10-25).
//
//   parcel_apids          one row per APID ever minted; never deleted or
//                         re-assigned (status moves active → retired | held)
//   parcel_apn_windows    APN → APID over release ordinals [valid_from,
//                         valid_to); at most one open window per APN and per
//                         APID (partial unique indexes)
//   parcel_lineage_events the non-`same` lineage events per applied release,
//                         append-only (0291 triggers)
//
// GLOBAL tables (no organization_id). The pure ledger is shared/landData/apid.ts;
// the one reader/writer is server/services/landData/apidStore.ts.
// ============================================================================

import { pgTable, text, integer, bigint, boolean, timestamp, jsonb, uuid, char, index, uniqueIndex, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const parcelApids = pgTable(
  "parcel_apids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apid: text("apid").notNull().unique("parcel_apids_apid_key"),
    state: char("state", { length: 2 }).notNull(),
    countyFips: char("county_fips", { length: 5 }).notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    status: text("status").$type<"active" | "retired" | "held">().notNull(),
    provisional: boolean("provisional").notNull().default(false),
    parents: text("parents").array().notNull().default(sql`'{}'`),
    candidateParents: text("candidate_parents").array().notNull().default(sql`'{}'`),
    mintedInRelease: text("minted_in_release").notNull(),
    endedInRelease: text("ended_in_release"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("parcel_apids_state_county_fips_seq_key").on(t.state, t.countyFips, t.seq),
    check("parcel_apids_status_ended", sql`(${t.status} = 'active') = (${t.endedInRelease} IS NULL)`),
  ],
);
export type ParcelApidRow = typeof parcelApids.$inferSelect;

export const parcelApnWindows = pgTable(
  "parcel_apn_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apidId: uuid("apid_id").notNull().references(() => parcelApids.id),
    state: char("state", { length: 2 }).notNull(),
    countyFips: char("county_fips", { length: 5 }).notNull(),
    apn: text("apn").notNull(),
    validFrom: integer("valid_from").notNull(),
    validTo: integer("valid_to"),
    validFromRelease: text("valid_from_release").notNull(),
    validToRelease: text("valid_to_release"),
  },
  (t) => [
    index("parcel_apn_windows_county_idx").on(t.state, t.countyFips),
    uniqueIndex("parcel_apn_windows_one_open_per_apn").on(t.state, t.countyFips, t.apn).where(sql`valid_to IS NULL`),
    uniqueIndex("parcel_apn_windows_one_open_per_apid").on(t.apidId).where(sql`valid_to IS NULL`),
  ],
);
export type ParcelApnWindowRow = typeof parcelApnWindows.$inferSelect;

export const parcelLineageEvents = pgTable(
  "parcel_lineage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    state: char("state", { length: 2 }).notNull(),
    countyFips: char("county_fips", { length: 5 }).notNull(),
    releaseId: text("release_id").notNull(),
    releaseOrdinal: integer("release_ordinal").notNull(),
    kind: text("kind").notNull(),
    basis: text("basis").$type<"geometry" | "id_only">().notNull(),
    reason: text("reason"),
    previousApids: text("previous_apids").array().notNull(),
    nextApids: text("next_apids").array().notNull(),
    previousApns: text("previous_apns").array().notNull(),
    nextApns: text("next_apns").array().notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("parcel_lineage_events_county_idx").on(t.state, t.countyFips, t.releaseOrdinal)],
);
export type ParcelLineageEventRow = typeof parcelLineageEvents.$inferSelect;
