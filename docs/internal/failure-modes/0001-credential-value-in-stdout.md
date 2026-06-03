---
slug: credential-value-in-stdout
title: Credential value leaked into agent stdout / verification output
severity: critical
category: credential_handling
trigger_patterns:
  - "echo $"
  - "echo ${"
  - "curl | grep"
  - "ANTHROPIC_API_KEY"
  - "STRIPE_SECRET_KEY"
  - "DATABASE_URL"
  - "printenv"
  - "env |"
prevention: |
  Verify credentials by LENGTH, HASH, or PREFIX only. Never let the literal
  value appear in transcript, debug output, grep result, curl-pipe, or any
  file. If an agent needs to confirm a secret is set, it logs presence +
  length; never the value.
example_incident_refs:
  - feedback_credential_value_handling.md
---

# Credential value leaked into agent stdout

## What went wrong

On three separate occasions, a dispatched agent (or a Solene-led debugging
session) emitted a literal secret value into stdout while verifying that
the env was wired correctly. The values were short-lived in the
transcripts but long-lived in `/tmp/solene-dispatches/*.jsonl`, the agent
chat history, and any log forwarders that scraped stdout.

Concrete patterns that caused the leak:

- `echo $ANTHROPIC_API_KEY | head -c 12` — even truncated, the prefix can
  be enough to identify + rotate.
- `curl https://api.example.com/whoami | grep token` — when the API echoes
  the credential back in the response body.
- `printenv | grep -i secret` — dumps the whole value to stdout.
- `node -e 'console.log(process.env.X)'` — same shape, different tool.

## Why it kept happening

Each incident was technically a single mistake by a single agent, but the
*pattern* was systemic: the agent reached for the most natural debugging
incantation, and the most natural incantation prints the value. Without a
structural rule baked into the system prompt, "be careful with secrets" is
not load-bearing.

## What changed

- Added the hard rule to the dispatch system prompt:
  > NEVER write the ANTHROPIC_API_KEY value, or any other credential
  > value, into stdout or any file. Verify by length or hash only.
- This failure-mode entry is now structurally injected before every
  dispatch begins, so the agent's first attention pass sees the rule
  + the historical incident at the same time.
- `feedback_credential_value_handling.md` is the long-form discipline doc.

## Allowed verification patterns

```sh
# OK — length only
echo "ANTHROPIC_API_KEY length: ${#ANTHROPIC_API_KEY}"

# OK — hash (first 8 hex chars of a SHA-256, no reversibility)
printf '%s' "$ANTHROPIC_API_KEY" | shasum -a 256 | cut -c1-8

# OK — presence boolean
test -n "$ANTHROPIC_API_KEY" && echo "set" || echo "missing"
```

## Forbidden verification patterns

```sh
echo "$ANTHROPIC_API_KEY"            # full value
echo "${ANTHROPIC_API_KEY:0:12}"     # prefix is enough to identify
curl … | tee /tmp/whoami.log         # logs response body to disk
printenv | grep KEY                  # full dump
```
