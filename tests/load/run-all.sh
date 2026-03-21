#!/usr/bin/env bash
#
# AcreOS Load Testing Suite — Run All Tests
#
# Usage:
#   ./tests/load/run-all.sh \
#     --env BASE_URL=https://your-app.fly.dev \
#     --env AUTH_COOKIE="connect.sid=s%3A..."
#
# Distributed (4 k6 instances):
#   K6_INSTANCE_COUNT=4 K6_INSTANCE_INDEX=0 ./tests/load/run-all.sh --env BASE_URL=...
#
# Skip tests:
#   SKIP="soak,chaos" ./tests/load/run-all.sh --env BASE_URL=...
#
# Run only specific tests:
#   ONLY="db-stress,deal-pipeline" ./tests/load/run-all.sh --env BASE_URL=...
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
mkdir -p "${RESULTS_DIR}"

SKIP="${SKIP:-}"
ONLY="${ONLY:-}"
PASS_ARGS="${*}"

# All tests in recommended execution order
TESTS=(
  "db-stress"
  "agent-pipeline"
  "deal-pipeline"
  "multi-tenant"
  "websocket-fanout"
  "soak"
  "chaos"
)

should_run() {
  local test="$1"
  if [[ -n "${ONLY}" ]]; then
    echo "${ONLY}" | grep -qw "${test}" && return 0 || return 1
  fi
  if [[ -n "${SKIP}" ]]; then
    echo "${SKIP}" | grep -qw "${test}" && return 1 || return 0
  fi
  return 0
}

echo "╔══════════════════════════════════════════════════════╗"
echo "║    AcreOS Load Testing Suite                        ║"
echo "║    Target: 10,000+ concurrent users                 ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

if [[ -n "${K6_INSTANCE_COUNT:-}" ]]; then
  echo "Distributed mode: instance ${K6_INSTANCE_INDEX:-0} of ${K6_INSTANCE_COUNT}"
fi

PASSED=0
FAILED=0
SKIPPED=0
TOTAL=${#TESTS[@]}
START_TIME=$(date +%s)

for test in "${TESTS[@]}"; do
  FILE="${SCRIPT_DIR}/k6-${test}.js"

  if ! should_run "${test}"; then
    echo "⊘ SKIP  k6-${test}.js"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [[ ! -f "${FILE}" ]]; then
    echo "⊘ SKIP  k6-${test}.js (file not found)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "▶ Running k6-${test}.js ..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if k6 run "${FILE}" \
    --out "json=${RESULTS_DIR}/${test}.json" \
    ${PASS_ARGS}; then
    echo "✓ PASS  k6-${test}.js"
    PASSED=$((PASSED + 1))
  else
    echo "✗ FAIL  k6-${test}.js"
    FAILED=$((FAILED + 1))
  fi
done

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║    Results Summary                                  ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Passed:  ${PASSED}/${TOTAL}                                      ║"
echo "║  Failed:  ${FAILED}/${TOTAL}                                      ║"
echo "║  Skipped: ${SKIPPED}/${TOTAL}                                      ║"
echo "║  Duration: ${DURATION}s                                       ║"
echo "║  Results:  tests/load/results/                      ║"
echo "╚══════════════════════════════════════════════════════╝"

if [[ ${FAILED} -gt 0 ]]; then
  exit 1
fi
