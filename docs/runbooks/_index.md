# Runbooks Index

Operational runbooks for AcreOS. Each is a Symptom → Diagnose → Fix → Verify → Escalate-if checklist designed to be readable at 2am, on a phone, by a founder or on-call backup.

## Operational runbooks (numbered, customer-impact ordered)

1. [Customer can't sign in](./01-customer-cant-sign-in.md) — auth, magic-link, Clerk dashboard
2. [Payment / card failed](./02-payment-card-failed.md) — dunning sequence, manual retry, decline codes
3. [1099 generation error](./03-1099-generation-error.md) — tax-identity flow, common 422 codes
4. [Skip-trace credits at zero](./04-skip-trace-credits-zero.md) — credit refill, supplier failover
5. [Mass email bounces / spike](./05-mass-email-bounces-spike.md) — deliverability triage, suppression list rebuild
6. [Stripe webhook replay](./06-stripe-webhook-replay.md) — manual replay, signature debugging
7. [Database restore from snapshot](./07-database-restore-from-snapshot.md) — Fly Postgres snapshot restore (links to Boniface drill doc)
8. [Founder out of office](./08-founder-out-of-office.md) — escalation rotation, who handles what

## Other operational runbooks

- [AI quota exceeded](./ai-quota-exceeded.md)
- [Data breach response](./data-breach-response.md)
- [DB migration failed](./db-migration-failed.md)
- [Deal hunter blocked](./deal-hunter-blocked.md)
- [PgBouncer rollout](./pgbouncer-rollout.md)
- [Redis connection lost](./redis-connection-lost.md)
- [Runaway background job](./runaway-background-job.md) (also: [runaway-job](./runaway-job.md))
- [Stripe webhook stopped](./stripe-webhook-stopped.md)
- [Valuation model drift](./valuation-model-drift.md)

## How to use

- The numbered runbooks (01–08) cover the most common founder-bottleneck scenarios — anything in this set should be resolvable by an on-call backup, not just the founder.
- Each runbook ends with **Escalate if** — read this first if you're not 100% sure the situation matches the symptom.
- If a runbook step references a script or admin route, those scripts/routes already exist. If something is missing, file an issue tagged `runbook-gap` rather than improvising.
- The Controls door (`/founder/autopilot/control`) — External safety net, Step-away readiness, and Backup restore proof sections — is the fastest way to confirm whether a problem is ours, a vendor's, or already escalating. (The old /founder-home vendor-status tile was retired with the founder-dashboard monolith.)
