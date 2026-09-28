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
Status: OPEN — split under way and now ratcheted
Surfaced by lenses: 1 (ARCH-003), 4 (DB-006)
Description: Entire database schema in a single file. Beyond maintainability, this causes a 477 KB client bundle chunk and slow IDE performance.
Evidence: `shared/schema.ts` -- 14,883 lines.
Remediation plan: Split into domain-aligned modules with barrel re-export.
Re-measured 2026-09-28. The split is under way: 84 modules under
`shared/schema/` hold 260 tables, re-exported through the barrel. But the
monolith had kept GROWING, to 17,975 lines and 464 tables, because nothing
stopped a new table landing in it. `scripts/ratchets/schema-monolith-tables.json`
now freezes the count of `pgTable(` definitions in `shared/schema.ts` and drives
it down. New tables must go in a module, while column edits are unaffected. A
temporary extra table in the monolith turns it red. The first extraction under
it moved founder_ad_accounts, growth_campaigns and ad_creative_bundles to
`shared/schema/growth-marketing.ts` (464 → 461). The total table count is
unchanged at 728.
A second batch moved 100 tables in 55 self-contained sections into seven
themed modules (`comms-email`, `deal-lifecycle`, `autonomy-ops`,
`platform-runtime`, `parcel-data`, `crm-workspace`, `billing-platform`),
taking the monolith from 461 to 361 tables and 17,975 to 14,267 lines.
Only sections whose monolith references are lazy (inside
`references(() => …)`) were moved. The barrel's `export *` is hoisted, so an
eager read would hit the temporal dead zone.
`tests/unit/schemaModulesLoadThroughBarrel.test.ts` loads the real barrel,
checks every module table is exported by it, and forces every foreign key to
resolve. An eager read added to a module turns it red.
Resolving commits: pending (ratchet + first extraction on this branch, round 3)

### DEFECT-0049
Title: 44 setInterval background jobs in web server process
Severity: P2
Status: OPEN — architecture present; one production setting unverified
Surfaced by lenses: 1 (ARCH-004), 5 (SRE-02), 62 (full inventory)
Description: All background jobs run as `setInterval` timers in the main process. They compete for the 20-connection DB pool and cannot be scaled independently. BullMQ is a dependency but jobs are not migrated to it.
Evidence: `server/index.ts` -- 44 tracked intervals. 15 additional untracked.
Remediation plan: Extract to dedicated worker process or migrate to BullMQ.
Re-verified 2026-09-28. The premise is out of date. `fly.toml` defines a
separate `worker` process (built from `server/worker.ts`), which boots the same job
catalogue (`server/jobs/runScheduledJobs.ts`). The app process skips it when
`DISABLE_BACKGROUND_JOBS=1` (`server/index.ts`). Every scheduled job runs
under `withJobLock`, a database lease, about 156 call sites in the catalogue,
so running on both processes does not double-execute work. What is NOT
visible from the repository is whether `DISABLE_BACKGROUND_JOBS=1` is set on
the app machines (it is not in `fly.toml [env]`, so it would be a Fly secret)
and whether a worker machine is running. The default was deliberately NOT
flipped: if no worker machine exists, flipping it would stop every scheduled
job, including dunning and ACH reconciliation.
OWED (ops, one check): `fly secrets list` shows DISABLE_BACKGROUND_JOBS on app,
and `fly status` shows a worker machine. If both hold, close this entry.
Resolving commits: pending (interval tracking fixed; worker process exists)

### DEFECT-0050
Title: Inconsistent error response format -- raw res.status().json() vs Errors.* helpers
Severity: P2
Status: PARTIALLY FIXED (round 3, 2026-09-28) — global handler and every single-key human-text error converted; coded bodies remain
Surfaced by lenses: 1 (ARCH-016), 3 (BE-07), 3 (BE-20)
Description: ~487 usages of `Errors.*` helpers vs ~922 raw `res.status().json()`. Two different response shapes returned to clients. Global error handler returns `{ message }` only, not the standard shape.
Evidence: Multiple route files mix patterns.
Remediation plan: Migrate all raw responses to `Errors.*` helpers. Update global error handler.
Re-verified 2026-09-28:
- The global handler is already fixed: `server/middleware/terminalErrorHandler.ts`
  emits the standard shape with a request id, pinned by
  `terminalErrorHandlerContract.test.ts`.
- The raw count was 490, and 243 of those were SUCCESS responses
  (201/204/200/202), which are not this defect.
- The user-visible cost was real. The client shows `parsed.message ?? text`,
  so every raw `{ error: "some text" }` body reached users as a JSON string.
- 124 single-key error responses in 44 files now go through `sendError` with
  the same status and text: `{ message: "text" }`, or `{ error: "text" }` where
  the value is human text. Eight client readers that took `.error` first now
  read `message ?? error`: signing, marketplace, AVM, land credit, portfolio
  optimizer, founder settings and tax readiness. Otherwise they would have
  shown the code.
- Two source-scan tests now also forbid a 403 written through the helper, so
  the conversion cannot become a way around them.
- `res-status-raw` lowered 490 → 366, then → 357 in a second pass over nine 4xx
  bodies whose value is an error-message expression. 5xx expression bodies were
  left, since echoing `err.message` there can leak internals.
Remaining: raw bodies whose `error` is a machine code (clients branch on some,
e.g. `limit_exceeded`) and multi-field bodies. Each needs per-site review.
Resolving commits: this branch, round 3 (partial)

### DEFECT-0051
Title: Migration sequence number collisions (12 duplicate ordinals)
Severity: P2
Status: FIXED (round 3, 2026-09-27) — premise does not hold for production; rebuild order pinned
Surfaced by lenses: 1 (ARCH-009), 4 (DB-006), 53 (053-F02)
Description: 12 migration ordinals are duplicated. Drizzle journal only tracks 7 of 40+ files. Execution order is non-deterministic.
Evidence: `migrations/` directory -- 0003, 0007-0013, 0015-0018 all duplicated.
Remediation plan: Re-verified 2026-09-27; the count is now 16 duplicated
ordinals (0003, 0004, 0007–0013, 0015–0018, 0080, 0081 ×3, 0085). The
consequence claimed does not hold where it matters:
- Production never executes `migrations/*.sql`. Fly's release_command runs
  `scripts/migrate.mjs`, an ordered statement list; filenames play no part.
  The Drizzle journal was deleted on 2026-05-11 and nothing reads it.
- The only consumer of the files is CI's rebuild
  (`scripts/ci/build-schema-from-repo.sh`). It applies them in lexicographic
  order of the FULL filename, in a phase documented as best-effort and
  non-gating, then gates on `migrate.mjs`. The order was deterministic
  except for one thing: `sort` was not locale-pinned. It is now
  `LC_ALL=C sort`.
Renumbering was NOT done. The filenames are cited across this registry, the
deletion ledger, tests and `migrate.mjs` comments, and renaming them buys no
production behaviour. The real hazard in this area, an unmirrored .sql file,
was DEFECT-0061 and is now gated row by row.
Resolving commits: this branch, round 3

### DEFECT-0052
Title: Financial amounts stored as numeric without precision -- arbitrary precision allowed
Severity: P2
Status: OPEN — growth stopped; changing existing columns is a founder data decision
Surfaced by lenses: 4 (DB-005)
Description: ~40 financial columns use bare `numeric()` without precision/scale. No DB-level guard against storing absurd values. `Number()` conversions lose precision for large values.
Evidence: `shared/schema.ts:24` (creditBalance), `:777` (originalPrincipal), `:778` (currentBalance), etc.
Remediation plan: Add `{ precision: 14, scale: 2 }` to all financial columns.
Re-measured 2026-09-28: 353 bare `numeric("…")` declarations across the
schema (about 190 with money-shaped names), against 59 that state precision.
Converting the existing ones is an `ALTER COLUMN TYPE` that rounds values with
more than two decimals and rejects any over twelve integer digits. That
rewrites stored customer financial data, which is a founder hard stop, so it
was not done. What needs no data change was:
`scripts/ratchets/numeric-no-precision.json` freezes the bare count at 353
and drives it down, so every NEW numeric column states its precision. One
temporary bare column turns it red.
OWED (founder): approve a per-table precision migration, preceded by a
read-only query of max scale and magnitude per column to show what rounding
it would do.
Resolving commits: pending (growth ratchet on this branch, round 3)

### DEFECT-0053
Title: Trust ledger running balance computed from last row -- no integrity guarantee
Severity: P2
Status: FIXED — dead runtime retired 2026-09-06; table left inert pending a founder drop ruling
Surfaced by lenses: 4 (DB-011)
Description: `getTrustBalance()` returns running balance from the most recent row by `created_at`. No constraint ensures consistency. Concurrent inserts or row deletion silently corrupts the chain. This is a fiduciary trust account.
Evidence: `server/storage.ts:7840-7847`.
Remediation plan: DONE, by RETIREMENT rather than hardening — and the entry's own
framing was corrected in the process. Verified at HEAD: all four `/api/trust-ledger`
routes had zero callers (no client page, no AI tool dispatcher, nothing), the four
repo methods were reached only by those routes, and `recordLedgerEntry`,
`recordNotePayment`, `recordDealAcquisition`, `recordDealSale` and
`generateProfitLoss` had zero call sites of any kind. So no screen ever rendered the
last-row balance; the real exposure was a direct API consumer being handed an
authoritative-sounding number the server never derived, from a POST that spread
`req.body` and let a caller set their own balance.

The registry's remediation (derive the read, harden the write, add an immutability
trigger) was NOT taken. The org's real books are `account_ledger_entries` —
double-entry, CHECK-constrained and actually read by trialBalance, glPdfExport,
qboExport and recognitionWorker. Hardening a dead single-entry ledger to sit beside
the real one is work that buys nothing, and the trigger would have broken
`orgDeletion.ts`'s GDPR Art. 17 sweep, which must be able to delete these rows.

The TABLE is untouched and inert. Its drop may delete customer financial rows and is
therefore a founder decision; see the deletion-ledger row for the row-count evidence
required and the recommendation.
Resolving commits: pending

### DEFECT-0054
Title: API keys and third-party credentials stored in plaintext in DB
Severity: P2
Status: FIXED (round 3, 2026-09-27) — every write path sealed or retired; rotating legacy rows at rest is owed by the founder
Surfaced by lenses: 4 (DB-008); re-verified 2026-09-27
Description: `system_api_keys.api_key`, `founder_ad_accounts.access_token/app_secret`, and `organization_integrations.credentials` JSONB all store sensitive credentials in plaintext. Newer tables use encryption but older ones do not.
Evidence: `shared/schema.ts` (the three tables), `server/routes-admin.ts`,
`server/services/dataApiKeys.ts`, `server/services/founderAdAccountSecrets.ts`.
Remediation plan: Re-verified per table on 2026-09-27.
- `organization_integrations.credentials`: already fixed before this pass.
  `sealIntegrationCredentials` seals every customer write, including the BYOK
  save route that used to write `{ apiKey }` in the clear; see
  `server/services/integrationCredentials.ts`.
- `founder_ad_accounts`: still plain text, read by five call sites, and
  `GET /api/founder/growth/ad-account` returned `app_secret` to the browser
  UNMASKED (only the access token was masked). FIXED:
  `founderAdAccountSecrets.ts` seals `access_token` and `app_secret` with the
  canonical field encryption on the repo's one write path and opens them on
  every read (repo, performance ingest, Meta, TikTok). Legacy plain-text rows
  still open, and the next save seals them. Both admin responses now mask
  both secrets.
- `system_api_keys.api_key`: WORSE than filed. The founder "System API keys"
  page (`/founder/keys`) offered a key field per vendor (OpenAI, Stripe,
  Twilio …) and stored the pasted secret in plain text. Nothing read it for an
  outbound call — the platform reads vendor keys from the environment — so
  "rotate here" did nothing. And because this is also the Data-API credential
  table, `verifyApiKey`'s legacy plain-text fallback accepted each pasted
  vendor secret as a partner bearer key for `/api/data-api/*` (anonymised
  cross-tenant aggregates). FIXED: the save route answers 410 Gone. The page
  is read-only and lists which vendor rows still hold a plain-text secret.
  `verifyApiKey` refuses, and never upgrades, a legacy match on any provider in
  `shared/platformVendorKeyProviders.ts`, the one list the page also renders.
Falsified by: `tests/unit/founderAdAccountSecretsAreSealed.test.ts` (seven
assertions red on the pre-fix sources: the repo stores envelopes on insert and
update, every full-row read opens, only the repo writes, both responses mask
both secrets, and no writer puts a non-null `api_key` into `system_api_keys`;
it also goes red when one reader drops the open call) and the vendor-row case
in `server/services/dataApiKeys.test.ts`.
OWED (founder, not done here — it is a deletion of stored secrets): rotate at
the vendor any key that `/founder/keys` shows as "Plain text at rest", then
null those `api_key` values. Re-save the ad account once so its row is sealed.
AUDIT FOLLOW-UP: the vendor refusal is keyed on the vendor list, but the
retired form accepted any provider slug, so `/founder/keys` now also lists
every OTHER row still holding a plain-text value. Separately, the ad-account
save wrote `appSecret: null` whenever the form omitted it, and the form always
does, so every save wiped the stored secret. An omitted secret is now left
alone. That defect predates this pass.
Also noted: `client/src/components/founder-setup-wizard.tsx`, the UI for the
real encrypted platform-config path (`/api/founder/setup/*`), is rendered
nowhere.
Resolving commits: this branch, round 3

### DEFECT-0055
Title: 15+ unbounded in-memory Map caches with no coordination across instances
Severity: P2
Status: FIXED (round 3, 2026-09-28) — client-keyed maps bounded, the rest registered, metrics capped
Surfaced by lenses: 52 (C1-C4, H1-H11), 56 (056-F02)
Description: Module-level Maps act as caches/registries with no eviction policy, no size cap, and no cross-instance coordination. Append-only arrays in SCP subsystems, metrics histogram with unbounded key cardinality, and duplicate WebSocket from useKpiStream. Estimated 135-440 MB leak over 30 days.
Evidence: 30+ module-level Maps/Sets/arrays across server services.
Remediation plan: Add ring-buffer caps to arrays. Normalize metrics keys. Add max-size caps to all cache Maps. Eliminate duplicate WebSocket.
Progress 2026-09-28 (round 3), metrics slice only. The HTTP metrics route
label fell back to `baseUrl + req.path` whenever no route layer matched: a
404, or a 401/403/429 from global middleware. `req.path` is raw client input,
so a scanner hitting random paths minted one prom-client series per URL in
every web process. `server/metrics.ts` now falls back to the mount prefix,
with the distinct fallback set hard-capped at 200 because
`/api/export/:entityType` is a parameterised mount, else "unmatched".
Falsified by `tests/unit/metricsRouteLabelsAreBounded.test.ts`, which is red on
the pre-fix code. The duplicate KPI WebSocket named above is not live:
`useKpiStream` has no caller. The module-level cache Maps are not addressed
here, which is why the entry stays OPEN.
Maps, 2026-09-28: 25 module-level Maps in server/ were written and never
deleted, cleared or size-checked. Seven were keyed by client-controlled
values, and they now use `server/utils/boundedMap.ts` (a Map that evicts its
oldest key past a cap):
- the public due-diligence preview limits (per IP/email, 10k);
- the comps cache (per coordinate, 2k);
- the expensive-endpoint per-user limiter objects (5k; their counts live in
  the shared store);
- the SNS certificate cache (100);
- the USDA snapshot cache (5k);
- GIS validation jobs (500);
- shared agent insights (1k).
The other 18 are bounded by construction: org ids, job names, static
registries and trimmed histories. Each is registered with its reason in
`tests/unit/moduleMapsAreBounded.test.ts`, which compares the register both
ways with every grow-only module Map in server/, so a new one fails until
someone says why it cannot grow. The module ARRAYS were re-measured too: the
only append-only ones are a static origin list and the founder's reminders,
which persist to system_meta.
Resolving commits: this branch, round 3

### DEFECT-0056
Title: withTransaction callbacks ignore tx parameter -- operations use global db
Severity: P2
Status: FIXED (see DEFECT-0085)
Surfaced by lenses: 54 (054-F04)
Description: Several `withTransaction()` usages pass no `tx` argument or ignore it. `storage.updateOrganization` and `storage.createDeal` use the global `db` instance, not the transaction. The transaction wrapper does nothing useful in these cases.
Evidence: `server/routes-billing.ts:150`, `server/routes-deals.ts:159`.
Remediation plan: Accept and use the `tx` parameter. Refactor storage methods to accept optional transaction client.
Resolving commits: pending

### DEFECT-0057
Title: Hardcoded hex colors in 84 chart files -- dark mode and color-blind issues
Severity: P2
Status: FIXED (round 3, 2026-09-27) — last hex-coloured chart components migrated; components now gated
Surfaced by lenses: 76 (DV-01), 8 (A11Y-09)
Description: Recharts components use hardcoded hex colors instead of CSS variables. Charts invisible in dark mode. No pattern differentiation for color-blind users. A `ChartContainer` wrapper with theme support exists but is underused.
Evidence: 188 hardcoded hex values across 30+ chart files.
Remediation plan: Re-verified 2026-09-27. Most of the migration had already
happened: `client/src/lib/chart-colors.ts` (theme tokens) and
`client/src/lib/chartPalette.ts` (Wong CVD-safe palette) exist, and
`lint:page-hex` holds `client/src/pages/**`. The chart COMPONENTS were outside
that population, and 33 hex literals remained in five of them: the MRR
trajectory, whose gradients did not match its own series strokes;
attribution; pipeline velocity; the founder finance steering charts; and the
analytics forecast label. All five now read the palette modules. The eight
cost-mix categories use the eight-entry CVD-safe palette, so no two collide.
Falsified by: `tests/unit/chartComponentsUseTokens.test.ts`. Its population is
every component importing recharts or the shadcn chart wrapper, 14 at HEAD,
with a floor. It has a stale-checked allowance for the two selector literals
in `ui/chart.tsx` that match Recharts' own defaults. It is red with 33
offenders on the pre-fix files.
Not done: pattern or shape encoding for colour-blind users beyond the CVD-safe
palette. `ChartPatternDefs` exists; adopting it per chart is design work.
Resolving commits: this branch, round 3

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
Status: FIXED (see DEFECT-0086)
Surfaced by lenses: 58 (F-058-09)
Description: Year boundaries for IRS 1098 tax documents are constructed in server timezone. A payment on Dec 31 at 10 PM Pacific (Jan 1 UTC) would be excluded from the correct tax year.
Evidence: `server/routes-borrower.ts:663-668`.
Remediation plan: Construct year boundaries in org timezone or document UTC convention.
Resolving commits: pending

### DEFECT-0061
Title: Feature flag keys referenced in routes have no seed data -- 4 modules permanently inaccessible
Severity: P2
Status: FIXED (round 3, 2026-09-27) — the seed existed but never reached a deploy
Surfaced by lenses: 64 (F064-03)
Description: `featureGate()` is used with `feature_white_label`, `feature_voice_ai`, `feature_territories`, `feature_deal_rooms` but these keys are not in any migration seed. Since `featureGate` returns 404 when flag is missing, these modules are permanently inaccessible.
Evidence: `server/routes.ts:1007, 1014, 1048, 1463`.
Remediation plan: DONE. Re-verified 2026-09-27. The seed had been written —
`migrations/0183_seed_missing_module_flags.sql` inserts the four keys as
explicit `off` rows — but it never reached production through a deploy. Fly's
release_command runs `scripts/migrate.mjs` only and does not apply
`migrations/*.sql`, and 0183 was never mirrored into it. The two existing
tripwires both passed it: `migrate-mirror-check.yml` only asks that migrate.mjs
be touched in the same change, and `check-schema-migrate-mirror.mjs` is
table-level, while `platform_feature_flags` already had other seed rows. So
the rows exist in production only if someone applied 0183 by hand; that
state was not observable from this session.
Fix: the White Label, Territories and Deal Rooms rows are mirrored into
`scripts/migrate.mjs` with `ON CONFLICT ("key") DO NOTHING`, so a row the
founder already turned on stays on. The Voice AI row is deliberately NOT
mirrored. That module was killed on 2026-08-01, and the 2026-08-13
founder-authorized flag-row deletion in the same runner removes the row, so
inserting it would only re-create it on each deploy.
Falsified by: `tests/unit/migrationSeedsReachRelease.test.ts`. It is a
row-level rule: every INSERT seed row in migrations 0091 and later must have
its key inside an INSERT into the same table in migrate.mjs. A DELETE naming
the key does not count, and each exemption must still be needed. It is red on
the pre-fix runner for the three 0183 keys, and red again when a mirrored
INSERT is rewritten as a DELETE naming the same key. Census at the same time:
seeds before 0091 (0005, 0008 including `pricing_config`, 0070, 0090) predate
the release command and are outside the rule. Pricing rows are founder-only
and were not touched.
Resolving commits: this branch, round 3

### DEFECT-0062
Title: Duplicate rate limiter definitions in index.ts and routes.ts
Severity: P2
Status: FIXED (round 3, 2026-09-27) — premise corrected; the live defect was worse
Surfaced by lenses: 1 (ARCH-015); re-verified 2026-09-27
Description: The premise was backwards. Two limiters stacked on one path each
count every request, so the STRICTER one wins; separate counters do not double
the rate. What re-verification found instead:
- Every limiter in `server/index.ts` is mounted at module scope, before
  `registerRoutes()` installs Clerk. Four of them keyed
  `getClerkAuth(req)?.userId || req.ip`, so `userId` was undefined for every
  request they ever saw and they keyed on `req.ip`. Behind Cloudflare → Fly
  with `trust proxy = 1`, `req.ip` is the Cloudflare EDGE address
  (`server/utils/clientIp.ts`). The general API budget (300/min), the AI
  budget (240/min) and the `/api/auth` budget were therefore per edge node,
  shared by every customer routed through it — the CGNAT failure their own
  comments said was fixed on 2026-05-10.
- The bulk-export cap ("per-org per-day, 5") also read `req.organization`
  before getOrCreateOrg had run: 5 exports per day per edge node across all
  orgs.
- `server/routes.ts` mounted a second, same-named set (`aiLimiter`,
  `authLimiter`, `importLimiter`, plus a 1000/min floor) keyed on `req.user`,
  populated later still by per-route isAuthenticated — so they keyed on IP too.
  Its `/api/auth` mount reached no handler: every `/api/auth` route is
  registered earlier and answers first. (Correction from the independent
  audit: the other routes.ts mounts keyed on the REAL client IP through
  `getClientIp`, so they were working per-client caps — /api/ai and /api/pax
  held at 120/min — not edge buckets.)
Evidence: `server/index.ts` (pre-fix limiter block), `server/routes.ts`
(`mountIdentityRateLimiters` call site), `server/utils/clientIp.ts`.
Remediation plan: DONE. `server/middleware/identityRateLimiters.ts` defines
the per-user auth, AI, export and API limiters once, keyed on the verified
Clerk user else the real client IP (`getClientIp`), and routes.ts mounts them
once, directly after the Clerk wrapper and before `registerAuthRoutes`.
index.ts keeps only limiters that need no identity — a 1000/min per-client-IP
floor that also covers the public pre-Clerk routes, webhooks, imports and MCP —
each keyed on `getClientIp`. The routes.ts duplicates and the now-callerless
`rateLimiters` / `authLimiter` / `importLimiter` / `authAttemptKeyFunction`
exports are removed. The AI caps are tiered to preserve the effective per-person
limits from before the move: 120/min per user on /api/ai and /api/pax, 240/min
on /api/chat, /api/executive and /api/document-generation. The export cap is
honestly per user now (the org is not resolvable at a global mount).
AUDIT FOLLOW-UP (same day, independent completeness audit): the first ratchet
read only index.ts and names imported from rateLimit.ts, and missed seven more
files whose limiter keys used `req.ip`: `aiRateLimit.ts` (globally mounted on
/api/ai, so every customer on an edge node shared 60/min), the public parcel
check, feedback, the error boundary, marketing touch, the borrower portal and
bulk export. All now key on `getClientIp`, and `aiRateLimit` keys on the Clerk
user where org and user are not yet set. Stored evidence fields in those files
(consent and audit `ipAddress`) use `clientIpOrNull`; the feedback route had
trusted the client-written first X-Forwarded-For hop. The ratchet is now a
file-level rule over every server file that defines a limiter, with a floor.
Falsified by: `tests/unit/rateLimitIdentityKeying.test.ts` — four population
assertions red on the pre-fix sources (identity read or bare `req.ip` in an
index.ts limiter; an unkeyed index.ts limiter; the per-user set not mounted
after Clerk; a user-keyed limiter mounted globally in routes.ts). The
behaviour cases go red when the key falls back to `req.ip` or ignores the
Clerk user.
Resolving commits: this branch, round 3

### DEFECT-0063
Title: `(req as any)` used 73+ times across 27+ server files
Severity: P2
Status: FIXED (round 3, 2026-09-28) — both halves at zero and held by the req-as-any ratchet
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
DONE 2026-09-28: the 135 `req.user as any` casts are gone. Express's `Request`
is globally typed `user: User` (`server/types/express.d.ts`), and every cast
read `id`, `email` or `clerkUserId`, all of which `User` declares, so the casts
bought nothing and hid nothing. `npm run check` is the proof. The last three
request casts went too: `req as any` twice in `server/routes-solene-audit.ts`
and `res.req as any` in `server/utils/apiError.ts`, since `correlationId` is
declared on `Request`. `scripts/ratchets/req-as-any.json` now matches
`req`, `req.user` and `req.organization` `as any` and holds all three at zero.
It counted 138 on the pre-sweep tree. `as-any` is lowered 1237 → 1099.
Resolving commits: the `(req as any)` half predates this registry correction;
the `req.user as any` half is this branch, round 3

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

### DEFECT-0085
Title: Five `withTransaction` callbacks that ignored the transaction — a fake atomicity claim and a five-connection self-deadlock
Severity: P1
Status: FIXED
Surfaced by lenses: 51 (RACE), the verification fan-out 2026-09-06 (was DEFECT-0056)
Description: Five callbacks passed to `withTransaction` took NO parameter, so
every query inside ran on the global pool while the wrapper held a separate
connection open on a `BEGIN` that governed none of them.

**The deal path** (`POST /api/deals`, `routes-deals.ts`). The block's own comment
promised the deal and its audit row were written atomically. They were not: if
the audit write failed, the deal was already committed and stayed — the exact
orphan the comment claims to prevent — and the caller got a 500, so they clicked
again and got a second deal. The audit chain has a second problem in the same
shape: `chainAndInsertAuditLog` INSERTs, then READS the previous hash, then
UPDATEs. Run on two connections, two concurrent writers can read the same
`prev_hash` and both chain onto it, forking the chain an audit log exists to
make unforkable.

**The pool self-deadlock** — not in the original entry, and the reason this is a
P1. `server/db.ts` caps the pool at 5 per app process with
`connectionTimeoutMillis: 10_000`. The wrapper holds one connection on an open
BEGIN; the body then asks the SAME pool for another. Five concurrent "Create
deal" clicks on one machine hold all five, and all five bodies wait for a sixth
that cannot arrive. Each blocks the full 10s, and for those 10s the process's
entire pool is wedged — every route, every org, not just deals. Five concurrent
creates is an ordinary spike, not a pathological one.

**The four billing sites** (`routes-billing.ts`) additionally held the
transaction open across a synchronous outbound Stripe call, widening the hold
window from milliseconds to hundreds of them. There the atomicity claim was not
merely broken but impossible: a Stripe API call is not a Postgres statement and
cannot roll back.

Evidence: `server/routes-deals.ts:655` (before), `server/routes-billing.ts:256,
354, 670, 714` (before), `server/db.ts:78-80`.
Remediation plan: Done, and deliberately NOT uniform — the registry's blanket
"refactor storage to accept an optional transaction client" is right for one site
and wrong for four.

- **Billing (4): the wrapper is DELETED.** Each body is one Stripe call plus one
  `storage.updateOrganization`. A transaction around a single statement is a
  no-op even when correctly threaded, and the external call can never join it.
  The false comment is replaced by what actually happens: if the UPDATE fails the
  Stripe customer is orphaned and the next attempt creates another — and the fix
  for THAT is an idempotency key on `createCustomer`, not a transaction that
  cannot contain it.
- **Deals (1): the transaction is made REAL.** An optional executor is threaded
  through `createDeal` → `createAuditLogEntry` → `chainAndInsertAuditLog`,
  including `getPrevHashForOrg`, so the prev-hash read shares the insert's
  snapshot. `publishDealLifecycle` is suppressed for transactional callers and
  issued by the route after commit — announcing a deal that may still roll back
  is the mirror-image defect.

After the fix no callback that holds a transaction connection ever asks the pool
for a second one, which is what removes the deadlock.

Gated by `transactionsAreRealTransactions.test.ts`. The cheap version of this
gate asks "does the callback declare a parameter", which is a proxy for a symbol
and stays GREEN through the mutation that matters. So the executor is OBSERVED:
the storage methods are stubbed and asked what they were actually handed.
Falsified twice — restore the parameterless callback (the source arm goes red),
and keep `(tx)` in the signature while passing the global handle anyway (the
behavioural arm goes red, the source arm does not).

**AND THE FIX ITSELF OPENED A BLIND SPOT, WHICH IS THE MORE USEFUL FINDING.**
The executor was first threaded as `exec: PrimaryDb = db`.
`check-org-scoped-fetch.mjs` detects writes with

    /\b(?:from|(?:db|tx)\s*\.\s*update|(?:db|tx)\s*\.\s*delete)\s*\(…/

— an enumeration of executor SPELLINGS. So `exec.update(auditLog)` was not
flagged; it was NOT SEEN. The tenancy lint did not go red, it went QUIET, and
then reported the burn-down entry for `chainAndInsertAuditLog` as "no longer
matching anything — they were fixed or deleted (good!)" and asked for its
deletion. Deleting it, as instructed, would have recorded a blind spot as a win.

The parameter is named `tx` — a name the lint knows — and the hole is closed by
`executorNamesTheLintKnows.test.ts`: every parameter whose TYPE NODE is
`PrimaryDb` must be named one the lint recognises, and the recognised set is READ
OUT OF THE LINT'S OWN REGEX rather than restated, so the two cannot drift.
Falsified by renaming an executor to something unknown, and by NARROWING the
lint's regex — which must shrink the allowed set and go red, proving the set is
derived and not a second copy. Its detector inspects the type node rather than
its text, because `withTransaction(fn: (tx: PrimaryDb) => …)` mentions the type
without being an executor; that false positive was found and fixed the same way.
Resolving commits: pending

---

### DEFECT-0086
Title: A 31 December payment filed in the wrong tax year — 1098 boundaries bucketed by the server's zone
Severity: P1
Status: FIXED
Surfaced by lenses: 58 (F-058-09), verified and re-scoped by the fan-out 2026-09-06 (was DEFECT-0060)
Description: Box 1 of a 1098 is the interest RECEIVED in a calendar year — a
figure filed with the IRS and furnished to the borrower under 26 U.S.C. §6050H.
"Received" is a fact about the LENDER's local day. Both producers answered it
with the server's zone.

- `server/services/form1098Batch.ts` — `toIsoDay` normalised a `timestamp` with
  `value.toISOString().slice(0,10)`, i.e. the UTC day.
- `server/routes-borrower.ts` — the portal's 1098 branch built its window as
  `new Date(taxYear, 0, 1)` .. `new Date(taxYear, 11, 31, 23, 59, 59)`, i.e. the
  server's local zone, and compared a `timestamp` against it.

A borrower paying on 31 December at 16:00 Pacific is `2026-01-01T00:00Z`, so that
interest was reported in the FOLLOWING tax year. Every US zone is behind UTC, so
the error is one-directional: it always pushes interest forward a year, and it
lands precisely on the tax-motivated year-end payment. Magnitude per event is one
payment's interest — small in dollars, but the remedy for a wrong filed figure is
a corrected filing and a corrected payee statement, not a rounding note.

**The asymmetry is the part the entry missed.** `note_payments.payment_date`
(ACQUIRED notes) is a `date` column — no time, no zone, already the recorded
calendar day — while `payments.payment_date` (ORIGINATED notes) is a `timestamp`.
So a lender with a mixed portfolio filed TWO different year conventions in one
submission, which reads as nondeterminism rather than as a fixable rule.

Two smaller things fell out of the same three lines. The portal's window CLOSED
at `23:59:59` exactly, so a payment at `23:59:59.5` fell in neither year. And
`toIsoDay`'s own header claimed "no timezone drift on year boundaries" — true of
its string branch, false of the Date branch it also served, which is how the
claim survived being read.

Evidence: `server/services/form1098Batch.ts:387` (before),
`server/routes-borrower.ts:1952` (before), `shared/schema/notes-vertical.ts:295`
(`date`), `shared/schema.ts:1712` (`timestamp`).
Remediation plan: Done. `dayInZone(value, tz)` answers the day-in-a-zone question
once; both producers use it, so the two conventions become one. The zone is
`organizations.timezone` — an IANA name with a column default, already the field
the digest and the Pax scheduler run on — resolved by `resolveOrgTimeZone`, so
nothing is invented here. Where the column is somehow empty the fallback is UTC
rather than a guessed US zone: inventing a lender's locale on a filed tax figure
is the same class of mistake as inventing a note's grace period (DEFECT-0078).

`dayInZone` also refuses to reparse a bare `YYYY-MM-DD`. `new Date("2025-12-31")`
is midnight UTC, which in any US zone is the 30th — the defect in miniature, and
the one a "just normalise everything through Date" fix would have introduced.

Gated by `form1098BucketsByLenderDay.test.ts`, which asserts the BOUNDARY
BEHAVIOUR rather than the presence of a timezone argument: a year-end Pacific
instant buckets to 2025-12-31, the same row under UTC buckets to 2026-01-01 (the
defect, pinned so it stays legible), and the acquired and originated paths agree
on the same calendar day. Falsified by restoring `toISOString()` bucketing (3
tests red, including the two-conventions one) and by removing the bare-date guard
(1 test red).
Resolving commits: pending

### DEFECT-0087
Title: The built-but-unwired gate had never opened server/ai, middleware, utils or storage
Severity: P1
Status: FIXED
Surfaced by lenses: the Remaining Work Census, 2026-09-06 (two families found it independently)
Description: `lint-reachability.mjs` exists to catch built-but-unwired code —
which CLAUDE.md names as this repository's single most common defect, the one
behind route files never mounted, jobs never registered and services with zero
call sites. Its export-scanning population was three directories:

    const EXPORT_SOURCE_DIRS = ["server/services", "server/jobs", "shared"];

It had never opened `server/middleware`, `server/utils`, `server/ai` or
`server/storage`. Every export in them was invisible to the instrument whose
entire purpose is seeing them — and `server/ai` is the same directory CLAUDE.md's
third law names as a load-bearing population, the one whose 91-case dispatch
switch no gate had ever read.

This is that law aimed at the gate that enforces it: *"a gate proves its property
only over the population it actually reads"*, and the population is invisible in
a green result. The gate reported PASS at 370 unreached exports for its whole
life, and the number was true about the three directories it read.

MEASURED on widening — 149 items became visible in one step:

| family | was | now | delta |
|---|---|---|---|
| unreached-exports | 370 | 434 | +64 |
| internal-only-exports | 1,168 | 1,242 | +74 |
| module-orphans | 28 | 36 | +8 |
| opaque-exports | 16 | 19 | +3 |

Two are already legible as genuinely dead files rather than seam artefacts:
`server/middleware/customDomainRouter.ts` and `server/middleware/pagination.ts`,
both "nothing in production imports this file".

Evidence: `scripts/lint-reachability.mjs:399` (before).
Remediation plan: Done. The four directories are in the population, and the four
baselines were RAISED to the measured truth.

A raised baseline on a down-only ratchet is normally forbidden, and that is the
whole reason this entry exists rather than a one-line bump: the code did not get
worse, the gate started looking, and a silent rise is indistinguishable from the
regression the ratchet is meant to stop. From here the counts are down-only
again, so what the widening buys is that NEW dead code in those four directories
fails CI — which it never could before.

The 149 are debt, not absolution. They are deliberately NOT triaged in this
commit: the precedent (the 30-entry UNREACHABLE cluster in the deletion ledger)
is that a cluster this size earns one agent per file plus an adversarial second
read and becomes a ledger row, not a deletion commit. Adding a directory to the
list is cheap; deleting what it reveals is the work.

Falsified three ways, each asserted to have landed before its verdict was read:
a new dead export in `server/ai` -> RED (was invisible); the same in
`server/middleware` -> RED (was invisible); the same in `server/services`, always
read -> RED (control, proving the existing behaviour is unchanged).
Resolving commits: pending

### DEFECT-0088
Title: Nineteen /settings deep links landed on the wrong tab — including the renewal and upgrade funnel
Severity: P1
Status: FIXED
Surfaced by lenses: the Remaining Work Census, 2026-09-06 (two families found it independently)
Description: `settings.tsx` resolved its active tab from the URL HASH only.
Nineteen `/settings?tab=…` links existed across the app and the transactional
emails — SIX of them `?tab=billing` — and every one landed on the Account tab:
no billing UI, no explanation, and no way for the customer to tell a broken link
from a redesigned page.

Directly customer-visible and revenue-adjacent. A customer clicking "Manage
subscription" in a Stripe renewal email, or "Upgrade plan" in the product,
arrived somewhere that answered neither their question nor why not.

**The convention was already documented, and documenting it was not enough.**
`settings.tsx:112` states that only the hash is read, and records that an earlier
version of that same comment had "misled the dunning-email link author into a
broken recovery link". The comment was corrected; the links kept being written
the other way. A convention no code enforces is a comment.

The nineteen also included three spellings with no canonical entry at all —
`?tab=team`, `?tab=providers`, `?tab=org`.

Evidence: `client/src/pages/settings.tsx:173` (before) — `getTabFromHash` read
`window.location.hash` and nothing else.
Remediation plan: Done, and deliberately NOT by rewriting the nineteen call
sites. Renewal and dunning emails carrying `?tab=billing` are already in
customers' inboxes and cannot be edited, so the page now resolves from BOTH
carriers — hash first, since it is the documented canonical form, then the query
string — with `providers` and `org` added to `LEGACY_TO_CANONICAL`. The
billing-intent path (which opens the plan comparison) accepts `?tier=` from
either carrier for the same reason.

Gated by `settingsDeepLinksResolve.test.ts`. The population is DERIVED — every
`/settings` link is found by scanning client/ and server/, so a twentieth link is
checked by existing — and `VALID_TABS` / `LEGACY_TO_CANONICAL` are read out of
the page rather than restated, so the two cannot drift.

**The gate's first version was itself the mention-trap.** It asserted
`searchParams.get("tab")` appeared in `settings.tsx`, and reverting the resolver
to hash-only left it GREEN: `applyBillingIntent` also reads that param, so the
string was still present while the defect was fully restored. Scoped to the
resolver's own function body, the same mutation now fails. Same shape as the
mail-suppression gate's third falsification — a symbol appearing somewhere in a
file says nothing about the code path that matters.

Falsified: revert the resolver to hash-only -> RED (with the string still in the
file); add a link to a tab that does not exist -> RED.
Resolving commits: 7c545fff

---

### DEFECT-0089
Title: The founder's one required door could not answer the questions it listed
Severity: P1
Status: FIXED
Surfaced by lenses: the Remaining Work Census, 2026-09-06
Description: FOUNDER_DOORS calls Decisions "the only routine place the founder
is required to interact". It listed the questions agents were blocked on and
offered no way to answer one. Four faults at once, and the API had been live the
whole time:

1. `AnswerAskDialog` and `SupersedeAskDialog` had ZERO importers. They lost
   their only mount when the standalone /founder/asks page was deleted on
   2026-07-27 for duplicating this door, and nothing picked them up.
2. The per-row Answer button linked to `/founder/asks?id=N`, which App.tsx
   redirects back to `/founder/decisions` — it navigated to the page it was on.
3. `?id=` carried an ASK id (home.tsx sends `brief.decision.askId`) into a
   handler matching DECISION-LOG ids: two tables, two key spaces, one param.
4. `POST /api/founder/asks/:id/answer` and `/supersede` both existed and worked.

**Why a grep said otherwise.** The only surviving reference to those two files
was PROSE in route-redirects.ts describing the orphaning. A mention count
answers "1 importer" for a component with no mounts — which is how this passed
review.
Evidence: `client/src/pages/founder-decisions.tsx:710` (before); `App.tsx`
`<Route path="/founder/asks">` -> `<Redirect>`; `route-redirects.ts:121`.
Remediation plan: Done. Asks open in place; they carry their own `?ask=` param;
the legacy redirect translates the old `?id=` into it so existing bookmarks
resolve. Gated by `founderAskLaneCanAnswer.test.ts`, whose mount check requires
an import statement AND a JSX element, and which asserts the route-redirects.ts
prose is still present so the check cannot decay into a mention count.
Falsified: remove the mount -> RED; remove the import, keep the mount -> RED;
restore the self-referential link -> RED; point the Letter's CTA back at `?id=`
-> RED.
Resolving commits: 2c687779

### DEFECT-0090
Title: A Today-door CTA discarded its payload and marked the work done anyway
Severity: P1
Status: FIXED
Surfaced by lenses: the Remaining Work Census, 2026-09-06
Description: route-redirects.ts has documented its own removal protocol since
2026-05-03 — "rewrite in-app links to the canonical path" — and that step had
never once run. Eight in-app links across six files still pointed at routes
that only redirect.

The serious one was customer-facing. On the Today door, "Pax, draft the
follow-up" linked to `/pax?intent=draft_follow_up&leadId=N`. `/pax` is a
`<Redirect to="/ai">`, and wouter's Redirect DROPS the query string — and
nothing anywhere read `intent`. Meanwhile its onClick resolved the decision as
"done". The customer asked for a draft, watched the row complete, and no draft
existed.

Beyond the wasted navigation, a redirect that eats its query means the sunset
can never happen: deleting the legacy `<Route>` would 404 a live control.
Evidence: `client/src/components/today/DecisionQueue.tsx:666` (before);
`App.tsx` `<Route path="/pax">`; `client/src/pages/pax.tsx` reads no params.
Remediation plan: Done. The CTA uses `?prefill=`, the param command-center.tsx
actually reads, carries a real instruction, and no longer marks work done that
has not happened. `CanonicalSurfacesBanner` was deleted with its three mounts —
it named /founder/now and /founder/cockpit as the canonical surfaces, both dead
routes, under a two-surface doctrine the four doors replaced.
Gated by `inAppLinksSkipRedirects.test.ts`; legacy paths are read out of
ROUTE_REDIRECTS so a redirect added tomorrow is governed without editing it.
**The resolve-before-effect probe first stayed GREEN**: the check sliced forward
from the button's data-testid and onClick is declared above it — the file was in
the population, the unit boundary was not.
Falsified: restore a legacy link -> RED; restore the query-dropping href -> RED;
re-add the premature onResolve -> RED.
Resolving commits: 2c687779

### DEFECT-0091
Title: Repo-wide gates had no time budget, and the gate enforcing that missed 49 of them
Severity: P1
Status: FIXED
Surfaced by lenses: main CI, 2026-09-06
Description: `transactionsAreRealTransactions.test.ts` timed out at 30s under
the coverage run and turned `main` red. The budget gate that exists to prevent
exactly this was green: its population predicate was "imports the shared
stripper AND walks a directory", and that test reaches the stripper with
`await import(...)` inside the test body rather than a static `from "..."`. The
rule keyed on the SYNTAX of an import.

Both halves were wrong in the same direction. The stripper clause should not
have existed: what costs time is walking the tree. Keyed on the helper, the rule
described the implementation of 52 sweeps rather than the cost shared by 98.

A timeout is not a bug report — it is the suite deciding a gate has stopped
being worth waiting for, and a killed gate is indistinguishable from a clean one
in a green run.

**The first widening reported a false number.** 119 members, inflated by four
SCP tests MOCKING `readdirSync` (`readdirSync: vi.fn()`) and sixteen tenancy
tests whose local `walk()` recurses a drizzle SQL chunk tree and never touches
disk. Requiring the call — `readdirSync(` — excludes both. Honest population:
97 derived + 1 registered, the registered one being a sweep that delegates its
walking to an imported helper, which no static predicate can see.
Evidence: `tests/unit/repoSweepsDeclareTheirBudget.test.ts` (before);
CI run 34053915409.
Remediation plan: Done. REPO_SWEEP_TIMEOUT_MS moved to its own module so the
budget is not a property of comment-stripping; 49 sweeps that had never declared
one now do; two vacuity canaries pin the exclusions so the count stays true.
Falsified: remove the budget from the dynamic-import sweep -> RED; lower the
value to the suite default -> RED; define the constant twice -> RED.
Resolving commits: 69e0dfce

### DEFECT-0092
Title: The CI job named "Accessibility Audit" had never audited accessibility
Severity: P1
Status: FIXED
Surfaced by lenses: the Remaining Work Census (QP-04), verified 2026-09-06
Description: `tests/e2e/accessibility.spec.ts` was 262 lines titled
"Accessibility Audit", run by a CI job of the same name, and it checked nothing.
Six independent reasons — the notable part being that five different people
could each have fixed one and the job would still have been a no-op:

1. `@axe-core/playwright` was never installed, and the loader was
   `import(...).catch(() => ({ checkA11y: null }))` — the missing dependency
   returned null and every axe assertion was skipped silently. The file's own
   header carried the install command nobody ran.
2. No storageState in the CI invocation, so all nine "critical page" tests hit
   the /auth redirect and early-returned BY DESIGN.
3. The step ended in `|| true`.
4. The job was absent from security-gate's `needs:`.
5. `npm ci` + `playwright install`, no build and no database — `npm run start`
   could not boot and the webServer timed out before any test ran.
6. Two surviving assertions were `expect(true).toBe(true)`; the one named
   "color contrast passes on auth page" asserted the body has text; and
   checkFocusIndicators' evaluator ended `return true; // Default pass`.
Evidence: `.github/workflows/security.yml:262` (before); the retired spec.
Remediation plan: Done. Replaced by `tests/e2e-mobile/accessibility-audit.spec.ts`
in the harness that already has a pgvector service, a real build and the seeded
test-auth session. It asserts zero `critical` on the five customer and four
founder doors, reports `serious` per route, treats a door that bounces to /auth
as the finding rather than a skip, and asserts axe evaluated a real number of
rules first — because axe finding nothing and axe never running produce the same
empty array. `door-routes.ts` gives the audits one route list, pinned against
nav-items.ts and App.tsx by `auditRoutesAreRealDoors.test.ts`, because the
copies were the point of failure: mobile-feel-contracts.spec.ts audited "/map",
which has no route, and measured the 404 page while reporting a healthy Map door.

**Two of the honesty gate's own rules first passed with the defect reinstated.**
The `|| true` rule read only steps spelling "playwright test" and was blind to
`npm run test:e2e:mobile`, the alias that actually runs the spec; npm scripts
are now expanded through package.json, with a canary on the expansion itself.
Falsified: drop the dependency -> RED; `|| true` on the alias step -> RED;
misspell a project name -> RED; delete the vacuity floor -> RED; restore the
/auth early-return -> RED.
Resolving commits: e223bb17, 165cb2eb

### DEFECT-0093
Title: One unanswered founder question became a new row and a phone page every 30 minutes
Severity: P1
Status: FIXED
Surfaced by lenses: the Remaining Work Census (E1-ASK-DEDUP), verified 2026-09-06
Description: `askFounder()` had no duplicate suppression, and three of
planAndAct's escalation paths call ask() with no memory of having asked — the
risk-tier check, the pre-mortem veto, and the gate escalation. The autopilot
loop re-enters planAndAct every 30 minutes with the moves still pending, so a
move that escalated on one tick escalated again on the next and every tick
after. Each repeat inserted a row AND fired a pager; urgency "normal" maps to
pager severity "urgent", so it reached the founder's phone.

`ActContext.idempotencyKey` looks like it prevents this. Its own doc says it
seals the OUTWARD EFFECT; it is forwarded to enqueue() and never consulted on
the ask path. Reading the field name instead of its one call site is how this
survived.

The cost lands where it hurts most — the door the founder is required to use,
filling with copies of one question. Three callers had each built a private
guard (runPolicyInduction, maybeProposeBudgetRamp, immuneResponse), which is the
signal the guard belonged at the chokepoint.
Evidence: `server/services/solene/founderCollab.ts:91` (before);
`server/services/autopilot/act.ts:241,269,322`.
Remediation plan: Done. Dedup on (role, summary, body) among OPEN asks — all
three already stored, so no column and no migration — before the pager, since
the pager is the expensive side effect. Reminding about an unanswered ask was
never the missing piece: runAskEscalationLadder already does it on a per-urgency
backoff. The read-then-insert race is stated in the code rather than implied.

**founderCollab.test.ts passes with and without the fix**: its mock decodes only
byId / byStatus / expireOverdue, so the four-clause select falls through to []
and the mock agrees with any implementation of a query it cannot read. The new
gate renders the predicate to real SQL instead.
Falsified: drop the status clause -> RED; drop the body clause -> RED; move the
check below the pager -> RED; disable it -> RED.
Resolving commits: 165cb2eb

### DEFECT-0094
Title: A job lease was never renewed, so a long job lost its own lock
Severity: P1
Status: FIXED
Surfaced by lenses: the Remaining Work Census (REL-JOBLOCK-NO-RENEWAL),
verified and RELOCATED 2026-09-06
Description: The record named the scheduler, and the scheduler is fine — when
job bodies moved out of transactions (Tier 1H) it gained a lease row with
HEARTBEAT_MS at 3x the TTL expiry rate. The repair landed on ONE of two
mutual-exclusion mechanisms. `withJobLock` — the one job bodies take out for
themselves, across 185 call sites — kept the defect, and the scheduler's own
comment names it in passing while explaining the `sched:` prefix that keeps the
two from colliding.

A body outliving its TTL simply lost the lock, and the next machine's tick
acquired it and started the same job concurrently.

**A measurement correction.** A first pass read the TTLs as seconds (60, 55, 30,
a mail_flusher at 2) and concluded the exposure was severe. That was a truncated
regex stopping at the first number: the real values are `60 * 60`, `55 * 60`,
`23 * 60 * 60`. This was never the everyday failure. It is still not a lock, and
the seconds-scale TTLs that do exist have no margin.
Evidence: `server/utils/jobRuntime.ts:42` (before); `server/jobs/scheduler.ts:68-97`.
Remediation plan: Done. acquireJobLock already re-extends when the caller is the
current holder, so the heartbeat is the same call on a timer at TTL/3, floored
at 5s and ceilinged at 15m, unref'd, cleared on both success and throw, and
never started when the lock was not acquired.
Falsified: remove the heartbeat -> RED; never clear the interval -> RED; make
the period longer than the TTL -> RED; beat when the lock was lost -> RED.
Resolving commits: 420cd6a9

### DEFECT-0095
Title: Critical WCAG violations on all eleven doors, under a green audit
Severity: P1
Status: FIXED (one registered, see below)
Surfaced by lenses: DEFECT-0092's audit, first real run 2026-09-06
Description: The moment the audit could fail, it did — on eleven of eleven
customer and founder doors. Six root causes:

- `/founder/decisions` — a bare `<select>` for the time window with no label.
  (select-name)
- `/settings`, `/deals` — four shadcn SelectTriggers whose only content is
  `<SelectValue />`, rendering a role="combobox" button with no accessible name;
  twelve nodes on /settings alone. (button-name)
- `/today` — the activity filter renders `{compact ? "" : "Filter"}`, so in
  compact mode the label collapses to an empty string. (button-name)
- `/deals` — each kanban column was role="list" wrapping a skeleton, an
  empty-state role="status", or DealCards; none are list items, so a reader
  navigating by list landed in a list whose items did not exist. (
  aria-required-children, x6)
- `/inbox` — REGISTERED, not fixed. See below.

**Why the existing static gate was green.** `tests/unit/accessibility.test.ts`
asserts "EVERY icon-only button has an accessible name — all of them, not a
sample". Its population is elements carrying the literal `size="icon"`. Raw
`<button>` elements, shadcn primitives, and a label that disappears at a
breakpoint are all outside it.
Evidence: E2E Mobile run 34061942929, `[a11y]` lines with axe selectors.
Remediation plan: Five fixed. The sixth — inbox.tsx drives two Radix `<Tabs>` as
segmented FILTERS over one shared message list and renders zero `<TabsContent>`,
so every trigger advertises aria-controls for a panel not in the document — is
registered in KNOWN_CRITICAL with its exact (route, rule) and reason. The honest
fix makes the list the actual panel, which means moving a `</Tabs>` past a
~200-line conditional region on a 1,400-line customer door; ToggleGroup trades
it for a visual regression and a hand-rolled radiogroup loses Radix's
roving-tabindex keyboard behaviour. It wants a visual check.

KNOWN_CRITICAL is deliberately not a threshold — a count-based baseline lets the
next violation hide inside the allowance. It names the pair, and the spec FAILS
an entry that stops reproducing, so a fix forces the entry out rather than
leaving a stale exemption to cover the next regression.
Falsified: grow the register -> RED; remove the self-expiry check -> RED.
Resolving commits: 83498d66

### DEFECT-0096
Title: Two live writers posted the same borrower Checkout Session differently
Severity: P1
Status: FIXED
Surfaced by lenses: "AcreOS at full maturity" research report (§17), pinned at
`a2dc971`, re-verified at `9cb534f` on 2026-09-27
(docs/audits/research-2026-09-27-maturity-frontier.md)
Description: A borrower's card payment on the serviced-note book was posted by
the browser return (`POST /api/borrower/verify-payment`) AND by the Stripe
Connect webhook (`WebhookHandlers.processBorrowerPortalPayment`), and the two
disagreed about what the money meant. The browser path split in integer cents
via `splitPaymentCents`, applied the grace-aware late fee, wrote with
`INSERT … ON CONFLICT (transaction_id) DO NOTHING`, and emitted
`payment.received`. The webhook split with a FLOAT ratio of the next schedule
row (`.toFixed(2)`), hard-coded `lateFeeAmount: "0"`, deduped with a
read-then-write on `storage.getPayments().some(...)` that races on redelivery,
never emitted the workflow event, sent the only receipt email, and posted
sessions whose `payment_status` was still `unpaid`. Which writer ran first was
decided by network timing — Stripe documents no ordering between the landing
page and the webhook — so the same $100 could land as $10 or $20 of interest,
with or without a $25 fee, with or without a receipt, depending on whether the
borrower kept the tab open. Both writers also marked the next installment
`paid` and moved the due date one month for ANY amount, so an authorized $50
against a $100 installment showed the borrower nothing due next month.
Evidence: `server/routes-borrower.ts` (before: the inline body of
verify-payment, split/late-fee/tx/schedule); `server/webhookHandlers.ts`
`processBorrowerPortalPayment` (before: float ratio split, `lateFeeAmount:
"0"`, `getPayments().some`, no emit); `server/services/stripeConnect.ts`
dispatch on `checkout.session.completed` with `metadata.type ===
"borrower_portal_payment"`. Client `client/src/pages/borrower-portal.tsx`
always sends `monthlyPayment`, but `POST /api/borrower/payment` accepts any
`amount`.
Remediation plan: Done. ONE posting rule,
`server/services/borrower/portalPaymentPosting.ts`
`postBorrowerPortalCheckoutPayment`, called by both writers. It owns the
refusals (`payment_status !== "paid"`, `metadata.noteId` mismatch), the exact
decimal→cents split, the grace-aware late fee, the idempotent org-scoped
transaction, the installment rule (an amount below `monthly_payment` leaves the
installment `pending` and the due date put, reported as `installment:
"partial"`), the pending-checkout slot clearing, the `payment.received` event,
the activation event, and the one receipt — all on the winning writer only.
The webhook and the route keep what is theirs: session/ownership and the
connected-account `retrieve`. The legacy token writer stays behind its 410
sunset, untouched — RESIDUAL: it keeps its own divergent posting rule and a
future `BORROWER_PORTAL_SUNSET_DATE` would revive it; it is also what holds
`legacyNoteModelIsTerminal`'s `splitPaymentCents` floor at 3, so deleting it
is a deliberate, test-adjusting act, not a cleanup.
Falsified (`tests/unit/borrowerPortalPaymentPosting.test.ts`): browser-first
vs webhook-first ledger facts differ -> RED; $50 on $100 marks the installment
paid -> RED; second writer inserts a row, emits, or emails -> RED; unpaid
session writes anything -> RED. `tests/integration/stripeWebhooks.test.ts`
updated (not deleted): the row must land through the ON CONFLICT insert, the
duplicate is a constraint conflict rather than a stale read, and an `unpaid`
session posts nothing.
Resolving commits: (this branch)

### DEFECT-0097
Title: Borrower payoff quote was off-engine, keyed by a URL token, and promised 30 days it never computed
Severity: P1
Status: FIXED
Surfaced by lenses: research report §24, re-verified at `9cb534f` on 2026-09-27
Description: `GET /api/borrower/payoff-quote` authenticated with the note's
long-lived access token plus the borrower's email in the QUERY STRING (the one
borrower route not behind `validateBorrowerSession`; a token in a URL is a
token in every proxy and application log on the path), computed the payoff in
floating-point dollars with the accrual start GUESSED as `nextPaymentDate − 30
days`, persisted nothing, and returned `daysValid: 30` / printed "This quote is
valid for 30 days" while accruing interest only through today. At $10,000 and
12% that is about $98.63 of interest the borrower was told they would not owe.
`payoffInputsFromServicedNote` — written for exactly this route and proven in
`payoffEngineUnification.test.ts`, whose header lists the route as path #3 it
unified — had ZERO production callers. `note_payoff_quotes` already declared
`serviced_note` and `borrower_portal` enums; nothing wrote them.
Evidence: `server/routes-borrower.ts` payoff-quote route (before);
`server/services/notePaymentMath.ts:507` `payoffInputsFromServicedNote`;
`shared/schema/notes-vertical.ts` `PAYOFF_QUOTE_NOTE_SYSTEMS`,
`PAYOFF_QUOTE_CHANNELS`; `client/src/pages/borrower-portal.tsx` built the
`?accessToken=…&email=…` URL.
Remediation plan: Done. The route requires the borrower session; loads the
note by id AND the session's organization; derives inputs from the note's own
COMPLETED payment ledger via `payoffInputsFromServicedNote` (first production
caller), with each posting normalised to the LENDER's calendar day through
`dayInZone`/`resolveOrgTimeZone` — `payments.payment_date` is a timestamp and
handing the engine the instant floored Aug 3 → Aug 15 to eleven days;
computes with `computePayoffQuote`; records one `note_payoff_quotes` row
(`noteSystem: "serviced_note"`, `channel: "borrower_portal"`,
`goodThroughDate = payoffDate`, verbatim `engineInputJson`); returns cents on
the wire with the per-diem and a `pdfUrl`; renders the PDF from the RECORDED
row under `?quoteId=`. `lateFeesOutstandingCents` is `null` with the same
sentence the acquired book uses — not tracked, not asserted as zero. A past
payoff date is refused rather than floored. The client sends the session
cookie and shows "Good through {date}" plus the per-diem; the `{ bold: true }
as any` on the old PDF went with it (as-any ratchet 1239 → 1238).
Falsified (`tests/unit/borrowerPayoffQuoteRoute.test.ts`, run against the
pre-change source: 5 of 7 RED): query-string credentials accepted -> RED; no
`note_payoff_quotes` row / 13 guessed days instead of 12 ledger days -> RED;
"30 days" or `daysValid` in JSON or PDF -> RED; `quoteId` recomputes instead of
404 -> RED; recorded-quote read not pinned to org+note -> RED.
Resolving commits: (this branch)

### DEFECT-0098
Title: Overpayment residue is dropped by the borrower portal writers
Severity: P2
Status: FIXED
Surfaced by lenses: research report §17.2, DEFECT-0096's repair
Description: `splitPaymentCents` returns `residueCents` when a payment exceeds
the payoff (balance + one period's interest). Neither portal writer persisted
it before, and the shared posting rule does not either: the servicing book has
no unapplied-funds column, so `payments.amount` can exceed
`principal + interest + fees` with the excess having no ledger home.
Evidence: `server/services/notePaymentMath.ts` `SplitPaymentResult.residueCents`;
`server/services/borrower/portalPaymentPosting.ts` (comment at the split).
Remediation plan: An unapplied-funds row or a refund path, decided with the
founder — money custody rules apply. Until then the residue is neither invented
into principal nor into interest.
Fixed 2026-09-27: an overpayment beyond the payoff is no longer silent. The payment row keeps every cent received; after commit the posting rule writes a lender-visible activity entry (`borrower_payment_unapplied_overpayment`, naming the excess and the session) and a structured warning, returns `unappliedCents` in its result, and the borrower's receipt says the excess was not applied and that the lender will return it or contact them. Refunding or applying it stays the lender's decision — moving customer money is not AcreOS's. `borrowerPortalPaymentPosting.test.ts`: $100 on a $50 balance → $49.75 unapplied, told to both sides (RED before).
Resolving commits: (this branch, round 3 batch 2)

### DEFECT-0099
Title: Serviced notes cannot separate late fees assessed from late fees collected
Severity: P2
Status: OPEN
Surfaced by lenses: research report §24, DEFECT-0097's repair
Description: `payments.late_fee_amount` is fees COLLECTED. No serviced-note
record carries fees ASSESSED and still owed, so every serviced payoff quote
must pass `lateFeesOutstandingCents = 0` and say so (the acquired book records
the same limitation at `server/routes-notes.ts` `payoffResponseBody`).
Evidence: `server/routes-borrower.ts` payoff-quote route (comment at the
engine inputs); `server/routes-notes.ts` `lateFeesOutstandingNote`.
Remediation plan: An assessed-late-fee ledger on the serviced book, or an
explicit decision that serviced notes never carry them. Refuse, don't estimate,
meanwhile.
Resolving commits: —

### DEFECT-0100
Title: Legacy payoff surfaces still compute off the one engine
Severity: P2
Status: FIXED
Surfaced by lenses: research report §24, DEFECT-0097's design pass
Description: Three payoff computations remain outside `computePayoffQuote`:
the `payoff_quotes` CRUD reached through `server/routes-va-engine.ts` and
`server/storage/closingServicingRepo.ts`, the "calculate payoff" skill in
`server/services/agent-skills.ts`, and `calculateNotePayoff` in
`server/services/financialOSService.ts`. The consolidation debt is already
noted in `shared/schema/notes-vertical.ts` above `notePayoffQuotes`; dropping
`payoff_quotes` is what lowers the table-count baseline.
Evidence: paths above.
Remediation plan: Route each onto `computePayoffQuote` + `note_payoff_quotes`
when its surface is next touched; delete `payoff_quotes` in the same commit.
Fixed 2026-09-27: one function, `quoteServicedNotePayoff` (`server/services/notes/servicedNotePayoff.ts`), computes every serviced-note payoff through `computePayoffQuote` over the note's own completed ledger and records it in `note_payoff_quotes`. The borrower portal route calls it (unchanged behaviour, its tests green), and so does the operations agent's `processPayoff` skill, which had computed its own number: interest from the NEXT due date instead of the last payment, a 2–3% "early payoff discount" no note contains, a 30-day validity, rows in the legacy table. The discount option is removed (a request for one is answered with a note, same amount). `calculateNotePayoff` delegates to the engine, and `POST /financial/note-payoff` refuses a request without a live balance and a last-paid-through date instead of treating the original principal as the balance. The zero-caller `POST`/`PATCH /api/payoff-quotes` write routes are removed; reads remain. `servicedNotePayoffIsOneRule.test.ts` (skill = engine, no discount, past date refused — all RED on the old skill). NOT done: dropping the `payoff_quotes` table — deleting customer rows is a founder hard-stop; it has no writer left.
Resolving commits: (this branch, round 3 batch 4)

### DEFECT-0101
Title: Form 1099-INT generator casts the org as payer of interest it RECEIVED
Severity: P1
Status: FIXED — refusal posture (founder decision 2026-09-27: refuse generation pending qualified tax review)
Surfaced by lenses: research report §A/§12, re-verified at `9cb534f`
Description: `generateAnnualInterestReport` sets `requires1099` at $600 of
interest the organization COLLECTED from a borrower; `generate1099IntForms`
then names the organization as payer and the borrower as recipient of that
income, and `form1099Batch.ts` produces per-borrower PDFs, a 1096 and a FIRE
e-file from it. Form 1099-INT reports interest PAID to a recipient; interest
received on a note is the 1098 direction, which the separate `form1098Batch.ts`
already handles (and whose header describes form1099Batch as covering interest
orgs "pay out" — the code contradicts it). `tests/unit/bookkeeping1099.test.ts`
asserts the inverted reading.
Evidence: `server/services/bookkeeping.ts:251` (`requires1099`),
`generate1099IntForms` payer/recipient assignment; `server/services/form1099Batch.ts`
(`buildFormsFromAcquiredNotes` repeats the inversion: `recipientName:
a.payerName`); `server/routes-accounting.ts` `POST /1099-batch`
(owner/admin); client `client/src/pages/notes-tax-readiness.tsx` calls
`GET /api/bookkeeping/1099` and `POST /api/accounting/1099-batch`.
Remediation plan: Done as a POSTURE, not a tax determination.
`server/services/form1099Refusal.ts` `requireQualified1099Output()` refuses
with one structured 422 `not_qualified_filing_output` (details name
DEFECT-0101) on `GET /api/bookkeeping/1099`, the duplicate
`GET /api/bookkeeping/1099-int` and `POST /api/accounting/1099-batch`; the
founder passes; the ladder flag `tax.1099int.direction_reviewed` can open it
per org once the direction is settled; a flag-store error is a refusal (fails
closed). The batch route stamps `qualifiedBy` on the async outbox payload only
after that middleware passed, and `handle1099BatchGenerate` in
`server/worker.ts` refuses any payload without the stamp — so a row queued
before this landed cannot produce a FIRE file after it. The annual interest
report keeps `requires1099` and gains `requires1099Note` saying it counts
interest RECEIVED ≥ $600 and is not a filing determination. The
`/notes/tax-readiness` page renders the refusal in its existing `__refused`
card shape and its copy no longer promises issuance to borrowers;
`settings/tax-identity.tsx` and `bookkeeping.tsx` copy likewise. The generator
itself is untouched and still reachable by the founder, which is how the review
gets exercised against real data. `bookkeeping1099.test.ts` was extended, not
deleted (its filename is a statute-register enforcement ref).
Falsified (`tests/unit/bookkeeping1099.test.ts`, run with the refusal module
absent and the routes unwired: RED): customer with flag off -> 422 with
`details.defect`; founder -> next; flag on -> next; flag store throws -> 422;
unstamped worker payload -> refused; comment-stripped source pins that each of
the three route files registers the middleware on the line that reaches the
generator (per-file vacuity: the generator reference must still be present),
that the batch payload carries the stamp, and that the worker asserts before
generating.
Resolving commits: (this branch, slice C)

### DEFECT-0102
Title: Due-date detector calls a payment overdue on its due day and ignores grace and posted payments
Severity: P2
Status: FIXED
Surfaced by lenses: research report §F, re-verified at `9cb534f`
Description: `server/services/notePaymentDueDetector.ts:81-105` classifies
`nextPaymentDate < now` as `overdue` and emits `payment.missed` without reading
`gracePeriodDays` or the `payments` table; a midnight due date is overdue at
the 11:00 UTC scan on its own day. The mesh event is published, then
`emitPaymentMissedForFinding` calls the in-memory `workflowEngine.emit`
unawaited (`:239-265`), so a crash between the two loses the collection task
under the dedupe key. Registered `server/jobs/expiryDetectorJobs.ts:22-44`.
Remediation plan: Distinguish due / unpaid-after-due / within-grace /
actionably-delinquent from the schedule plus payment observations; make the
workflow handoff durable or reconcilable. Tests for midnight UTC, grace
boundary, payment posted before scan.
Fixed 2026-09-27: the classifier works on calendar days (a payment due today is due-soon at the 11:00 UTC scan, not overdue) and honours the note's stated grace period (`noteGracePeriodDays`, unstated = 0 grace, the posting rule's reading); `overdue` fires only after due day + grace. The scan selects `grace_period_days`. A posted full installment advances `nextPaymentDate`, which is how posted payments reach this scan. Four boundary cases in `paymentWorkflowEvents.test.ts` (three RED before). The durable-handoff half (mesh publish then an unawaited in-memory workflow emit) is the same defect as DEFECT-0114 and is tracked there.
Resolving commits: (this branch, round 3 batch 2)

### DEFECT-0103
Title: A parked collection reminder is sent with stale content; one org's backlog can starve others
Severity: P2
Status: FIXED
Surfaced by lenses: research report §22, re-verified at `9cb534f`
Description: `server/services/financeAgent.ts:500-666` `dispatchReminder`
re-reads the note but refuses only if it is missing or not `active` — it does
not recheck the due period, balance or content, so a reminder parked
`awaiting_approval` and tapped after the borrower paid sends the old amount
(`sendManualReminder` `:914-1041`, `humanApproved: true`).
`server/storage/paymentRemindersRepo.ts:70-93` selects `scheduled`/`queued`
across all orgs, oldest first, LIMIT 50 (within a 14-day retry window), so 50
blocked reminders from one unconnected sender fill every 30-minute batch.
Remediation plan: Pre-send revalidation bound to due period, balance and
content version; `nextAttemptAt` with backoff and per-org fair selection;
expose oldest-unattempted-due age.
Fixed 2026-09-27: `dispatchReminder` recovers a ladder rung's period from its row (`scheduledFor` − the rung's offset) and cancels the notice, unsent, when the note's schedule has moved a full period past it (the borrower paid); a 20-day margin keeps a manual off-ladder row from reading as an older period. The parked-row lookup now carries `scheduledFor`. `getDispatchableReminders` selects the orgs with due rungs and gives each an equal share of the batch (oldest first within the org), so one org's blocked backlog cannot fill every sweep. Tests: `financeLadderAsksThroughKernel.test.ts` (paid period cancelled — RED before; unpaid period sent; manual row not mistaken) and `reminderBatchIsFairAcrossOrgs.test.ts` (60 old blocked rungs from one org vs 3 from another — RED before). Not added: a per-row `nextAttemptAt` backoff and an oldest-unattempted-age metric (both need a column).
Resolving commits: (this branch, round 3 batch 3)

### DEFECT-0104
Title: An SMS recipient matching no lead is classified transactional and skips consent; the AI phone-only tool has no consent check
Severity: P1
Status: FIXED
Surfaced by lenses: research report §19, re-verified at `9cb534f`
Description: `server/services/smsService.ts` loaded every lead phone in the
org per send, `.find()`-ed the first last-10-digit match, and when nothing
matched treated the destination as transactional — lead consent, quiet hours
and the frequency cap were skipped (DNC scrub still ran with `leadMatched:
false`, and is inert without `DNC_SCRUB_PROVIDER`). `server/ai/tools.ts`
`send_sms` accepted `phone_number` without `lead_id` and its phone-only branch
checked only area-code quiet hours and the daily rate limit. Two leads sharing
a number with contradictory consent resolved by row order, in the send gate
AND in `processOptKeyword`, so a STOP could revoke one row and leave the other
textable. `POST /api/sms/send` ran its own copy of the same first-match scan.
Accepted-but-failed after the SID (§19.2) was weaker than reported: only the
dynamic import could throw after acceptance.
Remediation plan: Done (founder decision 2026-09-27: servicing texts fail
open on a DNC scrub error; prospecting stays fail-closed). `sendOrgSMS` takes
a params object with a declared `purpose`, so the compiler found every caller:
- `prospecting` — every lead at the number (via the new org-scoped
  `storage.findLeadsByPhoneLast10`, `server/storage/leadRepo.ts`, on the
  trigram-indexed `phone_normalized` column) must pass consent and quiet
  hours; no lead → refused; a named `leadId` not at the number → refused; DNC
  fails closed; frequency cap applies and a touch is recorded.
- `servicing` — must name a note; the destination must be that note's
  borrower-of-record phone; STOP / `doNotContact` and quiet hours block; the
  marketing consent flag is not required; DNC fails open
  (`DncGateInput.scrubErrorPosture`, `server/services/compliance/dncScrub.ts`);
  no frequency cap, no touch. Borrower reminders from `server/services/financeAgent.ts`
  declare it through `communications.sendToLead({ purpose, noteId })`.
- `reply` — only when the number texted the org in the last 24 hours
  (`storage.hasRecentInboundSmsFrom`, `server/storage/commsRepo.ts`, reading
  attached threads and the unattached-inbound table, every table org-scoped);
  a STOPped lead at the number blocks; DNC fails open; no touch.
Callers: the AI tool (lead → prospecting; bare number → prospecting if any
lead is on file, else reply), campaigns, sequences, the autopilot hand
(prospecting), `/api/sms/send` (zod-validated purpose, own scan deleted),
`/api/leads/:id/sms` (reply inside a live thread, else prospecting). The SID
is captured before bookkeeping, and a ledger/touch failure after it is logged,
not reported as a failed send. The inbound STOP handler and `processOptKeyword`
apply to EVERY lead at the number, soft-deleted rows included.
Falsified (RED on the pre-change source):
`tests/unit/smsGateAndCapture.test.ts` — the case that asserted an unmatched
number "passes without the gate" is INVERTED to refused; two leads on one
number with one refusal → refused; servicing to the borrower without marketing
consent → sent, no touch; servicing to another number, to a STOPped borrower,
in quiet hours, or naming no note → refused; reply with/without a recent
inbound; a touch-ledger throw after the SID → still `{success:true, messageId}`.
`tests/unit/smsOptKeywordReachesEveryLead.test.ts` — a STOP from a shared
number writes two revocations (one before). `tests/unit/dncScrub.test.ts` —
declared `fail_open` allows a lead-matched scrub error, declared `fail_closed`
refuses an unmatched one, `fail_open` never passes a litigator.
Follow-up (independent audit, same day): a STOP from a number matching no
lead was written nowhere, so a `reply` to that number inside 24 hours of an
earlier text could still go out. The STOP is now stored as an unattached
inbound, and the reply gate reads the number's LATEST inbound
(`storage.latestInboundSmsFrom`) and refuses when it is an opt-out keyword
(`smsGateAndCapture.test.ts`, RED without it).
Still owed: legal review of the servicing-text DNC posture; inbound reply
attribution in `handleIncomingSMS` still uses a loose substring match to pick
ONE lead (attribution, not consent — recorded, not changed);
`server/services/comms/smsProvider.ts` `sendSms` has no gate and would fall
back to platform credentials — zero callers today, retire it.
Resolving commits: (this branch, slice D)

### DEFECT-0105
Title: A mail piece accepted by the provider can be marked failed and fully refunded; a failed outward action can be retried by two workers
Severity: P2
Status: FIXED
Surfaced by lenses: research report §14, re-verified at `9cb534f`
Description: `server/services/mail/mailFlusher.ts:239-294` `flushOne` marks
every piece and the shipment `failed` and refunds the full debit on ANY
exception, including a per-piece write-back after the provider accepted a
piece. `server/services/mail/providers/lob.ts:123-145` passes no per-piece
idempotency key, so `directMailService.ts:368` skips the outward-action guard;
`mail/router.ts:219-242` fails the whole shipment over to the next provider
(only Lob enabled by default). `server/services/actions/outwardAction.ts:330-339`
re-executes a `failed` row with an UPDATE by id and no `status = 'failed'`
predicate, so two retrying workers can both run `exec()`.
Remediation plan: Durable logical piece identity across providers; accepted /
rejected / unknown per piece; fail over only on proven non-acceptance;
conditional single-winner claim on retry.
Fixed 2026-09-27: (1) `withOutwardAction` re-claims a `failed` row only `WHERE status = 'failed'`; the losing worker gets `ActionInFlightError` and never runs exec (`outwardActionRetryIsSingleWinner.test.ts` races two workers through a barrier — exec ran twice before). (2) Adapters that fail after accepting pieces throw `PartialMailSendError` carrying the accepted prefix (Lob and PostGrid; PostGrid's per-piece ledger post can no longer turn an accepted piece into a throw); the router never fails that over. (3) `flushOne` separates the provider call from the write-back: nothing accepted → failed + full refund (unchanged); partially accepted → accepted pieces `sent` with their provider ids, the rest `failed`, and only the unsent share refunded; fully accepted but the write-back throws → logged with the provider ids for reconciliation, never refunded. (4) Each routed piece carries a durable `pieceRef` (`mail_piece:<id>`); the Lob adapter passes it as the letter's idempotency key, and a replay (`LetterAlreadySentError`) is recorded as accepted with its real id. `mailPartialSendIsSettledPerPiece.test.ts` drives the real flusher and router (three flusher cases RED on the old flusher). Still owed: postcards have no provider-side idempotency key in `directMailService.sendPostcard`.
Resolving commits: (this branch, round 3 batch 3)

### DEFECT-0106
Title: Subscription lifecycle is split across borrower money paths
Severity: P2
Status: OPEN — policy decision owed
Surfaced by lenses: research report §29, re-verified at `9cb534f`
Description: The monthly periodic-statement job selects only orgs with
`subscription_status = 'active'` (`server/jobs/runScheduledJobs.ts:2264`); the ACH
autopay cycle (`server/services/achAutopay.ts:1067-1078`) and the borrower card
routes carry no org subscription filter; the pause gate
(`server/middleware/subscriptionPauseGate.ts`) governs the org's own writes.
A cancelled org's borrower can still pay and be debited while statements stop.
Remediation plan: A live-obligations inventory at pause/cancel and one
explicit policy per state (new debits, in-flight reconciliation, statements,
export/handoff). The choice is the founder's; continuing borrower access may be
the protective default, but then the associated duties continue too.
Resolving commits: —

### DEFECT-0107
Title: Blind-offer comps include a USDA survey average and a SYNTHETIC trend point, so the zero-comp refusal is unreachable
Severity: P1
Status: FIXED
Surfaced by lenses: research report §I, re-verified at `9cb534f` — and worse
than reported
Description: `server/services/blindOfferCalculator.ts` `buildCompDataset`
pushed `nassData.pasturePerAcre` and the prior-year `LandValueTrend` value as
`CompData` with source `"usda_nass"`, and `analyzeComps` treated every entry
as a sale. `server/services/usdaNassService.ts` synthesises five years from a
state default at 5%/yr marked `source: "estimate"`, `buildTrendFromValues`
dropped the source, and the trend fell back to it whenever NASS had nothing —
so the trend ALWAYS had two or more years, `compCount` was never 0, and the
insufficient-data refusal fired only if the trend call threw. A statewide
average (or a guess) could therefore set the price printed on a mailed
letter, and a $500 USDA figure undercut three real sales at $1,100+. The
snapshot backfilled pasture from 60% of the farm average and returned 0 when
it had neither. The synthetic trend's flat 5% read as a "sellers market"
everywhere. Every tier promised an acceptance rate ("~3 in 5 sellers") nothing
had measured. The wizard had no refusal type and crashed on one; the map's
inline composer rendered "Offer modeled from USDA land values" and handed an
undefined price to Pax. `tests/unit/offerAndRankHonesty.test.ts` mocked the
trend to `null`, hiding all of it, and `tests/unit/landExitModelDelegates.test.ts`
mocked a module path that does not exist.
Remediation plan: Done (founder decision 2026-09-27: render refusal, link to
wizard). `analyzeComps` drops any row whose source is a benchmark
(`usda_nass`, `estimate`) or whose price per acre is not a finite positive
number, and names the drop; `buildCompDataset` is deleted. USDA figures live
only in `marketContext.benchmarks` with provenance (`LandValueTrend.source`,
`CountyAgSnapshot.pastureSource`); `usdaLandValuePerAcre` is shown only for a
measured NASS county pasture value and `usdaCagr5Year` only for an all-NASS
series. Market condition moves only on a measured trend. The refusal's
`missing[]` no longer offers USDA as a price substitute. Every
`acceptanceRateForecast` is null and no reason string states a rate. The
wizard renders the refusal (what is missing, back to comps) and its campaign
sizing card no longer shows "~60% / 3 of 5 / ~42 letters"; the map composer
renders "Not enough comparable sales to price an offer" with a link to the
wizard and never hands Pax a refused offer.
Falsified (RED on the pre-change source, 11 cases):
`tests/unit/blindOfferCalculator.test.ts` now drives the REAL `analyzeComps`
and `calculateBlindOffer` (its inline copy returned 1000/2000/5000 for an
empty set): a USDA/estimate row is not counted; a non-positive price is not a
sale; no sales + measured pasture + estimate trend → refused with no offer
fields; with real sales the offer comes from the lowest SALE, not a lower USDA
figure; an estimate or provenance-less trend cannot declare a hot market;
every tier forecast is null and no "N of/in M" rate appears in the report.
`tests/unit/offerAndRankHonesty.test.ts`: a farm-derived pasture figure and a
zero "none" figure are null; a measured USDA value with no sales, and the
estimate trend with no sales, are refused.
Still owed: `sizeCampaign`'s 0.6 default acceptance is an unmeasured
convention (comment says so; value unchanged); other USDA consumers
(`marketPulseEngine.ts`) still render trend figures without the new
provenance, and `sizeCampaign` still states an unmeasured 4% response rate;
`POST /api/data-intel/blind-offer/commit` accepts any client `offerAmount`
(the refusal is enforced in the client only); the map composer sends no
comps, so it now always refuses until a comp source is wired to it. See
DEFECT-0121 to 0124.
Resolving commits: (this branch, slice B)

### DEFECT-0108
Title: Portfolio P&L treats every closed deal as a sale and annualises an undated sequence
Severity: P2
Status: FIXED
Surfaced by lenses: research report §28, re-verified at `9cb534f`
Description: `server/services/portfolioPnl.ts:95-110` selects closed deals
without `deals.type` (acquisition vs disposition), aliases `offerAmount` as
purchase price and `acceptedAmount` as sale price; `calculateIrr` (`:71-86`)
discounts by array index with no dates; `:185` counts
`interestPortion ?? amount` as interest. Page `client/src/pages/portfolio-pnl.tsx`
(sidebar-hidden, URL-reachable).
Remediation plan: Respect deal type; dated cash flows or no IRR; unsplit
payments shown as unclassified. Label projected vs realised.
Fixed 2026-09-27: closed deals are split by `deals.type`: an acquisition's agreed price (`acceptedAmount`, else the recorded offer) is a cost, a disposition's is proceeds — the old code read every deal as both. IRR is XIRR over dated flows (null without a sign change or convergence), replacing the index-discounted series. Interest income is the interest portion only; the `?? amount` fallback that counted principal as interest is gone. `portfolioPnlHonesty.test.ts` (acquisition not proceeds, disposition not cost, one-year vs two-year doubling, interest split — RED before).
Resolving commits: (this branch, round 3 batch 4)

### DEFECT-0109
Title: Owner-finance projection double-counts the down payment as interest
Severity: P2
Status: FIXED
Surfaced by lenses: research report §3, re-verified at `9cb534f`
Description: `server/services/financialOSService.ts:461-465` computes
`totalInterestEarned = totalCollected - (salePrice - downPaymentReceived)`
where `totalCollected` already includes the down payment. Route
`POST /api/financial/deal-pnl` (`routes-epic-services.ts:352`); no client
caller found. `tests/unit/dealPnlSingleOwner.test.ts` never asserts it.
Remediation plan: `totalCollected - salePrice`, with a fixture ($10k / $2k
down / $9k installments → $1k, not $3k).
Fixed 2026-09-27: `totalInterestEarned = totalCollected − salePrice` (`totalCollected` already includes the down payment). `dealPnlSingleOwner.test.ts`: $10k sale, $2k down, 18 × $500 → $1,000, not $3,000 (RED before).
Resolving commits: (this branch, round 3 batch 2)

### DEFECT-0110
Title: Step-away readiness calls a recent FAILED DR drill "ready"
Severity: P2
Status: FIXED
Surfaced by lenses: research report §5, re-verified at `9cb534f`
Description: `server/services/autopilot/stepAwayReadiness.ts:342-344` returns
`status: "ready"` for a drill younger than 90 days even when `passed === false`,
with detail text saying MISSED; the check is `critical: false` (`:327`) so it
never blocks the verdict but inflates the ready count.
Remediation plan: A recent failed drill is `attention`; test no drill / stale
pass / recent fail / recent pass.
Fixed 2026-09-27: the verdict lives in `server/services/autopilot/drDrillStatus.ts`, imported by the readiness check: a recent drill that missed its RTO target (or recorded no pass/fail) is `attention`. `drDrillVerdict.test.ts` covers no drill, stale pass, recent fail, recent unknown, recent pass, and pins that the readiness check uses the verdict (RED before).
Resolving commits: (this branch, round 3 batch 2)

### DEFECT-0111
Title: AI router semantic cache ignores task type; quality grader failure scores 8
Severity: P2
Status: FIXED
Surfaced by lenses: research report §5, re-verified at `9cb534f`
Description: `server/services/aiRouter.ts:118-141` matches cached responses by
org + token-set Jaccard ≥ 0.72 (`:58`) regardless of `taskType`,
`responseFormat` or evidence; the entry (`:23-37`) carries none.
`checkResponseQuality` (`:276-278`) returns score 8 "assuming adequate" when the
grader fails.
Remediation plan: Constrain or disable semantic reuse for dynamic tasks; a
grader failure is `unknown`, not 8.
Fixed 2026-09-27: semantic cache entries carry `taskType` and `responseFormat` and are reused only for the same task and shape; a failed or scoreless quality grade is `score: null` ("not checked") and logged, never 8. `aiRouterSemanticCacheTaskScope.test.ts` drives the real router: same task paraphrase still hits (vacuity), different task or format misses (RED before), grader pin.
Resolving commits: (this branch, round 3 batch 2)

### DEFECT-0112
Title: Autopilot proceeds at full confidence when its calibration or risk read fails
Severity: P2
Status: FIXED
Surfaced by lenses: research report §E, re-verified at `9cb534f`
Description: `server/services/solene/continuousLoop.ts:1149-1156` keeps
`loopConfidence = 1` when the calibration read throws;
`server/services/autopilot/act.ts:239` swallows `assessRisk` failure to `null`
so `risk?.tier === "high"` is false; `forecast.ts:119-132` maps unproven to 0.4
— the fallbacks contradict each other.
Remediation plan: A failed supplementary check holds or narrows the action
class that required it; one durable incident.
Fixed 2026-09-27: a risk read that throws is treated as high risk and escalated for sign-off (`autopilot/act.ts`); the continuous loop's calibration confidence starts at 0.4 (unproven) instead of 1 when the calibration read fails (`solene/continuousLoop.ts`). `autopilotAct.test.ts`: a failing risk read escalates and does not enqueue; a successful low-risk read still acts; the loop's starting value is pinned (RED before).
Resolving commits: (this branch, round 3 batch 2)

### DEFECT-0113
Title: County-coverage request claims success on POST failure; an exhausted county re-pends but is never drained; a dead endpoint still reads "covered"
Severity: P2
Status: FIXED
Surfaced by lenses: research report §25, re-verified at `9cb534f`
Description: `client/src/components/maps/RequestCountyCTA.tsx:65-76` sets
`submitted = true` in `onError`. `server/services/coverageLedger.ts:127-136`
flips `exhausted → pending` without resetting `attempts`, and the worker
(`:641`) selects `attempts < maxAttempts`, so the row is pending forever.
`server/routes-county-coverage.ts:51-124` `resolveStatus` maps an old
`resolved` queue row to `covered: true` when no endpoint is active.
Remediation plan: A request id from the server before any acknowledgement;
attempt generation/backoff on re-request; `resolved` re-examined when its
endpoint goes inactive.
Fixed 2026-09-27: the county request form shows a destructive toast and keeps the entry when the POST fails, instead of the "Coverage requested" confirmation (`requestCountyCtaFailure.test.tsx`, a real render, RED before); a queue row reached with no active endpoint never reports `covered` (a `resolved` row there is "no longer responding"); a repeat request reopens an exhausted row AND a resolved row whose endpoint went inactive, and resets `attempts` so the drain (`attempts < maxAttempts`) picks it up (`coverageLedgerDiscovery.test.ts` pins the conflict update and the reopen condition; the SQL semantics themselves need Postgres).
Resolving commits: (this branch, round 3 batch 2)

### DEFECT-0114
Title: Scheduled detectors hand off to workflows through an unawaited in-memory emit (acquired-note aging, note due detector)
Severity: P2
Status: FIXED (round 3, 2026-09-27) — both detectors hand off through the outbox
Surfaced by lenses: research report §14.2, re-verified at `9cb534f`
Description: `server/jobs/acquiredNoteAging.ts:469-496` updates the status,
increments `transitioned`, then `emitAgingTransitionEvent` calls
`emitPaymentEvent` unawaited with `entityId` hard-coded `0` (`:380`) and
swallows errors (`:398-406`); `workflow-engine.ts:1959-1966` queues in memory.
A crash after the status write loses the follow-up and the next sweep does not
re-emit.
Also `server/services/notePaymentDueDetector.ts` `emitPaymentMissedForFinding`
(the durability half of DEFECT-0102): the mesh event is published, then the
in-memory `workflowEngine.emit` runs unawaited, so a crash between the two
loses the collection workflow under a dedupe key that will not re-emit.
The entity id 0 is a documented convention (acquired notes are uuid-keyed;
the real id travels as `data.noteId`), not a defect on its own.
Remediation plan: DONE, on the outbox the repository already runs (`outbox`
table, `server/worker.ts`, retries and a dead-letter queue) — no new
infrastructure.
- `server/services/workflowOutbox.ts` `stageWorkflowEvent` writes a
  `workflow_trigger` row on the caller's executor. `emitDurablePaymentEvent`
  in `workflow-engine.ts` is the durable sibling of `emitPaymentEvent`, named
  so the live-trigger derivation in `workflowActionHonesty.test.ts` still
  counts it as an emitter.
- Aging sweep: the status update and the staged trigger now run in ONE
  `db.transaction`. A failed stage rolls the status back, so the next sweep
  sees the transition again.
- Due detector: the trigger is staged BEFORE the mesh publish (the ledger that
  makes a finding old news), keyed by the finding's dedupe key. A staging
  failure skips the publish, so both retry next run. A publish failure after
  staging does not stage twice.
- Worker: `workflow_trigger` rows are drained by `drainWorkflowTrigger`, which
  AWAITS `workflowEngine.triggerWorkflows`. An engine failure propagates to the
  outbox retry and dead-letter path. A malformed payload is refused
  terminally.
Delivery is now at-least-once. A workflow that throws part-way through a drain
can run again on the retry, where the in-memory path lost the event instead.
AUDIT FOLLOW-UP (same day, independent completeness audit): four more
scheduled emitters had the same shape and are now durable too. ACH autopay
settlement stages `payment.received` keyed by payment id BEFORE linking the
attempt, on every pass, so a crash leaves the attempt in flight and the next
pass recovers. Parcel alerts stage on the alert insert's transaction. The
certificate redemption clock stages on its system_alerts marker's transaction.
The note balloon lane stages before its mesh publish. The in-memory
`emitParcelEvent` and `emitNoteEvent` had no callers left and were replaced by
their durable forms. The gate now enumerates both populations: the scheduled
hand-offs, and EVERY file calling an in-memory emit helper. That second set is
derived from the engine's exports and compared both ways with a classified
register, so a new in-memory call site fails until someone classifies it.
Falsified by: `tests/unit/workflowHandoffIsDurable.test.ts` (the real sweep
issues the status update and the outbox insert on one transaction handle; a
failed insert fails that note; the drain awaits, propagates and refuses; the
worker registers it), plus the rewritten cases in
`tests/unit/paymentWorkflowEvents.test.ts` and
`server/services/notePaymentDueDetector.test.ts` (stage before publish; a
staging failure skips the publish). Eight assertions red on the pre-fix
sources.
Resolving commits: this branch, round 3

### DEFECT-0115
Title: Founder runway labels reserve buckets as cash on hand and tier MRR as revenue
Severity: P2
Status: FIXED
Surfaced by lenses: research report §G, re-verified at `9cb534f`
Description: `server/services/finance/runwayModel.ts:409-426` sums three
internal ledger reserve buckets as `cashOnHandUsd`, substitutes
`FOUNDER_CASH_ON_HAND_USD` when larger, and offsets burn with tier-priced MRR
from active org rows (`:312-333`). Present as described; the arithmetic is
fine, the label is not: none of it is a reconciled account balance.
Remediation plan: Two named views — observed liquidity (unknown until a bank /
payout feed exists) and planning runway — and the audit verdict says
`unknown`, not green, when the former is absent.
Fixed 2026-09-27: the runway result names what its cash figure is (`cashLabel`: "Planning cash (ledger reserve buckets; not a bank balance)" or the founder-declared variant), reports `observedLiquidityUsd: null` (unknown until a bank or payout feed exists) and labels MRR as list price for active orgs (billed, not collected). The founder money page and the runway-crunch audit detail print those labels instead of "Cash … (ledger)". `financeAudit.test.ts` pins the detail wording (RED before). The arithmetic is unchanged.
Resolving commits: (this branch, round 3 batch 4)

### DEFECT-0116
Title: Payment-Link borrower payments are posted by a third writer with float math and no refund reversal
Severity: P2
Status: FIXED
Surfaced by lenses: independent completeness audit of DEFECT-0096's repair, 2026-09-27
Description: `server/services/stripeConnect.ts` `handleSuccessfulPayment` posts
a note payment on `payment_intent.succeeded` for Payment Links the same file
creates with `payment_intent_data.metadata.paymentType = "note_payment"`. It
splits with float `currentBalance * monthlyRate`, applies no late fee, and
marks the schedule row paid whatever the amount — the shape DEFECT-0096
removed from the portal writers. It does not collide with portal Checkout
(`buildBorrowerCardCheckoutParams` sets no `payment_intent_data`), but the
refund handler matches only `borrower_portal_payment` sessions, so a refunded
Payment-Link payment is never reversed on the note.
Evidence: `server/services/stripeConnect.ts` (`handleSuccessfulPayment`, the
Payment Link creation); `server/webhookHandlers.ts` refund handler's
`borrower_portal_payment` match.
Remediation plan: Done (founder decision 2026-09-27: unify links, retire the
Accept-payment modal). The Connect `checkout.session.completed` dispatcher in
`server/services/stripeConnect.ts` now also routes sessions with
`metadata.paymentType === "note_payment"` (a lender-shared Payment Link) to
`WebhookHandlers.processPaymentLinkNotePayment`, which verifies that
`event.account` IS the metadata org's connected account
(`storage.findOrganizationIntegrationByCredential`), loads the note under that
org, and calls the one posting rule with `source: "payment_link"` — cents
split, grace late fee, ON CONFLICT insert keyed on the SESSION, partial-
installment rule, `payment.received`, one receipt. `handleSuccessfulPayment`
is now log-only: two writers keyed on `pi_…` and `cs_…` cannot be deduped by
ON CONFLICT and Stripe orders the two events arbitrarily. The refund handler's
session filter accepts `paymentType === "note_payment"` too, so Payment-Link
refunds reverse. STRIPE ASSUMPTION to confirm in the sandbox before merge to
main: Payment Link `metadata` is copied onto the Checkout Session it creates
(documented behaviour; fallback is `paymentLinks.retrieve(session.payment_link)`).
Falsified (`tests/unit/paymentLinkPostsThroughSharedRule.test.ts`, RED on the
pre-change dispatcher): a `note_payment` session posts one row keyed on the
session with the cents split and emits `payment.received` with
`source:"payment_link"`; the same session from another connected account posts
nothing; `payment_intent.succeeded` for a `note_payment` PaymentIntent calls
neither `storage.createPayment` nor `storage.updateNote`;
`refundReversesLedgerAnd1098.test.ts` gains a Payment-Link refund that appends
a reversal row.
Follow-up (independent audit, same day): a delayed-settlement method (ACH on
a Payment Link) completes its session UNPAID, which the rule refuses, and
settles as `checkout.session.async_payment_succeeded`. The retired PaymentIntent
writer had been posting those; with it gone nothing did. That event now routes
to the same rule and is in `STRIPE_CONNECT_WEBHOOK_EVENTS`
(`paymentLinkPostsThroughSharedRule.test.ts` cases 6–7, RED without it).
OPERATIONAL STEP OWED: a Connect webhook endpoint created before this change
does not subscribe to the new event until the setup route re-registers it.
Resolving commits: (this branch, slice A + audit follow-up)

### DEFECT-0117
Title: Client copy still promises 1099-INT issuance to borrowers
Severity: P2
Status: FIXED
Surfaced by lenses: DEFECT-0101's repair scope, 2026-09-27
Description: With generation refused (DEFECT-0101), several surfaces still
describe 1099-INT as a form the org sends its borrowers: `client/src/pages/finance.tsx`
(:541 "prepares your 1099-NEC at year-end", :2127, :2179, :2208),
`client/src/pages/settings.tsx:916-919`, `client/src/pages/settings/tax-identity.tsx`
badges (:265 "1099 issuance enabled", :273 "Blocks 1099 issuance"),
`client/src/lib/glossary.ts:131-134`, `client/src/pages/notes.tsx:552,561`,
`client/src/pages/note-detail.tsx:698`, `client/src/components/note-tin-editor.tsx`,
`client/src/components/layout-sidebar.tsx:507`, and the note-investor persona
copy in `server/services/pax/personas.ts:277,299` (pinned by
`server/services/pax/personas.test.ts:209`).
Remediation plan: Reword to "year-end interest reporting" once the tax review
decides which form is owed; update the persona test with the persona copy.
Fixed 2026-09-27: every borrower-direction promise of 1099-INT issuance is reworded to what the product does (it keeps each borrower's year-end interest totals; the 1099-INT output is withheld pending review): `finance.tsx` (which also named the wrong form, 1099-NEC), `settings.tsx`, `settings/tax-identity.tsx` badges and toasts, `glossary.ts`, `notes.tsx`, `note-detail.tsx`, `note-tin-editor.tsx`, `note-record-payment-modal.tsx`, `notes-import-dialog.tsx`, `today-vertical-surfaces.ts`, the sidebar description, and the Pax note-investor persona (`server/services/pax/personas.ts`, pinned in `personas.test.ts`: the voice may not say "1099-INT per borrower" and must say it is withheld). Mentions of 1099-INT for interest the organization PAYS its co-investors (note splits, investor statements) are the correct direction and stay.
Resolving commits: (this branch, round 3)

### DEFECT-0118
Title: Tax-readiness success card expects PDFs the batch route never returns
Severity: P2
Status: FIXED
Surfaced by lenses: DEFECT-0101's repair scope, 2026-09-27
Description: `client/src/pages/notes-tax-readiness.tsx` renders download links
for `recipientPdfs`, `transmittalPdfBase64` and `fireFile` from the
`POST /api/accounting/1099-batch` response, but the route returns only
`{jobId, status, formCount, totalInterestCents, fireRecordCounts, fireFileBytes, errors}`
(`server/routes-accounting.ts`) and `form1099Batch.ts` persists only
`resultBlob` (the FIRE text and a summary; the PDFs are never stored). The
success card therefore shows a header with no downloads. Moot while
DEFECT-0101 refuses generation; relevant the day the flag is turned on.
Remediation plan: Decide where artifacts live (persist or stream) before the
flag is ever enabled; align the response type with the page.
Fixed 2026-09-27: `POST /api/accounting/1099-batch` now returns `recipientPdfs`, `transmittalPdfBase64` and `fireFile` from the batch it just built (`tests/unit/form1099BatchResponseCarriesArtifacts.test.ts`, RED before). Still behind the DEFECT-0101 refusal.
Resolving commits: (this branch, round 3)

### DEFECT-0119
Title: "Accept payment" charged one hundred times the entered amount and could not complete
Severity: P1
Status: FIXED — by removal
Surfaced by lenses: independent completeness audit of DEFECT-0096, 2026-09-27;
scoped for DEFECT-0116
Description: `client/src/pages/finance.tsx` `AcceptPaymentModal` sent
`Math.round(Number(amount) * 100)` (cents) to `POST /api/stripe/connect/payment-intent`,
and the route (`server/routes-billing.ts`) treated the value as dollars and
multiplied by 100 again before `createCustomerMoneyPaymentIntent` — a $500
installment became a $50,000 PaymentIntent on the lender's connected account.
The modal then displayed the client secret and account id with no Stripe.js
confirm flow, so the intent could rarely be completed, which is the only reason
the hundredfold amount is not a known incident. No test covered either half.
Evidence: (before) `finance.tsx` `handleCreatePaymentIntent`; `routes-billing.ts`
`Math.round(amount * 100)` on an already-cents body value.
Remediation plan: Done — the modal, its button and state, the route, its zod
schema, and `createPaymentIntent`/`createCustomerMoneyPaymentIntent` in
`stripeConnect.ts` are removed (founder decision 2026-09-27). The lender's
card rail is the Stripe-hosted Payment Link, which charges `note.monthlyPayment`
server-side. `customerMoneyRouting.test.ts` UPDATED to pin the absence of a
PaymentIntent surface and that `getPaymentLink` still mints no PaymentIntent.
Falsified: `"createCustomerMoneyPaymentIntent" in stripeConnectService` -> RED;
a `payment_intent` resource created anywhere in `getPaymentLink` -> RED.
Resolving commits: (this branch, slice A)

### DEFECT-0120
Title: A dead lead SMS thread component posts to a route that does not exist
Severity: P2
Status: FIXED
Surfaced by lenses: DEFECT-0104's caller census, 2026-09-27
Description: `client/src/components/sms-conversation.tsx` sends with
`POST /api/communications/sms`, which no server route registers, so every
send from that component 404s and the toast blames the network. It reads
`GET /api/leads/:id/sms`, which also has no GET handler (only POST). No page
imports the component today, so no customer reaches it; the inbox page uses
the live `POST /api/leads/:leadId/sms` route instead.
Evidence: `client/src/components/sms-conversation.tsx`; no match for
`communications/sms` under `server/`.
Remediation plan: Retire the component (built but unwired), or, if a thread
view is wanted behind the Inbox door, point it at `POST /api/leads/:leadId/sms`
(which now declares reply/prospecting at the choke point) with a real GET. Not changed in the
DEFECT-0104 slice: it sends nothing today, so it cannot bypass the gate.
Fixed 2026-09-27: the component is deleted (`client/src/components/sms-conversation.tsx`, no importer) and its row removed from the date-format lint baseline. The same pass removed `sendSms`/`sendBulkSms` from `server/services/smsProvider.ts`: an ungated Twilio sender that fell back to platform credentials and had zero callers; only `getProviderInfo` remains.
Resolving commits: (this branch, round 3)

### DEFECT-0121
Title: The deal feed reads blind-offer fields that neither outcome has, so its offers fall back to percentages of assessed value
Severity: P2
Status: FIXED
Surfaced by lenses: DEFECT-0107's consumer census, 2026-09-27
Description: `server/services/dealFeedEngine.ts` calls `calculateBlindOffer`
and then reads `offerData.comps.medianSalePerAcre`, `offerData.tiers[i].offerTotal`
and `offerData.ownerFinanceScenario.annualYield`. The report's fields are
`compAnalysis.medianSalePerAcre`, `offerTiers.{aggressive,standard,competitive}`
and no `annualYield`; the refusal has none of them. Every read is undefined,
so the feed's three "suggested offers" are always 25% / 40% / 55% of the
parcel's assessed value and the calculator's result is discarded.
`tests/unit/dealFeedHonesty.test.ts` exercises the fallback, not the join.
Evidence: `server/services/dealFeedEngine.ts` (`estimatedValue`, `tierOrNull`,
`sellerFinanceYield`).
Remediation plan: Read `status === "ok"` outcomes by their real field names
(or drop the call if the feed should not price offers), and pin the join with
a test that fails when a field is renamed.
Fixed 2026-09-27: `dealFeedEngine.ts` types the calculator result as `BlindOfferOutcome`, reads `compAnalysis.medianSalePerAcre` and `offerTiers.{aggressive,standard,competitive}` from an `ok` outcome only, and reports `sellerFinanceYield` as null (no such figure exists). `dealFeedHonesty.test.ts`'s calculator mock used the same wrong field names as the engine; it now returns the real outcome shape, and the case that asserted a 40%-of-value market offer is rewritten to the calculator's own standard tier (RED before), with a refusal case for the assessed-value fallback. In practice the feed passes no comps, so the calculator refuses and the assessed-value fallback applies — now by design rather than by accident.
Resolving commits: (this branch, round 3)

### DEFECT-0122
Title: A comparable sale is not required to be dated or recent
Severity: P2
Status: FIXED
Surfaced by lenses: DEFECT-0107's repair scope, 2026-09-27
Description: The formula is "lowest sale in the last 12–18 months ÷ 4", but
`analyzeComps` in `server/services/blindOfferCalculator.ts` accepts undated
comps, and the wizard's comp form collects no sale date, so no caller could
supply one today. A ten-year-old sale can set a mailed price.
Remediation plan: Add a sale-date input to the wizard comp form and an
auto-pulled date, then require a date inside the window before a row counts.
Deferred out of the DEFECT-0107 slice because refusing undated comps before
the form can collect a date would refuse every manual comp.
Fixed 2026-09-27: one rule in `shared/blindOfferComps.ts` — a comp is a sale with a positive price, dated, not in the future, and inside 18 months — imported by `analyzeComps` AND by the wizard's live "lowest comp" preview, so the two cannot disagree. `GET /api/data-intel/county-comps` now returns the ATTOM `saleDate` (it survived only inside a free-text note); the wizard's manual comp form requires a sale date, shows each comp's date, and marks rows that will not count and why. Falsified in `blindOfferCalculator.test.ts` (six cases RED before, including the shared-rule adoption pin). `landExitModelDelegates.test.ts` fixtures used `soldDate`, a field nothing reads, and survived only because undated comps counted.
Resolving commits: (this branch, round 3)

### DEFECT-0123
Title: The parcel intelligence report prices an offer from USDA with a fabricated $1,000/acre default
Severity: P2
Status: FIXED
Surfaced by lenses: DEFECT-0107's consumer census, 2026-09-27
Description: `server/services/parcelIntelligenceFusion.ts` `buildOfferAnalysis`
sets `usdaPerAcre = pasturePerAcre || farmRealEstatePerAcre * 0.6 || 1000`,
calls that the "lowest comparable sale", and derives an offer, flip price and
owner-finance terms from it — the DEFECT-0107 shape in a second engine, with
an invented number when USDA has nothing. Served by
`POST /api/data-intel/parcel-intelligence` (`server/routes-data-intelligence.ts`);
no client caller was found in `client/src`, so reachable by API only.
Remediation plan: Delegate to `calculateBlindOffer` (one offer engine), or
return no offer when there is no real sale; delete the `|| 1000`.
Fixed 2026-09-27: `buildOfferAnalysis` returns `status: "no_comparable_sales"` with every price null and a note saying where the number comes from (the offer wizard, from real sales); the measured USDA value stays as context. The next-steps line that told the operator to mail an offer at `acres × $250` now points to the wizard. Pinned in `offerAndRankHonesty.test.ts` on comment-stripped source (the builder is private and the report reads eight external sources): no `|| <number>` fallback, no `× 0.25`, no `input.acres ×` in the offer section, and no `acres × <number>` in the next steps — RED before.
Resolving commits: (this branch, round 3)

### DEFECT-0124
Title: Lead intelligence quotes an owner an offer priced from the USDA pasture figure
Severity: P2
Status: FIXED
Surfaced by lenses: independent audit of the DEFECT-0107 repair, 2026-09-27
Description: `server/services/leadIntelligenceEngine.ts`
`computeOfferIntelligence` treats `pasturePerAcre` as the lowest comp, takes
25% of it as the offer, and interpolates the dollar amount into an owner
message ("My offer for your … County property is $X"). It ignores the new
`pastureSource`, so a farm-derived or synthetic estimate becomes a quoted
price — the DEFECT-0107 defect in a third engine. Served under
`/api/data-intel/lead-intelligence/*` (`server/routes-data-intelligence.ts`);
no client caller was found, so reachable by API.
Remediation plan: Price only from real sales through `calculateBlindOffer`,
or produce no offer amount; never put a benchmark-derived price in a message.
Fixed 2026-09-27: `computeOfferIntelligence` returns no offer: this engine has no comparable sales, and a USDA pasture value is a benchmark. The owner message uses the existing price-free wording. `countyContext.usdaLandValuePerAcre` reports only a measured NASS pasture value. The test that asserted a $9,000 quote from a 3000/ac USDA figure is REWRITTEN to the new truth (no price; the owner still gets a message naming the county) — RED before.
Resolving commits: (this branch, round 3)

### DEFECT-0125
Title: A 1099-INT FIRE file generated before the refusal is still downloadable
Severity: P2
Status: FIXED
Surfaced by lenses: independent audit of the DEFECT-0101 repair, 2026-09-27
Description: `GET /api/accounting/1099-batch/:jobId` in
`server/routes-accounting.ts` returns the stored `resultBlob` of a completed
batch job with no `requireQualified1099Output()` guard, so a batch produced
before the refusal landed (with the inverted payer/recipient) can still be
downloaded and filed.
Remediation plan: Put the same middleware on the download route, or refuse
any stored 1099-INT blob created before the direction review.
Fixed 2026-09-27: `GET /api/accounting/1099-batch/:jobId` carries `requireQualified1099Output()`; the route-registration pin in `bookkeeping1099.test.ts` now covers it (RED before).
Resolving commits: (this branch, round 3)

### DEFECT-0126
Title: Due-diligence dossiers reported a parcel nobody checked as clear title, taxes current, legal access and clean
Severity: P1
Status: FIXED
Surfaced by lenses: DEFECT-0107's consumer census (a flat $2,500/acre comp fallback), 2026-09-27
Description: `server/services/dueDiligencePods.ts` runs the pods behind the
properties page's "Generate AI dossier". When no data source answered — no
coordinates, or a provider failing without throwing — each pod returned a CLEAN
verdict: title `clear: true`, taxes `current: true` with $0 due, access
`legal: true` ("Road Access"), zoning "Agricultural/Residential" with two
allowed uses, comps at $2,500/acre (× acreage, default 5), and — because the
concerns list simply stayed empty — no environmental concerns. With partial
data, a missing road type was "Paved Road", a missing legal flag was legal, a
missing maintenance field was "County Maintained", a missing zoning was
"Residential", a parcel record with no lien fields was a clear title, and a
tax record with no delinquency flag was current. These became the green flags
"Clear title", "Taxes current", "Legal access confirmed", 100-point sub-scores
and the input to a buy/pass recommendation. (Conversely, a source that
explicitly returned empty lien lists read as NOT clear, because an empty array
is truthy.) The file's own error branches already said "manual review
required"; the no-data branches contradicted them.
Remediation plan: Done. Every no-data and error branch returns an explicit
`unverified: true` finding that is never clean, current or legal; with-data
branches report only what the source said ("Unknown" otherwise); a title is
clear only when the source carries lien/encumbrance fields and both are empty;
taxes are current only when the source states a delinquency boolean;
environmental is clean only when at least one source answered; comps with no
source carry no price. The recommendation raises one "Not verified (no data
source answered): …" red flag and awards no green flag for an unchecked fact;
the executive-summary prompt and the panel badges say "Not verified". The
`unverified` flag is added to the dossier findings type in `shared/schema.ts`
(JSON column; no migration).
Falsified: `tests/unit/dueDiligenceUnverifiedIsNotClean.test.ts` drives the
real pods with the broker answering nothing, then answering without the
relevant fields, then answering fully — 11 cases, all RED on the old pods.
Resolving commits: (this branch, round 3)


### DEFECT-0127
Title: Academy certification routes act on any user's id, cannot parse real user ids, and keep certificates in memory
Severity: P2
Status: OPEN — cross-user access closed; the rest must be fixed before feature_academy is enabled
Surfaced by lenses: DEFECT-0055 map census, 2026-09-28
Description: `server/routes-certification.ts` is mounted at `/api/certification`
behind `requireLadderFlag("feature_academy")` and has no client caller. Three
defects:
(1) Every `:userId` route acted on the id in the PATH, so any signed-in user
could read, or award, another user's certificates and stats. FIXED
2026-09-28: each route now refuses a path user that is not the session user.
(2) User ids are strings, but the routes `parseInt` them and `/my` calls
`Number(user.id)`, so every real user becomes NaN and nothing works.
(3) `server/services/certification.ts` keeps certificates and achievements in
module Maps, so every award is lost on restart. Anything presented as a
certificate would be unverifiable.
Evidence: `server/routes-certification.ts`, `server/services/certification.ts`.
Remediation plan: keep the flag off. Before enabling it, key the service by the
string user id and persist certificates to a table with a real issuance record.
Falsified by (part 1): `tests/unit/moduleMapsAreBounded.test.ts` — another
user's id in the path returns 403, red on the pre-fix routes.
Resolving commits: part 1 on this branch, round 3
### DEFECT-0128
Title: A parcel alert could attach another county's or state's owner/tax change to a customer's parcel
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §32.1, verified at HEAD 2026-09-28
Description: `server/services/parcelDeltaDetector.ts` keyed the tracked parcel
set, the observation match and the lead/property link on APN + state only.
APNs are assigned per county, so the same APN names different parcels in
different counties, and in different states.
- A county-less lead borrowed the county of the first same-APN property.
- The observation query had no state or county predicate.
- A change that linked to nothing was still pushed, as an unlinked alert.
The alert persisted as a `parcel_alert`, rendered on Today
(`client/src/pages/today.tsx`), and emitted `parcel.owner_changed` /
`parcel.tax_status_changed` to workflows.
Evidence: `server/services/parcelDeltaDetector.ts`, job registered in
`server/jobs/runScheduledJobs.ts` every 6 hours.
Remediation plan: DONE.
- Parcel identity is `parcelIdentityKey(apn, state, county)` everywhere.
- A county-less lead borrows a county only when the org's properties name
  exactly one county for that APN and state; otherwise it is not tracked.
- The query gains a state predicate, and rows are filtered to tracked
  identities.
- A change linked to no tracked parcel is dropped, not alerted.
Falsified by: `tests/unit/parcelIdentityIsCountyScoped.test.ts`. It drives the
real `detectDeltasForOrg`. Pre-fix it produced the Harris County and Oklahoma
changes for a Travis County property, and linked Harris to the Travis
property.
Not done: the per-org history scan is still unbounded (§32.4); a top-2-per-
parcel SQL window is the follow-up.
Resolving commits: this branch, round 3

### DEFECT-0129
Title: The founder Letter said "Nothing needs you today." when it could not check, and the mobile badge undercounted
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §33, verified at HEAD 2026-09-28
Description: The Letter's needs-you count is the union of open asks, the
Decisions queue (the morning pulse) and frozen sends
(`server/services/autopilot/narrate.ts`). A failed read of any of them
collapsed to zero, so the Letter printed the all-clear, and could render as
a quiet day, while it had not checked. Separately, `GET /api/founder/asks`
returned `count` after slicing to `limit`, and the mobile Decisions badge
(`client/src/components/mobile/FounderMobileBottomNav.tsx`) asked with
limit=1. So any backlog showed as "1", and a failed read showed no badge at
all.
Remediation plan: DONE.
- The loader records unread sources. The all-clear requires all three READ
  and empty; otherwise the Letter names what it could not check. An unread
  source is never a quiet day.
- The asks route returns `total` beside the page `count`.
- The badge reads `total` and shows "?" (with an accessible label) when
  either read fails.
Falsified by: `tests/unit/letterAllClearRequiresAllSources.test.ts` (four
cases red pre-fix) and `tests/unit/founderAskTotalIsReal.test.ts` (red
pre-fix: limit=1 reported 1 of 200).
Not done: the badge still does not count decisions-inbox items. One
server-side needs-you endpoint shared by the Letter and the badge is the
follow-up.
Resolving commits: this branch, round 3
### DEFECT-0130
Title: An import job depended on the machine that took the upload, and a dead worker left it "running" forever
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §26–27, verified at HEAD 2026-09-28
Description: `createImportJob` (`server/services/migrationJobs.ts`) wrote the
uploaded CSV to the local /tmp of the app machine that received it and stored
that path. The migration-jobs tick also runs on the separate worker machine
(`server/worker.ts`), so a job could be claimed where the file did not exist.
The customer was told the job was queued, and it then failed. A job whose
worker died mid-run stayed `running` with no heartbeat and no sweep. Imported
leads emitted `lead.created` through the in-memory emitter, so a worker restart
lost the workflow hand-off. Onboarding read `result.imported ?? result.count`,
a shape neither the 200 nor the 202 response has, and said "Leads imported
successfully." for a queued job.
Remediation plan: DONE.
- The upload bytes live on the row (`import_jobs.payload_bytes`, migration
  `migrations/0252_import_job_payload_in_db.sql`, mirrored in
  `scripts/migrate.mjs`). The worker reads them from there; a legacy file path
  is still honoured. The bytes are cleared on completion and on failure.
- `heartbeat_at` is set on claim and on every progress update. Each tick first
  fails running jobs quiet for 15 minutes, with the rows they reached.
- The job API projects every column except the bytes.
- The worker's import passes `durableEvents: true`, so each lead stages
  `lead.created` through the outbox (`emitLeadCreatedDurably`,
  `emitDurableLeadEvent`).
- Onboarding and the data-import page branch on 202 (queued, then polled) and
  200 (real counts), and mark the step imported only when rows were imported.
Falsified by: `tests/unit/importJobsSurviveMachines.test.ts` (the four server
cases were red on the pre-fix migrationJobs/importExport) and the lead lane in
`tests/unit/workflowHandoffIsDurable.test.ts`.
Not done: the synchronous (small-file) import path still emits `lead.created`
in memory. It runs inside the request, so the loss window is a process crash
during the request.
Audit follow-up (independent audit, 2026-09-28), fixed:
- Every progress write, including documents and communications, refreshes
  `heartbeat_at` through `writeImportProgress`. A write that finds the job no
  longer `running` stops the worker. Completion and failure writes carry a
  `status = 'running'` predicate, so a swept job can never flip back to
  completed.
- The stale-sweep message only promises duplicate-skipping for leads.
- Worker imports of properties and deals stage `property.created` and
  `deal.created` durably too (`emitDurablePropertyEvent`,
  `emitDurableDealEvent`). The handoff gate now enumerates every importer call
  the worker makes.

Exports: DEFECT-0142. Imported documents: DEFECT-0143.
Resolving commits: this branch, round 3
### DEFECT-0131
Title: The acquired-notes list showed the first 100 notes as the whole book
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §23, verified at HEAD 2026-09-28
Description: `client/src/pages/notes.tsx` asked `GET /api/notes/acquired` for
limit=100 with no offset and had no paging control. The route
(`server/routes-notes.ts`) returned `count: rows.length`, the size of the page,
and no total. A book of 250 notes rendered as 100, with nothing to say the rest
existed. A status filter with no matches rendered "No notes serviced yet" to an
operator with a full book.
Remediation plan: DONE. The route returns `total` from a count over the same
org-scoped filter. The page pages by 100, shows "Showing A–B of N" with
Previous/Next, and has distinct empty states for a filtered miss and for an
out-of-range page.
Falsified by: `tests/unit/acquiredNotesListIsPaged.test.ts` (all three cases
red pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0132
Title: A note's IRR-to-date kept the yield it had when payments stopped, dropped first-month cash, and floored losses at zero
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §23, verified at HEAD 2026-09-28
Description: `computeYields` (`server/routes-notes.ts`) had four defects:
- It built the IRR stream from month 1, so a payment in the acquisition month
  never entered it.
- It put the "if paid off today" balance in the month after the LAST payment,
  not today. A note that stopped paying two years ago still showed its
  old yield.
- It ignored `unappliedCents`, so partial payments counted as no cash.
- It floored the effective net yield at zero, so a loss rendered as 0.00%.

The panel's hints also misdescribed the numbers
(`client/src/components/note-yield-panel.tsx`).
Remediation plan: DONE.
- Month-0 cash nets against the price.
- The terminal value sits at the as-of month.
- Unapplied cash counts, signed as the ledger stores it.
- There is no floor.
- The hints say what each number is. The IRR is marked "as if paid off at
  par today — not a market value".
Falsified by: `tests/unit/noteYieldIrrIsDated.test.ts` (all four cases red
pre-fix).
Audit follow-up: less than one period held (acquired this month, or dated in
the future) returns null rather than an annualised one-month return.
Resolving commits: this branch, round 3
### DEFECT-0133
Title: Unit economics counted recomputes as unprofitable days, gave non-paying orgs MRR, and claimed Stripe fees were netted
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §21, verified at HEAD 2026-09-28
Description: In `server/services/unitEconomics.ts`:
- The consecutive-unprofitable streak read the latest snapshot by
  `computedAt`. Snapshots upsert on (org, computedDate), so after the day's
  first run that row was today's own, and every recompute added a "day".
- MRR was the tier's list price whatever the subscription status, so a
  trialing, past-due or cancelled org on a paid tier showed revenue.
- The breakdown said `stripe_fee` was "excluded by design", and the header
  said it was "netted at the revenue level". Nothing netted it: MRR is gross,
  so every margin was overstated by the processing fee.
Remediation plan: DONE.
- The streak extends only from YESTERDAY's row (`computedDate < today`). A gap
  restarts it at 1.
- MRR is zero unless the org is paying.
- The notes and header state that revenue is gross of Stripe fees and that the
  margin is overstated by them.

Deducting `stripe_fee` from revenue is the follow-up; it changes the stored
columns.
Falsified by: `tests/unit/unitEconomicsStreakIsDays.test.ts` (four cases red
pre-fix; two anchors green before and after).
Audit follow-up: `maybeEmitUnprofitableAlert` files only for an org with MRR.
Otherwise every trialing org with costs would have become a "review pricing"
founder alert. The rollup's `payingCustomerCount` requires an active
subscription. `server/services/financialForecaster.ts` (MRR history, burn,
unit economics) uses the same paying rule
(`tests/unit/forecasterCountsPayingOrgsOnly.test.ts`). Its churn proxy is
DEFECT-0144.
Resolving commits: this branch, round 3
### DEFECT-0134
Title: A founder's preview cancel could report success while the action ran anyway
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §30, verified at HEAD 2026-09-28
Description: The autonomous executor read the preview's status ('pending')
and then executed (`server/services/actionPreview.ts`,
`server/services/autonomousDecisionExecutor.ts`). A cancel landing in between
set 'cancelled'. The route answered `{ ok: true }` whether or not a row
changed, the UI said "cancelled before it committed", and the action ran.
`recordResult` then overwrote 'cancelled' with 'committed'.
Remediation plan: DONE.
- The executor claims the row in one statement (pending → executing,
  UPDATE … RETURNING).
- `cancelPreview` returns whether it changed a pending row, and the route
  (`server/routes-founder-intelligence.ts`) answers 409 PREVIEW_NOT_PENDING
  when it did not.
- `recordResult` writes only onto the executing row, so a cancelled row stays
  cancelled.
- The preview page shows `executing`.

Rows stranded in `executing` by a crash are left visible rather than swept to
a guessed outcome.
Falsified by: `tests/unit/actionPreviewCancelIsAtomic.test.ts` (all three
cases red pre-fix).
Audit note: a row whose executor crashed after the claim stays `executing`.
It is visible as such, and is not swept to a guessed outcome.
Resolving commits: this branch, round 3
### DEFECT-0135
Title: The executor's alert "acknowledge" closed the alert, stored nothing, and succeeded on zero rows
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §31, verified at HEAD 2026-09-28
Description: `executeAlertAcknowledgement`
(`server/services/autonomousDecisionExecutor.ts`) had three defects:
- It set status `resolved`, closing an alert whose cause nobody had fixed.
- It wrote the model's reasoning to `resolutionNotes`, a column
  `system_alerts` does not have. An `as any` hid that, so the reasoning was
  never stored.
- It returned success without checking that a row matched.
Remediation plan: DONE.
- Only a `new` alert moves, and only to `acknowledged` with `acknowledgedAt`.
- The reasoning is merged into `metadata`.
- `.returning()` decides success. Zero rows reports "already <status>" or
  "not found".
- The cast is gone, so an unknown column now fails the type check.
Falsified by: `tests/unit/alertAcknowledgeIsNotResolve.test.ts` (a
comment-stripped read of the unit — the executor is driven by a model
decision; three cases red pre-fix).
Audit follow-up: the path that actually fires is the Atlas
`acknowledge_incident` executor (`server/services/agentActionExecutors.ts`,
from sentinel reactions and founder approvals). It set "acknowledged" with
no status predicate, so it reopened resolved and dismissed alerts, and it
reported success for ids that matched nothing. Both executors now call
`acknowledgeSystemAlert` (`server/services/alertAcknowledge.ts`), which is
tested behaviourally. `decisionsInbox.createFromAlert`, the only writer of
`sourceAlertId`, has no callers, so the executor's critical_alert lane is
dormant. Recorded, not wired.
Residue, same round: the founder admin route `PUT /api/admin/alerts/:id/acknowledge`
(`server/routes-admin.ts`) went through a third writer, `storage.acknowledgeAlert`.
It had no status predicate, so it reopened resolved alerts, and it answered 200
with an empty body for an unknown id. The route now calls `acknowledgeSystemAlert`
and answers 404 or 400. The two unpredicated writers (`supportOpsRepo` and
`AlertingService`) were removed, and `ACKNOWLEDGERS` in the test names the route.
The audit of that change found a fourth: `acknowledgeAllAlerts` filtered on
"not resolved and not acknowledged", so it reopened dismissed alerts. It now
moves only `new` alerts. The test no longer trusts a list of callers: it reads
every `update(systemAlerts)` in `server/` and requires the NEW predicate
wherever "acknowledged" is written. It is red with the old repo method in
place.
Resolving commits: this branch, round 3
### DEFECT-0136
Title: A dormant onboarding route returned fabricated offers and profits
Severity: P2
Status: FIXED BY DELETION (round 3, 2026-09-28)
Surfaced by lenses: research report §18, verified at HEAD 2026-09-28
Description: `GET /api/onboarding/instant-deal-hunt`
(`server/routes-onboarding.ts`) had no client caller. Every opportunity it
returned was built from defaults presented as facts:
- 5 acres and a $5,000 assessed value when the lead had none;
- 8 years owned;
- current value = assessed × 1.5;
- last sale = assessed × 0.3;
- resale = assessed × 0.8;
- a "potential profit" computed from those.
Remediation plan: DONE. The route is deleted. The tenancy test case that
pinned its org predicate (`tests/unit/tenantKeyIsNeverOmitted.test.ts`) is
rewritten to pin its absence, so reintroducing the path fails and gets
re-reviewed for both tenancy and fabrication.
Falsified by: the rewritten case (red with the route present).
Resolving commits: this branch, round 3
### DEFECT-0137
Title: "Try with sample data" completed the getting-started checklist
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §26, verified at HEAD 2026-09-28
Description: `GET /api/onboarding/checklist-status`
(`server/routes-onboarding.ts`) says items complete "by the user actually
doing the work". It counted every lead, deal and enriched property in the
org, including the seeded sample book. One click ticked "add a lead" and
"open a deal" for a customer who had done neither.
Remediation plan: DONE, using the seeder's own markers
(`server/services/onboarding/sampleSeeder.ts`):
- the lead signal excludes source `sample_data` (and the older `sample`);
- the deal signal excludes deals on `SAMPLE-` properties;
- the parcel-lookup signal excludes `SAMPLE-` properties.
Falsified by: `tests/unit/checklistIgnoresSampleData.test.ts` (drives the real
handler and renders each WHERE with the Postgres dialect; three cases red
pre-fix).
Audit follow-up: `detectMilestones` (`server/services/churnEngine.ts`)
counted the sample book too, closed deals included. It emailed "Congrats on
your first closed deal" about fixtures and stored the milestone for good. The
exclusions now live in one place, `server/services/onboarding/sampleFilters.ts`,
used by the checklist and the milestones
(`tests/unit/milestonesIgnoreSampleData.test.ts`, red pre-fix). The dead second checklist
(`/api/getting-started/checklist`, three items hardcoded `done: false`) is
now deleted, and its absence is pinned.
Resolving commits: this branch, round 3
### DEFECT-0138
Title: The parcel-intelligence store served a report computed for a different asking price
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §8, verified at HEAD 2026-09-28
Description: `POST /api/data-intel/parcel-intelligence`
(`server/routes-data-intelligence.ts`) keyed its report store on the parcel
alone. The report's score and recommendation depend on the asking price,
assessed value, owner and tax inputs. Re-opening a parcel with a new asking
price returned the recommendation computed for the old one.
Remediation plan: DONE. The scenario inputs are hashed with `scenarioKeyFor`
and stored inside the report (`withScenarioKey`). A hit must match through
`servableStoredReport`, which also strips the key before the response. All
three live in `server/services/data-cache/land-intelligence-store.ts`. Rows
stored before this change never match and recompute once.
Falsified by: `tests/unit/parcelIntelligenceCacheKeysScenario.test.ts` (the
different-price case red pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0139
Title: Hovering "Servicing book" prefetched the seller-finance book
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §23, verified at HEAD 2026-09-28
Description: `/notes` renders the acquired book (`/api/notes/acquired`), but
both prefetch maps (`client/src/components/prefetch-link.tsx`,
`client/src/components/layout-sidebar.tsx`) warmed `/api/notes`, the
seller-finance book. That was a request the page never reads.
Remediation plan: DONE. `/notes` is removed from both maps; `/money` keeps
its entry.
Falsified by: not separately tested (a wasted request, no wrong output).
Resolving commits: this branch, round 3
### DEFECT-0140
Title: Lead imports merged different parcels: same APN in two counties, and one owner's several parcels
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §26–27, verified at HEAD 2026-09-28
Description: Two import paths deduped leads on something other than the
parcel.
- `POST /api/leads/csv-import` (`server/routes-leads.ts`) keyed on state + APN
  and never collected a county, so the same APN in two counties of one state
  was one lead. The second was reported as "already exists". Its own comment
  recorded the gap.
- `importLeads` (`server/services/importExport.ts`) dropped the APN and county
  columns entirely. It deduped every row on name OR email OR phone, so an
  owner holding three parcels on a county list, the normal shape of such a
  list, imported as one lead and two "duplicates".
Remediation plan: DONE.
- One rule, `server/services/leads/parcelDedupe.ts`, used by both paths: a
  parcel is APN + state + county. When either side has no county, the match
  falls back to state + APN rather than guessing.
- The CSV importer maps and writes County
  (`client/src/components/leads/CsvImportSheet.tsx`), and its preview counts
  in-file duplicates by the same key.
- `importLeads` maps APN and County onto the lead. A row with an APN is
  deduped as a parcel. A row without one keeps the contact match.
Falsified by: four cases in `tests/unit/leadEventEmission.test.ts`. The
county case and the three-parcel owner case were red pre-fix. The county-less
fallback and the contact-match anchors are green on both sides, so the fix
cannot be "stop deduping".
Resolving commits: this branch, round 3
### DEFECT-0141
Title: The parcel-delta detector read every observation ever recorded for the pipeline on each run
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §32, verified at HEAD 2026-09-28
Description: `loadObservationPairs` (`server/services/parcelDeltaDetector.ts`)
needs the latest two observations per (parcel, field). It selected ALL
observations for every tracked APN, in one unbounded IN list, and windowed
them in JS. The read grew with observation history and pipeline size on
every daily run, for every org.
Remediation plan: DONE. The window is computed in SQL (`row_number() over
(partition by apn, state, county, field order by observed_at desc, id desc)`,
`rn <= 2`), and the APN list is read in chunks of 500. The rendered query was
checked against the Postgres dialect.
Falsified by: `tests/unit/parcelIdentityIsCountyScoped.test.ts` (chunking
case and window pin red pre-fix; the DEFECT-0128 identity cases unchanged
and green).
Resolving commits: this branch, round 3
### DEFECT-0142
Title: A worker-built data export could not be downloaded
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: independent audit of DEFECT-0130, 2026-09-28
Description: `runExportJob` (`server/services/migrationJobs.ts`) wrote the
zip to the /tmp of whichever machine ran the job, and stored that path.
`readExportArchive` read it from the /tmp of whichever machine served the
download. Migration jobs tick on both the app and the worker, so a
worker-built export answered 410 "Archive expired or unavailable". Expiry was
never enforced on read, and a dead export stayed `running`.
Remediation plan: DONE.
- The archive lives in `export_jobs.archive_bytes` (migration
  `migrations/0253_export_archive_in_db.sql`, mirrored in
  `scripts/migrate.mjs`).
- The download reads the row and refuses an archive past `expires_at`.
  Legacy file paths are still honoured.
- The job API never selects the bytes.
- Each tick fails a `running` export older than an hour and drops expired
  archive bytes.
Falsified by: three DEFECT-0142 cases in
`tests/unit/importJobsSurviveMachines.test.ts` (all red pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0143
Title: Imported documents are written to one machine's /tmp and are lost
Severity: P1
Status: OPEN (needs a storage decision — DEFECT-0046)
Surfaced by lenses: independent audit of DEFECT-0130, 2026-09-28
Description: A documents import (`server/services/migrationJobs.ts`) writes
each file to the worker's /tmp and records that path in `activity_log`
metadata. /tmp does not survive a restart or deploy, and is not shared
between machines. The export's attachment re-pack skips any file it cannot
find, silently, so `counts.attachments` under-reports. The storage directory
is now created where the files are written. The durable fix is a shared file
store: object storage, or bytes in the database. That is the deferred
DEFECT-0046 decision, so it is recorded here rather than guessed at.
Resolving commits: —
### DEFECT-0144
Title: The founder forecast's churn rate counts every free org touched in 30 days as churned
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: DEFECT-0133 audit follow-up, 2026-09-28
Description: `calculateUnitEconomics` (`server/services/financialForecaster.ts`)
counts as "churned" any org with a free or null tier and an `updated_at`
within 30 days. A free org that was never paying, or was just edited, counts
as churn. That churn rate sets the customer lifetime and the LTV shown on the
founder forecast. The fix is to count only orgs whose subscription ended in
the window, from the subscription event history.
Remediation plan: DONE. Churn is the number of distinct orgs with a
subscription `cancel`, or a `change` down to free, in the last 30 days that
are not paying now. It is read from `subscription_events`, which the billing
webhook writes. The rate is over the customers the month started with. With
zero observed churn, lifetime and LTV are null and the summary says "not
estimable yet". The old code assumed a 24-month lifetime, a number presented
as an estimate.
Falsified by: `tests/unit/forecasterCountsPayingOrgsOnly.test.ts` (two
DEFECT-0144 cases red pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0145
Title: The founder's Decisions badge and the Letter counted "needs you" differently, and a failed queue read was zero
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: DEFECT-0129 follow-up and independent audit, 2026-09-28
Description: The Letter's needs-you union is open asks + the Decisions queue
+ frozen sends. It took the queue count from the once-a-day morning pulse,
whose loader (`server/services/solene/continuousLoop.ts`) turned a failed
read into 0, and the all-clear trusted that zero. The mobile badge
(`client/src/components/mobile/FounderMobileBottomNav.tsx`) summed a
different pair, asks + the pending-hands list, and left the Decisions queue
out. It could show nothing while the Letter listed a dozen items.
Remediation plan: DONE.
- One live loader, `loadNeedsYouCounts`
  (`server/services/autopilot/needsYou.ts`), reads each store. A failed
  source is named, and makes the total unknown rather than smaller.
- The Letter reads the queue from `countPendingDecisions`, live. The pulse
  uses the same count for its history.
- The badge reads `GET /api/founder/needs-you` (`server/routes-autopilot.ts`)
  and shows "?" for an unknown total.
Falsified by: `tests/unit/needsYouIsOneCount.test.ts` (loader behaviour, and
the Letter wiring pin, red pre-fix). `founderAskTotalIsReal.test.ts` and
`letterNeedsYouUnion.test.ts` were rewritten to the new source, keeping their
invariants.
Resolving commits: this branch, round 3
### DEFECT-0146
Title: Every durable workflow emit scanned the whole outbox for its dedupe key
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: independent audit of DEFECT-0130, 2026-09-28
Description: `stageWorkflowEvent` (`server/services/workflowOutbox.ts`) checks
`payload->>'dedupeKey'` before staging. Only `event_type` was indexed, so each
emit scanned every workflow row in the outbox, once per imported row once
worker imports became durable. That is up to 50k sequential jsonb scans,
against a 30s statement timeout.
Remediation plan: DONE. An expression index on `(payload->>'dedupeKey')`
(`migrations/0254_outbox_dedupe_key_idx.sql`, mirrored in
`scripts/migrate.mjs`, declared in `shared/schema/accounting-ops.ts`) matches
the query's expression exactly.
Falsified by: `tests/unit/outboxDedupeIsIndexed.test.ts` pins the query, the
migrator and the schema to the same expression. No query plan was measured
against a live database.
Resolving commits: this branch, round 3
### DEFECT-0147
Title: The sample book counted against a free org's plan limits and fired Pax nudges
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: independent audit, 2026-09-28
Description: Onboarding seeds a sample book by default
(`server/routes-onboarding.ts`). Plan-limit counts
(`server/services/usageLimits.ts`) counted every lead, property and note.
The free tier allows 3 properties and 2 notes, and the sample book alone
reached both, so a new free org was refused its first real parcel. Pax nudges
(`server/services/paxNudges.ts`, a live job) also had three defects:
- "N new leads added this month", stale-lead and stuck-deal nudges fired on
  fixtures;
- the stale count was a LIMIT-10 page filtered afterwards;
- the stuck-deal nudge asserted "Deals typically close in 21 days", a
  benchmark nothing measured.
Remediation plan: DONE. Plan limits and every leads and deals query in the
nudge generator use the shared sample exclusions
(`server/services/onboarding/sampleFilters.ts`). The stale count is a
count. The invented benchmark is removed.
Falsified by: `tests/unit/planLimitsIgnoreSampleData.test.ts` (three cases)
and `tests/unit/paxNudgesIgnoreSampleData.test.ts` (two cases), all red
pre-fix.
Resolving commits: this branch, round 3
### DEFECT-0148
Title: The notification bell opened a decision queue that said "Pipeline is clear" from 25 rows
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §8 verification, 2026-09-28
Description: The bell, Today's "View all", approval notifications and two
legacy paths all opened `pages/decision-queue`. It re-derived stalled leads,
waiting counters and stuck deals from bare `/api/leads` and `/api/deals`
reads: the 25 newest of each, with a failed read treated as empty. It then
said "Pipeline is clear. No decisions needed today. All leads are current
and deals are moving." Stalled leads are old by definition, so they were
exactly the rows past 25.
Remediation plan: DONE. The page is deleted. `/admin/decisions` and
`/decision-queue` redirect to Today, whose queue is the one list
(`client/src/App.tsx`). The bell (`client/src/components/page-topbar.tsx`)
and approval notifications (`server/services/notificationDispatcher.ts`)
point there. The circular "View all" is gone. The route-guard test that used
the page as its customer-under-/admin example now holds that invariant with a
planted App source.
Falsified by: `tests/unit/decisionQueueIsToday.test.ts` (three cases red
pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0149
Title: Founder churn, cancellation and upgrade counts read an event vocabulary nothing writes
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: independent audit of DEFECT-0144, 2026-09-28
Description: `subscription_events` writers emit `cancel`, `change`, `pause`
and `resume`. The readers used other names:
- About ten founder readers filtered on `subscription_cancelled`,
  `_upgraded`, `_downgraded` or `_created`: `routes-founder-intelligence.ts`,
  `jobs/founderWeeklyDigest.ts`, `services/agentDataResolvers.ts`.
- `storage.getSubscriptionStats` filtered on `upgrade`, `downgrade`,
  `signup` and `reactivate`.
- The upgrade NPS prompt filtered on `plan_upgraded`.
Nothing wrote any of those. So founder churn, the weekly digest's
cancellations and new-paying count, Atlas's cancellation data and upgrade
counts all read 0, and the NPS prompt never showed. The webhook also wrote
`cancel` for trials that ended unpaid, which counted them as churn.
Remediation plan: DONE. One vocabulary,
`shared/billing/subscriptionEventVocabulary.ts`:
- `SUBSCRIPTION_EVENT` constants for every reader and writer;
- `classifyTierChange` and `tierRank` (an upgrade is a `change` to a higher
  rank);
- `tallySubscriptionEvents` for the stats.

The webhook writes `trial_end` for a trial that ended.
Falsified by: `tests/unit/subscriptionEventVocabulary.test.ts`. Its
population is every server file: every `event_type` literal read must be in
the vocabulary, and every write must name a constant. Two cases were red
pre-fix, and widening the population found two more readers.
Resolving commits: this branch, round 3
### DEFECT-0150
Title: The win-back engine reads a cancellation event nothing writes, so it has never run
Severity: P2
Status: OPEN — founder decision (activating it starts outbound mail)
Surfaced by lenses: independent audit of DEFECT-0144, 2026-09-28
Description: `server/jobs/growthAutomation.ts` finds cancelled orgs by
`subscription_cancelled`, which nothing writes, so the win-back sequence has
never found anyone. Changing the predicate to `cancel` would start emailing
former customers from a job that has never sent. That is an outbound
communication change, and whether, when and from which sender is the
founder's call. The read is registered as dormant in
`tests/unit/subscriptionEventVocabulary.test.ts`, so it cannot be "fixed" in
passing.
Resolving commits: —
### DEFECT-0151
Title: ⌘K search failed on punctuation and accents, and its fallback queried columns that do not exist
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §8.13, verified 2026-09-28
Description: `server/services/fullTextSearch.ts` had three defects.
- The tsquery builder stripped each word to ASCII and kept empty remainders.
  "Smith - Lot 4" became `Smith:* & :* & Lot:* & 4:*`, a syntax error, and
  "Muñoz" was split in two.
- Every such search fell to the ILIKE fallback. It selected `"firstName"`
  and `"organizationId"`, which do not exist (the columns are snake_case),
  and threw into a silent catch that returned nothing.
- Neither path excluded soft-deleted rows.
Remediation plan: DONE.
- Words keep letters and digits in any script, and empty words are dropped.
- The fallback uses the real columns and propagates failure, logged.
- Both paths filter `deleted_at IS NULL`.
- `tests/unit/rawSqlColumnsExist.test.ts` gained a quoted-identifier arm.
  `BARE` required snake_case, so quoted camelCase columns were outside the
  gate. Widening the population admitted one unresolvable dead template;
  MAX_UNRESOLVED went from 69 to 70, justified in place.
Falsified by: `tests/unit/searchQueryAndFallback.test.ts` (four cases red
pre-fix), and the gate's new arm (red on the old fallback).
Resolving commits: this branch, round 3
### DEFECT-0152
Title: Today's "N payments posted — $X" was computed from an unordered LIMIT 200
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §8.11 verification, 2026-09-28
Description: The Today receipts read up to 200 payments, sends and task
runs with no ORDER BY (`server/routes-today.ts`). Past 200 in the window, the
count, the dollar total and the "latest" time were computed over an arbitrary
subset.
Remediation plan: DONE. The route aggregates in SQL: count, sum and max per
source, sends grouped by channel. `deriveReceipts` takes those totals.
Falsified by: two DEFECT-0152 cases in `tests/unit/todayReceipts.test.ts`,
red pre-fix.
Resolving commits: this branch, round 3
### DEFECT-0153
Title: The tax-delinquent import kept no parcel identity and deduped nothing
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: independent audit of DEFECT-0140, 2026-09-28
Description: `POST /api/leads/import/tax-delinquent`
(`server/routes-leads.ts`) wrote the parcel id and county only into notes
and tags, with an empty state for rows lacking one. Re-importing a county
list duplicated every row, and these leads were invisible to parcel dedupe
and to the parcel-change detector. The shared dedupe also had three
normalization gaps:
- it did not strip "County";
- it did not collapse whitespace;
- its database pre-filter matched APNs exactly, so "abc-1" was never fetched
  for an incoming "ABC-1".
Remediation plan: DONE.
- The APN and county are written onto the lead, and parcels already present
  are skipped and counted.
- `server/services/leads/parcelDedupe.ts` keys on the canonical
  `normalizeParcelRef`/`parcelKey`.
- All three import paths pre-filter on the normalized APN.
Falsified by: two cases in `tests/unit/leadEventEmission.test.ts`, red
pre-fix.
Resolving commits: this branch, round 3
### DEFECT-0154
Title: A customer's support chat could read other organizations' support resolutions
Severity: P0
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: cross-org privacy trace, 2026-09-28
Description: The `apply_self_healing_fix` support tool (settings_write, no
approval tap) called `getKnownFixPatterns`
(`server/services/paxLearning.ts`). It read every tenant's
`support_resolution_history` and every cross-org learning, with no org
filter and no k-anonymity. It returned the matched row's
`autoFixAction || resolutionApproach` to the model and the customer: free
text written from another org's ticket. A one-letter pattern matched the top
row, so varying it walked the list. Any org could also plant rows, which
reached other orgs' model context, and keyword matches let a tenant run
platform-wide operations (the whole job queue, a health check).
Remediation plan: DONE.
- Patterns come only from the caller's own resolution history, or from
  cross-org learnings with at least 3 contributing orgs, via their canonical
  `autoFixAction`.
- What returns is an action category (`clear_cache` / `retry_jobs` /
  `resync` / `manual`), never stored text.
- Patterns under 3 characters match nothing.
- Platform-wide actions need `allowPlatformActions`, which chat never sets.
- Shared counters move by row id, not an unescaped LIKE.

`sophiePrivacyGuard` (consent, anonymisation, k) still has no callers;
wiring consent into the learning writers is a founder data-policy decision
and is not done here.
Falsified by: `tests/unit/selfHealingFixIsTenantScoped.test.ts` (all five
cases red pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0155
Title: The market network served a single operator's just-closed deal as the county's price per acre
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: cross-org privacy trace, 2026-09-28
Description: `contributeClosedDealToNetwork`
(`server/services/marketNetworkContributor.ts`) wrote each closed deal as
its own `market_metrics` row: org NULL, periodType `transaction`, median set
to that deal's $/acre. Every other reader took the county's latest row:
- `marketIntelligence`
- `priceOptimizer`
- `dispositionOptimizer`
- `portfolioSentinel`

So a customer's market health showed another operator's deal, and
`analyzeMarket` re-published it as a "monthly" metric. The cohort floor
counted deals, not operators, so one operator's 5 deals could be the whole
cohort. Min and max were single deals, and the copy claimed "N AcreOS
operators … over the last 90 days", which was not true.
Remediation plan: DONE.
- Every reader applies `publishedMarketMetric()`, which excludes raw
  contribution rows.
- Contributions carry a hashed contributor tag. Serving needs at least 5
  deals from at least 3 distinct tagged operators; untagged legacy rows fail
  closed.
- Min and max are gone.
- The copy states transactions, with no date window.

"Monthly" rows that earlier re-publications derived from single deals remain
in the table. Removing them is a data deletion, a founder decision.
Falsified by: `tests/unit/marketNetworkIsKAnonymous.test.ts` (behaviour, plus
a population gate over every `market_metrics` reader; five cases red
pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0156
Title: An unfloored cross-org deal benchmark let a caller solve for another operator's profit per deal
Severity: P2
Status: FIXED BY DELETION (round 3, 2026-09-28)
Surfaced by lenses: cross-org privacy trace, 2026-09-28
Description: `GET /api/platform/benchmarks`
(`server/routes-platform-features.ts`) averaged every org's closed deals,
the caller's own included. Its only gate was "25 organizations exist", and
every signup is one. No client called it.
Remediation plan: DONE. Deleted, and the absence is pinned.
Falsified by: `tests/unit/platformBenchmarksStayDeleted.test.ts`.
Resolving commits: this branch, round 3
### DEFECT-0157
Title: Syndication showed "No properties found." to everyone
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §8 verification, 2026-09-28
Description: `client/src/pages/syndication.tsx` read `.properties` from a
`{ data, total }` envelope, so no one could select a property to syndicate.
It also cached that envelope under the shared `["/api/properties"]` key,
which the Map then rendered as zero pins.
Remediation plan: DONE. It uses its own key and reads `data`. A failed read
shows an error, and a partial list says so.
Falsified by: `tests/unit/mapCountsTheWholeBook.test.ts` (red pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0158
Title: The Map summarised the first page as the whole book
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report §8.11, verified 2026-09-28
Description: `client/src/pages/maps.tsx` loaded 100 properties and 100 deals
under shared cache keys, and summed several figures from that page as if it
were the whole book:
- the pin badge;
- the Active and Closed-$ pills;
- the owned acres.

`PersonaMapStrip` counted "owner targets" from the default 25-row lead
page.
Remediation plan: DONE.
- The Map has its own keys.
- The deal pills come from `/api/deals/aggregates`.
- The badge says "newest N of M" when the pins are a page.
- Owned acres is hidden when the list is partial.
- The strips count leads from the server's `total`. A failed or pending
  count is not treated as zero.
Falsified by: `tests/unit/mapCountsTheWholeBook.test.ts` (red pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0159
Title: The data-coop and credit-benchmark privacy floors count parcels, not operators
Severity: P2
Status: OPEN
Surfaced by lenses: cross-org privacy trace, 2026-09-28
Description: The county rollup uses `HAVING COUNT(DISTINCT apn) >= 5`
(`server/services/dataCoop/countyRollupJob.ts`), and credit benchmarking sets its cohort
by parcels (`server/services/creditBenchmarking.ts`). One operator with 5
parcels in a county can be the whole cohort behind the accepted $/acre
percentiles served by the market-heat routes. The fix mirrors DEFECT-0155: a
distinct-contributor floor. Neither has an opt-in, which is the same
data-policy decision noted on DEFECT-0154.
Resolving commits: —
### DEFECT-0160
Title: Client panels rendered a failed fetch as an empty list, and the ratchet could not see the idiom
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: completeness audit of the fetch-honesty sweep, 2026-09-28
Description: The `empty-on-failure` ratchet
(`scripts/ratchets/empty-on-failure.json`) matched only `catch { return [] }`
shapes. It did not see the two idioms that do the same thing on a response:
`if (!res.ok) return []` and `res.ok ? res.json() : []`. So a failed request
read as "nothing here" in:
- the Pax knowledge panel;
- Pax project panels (projects and files);
- the copilot rail's recent conversations;
- the command palette's server search;
- the safety-gates deal list.
Remediation plan: DONE.
- The ratchet pattern now matches both response idioms. It measured 17;
  the five surfaces above were converted to `okOrThrow` with real error
  states, and the baseline is 10. The remaining ten are listed in the
  ratchet's `lastBumpNote`.
- The palette says the server search failed instead of "no results".
- `useNotificationPreferences` (no callers) was deleted.
Falsified by: `npm run lint:ratchets` (the widened pattern reads 17 against the
pre-conversion tree).
Audit follow-up, same day: the object arm was pinned to the key `results`, so
`{ asks: [] }`, `{ events: [] }`, `{ comments: [] }` and `{ count: 0 }` were
still unread. An independent audit found 14 more sites, one of them in a file
this entry had claimed as converted. The arm now takes any key whose value is
`[]`, `0` or `null`; it measured 24. Converted in the same change:
- the founder Build page's four reads. Its in-flight error branch could never
  fire, and the asks card said "Agents have everything they need right now";
- the Team page's two reads;
- the Money page's two reads. Every envelope card claimed "Envelope tracking
  ships with Lena's Phase 1";
- the comment thread's count read, and its "No comments yet" on a failed load;
- the founder half of the ⌘K search, which now says so even beside local
  matches;
- the sidebar's Pax notes popover.

The baseline is 13, and the keep list is in the ratchet's note. The
safety-gates deal picker no longer says "No active deals" on a failed read.
Resolving commits: this branch, round 3
### DEFECT-0161
Title: Dedupe treated one owner's several parcels as duplicates, and merging deleted a parcel
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: import-identity audit follow-up (DEFECT-0153), 2026-09-28
Description: A land seller with five parcels is five leads with one phone,
one email and one mailing address. `findDuplicateClusters`
(`server/services/leadDedupeScanner.ts`) clustered them by phone, email or
name + address and offered them for merge. `mergeLeads`
(`server/storage/leadRepo.ts`) then deleted the duplicate, and its merged
fields did not include `apn` or `county`, so the parcel went with it.
Remediation plan: DONE.
- `areDistinctParcels` (`server/services/leads/parcelDedupe.ts`) compares the
  canonical parcel keys. It is true only when both leads carry a parcel and
  the parcels differ.
- The scanner skips a cluster whose members are all distinct parcels.
- `mergeLeads` refuses to merge two distinct parcels, and the merge route
  answers 400 with the reason.
- A merge now carries `apn` and `county` across, and the lead import template
  lists both columns.
Falsified by: `tests/unit/ownerWithManyParcelsIsNotADuplicate.test.ts` (two
cases red pre-fix).
Audit follow-up, same day:
- Merging `apn` and `county` field by field could build a parcel that matched
  neither lead. A primary with a county but no APN took the duplicate's APN
  under its own county. The parcel now moves as one unit: APN, county,
  property address, acreage, estimated value and the tax-delinquent flag.
- A duplicate with no APN can no longer fill in a primary's parcel
  attributes.
- A bucket that mixed one parcel's duplicates with a different parcel was
  offered whole, and the page's merge-all then failed on it. Buckets are now
  split by parcel.
- Parcel identity is computed once per lead (`parcelIdentityOf`), not once
  per pair.
- The merge is tested by behaviour, not by a source scan.
- Known limit: a state written out in full ("Texas" vs "TX") cannot be
  normalised, so the same APN reads as two parcels. The error runs toward
  refusing the merge. No state normaliser exists to fix it with.
Resolving commits: this branch, round 3
### DEFECT-0162
Title: The activity feed filtered after paging, so its tabs showed nothing and "Load more" never appeared
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: failure-as-empty sweep, 2026-09-28
Description: `GET /api/activity` (`server/routes-crm-extras.ts`) read the
latest `limit + offset` events of any type and filtered them afterwards. The
Payments and Communications tabs therefore searched only the newest 50
events and said "No activity recorded yet" when hundreds existed. `hasMore`
compared the filtered list to `offset + limit`, so it was never true, and
`total` was the length of that slice. The page treated a failed request as
no activity.
Remediation plan: DONE.
- The type and entity filters run in SQL, paged with `limit + 1` / `offset`.
- `total` is a real count over the same predicate.
- `client/src/pages/activity.tsx` uses `okOrThrow`.
- The unused `getRecentActivityEvents` repo method was removed.
- Audit follow-up: "Load more" keyed a single query on the offset, so it
  replaced the first page with the second. This was hidden while `hasMore`
  could never be true. It is now one infinite query that appends.
- A negative limit or offset (a Postgres error) is clamped, and a repeated
  `?eventTypes=` (an array) is accepted.
Falsified by: `tests/unit/activityFeedPagesInSql.test.ts` (three cases red
pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0163
Title: The Controls door, the board report and the step-away check read a failed queue read as "nothing waiting"
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: needs-you audit follow-up (DEFECT-0145), 2026-09-28
Description: `listPendingHands`
(`server/services/autopilot/pendingHands.ts`) caught its own query failure
and returned an empty list. Each founder reader turned that into a verdict:
- The Controls door (`/api/founder/autopilot/live`, rendered by
  `client/src/pages/founder/autopilot-control.tsx`) printed "0 awaiting your
  tap". Its decision and ask counts came from the once-a-day pulse, not live.
- The board report (`server/services/autopilot/boardReport.ts`) printed
  "Nothing right now. The company is running itself." It also ignored the
  Decisions queue.
- The step-away check "Decision queue is clear"
  (`server/services/autopilot/stepAwayReadiness.ts`) counted frozen actions
  and asks only. That is a third definition of "needs you", and it said
  "ready" on a failed read.
Remediation plan: DONE.
- `listPendingHands` throws on a failed read.
- All three readers take `loadNeedsYouCounts`
  (`server/services/autopilot/needsYou.ts`), the union the Letter and the
  badge use.
- An unread source is named ("Couldn't check frozen sends"), never counted
  as zero. The Controls door shows it as unread; the step-away check reports
  attention.
- Audit follow-up: the Controls card the founder actually SEES ("N waiting on
  you" / "Nothing waiting") read `/api/founder/autopilot/control`. That was a
  count of open asks only, and 0 on a failed read. It now reads the same union
  and names any source it could not read.
- The Decisions door's witnessed-send queue showed an error as nothing: it
  rendered nothing on a failed read, exactly as for an empty queue. It now
  shows an error state.
- `pendingHandCounters` counted a pending row with no expiry as waiting. The
  list and the approval both treat that row as expired.
- The Solene chat context quoted the morning pulse's "Decisions waiting". That
  figure was up to a day old, and 0 whenever the pulse's read had failed. The
  chat now has a live needs-you line
  (`server/services/solene/chat/liveState.ts`).
- Recorded, not changed: the board report's attention calibration still
  counts an unread source as 0, and the Letter keeps the pulse's stale queue
  figure when its live read fails. Both of those surfaces already say the
  source was unread and withhold the all-clear.
Falsified by: `tests/unit/controlsDoorFailureIsNotZero.test.ts` and
`server/services/autopilot/stepAwayReadiness.test.ts` (eight cases red
pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0164
Title: Photo uploads answered "uploaded" / "Saved to the lead" over bytes they had dropped
Severity: P1
Status: FIXED (round 3, 2026-09-28) — as a refusal; storage itself waits on DEFECT-0046
Surfaced by lenses: upload-route population audit, 2026-09-28
Description: There is no blob store (DEFECT-0046, deferred on the founder's
storage decision). Two customer upload routes behaved as if there were:
- `POST /api/rehabs/:rehabId/photos` (`server/routes-rehab-photos.ts`) called
  a `persistToBlob` that only logged. It wrote a row keyed
  `rehabs/<id>/<photo>.<ext>` and answered 201. The gallery said "N photo(s)
  uploaded" and listed the record as evidence. Those are before/after,
  defect, lender-draw and tax-basis photos, and none of the images existed.
- `POST /api/leads/:id/photos` (`server/routes-field-scout.ts`, used by
  DriveMode) wrote a row pointing at `/uploads/field-scout/...`, which nothing
  serves, and dropped the processed image. DriveMode said "Saved to the
  lead." The hash dedup then made the same image un-uploadable once storage
  existed, and DriveMode's GPS fields were ignored.
- `POST /api/voice/transcribe`, when it had no transcriber, answered 200
  "pending" over audio that nothing kept and that no job would retry.
Remediation plan: DONE.
- `photoStorageAvailable()` (`server/services/photoStorage.ts`) is false
  until a driver exists. Both photo routes check it and answer 503 BEFORE
  writing a row, saying nothing was saved.
- `persistToBlob` throws instead of logging.
- The voice fallback answers 503 and says the recording was not kept.
- The rehab gallery pauses uploads and says why. It marks existing records
  "Image not kept" and shows an error state for a failed load (it had
  rendered "No photos yet").
- DriveMode shows the server's reason.
- Not changed: the existing rows are left in place, because deleting customer
  data is a founder decision. The documents-ZIP import's /tmp storage is
  DEFECT-0143.
Audit follow-up, same day:
- The service worker queued DriveMode's multipart photo under the
  `/api/leads` prefix using `request.text()`. That mangles the JPEG. It then
  answered 202 "Saved offline", which DriveMode showed as "Saved to the
  lead." `isOfflineQueueable` (`client/public/sw.js`) now never queues a
  multipart body.
- The switch was a bare `false`, and flipping it would have brought the
  defect back. Both routes now write through `persistPhotoBytes`, which
  throws until a driver exists and runs before the row is recorded. For
  rehab photos it runs inside the row's transaction.
- `POST /api/field-scout/visits` accepted photo pointers with no upload
  behind them. It now refuses them.
- The live voice input in the Pax copilot rail ended silently on a failed
  transcription. It now says the recording was not kept.
- Quick capture answered `imageAttached: true` even when storing the image
  threw.
- The upload sites are enumerated in the test with a verdict each. A new
  upload route that is not in the register fails the gate.
- Both new population gates listed files with `git ls-files 'server/**/*.ts'`,
  which skips every top-level `server/*.ts` (1,223 of 1,516 files). They now
  use `'server/*.ts'` and assert a floor.
Falsified by: `tests/unit/uploadsWithoutStorageAreRefused.test.ts` (four cases
red pre-fix) and `tests/unit/noAttestationWithoutTheThing.test.ts`.
Resolving commits: this branch, round 3
### DEFECT-0165
Title: A daily job wrote invented vision "detections" for every customer property
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: DEFECT-0164 audit, 2026-09-28
Description: `runVisionReimagingPass`
(`server/services/propertyVisionReimaging.ts`, scheduled daily from
`server/jobs/propertyVisionReimaging.ts`) had no vision model behind it.
- `analyzeImage` returned seeded pseudo-random "structure", "vegetation" and
  "dirt_road" detections, plus a vegetation-cover percentage.
- The pass stored them as `property_vision_snapshots` analysis for each
  due property.
- Each snapshot carried an image key for an image nothing had fetched.

Nothing reads the table today, and the fixed seed kept change alerts quiet.
It was still invented findings about customers' land, written every day.
Remediation plan: DONE.
- `visionAnalyzerConfigured()` is false. The pass checks it first and writes
  nothing.
- `analyzeImage` refuses instead of inventing.
- The test that pinned "a deterministic, well-formed analysis" was rewritten
  to the new truth rather than deleted.
- Existing snapshot rows are left in place: deleting customer data is a
  founder decision.
Falsified by: `tests/unit/propertyVisionReimaging.test.ts` (the pass test
reached the database pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0166
Title: The deal-room NDA attested a signature nobody gave
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: DEFECT-0164 audit, 2026-09-28
Description: `POST /api/deal-rooms/:id/nda` (`server/routes-deal-rooms.ts`)
printed "Signed: <now>" and a random "Verification Code" for whatever party
name the caller supplied. It also stored a deal-room document with an empty
`fileUrl`, so its download signed an empty URL. The e-sign ruling is that
AcreOS never attests that a counterparty signed. The route is behind the
frozen `feature_deal_rooms` ladder flag, so it is not reachable today.
Remediation plan: DONE. It returns an UNSIGNED DRAFT with no signature line
and no code, and it records no document.
Falsified by: `tests/unit/noAttestationWithoutTheThing.test.ts`.
Resolving commits: this branch, round 3
### DEFECT-0167
Title: The Decisions door dropped pending decisions older than its window, and showed a failed read as an empty queue
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: needs-you audit follow-up (DEFECT-0163), 2026-09-28
Description: `GET /api/founder/intelligence/decision-log`
(`server/routes-founder-intelligence.ts`) sorted the rows into buckets. It
read only the newest `limit` rows created in the last `days`; the page asked
for 30 days and 300 rows. So "Needs you" held only the pending rows among
them:
- A decision still waiting after 30 days left the founder's queue.
- So did one pushed out by 300 newer resolved rows.
- The "needs you" count was the length of that partial list. That made it a
  third definition, beside the Letter's and the badge's.
- A non-numeric `days` reached SQL as NaN.
- The page (`client/src/pages/founder-decisions.tsx`) rendered a failed read
  as the bucket's empty text.
Remediation plan: DONE.
- "Needs you" reads every pending decision, whatever its age: the newest 50
  as cards.
- Its count is `countPendingDecisions`, the same source the needs-you union
  uses.
- The windowed history excludes pending rows and says when it hit its row
  limit.
- A non-numeric window falls back to the default.
- The page shows an error state.
Falsified by: `tests/unit/decisionLogNeedsYouIsEveryPending.test.ts` (four
cases red pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0168
Title: Property pickers and lookups read "the newest hundred" — and several read nothing at all
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report item "useProperties capped at 100 in deal pickers", verified 2026-09-28
Description: `useProperties()` (`client/src/hooks/use-properties.ts`) is page
1 of 100 of `GET /api/properties`, and the route had no search.

Pickers built on it could not offer the 101st-newest property:
- create deal and new seller-finance note;
- the leads offer letter;
- the document generator's four forms;
- documents, listings and QuickAdd.

The new-note picker said "No unsold properties yet" whenever that page
happened to be all sold.

Lookups built on it came back missing:
- A deal on an older property lost its header and property card. Its
  negotiation script ran against an invented 50,000 asking price, and its
  calculator's sale price became 0.
- The deals CSV export wrote blank county and state.
- A note said "No property linked."

Worse neighbours:
- The AVM and land-credit pickers read `.properties` off an array, so they
  were always empty.
- Four rental panels (expenses, bookings, T12, units) asked for
  `pageSize=200`, which the route rejects. Their property pickers were
  always empty, so a rental operator could not choose a property there at
  all.
- The subdivision editor asked for `?id=N` (ignored) and read `.properties`
  off the envelope. It never found its parent parcel, so its zoning setback
  lookup never ran.
- QuickAdd's key said `pageSize=100` but it fetched 25.
- The offline cache passed `limit=`, which is ignored, so it stored 25 rows.
- The land dashboard widget reported page lengths as "N total in pipeline"
  and as owner-target counts.
Remediation plan: DONE.
- `GET /api/properties` takes `q` (APN / county / state / address / city /
  zip, org-scoped and LIKE-escaped), `ids` (up to 100, strictly parsed) and
  `excludeStatus`.
- One server-searched `PropertyCombobox`
  (`client/src/components/property-combobox.tsx`) replaces every picker. It
  resolves the selected value by id and treats a failed search as a failure.
- Lookups use `useProperty(id)` or `usePropertiesByIds`.
- The negotiation script refuses without a real price.
- The widget shows server totals and labels the counts it computes from a
  page.
- Syndication searches on the server.
- A register in the test holds every remaining whole-list read, with a
  reason. A read of more than 100 rows, or one using an ignored param, fails
  the gate.
Audit follow-up, same day (an independent audit of this change):
- My first QuickAdd key, `["/api/properties", "quick-add-any"]`, became the
  URL `/api/properties/quick-add-any` through the default query function.
  That is a 404, so QuickAdd could log no maintenance ticket. The key is a
  real path again.
- The gate's population missed three live pickers and lookups:
  - flip-analyzer, `fetchJsonArray<Property>("/api/properties")`: the bare
    path (25 rows), with a generic between the name and the paren;
  - offers: bare-path lookups. The campaign preview valued each lead whose
    property was not among those 25 at $0;
  - marketplace: `.properties` read off the envelope, so it was always
    empty.

  All three are converted. Offers resolve properties by id and, for the
  campaign preview, by `sellerIds` (a new route filter). The gate now
  matches every read shape, with a planted canary per shape.
- The combobox is modal, so it scrolls inside dialogs. It forwards the
  validation `aria-*` props. A selected value that is loading, missing or
  deleted is named, not shown as the placeholder.
- `usePropertiesByIds` fetches in chunks instead of dropping ids past 100.
- Ids beyond int4 are a 400, not a 500.
- The negotiation guard requires an offer amount, which the route needs.
- Not in this entry: pickers and lookups on LEADS read the first page the
  same way (DEFECT-0169).
Falsified by: `tests/unit/propertyReadsAreNotTheFirstHundred.test.ts` (six
cases red pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0169
Title: Lead pickers and lookups read the first page of leads
Severity: P2
Status: OPEN
Surfaced by lenses: DEFECT-0168 audit, 2026-09-28
Description: The offers page (`client/src/pages/offers.tsx`) reads
`fetchJsonArray('/api/leads')`, which is the first page of 25 rows. It
treats that page as the whole lead book, both for the list an operator picks
campaign leads from and for the leads it values. This is DEFECT-0168's shape
on the lead side. `useLeads` itself walks the cursor up to 10,000 leads, so
finance's borrower lookup is not affected.

The leads route already takes `q`. The fix mirrors DEFECT-0168: a
server-searched lead picker, by-id lookups, and a population register over
every lead read shape.
Resolving commits: —
### DEFECT-0170
Title: Exports and book-wide money figures silently dropped an org's oldest rows past 5000
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: research report item "LIST_READ_CAP 5000 on Today and Finance", traced 2026-09-28
Description: `getLeads`, `getProperties`, `getDeals` and `getNotes` cap at
5000 rows, newest first (`server/storage/listCap.ts`). `getPayments(orgId)`
stops SILENTLY at 5000. Once an org passes 5000 rows, its OLDEST records drop
out:
- Every export path (`server/services/importExport.ts`) omitted those
  records: `/api/export` CSV and JSON, `/api/leads/export`,
  `/api/notes/export` and the backup zip.
- The data-portability job (`server/services/migrationJobs.ts`) did the
  same, and its counts reported the truncated numbers as totals.
- Date and status filters ran after the cap, so a filtered export of old
  rows came back empty.
- Finance figures dropped the old notes, which are exactly the notes most
  likely to be late (`server/routes-finance.ts`). Affected: portfolio value,
  delinquency rate and 30/60/90+ aging, lifetime collections and
  projections.
- So did the portfolio PDF, the cash-flow waterfall and Today's cash strip,
  late-note count and open-deal value.
- The note CSV import matched borrowers by email in memory against the
  newest 5000 leads, once per row. It created a DUPLICATE borrower lead for
  any older one.
Remediation plan: DONE.
- `server/storage/wholeBookReads.ts` reads the whole book (leads,
  properties, deals, notes, payments) in keyset pages with the same
  predicates as the capped getters.
- Past a 250,000-row ceiling it refuses rather than truncating.
- The exports, finance endpoints, portfolio PDF, waterfall and Today's
  money reads use it.
- The borrower match is one indexed, org-scoped query.
- A per-file register pins the number of capped reads left in each of
  these files.
Audit follow-up, same day (an independent audit of `000d6f6`):
- "Every export path" was false. Settings → "Download your data"
  (`server/services/dataPortability.ts`) read `.limit(10000)` (campaigns
  1000) with no order, and reported the truncated sum as `totalRecords`. It
  now reads every table whole.
- It and `POST /api/export/everything` lacked `canExportData`; they now
  require it.
- The org-wide Finance ledger (`GET /api/payments` with no note) read the
  capped payments while its notes were whole. It now reads every payment.
- The register missed both. Its pattern now covers `getPayments` in any
  arity and any 4+ digit `.limit()`, and it reads `dataPortability.ts`.
- Projections used `Math.min(...spread)`, which overflows the stack near
  130k payments. It is now a loop.
- The notes list endpoint went back to the capped, newest-first UI read.
- Today's properties went back to the capped list, since they feed no money
  figure. The two open offers are now explicitly the newest, and an older
  property is fetched by id.
- A refusal past the ceiling is a 413 with its message, not a generic 500.
  Two finance catches that turned it into zeros now re-throw it.
- The cash-flow waterfall still showed invented figures: a collection rate
  guessed from today's delinquency and a flat 5% late fee, the same in every
  month. It now reports each month's completed payments and late fees.
- The unused `server/services/export.ts` (capped, no importers) was deleted.
Falsified by: `tests/unit/wholeBookReadsAreWhole.test.ts` (register red
pre-fix; the reader returns 7,250 of 7,250 and refuses past the ceiling).
Resolving commits: this branch, round 3
### DEFECT-0171
Title: The remaining capped whole-org reads give wrong counts and skip old rows past 5000
Severity: P2
Status: OPEN
Surfaced by lenses: DEFECT-0170 trace, 2026-09-28
Description: About 45 more production callers of the capped getters compute
a total or claim from the newest 5000 rows, or act only on those rows.
- Today's lead-derived figures (`server/routes-today.ts`): stalled leads,
  the needs-attention badge, and the morning brief's stale-lead count. Today keeps leads on the capped list; a
  whole lead book per Today request is the wrong fix, and these need SQL
  aggregates.
- Pax and MCP count tools (`server/ai/tools.ts`, `server/mcp/index.ts`):
  - `get_cashflow_summary`, `get_pipeline_summary`, `get_stale_leads` and
    `get_system_context`;
  - `get_portfolio_summary`;
  - the filtered `get_*` searches.
- Alerts and jobs: lead-aging alerts (`server/services/alerting.ts`) and the
  delinquency sweep (`server/services/core-agents.ts`).
- Skip-trace batch and stats (`server/routes-skip-tracing.ts`). The batch
  can say "every lead already has a finished skip trace" when it does not.
- The direct-mail estimate and credit check
  (`server/routes-campaigns.ts`).
- TCPA stats (`server/routes-import-export.ts`): the total is capped while
  its parts are not.
- The offer-letter batch lookup (`server/routes-team-messaging.ts`).
- The weekly digest and "month in review" emails.
- Most can read an existing aggregate (`getDashboardStats`, `getLeadCount`,
  `getActiveNotesValue`, `getPipelineValue`) or a by-id lookup.
- Progress: Pax's `get_cashflow_summary` and `get_pipeline_summary` now
  count the whole book in SQL (`server/storage/bookAggregates.ts`), pinned
  by `tests/unit/paxBookCountsAreWhole.test.ts`.
- Progress: these by-id and by-seller lookups no longer search the capped
  lists:
  - the Pax tools `update_deal` (its pre-image) and `draft_outreach_message`
    (the seller's property);
  - `GET /api/leads/:id/properties`;
  - the offer-letter batch (`getLeadsByIds` plus properties by seller);
  - the agent skills `enrichLead` property lookup and `analyzeNote`.

  They use `readPropertiesBySellerIds` (`server/storage/wholeBookReads.ts`)
  or `getLead` / `getDeal` / `getNote`.
- The full ranked list is in the trace recorded with DEFECT-0170.
Resolving commits: —
### DEFECT-0172
Title: The batch-offer agent skill priced offers from an invented $10,000 and offered every lead in the org
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: DEFECT-0171 lookup sweep, 2026-09-28
Description: `generateBatchOffers` (`server/services/agent-skills.ts`,
registered for the deals and operations agents) had two defects.
- It started every lead at `estimatedValue = 10000`. It kept that value
  whenever the lead had no linked property, the property had no coordinates,
  or comps failed or returned no estimate. It then stored a priced offer on
  it: `estimatedMarketValue: "10000"`, a $2,500 cash offer and a terms
  schedule. That is an invented price headed for a seller's offer letter.
- When the batch named a source marketing list, it took EVERY lead in the
  org and ignored the list's `filters`.

It also read the capped lead list, and reloaded the whole capped property
list once per lead.
Remediation plan: DONE.
- An offer is priced from a comparable-sales estimate or not generated. Each
  skip says why ("no linked property" or "no comparable-sales estimate").
- List membership follows the list's filters: state, county, acreage, price,
  zoning and tax-delinquent, checked against the lead and its property.
- A set filter that the records cannot answer (owner type, years owned)
  excludes the lead rather than passing it.
- Leads and their properties are read whole, once.
Falsified by: `tests/unit/batchOffersPriceOnlyFromEvidence.test.ts` (four
cases red pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0173
Title: Listing take-down deleted any external id with the platform's credentials; unpublish claimed channels "removed" with no provider call
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: 2026-09-28 land-investing practitioner supplement (third cycle), re-verified at HEAD
Description:
- `POST /api/syndication/take-down` (`server/routes-elite-features.ts`)
  passed `platform` and any `externalListingId` from the request body to
  `takeDownListing` (`server/services/listingSyndication.ts`). That sent a
  DELETE using the PLATFORM's Land.com and Meta credentials. Any signed-in
  user could therefore ask for another tenant's live listing to be deleted.
- `takeDownListing` returned `{ success: true }` whenever `fetch` resolved,
  so a 401, 404 or 500 read as "taken down".
- `POST /api/listings/:id/unpublish` (`server/routes-team-messaging.ts`)
  marked EVERY target "removed" with no provider call. That included
  targets that had failed or were only previews. The listing page's dialog
  promised it "pulls the listing from every active syndication target".
Remediation plan: DONE.
- Take-down resolves the caller's OWN listing and its saved target for the
  platform, and uses that target's stored external id. The body's id is
  ignored.
- Another org's listing, or a target without an external id, is refused
  before any provider call.
- Only a 2xx from the provider counts as removal, and the result is written
  back to the target (`removed` or `withdrawal_failed`).
- Unpublish withdraws the listing locally. Each live target becomes
  `withdrawal_requested` (it has a take-down API and an id) or
  `manual_action_required`. A target that never went out keeps its status.
- The dialog and target labels say what happened. Not built: a take-down
  button per target and a provider read-back.
- Audit residue, closed in the same round: `PUT /api/listings/:id` accepted
  the whole insert schema. A client could write `syndicationTargets`,
  including the external `listingId` that take-down trusts, so two requests
  still aimed a platform-credentialed DELETE at another tenant's listing.
  It could also write `status`, `propertyId` or `organizationId`. A second
  audit pass found `POST /api/listings` (create) accepted the same fields.
  Both are now content-only (`.strict()`). A listing is created as a draft,
  and targets, publish time and counters change only through publish,
  unpublish, take-down and the counters' own writers.
Falsified by: `tests/unit/listingWithdrawalIsVerified.test.ts` (four cases
red pre-fix, the four PUT cases red pre-fix, and three create cases).
Resolving commits: this branch, round 3
### DEFECT-0174
Title: A property the org did not hold could be listed, published, syndicated and blasted to buyers
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: 2026-09-28 practitioner supplement ("refuse advertising a property not owned"), verified at HEAD
Description: Listing create and publish (`server/routes-team-messaging.ts`),
elite syndicate (`server/routes-elite-features.ts`) and the buyer blast
(`server/routes-buyer-blasts.ts`) checked only that the property row
belonged to the org. `properties.status` defaults to "prospect", so a parcel
the org had merely looked at, offered on, or already SOLD could be
advertised as available. The blast also mailed inactive buyer profiles from
stale matches.
Remediation plan: DONE.
- `offerabilityRefusal` (`server/services/listability.ts`) permits only
  `owned`, `listed` and `under_contract` (a wholesaler's assignable
  contract). All four entry points refuse anything else with the reason.
  Publish re-checks, so a sold parcel cannot publish.
- The blast skips inactive buyer profiles.
- Audit residue, closed in the same round: channel sync-all
  (`syncChannels`, `server/services/syndicationChannels.ts`) pushed every
  "active" listing, including one whose parcel had since SOLD. It also
  treated a `removed` or `withdrawal_requested` target as "not live here",
  so the next sync re-posted a listing that had just been taken down. Sync
  now applies `offerabilityRefusal` and never re-posts onto a withdrawn
  channel. A `failed` target is still retried.
- Still open:
  - When a parcel sells, its listing is not withdrawn. It stays "active" and
    stays live wherever it already reached.
  - The elite `POST /api/listings/:id/syndicate` pushes to any requested
    platform, ignoring a withdrawn listing or target. It never saves the
    external id, so that posting can't be taken down. Its only client
    (`client/src/pages/syndication.tsx`) passes a property id where the
    route expects a listing id.
  - Re-publishing a platform overwrites a `withdrawal_requested` or
    `withdrawal_failed` target and its external id.
Falsified by: `tests/unit/listingWithdrawalIsVerified.test.ts` (the create
case red pre-fix); `tests/unit/syncNeverRepublishesWithdrawn.test.ts` (five
cases red pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0175
Title: The cash-flow forecast invented rent on vacant land, sold listings in month 3, and raised a failing payer's collection weight
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: 2026-09-28 practitioner supplement (fourth cycle), re-verified at HEAD
Description: `server/services/cashFlowForecaster.ts`, behind
`/api/cash-flow/*` and the Finance cash-flow page
(`client/src/pages/cash-flow.tsx`):
- `projectPropertyIncome` treated every owned parcel with a market value as
  rented at 0.8% of value a month, weighted 0.7, with no lease, tenant or
  permitted use. A $20,000 vacant parcel "earned" $112 a month. That fed the
  portfolio timeline, the summary's income by source, and forecasts.
- It sold every listed parcel at list price in month 3 (p=0.4), even
  outside the requested window.
- A "declining" payer's weight was `Math.max(0.3, base - i*0.02)`, which
  RAISED the weight whenever the base was already below 0.3.
- A fixed ±25% band was presented as an "uncertainty range". Its comment
  claimed ±30% widening that did not exist.
- A maturity month was labelled "balloon payment due" although no balloon
  amount is modelled.
- `refuse()` in `server/routes-cash-flow.ts` called itself on any unexpected
  error: a stack overflow served as a 500.
Remediation plan: DONE.
- Property income is scheduled rent from the property's ACTIVE leases
  (`rentalLeases`), within each lease's dates and the window, and nothing
  otherwise. A sale or a hypothetical lease is a scenario, not scheduled
  income.
- A worsening payer's weight can only fall.
- The page calls the band an illustrative ±25% sensitivity, not a
  calibrated range, and marks note maturity months as such.
- `refuse()` falls through to `Errors.internal`.
- Not changed: the default-probability heuristics remain uncalibrated
  weights; the supplement's scenario/observed-cash views are not built.
Falsified by: `tests/unit/forecastIsContractNotAssumption.test.ts` (four
cases red pre-fix).
Resolving commits: this branch, round 3
### DEFECT-0176
Title: The closing checklist's wire-fraud interlock could be ticked without evidence; templates wiped it; generation used guessed facts
Severity: P1
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: 2026-09-28 practitioner supplement (fifth cycle), re-verified at HEAD
Description: The closing generator's wire item is `critical`,
`documentRequired` and "fraud_gate" ("DO NOT WIRE until this is checked").
- The closing PATCH (`server/routes-closing.ts`) completed it on one click.
  So did the deal page's checklist toggle (`server/routes-deals.ts`), which
  writes the SAME `deal_checklists` row.
- The recorded two-channel confirmation (`title_orders.wire_confirmed_at`)
  had no reader.
- The stage gate (`server/storage/dueDiligenceRepo.ts`) read only
  `checkedAt`, so it ignored the closing checklist's `completed`.
- Applying a template DELETED the row, with the closing checklist and every
  completed item in it.
- The status-transition hook (`server/storage/dealRepo.ts`) generated the
  checklist from the PRIOR property, un-scoped, with a "TX" fallback and a
  closing date 30 days out, and swallowed generator errors. The generator
  then returned that checklist unchanged forever.
Remediation plan: DONE.
- `fraudGateRefusal` (`server/services/closingEvidence.ts`) refuses
  completion of a fraud-gate item unless there is evidence. Either the
  deal's title order records a wire confirmation, or the request carries a
  complete attestation: the number called, where it was looked up
  independently, and who confirmed. Both routes run it.
- The audit found the first version left the item impossible to complete:
  `recordWireConfirmation` had no caller, so nothing could ever satisfy the
  gate. `recordWireAttestation` is now that writer. It stamps every title
  order on the deal and stores the attestation on the item, with who
  recorded it and when.
- The deal page opens a dialog for the wire item
  (`client/src/components/wire-verification-dialog.tsx`) instead of ticking
  it on a click.
- Second audit pass. Changes made:
  - A confirmation counts only if it is dated after the instructions were
    issued.
  - Re-issued instructions clear it (`server/services/wireInstructions.ts`).
  - Unticking the wire step withdraws it, so a re-tick needs new evidence.
  - Title orders are stamped only after the checklist write lands.
  - Unticking clears both vocabularies and the stored evidence. Every
    progress reader counts `checkedAt || completed`.
  - The manual generator no longer falls back to "TX".
- Still open: a deal whose checklist started from a template never gets the
  closing items, and so never gets the wire item. Both
  `_autoGenerateClosingChecklist` and the generator return early when a row
  exists, and the manual route still answers "created".
- The stage gate counts either vocabulary.
- A template MERGES: the closing items and any item with progress are kept.
- The hook uses the deal's current property (org-scoped), its org and its
  real closing date. Without a state or date it defers and logs, and it no
  longer swallows errors.
- The shared item type declares the closing fields.
- Not changed: an existing checklist is still not reconciled when deal
  facts change, and `isSellerFinanced` is still false on auto-generation.
- The template dialog copy no longer says completed items are lost.
Falsified by: `tests/unit/closingInterlockNeedsEvidence.test.ts` (four cases
red pre-fix, plus the attestation success path);
`tests/unit/dealChecklistToggleHonoursWireGate.test.ts` (two cases red
pre-fix). The gate test's db double answers only when the predicate
really demands an org-scoped confirmation dated after issue. Deleting
either the `isNotNull` clause or the issue-date clause turns it red.
Resolving commits: this branch, round 3
### DEFECT-0177
Title: Buyer matching offered land the org did not hold, stated conclusions its data cannot support, and kept stale scores in the blast audience
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: 2026-09-28 practitioner supplement (buyer matching), verified at HEAD
Description: `matchPropertyToBuyers` (`server/services/buyerMatchingAI.ts`,
route `POST /api/ai/buyer-matching/match` in `server/routes-ai-operations.ts`)
had no status check.
- A SOLD or prospect parcel was matched. Every fresh match fired
  `buyer.match_created`, whose installed template emails the buyer "we
  found a property matching your criteria".
- Reasons stated conclusions the data cannot support:
  - "Buyer qualifies for owner financing" came from a 10% / 60-month rule
    of thumb applied to capacity the buyer reported themselves.
  - "Buyer has cash to purchase" and "pre-approved" came from the buyer's
    own form.
  - "Zoning supports RV use" came from a substring match on a zoning label.
- Only matches scoring 40 or more were written. An EXISTING match whose
  buyer no longer fit therefore kept its old high score, and the buyer
  blast selects its audience by stored score.
- `matchBuyerToProperties` kept a second inline status list.
Remediation plan: DONE.
- Both matchers use `offerabilityRefusal`. The property-side matcher
  refuses before writing or emailing anything, and the route answers 400.
- Every candidate is scored, and an existing match is re-scored in either
  direction. Only a NEW match needs 40 or more, and only a new match emits.
  Existing matches are read in one org-scoped query.
- The reasons say what they rest on:
  - "stated budget";
  - "Estimated value (no asking price set)";
  - "self-reported, not verified";
  - "illustrative 10% down / 60-month payment — not a credit decision or
    approved terms";
  - "Zoning label … legal use not verified".
- Every match-row read and write in both matchers names the org.
  `presentMatchToBuyer` and `recordBuyerResponse` still update by id only.
  They have no callers and stay on the lint baseline.
- `matchBuyerToProperties` has no production caller, and it does not check
  the buyer's `isActive`. Re-scoring covers active buyers and offerable
  land only. The blast's own filters close the rest.
- Still open:
  - essential-versus-soft buyer requirements as supported, contradicted or
    unknown;
  - feeding the buyer's stated primary use into the scorer;
  - the founder AI console lists this tool at a path that does not exist
    (`/api/ai/buyers/match`).
Falsified by: `tests/unit/buyerMatchSaysWhatItKnows.test.ts` (nine cases
red pre-fix; independently re-measured). Its db double ignores
predicates, so `lint:org-fetch` is the tenancy gate for these queries.
Removing either org predicate turns that lint red.
Resolving commits: this branch, round 3
### DEFECT-0178
Title: A dormant owner-age lead-score signal; no gate against protected traits in decision code
Severity: P2
Status: FIXED (round 3, 2026-09-28)
Surfaced by lenses: 2026-09-28 practitioner supplement (a 2020 buyer-screening transcript treating disability and Social Security income as signs of an undesirable buyer)
Description: The supplement asks that disability, Social Security or
public-assistance income, and age never be encoded in buyer qualification,
terms eligibility, lead scores or agent prompts. `server/services/leadScoring.ts`
still carried `calcOwnerAgeSignal`: "Owner age >75 — estate/probate
probability elevated (+75)". It was unwired, one call away from live, and
nothing would have stopped it being wired.
Remediation plan: DONE.
- The signal is deleted.
- `tests/unit/protectedTraitsNeverScore.test.ts` enumerates the decision
  population: lead scoring, qualification and decay, buyer matching and
  qualification, seller intent, prospect intelligence, land credit and deal
  underwriting. It forbids age thresholds, disability, SSI/SSDI, Social
  Security, public assistance and welfare as inputs.
- String literals (prompts) are read. Comments are stripped, so the record
  of a removal does not trip the gate.
- There is a vacuity floor per file. Canaries prove that each of the five
  written shapes goes red.
- Not yet covered, found by an independent audit:
  - The population is a hand list, not a glob. It omits seller
    motivation and psychology, lead intelligence, disposition, the
    offer services and the VA / executive qualification prompts. None of
    these uses a forbidden token today.
  - The pattern misses field names without a comparison (`.age`,
    `birthYear`, `dateOfBirth`) and camelCase `ssiIncome` / `isDisabled`.
- Not decided here, recorded for the founder: seller-side life-event
  signals ("recent divorce" in `server/services/prospectIntelligence.ts`,
  keywords in `server/services/sellerIntentPredictor.ts`). Marital status is
  a protected basis under ECOA and some state housing laws. Its use for
  SELLER prospecting needs legal review, not a unilateral change. The same
  goes for the "health" (medical bills, hospital) and "retirement" intent
  keywords. Each adds +20 and surfaces as "move fast — send offer today"
  (`server/services/sellerPsychologyStrategy.ts`), and each is a proxy for
  disability or age.
Falsified by: `tests/unit/protectedTraitsNeverScore.test.ts` (the
leadScoring case red pre-fix; five canaries).
Resolving commits: this branch, round 3
### REFUTED AT HEAD, 2026-09-27

The research report ("AcreOS at full maturity", pinned at `a2dc971`) was
re-verified claim by claim against `9cb534f` before any of it was acted on.
The three commits between the two touch only CI triggers, the bundle-size gate
and sidebar contrast tokens, so file-level claims transfer — except these.

| Entry | Finding |
|-------|---------|
| §B "annual interest report portfolio totals are computed as zero" | **Refuted.** `server/services/bookkeeping.ts:247-249` sums `totalInterestCents / totalPrincipalCents / totalLateFeeCents` per note and `:261-263` returns them; `getPortfolioAnnualSummary` builds on the correct totals. The report's premise was stale at the commit it cited. |
| §19.2 "a carrier-accepted SMS becomes failed after an internal write" | **Weaker than claimed.** `postSmsCostToLedger` and `recordContactTouch` both self-catch; only the dynamic import at `smsService.ts:304` can throw after the SID. Kept inside DEFECT-0104 at its true size. |
| Report file paths | `shared/notePaymentMath.ts` → `server/services/notePaymentMath.ts`; `server/services/webhookHandlers.ts` → `server/webhookHandlers.ts`; `server/services/autopilot/financeAgent.ts` → `server/services/financeAgent.ts`; `server/services/borrowerDunningLadder.ts` → `server/jobs/borrowerDunningLadder.ts`; `server/jobs/notePaymentDueDetector.ts` → `server/services/notePaymentDueDetector.ts`; `continuousLoop.ts` lives under `server/services/solene/`. |

Not verified this session and carried as UNVERIFIED (no exploration spent):
§8.11 Map first-100 / Today 5k caps; §8.13 search fallback column names;
§26–27 import identity and job durability; §30 action-preview cancel race;
§31 alert acknowledge→resolved; §32 parcel-delta county key; §33 founder badge
count; §21 unit economics; §23 acquired-note list/IRR; §18 deal-hunt route.

### REFUTED AT HEAD, 2026-09-06

Two census entries were re-verified before acting and found obsolete. Recorded
rather than "fixed", per the standing rule that a stale premise is corrected,
not implemented against.

| Entry | Finding |
|-------|---------|
| REACH-LATEFEES-UNWIRED | `lateFeeAssessable` is called by `acquiredNoteAging.ts:335`, whose job is registered at `runScheduledJobs.ts:4022`, derived on the notes list and detail routes, typed on the client, and rendered at `note-detail.tsx:713`. Fully wired end to end. |
| REL-JOBLOCK-NO-RENEWAL (as written) | True of the mechanism, false of the named subject. The scheduler heartbeats correctly; the defect lives in `withJobLock`. Relocated and fixed as DEFECT-0094. |

---

## Summary Statistics

| Status | P0 | P1 | P2 | Total |
|--------|-----|-----|-----|-------|
| OPEN   | 0   | 1   | 11  | 12    |
| FIXED  | 13  | 86  | 64  | 163   |
| DEFERRED | 0 | 3   | 0   | 3     |
| **Total** | **13** | **90** | **75** | **178** |

Recounted from the entries themselves on 2026-09-28 (178 `### DEFECT-` blocks
by their Status and Severity lines; DEFECT-0063 PARTIALLY FIXED is counted as
OPEN). The table had drifted from the entries before this date — it read 3
FIXED P1 and 1 FIXED P2 short.

DEFECT-0089 through 0095 added 2026-09-06. Two further census entries were
re-verified at HEAD and REFUTED rather than implemented against — see the
"REFUTED AT HEAD" table above DEFECT-0089's section.

DEFECT-0096 through 0126 added 2026-09-27 from the "AcreOS at full maturity"
research report, each claim re-verified at `9cb534f` before entry (one refuted,
one downgraded — see the 2026-09-27 REFUTED table). 0096 and 0097 are FIXED in
the same change; 0101 (1099-INT direction) is FIXED as a refusal posture pending qualified tax
review (slice C, same day); 0116 and 0119 (Payment Link, Accept-payment) are
FIXED in slice A, 0104 (SMS purpose) in slice D and 0107 (blind-offer comps)
in slice B; no P1 from this report remains OPEN.

As of round 3 (2026-09-27/28) seven P2 entries are OPEN: 0048, 0049, 0050
and 0052 are structural, 0127 keeps the academy flag off until it is fixed,
and
0099 and 0106 wait on a product or founder decision. None blocks launch. The
table above is the count of record; it is recounted from the entries.

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
| DEFECT-0096 | Two borrower payment writers, one posting rule | (this branch) |
| DEFECT-0097 | Borrower payoff quote on the engine, session-keyed, recorded | (this branch) |
| DEFECT-0101 | 1099-INT generation refused pending direction review (founder bypass) | (this branch, slice C) |
| DEFECT-0116 | Payment Link payments through the one posting rule; refunds reverse | (this branch, slice A) |
| DEFECT-0119 | 100× Accept-payment charge path removed | (this branch, slice A) |
| DEFECT-0104 | SMS consent asked by declared purpose; no-lead is not permission | (this branch, slice D) |
| DEFECT-0107 | Only sales are comps; USDA is a benchmark; no promised acceptance rate | (this branch, slice B) |
| DEFECT-0117 | 1099-INT issuance promises reworded; persona pinned | (this branch, round 3) |
| DEFECT-0118 | 1099 batch response carries the files the page downloads | (this branch, round 3) |
| DEFECT-0120 | Dead SMS thread component and ungated SMS sender removed | (this branch, round 3) |
| DEFECT-0121 | Deal feed joined to the calculator's real outcome | (this branch, round 3) |
| DEFECT-0122 | Only dated sales from the last 18 months are comps (one shared rule) | (this branch, round 3) |
| DEFECT-0123 | Parcel report prices no offer; flat $250/acre instruction removed | (this branch, round 3) |
| DEFECT-0124 | Lead intelligence quotes no USDA-derived price to owners | (this branch, round 3) |
| DEFECT-0125 | Pre-refusal 1099 FIRE file download withheld | (this branch, round 3) |
| DEFECT-0126 | Due-diligence findings nobody checked are "Not verified", never clean | (this branch, round 3) |
| DEFECT-0098 | Overpayment beyond payoff recorded, reported, disclosed | (this branch, round 3) |
| DEFECT-0102 | Due detector: calendar days and the note's grace period | (this branch, round 3) |
| DEFECT-0109 | Owner-finance interest no longer counts the down payment | (this branch, round 3) |
| DEFECT-0110 | A recent failed DR drill is attention, not ready | (this branch, round 3) |
| DEFECT-0111 | Semantic AI cache scoped to task and shape; no fabricated quality score | (this branch, round 3) |
| DEFECT-0112 | Failed risk or calibration reads tighten autopilot, never loosen it | (this branch, round 3) |
| DEFECT-0113 | County request failure reported as failure; dead coverage not "covered" | (this branch, round 3) |
| DEFECT-0103 | Parked reminders re-checked against the paid period; fair batches | (this branch, round 3) |
| DEFECT-0105 | Accepted mail never failed or refunded; single-winner retry | (this branch, round 3) |
| DEFECT-0100 | Every serviced-note payoff through one engine; invented discount removed | (this branch, round 3) |
| DEFECT-0108 | Portfolio P&L by deal side, dated IRR, interest only | (this branch, round 3) |
| DEFECT-0115 | Runway cash labelled as a planning basis; bank liquidity unknown | (this branch, round 3) |
| DEFECT-0062 | Rate limiters keyed on identity before identity existed | (this branch, round 3) |
| DEFECT-0061 | Module flag seed mirrored into the release command | (this branch, round 3) |
| DEFECT-0054 | Ad-account secrets sealed; plain-text vendor-key form retired | (this branch, round 3) |
| DEFECT-0114 | Detector workflow hand-off staged in the outbox | (this branch, round 3) |
| DEFECT-0051 | Rebuild order locale-pinned; production path never reads filenames | (this branch, round 3) |
| DEFECT-0057 | Last hex-coloured chart components migrated and gated | (this branch, round 3) |
| DEFECT-0063 | `req.user as any` casts removed; ratchet widened to hold zero | (this branch, round 3) |
| DEFECT-0055 | Client-keyed module maps bounded; grow-only maps registered; metrics labels capped | (this branch, round 3) |

### Deferred Defects (3)

| ID | Title | Justification |
|----|-------|---------------|
| DEFECT-0027 | 477 KB schema bundle | Splitting 14,883-line schema.ts touches 200+ imports; requires dedicated session |
| DEFECT-0046 | No file storage backend | Requires infrastructure provisioning (S3/R2); upload security now wired |
| DEFECT-0067 | 3,089 TypeScript errors | Pre-existing structural debt; pre-commit blocks regressions in staged files |

### All P0 Defects: RESOLVED

All 12 P0 defects are fixed and deployed to production (acreos.fly.dev).
9. **DEFECT-0012** -- Destructive migration without rollback
