#!/usr/bin/env bash
# Set a single Fly secret without the value ever touching argv, shell
# history, or logs. Usage:
#   ./scripts/founder-recovery/set-secret.sh AWS_ACCESS_KEY_ID [app]
# Paste the value at the hidden prompt; it goes straight to
# `fly secrets import` via stdin. Machines restart on apply.
set -euo pipefail

name="${1:?usage: set-secret.sh SECRET_NAME [app]}"
app="${2:-acreos}"

read -rs -p "Paste value for ${name} (input hidden): " value
echo
if [ -z "${value}" ]; then
  echo "Empty value — aborting." >&2
  exit 1
fi

printf '%s=%s\n' "${name}" "${value}" | fly secrets import -a "${app}"
echo "✓ ${name} set on ${app} (machines will restart)."
