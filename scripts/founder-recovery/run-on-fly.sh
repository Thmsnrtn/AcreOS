#!/usr/bin/env bash
# Upload a LOCAL script onto the acreos Fly machine (next to /app/scripts
# so ESM imports resolve against /app/node_modules) and execute it there —
# where the real secrets live. Same mechanism the ses-dkim-fix workflow
# uses; one ssh session so upload + run hit the same machine.
#
# Usage: ./scripts/founder-recovery/run-on-fly.sh scripts/vendor-health-probe.mjs [app]
set -euo pipefail

script="${1:?usage: run-on-fly.sh path/to/script.mjs [app]}"
app="${2:-acreos}"
[ -f "${script}" ] || { echo "No such file: ${script}" >&2; exit 1; }

# GNU base64 has -w0; macOS/BSD base64 wraps by default and lacks it.
if b64=$(base64 -w0 "${script}" 2>/dev/null); then :; else
  b64=$(base64 "${script}" | tr -d '\n')
fi

name="recovery-$(basename "${script}")"
fly ssh console -a "${app}" -C "sh -c 'echo ${b64} | base64 -d > /app/scripts/${name} && node /app/scripts/${name}'"
