#!/usr/bin/env bash
set -euo pipefail

BASE=${ACREOS_BASE_URL:-http://localhost:${PORT:-5050}}

echo "[reset-dev] Deleting sample data..."
STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/onboarding/sample-data" || true)
if [[ "$STATUS" != "200" ]]; then
  echo "[reset-dev] DELETE sample-data returned $STATUS (continuing)"
fi

echo "[reset-dev] Generating fresh sample data..."
RESP=$(curl -sS -X POST "$BASE/api/onboarding/sample-data" -H 'Content-Type: application/json' -d '{}' )
echo "[reset-dev] Seed result: $RESP"

echo "[reset-dev] Done."
