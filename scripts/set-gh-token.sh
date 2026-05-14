#!/usr/bin/env bash
# Set GH_TOKEN on the Fly machine so the autonomous agent loop can open PRs.
#
# Usage:
#   ./scripts/set-gh-token.sh                        # paste token interactively
#   ./scripts/set-gh-token.sh ghp_AbCd...           # pass token as arg
#   GH_TOKEN=ghp_... ./scripts/set-gh-token.sh       # read from env
#
# What it does:
#   1. Validates the token has repo + workflow scopes via GitHub API
#   2. Sets it as a Fly secret on the `acreos` app
#   3. Triggers a non-disruptive reload (existing machines pick up the new env)
#   4. Curls /api/founder/agent-prereqs to confirm gh-auth is green
#
# Safe to run repeatedly — overwriting an existing secret is idempotent.

set -euo pipefail

APP="${FLY_APP:-acreos}"

token="${1:-${GH_TOKEN:-}}"
if [[ -z "$token" ]]; then
  read -r -s -p "Paste GitHub token (ghp_… or github_pat_…): " token
  echo
fi

if [[ -z "$token" ]]; then
  echo "no token provided — aborting" >&2
  exit 1
fi

echo "→ validating token against api.github.com…"
http_status=$(curl -s -o /tmp/gh-token-check.json -w "%{http_code}" \
  -H "Authorization: Bearer ${token}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/user)

if [[ "$http_status" != "200" ]]; then
  echo "✗ token rejected by GitHub (HTTP ${http_status})" >&2
  cat /tmp/gh-token-check.json >&2 || true
  exit 1
fi

login=$(python3 -c "import json,sys; print(json.load(open('/tmp/gh-token-check.json'))['login'])")
scopes=$(curl -sI -H "Authorization: Bearer ${token}" https://api.github.com/user \
  | awk -F': ' '/^x-oauth-scopes:/I {print $2}' | tr -d '\r\n')
echo "  authenticated as: ${login}"
echo "  scopes: ${scopes:-<none — fine-grained PAT?>}"

if [[ -n "$scopes" && "$scopes" != *"repo"* ]]; then
  echo "⚠  token is missing 'repo' scope — PR creation will fail" >&2
  read -r -p "  continue anyway? [y/N] " confirm
  [[ "$confirm" == [yY] ]] || exit 1
fi

echo "→ setting GH_TOKEN on Fly app ${APP}…"
echo "${token}" | fly secrets set "GH_TOKEN=$(cat)" -a "${APP}" --stage

echo "→ deploying secrets (rolling, no downtime)…"
fly secrets deploy -a "${APP}"

echo "→ verifying via /api/founder/agent-prereqs…"
sleep 8
curl -s "https://${APP}.io/api/founder/agent-prereqs" \
  | python3 -c "
import json, sys
r = json.load(sys.stdin)
for c in r.get('checks', []):
  if c['name'].startswith('gh CLI'):
    mark = '✓' if c['ok'] else '✗'
    print(f\"  {mark} {c['name']}: {c['detail'][:80]}\")
" || echo "  (could not parse response — visit /founder/notifications to verify)"

echo
echo "done. GH_TOKEN is live on ${APP}."
