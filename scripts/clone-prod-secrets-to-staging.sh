#!/usr/bin/env bash
#
# Copy integration secrets from the PROD Fly app to the STAGING app WITHOUT
# hunting them down or ever displaying a value.
#
# Fly secrets are write-only (you can't read a value back via the CLI/API), but
# the values exist as env vars inside the running prod machine. This pipes prod's
# env → grep (filter to the keys realism mode needs) → `fly secrets import` on
# staging. Values flow machine→machine through the pipe; nothing prints to your
# terminal, your clipboard, or any transcript.
#
# Run it yourself, in YOUR Fly-authenticated shell:
#   bash scripts/clone-prod-secrets-to-staging.sh              # SAFE: read/auth keys only
#   bash scripts/clone-prod-secrets-to-staging.sh --with-sends # also copy Lob/Twilio/SES (LIVE sends!)
#
# ⚠️  These are your PROD (live) keys. The SAFE default copies only the keys the
#     realism audit actually exercises — parcel data (Regrid), auth (Clerk), and
#     Pax (OpenRouter) — all reads/auth, no outbound sends. The send-side keys
#     (Lob postage, Twilio SMS, SES email) are EXCLUDED unless you pass
#     --with-sends, so audit traffic can't trigger real mail/SMS/email on your
#     live accounts. Stripe is excluded from the safe set too (a live key + a
#     checkout flow = a real charge); add it deliberately if you need it.
set -euo pipefail

PROD="${PROD_APP:-acreos}"
STAGING="${STAGING_APP:-acreos-staging}"

# Read/auth keys the audit uses — safe to run with live values (no outbound sends).
SAFE='^(REGRID_API_KEY|CLERK_SECRET_KEY|CLERK_PUBLISHABLE_KEY|VITE_CLERK_PUBLISHABLE_KEY|AI_INTEGRATIONS_OPENROUTER_API_KEY|AI_INTEGRATIONS_OPENAI_API_KEY)='
# Outbound-send keys — copying these means staging CAN send real mail/SMS/email.
SENDS='^(LOB_LIVE_API_KEY|LOB_TEST_API_KEY|TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|TWILIO_PHONE_NUMBER|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SES_FROM_EMAIL|STRIPE_SECRET_KEY|STRIPE_PUBLISHABLE_KEY)='

FILTER="$SAFE"
if [ "${1:-}" = "--with-sends" ]; then
  FILTER="${SAFE%$}|${SENDS#^}"   # union the two patterns
  echo "⚠️  Including SEND-side keys — staging will be able to send REAL mail/SMS/email."
fi

command -v flyctl >/dev/null || { echo "flyctl not installed"; exit 1; }
flyctl auth whoami >/dev/null 2>&1 || { echo "not logged in to Fly — run: fly auth login"; exit 1; }

echo "Cloning secrets ${PROD} → ${STAGING} (matching: ${FILTER})"
# printenv on the prod machine → filter → import to staging. The pipe never
# surfaces values. `fly secrets import` reads NAME=VALUE from stdin.
flyctl ssh console -a "$PROD" -C "printenv" \
  | grep -E "$FILTER" \
  | flyctl secrets import -a "$STAGING"

echo "Done. Verify (names + digests only, never values):  fly secrets list -a ${STAGING}"
echo "Then tell the agent — it will re-hit /api/health to confirm each integration flipped to configured."
