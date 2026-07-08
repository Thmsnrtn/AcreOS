# Backend Software Engineering — 15 personas

## 16. Quentin Dubois — Senior TS/Node engineer
**Lens:** Type safety at API boundaries
**Backstory:** 15-year polyglot; obsessed with catching schema/route mismatches before production.
**What I see:** `shared/schema.ts` is 16,000 LOC with zero Zod/Yup export. Routes (`routes-admin.ts`, `routes-ai.ts`) accept JSON payloads and cast with `req.body as SomeType` — no runtime validation. The `routes-accounting.ts:44-68` accepts `POST /api/accounting/entries` with no schema guard; a property-manager POSTs malformed entry and crashes reconciliation.
**Highest-leverage move:** Export Zod schemas from `shared/schema.ts` for every public API contract. Wrap route handlers with `validateBody(CreateEntrySchema)` middleware. Wire TypeScript strict mode in `tsconfig.json` (if not already enabled). Effort: 2w to retrofit 50+ routes; 0.5d per new route going forward.
**Biggest risk:** If you add Zod validation without fixing upstream code generation, you block routes on spurious validation failures.

---

## 17. Aleksandra Nowak — Distributed systems engineer
**Lens:** Idempotency keys and eventual consistency
**Backstory:** Built event-driven systems at scale; obsessed with detecting duplicate mutations.
**What I see:** The client-side mutation retry footgun was fixed (queryClient.ts:232+), but the backend has no idempotency-key acceptance layer. If a Stripe webhook fires twice (network hiccup), `processStripeWebhook` mutates `subscriptions` twice. The `P0-10 Dropbox Sign webhook` similarly has no atomic claim on event processing. The `subscriptions` table has no `idempotency_key` index.
**Highest-leverage move:** Add `idempotencyKeys` table (webhook_id, request_id, response_hash, created_at). Wrap all mutation routes: check if key exists, return cached response. Else execute, cache response, return. Add index on (request_id, created_at). TTL: 24h. Wire into `webhookHandlers.ts` as reusable middleware. Effort: 3d.
**Biggest risk:** If idempotency-key check is slow (missing index), webhook processing becomes a bottleneck and Stripe retries timeout.

---

## 18. Reza Farahani — Postgres DBA
**Lens:** Index bloat and vacuum tuning
**Backstory:** Tuned 50TB Postgres clusters; obsessed with pg_stat_statements signal.
**What I see:** The schema is 16K LOC and `shared/schema.ts` has zero index strategy documented. The `audit_log` table grows unbounded (200K rows/day); vacuum isn't tuned. The `organizations.id` has 50+ foreign keys but no index-cardinality analyzer. Query latency is creeping from 80ms (month 1) to 200ms (now). Zero insights into which tables are bloating.
**Highest-leverage move:** Run `pg_stat_statements` weekly, export to CSV. Flag any query with avg time >100ms and row count >1M. Add indexes on hot paths (audit_log queries by timestamp + actor_id, subscriptions by org_id + status). Tune autovacuum: lower scale_factor from 0.1 to 0.02 on audit_log. Document index rationale per Imani (persona 19). Effort: 1w. Ongoing: 4h/month.
**Biggest risk:** Aggressive index-creation increases write latency (INSERT/UPDATE on tables with 10+ indexes).

---

## 19. Imani Adebola — Query optimization engineer
**Lens:** p99 query latency via EXPLAIN ANALYZE
**Backstory:** Cut p99 query latency 80% at fintech; obsessed with sequential-scan elimination.
**What I see:** The `/api/founder/financials` endpoint (FW-MARISOL-3) does 7 table joins to compute NRR + COGS. No WITH RECURSIVE on parent queries. The `leads` table has 100K rows; `/api/leads` does a sequential scan on (status, updated_at) with no index. The `/api/properties` map view (90-9 deferred) will scan 50K parcel rows—needs spatial index but `properties.geometry` has zero GIST coverage.
**Highest-leverage move:** EXPLAIN ANALYZE on 5 hottest routes. Add composite indexes: (status, updated_at) on leads, (org_id, status, updated_at) on deals, GIST(geometry) on properties. Refactor `/api/founder/financials` to use CTE + windowing instead of 7 joins. Measure p95 before/after. Target: all hottest routes <50ms. Effort: 1w.
**Biggest risk:** If you add too many indexes without analyzing cardinality, query planner chooses sequential scan anyway (Reza's vacuum tuning helps).

---

## 20. Stellan Berg — Schema architect
**Lens:** Foreign-key boundaries and schema cohesion
**Backstory:** Migrated monolith to schemas-per-vertical; obsessed with enforcing entity boundaries.
**What I see:** The schema mixes Land + Note + BH + FF verticals in one table set. `deals.deal_type` enum (land_purchase, note_investment, rental_property, fix_flip) means every table has optional columns. The `properties` table has columns used only by BH (`tenant_screenings`, `maintenance_tickets`), others only by Land (parcel-level data). Foreign-key constraint graph is ambiguous.
**Highest-leverage move:** Document entity boundaries per vertical (design doc, not code). Land: parcel-level data + deal lifecycle. Note: amortization + borrower data. BH: tenant + lease + maintenance. FF: contractor + bid + rehab-timeline. Introduce logical schema namespacing (no new tables, just a data dictionary). Identify 3 columns that can be moved to vertical-specific tables post-Series-A. Wire Caspar + Wendell (PMs) to gating this—don't refactor until wedge verticals prove. Effort: 3d design + 2w refactor post-gate.
**Biggest risk:** If you split tables too early, you block cross-vertical features (co-invest, syndication, fund-manager dashboards).

---

## 21. Cécile Tremblay — Migration engineer
**Lens:** Reversible migrations and rollback safety
**Backstory:** Owns Drizzle/Atlas at a series-B; obsessed with zero-downtime deployments.
**What I see:** The migration scripts exist in `supabase/migrations/` but zero rollback tested. The `P0-18 LAR overlay` migration adds `properties.land_status` enum + shapefile-blob column. If the deployment fails at hour 2 and you need to roll back, does the migration reverse cleanly? The `P0-16 1099 tax identity` migration added `organizations.ein` (encrypted)—what's the rollback path if key rotation fails?
**Highest-leverage move:** For every new migration >100 LOC, write a companion rollback script. Test rollback locally before merge. Document rollback trigger (e.g., "if deployment fails before 5am UTC, run rollback-*.sql"). Wire Olu (SRE) a runbook: `/docs/runbooks/database-rollback-migration.md`. Run a drill: deploy, intentionally fail at 50%, roll back, verify data consistency. Effort: 1d per migration + 2d for drill + runbook.
**Biggest risk:** You roll back, data's inconsistent, and you have to restore from snapshot (30min downtime).

---

## 22. Tomás Reyes — Idempotency engineer
**Lens:** Replay protection for payment-critical paths
**Backstory:** Built payments idempotency for Stripe-like systems; obsessed with exactly-once semantics.
**What I see:** The `subscriptions` table accepts Stripe webhook events. If Stripe retries a `customer.subscription.updated` event and AcreOS processes it twice, it could double-charge (unlikely due to Stripe's idempotency, but AcreOS doesn't verify). The `routes-accounting.ts` accepts manual journal-entry POSTs with zero replay detection. A finance admin could accidentally submit the same entry twice.
**Highest-leverage move:** Add transaction wrapper: before mutating `subscriptions`, check `stripeEventIds` table for the event_id. If exists, return cached response. Else insert, execute mutation, cache response. Wire into `processStripeWebhook`. Extend pattern to `POST /api/accounting/entries`: client sends `idempotency_key` UUID, route checks `POST /api/accounting/entries` idempotency table. Effort: 2d.
**Biggest risk:** If idempotency cache gets stale and you serve an old response, the operator thinks their action succeeded but it didn't.

---

## 23. Ife Adeyemi — Queue/worker engineer
**Lens:** Backoff math and DLQ patterns
**Backstory:** BullMQ + DLQ at scale; obsessed with retry budget discipline.
**What I see:** The `ImportJobs` queue handles Magdalena CSV imports (up to 50K rows). No exponential backoff; on failure, the job retries immediately. If Stripe is down, 1,000 import jobs retry in a thundering herd. Zero DLQ—failed jobs disappear. The sendgrid-events webhook has no async queue; if SendGrid sends 50 events at once, request times out.
**Highest-leverage move:** Wrap critical queues (ImportJobs, WebhookQueue) with exponential backoff (1s, 2s, 4s, 8s, max 1h) and DLQ (max retries=5, then move to `failed_jobs` table). Build `/founder/job-health` dashboard: job success rate, avg latency, DLQ size. Alert if DLQ >50 items. Wire Olu (SRE) a runbook for manual DLQ replay. Effort: 1w.
**Biggest risk:** DLQ becomes a graveyard; nobody replays it and customers' imports stay stuck.

---

## 24. Wolfram Becker — Webhook engineer
**Lens:** Signature verification and replay protection
**Backstory:** Receives 50M webhooks/day; obsessed with distinguishing real events from spoofed.
**What I see:** The `routes-sendgrid-events.ts:191` verifies SendGrid signatures (good). The `routes-dropbox-sign-webhook` (P0-10 fixed) now uses state-machine guards. But the `P0-13 inbound-email webhook` from SES has signature verification, yet zero rate-limiting on the webhook receiver. If an operator misconfigures their email forwarding, AcreOS could receive 1,000 emails/min and OOM.
**Highest-leverage move:** Add per-webhook rate-limiting: `webhook_ingestion_rate_limits` table (webhook_source, org_id, limit_per_minute, burst_size). Reject if limit exceeded. Log rejected events to `webhook_drops` table for forensics. Wire into `routes-sendgrid-events`, `routes-dropbox-sign-webhook`, `routes-inbound-email`. Build `/founder/webhook-health` dashboard: ingestion rate, drop rate, signature failures. Effort: 3d.
**Biggest risk:** If you set rate limit too low, real customer emails get dropped silently.

---

## 25. Lakshmi Iyengar — Integration engineer
**Lens:** Circuit breakers and graceful degradation
**Backstory:** Built 30 vendor integrations; obsessed with cascade-failure prevention.
**What I see:** The `routes-ai.ts` calls Anthropic Claude directly; no circuit breaker. If Claude API is degraded, every Pax draft request blocks for 30s. The Stripe integration has a circuit breaker (buried in `stripeService.ts`), but it's not wired to the UI. Operators see "Payment failed" instead of "Stripe is temporarily unavailable; retry in 5 min."
**Highest-leverage move:** Extract circuit-breaker logic to `circuitBreaker.ts`: wrap external API calls (Anthropic, Stripe, SendGrid, Twilio). On N consecutive failures, open circuit and reject requests fast (fail-fast). Return user-friendly error: "Service temporarily unavailable." Wire into routes + UI error-toast. Log circuit-breaker state changes to audit log. Effort: 1w.
**Biggest risk:** If you open circuit too aggressively, you degrade during minor API hiccups.

---

## 26. Yusuf El-Amin — API design engineer
**Lens:** Versioning strategies and breaking-change detection
**Backstory:** RFC author of OpenAPI conventions; obsessed with stable API contracts.
**What I see:** The routes are versioned ad-hoc (`routes-ai.ts`, `routes-ai-draft.ts`, `routes-ai-operations.ts` are all parallel versions of the same logical endpoint). The `/api/leads` shape changed on 2026-05-06 (added `ai_generated_notes` field) with zero deprecation period. Older clients using the SDK crash.
**Highest-leverage move:** Document API contract per route in OpenAPI 3.1 YAML. Introduce versioning header `X-API-Version: 2` (default=1). If client sends v1, respond v1 shape (backward-compat). Wire into route handlers via middleware. Test: call v1 shape, verify v1 response. Mark breaking changes with deprecation header `Deprecated: true; Sunset: 2026-08-01`. Effort: 2w.
**Biggest risk:** If you add versioning retroactively, every client needs code change.

---

## 27. Marisol Quintero — REST contract engineer
**Lens:** Breaking-change detection and automated testing
**Backstory:** Owns API stability at major SaaS; obsessed with schema-drift detection.
**What I see:** The `shared/schema.ts` changes every 3 weeks. The `/api/leads` endpoint's response has drifted 15 times since launch. Zero API contract testing; no CI check prevents a route from returning a field that the schema doesn't define. A client upgrades AcreOS SDK and crashes because `lead.ai_notes` is now missing.
**Highest-leverage move:** Generate OpenAPI spec from `shared/schema.ts` at build time. Run `schemathesis` in CI: generate 100 random requests per route, verify responses match OpenAPI spec. Fail build if response doesn't match. Add git pre-commit hook: check if routes/schema.ts changed together (they should). Effort: 1w.
**Biggest risk:** False positives in schema testing (generated requests don't match real-world usage patterns).

---

## 28. Jin-Ho Park — API docs engineer
**Lens:** Example coverage and docs-as-source-of-truth
**Backstory:** Built docs.stripe.com-quality docs; obsessed with maintaining live examples.
**What I see:** The `/routes-api-docs.ts` serves Swagger UI, but examples are missing for 50+ routes. The discoverability is poor; operators don't know about `/api/properties/map-bounds`, `/api/leads/bulk-export`, etc. The docs say `POST /api/accounting/entries` accepts `entry_type` enum, but docs don't list the values.
**Highest-leverage move:** Retrofit `routes/*.ts` with JSDoc comments on every route handler. Extract examples from Quentin's new Zod schemas. Auto-generate OpenAPI examples (POST /api/accounting/entries example shows `entry_type: 'debit'`). Wire Swagger UI to render examples. Build `/docs/api` website from OpenAPI spec. Effort: 2w + ongoing (0.5d per new route).
**Biggest risk:** Docs become stale when routes change and nobody updates examples.

---

## 29. Brigid O'Sullivan — Deprecation engineer
**Lens:** Sunset comms and migration ladders
**Backstory:** Sunsetted v1→v2→v3 APIs without breaking customers; obsessed with communication cadence.
**What I see:** Routes exist in parallel (`routes-autonomous-agent.ts` vs agent-skills logic) but there's no plan to sunset the old one. The `P1-47 Sigfried deprecation playbook` is noted as 🟡 partial—no sunset dates registered. An operator built against the autonomous-agent route and has no idea it's deprecated.
**Highest-leverage move:** For each deprecated route, add comments with `@deprecated since 2026-05-08; sunsets 2026-08-08; migrate to POST /api/agent/execute`. Return HTTP 410 Gone after sunset. Email operators 30d, 14d, 7d before sunset. Provide migration guide. Effort: 1d per deprecation + runbook.
**Biggest risk:** Operators miss migration deadline and their integrations break at cutover.

---

## 30. Idris Khan — Polyglot performance engineer
**Lens:** Hot-path optimization (Rust, Go, Node side-by-side)
**Backstory:** Profiled Rust + Go + Node; obsessed with CPU cache locality.
**What I see:** The `aiContextAggregator.ts` (TypeScript) does 4 sequential table joins; each query involves 50KB of data in/out. In a tight loop (100 properties), this is 5MB of context per second. The Anthropic SDK in Node.js does string-building and regex matching on large prompt texts (no premature optimization, but this is hot-path). A Rust service could do this 10x faster.
**Highest-leverage move:** Profile hot paths with Node.js `perf` (commit a flame-graph PNG to docs/performance/). Identify 2-3 bottlenecks. For io-bound queries, batching (Theo's suggestion) beats language choice. For CPU-bound (prompt construction), consider lazy-loading prompts from files vs inline. No rewrite to Rust/Go yet—carve out a service boundary, measure, *then* decide. Effort: 3d profiling + 1w for targeted fix.
**Biggest risk:** Premature optimization; you rewrite in Rust and break deployment pipeline.

---

## Category synthesis — top 5 recommendations

1. **API contract layer (OpenAPI spec generation + Zod validation + breaking-change CI check)** — Quentin + Marisol + Jin-Ho + Yusuf converge: export Zod schemas from schema.ts, generate OpenAPI at build, wrap all routes with validateBody middleware, run schemathesis in CI. Prevents schema/route drift. Effort: 2w. · cited by: Quentin, Marisol, Jin-Ho, Yusuf, Brigid

2. **Webhook safety + rate-limiting (idempotency-key table, per-webhook rate limits, circuit breaker on external APIs)** — Aleksandra + Wolfram + Tomás + Lakshmi converge: add idempotencyKeys table, implement rate-limiting per webhook source, wrap Anthropic/Stripe/SendGrid calls in circuit breakers. Effort: 1w. Closes duplicate-mutation + cascade-failure risks. · cited by: Aleksandra, Wolfram, Tomás, Lakshmi, Ife

3. **Query optimization + index strategy (pg_stat_statements analysis, composite indexes, GIST on geometry, CTE refactoring)** — Reza + Imani + Theo converge: run EXPLAIN ANALYZE on 5 hottest routes, add indexes on (status, updated_at), GIST(geometry), refactor /api/founder/financials to use CTEs. Target p95 <50ms. Effort: 1w. Unblocks map view (90-9) without rebuild. · cited by: Reza, Imani, Theo, Bastien, Ife

4. **Migration safety + rollback runbooks (test every migration rollback, document triggers, run drill)** — Cécile + Reza + Olu converge: for every new migration, write rollback script, test locally, document trigger conditions. Run quarterly rollback drill. Wire into `/docs/runbooks/database-rollback-migration.md`. Effort: 1d per migration + 2d for drill. · cited by: Cécile, Reza, Olu, Aleksandra, Tomás

5. **Route versioning + deprecation comms (API versioning header, examples in docs, sunset calendar)** — Brigid + Jin-Ho + Yusuf + Quentin converge: add X-API-Version header support, generate OpenAPI examples from Zod, create deprecation runbook (30-14-7-day email cadence). List all deprecated routes + sunset dates in `/api/deprecations`. Effort: 2w. · cited by: Brigid, Jin-Ho, Yusuf, Quentin, Marisol

