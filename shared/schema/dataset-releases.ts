// ============================================================================
// SHARED/SCHEMA/DATASET-RELEASES.TS
// ----------------------------------------------------------------------------
// D2b — immutable, content-addressed dataset releases and the append-only
// release pointer (migration 0290; tables approved 2026-10-25).
//
//   dataset_releases        one row per release; release_id is sha256 over
//                           the canonical manifest, so a row cannot be edited
//                           without breaking its own id. Never updated,
//                           deleted or truncated (0290 triggers).
//   dataset_release_pointer the history of which release is current. Promote
//                           and rollback are both an INSERT; (dataset, seq)
//                           is the concurrency guard.
//
// Both are GLOBAL (no organization_id): a release is the platform's
// public-record parcel dataset. The pure core that builds, names, diffs and
// moves them lives in server/services/landData/releases/; the one reader and
// writer is releaseStore.ts there.
// ============================================================================

import { pgTable, text, integer, bigint, timestamp, jsonb, check, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const datasetReleases = pgTable(
  "dataset_releases",
  {
    releaseId: text("release_id").primaryKey(),
    dataset: text("dataset").notNull(),
    manifestFormat: text("manifest_format").notNull(),
    /** The canonical manifest (validated by releaseManifest.validateManifest on every read). */
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    countyCount: integer("county_count").notNull(),
    parcelCount: bigint("parcel_count", { mode: "number" }).notNull(),
    artifactBytes: bigint("artifact_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [check("dataset_releases_id_shape", sql`${t.releaseId} ~ '^sha256:[0-9a-f]{64}$'`)],
);
export type DatasetRelease = typeof datasetReleases.$inferSelect;

export const datasetReleasePointer = pgTable(
  "dataset_release_pointer",
  {
    dataset: text("dataset").notNull(),
    seq: integer("seq").notNull(),
    action: text("action").$type<"promote" | "rollback">().notNull(),
    releaseId: text("release_id").notNull().references(() => datasetReleases.releaseId),
    releaseName: text("release_name").notNull(),
    previousReleaseId: text("previous_release_id").references(() => datasetReleases.releaseId),
    at: timestamp("at").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.dataset, t.seq] }),
    uniqueIndex("dataset_release_pointer_name_once").on(t.dataset, t.releaseName).where(sql`action = 'promote'`),
    uniqueIndex("dataset_release_pointer_promote_once").on(t.dataset, t.releaseId).where(sql`action = 'promote'`),
  ],
);
export type DatasetReleasePointerRow = typeof datasetReleasePointer.$inferSelect;
