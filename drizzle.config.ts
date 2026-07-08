import { defineConfig } from "drizzle-kit";

// NOTE: Migrations do NOT run through drizzle-kit's migrator in this repo.
// The authoritative migration path is `scripts/migrate.mjs`, registered as
// Fly's `release_command` in fly.toml. This config exists only so that
// `drizzle-kit generate` and `drizzle-kit studio` continue to work for
// schema-diff inspection during development. The local `migrations/meta/`
// journal was deleted on 2026-05-11 because it had drifted out of sync
// (last journal entry: 0017_pax_next_gen; actual migrations: through 0075).
// If you want to re-enable the drizzle migrator at any point, regenerate
// the journal from a clean baseline first — do not partially restore it.

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  // 2026-07 DB audit: the old single-file value made drizzle-kit blind to
  // every table in shared/schema/*.ts (74 files) — `generate`/`studio`
  // could never diff them, which is how 90+ tables shipped with no
  // migration. The glob covers the monolith AND the split modules.
  schema: ["./shared/schema.ts", "./shared/schema/*.ts"],
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
