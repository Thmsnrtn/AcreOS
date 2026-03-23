#!/usr/bin/env bash
# Docker Smoke Test — verifies core functionality after container startup.
#
# Run by docker-compose.test.yml smoke-test service, or manually:
#   APP_URL=http://localhost:5000 ./scripts/docker-smoke-test.sh

set -euo pipefail

APP_URL="${APP_URL:-http://app:5000}"
PASS=0
FAIL=0

check() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  ✓ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo "═══ Docker Smoke Test ═══"
echo "Target: $APP_URL"
echo ""

# 1. Health check
check "GET /api/health returns 200" \
  curl -sf "$APP_URL/api/health"

# 2. Auth page loads
check "GET /auth page returns 200" \
  curl -sf -o /dev/null -w "%{http_code}" "$APP_URL/auth" | grep -q "200"

# 3. Register a test user
REG_RESPONSE=$(curl -sf -X POST "$APP_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke-test@acreos-test.com","password":"SmokeTest2026!","firstName":"Smoke","lastName":"Test"}' \
  -c /tmp/smoke-cookies.txt 2>/dev/null || echo '{"error":"registration failed or already exists"}')
if echo "$REG_RESPONSE" | grep -q '"id"'; then
  echo "  ✓ POST /api/auth/register creates test user"
  PASS=$((PASS + 1))
else
  echo "  ~ POST /api/auth/register (user may already exist, trying login)"
fi

# 4. Login
LOGIN_RESPONSE=$(curl -sf -X POST "$APP_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke-test@acreos-test.com","password":"SmokeTest2026!"}' \
  -c /tmp/smoke-cookies.txt 2>/dev/null || echo '{"error":"login failed"}')
if echo "$LOGIN_RESPONSE" | grep -q '"id"\|"user"\|"success"'; then
  echo "  ✓ POST /api/auth/login succeeds"
  PASS=$((PASS + 1))
else
  echo "  ✗ POST /api/auth/login failed"
  FAIL=$((FAIL + 1))
fi

# 5. Create a lead
LEAD_RESPONSE=$(curl -sf -X POST "$APP_URL/api/leads" \
  -H "Content-Type: application/json" \
  -b /tmp/smoke-cookies.txt \
  -d '{"firstName":"Smoke","lastName":"Lead","email":"lead@test.com","type":"seller","status":"new"}' 2>/dev/null || echo '{"error":"failed"}')
if echo "$LEAD_RESPONSE" | grep -q '"id"'; then
  echo "  ✓ POST /api/leads creates a lead"
  PASS=$((PASS + 1))
else
  echo "  ✗ POST /api/leads failed"
  FAIL=$((FAIL + 1))
fi

# 6. Verify lead was created
LEADS_RESPONSE=$(curl -sf "$APP_URL/api/leads" \
  -b /tmp/smoke-cookies.txt 2>/dev/null || echo '[]')
LEAD_COUNT=$(echo "$LEADS_RESPONSE" | grep -o '"id"' | wc -l)
if [ "$LEAD_COUNT" -ge 1 ]; then
  echo "  ✓ GET /api/leads returns ≥1 lead ($LEAD_COUNT found)"
  PASS=$((PASS + 1))
else
  echo "  ✗ GET /api/leads returned 0 leads"
  FAIL=$((FAIL + 1))
fi

# Clean up
rm -f /tmp/smoke-cookies.txt

echo ""
echo "═══ Results: $PASS passed, $FAIL failed ═══"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
