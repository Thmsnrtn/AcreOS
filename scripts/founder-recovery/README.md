# Founder recovery kit — dead vendor keys + DKIM (2026-07-04)

Runs the entire recovery from your laptop with Claude (Opus) driving:
new AWS key → Fly secrets → SES/DKIM repair → Anthropic/OpenAI/SendGrid
rotation → optional Cloudflare Email Routing → full re-verification.

You log into each vendor console ONCE in a real browser window; the agent
drives clicks over CDP and never sees your passwords. Secret values are
piped straight into `fly secrets import` via stdin — never argv, never
logs, never git.

## Prerequisites (one-time)

```bash
npm ci                          # repo deps (includes @playwright/test)
npx playwright install chromium # local browser for the console bridge
fly auth whoami                 # must print your account
```

## Run it

Terminal 1 — the console bridge (leave it open; log in when pages appear):

```bash
node scripts/founder-recovery/browser.mjs
```

Terminal 2 — hand the mission to Opus:

```bash
claude --model opus "$(cat scripts/founder-recovery/PROMPT.md)"
```

The agent works phase by phase with a verification gate after each, and
stops to ask you whenever a console page doesn't match expectations or a
destructive step (deleting the old AWS key) is next.

## What's in here

| File | Purpose |
|---|---|
| `PROMPT.md` | The mission Opus executes, with guardrails + gates |
| `preflight.mjs` | Local state check: CLIs, DNS/DKIM posture, no secrets |
| `browser.mjs` | Headed persistent-profile Chromium with CDP on :9222 |
| `set-secret.sh` | `./set-secret.sh NAME` — value read hidden from stdin → `fly secrets import` |
| `run-on-fly.sh` | Upload any local script next to `/app/scripts` on the machine and run it there (module resolution works) |
