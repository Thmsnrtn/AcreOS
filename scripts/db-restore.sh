#!/usr/bin/env bash
# ============================================================================
# scripts/db-restore.sh — restore a db-backup.sh dump into a FRESH database
# and prove it complete.
#
#   RESTORE_URL=postgres://…/acreos_restore scripts/db-restore.sh <dump> [manifest]
#
# Steps, each fatal on failure:
#   1. verify the dump's sha256 against the manifest (a corrupted or swapped
#      file is refused before anything is written);
#   2. create the target database if it does not exist (through the server's
#      `postgres` maintenance database) and REFUSE if it already holds any
#      table in public — a restore is never merged into live data;
#   3. pg_restore --no-owner --no-acl --exit-on-error;
#   4. count every table again and compare with the manifest, table by table;
#      any missing table or different count fails the restore.
#
# The dump may be a local path or an s3:// URL (fetched with the aws CLI).
# Credentials go through PG* env, never argv. See docs/runbooks/09-*.
# ============================================================================
set -euo pipefail

: "${RESTORE_URL:?RESTORE_URL (the fresh target database) is required}"
DUMP="${1:?usage: db-restore.sh <dump|s3://…> [manifest]}"
MAN="${2:-${DUMP%.dump}.manifest.json}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if [[ "$DUMP" == s3://* ]]; then
  command -v aws >/dev/null || { echo "[db-restore] FAIL — aws CLI needed for s3:// dumps"; exit 1; }
  aws s3 cp "$DUMP" "$WORK/backup.dump"; aws s3 cp "$MAN" "$WORK/backup.manifest.json"
  DUMP="$WORK/backup.dump"; MAN="$WORK/backup.manifest.json"
fi
[ -f "$DUMP" ] || { echo "[db-restore] FAIL — no dump at $DUMP"; exit 1; }
[ -f "$MAN" ] || { echo "[db-restore] FAIL — no manifest at $MAN (a restore without one cannot be proven complete)"; exit 1; }

pgenv() {
  python3 - "$1" "${2:-}" <<'PY'
import sys, shlex, urllib.parse as u
p = u.urlparse(sys.argv[1]); q = dict(u.parse_qsl(p.query))
db = sys.argv[2] or (p.path or "/").lstrip("/")
out = {"PGHOST": p.hostname or "localhost", "PGPORT": str(p.port or 5432), "PGUSER": u.unquote(p.username or ""), "PGPASSWORD": u.unquote(p.password or ""), "PGDATABASE": db}
if "sslmode" in q: out["PGSSLMODE"] = q["sslmode"]
for k, v in out.items(): print(f"export {k}={shlex.quote(v)}")
PY
}

# 1. integrity
WANT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sha256"])' "$MAN")"
GOT="$(sha256sum "$DUMP" | cut -d' ' -f1)"
[ "$WANT" = "$GOT" ] || { echo "[db-restore] FAIL — sha256 mismatch (manifest $WANT, file $GOT)"; exit 1; }
echo "[db-restore] dump verified (sha256 $GOT)"

# 2. a fresh target
TARGET_DB="$(python3 -c 'import sys,urllib.parse as u; print((u.urlparse(sys.argv[1]).path or "/").lstrip("/"))' "$RESTORE_URL")"
[[ "$TARGET_DB" =~ ^[A-Za-z0-9_]+$ ]] || { echo "[db-restore] FAIL — RESTORE_URL must name a database of letters, digits and underscores (got '$TARGET_DB')"; exit 1; }
( eval "$(pgenv "$RESTORE_URL" postgres)"
  EXISTS="$(psql -X -At -v ON_ERROR_STOP=1 -c "select 1 from pg_database where datname = '$TARGET_DB'")"
  if [ "$EXISTS" != "1" ]; then
    psql -X -q -v ON_ERROR_STOP=1 -c "create database \"$TARGET_DB\""
    echo "[db-restore] created database $TARGET_DB"
  fi )
eval "$(pgenv "$RESTORE_URL")"
EXISTING="$(psql -X -At -v ON_ERROR_STOP=1 -c "select count(*) from pg_tables where schemaname = 'public'")"
[ "$EXISTING" = "0" ] || { echo "[db-restore] FAIL — $TARGET_DB already has $EXISTING public tables; restore only into a fresh database"; exit 1; }

# 3. restore
pg_restore --no-owner --no-acl --exit-on-error -d "$PGDATABASE" "$DUMP"
echo "[db-restore] pg_restore complete"

# 4. prove it
COUNTS="$(psql -X -At -v ON_ERROR_STOP=1 <<'SQL'
select coalesce(json_object_agg(t, n), '{}'::json)
  from (
    select c.relname as t,
           (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as n
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and n.nspname = 'public'
  ) s;
SQL
)"
python3 - "$MAN" "$COUNTS" <<'PY'
import json, sys
want = json.load(open(sys.argv[1]))["tables"]
got = json.loads(sys.argv[2])
bad = [f"{t}: backup {n}, restored {got.get(t, 'MISSING')}" for t, n in sorted(want.items()) if got.get(t) != n]
extra = sorted(set(got) - set(want))
rows = sum(want.values())
if bad or extra:
    print("[db-restore] FAIL — the restore does not match the backup:")
    for b in bad[:50]: print("  " + b)
    for e in extra[:20]: print(f"  {e}: in the restore, not in the backup")
    sys.exit(1)
print(f"[db-restore] OK — {len(want)} tables, {rows} rows, every count matches the manifest")
PY
