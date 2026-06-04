// ============================================================================
// SHARED/SCHEMA/SOLENE-MEMORY-FILES.TS
// ----------------------------------------------------------------------------
// Phase 1 of the AcreOS-Solene migration: DB mirror of the /memory/*.md
// files so AcreOS Solene chat can read/write the same memory that CLI
// Claude Code edits on disk.
//
// One row per memory file. body_sha256 lets the sync script + the
// in-app editor detect drift cheaply without re-reading the full body.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================
import {
  pgTable,
  text,
  serial,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================
// ENUMS
// ============================================
export const MEMORY_FILE_TYPES = [
  "user",
  "feedback",
  "project",
  "reference",
  "unknown",
] as const;
export type MemoryFileType = (typeof MEMORY_FILE_TYPES)[number];

// ============================================
// solene_memory_files
// ============================================
export const soleneMemoryFiles = pgTable(
  "solene_memory_files",
  {
    id: serial("id").primaryKey(),
    // matches the frontmatter `name:` field — kebab-case
    // (e.g., team-solene-chief-of-staff)
    slug: text("slug").notNull(),
    // e.g., team_solene.md
    fileBasename: text("file_basename").notNull(),
    // user | feedback | project | reference | unknown
    type: text("type").notNull(),
    description: text("description"),
    // Full file body INCLUDING frontmatter, so an editor round-trip is
    // lossless. body_sha256 is computed off this exact string.
    body: text("body").notNull(),
    bodySha256: text("body_sha256").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Set by the local→DB sync script.
    lastSyncedFromLocalAt: timestamp("last_synced_from_local_at", {
      withTimezone: true,
    }),
    // Set when the DB content is pushed back to local disk.
    lastSyncedToLocalAt: timestamp("last_synced_to_local_at", {
      withTimezone: true,
    }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    uniqueIndex("solene_memory_files_slug_unique").on(t.slug),
    uniqueIndex("solene_memory_files_basename_unique").on(t.fileBasename),
    index("solene_memory_files_type_idx").on(t.type),
    index("solene_memory_files_updated_at_idx").on(t.updatedAt),
  ],
);

export type SoleneMemoryFileRow = typeof soleneMemoryFiles.$inferSelect;
export type InsertSoleneMemoryFileRow = typeof soleneMemoryFiles.$inferInsert;
