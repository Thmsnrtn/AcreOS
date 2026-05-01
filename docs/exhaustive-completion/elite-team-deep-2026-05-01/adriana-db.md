# Database Audit — AcreOS, Pre-100 Customers

**Author:** Adriana Kraus, Database / Storage Lead (ex-Supabase, ex-Notion Postgres)
**Date:** 2026-05-01
**Lens:** "Most app slowness is a missing index. Most data corruption is a missing transaction. EXPLAIN is a love letter from your database."

I read CLAUDE.md, the full `shared/schema.ts` (15,387 lines, 447 tables, 609 declared indexes), every migration in `migrations/` (0000–0032 + the retroactive `0007_composite_indexes.sql`, `0013_index_audit.sql`, `0023_payment_race_condition.sql`, `0024_cascade_critical_fks.sql`), `server/db.ts`, `server/storage.ts` (the 7000-line god-file), `server/routes-deals.ts`, `server/services/eSigningService.ts`, `server/webhookHandlers.ts`, and `fly.toml`. I cross-referenced with Ines's reliability audit (`elite-team-2026-05-01/ines-reliability.md`) — she flagged transaction discipline at the e-sign layer; I'll go deeper on the data plane.

## 1. One-line verdict

The schema is not the disaster the file count suggests — there is a real index audit (0013), real cascade work (0024), real optimistic locking (0023), and real transactions in the hot paths (`createPayment`, `createDeal`); **but four specific gaps are P0**: deal-close is not transactional, e-sign send has no row lock, audit-log/system-activity will overwhelm the primary by month 12, and **there is no slow-query logger, no `pg_stat_statements`, no pgBouncer** — you are flying blind on the actual production query mix.

## 0. Methodology note

I did not run the database. Everything below is static analysis of the schema and migrations + dynamic reasoning about query patterns from the route handlers. To convert this audit from "informed opinion" to "ground truth," the founder should run two queries in production:

```sql
-- Top 20 by total time in the last 24h
SELECT query, calls, total_exec_time, mean_exec_time, rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 20;

-- Tables by sequential-scan ratio (high = missing index)
SELECT schemaname, relname, seq_scan, idx_scan,
  CASE WHEN seq_scan + idx_scan = 0 THEN 0
       ELSE seq_scan::float / (seq_scan + idx_scan) END AS seq_ratio,
  n_live_tup
FROM pg_stat_user_tables
WHERE n_live_tup > 1000
ORDER BY seq_ratio DESC, n_live_tup DESC LIMIT 30;
```

If a table has > 50% seq_scan ratio at > 100k rows, it's missing an index. That query, on a real production database, will tell you in 3 seconds what I'm reasoning about for 200 lines.

---

## 2. Index audit

I sampled every multi-tenant table and every event-stream table. The good news: 0013_index_audit.sql is genuinely thorough — it added the `(organization_id, created_at)` composites that the high-volume tables needed. The remaining gaps:

| Table | Column-set | Indexed? | Recommendation |
|---|---|---|---|
| `leads` | `(organization_id)`, `(status)`, `(created_at)`, `(email)`, `(source_campaign_id)`, `(organization_id, updated_at)`, `(score)`, `(assigned_to)`, `(deleted_at)`, `(nurturing_stage)`, `(next_follow_up_at)`, `(organization_id, assigned_to)`, `(organization_id, deleted_at)` | YES | None — best-indexed table in the codebase. |
| `properties` | `(organization_id)`, `(status)`, `(apn)`, `(created_at)`, `(seller_id)`, `(buyer_id)`, `(county, state)`, `(deleted_at)` | YES | Add `(organization_id, deleted_at, status)` partial WHERE deleted_at IS NULL — covers list view exactly. |
| `deals` | `(organization_id)`, `(status)`, `(created_at)`, `(property_id)`, `(type)`, `(assigned_to)`, `(deleted_at)`, `(closing_date)` | YES | Add `(organization_id, status, closing_date DESC)` — pipeline kanban query. |
| `notes` | `(organization_id)`, `(status)`, `(borrower_id)`, `(property_id)` | mostly | Missing `(organization_id, status, next_payment_due)` — every borrower-portal due-payments query scans this. |
| `payments` | `(note_id)`, `(status)`, `(due_date)`, `(created_at)`, `(organization_id)` | YES | Add `(note_id, due_date DESC)` for amortization-history fetch; the existing `payments_note_idx` then `ORDER BY due_date` does a heap sort. |
| `audit_log` | `(organization_id)`, `(entity_type, entity_id)`, `(created_at DESC)`, `(user_id)` | YES (via 0013) | Add **partial BRIN** on `created_at` once table > 5M rows — btree index on append-only timestamp wastes 4× the disk vs BRIN. |
| `activity_log` | `(organization_id)`, `(entity_type, entity_id)`, `(created_at DESC)`, `(organization_id, created_at DESC)` | YES (via 0013) | Same BRIN recommendation. |
| `usage_events`, `usage_records` | org, type, billing_month, created_at | YES (via 0013) | None — billing query path is covered. |
| `credit_transactions` | `(organization_id)`, `(created_at DESC)`, unique `(org, allowance_month)` | YES | Missing `(organization_id, type, created_at DESC)` — "last 10 debits" query scans full org partition. |
| `inbox_messages` | `(recipient_email)`, `(lead_id)`, `(conversation_id)`, `(message_id)` | **NO** — declared in schema with **zero indexes** | **P0**: `(organization_id, received_at DESC)`, `(organization_id, is_read, received_at DESC)`, `(message_id)` for in-reply-to threading lookup. Mailer-RX firehose will OOM the planner without these. |
| `team_messages` | `(conversation_id)`, `(created_at DESC)` | **NO** | Add `(conversation_id, created_at DESC)` — every chat-pane render does a full scan today. |
| `team_member_presence` | `(organization_id, user_id)` UNIQUE | **NO** | Add unique `(organization_id, user_id)` — presence currently allows duplicate rows + reads do `LIMIT 1` linear. |
| `simulated_actions` | `(organization_id)`, `(category, created_at)` | **NO** (only `simulated_id` unique) | `(organization_id, created_at DESC)` — founder-test query depends on it. |
| `messages` (channel msgs) | `(conversation_id)`, `(organization_id)`, `(created_at DESC)` | YES (via 0013) | Add `(conversation_id, created_at DESC)` composite — current pair of single-col indexes forces a merge. |
| `conversations` | `(organization_id)`, `(lead_id)`, `(status)` | YES (via 0013) | Add `(organization_id, status, last_message_at DESC)` — inbox sort. |
| `agent_llm_traces` | `(agent_codename, created_at)`, `(decision_id)`, `(organization_id, created_at)` | YES (inline) | None — well-modeled. Will need partition (see §5). |
| `system_activity` | `(created_at)`, `(org_id, created_at)`, `(job_name, created_at)` | YES (inline) | None — well-modeled. Will need partition. |
| `outcome_telemetry` | `(organization_id)`, `(outcome_type)`, `(created_at DESC)` | YES (via 0013) | Add `(organization_id, outcome_type, created_at DESC)` composite. |
| `provider_cache` | `(cache_key)`, `(expires_at)`, `(provider, category)` | YES | Missing TTL cleanup — see §7. |
| `notifications` | `(organization_id)`, `(user_id)`, `(is_read)`, `(created_at DESC)`, `(user_id, is_read, created_at DESC)` | YES (via 0013) | Make the unread one a **partial index** WHERE is_read=false — 95% of rows become read; partial halves the index size. |
| `pax_observations` | `(organization_id)`, `(status)`, `(type)`, `(detected_at)` | YES | Missing `(organization_id, status, detected_at DESC)`. |
| `campaign_delivery_events` | `(campaign_id)`, `(lead_id)`, `(status)`, `(campaign_id, status)` | YES | Missing the dedup-key Ines proposed: unique `(campaign_id, recipient_id, scheduled_minute_bucket)`. |

**The one-page summary:** ~15 tables need a tweak. Two tables (`inbox_messages`, `team_messages`) are flatly missing org-scoping indexes and that's a today-bug, not a scale-bug.

**One additional structural concern:** I count **609 declared indexes across 447 tables** — average 1.36 indexes per table. At first glance that feels under-indexed. In practice, the right tables (leads, properties, deals, payments) have 5–7 indexes each, and the long tail of small tables genuinely needs zero non-PK indexes. The shape is healthy. What concerns me is **index bloat**: nobody has run `REINDEX` or examined `pg_stat_user_indexes.idx_scan` to find indexes that are never used. At 18 months old, expect 10–15% of declared indexes to be dead weight. Add a quarterly review.

**Index types to consider beyond btree:**
- **BRIN** for `created_at` columns on append-only tables — 1/100th the disk of btree, 95% as fast for time-range scans.
- **GIN** for `jsonb` columns where you query keys (`metadata @> '{"campaignId": 5}'`) — currently zero GIN indexes in the schema; you have ~40 jsonb columns and several routes filter on them in JS post-fetch (which is the wrong layer).
- **Partial** indexes for `is_read = false`, `deleted_at IS NULL`, `status = 'active'` — drops index size 5–10×.
- **Covering** indexes (INCLUDE) for the lead/property list queries — `CREATE INDEX … ON leads (organization_id, created_at DESC) INCLUDE (status, score, assigned_to)` — index-only scan, no heap visit.

---

## 3. Transaction-needed paths

The `withTransaction` helper exists at `server/db.ts:82` and is used in 25 call sites. Quality varies:

| Path | File:line | Currently | Should be |
|---|---|---|---|
| **Deal close (status → closed)** | `server/routes-deals.ts:241–311` | `updateDeal` → `createAuditLogEntry` → `recordConversion` → `outcomeTelemetry.insert` → market-signal contributor — **all separate awaits, no tx**. The audit log fires AFTER `updateDeal`, so a crash between them leaves a closed deal with no audit row. The outcome_telemetry insert is `.catch(()=>{})` — silently swallowed. | Wrap the four DB writes in `withTransaction`. The two async-import side-effects (`marketNetworkContributor`, `dealPatternCloning`) belong outside the tx, fire-and-forget after commit. |
| **Deal create** | `server/routes-deals.ts:159–172` | Wrapped in `withTransaction` — deal + audit | OK. |
| **Payment record** | `server/storage.ts:1922–1957` | Wrapped: insert payment + `SELECT FOR UPDATE` note + balance-update with optimistic version check. This is **textbook correct.** | OK. Migration 0023 nailed it. |
| **E-sign send** | `server/services/eSigningService.ts:76–186` | Loads doc → POST to Dropbox Sign → updates row. **No `FOR UPDATE`, no idempotency check, no transaction.** A double-click sends two envelopes; a retried mutation sends a third. Ines flagged this; I confirm at the data layer the row update at line 161 has no precondition (no `WHERE esign_envelope_id IS NULL`). | Wrap in `withTransaction`. First statement: `SELECT … FROM generated_documents WHERE id = $1 FOR UPDATE`. If `esign_envelope_id IS NOT NULL AND expires_at > now()` → return existing. Then external POST. Then `UPDATE … WHERE id = $1 AND esign_envelope_id IS NULL`. |
| **Stripe webhook → payment** | `server/webhookHandlers.ts:609–650` | `claimEvent` (atomic) + `storage.createPayment` (transactional) | OK. The dedup is via the unique `transactionId = session.id`. Solid. |
| **Lead merge** | `server/storage.ts:~1490–1560` | Reads two leads → field-merges → updates primary → soft-deletes duplicate → reassigns child rows. **Multiple sequential awaits, no transaction.** A crash mid-merge leaves an orphaned `deleted_at` on the duplicate but child rows still pointing to it. | Wrap the entire merge in `withTransaction`. |
| **Bulk lead import** | `server/services/import.ts:471, 665` | Already uses `db.transaction` | OK. |
| **Credit purchase / debit** | `server/services/credits.ts` (multiple) | Wrapped in `withTransaction` consistently | OK. The credits service is the gold standard — copy its discipline elsewhere. |
| **Deal status transition + side effects** | `server/routes-deals.ts:215–254` | Status validated, then `updateDeal`, then audit log — separate. | Same issue as deal-close above — wrap in tx. |
| **`getOrCreateOrg` race** | `server/middleware/getOrCreateOrg.ts:82` | `withTransaction` + `ON CONFLICT DO NOTHING` | OK. |
| **Campaign send fanout** | services/campaigns/* | Per-recipient INSERT into delivery queue, no batch tx | Use `INSERT … VALUES (…), (…), (…) ON CONFLICT (campaign_id, recipient_id, scheduled_minute_bucket) DO NOTHING` in chunks of 1000, each chunk a tx. |
| **Note → payment status cascade** | various reminders services | Multiple sequential updates | Audit; likely needs tx. |

**The pattern:** transactions are correct where they were *designed* in (payment, credits, deal-create). They are absent where features grew organically (deal-close, e-sign send, lead merge, status transitions). Every one of these is a "send four awaits in a row" code smell.

**Concrete example of the deal-close bug:** if the `updateDeal` succeeds but the audit insert fails (network blip, FK violation, anything), you have a deal in `closed` state with no audit row. The `recordConversion` runs in a try/catch that LOGS but does not roll back. The `outcomeTelemetry.insert(...).catch(()=>{})` swallows errors entirely — you lose the feedback signal silently. None of these are catastrophic in isolation, but the founder's lead-scoring model and the customer's audit trail diverge from each other after every such failure. Over 100 customers × 1000 deals × N% fail-mid-write, you accumulate a corruption tail that breaks reporting.

**The "sequential awaits to transaction" refactor pattern:** wrap the 4 reads/writes in a single tx; let the `try/catch` at the route boundary translate any tx failure into a 500 with the rolled-back state intact. Side effects (push notification, market signal contributor, pattern cloning) belong outside the tx, after `.then(() => …)` on the tx promise. This is exactly how Stripe's own backend is structured.

---

## 4. N+1 hotspots

Searchable, fixable, mostly cheap:

| File:line | What it does | Why it's bad | Fix |
|---|---|---|---|
| `server/storage.ts:4084–4099` `getSequenceStats` | For each sequence, fires `getSequenceEnrollments(seq.id)` separately | O(N) round-trips per dashboard render | One query: `SELECT sequence_id, status, COUNT(*) FROM sequence_enrollments WHERE org_id=? GROUP BY sequence_id, status`, then merge with sequences in JS. |
| `server/storage.ts:3642–3680` `getNoteStats` | Loops over `activeNotes` and switch-counts in JS | The switch is fine; problem is the prior `getActiveNotes` likely fetches all notes; combine into one `SELECT delinquency_status, COUNT(*) FROM notes WHERE … GROUP BY delinquency_status` | Single GROUP BY. |
| `server/services/dealHunter.ts` (multiple) | `for (const deal of deals) { await this.saveDeal(deal); }` | Hundreds of deals → hundreds of inserts | Batch insert: `db.insert(scrapedDeals).values(deals).onConflictDoNothing()` |
| `server/services/dealHunter.ts` `for (const rule of rules)` | Per-rule alert creation | Same as above — batch insert alerts in one call. |
| `server/services/leadEnrichment.ts` `for (const id of leadIds)` | Sequentially awaits enrichment per lead | External API constrained — keep sequential, but add `Promise.allSettled` with `pLimit(5)` for parallelism + circuit breaker. |
| `server/routes-properties.ts:802–820` bulk-parcel | Sequential `lookupParcelByAPN` per property | External API; keep sequential but parallelize with concurrency cap. The DB writes inside the loop should also batch — `await storage.updateProperty(…)` per row × 100 properties = 100 transactions. | Collect `{ id, fields }`, single `UPDATE properties SET … FROM (VALUES …)` after the loop. |
| `server/routes-leads.ts:669` `for (const de of dealEvents)` | Reading deal events to derive lead state | Likely doable as a single LEFT JOIN. | Audit. |
| `server/storage.ts:2467, 2477, 2487` (search across leads/properties/deals) | Three sequential queries per search call | Should be parallel `Promise.all` minimum, ideally one UNION ALL query against a search view. | `Promise.all` is the 5-minute fix. |
| `server/services/dueDiligenceTemplates` per-template item insert | Loop body inserts | Use a single batched insert. |

The pattern: anywhere `for (const x of xs) { await db.something(x) }` appears, either batch the writes or `Promise.all` the reads. There are **~18 instances** across `server/storage.ts` alone.

**A subtler N+1 pattern: "fetch list then enrich each row in parent route".** This is harder to grep but I expect it exists in the founder dashboard and pipeline views. Symptom: a dashboard route does `const deals = await getDeals()`, then for the response iterates and attaches `property`, `lead`, `lastActivity` per deal. Each per-deal fetch is a query. The shape that's hard to scale: list endpoints that return enriched DTOs without using SQL JOINs.

**Recommended pattern:** introduce a `dealListView` Drizzle relation query that does `with: { property: true, primaryLead: true }`. Drizzle's relational query builder will batch-fetch parents in a single `IN (id1, id2, ...)` query — that's the right shape. Audit any route handler returning > 20 records and confirm it's not doing per-row enrichment in JS.

---

## 5. Partitioning plan

Tables that will pass 10M rows in 18 months given current trajectory (estimate: 100 customers × 50 leads/day × 30 events/lead/day × 30 days = baseline activity):

| Table | Estimated row growth | Partition strategy | Trigger |
|---|---|---|---|
| `audit_log` | ~5M/quarter at 100 customers; ~50M/quarter at 1000 | RANGE BY `created_at`, monthly partitions | Implement now. Set up `pg_partman` BEFORE crossing 10M. Once you cross, partitioning live tables requires a careful no-downtime migration (CTAS to new partitioned table, swap names, re-create FKs). |
| `system_activity` | Job-ranged — 40+ jobs × 100 customers × hourly = ~3M/month | RANGE BY `created_at`, monthly partitions, drop after 13 months | Same — set up now. |
| `agent_llm_traces` | Every LLM call — at AI-heavy usage, 200 calls/customer/day → 6M/month at 100 customers | RANGE BY `created_at`, monthly, drop after 6 months (cost vs value) | Same — set up now. Also: do you need raw prompt/response text past 90 days? Probably not. Add a redaction job that nulls payload columns after 90d. |
| `inbox_messages` | Mailer firehose — depends on volume but easily 1M/customer/year | RANGE BY `received_at`, monthly | At 50 customers, evaluate. |
| `mailer_events` (you mentioned; I see `campaign_delivery_events` as the closest) | Per-recipient delivery rows — campaign of 10k × 100 customers × 4/month = 4M/month | RANGE BY `created_at`, monthly | Now. |
| `messages` (conversations) | Lead-bound, slower growth | LIST BY `organization_id` if you ever do per-tenant isolation; otherwise RANGE created_at when > 20M | Wait. |
| `activity_log`, `activity_events`, `outcome_telemetry` | All similar growth profile | RANGE by `created_at` monthly | Within 12 months. |
| `provider_cache` | TTL-driven; needs daily cleanup, not partitioning | DELETE WHERE expires_at < now() daily | Add cron now. |

**Tooling:** `pg_partman` with `partition_interval='1 month'`, `retention='13 months'` (audit_log), `retention='6 months'` (agent_llm_traces). On Fly.io managed Postgres, confirm `pg_partman` extension is available; if not, hand-rolled `pg_cron` + `CREATE TABLE … PARTITION OF` is fine.

**Anti-pattern to avoid:** do NOT partition until you've actually run `ANALYZE` and seen index bloat. Partitioning is a sledgehammer; smaller wins (BRIN on `created_at`, monthly archival to cold storage) often suffice. My order of operations:

1. Add BRIN index on `created_at` for audit_log, system_activity, agent_llm_traces (cheap, today).
2. Add a nightly `DELETE FROM agent_llm_traces WHERE created_at < now() - interval '180 days'` via cron.
3. Set up `pg_partman` for audit_log + system_activity in next sprint.

---

## 6. Pool + slow-query observability

**Current:**
- `server/db.ts` configures `Pool` with `max: 20, idleTimeoutMillis: 60_000, connectionTimeoutMillis: 10_000, statement_timeout: 30_000, idle_in_transaction_session_timeout: 60_000`.
- A read-replica pool exists at `replicaPool` with `max: 5` (or `DB_REPLICA_POOL_MAX` env).
- `fly.toml` declares `min_machines_running = 2`, autoscale up to ~250 concurrent requests/instance.
- The doc-comment at top of `server/db.ts:9–11` claims "any query exceeding SLOW_QUERY_THRESHOLD_MS is logged." **This is false.** I grepped: `SLOW_QUERY_THRESHOLD` appears only in that comment. No `pool.on('query')`, no instrumented Drizzle wrapper, no `pg_stat_statements` view query, no slow-query log. The comment is aspirational, not implemented.
- **No pgBouncer.** Direct Postgres connections from Node.

**The math:**
- 2 machines × 20 primary + 5 replica = 50 connections at min. Fly Postgres default plan caps at 100. You're at 50% utilization just sitting idle.
- If autoscaler hits the soft limit (200 concurrent req/instance) and triggers up to, say, 6 machines, you're at 6 × 25 = 150 connections — **above the cap**. Connection exhaustion → 5xx storm.
- Background jobs in `server/index.ts` (40+ trackInterval) all share the same pool. A single long-running `valuationModelRetrain` query can hold a connection for minutes; with 20-cap, that's 5% of capacity gone.

**Quantifying the gap:** without slow-query telemetry, you have no answer to questions like:
- "Which customer's queries are slow?"
- "Did the latest migration regress p95 on `/api/leads`?"
- "Why is the dashboard taking 4s for org #X but 200ms for org #Y?"

Every one of those questions arrives from a customer at the worst possible moment, and without the data you reach for a guess. With `pg_stat_statements` + per-route AsyncLocalStorage attribution, the answer is a Grafana panel away.

**Needed:**
1. **Add pgBouncer** in transaction-pooling mode. App → pgBouncer (high pool: 500) → Postgres (low pool: 30). Drizzle's prepared statements are tricky with transaction pooling — verify `prepared: false` or use session pooling for the migration release-command path, transaction pooling for app traffic.
2. **Implement slow-query logger** that the doc-comment promises. Two options:
   - DB-side: `ALTER DATABASE acreos SET log_min_duration_statement = 1000;` — Postgres logs to its own log; surface via Fly logs. Zero app code.
   - App-side: wrap `pool.query` to time + emit Prometheus histogram. Higher leverage because you get per-route attribution via AsyncLocalStorage.
3. **Enable `pg_stat_statements`** extension. Daily cron exports the top-50 by `total_exec_time` to a `query_perf_snapshot` table. This is your weekly "what's slow this week" review.
4. **Bound background-job DB usage**: jobs that run > 30s should use a dedicated `bgPool` with `max: 3` so they cannot starve the request pool.

---

## 7. Foreign-key cascade behavior

Migration 0024 added cascade/set-null/restrict on **16 foreign keys**. The schema has **386 foreign-key references**, of which only **28 declare `onDelete:` inline**. So roughly **44 of 386 ≈ 11.4% of FKs have explicit cascade behavior. The remaining 88.6% default to `NO ACTION` — meaning a delete that should cascade will instead error, and worse, application code that assumes cascade silently leaves dangling FKs.**

What 0024 covered correctly:
- `team_members`, `leads`, `properties`, `deals`, `notes`, `campaigns`, `credit_transactions` org-FKs → CASCADE on org delete ✓
- `payments.note_id` → CASCADE ✓
- `lead_activities.lead_id` → CASCADE ✓
- `messages.conversation_id` → CASCADE ✓
- `notes.property_id`, `notes.borrower_id` → SET NULL ✓
- `deals.property_id` → RESTRICT (correct: don't lose deal history) ✓

What's still un-cascaded (sample — there are dozens more):
- `audit_log.organization_id` → silent NO ACTION; if you ever delete an org, audit_log delete will fail. Cascade or, better, RESTRICT (you should NEVER delete an org row in production; soft-delete via `organizations.deleted_at`).
- `agent_llm_traces.organization_id` → CASCADE (purge-on-delete is correct).
- `inbox_messages.organization_id`, `inbox_messages.lead_id` → both NO ACTION; should be CASCADE on org, SET NULL on lead.
- `notifications.user_id`, `team_messages.conversation_id`, `team_member_presence.organization_id` → all NO ACTION.
- `outcome_telemetry.related_deal_id`, `.related_property_id` → should SET NULL.

**Recommendation:** I do not advocate the "fix all 342 missing FKs" sledgehammer — risk is real, downtime potential, and most won't bite. Instead:

1. **Adopt a soft-delete-by-default policy** for the 12 root tables (orgs, users, leads, properties, deals, notes). `deleted_at` is already on most. Make hard-delete a DBA-only escape hatch.
2. **Run this audit query in staging:** `SELECT conname, conrelid::regclass FROM pg_constraint WHERE contype='f' AND confdeltype='a'` — gives you every FK with NO ACTION. Triage by table criticality.
3. **For each event-stream table referencing org**: CASCADE.
4. **For each lookup table referencing parent**: SET NULL (preserves history) unless the row makes no sense without parent (then CASCADE).
5. **Add a CI lint:** any new migration that adds a FK without `onDelete:` fails CI. Easy regex in pre-commit.

---

## 8. The 2-week DB hardening sprint

**Week 1 — kill the data-corruption footguns:**

1. **Wrap deal-close in `withTransaction`** — `routes-deals.ts:215–311`. Move audit + outcome_telemetry inside the tx; keep market-signal/pattern-cloning fire-and-forget AFTER commit. *(P0, ½ day)*
2. **Make e-sign send transactional + row-locked** — `eSigningService.ts:76`. `SELECT … FOR UPDATE`; check existing envelope; pass `documentId` as Dropbox Sign idempotency key; update with `WHERE esign_envelope_id IS NULL` precondition. *(P0, ½ day)*
3. **Wrap lead merge in `withTransaction`** — `storage.ts:~1490`. *(P0, ½ day)*
4. **Add the 5 missing indexes that affect today's queries**: `inbox_messages_org_received_idx`, `inbox_messages_org_unread_idx`, `team_messages_conv_created_idx`, `team_member_presence_org_user_uniq`, `simulated_actions_org_created_idx`. *(P0, ½ day)*
5. **Implement the slow-query logger that `db.ts` already documents** — pool-level `pg_stat_statements` query at `/api/admin/db/top-queries`, plus app-level instrument that emits a Prometheus histogram per query. *(P1, 1 day)*
6. **Add pgBouncer in transaction-pooling mode** to Fly app stack. App pool drops to 5; pgBouncer pool to primary 30; pgBouncer pool to replica 10. *(P1, 1.5 days)*

**Week 2 — observability + scale prep:**

7. **`pg_stat_statements` weekly snapshot** — daily cron writes top-50 by total_exec_time + total_calls to `query_perf_snapshot`. Founder dashboard shows this week's worst. *(P1, 1 day)*
8. **BRIN index on append-only timestamp columns** — `audit_log.created_at`, `system_activity.created_at`, `agent_llm_traces.created_at`. Drop the equivalent btree-on-created_at to save disk. *(P1, ¼ day)*
9. **Partition prep for `audit_log`, `system_activity`, `agent_llm_traces`, `campaign_delivery_events`** — install `pg_partman`, create the partitioned shadow tables, dual-write for a week, swap. (Or: `pg_cron` + manual `CREATE TABLE … PARTITION OF` if pg_partman not available.) *(P1, 2 days)*
10. **FK audit + cascade pass 2** — run the `pg_constraint` audit query, fix the top 30 highest-risk un-cascaded FKs. CI lint to prevent regression. *(P1, 1 day)*
11. **N+1 elimination — `getSequenceStats`, `getNoteStats`, `dealHunter.saveDeal` loops** — convert to GROUP BY / batch insert. *(P2, ½ day)*
12. **Background-job pool isolation** — separate `bgPool` with `max: 3`; route `valuationModelRetrain`, `dataIngestJob`, `featureEngineeringJob` through it. *(P2, ½ day)*

**Stretch:**
- TTL cleanup cron for `provider_cache` (DELETE expires_at < now()).
- Row-level security policies on the multi-tenant tables — defense in depth against a future bug that forgets to filter by `organizationId`. Drizzle supports passing org_id as a SET LOCAL in the tx wrapper.
- Connection pool saturation alert: `pg_stat_activity` > 80% of `max_connections` triggers PagerDuty.
- Verify `pg_dump` + `WAL-G` runbook actually works — practice a restore on staging quarterly.

---

## Closing note

The schema is well-modeled and the high-stakes paths (Stripe webhook, payment recording, credits) are correctly transactional. What worries me is the second tier — deal-close, e-sign send, lead merge — where features grew sequential awaits because the original transactional template was forgotten. The solution isn't more code review; it's a CI lint that flags any route handler with > 2 sequential `db.*` calls and forces a `// safe to non-tx because: …` comment.

The other systemic issue is observability. You have a beautiful schema, a thorough index audit, a real cascade migration — and **no instrument that tells you which query is slow today**. The slow-query logger that `db.ts` documents is a comment, not code. Fix that this week and the next 18 months of database work will be guided by data instead of guesses.

— Adriana Kraus
