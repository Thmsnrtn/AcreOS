#!/usr/bin/env bash
#
# AcreOS Full Simulation Pipeline
#
# Orchestrates all 3 layers of synthetic beta testing:
#   Layer 1: Playwright persona journey specs
#   Layer 2: Chaos & adversarial tests (vitest)
#   Layer 3: LLM exploratory testing (requires ANTHROPIC_API_KEY)
#
# Usage:
#   ./scripts/run-simulation.sh
#
# Environment:
#   ANTHROPIC_API_KEY — enables Layer 3 LLM exploration (optional)
#   SIM_BASE_URL     — override app URL (default: http://localhost:5000)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.test.yml"
REPORTS_DIR="$ROOT_DIR/tests/simulation/reports"
REPORT_OUTPUT="$ROOT_DIR/tests/simulation/simulation-report.md"

export SIM_BASE_URL="${SIM_BASE_URL:-http://localhost:5000}"

# Track whether we started docker so we know to tear it down
DOCKER_STARTED=0
EXIT_CODE=0

cleanup() {
  if [ "$DOCKER_STARTED" -eq 1 ]; then
    echo ""
    echo "═══ Tearing down test stack ═══"
    docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── Helpers ───────────────────────────────────────────────────────────────

log() { echo "[sim] $*"; }
err() { echo "[sim] ERROR: $*" >&2; }

wait_for_health() {
  local url="$SIM_BASE_URL/api/health"
  local max_retries=60
  local interval=3

  log "Waiting for app health at $url ..."
  for i in $(seq 1 $max_retries); do
    if curl -sf "$url" > /dev/null 2>&1; then
      log "App is healthy (attempt $i)"
      return 0
    fi
    sleep "$interval"
  done

  err "App did not become healthy after $((max_retries * interval))s"
  return 1
}

# ── Step 1: Boot docker-compose.test.yml ─────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════"
echo "  AcreOS Simulation Pipeline"
echo "═══════════════════════════════════════════════"
echo ""

log "Starting test stack..."
docker compose -f "$COMPOSE_FILE" up -d --build
DOCKER_STARTED=1

wait_for_health

# Ensure reports directory exists
mkdir -p "$REPORTS_DIR"

# ── Step 2: Seed personas ────────────────────────────────────────────────

echo ""
echo "═══ Step 2: Seeding personas ═══"
cd "$ROOT_DIR"
npx tsx tests/simulation/seed-personas.ts || {
  err "Persona seeding failed"
  EXIT_CODE=1
}

# ── Step 3: Layer 1 — Playwright persona journey specs ───────────────────

echo ""
echo "═══ Step 3: Layer 1 — Playwright persona specs ═══"
npx playwright test tests/simulation/sim-*.spec.ts \
  --reporter=json \
  --output="$REPORTS_DIR" \
  2>"$REPORTS_DIR/playwright-stderr.log" \
  | tee "$REPORTS_DIR/playwright-results.json" || {
  log "Some Playwright specs failed (continuing pipeline)"
  EXIT_CODE=1
}

# ── Step 4: Layer 2 — Chaos tests ───────────────────────────────────────

echo ""
echo "═══ Step 4: Layer 2 — Chaos & adversarial tests ═══"
npx vitest run tests/simulation/chaos.spec.ts --reporter=json \
  2>/dev/null \
  | tee "$REPORTS_DIR/chaos-results.json" || {
  log "Some chaos tests failed (continuing pipeline)"
  EXIT_CODE=1
}

# ── Step 5: Layer 3 — LLM exploratory testing ───────────────────────────

echo ""
echo "═══ Step 5: Layer 3 — LLM exploratory testing ═══"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  log "ANTHROPIC_API_KEY not set — skipping LLM exploration"
  log "Set ANTHROPIC_API_KEY to enable Layer 3"
else
  PERSONAS=("firstTimer" "scalingOperator" "enterpriseManager" "noteInvestor" "limitTester")

  for persona in "${PERSONAS[@]}"; do
    log "Exploring as $persona..."
    npx tsx tests/simulation/llm-explorer.ts \
      --persona "$persona" \
      --actions 50 || {
      log "Explorer failed for $persona (continuing)"
    }
  done
fi

# ── Step 6: Generate report ─────────────────────────────────────────────

echo ""
echo "═══ Step 6: Generating simulation report ═══"
npx tsx tests/simulation/generate-report.ts || {
  err "Report generation failed"
  EXIT_CODE=1
}

# ── Step 7: Docker teardown happens in cleanup trap ──────────────────────

echo ""
echo "═══════════════════════════════════════════════"
echo "  Simulation Complete"
echo "═══════════════════════════════════════════════"
echo ""

if [ -f "$REPORT_OUTPUT" ]; then
  log "Report: $REPORT_OUTPUT"
else
  log "No report generated"
fi

log "Exit code: $EXIT_CODE"
exit "$EXIT_CODE"
