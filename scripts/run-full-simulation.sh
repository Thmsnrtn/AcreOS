#!/usr/bin/env bash
#
# AcreOS Full Simulation Runner
#
# Executes all 5 layers of the simulation suite:
#   Layer 1: Structural Integrity (layout-intelligence)
#   Layer 2: Perceptual Quality (perceptual-intelligence)
#   Layer 3: Behavioral Resilience (behavioral-intelligence)
#   Layer 4: Cognitive Intelligence (cognitive-intelligence)
#   Layer 5: LLM Visual Intelligence (visual-intelligence)
#
# Then builds the screenshot gallery.
#
# Usage:
#   ./scripts/run-full-simulation.sh [--layer N] [--device DEVICE] [--skip-vision]
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="$PROJECT_ROOT/tests/simulation/reports"
SCREENSHOT_DIR="$PROJECT_ROOT/tests/simulation/screenshots"

# Defaults
RUN_LAYER="all"
DEVICE_FILTER=""
SKIP_VISION=false
BASE_URL="${PLAYWRIGHT_BASE_URL:-http://localhost:5000}"

# ── Parse Args ──

while [[ $# -gt 0 ]]; do
  case "$1" in
    --layer)
      RUN_LAYER="$2"
      shift 2
      ;;
    --device)
      DEVICE_FILTER="$2"
      shift 2
      ;;
    --skip-vision)
      SKIP_VISION=true
      shift
      ;;
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--layer N] [--device DEVICE] [--skip-vision] [--base-url URL]"
      echo ""
      echo "Options:"
      echo "  --layer N        Run only layer N (1-5, or 'all')"
      echo "  --device DEVICE  Run only on DEVICE (e.g. 'desktop-chrome', 'iphone-14')"
      echo "  --skip-vision    Skip Layer 5 (LLM visual analysis)"
      echo "  --base-url URL   Override the app URL (default: http://localhost:5000)"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# ── Setup ──

mkdir -p "$REPORT_DIR" "$SCREENSHOT_DIR"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║          AcreOS Full Simulation Suite                    ║"
echo "║          14 devices × 5 intelligence layers              ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  Base URL:     $BASE_URL"
echo "  Layer:        $RUN_LAYER"
echo "  Device:       ${DEVICE_FILTER:-all 14 devices}"
echo "  Skip Vision:  $SKIP_VISION"
echo ""

export PLAYWRIGHT_BASE_URL="$BASE_URL"

# Build Playwright project filter
PW_PROJECT_ARGS=""
if [[ -n "$DEVICE_FILTER" ]]; then
  PW_PROJECT_ARGS="--project=$DEVICE_FILTER"
fi

# Track results
LAYER_RESULTS=()
TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_SKIP=0
START_TIME=$(date +%s)

run_layer() {
  local layer_num="$1"
  local layer_name="$2"
  local spec_file="$3"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Layer $layer_num: $layer_name"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local layer_start=$(date +%s)
  local exit_code=0

  npx playwright test "$spec_file" $PW_PROJECT_ARGS \
    --reporter=list \
    2>&1 | tee "$REPORT_DIR/layer-${layer_num}.log" || exit_code=$?

  local layer_end=$(date +%s)
  local duration=$((layer_end - layer_start))

  if [[ $exit_code -eq 0 ]]; then
    LAYER_RESULTS+=("  ✅ Layer $layer_num ($layer_name): PASSED in ${duration}s")
    ((TOTAL_PASS++)) || true
  else
    LAYER_RESULTS+=("  ❌ Layer $layer_num ($layer_name): FAILED in ${duration}s")
    ((TOTAL_FAIL++)) || true
  fi

  echo ""
}

# ── Run Layers ──

if [[ "$RUN_LAYER" == "all" || "$RUN_LAYER" == "1" ]]; then
  run_layer 1 "Structural Integrity" "tests/e2e/layout-intelligence.spec.ts"
fi

if [[ "$RUN_LAYER" == "all" || "$RUN_LAYER" == "2" ]]; then
  run_layer 2 "Perceptual Quality" "tests/e2e/perceptual-intelligence.spec.ts"
fi

if [[ "$RUN_LAYER" == "all" || "$RUN_LAYER" == "3" ]]; then
  run_layer 3 "Behavioral Resilience" "tests/e2e/behavioral-intelligence.spec.ts"
fi

if [[ "$RUN_LAYER" == "all" || "$RUN_LAYER" == "4" ]]; then
  run_layer 4 "Cognitive Intelligence" "tests/e2e/cognitive-intelligence.spec.ts"
fi

# Layer 5: LLM Visual Intelligence (requires ANTHROPIC_API_KEY)
if [[ "$RUN_LAYER" == "all" || "$RUN_LAYER" == "5" ]]; then
  if [[ "$SKIP_VISION" == "true" ]]; then
    LAYER_RESULTS+=("  ⏭  Layer 5 (LLM Visual Intelligence): SKIPPED")
    ((TOTAL_SKIP++)) || true
  elif [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Layer 5: LLM Visual Intelligence"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ⚠ ANTHROPIC_API_KEY not set — skipping visual intelligence"
    LAYER_RESULTS+=("  ⏭  Layer 5 (LLM Visual Intelligence): SKIPPED (no API key)")
    ((TOTAL_SKIP++)) || true
  else
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Layer 5: LLM Visual Intelligence"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    LAYER5_START=$(date +%s)
    LAYER5_EXIT=0

    npx tsx "$PROJECT_ROOT/tests/simulation/visual-intelligence.ts" all \
      2>&1 | tee "$REPORT_DIR/layer-5.log" || LAYER5_EXIT=$?

    LAYER5_END=$(date +%s)
    LAYER5_DURATION=$((LAYER5_END - LAYER5_START))

    if [[ $LAYER5_EXIT -eq 0 ]]; then
      LAYER_RESULTS+=("  ✅ Layer 5 (LLM Visual Intelligence): PASSED in ${LAYER5_DURATION}s")
      ((TOTAL_PASS++)) || true
    else
      LAYER_RESULTS+=("  ❌ Layer 5 (LLM Visual Intelligence): FAILED in ${LAYER5_DURATION}s")
      ((TOTAL_FAIL++)) || true
    fi
  fi
fi

# ── Screenshot Registry & Gallery ──

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Building Screenshot Gallery"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

npx tsx "$PROJECT_ROOT/tests/simulation/screenshot-registry.ts" 2>&1 || echo "  ⚠ Gallery generation failed (non-fatal)"
echo ""

# ── Summary ──

END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))

echo "╔══════════════════════════════════════════════════════════╗"
echo "║                  Simulation Results                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

for result in "${LAYER_RESULTS[@]}"; do
  echo "$result"
done

echo ""
echo "  Total: $TOTAL_PASS passed, $TOTAL_FAIL failed, $TOTAL_SKIP skipped"
echo "  Duration: ${TOTAL_DURATION}s"
echo "  Reports: $REPORT_DIR/"
echo "  Gallery: $REPORT_DIR/gallery.html"
echo ""

SCREENSHOT_COUNT=$(find "$SCREENSHOT_DIR" -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
echo "  Screenshots captured: $SCREENSHOT_COUNT"
echo ""

if [[ $TOTAL_FAIL -gt 0 ]]; then
  echo "  ⚠ Some layers had failures — check individual logs for details"
  exit 1
fi

echo "  ✅ All simulation layers passed"
