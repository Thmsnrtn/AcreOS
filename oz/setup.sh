#!/usr/bin/env bash
set -euo pipefail

# One-time setup for AcreOS Oz cloud agent
# Prereqs: oz CLI installed and authenticated (see https://docs.warp.dev/reference/cli)

AGENT_NAME=${AGENT_NAME:-acreos-autonomous-engineer}
ENV_NAME=${ENV_NAME:-acreos-dev}
IMAGE=${IMAGE:-ghcr.io/YOUR_ORG/acreos-agent:latest}
REPO_URL=${REPO_URL:-https://github.com/Thmsnrtn/AcreOS.git}

# 1) Build and publish the image (optional if you host elsewhere)
# docker build -t "$IMAGE" -f oz/Dockerfile .
# docker push "$IMAGE"

# 2) Create/update environment
if ! oz env get "$ENV_NAME" >/dev/null 2>&1; then
  oz env create \
    --name "$ENV_NAME" \
    --image "$IMAGE" \
    --repo "$REPO_URL" \
    --workdir /workspace \
    --setup 'npm ci' \
    --setup 'npm run check || true'
else
  echo "Env $ENV_NAME exists; skipping create"
fi

# 3) Set required secrets (replace placeholders)
# NOTE: never echo real secrets. Use your own secure values below.
: "${OPENAI_API_KEY:?Set OPENAI_API_KEY in your shell}"
: "${MAPBOX_TOKEN:?Set MAPBOX_TOKEN in your shell}"
: "${STRIPE_SECRET_KEY:?Set STRIPE_SECRET_KEY in your shell}"
: "${SENDGRID_API_KEY:?Set SENDGRID_API_KEY in your shell}"
: "${LOB_TEST_API_KEY:?Set LOB_TEST_API_KEY in your shell}"

oz secrets set OPENAI_API_KEY "$OPENAI_API_KEY"
oz secrets set MAPBOX_TOKEN "$MAPBOX_TOKEN"
oz secrets set STRIPE_SECRET_KEY "$STRIPE_SECRET_KEY"
oz secrets set SENDGRID_API_KEY "$SENDGRID_API_KEY"
oz secrets set LOB_TEST_API_KEY "$LOB_TEST_API_KEY"

# 4) Register the agent spec
oz agent create --file oz/agent.acreos.yaml || oz agent update --file oz/agent.acreos.yaml

echo "\nSetup completed. To run a task manually:"
echo "  oz agent run $AGENT_NAME --task quick-win-ux --profile ux --context 'Ship a small UX win.'"
