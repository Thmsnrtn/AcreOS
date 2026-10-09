#!/usr/bin/env bash
# ============================================================================
# scripts/db-backup.sh — an OFF-PROVIDER logical backup of the AcreOS database.
#
# Fly's volume snapshots live with Fly; if the provider, the account or the
# region is lost, so are they. This writes a portable pg_dump (custom format)
# plus a manifest that lets scripts/db-restore.sh PROVE a restore is complete:
#
#   <out>/acreos-<UTC stamp>.dump           pg_dump -Fc --no-owner --no-acl
#   <out>/acreos-<UTC stamp>.manifest.json  sha256 of the dump, pg_dump
#                                            version, and the EXACT row count
#                                            of every table in the public schema
#
# and, when BACKUP_DEST is set, copies both somewhere that is not Fly:
#   BACKUP_DEST=s3://bucket/prefix     (aws CLI; any S3-compatible store —
#                                       set AWS_ENDPOINT_URL for R2 / B2)
#   BACKUP_DEST=rclone:remote:path     (rclone, for anything else)
#
# Usage:
#   DATABASE_URL=postgres://… scripts/db-backup.sh [out_dir]
#   DATABASE_URL=… BACKUP_DEST=s3://acreos-backups/db scripts/db-backup.sh /tmp/bk
#
# The connection string never reaches argv (ps can read argv): psql/pg_dump
# get it through PG* environment variables. Exits non-zero on any failure,
# including a destination that was asked for and could not be written.
# Restore and its proof: scripts/db-restore.sh; runbook docs/runbooks/09-*.
# ============================================================================
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
OUT="${1:-${BACKUP_DIR:-./backups}}"
mkdir -p "$OUT"

# postgres://user:pass@host:port/db?… → PG* env (no secrets on the command line)
pgenv() {
  local url="$1"
  python3 - "$url" <<'PY'
import sys, shlex, urllib.parse as u
p = u.urlparse(sys.argv[1])
q = dict(u.parse_qsl(p.query))
out = {
  "PGHOST": p.hostname or "localhost",
  "PGPORT": str(p.port or 5432),
  "PGUSER": u.unquote(p.username or ""),
  "PGPASSWORD": u.unquote(p.password or ""),
  "PGDATABASE": (p.path or "/").lstrip("/"),
}
if "sslmode" in q: out["PGSSLMODE"] = q["sslmode"]
for k, v in out.items():
  print(f"export {k}={shlex.quote(v)}")
PY
}
eval "$(pgenv "$DATABASE_URL")"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$OUT/acreos-$STAMP.dump"
MAN="$OUT/acreos-$STAMP.manifest.json"

echo "[db-backup] dumping $PGDATABASE@$PGHOST:$PGPORT → $DUMP"
pg_dump -Fc --no-owner --no-acl -f "$DUMP"

# Exact counts, every public table (the restore compares each one).
COUNTS="$(psql -X -At -v ON_ERROR_STOP=1 <<'SQL'
select coalesce(json_object_agg(t, n), '{}'::json)
  from (
    select c.relname as t,
           (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as n
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and n.nspname = 'public'
     order by 1
  ) s;
SQL
)"
SHA="$(sha256sum "$DUMP" | cut -d' ' -f1)"
TABLES="$(python3 -c 'import json,sys; print(len(json.loads(sys.argv[1])))' "$COUNTS")"
python3 - "$MAN" "$SHA" "$STAMP" "$(pg_dump --version)" "$COUNTS" "$(basename "$DUMP")" <<'PY'
import json, sys
path, sha, stamp, ver, counts, dump = sys.argv[1:7]
json.dump({"dump": dump, "sha256": sha, "createdAt": stamp, "pgDump": ver, "tables": json.loads(counts)}, open(path, "w"), indent=2, sort_keys=True)
PY
echo "[db-backup] $TABLES tables counted; sha256 $SHA; manifest $MAN"
[ "$TABLES" -gt 0 ] || { echo "[db-backup] FAIL — counted no tables in the public schema; refusing to call this a backup"; exit 1; }

if [ -n "${BACKUP_DEST:-}" ]; then
  case "$BACKUP_DEST" in
    s3://*)
      command -v aws >/dev/null || { echo "[db-backup] FAIL — BACKUP_DEST is s3:// but the aws CLI is not installed"; exit 1; }
      aws s3 cp "$DUMP" "$BACKUP_DEST/$(basename "$DUMP")"
      aws s3 cp "$MAN" "$BACKUP_DEST/$(basename "$MAN")"
      ;;
    rclone:*)
      command -v rclone >/dev/null || { echo "[db-backup] FAIL — BACKUP_DEST is rclone: but rclone is not installed"; exit 1; }
      rclone copy "$DUMP" "${BACKUP_DEST#rclone:}"
      rclone copy "$MAN" "${BACKUP_DEST#rclone:}"
      ;;
    *) echo "[db-backup] FAIL — BACKUP_DEST must start with s3:// or rclone:"; exit 1 ;;
  esac
  echo "[db-backup] copied off-provider to $BACKUP_DEST"
else
  echo "[db-backup] WARNING — BACKUP_DEST unset: the backup exists only in $OUT, which is not off-provider until you copy it"
fi
echo "[db-backup] OK"
