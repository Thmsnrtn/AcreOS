#!/usr/bin/env bash
# ============================================================================
# Monte Carlo over the year harness: N seeds, each on a FRESH run database
# cloned from the template, each with its own stack start/stop, so no seed
# inherits another's state. Instances (A, B, …) run on separate ports, DBs and
# directories, so two can run side by side on a big enough machine.
#
#   montecarlo.sh <instance> <days> <seed> [<seed> …] [-- extra year.ts args]
#
#   SIMPLAT_LONG=1 is required for days > 30: a year is an opt-in long run
#   (hours, not minutes). The default CI suite never calls this script; it runs
#   tests/simulation/platform/platform.test.ts (in-process, seconds).
#
# Requires the template (stack.sh template) and a synced prod-like build
# (stack.sh sync). Output: $SIMPLAT_ROOT/<instance>/out/seed-<n>/metrics.json;
# then `npx tsx tests/simulation/platform/scorecard.ts <dirs…>`.
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INST="${1:?instance}"; DAYS="${2:?days}"; shift 2
SEEDS=(); EXTRA=()
while [ $# -gt 0 ]; do if [ "$1" = "--" ]; then shift; EXTRA=("$@"); break; fi; SEEDS+=("$1"); shift; done
if [ "$DAYS" -gt 30 ] && [ "${SIMPLAT_LONG:-}" != "1" ]; then echo "a ${DAYS}-day run is an opt-in long run: set SIMPLAT_LONG=1"; exit 2; fi
ROOT="${SIMPLAT_ROOT:-/tmp/simplat}"
case "$INST" in
  A) BASEPORT=5400; MPORT=7900; RDB=12 ;;
  B) BASEPORT=5410; MPORT=7910; RDB=13 ;;
  C) BASEPORT=5420; MPORT=7920; RDB=14 ;;
  *) echo "instance A|B|C"; exit 2 ;;
esac
export SIMPLAT_DIR="$ROOT/$INST" SIMPLAT_DB="acreos_simplat_run_$(echo "$INST" | tr A-Z a-z)"
export SIMPLAT_WEB_PORT=$BASEPORT SIMPLAT_WORKER_PORT=$((BASEPORT + 1)) SIMPLAT_MODEL_PORT=$MPORT SIMPLAT_PROVIDER_PORT=$((MPORT + 1)) SIMPLAT_REDIS_DB=$RDB
mkdir -p "$SIMPLAT_DIR"
for s in "${SEEDS[@]}"; do
  echo "$(date -u +%FT%TZ) [$INST] seed $s: fresh db + stack"
  bash "$HERE/stack.sh" down >/dev/null 2>&1
  rm -f "$SIMPLAT_DIR"/{egress.jsonl,dbtap.jsonl} "$SIMPLAT_DIR"/provider/provider-calls.jsonl "$SIMPLAT_DIR"/standin/calls.jsonl "$SIMPLAT_DIR"/standin/rules.json "$SIMPLAT_DIR"/dbtap-stats.*
  bash "$HERE/stack.sh" db >/dev/null || { echo "db failed"; exit 1; }
  bash "$HERE/stack.sh" up | tail -1
  nice -n 5 bash "$HERE/stack.sh" harness tests/simulation/platform/year.ts --seed "$s" --days "$DAYS" "${EXTRA[@]}" > "$SIMPLAT_DIR/seed-$s${EXTRA:+-x}.log" 2>&1
  echo "$(date -u +%FT%TZ) [$INST] seed $s exit=$?" | tee -a "$SIMPLAT_DIR/montecarlo-status.txt"
  bash "$HERE/stack.sh" down >/dev/null 2>&1
done
[ "${SIMPLAT_KEEP_DB:-}" = "1" ] || psql "postgresql://acreos:acreos@localhost:5432/postgres" -qc "drop database if exists $SIMPLAT_DB" >/dev/null 2>&1
echo "$(date -u +%FT%TZ) [$INST] done"
