# AcreOS Defect Deduplication Registry

Generated: 2026-04-18
Source: 72 lens audit files covering 150 lenses
Method: Every finding extracted, deduplicated by underlying code defect, severity = max across contributing lenses

---

## P0 -- Critical (Ships Broken)

### DEFECT-0001
Title: 381 founder/SCP route handlers have zero authentication middleware
Severity: P0
Status: FIXED
Surfaced by lenses: 1 (ARCH-006), 3 (BE-01), 7 (SEC-001), 51 (RACE-005 related), 96 (cross-org tool risk)
Description: Ten route files (routes-founder-v6 through v14, routes-scp-v2, routes-sovereign-integration) register 381 endpoints with no `isAuthenticated`, `getOrCreateOrg`, or `requireFounder` middleware. Any anonymous HTTP client can invoke agent orchestration, manipulate trust scores, trigger autonomous decision engines, and operate on arbitrary organizations via `req.body.orgId`.
Evidence: `server/routes-founder-v6.ts` through `server/routes-founder-v14.ts`, `server/routes-scp-v2.ts`, `server/routes-sovereign-integration.ts` -- all registered in `server/routes.ts:1253-1303` without auth wrappers. Grep for `isAuthenticated` in these files returns zero.
Remediation plan: Wrap each registration call with `app.use('/api/founder', isAuthenticated, requireFounder)` before the v* routes, or add auth middleware to every handler. Replace all `req.body.orgId` with `req.organizationId` from the auth chain.
Resolving commits: 377c4db

### DEFECT-0002
Title: SQL injection via sql.raw() in maintenance routes and support agent
Severity: P0
Status: FIXED
Surfaced by lenses: 7 (SEC-002), 60 (060-1), 7 (SEC-003)
Description: `routes-maintenance.ts:78-86` string-interpolates `req.body.status`, `req.body.cost`, and `req.body.priority` into `sql.raw()`. `supportAgent.ts:4507` interpolates `types` array values into `sql.raw()` via string concatenation to build an `ANY(ARRAY[...])` clause. Both are textbook SQL injection vectors.
Evidence: `server/routes-maintenance.ts` lines 75-89: `updates.push(\`status = '${status}'\`)` followed by `sql.raw(updates.join(", "))`. `server/ai/supportAgent.ts:4507`: `sql.raw(types.map(t => \`'${t}'\`).join(','))`.
Remediation plan: Replace `sql.raw()` in maintenance routes with Drizzle `.update().set()`. Replace `sql.raw()` in support agent with Drizzle `inArray()` operator.
Resolving commits: 377c4db

### DEFECT-0003
Title: TypeScript type-checking is a no-op -- tsconfig.check.json uses noResolve
Severity: P0
Status: FIXED
Surfaced by lenses: 1 (ARCH-001), 1 (ARCH-011), 5 (SRE-21 related)
Description: `tsconfig.check.json` set `noResolve: true` and only included a shim file, meaning `npm run check` verified zero application code. Combined with esbuild skipping type-checking, there was zero type safety anywhere in the pipeline.
Evidence: `/tsconfig.check.json` lines 13-17. 1,815+ TS errors reported in orientation doc.
Remediation plan: Remove `noResolve`, expand includes, fix errors incrementally.
Resolving commits: 1c49712

### DEFECT-0004
Title: Recursive logger shadow causes infinite call stack in 4 route files
Severity: P0
Status: FIXED
Surfaced by lenses: 1 (ARCH-007), 3 (BE-02)
Description: `routes-admin.ts`, `routes-borrower.ts`, `routes-dashboard.ts`, and `routes-pax-insights.ts` import `logger` then re-declare a local `const logger` that calls `logger.info()` -- creating infinite recursion on any error path.
Evidence: `server/routes-admin.ts` lines 33-39, `server/routes-borrower.ts` lines 9, 40-44.
Remediation plan: Remove the shadowing `const logger` blocks.
Resolving commits: 9354168

### DEFECT-0005
Title: Payment race condition -- non-transactional balance update on financial data
Severity: P0
Status: FIXED
Surfaced by lenses: 4 (DB-001), 51 (RACE-001, RACE-002), 54 (054-F02)
Description: `storage.createPayment()` performed a read-modify-write on note balance as three separate non-transactional statements. `deductCredits()` balance decrement and ledger insert were also non-transactional. Concurrent payments could corrupt financial data.
Evidence: `server/storage.ts:1841-1857`, `server/services/credits.ts:96-136`.
Remediation plan: Wrap in `withTransaction()`, use `SELECT FOR UPDATE`, add optimistic locking.
Resolving commits: 53d38f5, 1a73fea

### DEFECT-0006
Title: Stripe webhook idempotency has TOCTOU gap allowing double-processing
Severity: P0
Status: FIXED
Surfaced by lenses: 51 (RACE-003), 63 (WH-002)
Description: `processWebhook()` checks `isDuplicate(event.id)` then processes then calls `markProcessed()`. Between check and mark, a duplicate delivery on both Fly.io instances can pass the check simultaneously, leading to double credit grants or double subscription activations. Should use `INSERT ... ON CONFLICT DO NOTHING RETURNING` as an atomic claim.
Evidence: `server/webhookHandlers.ts` lines 30-86. Two Fly.io machines = true concurrent processing.
Remediation plan: Replace SELECT-based `isDuplicate` with `INSERT INTO stripe_processed_events ... ON CONFLICT DO NOTHING RETURNING id` as an atomic claim before dispatching.
Resolving commits: 377c4db

### DEFECT-0007
Title: Monthly credit allowance has TOCTOU race for double-granting
Severity: P0
Status: FIXED
Surfaced by lenses: 51 (RACE-004)
Description: Both `applyMonthlyAllowance` methods check for existing credit transaction, then if none found, insert the allowance. Concurrent invocations on two instances can both pass the check and double-grant monthly credits. No unique constraint on `(organizationId, type, month)`.
Evidence: `server/services/credits.ts` lines 236-264 and 462-505.
Remediation plan: Add a `UNIQUE` constraint on `(organization_id, type, metadata->>'month')` for credit transactions, or use `INSERT ... ON CONFLICT DO NOTHING`.
Resolving commits: 377c4db

### DEFECT-0008
Title: Webhook handlers for Dropbox Sign, Meta Lead Ads, Actum ACH, and inbound email lack signature verification
Severity: P0
Status: FIXED
Surfaced by lenses: 3 (BE-03), 63 (WH-008, WH-011, WH-014, WH-016)
Description: Four webhook endpoints process business-critical data without verifying the sender's cryptographic signature. Dropbox Sign handler has a comment claiming verification but no code. Meta Lead Ads POST handler does not check `X-Hub-Signature-256`. Actum ACH handler has zero authentication on financial status updates. Inbound email handler does not verify SNS signature. Any party can forge payloads.
Evidence: `server/routes-elite-features.ts:270-278` (Dropbox Sign), `:314-345` (Meta), `:418-425` (Actum). `server/routes-inbound-email.ts:32-48` (SNS).
Remediation plan: Add signature verification to all four handlers. Actum is highest priority due to financial data exposure.
Resolving commits: 377c4db

### DEFECT-0009
Title: SSRF check in deal-rooms is broken by missing await
Severity: P0
Status: FIXED
Surfaced by lenses: 61 (061-1)
Description: `validateUrl()` is `async` but called without `await`. The result is checked for `.safe` property which does not exist on a Promise. The truthiness check on a Promise always passes, completely bypassing SSRF protection.
Evidence: `server/routes-deal-rooms.ts:182-185`.
Remediation plan: Add `await` to the `validateUrl()` call and handle thrown errors.
Resolving commits: f8c476d

### DEFECT-0010
Title: Unbounded tool-calling loops in vaService.ts and supportAgent.ts can cause unlimited LLM spend
Severity: P0
Status: FIXED
Surfaced by lenses: 98 (098-F1), 100 (RUNAWAY-001, RUNAWAY-002)
Description: Two services have `while (assistantMessage.tool_calls)` loops with no iteration limit. `executive.ts` has `MAX_TOOL_ITERATIONS = 10` but `vaService.ts` and `supportAgent.ts` lack any cap. The streaming path in `executive.ts` (`processChatStream`) also has no iteration limit and no client-disconnect handling. A single user action could generate unlimited LLM calls costing $50-$500+.
Evidence: `server/ai/vaService.ts:648`, `server/ai/supportAgent.ts:5243`, `server/ai/executive.ts` processChatStream.
Remediation plan: Add `MAX_TOOL_ITERATIONS` (10) to both loops. Add disconnect detection to streaming path.
Resolving commits: 19e942c, f8c476d

### DEFECT-0011
Title: Charge dispute webhook events silently dropped -- chargebacks invisible
Severity: P0
Status: FIXED
Surfaced by lenses: 87 (F087-1)
Description: The Stripe webhook handler does not handle `charge.dispute.created`, `charge.dispute.updated`, or `charge.dispute.closed` events. When a customer files a chargeback, the event is logged as "Unhandled Stripe event type" at info level. The org continues with full access while Stripe holds disputed funds. No alert reaches the founder.
Evidence: `server/webhookHandlers.ts:88-160` -- switch statement has no dispute case.
Remediation plan: Add handlers for `charge.dispute.*` events. At minimum create system alert for founder. Consider suspending org access on active dispute.
Resolving commits: 377c4db

### DEFECT-0012
Title: Destructive migration (TRUNCATE CASCADE) with no rollback path
Severity: P0
Status: FIXED
Surfaced by lenses: 53 (053-F01)
Description: `migrations/0020_clerk_migration.sql` performs `ALTER TABLE users DROP COLUMN password_hash`, `DROP TABLE sessions/password_reset_tokens`, and `TRUNCATE TABLE users CASCADE`. No down migration exists. Running against an environment with existing users would destroy all user data and cascade to every FK-referencing table.
Evidence: `migrations/0020_clerk_migration.sql`.
Remediation plan: Add IF EXISTS guards. Ensure migration is marked as applied in all environments. Add a backup step before any future destructive migration.
Resolving commits: 377c4db

---

## P1 -- High (Ships Bad)

### DEFECT-0013
Title: CSRF middleware defined but never applied
Severity: P1
Status: FIXED
Surfaced by lenses: 3 (BE-04), 7 (SEC-004)
Description: `server/middleware/csrf.ts` implements double-submit cookie CSRF protection but was never imported or `app.use()`d anywhere.
Evidence: Grep for `csrfProtection` returned only definition + Sentry header strip.
Remediation plan: Apply `csrfProtection` globally to `/api/*` routes except webhooks.
Resolving commits: 5e79639

### DEFECT-0014
Title: JWT grace period was 5 minutes (should be 30 seconds)
Severity: P1
Status: FIXED
Surfaced by lenses: 7 (SEC-005)
Description: `server/auth/clerkAuth.ts:38` accepted expired JWTs up to 5 minutes past expiry. Standard clock-skew tolerance is 30 seconds.
Evidence: `GRACE_PERIOD_MS = 5 * 60 * 1000`.
Remediation plan: Reduce to 30 seconds.
Resolving commits: 5e79639

### DEFECT-0015
Title: FK cascades missing on ~197 foreign keys
Severity: P1
Status: FIXED
Surfaced by lenses: 4 (DB-003)
Description: Of ~200 FK references in schema.ts, only 3 specified onDelete behavior. The rest used Postgres default RESTRICT, making entity deletion fail silently and leaving orphan cleanup to incomplete manual code.
Evidence: `shared/schema.ts` -- 197 FKs without onDelete. `storage.ts:1644-1648` -- manual cleanup misses 15+ child tables.
Remediation plan: Add `onDelete: "cascade"` or `"set null"` to all FKs. 15 critical ones prioritized.
Resolving commits: eb25351

### DEFECT-0016
Title: Unbounded SELECT queries on core entities (getLeads, getDeals, getProperties)
Severity: P1
Status: FIXED
Surfaced by lenses: 4 (DB-004), 5 (SRE-01), 59 (059-1, 059-2)
Description: Core storage methods returned every row for an organization with no LIMIT clause, called from dashboard, analytics, MCP server, and AI agents. Would OOM on moderate usage.
Evidence: `server/storage.ts:1261-1270` (getLeads), `:1571-1575` (getProperties), `:1667` (getDeals).
Remediation plan: Add LIMIT to all queries. Use paginated variants for analytics. Add SQL aggregation for dashboards.
Resolving commits: 53d38f5

### DEFECT-0017
Title: AI endpoints missing per-user credit checks
Severity: P1
Status: FIXED (per-ORG only) — **the per-USER half was never wired; see correction 2026-08-19**
Surfaced by lenses: 51 (RACE-010), 100 (cost controls unwired)
Description: `callWithCreditCheck` and `callWithCircuitBreaker` from `openaiClient.ts` were imported by zero files. `userAiCostControls.ts` was also unused. AI endpoints could be called without credit verification.
Evidence: Grep for `callWithCreditCheck` returned only definition/export.
Remediation plan: Wire credit checks to all AI endpoints.
Resolving commits: a763756

**Correction, 2026-08-19.** This entry read FIXED with a remediation of "wire
credit checks to *all* AI endpoints", and that is not what landed. What landed
in a763756 was the **per-org** `aiCostCeiling` on `routeAITask`.
`userAiCostControls.ts` — the per-USER daily/monthly budget this entry names —
was never wired to anything and has now been **deleted** (deletion ledger,
2026-08-19). It was not merely unused: its usage read caught every error and
fell back to a per-process `Map`, so with Redis unreachable it read 0 and the
cap never fired, and without `REDIS_URL` it was per-instance and reset on
restart. A cap that silently disables itself is worse than no cap, because the
registry entry above is what someone reads instead of checking.

Two things this entry should not be read as covering, both still open:

1. **Per-USER granularity does not exist anywhere.** If per-user caps are
   wanted they are a fresh design against a DB-backed counter that fails
   CLOSED, not a resurrection of the deleted service.
2. **The only cap on the `/api/va` path is the single platform-wide daily
   ceiling.** `ai/vaService.ts:682` and `:809` call `assertAiSpendAllowed`,
   which resolves to `assertWithinAiCostCeiling` — one global counter. One org
   can consume the platform's whole daily allowance and the ceiling then
   refuses everyone.

Corrected 2026-08-20: the previous wording here said `/api/va` "has no per-user
or per-org cost check at all", following `docs/audit-2026-08/16-cost.md` F-16-1.
That audit finding was ACTIONED — vaService's own comment cites it by name — and
the note above had not caught up. The gap is narrower than it read, and the
platform ceiling is real.

### DEFECT-0018
Title: Prompt injection guards missing on indirect data paths (knowledge base, file attachments, tool results)
Severity: P1
Status: FIXED (partial)
Surfaced by lenses: 96 (CRITICAL findings in executive.ts, supportAgent.ts)
Description: The `promptInjectionMiddleware` only guards `req.body.message` at the HTTP boundary. User-uploaded knowledge base documents, file attachments (CSV, DOCX), project files, and tool results (web-scraped content) flow directly into LLM prompts without sanitization. 12 routes and 14 patterns were hardened.
Evidence: `server/ai/executive.ts:716-728` (knowledge base), `:561-624` (file attachments), `:1006-1014` (tool results).
Remediation plan: Sanitize all user-controlled data before injection into LLM prompts. Add delimiter-escaping for knowledge base content.
Resolving commits: 53d38f5 (12 routes, 14 patterns)

### DEFECT-0019
Title: Multi-tenant isolation broken in 30+ storage update/delete methods
Severity: P1
Status: FIXED
Surfaced by lenses: 4 (DB-002), 4 (DB-013), 3 (BE-19)
Description: Numerous mutation methods in `storage.ts` filter only on `id` without `organizationId` in the WHERE clause. `updateLead`, `updateProperty`, `updateNote`, `deleteNote`, `updatePayment`, and 30+ `delete*` methods allow cross-tenant data modification by guessing IDs.
Evidence: `server/storage.ts:1334` (updateLead), `:1616` (updateProperty), `:1806` (updateNote), `:1813` (deleteNote), `:2161-2163` (deleteAiConversation).
Remediation plan: Add `organizationId` as required parameter to all mutation methods. Filter at SQL level. Add lint rule to enforce.
Resolving commits: 5cfbf6e

### DEFECT-0020
Title: Twilio SMS webhook endpoints missing signature verification
Severity: P1
Status: FIXED
Surfaced by lenses: 3 (BE-03), 63 (WH-006, WH-007)
Description: Three Twilio webhook endpoints accepted POST requests without verifying `X-Twilio-Signature`. Additionally, the SMS handler returns 400/500 on errors triggering Twilio retries, and has no idempotency on message processing.
Evidence: `server/routes-misc.ts:286, :365, :396`.
Remediation plan: Add `verifyTwilioSignature` middleware. Always return 200 after valid signature. Add MessageSid dedup.
Resolving commits: Twilio signature middleware was added per lens 63 analysis showing PASS on verification.

### DEFECT-0021
Title: Only 3 files use database transactions despite hundreds of multi-step writes
Severity: P1
Status: FIXED
Surfaced by lenses: 3 (BE-06), 51 (RACE-006 through RACE-009)
Description: `withTransaction()` is used in only `routes-deals.ts` (2), `db.ts` (definition), and `routes-billing.ts` (3). Marketplace bid acceptance, campaign sends, org creation + team member, and virtually all "create entity + log activity" patterns lack transactions.
Evidence: Marketplace `respondToBid` (3 tables without tx), `completeTransaction` (5 operations without tx), `getOrCreateOrg` (org + team member without tx), campaign email send (credit check-then-deduct gap).
Remediation plan: Wrap all multi-step write operations in `withTransaction()`. Prioritize billing, marketplace, campaign execution, and organization setup.
Resolving commits: 2571108

### DEFECT-0022
Title: WebSocket channel authorization allows cross-org subscriptions
Severity: P1
Status: FIXED
Surfaced by lenses: 7 (SEC-006)
Description: `isAllowedChannel()` permitted any authenticated user to subscribe to `deal:*`, `listing:*`, `negotiation:*`, and `founder:activity` channels regardless of org membership. Broadcast sent to all subscribers without org filtering.
Evidence: `server/websocket.ts:222-232`.
Remediation plan: Validate org ownership before allowing subscription. Scope channels with org-id prefix.
Resolving commits: 29462e0

### DEFECT-0023
Title: statement_timeout documented but never configured on DB pool
Severity: P1
Status: FIXED
Surfaced by lenses: 4 (DB-009), 5 (SRE-03), 6 (REL-08)
Description: The comment in `db.ts` claimed `statement_timeout: 30s` but the Pool configuration had no such setting. Runaway queries could hold connections indefinitely.
Evidence: `server/db.ts:8` (comment) vs `:27-32` (actual config).
Remediation plan: Add `statement_timeout` and `idle_in_transaction_session_timeout` to pool config.
Resolving commits: c0b1459

### DEFECT-0024
Title: Primary DB pool missing error handler
Severity: P1
Status: FIXED
Surfaced by lenses: 5 (SRE-04), 6 (REL-07)
Description: Replica pool had `.on("error")` handler but primary pool did not. Unhandled error event could crash the process.
Evidence: `server/db.ts:55-57` (replica handler) vs `:27-32` (no primary handler).
Remediation plan: Add `pool.on("error", ...)` to primary pool.
Resolving commits: b945fb5

### DEFECT-0025
Title: Graceful shutdown does not close DB pool, clear intervals, or drain WebSocket
Severity: P1
Status: FIXED
Surfaced by lenses: 5 (SRE-02, SRE-15), 6 (REL-06), 52 (H1), 62 (P1-M)
Description: The SIGTERM handler closed HTTP server but left 44 setInterval timers running, never called `pool.end()`, and never closed WebSocket server. In-flight DB queries could be interrupted, connections left dangling.
Evidence: `server/index.ts:736-756`.
Remediation plan: Store interval handles, clear on shutdown. Add `pool.end()`, `replicaPool.end()`.
Resolving commits: 2d50235 (intervals), c0b1459 (pool drain), 515ca76 (all 43 intervals)

### DEFECT-0026
Title: Redis/ioredis not in package.json -- health check crashes, rate limiting per-instance only
Severity: P1
Status: FIXED
Surfaced by lenses: 5 (SRE-05, SRE-13), 6 (REL-05), 56 (056-F03), 62 (P0-I)
Description: `ioredis` is used by 14 server files but is only available as a transitive dep of `bullmq`. `redis` package imported by health check does not exist. Without Redis in production: rate limiting is per-instance (doubled limits), idempotency is per-instance, BullMQ jobs silently degrade to no-ops, and the health check always reports degraded.
Evidence: `package.json` -- neither `redis` nor `ioredis` in deps. `server/services/healthCheck.ts:222` imports `redis`.
Remediation plan: Add `ioredis` as explicit production dependency. Rewrite health check to use `ioredis`. Provision Redis via Fly.io Upstash.
Resolving commits: d7b855b

### DEFECT-0027
Title: 477 KB schema chunk shipped to client bundle
Severity: P1
Status: DEFERRED
Surfaced by lenses: 5 (SRE-06)
Description: The 14,883-line `shared/schema.ts` is imported by 20+ client files for types AND runtime Zod validators. Vite tree-shakes types but bundles all Zod schemas, producing a 477 KB chunk -- the 3rd largest in the build.
Evidence: `dist/public/assets/schema-BijKS9R_.js` -- 477,350 bytes.
Remediation plan: Split into type-only and runtime-validation modules. Move only needed Zod schemas to a lightweight `@shared/validators.ts`.
Resolving commits: DEFERRED — splitting 14,883-line schema.ts into modules is a high-risk refactor touching 200+ import sites. Requires dedicated session with full test coverage verification.

### DEFECT-0028
Title: Stripe Connect handler never advances nextPaymentDate after payment
Severity: P1
Status: FIXED
Surfaced by lenses: 58 (F-058-02)
Description: When a Stripe Connect `payment_intent.succeeded` is processed, the handler updates `currentBalance` and `status` but never advances `nextPaymentDate` or updates `amortizationSchedule`. This causes false delinquency flags, incorrect reminder emails, and wrong borrower portal display for notes paid via Connect.
Evidence: `server/services/stripeConnect.ts:441-444` vs `server/webhookHandlers.ts:671-677` (which correctly advances).
Remediation plan: Replicate the schedule-advance logic from `webhookHandlers.ts` into `stripeConnect.ts:handleSuccessfulPayment`.
Resolving commits: a6e509e

### DEFECT-0029
Title: Refund auto-approval does not cancel subscription or downgrade tier
Severity: P1
Status: FIXED
Surfaced by lenses: 87 (F087-2, F087-3)
Description: The self-serve refund endpoint auto-approves refunds under $50 with no rate limiting. After processing, the Stripe refund is created and confirmation email sent, but the subscription is NOT cancelled. User retains full paid-tier access despite receiving money back.
Evidence: `server/routes-billing.ts:830-866`.
Remediation plan: After refund, trigger subscription cancellation or flag for manual review. Add rate limit: max 1 refund per org per 30 days.
Resolving commits: 664d569

### DEFECT-0030
Title: Support agent has cross-org `apply_bulk_fix` tool without org validation
Severity: P1
Status: FIXED
Surfaced by lenses: 96 (CRITICAL in supportAgent.ts)
Description: The LLM-driven support agent can call `apply_bulk_fix` with arbitrary `affected_org_ids`. No validation ensures these org IDs belong to the requesting user's organization. If the LLM is manipulated via injection in a support message, it could apply cache clearing, data resync, or retry operations across other organizations.
Evidence: `server/ai/supportAgent.ts:2901-2917`.
Remediation plan: Validate that all `affected_org_ids` match the authenticated user's organization. Add approval gate for destructive support tools.
Resolving commits: 646489a

### DEFECT-0031
Title: LLM output validator module exists but is entirely unused (dead code)
Severity: P1
Status: FIXED
Surfaced by lenses: 97 (097-F1)
Description: `server/ai/validators.ts` exports `validateAtlasOutput` with Zod-based validation for offers, amortization schedules, ROI analyses. It includes cross-checks (amortization math within 2% tolerance). However, no file imports or calls these functions. LLM-generated financial outputs flow directly to clients without schema validation.
Evidence: Codebase-wide search for `validateAtlasOutput` returns zero imports.
Remediation plan: Wire `validateAtlasOutput` into every code path that generates financial data before returning to client.
Resolving commits: 894b463

### DEFECT-0032
Title: provider_cache table exists in schema but is never queried -- external lookups never cached
Severity: P1
Status: FIXED
Surfaced by lenses: 1 (ARCH-018), 56 (056-F01)
Description: `shared/schema.ts` defines `providerCache` table with indexes. CLAUDE.md documents "Response caching via provider_cache table." But provider registry makes fresh API calls on every lookup with no cache check. Repeated lookups for the same parcel/address are charged multiple times.
Evidence: `server/services/providers/provider-registry.ts` -- no reference to `providerCache`.
Remediation plan: Implement cache-first in `providerRegistry.lookup()`. Check `provider_cache` before calling external providers. Write results on cache miss.
Resolving commits: 4c27079

### DEFECT-0033
Title: 25 Google Font families loaded in a single render-blocking CSS request
Severity: P1
Status: FIXED
Surfaced by lenses: 73 (073-A), 74 (074-A), 116 (116-A), 9 (MOB performance)
Description: `client/index.html` loads 25 distinct font families in a single Google Fonts CSS URL. This is render-blocking and directly degrades LCP/FCP by 200-500ms+ for every user on every page load. Most fonts are for the theme customizer and are never used simultaneously.
Evidence: `client/index.html:28` -- single URL with 25 `family=` params.
Remediation plan: Replace with only the fonts actually used (Inter + 1 mono font). Load others dynamically via theme customizer when selected.
Resolving commits: 3161de2

### DEFECT-0034
Title: Hardcoded fallback secrets in production-facing cryptographic code
Severity: P1
Status: FIXED
Surfaced by lenses: 65 (F065-02)
Description: Several services use hardcoded string fallbacks for cryptographic secrets: `"dev-secret"` for document signing, `"acreos-cert"` for certificate hashes, `"acreos-inbound-default"` for inbound email HMAC, and `"acreos-dev-config-key-insecure"` for config encryption. If env vars are not set, these predictable values are used in production.
Evidence: `server/routes-deal-rooms.ts:266`, `server/jobs/courseCompletionCheck.ts:41`, `server/services/inboundEmailService.ts:8`, `server/services/configManager.ts:28`.
Remediation plan: Refuse to start in production if any cryptographic secret is missing. Extend `validateSecrets` to cover all these keys.
Resolving commits: 4c4fc7f

### DEFECT-0035
Title: handleQueryError defined in queryClient.ts but never wired -- 145+ pages silently swallow query errors
Severity: P1
Status: FIXED
Surfaced by lenses: 69 (finding 2 and 3), 76 (EM-02), 2 (FE-06), 71 (071-B)
Description: `handleQueryError` function is defined in `queryClient.ts` but never referenced -- not exported, not passed to QueryClient defaults. Only 9-11 of 156 pages use `QueryErrorState`. Failed queries enter error state silently. Users see blank/loading-forever screens with no feedback on 145+ pages.
Evidence: `client/src/lib/queryClient.ts:59-87` -- defined, never wired. Only 9 pages import `QueryErrorState`.
Remediation plan: Wire `handleQueryError` into `QueryCache.onError` for instant safety net. Adopt `PageShell`-level error boundary or wrapper for remaining pages.
Resolving commits: de6e0d1

### DEFECT-0036
Title: Duplicate route declarations in App.tsx -- 47 paths declared twice with conflicting auth guards
Severity: P1
Status: FIXED
Surfaced by lenses: 2 (FE-01)
Description: `App.tsx` defines 187 routes, of which 47 paths are declared twice. The `<Switch>` renders only the first match, making the second block dead code. Worse, some duplicates use different guard components (FlaggedRoute vs ProtectedRoute), meaning feature flags are silently bypassed.
Evidence: `client/src/App.tsx` lines 309-672. `/avm` uses FlaggedRoute on line 471 but ProtectedRoute on line 568. `/founder` redirects to different targets.
Remediation plan: Delete the duplicate route block (lines ~544-671). Audit surviving routes for correct guard usage.
Resolving commits: 636afc5

### DEFECT-0037
Title: 173 of 199 icon-only buttons lack aria-label -- screen readers unusable
Severity: P1
Status: FIXED
Surfaced by lenses: 8 (A11Y-02, A11Y-08, A11Y-12, A11Y-13)
Description: 87% of `<Button size="icon">` instances have no `aria-label`. Screen reader users hear only "button" with no indication of purpose. The Pax Copilot Rail alone has 12 unlabeled buttons. The floating action button lacks aria-label and aria-expanded.
Evidence: 173 unlabeled instances across 85 files. Key concentrations: `founder-dashboard.tsx` (10), `pax-copilot-rail.tsx` (12), `conversation-tray.tsx` (7).
Remediation plan: Add `aria-label` to every `size="icon"` Button. Add ESLint rule `button-has-accessible-name`.
Resolving commits: 234f113, b0acdac

### DEFECT-0038
Title: Skip link target #main-content does not exist -- skip link non-functional
Severity: P1
Status: FIXED
Surfaced by lenses: 8 (A11Y-01)
Description: The app renders `<a href="#main-content">Skip to content</a>` but no element has `id="main-content"`. The skip link navigates nowhere.
Evidence: `App.tsx:750` -- link. `page-shell.tsx:53` -- `<main>` without `id`.
Remediation plan: Add `id="main-content"` and `tabIndex={-1}` to `<main>` in PageShell.
Resolving commits: 11f64ce

### DEFECT-0039
Title: Framer Motion animations do not respect prefers-reduced-motion
Severity: P1
Status: FIXED
Surfaced by lenses: 8 (A11Y-05)
Description: Neither animation definitions nor `App.tsx` wrapper called `useReducedMotion()` or applied `MotionConfig reducedMotion="user"`. CSS-level media queries could not affect framer-motion JS animations. Users who opted out of motion still saw all page transitions and stagger animations.
Evidence: Zero results for `useReducedMotion` and `MotionConfig` across `client/src/`.
Remediation plan: Wrap app in `<MotionConfig reducedMotion="user">`.
Resolving commits: 300ee16, d48b6a6

### DEFECT-0040
Title: Viewport meta blocks user zoom (WCAG 1.4.4 failure)
Severity: P1
Status: FIXED
Surfaced by lenses: 9 (MOB-01)
Description: `maximum-scale=1, user-scalable=no` prevents pinch-to-zoom, a WCAG 1.4.4 failure for users with low vision.
Evidence: `client/index.html:5`.
Remediation plan: Remove `maximum-scale=1` and `user-scalable=no`.
Resolving commits: e7de9e8

### DEFECT-0041
Title: CI pipeline references non-existent job targets -- build job never runs
Severity: P1
Status: FIXED
Surfaced by lenses: 1 (ARCH-002), 10 (DO-01)
Description: `.github/workflows/ci.yml` build job specifies `needs: [unit-tests, integration-tests, e2e-tests]` but no such jobs exist. The build verification never executes. Combined with no functional type-checking, there is zero CI quality gate.
Evidence: `.github/workflows/ci.yml` line 94.
Remediation plan: Fix `needs` to reference actual jobs. Add test jobs or remove the dependency.
Resolving commits: 4688f7c

### DEFECT-0042
Title: Dockerfile deletes lockfile -- non-deterministic production builds
Severity: P1
Status: FIXED
Surfaced by lenses: 1 (ARCH-014), 5 (SRE-22), 10 (DO-03)
Description: `Dockerfile:23` runs `rm -f package-lock.json && npm install` instead of `npm ci`. Builds are non-reproducible and can pull in breaking dependency changes.
Evidence: `Dockerfile` line 23.
Remediation plan: Use `npm ci --legacy-peer-deps`.
Resolving commits: 4c3d8ec

### DEFECT-0043
Title: Node.js version mismatch -- Dockerfile 22 vs CI 20
Severity: P1
Status: FIXED
Surfaced by lenses: 10 (DO-02)
Description: Dockerfile uses Node 22.21.1 but all CI workflows use Node 20. No `.nvmrc` or `engines` field exists. Code passing CI tests may behave differently in production.
Evidence: `Dockerfile:7` vs `.github/workflows/deploy.yml:42`.
Remediation plan: Pin all environments to same Node version. Add `engines` field and `.nvmrc`.
Resolving commits: 4c3d8ec

### DEFECT-0044
Title: DNS resolution check disabled in browser automation SSRF protection
Severity: P1
Status: FIXED
Surfaced by lenses: 120 (120-A)
Description: `browseWeb` has extensive SSRF protections but the DNS resolution check is explicitly disabled with a comment "temporarily for debugging." This allows DNS rebinding attacks where a domain initially resolves to a public IP but then resolves to `169.254.169.254` (cloud metadata) during connection.
Evidence: `server/services/browserAutomation.ts:818-819`.
Remediation plan: Re-enable DNS resolution check. Remove the "temporarily for debugging" bypass.
Resolving commits: 48bb9a4

### DEFECT-0045
Title: File upload security middleware is dead code -- never imported by any route
Severity: P1
Status: FIXED
Surfaced by lenses: 61 (061-2)
Description: `createUploadMiddleware` and `validateFileMiddleware` (magic-byte validation, EXIF stripping, dangerous extension blocking) are defined in `server/middleware/fileUploadSecurity.ts` but never imported. Every upload route creates ad-hoc multer instances without content validation.
Evidence: Zero imports of `createUploadMiddleware` or `validateFileMiddleware` outside the definition file.
Remediation plan: Wire the security middleware into all upload routes.
Resolving commits: 8642682

### DEFECT-0046
Title: No file storage backend -- photo and voice uploads accepted then discarded
Severity: P1
Status: DEFERRED
Surfaced by lenses: 61 (061-3, 061-4)
Description: All uploads use `multer.memoryStorage()`. There is no S3, GCS, or persistent storage integration. Photo uploads save metadata to DB but the actual `file.buffer` is never stored. Voice uploads are similarly discarded.
Evidence: `server/routes-field-scout.ts:191-200` -- saves metadata, discards buffer.
Remediation plan: Add S3 or equivalent storage backend. Store file URLs in DB. Wire upload security middleware.
Resolving commits: DEFERRED — requires infrastructure provisioning (S3/R2 bucket, IAM credentials). Upload security middleware is now wired (DEFECT-0045). Storage integration requires a dedicated session with founder to select provider and configure credentials.

### DEFECT-0047
Title: Campaign email/SMS send has TOCTOU on credit check and no per-recipient dedup
Severity: P1
Status: FIXED
Surfaced by lenses: 51 (RACE-009)
Description: Credit check at line 1583 verifies balance, then the send loop takes seconds/minutes. Between check and deduction: another request could deplete credits, process crash means emails sent but credits not deducted, and no per-recipient send tracking means retries cause duplicate emails.
Evidence: `server/routes-campaigns.ts:1571-1672`.
Remediation plan: Deduct credits upfront before send loop. Refund partial on failure. Add per-recipient `campaign_sends` table for dedup.
Resolving commits: 69e2bae

---

## P2 -- Medium (Should Fix)

### DEFECT-0048
Title: Monolithic schema.ts (14,883 lines, 429 tables) -- unmaintainable
Severity: P2
Status: OPEN
Surfaced by lenses: 1 (ARCH-003), 4 (DB-006)
Description: Entire database schema in a single file. Beyond maintainability, this causes a 477 KB client bundle chunk and slow IDE performance.
Evidence: `shared/schema.ts` -- 14,883 lines.
Remediation plan: Split into domain-aligned modules with barrel re-export.
Resolving commits: pending

### DEFECT-0049
Title: 44 setInterval background jobs in web server process
Severity: P2
Status: OPEN
Surfaced by lenses: 1 (ARCH-004), 5 (SRE-02), 62 (full inventory)
Description: All background jobs run as `setInterval` timers in the main process. They compete for the 20-connection DB pool and cannot be scaled independently. BullMQ is a dependency but jobs are not migrated to it.
Evidence: `server/index.ts` -- 44 tracked intervals. 15 additional untracked.
Remediation plan: Extract to dedicated worker process or migrate to BullMQ.
Resolving commits: pending (interval tracking fixed, but architecture unchanged)

### DEFECT-0050
Title: Inconsistent error response format -- raw res.status().json() vs Errors.* helpers
Severity: P2
Status: OPEN
Surfaced by lenses: 1 (ARCH-016), 3 (BE-07), 3 (BE-20)
Description: ~487 usages of `Errors.*` helpers vs ~922 raw `res.status().json()`. Two different response shapes returned to clients. Global error handler returns `{ message }` only, not the standard shape.
Evidence: Multiple route files mix patterns.
Remediation plan: Migrate all raw responses to `Errors.*` helpers. Update global error handler.
Resolving commits: pending

### DEFECT-0051
Title: Migration sequence number collisions (12 duplicate ordinals)
Severity: P2
Status: OPEN
Surfaced by lenses: 1 (ARCH-009), 4 (DB-006), 53 (053-F02)
Description: 12 migration ordinals are duplicated. Drizzle journal only tracks 7 of 40+ files. Execution order is non-deterministic.
Evidence: `migrations/` directory -- 0003, 0007-0013, 0015-0018 all duplicated.
Remediation plan: Renumber migrations. Verify journal matches inventory.
Resolving commits: pending

### DEFECT-0052
Title: Financial amounts stored as numeric without precision -- arbitrary precision allowed
Severity: P2
Status: OPEN
Surfaced by lenses: 4 (DB-005)
Description: ~40 financial columns use bare `numeric()` without precision/scale. No DB-level guard against storing absurd values. `Number()` conversions lose precision for large values.
Evidence: `shared/schema.ts:24` (creditBalance), `:777` (originalPrincipal), `:778` (currentBalance), etc.
Remediation plan: Add `{ precision: 14, scale: 2 }` to all financial columns.
Resolving commits: pending

### DEFECT-0053
Title: Trust ledger running balance computed from last row -- no integrity guarantee
Severity: P2
Status: OPEN
Surfaced by lenses: 4 (DB-011)
Description: `getTrustBalance()` returns running balance from the most recent row by `created_at`. No constraint ensures consistency. Concurrent inserts or row deletion silently corrupts the chain. This is a fiduciary trust account.
Evidence: `server/storage.ts:7840-7847`.
Remediation plan: Compute from `SUM(amount)`. Add immutability trigger. Wrap inserts in serializable transaction.
Resolving commits: pending

### DEFECT-0054
Title: API keys and third-party credentials stored in plaintext in DB
Severity: P2
Status: OPEN
Surfaced by lenses: 4 (DB-008)
Description: `system_api_keys.api_key`, `founder_ad_accounts.access_token/app_secret`, and `organization_integrations.credentials` JSONB all store sensitive credentials in plaintext. Newer tables use encryption but older ones do not.
Evidence: `shared/schema.ts:10107-10109`, `:10971-10974`, `:195-198`.
Remediation plan: Encrypt all credential fields at rest using AES-256-GCM. Rotate existing keys after migration.
Resolving commits: pending

### DEFECT-0055
Title: 15+ unbounded in-memory Map caches with no coordination across instances
Severity: P2
Status: OPEN
Surfaced by lenses: 52 (C1-C4, H1-H11), 56 (056-F02)
Description: Module-level Maps act as caches/registries with no eviction policy, no size cap, and no cross-instance coordination. Append-only arrays in SCP subsystems, metrics histogram with unbounded key cardinality, and duplicate WebSocket from useKpiStream. Estimated 135-440 MB leak over 30 days.
Evidence: 30+ module-level Maps/Sets/arrays across server services.
Remediation plan: Add ring-buffer caps to arrays. Normalize metrics keys. Add max-size caps to all cache Maps. Eliminate duplicate WebSocket.
Resolving commits: pending

### DEFECT-0056
Title: withTransaction callbacks ignore tx parameter -- operations use global db
Severity: P2
Status: OPEN
Surfaced by lenses: 54 (054-F04)
Description: Several `withTransaction()` usages pass no `tx` argument or ignore it. `storage.updateOrganization` and `storage.createDeal` use the global `db` instance, not the transaction. The transaction wrapper does nothing useful in these cases.
Evidence: `server/routes-billing.ts:150`, `server/routes-deals.ts:159`.
Remediation plan: Accept and use the `tx` parameter. Refactor storage methods to accept optional transaction client.
Resolving commits: pending

### DEFECT-0057
Title: Hardcoded hex colors in 84 chart files -- dark mode and color-blind issues
Severity: P2
Status: OPEN
Surfaced by lenses: 76 (DV-01), 8 (A11Y-09)
Description: Recharts components use hardcoded hex colors instead of CSS variables. Charts invisible in dark mode. No pattern differentiation for color-blind users. A `ChartContainer` wrapper with theme support exists but is underused.
Evidence: 188 hardcoded hex values across 30+ chart files.
Remediation plan: Migrate to `ChartContainer` with `ChartConfig` using CSS custom properties.
Resolving commits: pending

### DEFECT-0058
Title: Borrower portal payment creates checkout sessions without atomic claim -- double-click drops payment
Severity: P2
Status: FIXED (superseded by DEFECT-0081)
Surfaced by lenses: 51 (RACE-017)
Description: If a borrower clicks "Pay" twice quickly, two Stripe checkout sessions are created. The second overwrites `pendingCheckoutSessionId`. If the borrower pays on the first (orphaned) session, the webhook verification fails because the stored session ID doesn't match, and the payment is silently dropped despite the borrower being charged.
Evidence: `server/routes-borrower.ts:220-280`.
Remediation plan: SUPERSEDED. The 2026-09-06 verification pass established that
this plan would not have worked: serializing the two writes still leaves one
slot, and the borrower legitimately has two open sessions (Stripe keeps a
checkout session alive 24 hours). The defect is on the CONSUMER side — the
webhook used a one-slot cache as an authorization check — and the entry also
understated it. The severity is not "a dropped record" but a dropped PAYMENT
that has already moved on the lender's own connected processor, with no
reconciliation path. See DEFECT-0081 for the analysis, the fix, and the test
that had pinned the defect as the intended contract.
Resolving commits: see DEFECT-0081

### DEFECT-0059
Title: Two competing onboarding wizards with no routing logic between them
Severity: P2
Status: FIXED
Surfaced by lenses: 86 (F086-1)
Description: V1 `onboarding-wizard.tsx` (4-step) and V2 `onboarding-v2.tsx` (path-branching, 7-step) both existed. No routing logic determined which was served. V1 redirected to `/dashboard`, V2 to `/today`.
Evidence: RESOLVED by the 2026-05-11 onboarding consolidation — `/onboarding-v2` is canonical (`App.tsx:494-497`), the standalone `onboarding-wizard.tsx` page was deleted (`App.tsx:36` "`OnboardingWizard` is no longer mounted"; `find client/src -iname "*onboarding-wizard*"` returns nothing at HEAD). Registry status was stale ("both files exist" was false at HEAD) — corrected by the 2026-08 audit (F-17-3).
Remediation plan: Done — V1 removed, canonicalized on V2.
Resolving commits: 2026-05-11 onboarding consolidation (App.tsx:494)

### DEFECT-0060
Title: 1098 tax statement year boundaries ignore timezone -- compliance error
Severity: P2
Status: OPEN
Surfaced by lenses: 58 (F-058-09)
Description: Year boundaries for IRS 1098 tax documents are constructed in server timezone. A payment on Dec 31 at 10 PM Pacific (Jan 1 UTC) would be excluded from the correct tax year.
Evidence: `server/routes-borrower.ts:663-668`.
Remediation plan: Construct year boundaries in org timezone or document UTC convention.
Resolving commits: pending

### DEFECT-0061
Title: Feature flag keys referenced in routes have no seed data -- 4 modules permanently inaccessible
Severity: P2
Status: OPEN
Surfaced by lenses: 64 (F064-03)
Description: `featureGate()` is used with `feature_white_label`, `feature_voice_ai`, `feature_territories`, `feature_deal_rooms` but these keys are not in any migration seed. Since `featureGate` returns 404 when flag is missing, these modules are permanently inaccessible.
Evidence: `server/routes.ts:1007, 1014, 1048, 1463`.
Remediation plan: Add missing flag keys to seed migration or idempotent seed script.
Resolving commits: pending

### DEFECT-0062
Title: Duplicate rate limiter definitions in index.ts and routes.ts
Severity: P2
Status: OPEN
Surfaced by lenses: 1 (ARCH-015)
Description: Rate limiters are defined in both `index.ts` and `routes.ts` with separate `rateLimit()` instances on overlapping paths. Separate counters effectively double the allowed rate.
Evidence: `server/index.ts:257-280` and `server/routes.ts:591-601`.
Remediation plan: Consolidate rate limiting to a single location.
Resolving commits: pending

### DEFECT-0063
Title: `(req as any)` used 73+ times across 27+ server files
Severity: P2
Status: PARTIALLY FIXED — headline is STALE, the `req.user as any` half is live
Surfaced by lenses: 1 (ARCH-012), 3 (BE-05), 7 (SEC-011); corrected by the
verification fan-out 2026-09-06
Description: The headline was true when written and is now dead. Measured at
HEAD 2026-09-06:

| claim | entry | measured |
|---|---|---|
| `(req as any)` in server production | 73+ | **0** |
| `(req as any)` repo-wide | — | 14, **all under `tests/`** |
| `routes-admin.ts` | 16 | 0 (file exists) |
| `routes-2fa.ts` | 8 | **file does not exist** |
| `req.user as any` in server production | 144 | 135 |

This entry was carrying the same defect DEFECT-0059 did: a registry row read as
OPEN while the thing it named had already gone. It is corrected here rather than
closed, because the second half is real — 135 `req.user as any` casts remain in
production server code, which is the CLAUDE.md standard's actual subject
("never use `(req as any)` — the Express request is augmented"). 134 are
`const user = req.user as any;`; the outlier is `const adder = req.user as any;`
at `server/routes-organization.ts:1341`.

Evidence: `grep -rn "(req as any)" server/ --include=*.ts` returns nothing;
`grep -rn "req.user as any" server/ --include=*.ts` returns 135.
Remediation plan: The remaining work is the `req.user as any` sweep to
`AuthenticatedRequest` + `getUserId()`. Mechanical and large; no user-visible
impact, so it ranks below the live defects.

Do NOT re-add a `(req as any)` count to this row. That count is zero and is
already HELD at zero by `scripts/ratchets/req-as-any.json` (baseline 0,
direction down, with a 1,100-file vacuity floor on the scan population). Which
is the real lesson of this correction: the ratchet had already driven the
headline to zero and the registry row never noticed. A defect list that is not
re-measured against the gates that fix things drifts into fiction in the safe
direction — it over-reports, and every over-report costs the next reader the
time to disprove it.
Resolving commits: the `(req as any)` half predates this registry correction

### DEFECT-0064
Title: Ownership data presented without freshness indicator -- stale county data shown as current
Severity: P2
Status: FIXED (see DEFECT-0082)
Surfaced by lenses: 126 (P1-126-01)
Description: Parcel service caches ownership data for 30 days. `lastUpdated` is set to fetch time, not county recording date. No indication of data staleness shown to users making purchase decisions.
Evidence: `server/services/parcel.ts:326` -- `lastUpdated: new Date().toISOString()`.
Remediation plan: Extract county's own update timestamp. Show "Data as of" with warning badge when older than 14 days.
Resolving commits: pending

### DEFECT-0065
Title: No do-not-mail suppression list check before direct mail sending
Severity: P2
Status: FIXED (see DEFECT-0082)
Surfaced by lenses: 127 (P1-127-01)
Description: Direct mail services send via Lob without checking against suppression lists. If a lead has `doNotContact: true`, TCPA blocks SMS/phone but no corresponding check exists for physical mail.
Evidence: `server/services/directMailService.ts` -- no `doNotContact` check.
Remediation plan: Add `checkMailCompliance()` function that verifies doNotContact flag and suppression lists.
Resolving commits: pending

### DEFECT-0066
Title: Synthetic parcel boundaries visually indistinguishable from real data
Severity: P2
Status: FIXED (see DEFECT-0082)
Surfaced by lenses: 128 (P1-128-01)
Description: When real parcel boundary data is unavailable, a simple rectangle is generated. It looks identical to real boundaries on the map, potentially misleading users about lot shape, setbacks, and buildable area.
Evidence: `client/src/pages/properties.tsx:613` -- generates rectangle fallback.
Remediation plan: Render synthetic boundaries with distinct style (dashed, lower opacity) and warning label.
Resolving commits: pending

### DEFECT-0067
Title: 3,089 TypeScript errors across 50+ files — type safety is structurally non-functional
Severity: P1
Status: DEFERRED
Surfaced by lenses: v4 session analysis
Description: `npx tsc --noEmit` reports 3,089 errors. 1,500 are TS18048 (`possibly undefined`) from auth middleware request types, 827 are TS2339 (property not found) from schema/code mismatches, and the rest are type assertion issues. The esbuild bundler ignores types so the app runs, but type safety provides no guarantee.
Evidence: `npx tsc --noEmit 2>&1 | grep -c "): error TS"` → 3089
Remediation plan: Fix structurally: (1) properly type auth middleware request as non-optional, (2) fix schema column mismatches in job files, (3) clean up remaining type errors file-by-file. Requires dedicated multi-session effort.
Resolving commits: DEFERRED — pre-existing structural debt. Pre-commit hook (eb3846e) now blocks new errors in staged files, preventing regression while the backlog is worked down.

### DEFECT-0068
Title: Pre-commit hook ran TypeScript in warning-only mode
Severity: P1
Status: FIXED
Surfaced by lenses: v4 session analysis
Description: `.githooks/pre-commit` ran `npx tsc --noEmit` but piped output to `tail -3` in a non-blocking `|| { warn }` block. Type errors never failed the commit. Combined with 3,089 existing errors, this was non-functional.
Evidence: `.githooks/pre-commit` lines 14-18.
Remediation plan: Rewrite hook to check only staged files. Fail if errors exist in files being committed.
Resolving commits: eb3846e

### DEFECT-0069
Title: GDPR data export silently truncates at 1,000 records per entity
Severity: P1
Status: FIXED
Surfaced by lenses: Red team — Angry Enterprise Buyer
Description: `server/services/gdprService.ts:76-81` applies `LIMIT 1000` to every entity query in the data export. Organizations with more than 1,000 leads, properties, or deals receive an incomplete Article 15 response without any indication of truncation.
Evidence: `server/services/gdprService.ts` lines 76-81.
Remediation plan: Remove the LIMIT or use streaming/pagination to export all records. Add record count metadata to the export.
Resolving commits: 2f66e89

### DEFECT-0070
Title: Billing routes expose financial data to all team members without permission check
Severity: P1
Status: FIXED
Surfaced by lenses: Red team — Angry Enterprise Buyer
Description: `server/routes-billing.ts` uses only `isAuthenticated` + `getOrCreateOrg` but never checks `canManageBilling` permission. Credit balances, transaction history, and subscription details are visible to all team members regardless of role.
Evidence: `server/routes-billing.ts` lines 21-66.
Remediation plan: Add `requirePermission('canManageBilling')` middleware to billing endpoints.
Resolving commits: 0c7d2ba

### DEFECT-0071
Title: Deal room endpoints lack organization-scoped access control
Severity: P1
Status: FIXED
Surfaced by lenses: Red team — Security Researcher
Description: `getDealRoomOrFail()` in `server/routes-deal-rooms.ts:43-50` queries by `id` only, with no `organizationId` filter. Any authenticated user can access, modify, and upload documents to other organizations' deal rooms by ID enumeration.
Evidence: `server/routes-deal-rooms.ts` lines 43-50.
Remediation plan: Add `organizationId` filter to `getDealRoomOrFail()`.
Resolving commits: b6f27e4

### DEFECT-0072
Title: Browser automation job endpoints lack org-scoping
Severity: P1
Status: FIXED
Surfaced by lenses: Red team — Security Researcher
Description: `server/routes-misc.ts:153-165` and `:186-195` call `getJobById()` and `cancelJob()` without checking `job.organizationId === req.organization.id`. Users can view other orgs' automation results or cancel their jobs.
Evidence: `server/routes-misc.ts` lines 153-195.
Remediation plan: Add org ownership verification before returning job data or allowing cancellation.
Resolving commits: 158e2f1

### DEFECT-0073
Title: Competitor name references ("Podolsky") still present in codebase
Severity: P1
Status: FIXED
Surfaced by lenses: Red team — Confused First-Timer
Description: 6 references to "Podolsky" (Mark Podolsky / Land Geek) exist in blind offer wizard and sidebar components, violating the project directive to remove all competitor references.
Evidence: Search for "Podolsky" in client source files.
Remediation plan: Replace all instances with generic or AcreOS-branded alternatives.
Resolving commits: 23225e2

### DEFECT-0074
Title: Security Gate red on every push since 2026-09-04 — five MEDIUM npm CVEs, and a scan whose failure could not be read
Severity: P1
Status: FIXED
Surfaced by lenses: CI verification (2026-09-05, autonomous session)
Description: `.github/workflows/security.yml` failed on EVERY run from #1468
(`7e6d53c4`, 2026-09-04 05:05) onward. Last green: #1467 (`deaa5191`,
2026-09-02 19:04) — 37 consecutive failures spanning every push to main in
between. The failing job was "Trivy Filesystem & Secret Scan"; npm audit,
CodeQL and the container scan were green throughout.

TWO DEFECTS, and the second is the one that cost the two days.

**(a) The finding.** Five MEDIUM npm advisories against transitive
dependencies, all with fixes published:

| Package | Installed | CVE | Fixed in |
| --- | --- | --- | --- |
| `@xmldom/xmldom` (via `mammoth`, `@capacitor/cli`→`plist`) | 0.8.13 | CVE-2026-83610 — XML fragment injection via invalid EntityReference serialization | 0.8.15 |
| `fflate` (via `posthog-js`) | 0.4.8 | CVE-2026-45820 — DoS via crafted ZIP archives | 0.4.9 |
| `fflate` (via `jspdf`) | 0.8.2 | CVE-2026-45820 — same | 0.8.3 |
| `qs` (via `express`, `body-parser`, `supertest`→`superagent`) | 6.15.2 | CVE-2026-82417 — DoS in `stringify` | 6.16.0 |
| `qs` | 6.15.2 | CVE-2026-82562 — DoS via array-limit bypass | 6.16.0 |

The fs job's declared policy is CRITICAL,HIGH,MEDIUM; `npm audit` in the same
workflow gates on critical/high only. That difference is the whole reason one
job was red while the other was green, and it is by design — not a bug.

NOTHING IN THE REPO CHANGED. `package.json` and `package-lock.json` are
byte-identical between `deaa5191` (green) and `7e6d53c4` (red) — `git diff
deaa5191..7e6d53c4 -- package.json package-lock.json` is empty, and all three
packages last moved in the lockfile on 2026-07-16 (`51b2efa1`). The gate
flipped because the trivy vulnerability DB learned these CVEs on 2026-09-03/04.
A vulnerability gate is *supposed* to be able to go red without a commit; that
is the point of it. Which makes (b) the real defect.

**(b) The failure could not be read.** The gating step writes SARIF to a file
and exits 1. It prints NOTHING about what it found. The only route to the
finding was the code-scanning UI, which returns 403 "Resource not accessible by
integration" to a token, so for two days the answer to "why is security red"
was unavailable to anyone reading the log. That is precisely the state
`.trivyignore`'s own header exists to prevent: "a permanently-red Security Gate
trains everyone to ignore it, so we keep the gate GREEN and document each
exception here instead." You cannot document an exception you cannot read.

The fix for (b) already existed — on the OTHER job. The container scan got a
non-gating findings table on 2026-07-08, with a comment giving exactly this
reason ("every gate failure sent someone spelunking the code-scanning UI").
Whoever wrote it fixed the job in front of them; the sibling job four sections
down the same file, running the same action in the same silent mode, was never
touched, and it is the one that went red for 37 runs. Third law: a gate proves
its property only over the population it actually reads, and that population
was one job because a human enumerated it from memory.

Evidence: GitHub Actions workflow 245389657, runs #1467 (success) → #1468…#1504
(failure). Reproduced locally with Trivy built from source
(`GOEXPERIMENT=jsonv2 go install github.com/aquasecurity/trivy/cmd/trivy`),
run with the gating step's exact flags —
`trivy fs --scanners vuln,secret,misconfig --severity CRITICAL,HIGH,MEDIUM
--exit-code 1 .`:

- on the unmodified lockfile: **exit 1**, `Total: 5 (MEDIUM: 5, HIGH: 0, CRITICAL: 0)`
- after the overrides below: **exit 0**, 0 vulnerabilities / 0 secrets / 0 misconfigurations

Secret and misconfig scanners were clean at ≥MEDIUM in both runs, so the five
npm advisories were the entire cause.

Remediation plan (all applied):
1. Three `overrides` entries in `package.json` — `qs: ^6.16.0`,
   `@xmldom/xmldom: ^0.8.15`, and nested `posthog-js → fflate: ^0.4.9` /
   `jspdf → fflate: ^0.8.3`. The fflate override is nested deliberately: a
   single global `fflate: ^0.8.3` would drag `posthog-js` across a 0.4→0.8
   boundary to fix a CVE that 0.4.9 already fixes.
2. A non-gating findings table in the trivy-fs job, mirroring the container
   job's — same scanners, same severity set, so it cannot print "no findings"
   on a red job.
3. `tests/unit/aGatingScanCanBeRead.test.ts` — enumerates every trivy-action
   step in every workflow, and requires each GATING step (`exit-code: 1`) to be
   preceded in the SAME JOB by a readable one (`format: table`, `exit-code: 0`)
   that is at least as wide in severity, scanners and scan-type. Falsified
   against four mutations (remove the table; narrow its severity; drop a
   scanner from it; make it gating) — each turns the suite red. A third scan
   job added later without a table is what fails here.

Resolving commits: see `fix(security)` for the gate returning green,
2026-09-05.

### DEFECT-0075
Title: `PATCH /api/buyer-blasts/recipients/:id` with an empty body was a 500 — and 27 more write paths could reach the same malformed SQL
Severity: P2
Status: FIXED
Surfaced by lenses: type-aware program analysis (2026-09-06, autonomous session)
Description: Drizzle DROPS undefined values from `.set()`, so a patch whose
every value is undefined renders the identical statement as `.set({})`:
`update "t" set  where …` — nothing between SET and WHERE. Postgres rejects it
as a syntax error.

On `PATCH /api/buyer-blasts/recipients/:id` that was live and client-reachable:
both fields of the route's Zod schema are `.optional()`, so `{}` parses clean,
and unlike its sibling routes the patch carried no unconditional `updatedAt`.
An authenticated owner sending an empty body got a 500 whose message was about
SQL grammar.

A program-wide pass then found 27 further writes that could reach the same
state — 25 storage-repo methods taking `Partial<Insert>` from callers this pass
cannot see, and 2 locally-constructed patches with no guaranteed field.

WHY GREP COULD NOT HAVE FOUND THIS: the obvious predicate — "the argument is
typed all-optional" — matches essentially every Drizzle patch in the codebase,
and over a thousand of them are perfectly safe because the object that reaches
`.set()` carries an unconditional `updatedAt: new Date()`. The useful question
is the runtime one: can the OBJECT that reaches `.set()` be empty of defined
values? Answering it means resolving each argument to the object literal that
produces it and looking for one property whose value expression cannot be
undefined (spreads guarantee nothing; conditional `obj.x = …` guarantees
nothing).

Evidence: over 1,541 files and 1,131 update-writes — 1,098 safe by
construction, 27 unclearable, 6 resting on an `any`, 0 unresolved. The
rendering mechanism is pinned independently through Drizzle's own PgDialect in
`tests/unit/emptyUpdateIsNotAStatement.test.ts`.

Remediation plan (all applied):
1. `server/utils/patch.ts` — `hasWritableValues` (for routes, which answer 400)
   and `assertWritablePatch` (for internal paths, which throw).
2. The live route answers 400 and issues no statement.
3. All 27 internal writes guarded AT THE CALL —
   `.set(assertWritablePatch(patch, "table.method"))` — so the guard cannot
   drift from the write it protects. Throwing is not a regression: the
   malformed statement already threw, from Postgres, several layers from the
   caller; the guard moves the throw to the call site and names it.
4. `scripts/check-empty-update-set.mjs`, wired into `npm run check`, holding at
   zero, with asserted population floors and an explicit heap ceiling (its
   sibling `check-ghost-fields.mjs` was found OOMing at Node's default on
   2026-08-25, silently reporting fewer findings than existed).
5. `tests/unit/emptyPatchIsNotAnUpdate.test.ts` — the route's 400, that no
   statement is issued, the helpers' semantics (`null` is NOT empty: `set x =
   null` is well-formed and meaningful), and the gate's wiring.

Falsified against five mutations, each asserted to have landed before its
verdict was read: strip a repo guard, strip the route's 400, add a new
unguarded write, unwire the gate, drop its heap ceiling. All five red.

Resolving commits: `17681ffa`.

---

### DEFECT-0076
Title: The status vocabulary was derived from filters, so it omitted four values production writes — and ~25 filters named values nothing writes
Severity: P1
Status: FIXED
Surfaced by lenses: type-aware write analysis + vocabulary cross-check (2026-09-06, autonomous session)
Description: `shared/lifecycle/pipeline-status.ts` was created (2026-07, W3.4)
from an audit of FILTERS — "filters on deal status 'won' and lead status
'active' that matched NOTHING, silently zeroing metrics." Reading filters tells
you which values are USED; it cannot tell you which values EXIST. Walking every
WRITE instead (49 `db.update(leads|deals).set()` / `.insert().values()` sites)
found four the vocabulary had never heard of, one of which that file's own
header asserts "is never written":

| Value | Written by | Consequence |
| --- | --- | --- |
| `deleted` (leads) | `leadRepo` soft delete ×2 | outside every projection |
| `deleted` (deals) | `dealRepo`, `propertyRepo` | counted as ACTIVE by the live KPI stream |
| `archived` (leads) | `crmEnhancements` 90-day sweep | invisible to every funnel counter |
| `active` (leads) | `autonomousDealMachine` Deal-Hunter enrolment | invisible to the stale-lead sweep, the funnel, and the transition table |

THE WORST CONSEQUENCE WAS CUSTOMER-FACING. `customerNarrative.buildSummary`
counted `status = 'closed_won'` / `'closed_lost'` — neither is a deal status —
so every customer's monthly narrative read "Deals won: 0, lost: 0" while
reporting every deal ever, closed ones included, as still "in pipeline". The
copy renders those numbers verbatim.

THE SECOND WORST WAS A CORRECTION TO MY OWN ANALYSIS.
`sellerMotivationEngine.rescoreLeadsForOrg` selects `eq(leads.status,
"active")`, which I first recorded as the documented "matched nothing" shape.
It matched: `active` is what the Deal Hunter writes. So the function ran, on
precisely the auto-enrolled leads, and overwrote the real motivation score the
Deal Hunter had just computed with one derived from `isTaxDelinquent: false,
assessedValue: 0, ownershipYears: 0` — every signal it needs lives on the
lead's PROPERTY and it never joins. Not inert: actively replacing measurements
with a constant.

Approximately 25 further comparisons named values a row cannot hold. The ones
that changed behaviour rather than merely reading wrong:

- `agentInitiativeEngine` proposed "deal going cold" on deals that had CLOSED
  a fortnight earlier (`NOT IN ('closed_won','closed_lost','cancelled')`).
- `outcomeVerificationLoop` — which feeds agent trust evolution — could never
  reach its "risk flag was premature" verdict, reported a closed deal as
  "still active at closed", and scored a lead that REPLIED as unchanged
  (its positive set named `offer_sent`, a deal status, while `responded` and
  `negotiating` were absent).
- `dealFeedEnhancements` "find similar to wins" had no wins to learn from and
  returned `[]` for every organization.
- `negotiationEnhancements` close-rate numerator was structurally zero; its
  denominator (`!= 'new'`, a LEAD status) was always true.
- `kpiStreamingService` counted soft-deleted deals as active.
- `agent-skills` had an unreachable +20 "motivated seller" branch.
- `leadScoring`'s prior-response check reduced to `contacted`, which means WE
  reached out, not that they replied.
- `cohortAnalysis` mislabelled a funnel tier "Offer Sent" — a lead has no
  offer-sent state — and the tier's membership excluded `responded`,
  `interested`, `qualified` and `accepted`.

Evidence: 1,541 files / 49 lead-deal write sites / 63 off-vocabulary read
literals before, 43 after (the remainder are false positives of a line scanner:
`leadType: ["seller"]`, `outcome: "positive"`, a `deal_status` context key).
Four values were also spelled BARE inside raw SQL (`status = 'closed_won'`
without the table prefix) and were outside the first scan's population
entirely — which is where `customerNarrative` and `kpiStreamingService` were
hiding.

Remediation plan (all applied):
1. `autonomousDealMachine` writes `new`, the canonical status for a freshly
   created lead. `archived` and `deleted` are enumerated as
   `ADMINISTRATIVE_*_STATUSES` — deliberately OUT of the funnel lists, because
   membership there means "a status change may target this" and nothing should
   be able to PATCH a lead to `deleted`. `active` and `closing` are recorded as
   legacy: readable so historical rows keep counting, never writable again.
2. `rescoreLeadsForOrg` refuses (the route answers 501) until the property join
   exists.
3. All ~25 comparisons derive from canonical projections —
   `TERMINAL_LEAD_STATUSES`, `ENGAGED_LEAD_STATUSES`,
   `NEGOTIATING_LEAD_STATUSES`, `UNDER_CONTRACT_LEAD_STATUSES`,
   `ACTIVE_DEAL_STATUSES`, `CLOSED_DEAL_STATUSES`, `RESOLVED_DEAL_STATUSES`,
   `ALL_FUNNEL_DEAL_STATUSES`, `ADMINISTRATIVE_*` — each with real production
   adoption. Aggregate CASE expressions keep their SQL but interpolate the
   values as bound parameters via `sql.join`.
4. `scripts/check-status-vocabulary.mjs`, wired into `npm run check`, holds the
   WRITE side at zero. Only the write side is gated: the read side's false
   positives would switch the gate off within a day.
5. `tests/unit/agentStatusWritesUseTheVocabulary.test.ts` plus four existing
   tests UPDATED to the new truth rather than deleted — including
   `dealStatusVocabularyIsCanonical`, which already enforced part of this and
   went red on the fix because its regex compared the SPREAD TEXT
   `...CLOSED_DEAL_STATUSES` against the vocabulary.

Resolving commits: `30904f0a`, `dbf92a40`, `d69f5152`.

---

### DEFECT-0077
Title: `stripComments` — the helper 91 gates depend on — blanked live code in 232 of 3,692 files
Severity: P1
Status: FIXED
Surfaced by lenses: gate self-audit (2026-09-06, autonomous session)
Description: `tests/helpers/stripComments.ts` was written to end a specific
class of bug — the two-regex idiom, which eats whole files when a line comment
contains `/*`. Its replacement, a single left-to-right scan understanding
strings, templates and comments, had the same class for a construct it did not
know about: A REGEX LITERAL IS NOT A STRING.

    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);

Three double quotes. The scan opened a string at the third and ran to the next
`"` anywhere in the file — swallowing every comment marker it crossed (so
comments SURVIVED unstripped) and treating live code as string (so it was never
examined).

Measured: 232 of 3,692 source files ended the strip mid-token.
`server/ai/supportAgent.ts` — the 91-case dispatch switch CLAUDE.md names as a
load-bearing population, driven by a model talking to a paying customer — lost
15,762 characters. Ninety-one test files import this helper, so each was
scanning a corrupted view of any target containing such a regex.

CLAUDE.md already names this class and records that it was paid for once: "a
REGEX LITERAL holding a quote did the same — and did it inside `maskComments`
itself." The canonical replacement written to end that class had it too.

HOW IT WAS FOUND: not by reading the helper. A new gate
(`check-status-vocabulary.mjs`) reported two offenders that were the comment
explaining the fix, and bisecting which line put the scanner into a bad state
led to the regex at line 57 of that same gate.

Evidence: canary measurement — append `\n// SENTINEL\n` to each source file and
strip; if the sentinel survives, the scan finished inside a string, template,
regex or comment. 232 files before, 0 after. File length is unchanged for all
3,692 (comments become spaces, so offsets are preserved).

Remediation plan (all applied):
1. The helper PARSES with TypeScript rather than lexing by hand. Teaching the
   scan about regexes was tried and abandoned after it refused 720 files: `/`
   versus division needs the previous significant token; TypeScript's postfix
   `!` (`cac.cacUsd! / n`) inverts that rule; `[...]` classes make `/[/*]/`
   both a valid regex and a block comment; nested `${}` needs a depth stack;
   and JSX is full of slashes no expression lexer gets right. The parser has
   resolved all of it already in order to build a tree.
2. Script kind is decided by parsing both ways and keeping whichever produced
   fewer diagnostics — forcing TSX on a `.ts` turns `db.select<Row>()` into an
   unclosed JSX element; forcing TS on a component breaks every `<Foo />`.
3. Parsing costs 5.7ms per file against ~0.1ms. The helper memoizes (pure,
   bounded at 4,096, oldest-first) and `orgScopedDbAdoption` — which swept
   2,600 files five times and hit vitest's 30s ceiling — strips once. Second
   pass over 2,543 files: 13.4s → 9ms.
4. `tests/unit/stripCommentsIsALexer.test.ts` — one fixture per trap, plus two
   repo-wide floors asserted at ZERO (never ends mid-token; never changes a
   file's length). Falsified against the previous implementation: four red,
   including the floor.

Resolving commits: `c9220cb4`.

---

### DEFECT-0078
Title: The borrower late-fee path charged under a ten-day grace period the note does not contain
Severity: P1
Status: FIXED
Surfaced by lenses: measurement-defaults gate, once DEFECT-0077 made the file readable (2026-09-06)
Description: `server/routes-borrower.ts:935` and `:1077` — the two payment-post
handlers — computed `const gracePeriodDays = note.gracePeriodDays ?? 10` and
passed it to `computeAppliedLateFeeCents`. A note whose record states no grace
period was therefore assessed under a ten-day clause it does not contain.

Ten days is invented in the borrower's favour; zero would be invented against
them. Neither is a term anyone agreed to, and this code takes money.

The repo had already reasoned the asymmetry out, and these two sites were
outside the population that enforced it:

- `acquiredNoteAging.ts:291` measures an unstated term as ZERO, deliberately,
  because an internal aging signal can be re-derived — and it LOGS the
  assumption (`note_grace_period_unstated`).
- `routes-documents.ts:23` and `services/documents.ts:164` decline to state a
  term at all in a generated instrument, because a signed document cannot be
  re-derived. Both read the canonical `noteGracePeriodDays` resolver.

An APPLIED FEE is the second kind, not the first: money, recorded, shown to the
borrower, not re-derivable.

WHY IT WAS INVISIBLE: `lint:measurement-defaults` exists to catch exactly this
shape and had never seen these lines. Its comment masker was the two-regex
idiom, and `routes-borrower.ts` is the file CLAUDE.md already names as the one
that idiom "swallowed 3,000 lines of". The gate went red the moment DEFECT-0077
made the file readable — no new rule, no new scan, the same gate over the
population it was always supposed to have.

Evidence: `[measurement-defaults] FAIL — a value read from a data source is
being replaced by a plausible constant`, naming both lines, immediately after
`scripts/lib/strip-comments.mjs` was made parser-based.

Remediation plan (applied): both sites resolve through `noteGracePeriodDays`.
When the record states no term there is no late fee to apply, and the skip is
logged (`note_late_fee_skipped_grace_unstated`) the way the aging sweep logs
its assumption. The change can only ever REDUCE a fee charged, never increase
one.

FOLLOW-UP, same class, three more sites — and both were already in the
measurement-defaults BASELINE, registered as accepted rather than fixed:

- `server/services/achAutopay.ts:1193` — the same invented ten-day clause, in
  an UNATTENDED autopay settlement. Strictly worse than the two above, which at
  least sit behind a request someone made.
- `server/services/cashFlowForecaster.ts` ×3 — `note.gracePeriodDays || 10`,
  where `||` fires on ZERO, so a note explicitly granting NO grace was forecast
  as if it granted ten days.

So the codebase held THREE answers to one question: 0 in the aging sweep,
"decline to state" in the instruments, 10 in the fee paths and the forecaster.
The forecaster is an internal signal and now takes the aging convention; the
autopay path is money and now refuses. The two baseline entries are removed
rather than kept — a register of accepted constants is only trustworthy if the
things in it were examined.

Resolving commits: `3c95369a`, `8192e1f8`.

### DEFECT-0079
Title: Nine hand-rolled comment strippers — the gate written to stop them forbade one spelling
Severity: P1
Status: FIXED
Surfaced by lenses: follow-up to DEFECT-0077, measured 2026-09-06
Description: DEFECT-0077 replaced the two-regex comment-stripping idiom with one
parser-based helper and installed `stripCommentsIsALexer.test.ts` to stop the
idiom returning. That gate forbade a STRING — the block-comment regex — and was
green while 42 test files and 7 lint scripts stripped comments with EIGHT other
hand-rolled spellings it had never been written to see. This is the third law
applied to a gate's own vocabulary: the population is not just which files it
reads, it is which SPELLINGS it recognises.

Measured against the canonical strip over 2,588 source files:

| spelling | used by | disagrees | ends mid-token |
|---|---|---|---|
| line-based, no guard | 1 test | 336 | 0 |
| line-based, structural guard | 31 tests | 293 | 0 |
| hand-rolled lexer, no regex branch | 3 tests | 382 | **153** |
| line comments only | 2 tests | 2,296 | 0 |
| block+line, no string state | 1 test | 514 | 0 |
| the unhardened `maskComments` | **5 scripts in `npm run check`** | 168 | **150** |
| the two-regex idiom | `audit-public-claims.ts`, `voice-lint.mjs` | — | — |

Two of those deserve naming. `check-browser-safe-shared.mjs` and
`check-kernel-boundary.mjs` carried the PRE-HARDENING `maskComments` — no
regex-literal branch, no nested-template handling — i.e. exactly the masker
CLAUDE.md records as already paid for once, still running inside the unified
gate. And `scripts/audit-public-claims.ts`, the OD-5 public-claim audit, still
ran the two-regex idiom over the live landing surface.

Evidence: `tests/unit/stripCommentsIsALexer.test.ts` (the widened gate),
`tests/helpers/handRolledStripper.ts` (the three-arm detector).
Remediation plan: Done. All 49 sites now import one of two canonical
implementations (`tests/helpers/stripComments.ts` for tests,
`scripts/lib/strip-comments.mjs` for lint scripts), plus one shared YAML
stripper (`tests/helpers/stripYamlComments.ts`) for the three workflow gates —
YAML is not TypeScript and the canonical parser cannot read it.

The gate is now about the SHAPE of a comment stripper, over `tests/` + `scripts/`,
with three independent arms and a per-arm falsification fixture:

- **named** — any function whose name mentions comments and is not a predicate.
  This arm was FIRST WRITTEN AS A VERB ALLOWLIST and its own falsification
  caught it: `function purgeComments` left the gate green, because "purge" was
  not on the list and the fixture had used a verb that was. A spelling gate
  wearing a shape gate's clothes, found only because the mutation was actually
  run.
- **delimiter-literals** — block-delimiter index surgery under any name.
- **delimiter-regex** — a regex matching ANY block comment (a regex matching one
  PARTICULAR comment is not one; that distinction is what keeps the arm off the
  dozens of honest globs and JSX-comment assertions in the repo).

All three parse the AST and never visit a comment, so the fourth law's failure
mode is structurally absent rather than defended against. Exemptions live in a
register keyed on file + function, each asserted to still resolve.

What it did NOT find: after migration, all 42 gates and all 7 scripts produce
byte-identical output. The corrupted view was latent, not a live false green —
worth saying plainly, because the honest result of a hunt is sometimes that the
hole had not yet been fallen into.

Resolving commits: pending

---

### DEFECT-0080
Title: The parser-based stripper timed out eight repo-wide gates on main — green locally, red in CI
Severity: P1
Status: FIXED
Surfaced by lenses: the main-push run enumeration, 2026-09-06
Description: The DEFECT-0077 rewrite traded a ~0.1ms scan for a ~4.5ms parse per
file. That is the right trade — a fast wrong answer is what it exists to stop —
but eight gates sweep every source file in the repository, and on the push of
`b7d4fa21` all eight crossed vitest's 30s default at once. Every one of them had
passed locally. CI was green on the three preceding `main` SHAs, so the cause is
not in doubt.

The failure mode is the one that matters: a gate that times out is a gate that
has stopped reporting, and it reports as a red suite rather than as a silent
hole — but only because someone enumerated the runs. The branch workflows do not
run `CI`; this was visible only in the full main-push enumeration CLAUDE.md
mandates.

Three fixes, none of them "raise the global timeout":

1. `stripComments` no longer walks the tree. The parse is kept — it is what
   resolves regex-versus-division, JSX and nested templates — but only to answer
   where the LITERALS are; outside a string, template chunk, regex or JSX text a
   comment opener can be nothing else, and `*` cannot begin a regular expression,
   so one linear scan finds every comment. `getChildren()` was two thirds of the
   cost. 4.5ms → 2.7ms per file.
2. The tree-walking version is KEPT as `stripCommentsReference` and the two are
   pinned against each other on a 250-file sample of the real repository. A fast
   path with no slow path to disagree with is a fast path nobody can check.
   Verified once over all 3,681 files: zero disagreements, zero length changes.
3. Repo-wide sweeps declare their own budget (`REPO_SWEEP_TIMEOUT_MS`) instead of
   the whole suite loosening to accommodate them, and this gate's own two sweeps
   became one — the canary is appended first, so a single strip per file answers
   both "did the scan run off the end" and "did it move any offset".

Evidence: run 34022731609, job 101458168024 — 8 tests, `Test timed out in 30000ms`.
Remediation plan: Done.
Resolving commits: pending

### DEFECT-0081
Title: A borrower who opened a second checkout and paid the first lost the payment — the webhook checked recency, not ownership
Severity: P1
Status: FIXED
Surfaced by lenses: DEFECT-0058 verification pass, 2026-09-06
Description: `WebhookHandlers.processBorrowerPortalPayment` authorized a
completed Stripe checkout by comparing `session.id` to
`notes.pending_checkout_session_id`. That column is a ONE-SLOT CACHE:
`routes-borrower.ts:764` and `:854` overwrite it on every "Pay" click. A
borrower who opened a second checkout — browser Back and retry, or a re-click
during the cross-origin navigation, both of which the portal permits because
`setIsProcessingPayment(false)` runs after `window.location.href` — and then
completed the FIRST one arrived with a session id the note no longer named. The
handler returned. No payment row, no balance reduction, no schedule mark, no
receipt, no retry.

That is not a lost record, it is a lost PAYMENT. Under the founder ruling of
2026-07-29 ("be the rail, not the provider") the charge is a direct charge on
the LENDER's own connected processor; AcreOS never sees the money and its
ledger is the lender's only account of it. Nothing reconciles it back. The
borrower's next statement still shows the amount due and delinquency advances
against someone who has paid.

The browser return (`/api/borrower/verify-payment`) records the payment
idempotently and does NOT consult the pending slot, so the happy path was
covered. This bit exactly the population a webhook exists for: the borrower who
closed the tab, lost the redirect, or whose 24-hour portal session expired
mid-checkout.

The registry's DEFECT-0058 remediation plan (`SELECT FOR UPDATE` before creating
a session) would not have fixed it. Serializing two writes still leaves one slot,
and the borrower legitimately has two open sessions — Stripe keeps them alive for
24 hours.

**A TEST PINNED THE DEFECT AS THE CONTRACT.** `stripeWebhooks.test.ts` Task #77,
"rejects borrower payment if session ID does not match", asserted exactly this
behaviour and passed. Per CLAUDE.md wave discipline the assertion was rewritten
rather than deleted: the invariant it was reaching for — a session that does not
belong to this note must not be recorded — survives, now checked against
OWNERSHIP rather than recency.

Second finding, same handler: `noteId` was destructured from the session
metadata at line 1520 and **never compared to `note.id`**. The one-slot check was
the only thing standing between a signed event naming one note and a credit to
another. The replacement is therefore strictly stronger than what it replaces,
not merely different.

Third finding, sibling path: `POST /api/borrower/verify-payment` resolves the
note from the authenticated borrower session but takes `sessionId` from the
request body, and checked only that SOME session on the lender's connected
account was paid. `payments.transaction_id` is globally unique (migration
0023 `payments_transaction_id_unique`), so the first note to record a session id
is the only one that ever can: a caller supplying another borrower's session id
on the same lender would credit their own note and permanently block the real
one. Exploiting it needs an unguessable `cs_…` id, so this is defence in depth
rather than an open door — and it is two lines.

Evidence: `server/webhookHandlers.ts:1535` (before), `server/routes-borrower.ts:1078` (before).
Remediation plan: Done. Ownership is checked against the metadata AcreOS itself
wrote in `buildBorrowerCardCheckoutParams` and Stripe signed back; the pending
slot is cleared only when it still names the completing session, so finishing an
older checkout cannot wipe the pointer to a newer open one. Absent metadata is
accepted rather than refused — a guard that refuses on missing evidence would
turn a hardening change into an outage for anyone mid-checkout at deploy time,
and that case is asserted.

Falsified: five mutations, each turning a different test red — restore the
one-slot check; disable the note-ownership check; clear the slot
unconditionally; disable the verify-payment check; make the verify-payment check
refuse on absent metadata.
Resolving commits: pending

### DEFECT-0082
Title: Three fabrications on the buying surface — an invented parcel outline, a county vintage we never had, and mail to people who opted out
Severity: P1
Status: FIXED
Surfaced by lenses: the 18-defect verification fan-out, 2026-09-06
Description: Three separate findings, one standing decision: *"Fabrication is
never acceptable: no invented numbers, no fake activity, no placeholder data
presented as real."* Two of them sit on the screen a land investor decides from.

**(a) An invented parcel outline** (was DEFECT-0066). `properties.tsx` fell back,
when a property had no `parcel_boundary`, to an axis-aligned square 0.003 degrees
to a side — roughly a hundred acres — centred on the GEOCODE, and handed it to
`<PropertyMap>` as that property's boundary. It drew in the same layer, colour
and weight as every real boundary beside it. It is not an approximation of the
parcel: it has no relationship to the lot's shape, frontage or buildable area,
and it appears exactly where someone is most likely to be deciding from it —
straight after a CSV import, before the parcel lookup has run.

The registry entry's claim that it was indistinguishable from an AUTHORITATIVE
polygon was checked and is wrong: `property-map.tsx` defaults to dashed whenever
provenance is unknown, and `properties.tsx` passes no provenance, so nothing on
that page renders as county-GIS. The defect is narrower and still real — a shape
we made up, rendered identically to every shape we did not.

`maps.tsx` had already settled this correctly and said so in a comment. It also
carried a DEAD honesty flag: it passed `isApproximate`, the component reads
`approximate`, so it never reached `PropertyBoundary`. Removed rather than
corrected — the corrected version would mark a real boundary as
non-approximate, i.e. SOLID, which is the component's claim of county-GIS
provenance, and `properties.parcel_boundary` stores no provenance to back it.

**(b) A county vintage we never had** (was DEFECT-0064). The Assessed Value and
Annual Taxes chips were `classification="authoritative"` and took their
`sourceAsOf` from `parcelData.lastUpdated`, which `server/services/parcel.ts`
sets to `new Date()` at fetch time (six sites). So the page rendered "County
assessor · as of Sep 6, 2026" with the authoritative dot, asserting the county's
record was current as of today, when the assessment roll behind the number is
typically a prior tax year and a deed recorded last week does not appear at all.
`enrichedAt` and `updatedAt` are no better — both are when AcreOS touched the
row. The footer's "Parcel data last updated" said the same thing in prose.

The Est. Value chip was one element with THREE separate ternaries — source,
vintage and classification each conditional on the same guard. That shape is
what hid it, and it is now two chips: ours can say when we made it
(`enrichedAt` is exactly the vintage of an AcreOS estimate), the county's says
nothing it cannot support.

**(c) A letter to someone who opted out** (was DEFECT-0065). A seller texts
STOP; `handleInboundOptKeyword` sets `doNotContact` + `optOutDate` and writes a
consent-revocation record naming `direct_mail` among the revoked channels
(`smsService.ts:472`, `tcpaCompliance.ts:353`). `preMailDedupe.ts:105` honours
it. `resolveAudience` in `routes-outreach-mail.ts` — the compose tab's lane,
which quotes, debits the mail pool and writes the `mail_shipment_pieces` that
`mail_flusher` hands to Lob half an hour later — read neither column. So the
org's own audit trail said the seller had revoked physical mail while a second
door in the same product printed and delivered one.

The fix is deliberately the SAME rule `preMailDedupe` already applies, so the
two mail doors agree rather than inventing a third semantics, and `IS NOT TRUE`
rather than `= false` because the column is nullable — `= false` would silently
empty the audience.

Evidence: `client/src/pages/properties.tsx:688` (before), `:1698`/`:1968`/`:2038`
(before), `server/routes-outreach-mail.ts:156` (before).
Remediation plan: Done, with three gates, each falsified:

- `parcelOutlinesAreNotInvented.test.ts` — population DERIVED from the files that
  render `<PropertyMap>`, so a fourth page joins by existing. Walks the AST, so a
  type annotation naming "Polygon" and a comparison against it are never visited.
  Falsified on the original spelling, on an equivalent representation
  (MultiPolygon), and on the POPULATION (renaming the page out of the derived set
  turns it red rather than green).
- `mailAudienceHonoursOptOut.test.ts` — renders the predicate the handler builds
  through drizzle's own dialect and reads the SQL Postgres will run, not the
  source text. Falsified by removing the conditions, by the nullable trap
  (`= false`), and by the MENTION TRAP: conditions built into a dead local so the
  file still names both columns. A source-scanning gate passes that third one.
- `authoritativeChipsHaveARealVintage.test.ts` — asserts its own PREMISE from
  `parcel.ts` (that `lastUpdated` really is a wall-clock stamp), so if that ever
  becomes a real county date the gate fails and the ban gets deleted rather than
  quietly outliving its reason. Falsified on the original clock, on an equivalent
  clock, and on the premise.
Resolving commits: pending

### DEFECT-0083
Title: The voice linter died on main — a gate migrated onto a dependency the workflow never installed
Severity: P1
Status: FIXED
Surfaced by lenses: the main-push run enumeration for `33ff7915`, 2026-09-06
Description: DEFECT-0079 migrated `scripts/voice-lint.mjs` off the two-regex
comment idiom and onto the shared parser-based stripper. That stripper imports
TypeScript. `voice-lint.yml` runs `node scripts/voice-lint.mjs --all` on bare
Node with no install step, and says so in a comment: *"The linter is
dependency-free (pure Node + fs/regex) — no npm install needed, which keeps this
gate fast (<10s)."* The workflow died on `ERR_MODULE_NOT_FOUND: Cannot find
package 'typescript'`.

The linter therefore did not run at all on the copy it exists to police, and it
had no way to say so beyond a red X on a workflow that only fires on `main`.

Three things are worth recording.

**It was invisible until `main`.** `voice-lint.yml` has `on: push: branches:
[main]`. The three branch workflows are all green on the same tree. This is the
population CLAUDE.md already names — *"enumerate EVERY workflow run for the SHA.
Not the three you know about"* — and it is the second time in two days that rule
has been the only thing standing between a broken gate and a green report.

**My own measurement of the blast radius read a comment as code.** Checking which
workflows ran a migrated script without installing, `grep -cE "npm ci|npm install"`
returned 1 for `voice-lint.yml` — matching the comment that says *no npm install
needed*. The fourth law, inside the investigation of a fourth-law defect.

**A silent fallback was rejected.** Making the stripper use the parser when
present and regexes otherwise would have kept the workflow dependency-free and
fast. It would also mean a gate that quietly changes what it can see depending
on whether a package resolved — the same shape as the DNC provider that
collapsed to "no vendor configured" and passed every number. The workflow takes
the install and the extra ~30s instead.

Evidence: run 34031073240, `ERR_MODULE_NOT_FOUND ... imported from
/home/runner/work/AcreOS/AcreOS/scripts/lib/strip-comments.mjs`.
Remediation plan: Done. `voice-lint.yml` gains `npm ci` (with npm caching) and a
timeout raised 3 → 8 minutes to cover it; the stale "dependency-free" comment is
replaced by the trade it now makes.

Gated by `workflowScriptsHaveTheirDeps.test.ts`, which follows each workflow
step's `node scripts/<x>` through that script's imports TRANSITIVELY and requires
an install step whenever the graph reaches a bare specifier. Following the graph
is the point, and it is asserted: `voice-lint.mjs` imports nothing external
itself and reaches TypeScript one hop away, so a walk that read only the entry
file would report zero and pass over the defect. Falsified by removing the
install step, and by the COMMENT TRAP — `npm ci` present only in prose, which a
naive scan accepts.
Resolving commits: pending

### DEFECT-0084
Title: The sweep budget went to the six gates that failed, not the forty-eight that sweep
Severity: P1
Status: FIXED
Surfaced by lenses: the main-push run enumeration for `33ff7915`, 2026-09-06
Description: DEFECT-0080 fixed eight repo-wide gates that crossed vitest's 30s
default after the stripper became a parser. The fix gave `REPO_SWEEP_TIMEOUT_MS`
to the SIX TESTS THAT HAPPENED TO FAIL. Measured now, 48 test files sweep the
repository with the shared stripper — the other 42 kept the default.

So the next push to `main` failed the same way with a DIFFERENT four:
`assignedLeadGateCoverage`, `credentialRedactionSingleOwner`,
`errorIsNotEmptiness`, `formatCentsIsCanonical`. Same cause, new victims — and
the victims move because the failing step is `npm run test:coverage`, the same
suite under V8 instrumentation, which is slower than the plain `vitest run` that
passed 1054/1054 in the very same job.

This is the third law about a fix rather than a gate: a remedy applied to the
members that failed is a remedy over the population of failures, not over the
population of the defect. The first version could only ever have held until the
next scheduling accident.

The failure mode is what makes it worth a P1 rather than an annoyance. A timeout
is not a bug report — it is the suite deciding a gate is no longer worth waiting
for. The gate then reports nothing about the thing it guards, and reports it in
the same shape as a gate that has nothing to report.

Evidence: run 34031073238, job 101480560446 — `npm run test:coverage`, 4 failed
| 1050 passed, all four `Test timed out in 30000ms`; the plain `npx vitest run`
step in the same job: 1054 passed.
Remediation plan: Done. The population is DERIVED — imports
`../helpers/stripComments` AND walks a directory — and all 48 now carry
`vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS })` beside a note saying why.

Gated by `repoSweepsDeclareTheirBudget.test.ts`, which re-derives that set and
requires the declaration. Falsified three ways, because this defect was itself a
population error and the gate for it must not repeat one:

1. a sweeping gate drops its declaration -> red;
2. `REPO_SWEEP_TIMEOUT_MS` is lowered to the suite default while every
   declaration stays in place -> red (the rule is about the VALUE, not the
   presence of the identifier);
3. the detector stops recognising sweeps -> red, rather than passing over an
   empty set.

Footnote on the fix's own verification: the annotation script added a SECOND
helper import to the six files that already had one, and `npm run check` caught
it — `NPM_RUN_CHECK_EXIT=1`, 172 > baseline 160. That is the first real use of
the exit-code discipline added in DEFECT-0080's wake, and under the previous
`| tail` habit it would have shipped as another false "exit 0".
Resolving commits: pending

---

## Summary Statistics

| Status | P0 | P1 | P2 | Total |
|--------|-----|-----|-----|-------|
| OPEN   | 0   | 0   | 14  | 14    |
| FIXED  | 12  | 46  | 5   | 63    |
| DEFERRED | 0 | 3   | 0   | 3     |
| **Total** | **12** | **49** | **20** | **81** |

All P0 and P1 defects resolved (fixed or justified deferral). 14 P2s remain open (plus DEFECT-0063, partially fixed)
(not blocking launch).

### Fixed Defects Summary

| ID | Title | Resolving Commits |
|----|-------|-------------------|
| DEFECT-0001 | Unauthenticated founder endpoints | 377c4db |
| DEFECT-0002 | SQL injection via sql.raw() | 377c4db |
| DEFECT-0003 | tsconfig.check.json noResolve | 1c49712 |
| DEFECT-0004 | Recursive logger shadow | 9354168 |
| DEFECT-0005 | Payment race condition | 53d38f5, 1a73fea |
| DEFECT-0006 | Stripe webhook TOCTOU | 377c4db |
| DEFECT-0007 | Credit allowance TOCTOU | 377c4db |
| DEFECT-0008 | Unsigned webhooks | 377c4db |
| DEFECT-0009 | SSRF missing await | f8c476d |
| DEFECT-0010 | Unbounded LLM tool loops | 19e942c, f8c476d |
| DEFECT-0011 | Chargebacks silently dropped | 377c4db |
| DEFECT-0012 | Destructive migration | 377c4db |
| DEFECT-0013 | CSRF middleware not applied | 5e79639 |
| DEFECT-0014 | JWT grace period 5 min | 5e79639 |
| DEFECT-0015 | FK cascades missing | eb25351 |
| DEFECT-0016 | Unbounded SELECT queries | 53d38f5 |
| DEFECT-0017 | AI credit checks unwired | a763756 |
| DEFECT-0018 | Prompt injection on 12 routes | 53d38f5 |
| DEFECT-0019 | Multi-tenant isolation broken | 5cfbf6e |
| DEFECT-0021 | Missing database transactions | 2571108 |
| DEFECT-0022 | WebSocket cross-org channels | 29462e0 |
| DEFECT-0023 | statement_timeout missing | c0b1459 |
| DEFECT-0024 | DB pool error handler missing | b945fb5 |
| DEFECT-0025 | Graceful shutdown incomplete | 2d50235, c0b1459, 515ca76 |
| DEFECT-0026 | Redis not in package.json | d7b855b |
| DEFECT-0028 | Stripe Connect nextPaymentDate | a6e509e |
| DEFECT-0029 | Refund no subscription cancel | 664d569 |
| DEFECT-0030 | Support agent cross-org | 646489a |
| DEFECT-0031 | LLM validators unused | 894b463 |
| DEFECT-0032 | provider_cache unused | 4c27079 |
| DEFECT-0033 | Render-blocking fonts | 3161de2 |
| DEFECT-0034 | Hardcoded fallback secrets | 4c4fc7f |
| DEFECT-0035 | handleQueryError never wired | de6e0d1 |
| DEFECT-0036 | Duplicate routes in App.tsx | 636afc5 |
| DEFECT-0037 | Icon buttons missing aria-label | 234f113, b0acdac |
| DEFECT-0038 | Skip link target missing | 11f64ce |
| DEFECT-0039 | Reduced motion not respected | 300ee16, d48b6a6 |
| DEFECT-0040 | Viewport blocks zoom | e7de9e8 |
| DEFECT-0041 | CI pipeline broken needs | 4688f7c |
| DEFECT-0042 | Dockerfile deletes lockfile | 4c3d8ec |
| DEFECT-0043 | Node version mismatch | 4c3d8ec |
| DEFECT-0044 | DNS check disabled in SSRF | 48bb9a4 |
| DEFECT-0045 | File upload security dead code | 8642682 |
| DEFECT-0047 | Campaign TOCTOU + no dedup | 69e2bae |
| DEFECT-0068 | Pre-commit warning-only | eb3846e |

### Deferred Defects (3)

| ID | Title | Justification |
|----|-------|---------------|
| DEFECT-0027 | 477 KB schema bundle | Splitting 14,883-line schema.ts touches 200+ imports; requires dedicated session |
| DEFECT-0046 | No file storage backend | Requires infrastructure provisioning (S3/R2); upload security now wired |
| DEFECT-0067 | 3,089 TypeScript errors | Pre-existing structural debt; pre-commit blocks regressions in staged files |

### All P0 Defects: RESOLVED

All 12 P0 defects are fixed and deployed to production (acreos.fly.dev).
9. **DEFECT-0012** -- Destructive migration without rollback
