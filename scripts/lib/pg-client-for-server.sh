# shellcheck shell=bash
# ============================================================================
# scripts/lib/pg-client-for-server.sh — sourced by db-backup.sh / db-restore.sh
# ----------------------------------------------------------------------------
# Resolve pg_dump / pg_restore of the SAME major version as the server the PG*
# environment points at, or fail loudly.
#
# WHY (2026-10-26, CI run 40321419022): the scripts called whatever pg_dump /
# pg_restore came first on PATH. The GitHub runner image's client tools moved
# past the pg16 service container, and a pg_dump/pg_restore >= 17 writes
# `SET transaction_timeout = 0;` — a setting PostgreSQL 16 does not have — so
# the restore died on its first statement while nothing in this repository had
# changed. A backup exists to be restored into the same major version it came
# from; a client of another major is how a backup silently becomes one that
# cannot be restored. So the client is chosen BY the server's version, and a
# missing match is a refusal that names the package to install, never a
# fallback to whatever is on PATH.
# ============================================================================

# The server's major version (e.g. 16), via psql (any psql can ask this).
pg_server_major() {
  local num
  num="$(psql -X -At -v ON_ERROR_STOP=1 -c "show server_version_num")" || return 1
  [[ "$num" =~ ^[0-9]+$ ]] || { echo "could not read server_version_num (got '$num')" >&2; return 1; }
  echo $((num / 10000))
}

# The major version a client binary reports (`pg_dump (PostgreSQL) 16.4` → 16).
pg_tool_major() {
  "$1" --version 2>/dev/null | sed -nE 's/.*\(PostgreSQL\) ([0-9]+).*/\1/p' | head -n1
}

# pg_tool_for_server <pg_dump|pg_restore> <major> → absolute path, or exit 1.
pg_tool_for_server() {
  local tool="$1" major="$2" cand
  for cand in \
    "${PG_CLIENT_BIN_DIR:+$PG_CLIENT_BIN_DIR/$tool}" \
    "/usr/lib/postgresql/$major/bin/$tool" \
    "/usr/pgsql-$major/bin/$tool" \
    "/opt/homebrew/opt/postgresql@$major/bin/$tool" \
    "/usr/local/opt/postgresql@$major/bin/$tool" \
    "$(command -v "$tool" 2>/dev/null || true)"; do
    [ -n "$cand" ] && [ -x "$cand" ] || continue
    if [ "$(pg_tool_major "$cand")" = "$major" ]; then
      echo "$cand"
      return 0
    fi
  done
  echo "no $tool for PostgreSQL $major found (the server is $major; PATH has $(command -v "$tool" >/dev/null 2>&1 && "$tool" --version || echo none)). Install postgresql-client-$major, or set PG_CLIENT_BIN_DIR to its bin directory. A $tool of another major writes or runs statements a $major server may reject (pg >= 17 emits SET transaction_timeout)." >&2
  return 1
}
