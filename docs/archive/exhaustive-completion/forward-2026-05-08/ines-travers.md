# ines-travers — Database as Bottleneck: Client Idempotency First

**Reading list:**
- MASTER-FINDINGS-RECONCILIATION.md (schema 17,468 LOC, 86 migrations)
- post-may1-resweep.md (RS-1..RS-7; P0-10 Dropbox idempotency open)
- FOUNDER-DASHBOARD-V2-PLAN.md (deferred 90 days; monolith concerns)
- Original: elite-team-2026-05-01/ines-reliability.md

**State read:**

May 1 I found 5 top reliability risks: client mutations retry without idempotency keys, e-sign sends duplicate on retry, campaign dedup missing, Stripe checkout double-subscription, auth grace at 30s unmonitored. RS-1..RS-7 shipped account-security; none tackled client-side retry loops. Reading post-may1-resweep: the **schema is 17,468 LOC with 86 migration files. The monolith is the bottleneck.** P0-10 Dropbox idempotency is open. Pre-commit hook broken. Every new vertical adds tables. This is infrastructure debt that blocks next features, not future debt.

**Push forward — my 5 moves (ranked):**

1. **Fix client mutation-retry footgun (P0, 1.5d).** Default `mutations.retry: false` in `queryClient.ts`. Wire `Idempotency-Key` UUID generation into `apiRequest` for POST/PATCH mutations. Fixes Stripe double-subscription, e-sign double-send, campaign double-dispatch. The middleware exists; client doesn't send the header. Highest-leverage <2d fix.

2. **Close P0-10 Dropbox idempotency (1d).** Atomic claim on `generatedDocuments` + state-machine guard + PDF pin. Mirror Stripe webhook pattern in `webhookHandlers.ts`. Unblocks BH workflow.

3. **Fix pre-commit hook (2h).** Broken commit-hash validation letting bad migrations land. Re-wire it, document in CLAUDE.md.

4. **Defer schema monolith refactor to customer 150+ (2–3 weeks, save for later).** 17,468 LOC is real; it's slowing `tsc` incremental checks. But the refactor kills velocity during vertical expansion. Land → Notes → BH → Cuthbert first. At 150 customers you'll have clearer table-access patterns. Document the debt in `SCHEMA-REFACTOR-PLAN.md`.

5. **Implement per-endpoint p95 latency export + SLO dashboard (2d).** Confirm `metricsMiddleware` emits histograms. Export p95 per endpoint. Wire Grafana: uptime %, job-health success rate, latency distribution. You cannot manage what you cannot measure.

**What I'd defer:**

- Multi-region readiness. Single-region, single-AZ isn't a blocker at <500 customers.
- Bounded concurrency on background jobs. Real debt; lower priority.
- Schema normalization. Save for post-150-customer refactor.

**What scares me most:**

*The seam where client and server reliability meet is cracking under vertical pressure.* Stripe outage + client retry loop = double-subscription flood. Double-click on campaign send = SMS to every recipient twice. E-sign sends duplicate requests. The fix is <2 weeks. The bad news: the client-retry footgun will bite a customer in 60 days unless you ship move #1. Every new vertical increases probability of hitting a double-execute path you haven't modeled.

**Contrarian to Sam:** He wants audit-log + privacy endpoints. I'd reverse: **client idempotency + P0-10 first (moves 1–2), then compliance.** You cannot scale security infrastructure on faulty idempotency. Fix foundation first; then harden compliance.

— Ines
