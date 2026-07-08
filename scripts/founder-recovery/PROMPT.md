# Mission: restore every dead vendor credential and finish the SES/DKIM repair

You are running on the founder's machine with his authority. Work phase by
phase; each phase ends with a VERIFY gate — do not start the next phase
until the gate passes. Context: docs/company/secrets-audit-2026-07-04.md
and docs/runbooks/ses-dkim-failure.md.

## Non-negotiable guardrails

1. **Secret values never touch argv, logs, chat, files, or git.** To set a
   secret: read it from the browser DOM and pipe it directly into
   `fly secrets import -a acreos` via stdin (see scripts/founder-recovery/set-secret.sh
   for the manual variant). Never `echo`, `console.log`, or commit a value.
2. **The browser bridge is the human's session.** Connect with
   `playwright.chromium.connectOverCDP('http://localhost:9222')`. If a login
   page appears, STOP and ask the human to log in — never type credentials.
3. If any console UI doesn't match what you expect, stop and ask rather
   than clicking exploratively. Billing pages: read-only.
4. Destructive steps (deactivating/deleting the OLD AWS key) happen only
   in Phase 6, only after the human confirms, and only after every gate is
   green.
5. Do not commit or push anything from this mission.

## Phase 0 — Preflight

- `node scripts/founder-recovery/preflight.mjs` — resolve anything it flags.
- Confirm the bridge is up: CDP reachable on http://localhost:9222
  (human runs `node scripts/founder-recovery/browser.mjs` in another terminal).

## Phase 1 — New AWS access key → Fly

- Via CDP, open https://console.aws.amazon.com/iam/home#/users — ask the
  human which IAM user is the SES sender if more than one candidate.
- Security credentials → Create access key (use case: CLI / application).
- On the "Retrieve access keys" page, read BOTH values from the DOM and
  pipe them straight to Fly in one shot (Node child_process, stdin only):
  `fly secrets import -a acreos` with body
  `AWS_ACCESS_KEY_ID=…\nAWS_SECRET_ACCESS_KEY=…` — set
  `--stage`? No: default apply is fine; machines restart, that's expected.
- Do NOT delete or deactivate the old key yet.
- VERIFY: `scripts/founder-recovery/run-on-fly.sh scripts/vendor-health-probe.mjs`
  → the "AWS SES" row must be OK. (Machines take ~1 min to restart after
  secrets change; retry once if the first ssh fails.)

## Phase 2 — Finish the SES/DKIM repair

- `scripts/founder-recovery/run-on-fly.sh scripts/ses-setup.mjs`
  (the branch copy restarts a FAILED verification and republishes the
  three current DKIM CNAMEs to Cloudflare).
- Wait ~15 minutes, run it again.
- VERIFY: output shows `DKIM SUCCESS` (or PENDING trending to SUCCESS —
  re-check once more after 15 min; escalate to the human if still FAILED).
- Cleanup: in Cloudflare DNS, delete any `*._domainkey.acreos.io` CNAME
  pointing at an amazonses.com host that is NOT one of the three tokens
  the setup script just printed (stale generations; cosmetic).

## Phase 3 — Rotate the dead AI/SendGrid keys

For each of Anthropic (https://console.anthropic.com/settings/keys),
OpenAI (https://platform.openai.com/api-keys),
SendGrid (https://app.sendgrid.com/settings/api_keys):
- Create a new key in the console (SendGrid: Restricted access — Mail Send
  + Domain Authentication scopes only).
- Pipe it to Fly exactly as in Phase 1 (env names: ANTHROPIC_API_KEY,
  OPENAI_API_KEY, SENDGRID_API_KEY).
- Revoke the OLD key in the same console page immediately after (these are
  non-destructive to rotate — unlike AWS, nothing else uses them).
- VERIFY (after all three): re-run the vendor probe via run-on-fly.sh →
  Anthropic, OpenAI, SendGrid rows all OK.

## Phase 4 — Inbound mail (optional but recommended)

Ask the human: enable Cloudflare Email Routing for acreos.io forwarding
`dmarc@` and `support@` → thmsnrtn@gmail.com? If yes:
- Via CDP: Cloudflare dashboard → acreos.io zone → Email → Email Routing →
  enable, accept the MX/SPF record changes it proposes, add the two
  addresses. The destination-verification email lands in his Gmail — ask
  him to click it.
- VERIFY: `dig MX acreos.io` (or DoH) returns route*.mx.cloudflare.net.

## Phase 5 — Twilio (ask first)

Ask whether to set up SMS now (Twilio account + 10DLC is a purchase with
ongoing cost). If yes, walk the human through account creation via the
bridge, then set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN via the same
stdin-import path. If no, skip — the app degrades honestly without it.

## Phase 6 — Retire the old AWS key + final sweep

- Confirm with the human, then in IAM: Deactivate the old access key.
  Re-run the vendor probe (must still be all green — proves nothing else
  was riding the old key). Then Delete it.
- Final VERIFY: probe shows 0 BROKEN; `ses-setup.mjs` shows DKIM SUCCESS
  and MAIL FROM SUCCESS.
- Report: one summary of what changed, which keys were rotated (names
  only), and anything intentionally left dark (e.g. Twilio).
