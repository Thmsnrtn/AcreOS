#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

TS=$(date +"%Y-%m-%d_%H-%M-%S")
LOG_DIR="logs"
mkdir -p "$LOG_DIR"

# Load env
if [[ -f .env.development.local ]]; then
  # shellcheck disable=SC2046
  export $(grep -E '^(DATABASE_URL|PORT|DEV_MODE|DEV_USER_EMAIL)=' .env.development.local | sed 's/^/ACREOS_/g' | xargs)
  DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.development.local | cut -d= -f2-)
  PORT=${ACREOS_PORT:-$(grep -E '^PORT=' .env.development.local | cut -d= -f2- || echo 5050)}
  # Ensure server sees required env vars
  export DATABASE_URL
  export PORT
  # Provide safe dev defaults for optional providers
  export OPENAI_API_KEY=${ACREOS_OPENAI_API_KEY:-sk-dev}
else
  echo ".env.development.local not found" >&2
  exit 1
fi

# Parse DB URL (no echo of password)
parse_url() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlparse
u=urlparse(sys.argv[1])
print((u.username or 'postgres'))
print((u.password or ''))
print((u.hostname or 'localhost'))
print((u.port or 5432))
print((u.path.lstrip('/') or 'postgres'))
PY
}
read -r PGUSER PGPASS PGHOST PGPORT PGDB < <(parse_url "$DATABASE_URL")

# Start Postgres via Docker if needed
mkdir -p ./data/postgres
if ! docker ps --format '{{.Names}}' | grep -q '^acreos-postgres$'; then
  if docker ps -a --format '{{.Names}}' | grep -q '^acreos-postgres$'; then
    docker rm -f acreos-postgres >/dev/null 2>&1 || true
  fi
  echo "Starting Postgres on port $PGPORT..."
  docker run -d --name acreos-postgres \
    -e POSTGRES_USER="$PGUSER" \
    -e POSTGRES_PASSWORD="$PGPASS" \
    -e POSTGRES_DB="$PGDB" \
    -p ${PGPORT}:5432 \
    -v "$(pwd)/data/postgres:/var/lib/postgresql/data" \
    postgres:16-alpine >/dev/null
fi

# Wait for readiness
attempts=0
until docker exec acreos-postgres pg_isready -U "$PGUSER" -d "$PGDB" -h 127.0.0.1 >/dev/null 2>&1; do
  attempts=$((attempts+1))
  if [[ $attempts -gt 60 ]]; then
    echo "Postgres failed to become ready on port $PGPORT" >&2
    exit 1
  fi
  sleep 1
done

echo "Running database migrations..."
DATABASE_URL="$DATABASE_URL" npm run db:push

echo "Starting dev server on port ${PORT} with logs at ${LOG_DIR}/dev-${TS}.log"
# Ensure auth bypass for local founder user
export DEV_MODE=true
export DEV_USER_EMAIL=${ACREOS_DEV_USER_EMAIL:-thmsnrtn@gmail.com}

npm run dev 2>&1 | tee "${LOG_DIR}/dev-${TS}.log"
