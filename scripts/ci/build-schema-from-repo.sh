#!/usr/bin/env bash
# ============================================================================
# scripts/ci/build-schema-from-repo.sh
# ----------------------------------------------------------------------------
# Build the AcreOS schema in an empty database, the same way a deploy does, and
# then judge the result with two gates.
#
# WHY THIS EXISTS
# ───────────────
# Until 2026-09-04 nothing in CI had ever built this schema. Three separate
# steps looked like they did:
#
#   - test.yml ran `npx drizzle-kit migrate` with `continue-on-error: true`.
#     It cannot work: drizzle.config.ts records that migrations/meta/_journal
#     .json was deleted on 2026-05-11 and must not be partially restored, so
#     the migrator has no journal to read. The `continue-on-error` hid that.
#   - deploy.yml counted `find drizzle -name "*.sql"`. There is no `drizzle/`
#     directory in this repository — migrations live in `migrations/` — so the
#     count was permanently 0 and nothing consumed it anyway.
#   - check-schema-migrate-mirror.mjs deferred column-level drift to "the
#     DB-backed `migrate.mjs --dry-run` gate ... in the deploy pipeline".
#     `grep -rn "dry-run" .github/workflows/` returned nothing.
#
# The first time the build was actually run (2026-09-04), 37 columns declared
# in shared/schema.ts turned out to exist in no DDL in this repository, and
# `db.select().from(properties)` — Drizzle names every declared column when
# there is no projection — failed outright on the result.
#
# WHAT IT DOES
# ────────────
#   1. migrations/*.sql in lexicographic order, tolerating per-statement
#      errors (ON_ERROR_STOP=0). The set carries duplicate ordinals from years
#      of parallel work (two 0003s, two 0004s, …) and re-applies objects that
#      an earlier file already made; those errors are expected noise and are
#      COUNTED and printed, never gated on. This phase is best-effort by
#      design — it is the base layer, not the verdict.
#   2. `node scripts/migrate.mjs` — the exact Fly release_command (fly.toml).
#      Its exit status IS gated: this is CI's first-ever execution of the
#      script production runs on every deploy.
#   3. `node scripts/migrate.mjs --dry-run` — every statement re-validated
#      against the schema step 2 just built. On a correctly built database the
#      correct skip count is ZERO, which is what makes this meaningful here
#      even though the same gate must stay tolerant against a drifted restore.
#   4. `npx tsx scripts/check-db-column-mirror.ts` — every table and column
#      shared/schema.ts declares must exist in what steps 1-3 produced.
#
# Steps 2-4 are the verdict; any of them failing fails the job.
#
# Requires: DATABASE_URL, and psql (present on ubuntu-latest runners).
# ============================================================================
set -uo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[build-schema] DATABASE_URL not set — this builds a real database." >&2
  exit 1
fi

MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/migrations"
LOG="$(mktemp)"

# Report the one extension the schema needs before anything depends on it.
# shared/schema.ts declares solene_embedded_records with a `vector(1024)`
# column; on an image without pgvector that CREATE TABLE fails and the column
# mirror reports a missing table with no hint as to why. Say it here instead.
VECTOR_OK="$(psql -tAX -d "$DATABASE_URL" -c "SELECT 1 FROM pg_available_extensions WHERE name = 'vector'" 2>/dev/null | tr -d '[:space:]')"
if [[ "$VECTOR_OK" != "1" ]]; then
  echo "[build-schema] WARNING: the 'vector' extension is not available on this server."
  echo "[build-schema]   shared/schema.ts needs it for solene_embedded_records; the column"
  echo "[build-schema]   mirror below will report that table missing. Use an image that has"
  echo "[build-schema]   it (pgvector/pgvector:pg16) rather than allowlisting the table."
fi

echo "[build-schema] 1/4 applying $(ls "$MIGRATIONS_DIR"/*.sql | wc -l) file(s) from migrations/"
for f in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  psql -q -v ON_ERROR_STOP=0 -d "$DATABASE_URL" -f "$f" >>"$LOG" 2>&1
done
# psql prefixes each diagnostic with `psql:<file>:<line>: `, so an anchored
# `^ERROR:` matches nothing and this counter silently read 0 on a run with 143
# real errors — a decorative counter inside a commit whose whole subject is
# decorative migration steps. Match the label wherever it appears on the line.
ERRORS="$(grep -c 'ERROR:' "$LOG" || true)"
echo "[build-schema] base layer applied — $ERRORS tolerated statement error(s) (expected: re-applied objects from duplicate ordinals)"
if [[ "$ERRORS" -gt 0 ]]; then
  echo "[build-schema] first 10, for the record:"
  grep 'ERROR:' "$LOG" | head -10 | sed 's/^/    /'
fi

echo "[build-schema] 2/4 node scripts/migrate.mjs   (the Fly release_command)"
if ! node scripts/migrate.mjs; then
  echo "[build-schema] FAIL — the release_command itself does not survive a database built from this repo." >&2
  exit 1
fi

echo "[build-schema] 3/4 node scripts/migrate.mjs --dry-run"
if ! node scripts/migrate.mjs --dry-run; then
  echo "[build-schema] FAIL — statements that would not apply to the schema this repo just built." >&2
  exit 1
fi

echo "[build-schema] 4/4 npx tsx scripts/check-db-column-mirror.ts"
if ! npx tsx scripts/check-db-column-mirror.ts; then
  echo "[build-schema] FAIL — shared/schema.ts declares tables or columns this repository cannot create." >&2
  exit 1
fi

echo "[build-schema] PASS — the schema this repository describes is the schema it can build."
