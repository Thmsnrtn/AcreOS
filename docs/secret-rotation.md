# Secret Rotation Schedule

**Policy owner:** Founder (Thomas Norton)
**Last reviewed:** 2026-05-27
**Review cadence:** Reviewed quarterly; rotation events happen on the schedule
below regardless of review.
**Audience:** SOC 2 Type II auditor (CC6.1, CC6.6), cyber underwriting.

---

## 1. Purpose

Every production secret has a documented owner, a documented rotation
cadence, and a documented runbook for executing the rotation. Secrets without
all three are findings.

A SOC 2 Type II auditor will sample 3-5 secrets from this list and ask:
"Show me the last rotation event for X." The expected evidence is a Fly
secrets audit log entry (or vendor dashboard event) plus a postmortem-style
note recorded in `docs/runbooks/secret-rotation-history.md` (one row per
rotation event).

---

## 2. Schedule

| Secret | Owner | Cadence | Last rotated | Next due | Runbook |
|---|---|---|---|---|---|
| `SESSION_SECRET` (Express session signing) | Founder | Annual | 2026-01-15 | 2027-01-15 | `runbooks/secret-rotate-session.md` |
| `CSRF_SECRET` | Founder | Annual | 2026-01-15 | 2027-01-15 | `runbooks/secret-rotate-csrf.md` |
| `CLERK_SECRET_KEY` | Founder | Annual or on suspected compromise | 2026-02-10 | 2027-02-10 | Clerk dashboard → API keys → rotate, then `fly secrets set` |
| `CLERK_WEBHOOK_SECRET` | Founder | Annual | 2026-02-10 | 2027-02-10 | Clerk dashboard → webhooks → rotate signing secret |
| `STRIPE_SECRET_KEY` (live mode) | Founder | Annual or on suspected compromise | 2026-02-10 | 2027-02-10 | Stripe dashboard → developers → API keys → roll |
| `STRIPE_WEBHOOK_SECRET` | Founder | Annual | 2026-02-10 | 2027-02-10 | Stripe dashboard → webhooks → roll signing secret |
| `ANTHROPIC_API_KEY` | Founder | Annual or on suspected compromise | 2026-02-10 | 2027-02-10 | Anthropic console → API keys |
| `OPENAI_API_KEY` | Founder | Annual; being phased out | 2026-02-10 | 2027-02-10 | OpenAI dashboard → API keys |
| `OPENROUTER_API_KEY` | Founder | Annual | 2026-02-10 | 2027-02-10 | OpenRouter dashboard → keys |
| `TWILIO_AUTH_TOKEN` | Founder | Annual | 2026-02-10 | 2027-02-10 | Twilio console → settings → rotate auth token (requires updating webhook signature validation downtime window) |
| `SENDGRID_API_KEY` | Founder | Annual | 2026-02-10 | 2027-02-10 | SendGrid → settings → API keys |
| `LOB_API_KEY` | Founder | Annual | 2026-02-10 | 2027-02-10 | Lob dashboard → API keys |
| `MAPBOX_ACCESS_TOKEN` | Founder | Annual | 2026-02-10 | 2027-02-10 | Mapbox account → tokens |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (S3 backups) | Founder | **90 days** | 2026-03-01 | 2026-05-30 | IAM console → access keys; use `aws iam create-access-key` then `aws iam delete-access-key` after Fly redeploy |
| `FLY_API_TOKEN` (CI deploy bot) | Founder | Annual | 2026-02-10 | 2027-02-10 | `flyctl auth token`, then `gh secret set FLY_API_TOKEN` |
| `DEPLOY_BOT_TOKEN` (deploy ledger auth) | Founder | Annual | 2026-05-27 | 2027-05-27 | `openssl rand -hex 32`, then `gh secret set` + `fly secrets set` |
| `SENTRY_AUTH_TOKEN` | Founder | Annual | 2026-02-10 | 2027-02-10 | Sentry → settings → developer settings → tokens |
| `FIELD_ENCRYPTION_KEY` (AES-256-GCM key for PII columns) | Founder | **Never rotated in-place** — see §3 | 2026-01-15 | N/A | `runbooks/field-encryption-key-rotation.md` (requires re-encrypt sweep) |
| `DATABASE_URL` (Postgres password) | Founder | Annual | 2026-02-10 | 2027-02-10 | `flyctl postgres users update --password` |
| Database backup encryption key (S3 SSE-S3) | AWS | AWS-managed | n/a | n/a | Managed by AWS — no AcreOS rotation action |
| Per-org BYOK credentials (encrypted in `organizations.credentials_encrypted`) | Each customer | Customer-controlled | n/a | n/a | Customer rotates via UI; we re-encrypt with their value |

---

## 3. The field-encryption key is special

`FIELD_ENCRYPTION_KEY` cannot be rotated like other secrets because it
decrypts data at rest. Rotating it requires a re-encrypt sweep:

1. Add the new key as `FIELD_ENCRYPTION_KEY_NEXT` alongside the current key.
2. Deploy a worker job that reads every encrypted column, decrypts with the
   current key, re-encrypts with the next key, and writes back.
3. Once the sweep completes (verified by a count query), swap
   `FIELD_ENCRYPTION_KEY ← FIELD_ENCRYPTION_KEY_NEXT` and remove the old.
4. Document the sweep in `runbooks/field-encryption-key-rotation.md`.

This is a half-day project. Don't do it casually. Do it if there's any
reason to suspect the current key is compromised.

---

## 4. Rotation event evidence

Every rotation event MUST land in `docs/runbooks/secret-rotation-history.md`
(append-only). Template:

```
2026-MM-DD  secret=<NAME>  actor=<github-login>  reason=<routine|compromise|departure|other>
            old-key-fingerprint=<sha256-prefix>  new-key-fingerprint=<sha256-prefix>
            notes=<one line>
```

The auditor will pull this file as evidence. If a row is missing for a
"due" rotation, that's a finding.

---

## 5. Emergency rotation (suspected compromise)

If a secret is leaked (committed to git, exposed in logs, shared via Slack
without context, etc.), rotate immediately regardless of cadence:

1. Open `runbooks/data-breach-response.md` and `runbooks/05-mass-email-bounces-spike.md` if email is involved.
2. Rotate the affected secret via the table's runbook column.
3. Record the rotation in `secret-rotation-history.md` with `reason=compromise`.
4. Open a postmortem in `runbooks/_postmortem-template.md`.
5. Decide within 24 hours whether the leak constitutes a breach (data
   actually accessed by a third party) or a near-miss (key exposed but no
   evidence of use). If breach → 72-hour customer notification clock starts.

---

## 6. Departures (separation of duties)

Today AcreOS has one person with production access (the founder). When the
team grows to N>1:

1. Add a `departed_by` column to `secret-rotation-history.md` rows.
2. On any team-member departure who held secret access, rotate ALL secrets
   that person handled within 24 hours.
3. Update `docs/separation-of-duties.md` with the new headcount.
