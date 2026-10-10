/**
 * land-data — W2 land-data foundation tables (migration 0270).
 *
 * GLOBAL infrastructure tables (no organization_id): owned public-record
 * parcels and their derived facts are shared across every org, exactly like
 * county_gis_endpoints and county_discovery_queue. Nothing here is tenant
 * data; a customer's own deals and notes reference a parcel by parcel_key.
 *
 *  - county_parcel_jobs: the on-demand county pipeline. One row per
 *    (state, county). Created on the first customer search in a county;
 *    either processed (parcels stored, kept) or REFUSED with the reason
 *    (no free source / terms forbid storing / licence review pending).
 *  - owned_parcels: normalized parcels + derived facts, keyed by the stable
 *    AcreOS parcel_key (survives county renumbering).
 *  - parcel_id_crosswalk: every county id a parcel_key has carried.
 *  - open_data_ingest_receipts: bucket-confirmed uploads — the only evidence
 *    that lets a corpus report "ingested".
 */
import { pgTable, text, serial, integer, timestamp, jsonb, index, uniqueIndex, doublePrecision, bigint } from "drizzle-orm/pg-core";

export const countyParcelJobs = pgTable("county_parcel_jobs", {
  id: serial("id").primaryKey(),
  state: text("state").notNull(),
  county: text("county").notNull(), // normalized: lowercase, no " county"
  // pending → processing → (complete | refused | failed)
  status: text("status").notNull().default("pending"),
  // Why a county was refused, in plain words (shown to the customer).
  refusalReason: text("refusal_reason"),
  demandCount: integer("demand_count").notNull().default(1),
  sourceEndpointId: integer("source_endpoint_id"),
  sourceUrl: text("source_url"),
  // Resume point for paged pulls (ArcGIS resultOffset).
  nextOffset: integer("next_offset").notNull().default(0),
  parcelsStored: integer("parcels_stored").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("county_parcel_jobs_state_county_uidx").on(t.state, t.county),
  index("county_parcel_jobs_status_demand_idx").on(t.status, t.demandCount),
]);

export const ownedParcels = pgTable("owned_parcels", {
  id: serial("id").primaryKey(),
  parcelKey: text("parcel_key").notNull(),
  state: text("state").notNull(),
  county: text("county").notNull(),
  countyFips: text("county_fips"),
  sourceParcelId: text("source_parcel_id").notNull(),
  sourceName: text("source_name").notNull(), // data-licence register key
  sourceUrl: text("source_url").notNull(),
  retrievedAt: timestamp("retrieved_at").notNull(),
  geometry: jsonb("geometry").notNull(),
  centroidLng: doublePrecision("centroid_lng").notNull(),
  centroidLat: doublePrecision("centroid_lat").notNull(),
  gisAcres: doublePrecision("gis_acres").notNull(),
  deededAcres: doublePrecision("deeded_acres"),
  attributes: jsonb("attributes"), // mapped, non-personal source fields
  facts: jsonb("facts"), // ParcelFactSet (null until computed)
  factsComputedAt: timestamp("facts_computed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("owned_parcels_parcel_key_uidx").on(t.parcelKey),
  index("owned_parcels_state_county_idx").on(t.state, t.county),
  index("owned_parcels_source_id_idx").on(t.state, t.county, t.sourceParcelId),
]);

export const parcelIdCrosswalk = pgTable("parcel_id_crosswalk", {
  id: serial("id").primaryKey(),
  parcelKey: text("parcel_key").notNull(),
  state: text("state").notNull(),
  county: text("county").notNull(),
  sourceParcelId: text("source_parcel_id").notNull(),
  firstSeenAt: timestamp("first_seen_at").notNull(),
  lastSeenAt: timestamp("last_seen_at").notNull(),
}, (t) => [
  uniqueIndex("parcel_id_crosswalk_uidx").on(t.state, t.county, t.sourceParcelId, t.parcelKey),
  index("parcel_id_crosswalk_key_idx").on(t.parcelKey),
]);

export const openDataIngestReceipts = pgTable("open_data_ingest_receipts", {
  id: serial("id").primaryKey(),
  corpusKey: text("corpus_key").notNull(),
  objectKey: text("object_key").notNull(),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  etag: text("etag"),
  uploadedAt: timestamp("uploaded_at").notNull(),
}, (t) => [
  uniqueIndex("open_data_ingest_receipts_object_uidx").on(t.objectKey, t.sha256),
  index("open_data_ingest_receipts_corpus_idx").on(t.corpusKey),
]);

export type CountyParcelJob = typeof countyParcelJobs.$inferSelect;
export type OwnedParcel = typeof ownedParcels.$inferSelect;
