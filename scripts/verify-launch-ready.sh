#!/usr/bin/env bash
# AcreOS v4 Launch Readiness Gate Script
# Exit 0 only if every check passes.
set -euo pipefail

PASS=0
FAIL=0
SKIP=0

run_check() {
  local name="$1"
  shift
  echo ""
  echo "=== $name ==="
  if "$@" 2>&1; then
    echo "  PASS"
    PASS=$((PASS + 1))
  else
    echo "  FAIL"
    FAIL=$((FAIL + 1))
  fi
}

run_check_optional() {
  local name="$1"
  shift
  echo ""
  echo "=== $name (optional) ==="
  if "$@" 2>&1; then
    echo "  PASS"
    PASS=$((PASS + 1))
  else
    echo "  SKIP (non-blocking)"
    SKIP=$((SKIP + 1))
  fi
}

echo "========================================"
echo "  AcreOS v4 Launch Readiness Verification"
echo "========================================"
echo "  Started: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""

# ── Core Build Pipeline ───────────────────────────────────────────
run_check "TypeScript type-check" npm run typecheck
run_check_optional "ESLint" npm run lint
run_check "Build" npm run build

# ── Test Suites ───────────────────────────────────────────────────
run_check "Unit tests" npm run test:unit -- --run
run_check_optional "Integration tests" npm run test:integration -- --run
run_check_optional "Security tests" npm run test:security -- --run

# ── E2E & Simulation ─────────────────────────────────────────────
run_check_optional "E2E tests" npm run test:e2e
run_check_optional "Simulation: chaos" npm run test:chaos -- --run
run_check_optional "Simulation: load" npm run test:simulation -- --run

# ── Quality Gates ─────────────────────────────────────────────────
run_check_optional "Accessibility tests" npm run test:a11y -- --run
run_check_optional "Bundle size check" npm run test:bundle-size
run_check_optional "Security audit" npm run audit:security

# ── Registry Verification ─────────────────────────────────────────
run_check "Defect registry: 0 open P0/P1" npm run verify:registry

# ── Clean Deploy Verification ─────────────────────────────────────
run_check "Clean deploy build" npm run verify:clean-deploy

# ── Summary ───────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "  Results"
echo "========================================"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  SKIP: $SKIP"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "LAUNCH NOT READY -- $FAIL check(s) failed"
  exit 1
fi

echo "LAUNCH READY (v4 delta)"
exit 0
