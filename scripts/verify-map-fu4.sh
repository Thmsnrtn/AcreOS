#!/usr/bin/env bash
# Rosy River FU#4 — re-verify the MapLibre/Mapbox property map end-to-end.
#
# Usage:
#   ./scripts/verify-map-fu4.sh                  # local dev (http://localhost:5000)
#   PLAYWRIGHT_BASE_URL=https://acreos.io ./scripts/verify-map-fu4.sh
#
# Steps (in order):
#   1. Confirm seed parcels exist (properties #2 + #3 in Cochise + Yavapai
#      AZ have lat/lng) — fly ssh path or local DATABASE_URL path.
#   2. Run npx playwright test tests/e2e/map-smoke.spec.ts
#   3. Print a pass/fail summary.
#
# The seed step is idempotent — running it twice is safe.

set -euo pipefail

BASE="${PLAYWRIGHT_BASE_URL:-http://localhost:5000}"
echo "→ verifying against ${BASE}"

if [[ "$BASE" =~ ^https?://localhost ]]; then
  echo "→ seeding test parcel coords (local DATABASE_URL)…"
  npx tsx scripts/seed-property-coords.ts || {
    echo "  seed failed — make sure DATABASE_URL is set and properties 2+3 exist" >&2
    exit 1
  }
else
  echo "→ remote target detected — seed via:"
  echo "    fly ssh console -a acreos -C 'npx tsx scripts/seed-property-coords.ts'"
  read -r -p "  hit Enter once seed is confirmed, or Ctrl-C to abort: " _
fi

echo "→ running Playwright map smoke suite…"
PLAYWRIGHT_BASE_URL="$BASE" npx playwright test tests/e2e/map-smoke.spec.ts --reporter=line

echo
echo "✓ map-smoke verification complete."
