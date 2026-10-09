#!/usr/bin/env bash
# ============================================================================
# The simulation platform's stack: a production-like AcreOS (web + worker from
# dist/), the model stand-in (brain mode), the market provider stand-in, one
# simulation database built from the repo's migrations with the one clock
# (simclock.sql) and the tenant tap (tenant-tap.sql), and Redis on its own
# index. Nothing here talks to a real provider.
#
#   stack.sh sync                 copy the worktree to $SIMPLAT_PRODLIKE, build server bundles
#   stack.sh build-client         also build the client (UI walks only)
#   stack.sh template             build the template DB acreos_simplat_tpl (migrations + clock + tap + seed)
#   stack.sh db                   (re)create the run DB $SIMPLAT_DB from the template
#   stack.sh up | down | status   start / stop (by PID) web, worker, stand-ins
#   stack.sh harness <script.ts> [args]   run a harness inside the world (env -i)
#
# Environment (defaults in brackets): SIMPLAT_DIR [scratch run dir],
# SIMPLAT_PRODLIKE [/tmp/acreos-simplat-prodlike], SIMPLAT_DB [acreos_simplat_run],
# SIMPLAT_WEB_PORT [5400], SIMPLAT_WORKER_PORT [5401], SIMPLAT_MODEL_PORT [7900],
# SIMPLAT_PROVIDER_PORT [7901], SIMPLAT_REDIS_DB [12], SIMPLAT_BRAIN [capable],
# SIMPLAT_PGBASE [postgresql://acreos:acreos@localhost:5432], SIMPLAT_REDIS_HOSTPORT [localhost:6379].
#
# Ports are checked with lsof before anything binds; the app binds with
# reusePort, so two servers on one port would silently share traffic.
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
D="${SIMPLAT_DIR:-/tmp/simplat-run}"
P="${SIMPLAT_PRODLIKE:-/tmp/acreos-simplat-prodlike}"
DB="${SIMPLAT_DB:-acreos_simplat_run}"
TPL="acreos_simplat_tpl"
PGBASE="${SIMPLAT_PGBASE:-postgresql://acreos:acreos@localhost:5432}"
WEB="${SIMPLAT_WEB_PORT:-5400}"; WORKER="${SIMPLAT_WORKER_PORT:-5401}"
MODEL="${SIMPLAT_MODEL_PORT:-7900}"; PROV="${SIMPLAT_PROVIDER_PORT:-7901}"
RDB="${SIMPLAT_REDIS_DB:-12}"
BRAIN="${SIMPLAT_BRAIN:-capable}"
mkdir -p "$D"/{logs,home,standin,provider,ca,out}

envfile() {
  # Dummy credentials only — every value below is a local stand-in's.
  cat > "$D/simplat.env" <<EOF
export NODE_ENV=production
export E2E_TEST_AUTH=1
export CI=true
export SENTRY_SOURCEMAPS=skip
export CLERK_SECRET_KEY=sk_test_e2e_dummy
export VITE_CLERK_PUBLISHABLE_KEY=pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk
export ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
export FIELD_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
export SESSION_SECRET=e2e-session-secret-at-least-32-characters-long
export INBOUND_EMAIL_SNS_ONLY=1
export INBOUND_EMAIL_WEBHOOK_SECRET=e2e-dummy-inbound-email-webhook-secret-0123456789abcdef
# SNS topic pins (fail closed when unset). The year posts no SES/inbound-email
# callbacks today; pinned so a run that does reaches the verifier, not a refusal.
export INBOUND_EMAIL_SNS_TOPIC_ARNS=arn:aws:sns:us-east-1:000000000000:simplat-inbound-email
export SES_EVENTS_SNS_TOPIC_ARNS=arn:aws:sns:us-east-1:000000000000:simplat-ses-events
export FOUNDER_EMAIL=founder-e2e@acreos.test
export FOUNDER_EMAILS=founder-e2e@acreos.test
export TWILIO_AUTH_TOKEN=e2e-dummy-twilio-token
export TWILIO_ACCOUNT_SID=ACe2e00000000000000000000000000000
export TWILIO_PHONE_NUMBER=+15005550006
export ANTHROPIC_API_KEY=standin
export OPENROUTER_API_KEY=standin
export AI_INTEGRATIONS_OPENROUTER_API_KEY=standin
export OPENAI_API_KEY=standin
export AI_INTEGRATIONS_OPENAI_API_KEY=standin
export STRIPE_SECRET_KEY=sk_test_simplat_dummy_000000000000 # dummy // secret-scan:allow
export STRIPE_WEBHOOK_SECRET=whsec_simplat_dummy
export AWS_ACCESS_KEY_ID=AKIASIMPLAT000000000 # dummy, local stand-in only // secret-scan:allow
export AWS_SECRET_ACCESS_KEY=simplat-not-a-real-secret # dummy // secret-scan:allow
export AWS_SES_FROM_EMAIL=noreply@acreos.sim
export AWS_SES_REGION=us-east-1
export AWS_ENDPOINT_URL=http://127.0.0.1:$PROV
export LOB_API_KEY=test_simplat_dummy
export LOB_HOST=http://127.0.0.1:$PROV/lob/v1/
export ANTHROPIC_BASE_URL=http://127.0.0.1:$MODEL
export AI_INTEGRATIONS_OPENROUTER_BASE_URL=http://127.0.0.1:$MODEL/api/v1
export SOLENE_CHAT_OPENROUTER_BASE_URL=http://127.0.0.1:$MODEL
export AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:$MODEL/v1
export DATABASE_URL=$PGBASE/$DB
export REDIS_URL=redis://${SIMPLAT_REDIS_HOSTPORT:-localhost:6379}/$RDB
export PORT=$WEB
export APP_URL=http://localhost:$WEB
export PUBLIC_APP_URL=http://localhost:$WEB
export HOME=$D/home
export PATH=/opt/node22/bin:/usr/local/bin:/usr/bin:/bin
export SOLENE_DISPATCH_TRANSCRIPT_DIR=$D/home/dispatches
export SOLENE_PAGE_TOPIC=acreos-simplat-topic
export WORLD_CERT_DIR=$D/ca
export NODE_EXTRA_CA_CERTS=$D/ca/ca.pem
export WORLD_EGRESS_LOG=$D/egress.jsonl
export WORLD_EGRESS_RULES=$D/egress-rules.json
export PROVIDER_PORT=$PROV
export PROVIDER_DIR=$D/provider
export STANDIN_PORT=$MODEL
export STANDIN_DIR=$D/standin
export ACREOS_SIM_CLOCK_FILE=$D/clock.json
export SIMPLAT_DBTAP_LOG=$D/dbtap.jsonl
export SIMPLAT_DBTAP_STATS=$D/dbtap-stats
export SIMPLAT_DIR=$D
export SIMPLAT_REPO=$REPO
export MARKET_OUT=$D/out/market
export CAMPAIGN_OUT=$D/out/market
EOF
  [ -f "$D/clock.json" ] || echo '{"offsetMs":0}' > "$D/clock.json"
  [ -f "$D/egress-rules.json" ] || echo '{"amazonaws.com":"mock","twilio.com":"mock","ntfy.sh":"mock","stripe.com":"mock"}' > "$D/egress-rules.json"
  [ -f "$D/standin/rules.json" ] || echo "{\"default\":\"brain:$REPO/tests/simulation/standin/brains/$BRAIN.mjs\",\"rules\":[]}" > "$D/standin/rules.json"
}

ca() {
  [ -f "$D/ca/leaf.pem" ] && return
  ( cd "$D/ca" && openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 30 -subj "/CN=simplat-ca" >/dev/null 2>&1 \
    && openssl req -newkey rsa:2048 -nodes -keyout leaf.key -out leaf.csr -subj "/CN=simplat-mock" >/dev/null 2>&1 \
    && printf "subjectAltName=DNS:*.amazonaws.com,DNS:*.twilio.com,DNS:api.twilio.com,DNS:ntfy.sh,DNS:api.stripe.com,DNS:*.stripe.com,DNS:email.us-east-1.amazonaws.com,DNS:localhost,IP:127.0.0.1\n" > san.ext \
    && openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out leaf.pem -days 30 -extfile san.ext >/dev/null 2>&1 )
}

portfree() { ! lsof -i ":$1" -sTCP:LISTEN >/dev/null 2>&1; }
start() { # name cmd...
  local name=$1; shift
  nohup "$@" > "$D/logs/$name.log" 2>&1 &
  echo $! > "$D/$name.pid"
}
alive() { local pid; pid=$(cat "$D/$1.pid" 2>/dev/null) && [ -n "$pid" ] && ps -p "$pid" >/dev/null 2>&1; }

case "${1:-}" in
  sync)
    mkdir -p "$P"
    ( cd "$REPO" && tar --exclude=./.git --exclude=./docs --exclude=./node_modules --exclude=./dist --exclude=./tests/simulation/reports -cf - . ) | tar -C "$P" -xf -
    [ -e "$P/node_modules" ] || ln -s "$REPO/node_modules" "$P/node_modules"
    ( cd "$P" && env -u NODE_OPTIONS flock /home/user/wt/.gate.lock node "$HERE/build-server.mjs" "$P" )
    ;;
  build-client)
    ( cd "$P" && env -u NODE_OPTIONS flock /home/user/wt/.gate.lock npx vite build --logLevel warn )
    ;;
  template)
    envfile
    psql "$PGBASE/postgres" -qc "drop database if exists $TPL" -c "create database $TPL"
    psql "$PGBASE/$TPL" -q -f "$REPO/tests/simulation/platform/simclock.sql"
    ( cd "$REPO" && DATABASE_URL="$PGBASE/$TPL" env -u NODE_OPTIONS bash scripts/ci/build-schema-from-repo.sh > "$D/logs/template-schema.log" 2>&1 ) || { echo "schema build failed: $D/logs/template-schema.log"; exit 1; }
    psql "$PGBASE/$TPL" -q -f "$REPO/tests/simulation/platform/template-clean.sql"
    psql "$PGBASE/$TPL" -q -f "$REPO/tests/simulation/campaign/founder/simdb.sql"
    psql "$PGBASE/$TPL" -q -f "$REPO/tests/simulation/platform/tenant-tap.sql" >/dev/null
    ( cd "$REPO" && DATABASE_URL="$PGBASE/$TPL" npx tsx tests/simulation/campaign/founder/seed.ts > "$D/logs/seed.log" 2>&1 ) || { echo "seed failed: $D/logs/seed.log"; exit 1; }
    echo "template $TPL ready"
    ;;
  db)
    envfile
    psql "$PGBASE/postgres" -qc "select pg_terminate_backend(pid) from pg_stat_activity where datname='$DB'" >/dev/null
    psql "$PGBASE/postgres" -qc "drop database if exists $DB" -c "create database $DB template $TPL"
    psql "$PGBASE/$DB" -qc "alter database $DB set search_path = \"\$user\", public, simclock, pg_catalog" -c "update simclock.state set offset_ms = 0"
    echo '{"offsetMs":0}' > "$D/clock.json"
    redis-cli -u "redis://${SIMPLAT_REDIS_HOSTPORT:-localhost:6379}/$RDB" flushdb >/dev/null
    : > "$D/dbtap.jsonl"
    echo "db $DB from $TPL"
    ;;
  up)
    envfile; ca
    for p in $WEB $WORKER $MODEL $PROV; do portfree "$p" || { echo "port $p is busy — refusing"; exit 1; }; done
    start standin env -i PATH=/opt/node22/bin:/usr/bin:/bin STANDIN_PORT="$MODEL" STANDIN_DIR="$D/standin" node "$REPO/tests/simulation/standin/model-standin.mjs"
    start provider env -i PATH=/opt/node22/bin:/usr/bin:/bin PROVIDER_PORT="$PROV" PROVIDER_DIR="$D/provider" node "$REPO/tests/simulation/campaign/market/provider-standin.mjs"
    start web env -i bash -c ". $D/simplat.env; export FLY_PROCESS_GROUP=app WORLD_ROLE=web; cd $P && exec node --import $P/tests/simulation/platform/preload.mjs dist/index.cjs"
    start worker env -i bash -c ". $D/simplat.env; unset E2E_TEST_AUTH; export FLY_APP_NAME=acreos-simplat FLY_PROCESS_GROUP=worker WORLD_ROLE=worker PORT=$WORKER WORKER_DISABLE_SCHEDULED_JOBS=1 DISABLE_BACKGROUND_JOBS=1; cd $P && exec node --import $P/tests/simulation/platform/preload.mjs dist/worker.cjs"
    for i in $(seq 1 90); do curl -s -o /dev/null -w "%{http_code}" "http://localhost:$WEB/api/health" 2>/dev/null | grep -q 200 && break; sleep 2; done
    curl -s -o /dev/null -w "web /api/health %{http_code}\n" "http://localhost:$WEB/api/health"
    ;;
  down)
    for f in web worker standin provider; do pid=$(cat "$D/$f.pid" 2>/dev/null) && [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null; done
    for i in $(seq 1 20); do a=0; for f in web worker standin provider; do alive $f && a=1; done; [ $a = 0 ] && break; sleep 1; done
    for f in web worker standin provider; do alive $f && kill -KILL "$(cat "$D/$f.pid")" 2>/dev/null; rm -f "$D/$f.pid"; done
    echo down
    ;;
  status)
    for f in web worker standin provider; do alive $f && echo "$f up ($(cat "$D/$f.pid"))" || echo "$f down"; done
    ;;
  harness)
    shift; S="$1"; shift
    envfile
    # Harness scripts run from the prod-like copy, so the harness and simkit's srv()
    # load ONE copy of the server modules (relative path from the copy root).
    cd "$P" && exec env -i ARGS="$*" S="$P/$S" bash -c ". $D/simplat.env; export PORT=5402 DISABLE_BACKGROUND_JOBS=1 SERVER_ROOT=$P WORLD_ROLE=harness SIM_BASE_URL=http://localhost:$WEB FOUNDER_SIM_OUT=$D/out; exec node --import $P/tests/simulation/platform/preload.mjs --import tsx \"\$S\" \$ARGS"
    ;;
  *) sed -n 2,24p "$0"; exit 2 ;;
esac
