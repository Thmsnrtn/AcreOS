#!/usr/bin/env bash
set -euo pipefail

# One-time setup for AcreOS Oz cloud agent
# Prereqs: oz CLI installed and authenticated

ENV_NAME=${ENV_NAME:-acreos-dev}
REPO=${REPO:-Thmsnrtn/AcreOS}
DOCKER_IMAGE=${DOCKER_IMAGE:-node:20-bullseye}

echo "[oz] Creating environment (if missing): $ENV_NAME"
if ! oz environment get --name "$ENV_NAME" >/dev/null 2>&1; then
  oz environment create \
    --name "$ENV_NAME" \
    --docker-image "$DOCKER_IMAGE" \
    --repo "$REPO" \
    --setup-command "npm ci" \
    --setup-command "npm run check || true" \
    --personal
else
  echo "[oz] Environment exists; skipping create"
fi

cat <<'TXT'

[oz] Secrets (optional)
This agent can work on UI/UX + code quality without external API keys.
If you want AI/SMS/Mail features to work in cloud runs, create secrets:

  oz secret create OPENAI_API_KEY
  oz secret create SENDGRID_API_KEY
  oz secret create LOB_TEST_API_KEY
  oz secret create STRIPE_SECRET_KEY
  oz secret create MAPBOX_TOKEN

Oz will prompt you to paste each value securely.

[oz] Run the cloud agent
Example:
  oz agent run-cloud \
    --skill acreos-autonomous-engineer \
    --environment $ENV_NAME \
    --model gpt-5.1 \
    --name "AcreOS autonomous improvement" \
    --prompt "Pick one top issue from logs/audit and ship a small improvement. Push a branch and print the compare URL."

TXT
