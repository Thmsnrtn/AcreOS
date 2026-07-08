# Secrets & connections audit — 2026-07-04

Live-probed on the production Fly machine (`acreos`, iad) via the
`ses-dkim-fix.yml` workflow using free read-only auth endpoints. No secret
values were read or logged. Permanent watchdog: the `credential_liveness`
detector now re-runs these checks daily and pages on regressions.

## Verdict at a glance

| Status | Vendors |
|---|---|
| ✅ Live & working | Postgres, Stripe, Lob, OpenRouter (primary AI), Mapbox, Clerk, Cloudflare |
| ✅ Present (not live-testable for free) | Voyage, Regrid, Sentry, Redis, Stripe webhook secret, field-encryption key |
| ❌ **Configured but DEAD** | **AWS SES** (key deleted in IAM), **Anthropic** (401), **OpenAI** (401), **SendGrid** (401) |
| ⬜ Not configured | Twilio (SMS!), ATTOM, Zoneomics, BatchSkipTracing, REISkip, Telnyx, ElevenLabs, Meta, Google/Microsoft OAuth (email sync), inbound-email webhook secret |

## Impact analysis

1. **Email is fully dark.** `emailService` sends exclusively through SES;
   the SES key is dead and SendGrid (org-domain side path) is also dead.
   Until the AWS key rotates: no signup verification, no password reset,
   no dunning emails, no digests. This is the #1 blocker.
2. **Pax and all AI surfaces work.** Primary routing is OpenRouter
   (`AI_INTEGRATIONS_OPENROUTER_API_KEY`, verified live). The dead
   Anthropic/OpenAI keys affect only direct side paths (constitutional
   checker, SCP evolution, AI fallback) — degraded resilience, not outage.
3. **Billing, mail-the-wedge, auth, maps, DB: all healthy.** Stripe, Lob,
   Clerk, Mapbox, Postgres all authenticated successfully.
4. **SMS was never configured.** Twilio vars are absent. The TCPA
   gate-by-construction and response capture are built and waiting; SMS
   stays dark until a Twilio account + 10DLC registration exist (founder
   purchase decision).
5. **acreos.io cannot receive mail.** No apex MX records — DMARC reports
   to dmarc@acreos.io and any reply to an @acreos.io address bounce.
   Options: Cloudflare Email Routing (free forwarding to Gmail) or leave
   deliberately dark and change the DMARC `rua` once a mailbox exists.

## Founder actions (in priority order)

1. **Rotate the AWS key** — AWS console → IAM → (SES user) → Security
   credentials → Create access key, then
   `fly secrets set AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… -a acreos`,
   then re-run the "SES DKIM fix" workflow (Actions tab). This restores
   email AND completes the DKIM repair (the workflow republishes the
   current tokens and restarts the FAILED verification).
2. **Rotate or remove the dead Anthropic / OpenAI / SendGrid keys** —
   either mint new keys at each vendor, or unset the env vars so the
   readiness surfaces stop believing those paths exist.
3. **Decide on inbound mail** — Cloudflare Email Routing (5 min, free) to
   forward dmarc@/support@ → your Gmail, or explicitly accept no inbound.
4. **Twilio** — when ready to arm SMS: account + 10DLC + set
   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN (the TCPA interlock is already
   gate-by-construction).

## Session-tooling notes

- The Gmail connector's OAuth token has expired; the Google Calendar and
  two other connectors also need re-authorization in claude.ai settings
  before agent sessions can use them.
- Supabase/Vercel connectors are attached but neither is in the
  production data plane (see vendor-inventory) — no action needed.
