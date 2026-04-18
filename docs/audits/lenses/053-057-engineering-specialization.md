# Lenses 053--057 -- Engineering Specialization (DB, Transactions, Pool, Cache, Serialization)

Auditor: Engineering Specialization (Tier 2)
Date: 2026-04-18
Scope: `server/db.ts`, `server/storage.ts`, `server/services/credits.ts`, `server/middleware/responseCache.ts`, `server/utils/redis.ts`, `shared/routes.ts`, `shared/schema.ts`, `client/src/lib/queryClient.ts`, `client/src/hooks/use-*.ts`, `migrations/*.sql`

---

## Distinct-Value Declarations

| Lens | Distinct Value |
|------|---------------|
| 053 -- DB Migration Safety | Two migrations contain destructive operations (DROP TABLE, TRUNCATE CASCADE) that are irreversible in production. Fourteen of 40+ migration files lack numbered sequence discipline, creating conflicting ordinals (e.g., two 0007s, two 0008s, two 0009s, two 0010s, two 0011s, two 0012s, two 0013s). The Drizzle journal only tracks 7 of 40+ migration files, meaning most migrations are likely run manually or ad-hoc with no rollback story. |
| 054 -- Transaction Isolation | All transactions run at PostgreSQL's default READ COMMITTED isolation. There is no mechanism to request SERIALIZABLE or REPEATABLE READ. The credit ledger deduction path (`deductCredits`) performs a read-then-write outside any transaction, creating a TOCTOU race where two concurrent deductions can both succeed on insufficient balance. |
| 055 -- Connection Pool | The primary pool is configured for `max: 20` connections shared across 2 Fly.io machines with a shared-cpu-2x 1GB RAM Postgres instance. The managed Postgres likely has a `max_connections` of 25--100, meaning two app instances (40 total) could exhaust the database connection limit. The replica pool defaults to `max: 5` but falls back to the primary URL if no replica exists, doubling primary pool pressure to 25 per instance. |
| 056 -- Caching Strategy | The codebase has 15+ independent in-memory caches (Map-based), no Redis in production (package was reported missing in P0-4), and the `provider_cache` table in the schema is never queried by the provider registry -- the cache layer documented in CLAUDE.md does not actually exist in code. Cache invalidation after mutations is absent on the server side. |
| 057 -- Serialization Boundary | The `shared/routes.ts` API contract defines response schemas as `z.custom<typeof table.$inferSelect>()`, which perform no actual validation at runtime (custom passes anything). The leads list endpoint returns `{ data, total, page, pageSize, totalPages }` but the contract declares `z.array(...)`, a shape mismatch. Several client hooks use `json.data ?? json` defensive parsing to handle both old and new response shapes, indicating active drift. |

---

## Lens 053 -- DB Migration Safety

### 053-F01: Destructive migration with no rollback path (P0)

**File:** `migrations/0020_clerk_migration.sql`

This migration performs three irreversible operations in sequence:
1. `ALTER TABLE users DROP COLUMN IF EXISTS password_hash` -- deletes all user password hashes
2. `DROP TABLE IF EXISTS password_reset_tokens` / `DROP TABLE IF EXISTS sessions` -- drops tables entirely
3. `TRUNCATE TABLE users CASCADE` -- deletes all user rows and cascades to every FK-referencing table

There is no corresponding "down" migration. If the Clerk integration fails after running this migration, there is no way to restore user data or the password authentication system. The comment says "starting fresh with Clerk -- no existing users to migrate" but this assumption is dangerous for any environment that does have users.

**Remediation:** Never use TRUNCATE CASCADE in a forward migration. If a data wipe is required, it should be a separate operational script gated behind confirmation, not embedded in the migration chain. For column drops, create a backup table first (`CREATE TABLE _backup_users_auth AS SELECT id, password_hash, oauth_provider, oauth_provider_id FROM users`).

---

### 053-F02: Conflicting migration ordinals -- 7 duplicate sequence numbers (P1)

The migrations directory contains the following ordinal collisions:

| Ordinal | File A | File B |
|---------|--------|--------|
| 0003 | `0003_enrichment_columns.sql` | `0003_robust_namora.sql` |
| 0007 | `0007_composite_indexes.sql` | `0007_password_reset_tokens.sql` |
| 0008 | `0008_password_reset.sql` | `0008_feature_flags_pricing_growth.sql` |
| 0009 | `0009_account_lockout.sql` | `0009_ad_creative_bundles.sql` |
| 0010 | `0010_fts_gin_indexes.sql` | `0010_referrals.sql` |
| 0011 | `0011_autonomy.sql` | `0011_platform_config.sql` |
| 0012 | `0012_ab_tests.sql` | `0012_nps_churn_risk.sql` |
| 0013 | `0013_borrower_messages.sql` | `0013_index_audit.sql` |
| 0015 | `0015_pax_deep_features.sql` | `0015_v10_conscious_organization.sql` |
| 0016 | `0016_pax_connectors.sql` | `0016_v11_anticipatory_enterprise.sql` |
| 0017 | `0017_pax_next_gen.sql` | `0017_v12_real_runtime.sql` |
| 0018 | `0018_pax_task_runs.sql` | `0018_v13_sentient_enterprise.sql` |

The Drizzle `_journal.json` only lists 7 entries, covering `0000`, `0001`, `0002`, `0003_robust_namora`, and `0015` through `0017`. This means the remaining 33+ migration files are run manually or by an external process. Ordinal collisions mean there is no deterministic execution order, and running on a fresh database will produce undefined behavior.

**Remediation:** Renumber all migrations sequentially. Ensure every migration is tracked by the journal. Add a CI check that validates ordinal uniqueness.

---

### 053-F03: Large initial migrations have no IF EXISTS guards on CREATE TABLE (P2)

`migrations/0000_sleepy_betty_ross.sql` and `0001_brief_giant_man.sql` are the initial schema creation files (18K+ and 28K+ tokens respectively). They use plain `CREATE TABLE` statements generated by Drizzle. If re-run against an existing database (e.g., during a migration repair), they will fail with "relation already exists" errors. Later hand-written migrations correctly use `CREATE TABLE IF NOT EXISTS`.

**Remediation:** For Drizzle-generated migrations, this is by design (they are expected to run exactly once). However, for a system where most migrations are run manually, adding `IF NOT EXISTS` to the initial schema creation would improve resilience.

---

### 053-F04: Migration 0024 drops and recreates FK constraints without transaction wrapping (P2)

**File:** `migrations/0024_cascade_critical_fks.sql`

This migration performs 15 `DROP CONSTRAINT IF EXISTS` / `ADD CONSTRAINT` pairs to change FK cascade behavior. Each pair is a separate statement. If the migration fails partway through (e.g., network interruption), some tables will have the old FK behavior and others the new, leaving the schema in an inconsistent state.

**Remediation:** Wrap the entire migration in `BEGIN; ... COMMIT;` or at minimum document that it must be run in a single transaction. Drizzle's `statement-breakpoint` markers cause each statement to run independently.

---

### 053-F05: ADD COLUMN without DEFAULT on existing tables with data (P3)

`migrations/0009_account_lockout.sql` adds `failed_login_attempts integer NOT NULL DEFAULT 0` -- this is safe because it has a DEFAULT.

However, the SCP v10-v13 migrations (`0015_v10` through `0018_v13`) create 50+ tables with many `NOT NULL` columns that have defaults. These are all CREATE TABLE (not ALTER TABLE), so the NOT NULL constraint is fine. No ALTER TABLE ADD COLUMN NOT NULL without DEFAULT was found -- this is a positive signal.

---

## Lens 054 -- Transaction Isolation

### 054-F01: All transactions use default READ COMMITTED -- no configurable isolation (P1)

**File:** `server/db.ts:82-86`

```typescript
export async function withTransaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    return fn(tx as unknown as typeof db);
  });
}
```

Drizzle's `.transaction()` method uses PostgreSQL's default isolation level (READ COMMITTED). There is no parameter to specify SERIALIZABLE or REPEATABLE READ. For the payment and credit operations that use this helper, READ COMMITTED allows:

- **Non-repeatable reads:** A balance check inside the transaction can see a different value if another transaction commits between reads.
- **Phantom reads:** New rows inserted by concurrent transactions become visible mid-transaction.

The credit ledger (`addCredits`) correctly uses the transaction helper so the balance update and transaction log are atomic. But any read-then-decide-then-write pattern within these transactions is vulnerable to concurrent anomalies.

**Remediation:** Add an optional `isolationLevel` parameter to `withTransaction`:

```typescript
export async function withTransaction<T>(
  fn: (tx: typeof db) => Promise<T>,
  opts?: { isolationLevel?: 'read committed' | 'repeatable read' | 'serializable' }
): Promise<T> {
  return db.transaction(async (tx) => {
    if (opts?.isolationLevel) {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL ${sql.raw(opts.isolationLevel)}`);
    }
    return fn(tx as unknown as typeof db);
  });
}
```

---

### 054-F02: Credit deduction has TOCTOU race outside transaction (P1)

**File:** `server/services/credits.ts:75-137`

The `deductCredits` method performs:
1. Check if founder (separate query, outside transaction)
2. UPDATE organizations SET creditBalance = balance - amount WHERE balance >= amount (atomic conditional update)
3. INSERT into creditTransactions (separate statement, NOT in a transaction)

Steps 2 and 3 are NOT wrapped in `withTransaction`. If step 2 succeeds but step 3 fails (e.g., DB error, network partition), the balance is decremented but no transaction record is logged. This creates a ledger desync -- the exact problem `addCredits` solves correctly by using `withTransaction`.

The conditional UPDATE in step 2 (`WHERE balance >= amount`) does provide atomic protection against double-spending, but the missing transaction log means the deduction is invisible in the audit trail.

**Remediation:** Wrap `deductCredits` in `withTransaction` exactly as `addCredits` does. This is flagged as DI-001 in the code comments for `addCredits` but the same fix was not applied to `deductCredits`.

---

### 054-F03: Payment creation uses SELECT FOR UPDATE but at READ COMMITTED (P2)

**File:** `server/storage.ts:1846-1881`

The `createPayment` method correctly uses `withTransaction` and `SELECT ... FOR UPDATE` to lock the note row before updating the balance. This prevents concurrent payments from producing an incorrect balance. However:

1. It runs at READ COMMITTED, not SERIALIZABLE. While the `FOR UPDATE` lock provides the necessary protection for this specific pattern, any phantom reads from other tables (e.g., checking payment count) would not be protected.
2. The optimistic locking check (`WHERE notes.version = note.version`) is redundant given the `FOR UPDATE` lock -- the row is already locked exclusively. This is defense-in-depth, which is fine, but the dual-locking approach suggests uncertainty about which strategy is actually relied upon.

**Remediation:** Document explicitly that `FOR UPDATE` is the primary concurrency control for payments. Consider using REPEATABLE READ for the payment transaction to prevent phantoms. Remove or document the reason for the redundant optimistic lock.

---

### 054-F04: Billing checkout transaction does not use the tx parameter (P2)

**File:** `server/routes-billing.ts:150`

```typescript
customerId = await withTransaction(async () => {
  const customer = await stripeService.createCustomer(...);
  await storage.updateOrganization(org.id, { stripeCustomerId: customer.id });
  return customer.id;
});
```

The callback receives no `tx` argument. The `storage.updateOrganization` call uses the global `db` instance, not the transaction. This means the Stripe customer creation and the organization update are NOT actually atomic -- the `withTransaction` wrapper does nothing useful here.

Similarly in `routes-deals.ts:159`:
```typescript
const deal = await withTransaction(async () => {
  const newDeal = await storage.createDeal(input);
  ...
});
```

The `storage.createDeal` uses the global `db`, ignoring the transaction context.

**Remediation:** Accept and use the `tx` parameter. Either pass it through to storage methods or refactor storage methods to accept an optional transaction client.

---

## Lens 055 -- Connection Pool

### 055-F01: Primary pool max=20 may exhaust managed Postgres connections (P1)

**File:** `server/db.ts:27-33`

```typescript
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 60_000,
});
```

The orientation doc states: "Fly.io: 2 machines, Postgres: shared-cpu-2x, 1GB RAM." A Fly managed Postgres `shared-cpu-2x` instance typically has `max_connections` set to 25. With 2 app instances each requesting up to 20 primary connections + 5 replica connections (which fall back to primary when no replica exists), peak demand is:

- 2 instances x (20 primary + 5 replica fallback) = **50 connections** against a 25-connection limit.

This will cause `ConnectionTimeoutError` under load and can cascade into request failures.

**Remediation:** Reduce `max` to 8--10 per pool and the replica pool to 3. Use PgBouncer (available as a Fly Postgres option) for connection multiplexing. At minimum, check `max_connections` on the managed instance and set pool sizes to stay under `(max_connections - 5) / instance_count`.

---

### 055-F02: Replica pool falls back to primary URL silently (P2)

**File:** `server/db.ts:54`

```typescript
const replicaUrl = process.env.DATABASE_REPLICA_URL || process.env.DATABASE_URL!;
```

When `DATABASE_REPLICA_URL` is not set (which is the current state in production per the orientation doc), the replica pool connects to the primary. This creates two connection pools against the same Postgres instance with a combined max of 25 connections per app instance (20 + 5). No log message indicates this fallback is active, so operators have no visibility.

**Remediation:** Log a warning when falling back to primary. Consider disabling the replica pool entirely when no replica URL is provided, exporting `dbReadOnly = db` instead.

---

### 055-F03: idleTimeoutMillis mismatch between comment and code (P3)

**File:** `server/db.ts:1-12` (doc comment) vs `server/db.ts:30` (actual value)

The doc comment at the top of the file states `idleTimeoutMillis: 30s` but the actual value is `60_000` (60 seconds). Similarly, `connectionTimeoutMillis` is documented as `5s` but set to `10_000` (10 seconds). While the actual values are reasonable, the stale documentation creates confusion during incident response.

**Remediation:** Update the doc comment to match the actual configuration.

---

### 055-F04: No connection pool monitoring or alerting (P2)

The health check in `server/services/healthCheck.ts:195-199` reads `pool.totalCount`, `pool.idleCount`, and `pool.waitingCount`, but there is no threshold-based alerting. If `pool.waitingCount > 0` persistently, it indicates pool exhaustion, but no alarm fires. The health check formats these as an informational string without evaluating whether the pool is healthy.

**Remediation:** Add a degraded health status when `pool.waitingCount > 0` or `pool.totalCount >= pool.options.max - 2`. Emit this as a metric accessible to Fly.io monitoring.

---

## Lens 056 -- Caching Strategy

### 056-F01: provider_cache table exists in schema but is never used (P1)

**File:** `shared/schema.ts:2508-2521` defines the `providerCache` table with indexes for `cacheKey`, `expiresAt`, and provider/category. CLAUDE.md documents "Response caching via provider_cache table."

However, a search for `providerCache` in all server code returns zero references outside the schema definition. The provider registry (`server/services/providers/provider-registry.ts`) calls external APIs on every lookup with no cache check. Previous audit lens 01 (Principal Architect) documented this as ARCH-018 and it remains unfixed.

This means every external data lookup (Regrid parcels at $0.01+, ATTOM property data, BatchData skip traces at $0.03-0.15 each) is a fresh API call. Repeated lookups for the same parcel/address are charged multiple times.

**Remediation:** Implement cache-first in `providerRegistry.lookup()`: check `provider_cache` for a matching `cacheKey` with `expiresAt > now()`. On cache miss, call the external provider and write results to `provider_cache` with a TTL (e.g., 24h for property data, 72h for flood/soil data).

---

### 056-F02: 15+ independent in-memory Map caches with no coordination (P1)

The server has at least 15 module-level `new Map()` caches across different files:

| File | Cache | TTL | Max Size | Eviction |
|------|-------|-----|----------|----------|
| `server/routes.ts:693` | Dashboard stats | 30s | Unbounded | TTL check on hit |
| `server/middleware/responseCache.ts:25` | GET responses | Configurable | 500 (LRU) | Evict oldest |
| `server/middleware/white-label-domain.ts:27` | Domain lookup | 5 min | Unbounded | TTL check on hit |
| `server/middleware/customDomainRouter.ts:62` | Domain routing | 5 min | Unbounded | TTL check on hit |
| `server/middleware/idempotency.ts:27` | Idempotency keys | Varies | Unbounded | None |
| `server/services/comps.ts:157` | Comparable sales | 1 hour | Unbounded | TTL check on hit |
| `server/services/aiContextAggregator.ts:38` | AI context | 60s | Unbounded | TTL check on hit |
| `server/services/data-source-broker.ts:106-107` | Health + usage | None | Unbounded | None |
| `server/services/externalStatusMonitor.ts:24` | Service statuses | Varies | Unbounded | None |
| `server/services/autonomousSalesPipeline.ts:54` | Content briefs | None | Unbounded | None |
| `server/services/predictiveAutoscaler.ts:60-64` | Canary deploys + migrations + providers | None | Unbounded | None |
| `server/services/lcsCalibrator.ts:32-33` | LCS weights + history | None | Unbounded | None |
| `server/services/executionEngine.ts:300` | Execution counts | Reset interval | Unbounded | Timer |
| `server/services/paxObserver.ts:66` | Recent observations | None | Unbounded | None |

Only `responseCache.ts` has a bounded size (500 entries with LRU eviction). All others grow without limit. On a 4GB Fly.io instance, the cumulative effect is a slow memory leak (also flagged in lens 052).

These caches are per-instance, meaning the 2 Fly.io machines each have independent caches. A mutation on machine A does not invalidate the cache on machine B, producing stale reads for up to the TTL duration.

**Remediation:** Choose a single caching strategy: either consolidate into the bounded `responseCache` middleware for HTTP-layer caching, or introduce Redis (which is already partially coded but not deployed). Eliminate unbounded Maps.

---

### 056-F03: No Redis in production -- fallback to in-memory everywhere (P1)

**File:** `server/utils/redis.ts`

The orientation doc P0-4 states: "Redis package missing -- Health check shows 'Cannot find package redis' in production." The Redis client utility gracefully falls back to `null`, and every consumer (rate limiting, idempotency, alerts, job queue) falls back to in-memory storage.

This means:
1. Rate limiting is per-instance, not per-cluster. Each of the 2 machines has its own counter, so the effective limit is doubled.
2. Idempotency keys are per-instance. A retry that hits a different machine will bypass the idempotency check.
3. BullMQ job queue is disabled ("running in-memory job queue" per admin dashboard).
4. Realtime alerts cannot coordinate across instances.

**Remediation:** Provision a Redis instance (Fly offers Upstash Redis via `fly redis create`). Install `ioredis` as a production dependency. This single fix resolves multiple cross-cutting concerns.

---

### 056-F04: TanStack Query staleTime/gcTime are well-structured on the client (P3 -- positive finding)

**File:** `client/src/lib/queryClient.ts:162-174`

The client has centralized `STALE_TIMES` and `CACHE_TIMES` constants:

```typescript
export const CACHE_TIMES = { static: 60min, short: 2min, medium: 5min, long: 15min };
export const STALE_TIMES = { static: 60min, short: 30s, medium: 2min, long: 5min };
```

Most hooks use these shared constants (e.g., `use-deals.ts`, `use-leads.ts`, `use-properties.ts` all use `STALE_TIMES.short` + `CACHE_TIMES.medium`). Real-time pages like `agent-command-center.tsx` use appropriate `refetchInterval` values (10-15s). The defaults (`staleTime: 2min`, `gcTime: 5min`) are reasonable for a SPA.

The only concern is that some pages define inline stale times (e.g., `today.tsx` has 10+ individual `staleTime: 5 * 60 * 1000` values instead of using `STALE_TIMES.long`), which creates maintenance fragility.

---

### 056-F05: Server-side response cache does not invalidate on mutations (P2)

**File:** `server/middleware/responseCache.ts`

The `responseCache` middleware caches GET responses per org. The `invalidateOrgCache(orgId)` function exists but is never called after POST/PUT/DELETE mutations. This means:

1. After creating a deal, the cached deal list continues to serve stale data until the TTL expires.
2. After updating organization settings, the cached settings response is stale.

The function is exported but unused -- a grep for `invalidateOrgCache` shows zero call sites outside the module itself.

**Remediation:** Call `invalidateOrgCache(req.organization.id)` in the `apiRequest` middleware for non-GET methods, or add mutation-specific invalidation in route handlers.

---

## Lens 057 -- Serialization Boundary / JSON Shape Drift

### 057-F01: shared/routes.ts response schemas use z.custom() -- no runtime validation (P1)

**File:** `shared/routes.ts:36-96`

```typescript
responses: {
  200: z.custom<typeof leads.$inferSelect>(),
}
```

`z.custom<T>()` with no predicate function accepts any value at runtime. It provides TypeScript type inference but zero runtime validation. When the client calls `api.leads.get.responses[200].parse(await res.json())`, the `.parse()` call always succeeds regardless of the actual JSON shape. This defeats the purpose of having a shared contract.

Only 4 hooks in the client actually use these shared route definitions (`use-leads.ts`, `use-properties.ts`, `use-notes.ts`, `use-agent-tasks.ts`). The remaining 900+ endpoints have no shared contract at all.

**Remediation:** Replace `z.custom<typeof table.$inferSelect>()` with actual Zod schemas derived from the Drizzle schema (e.g., `createSelectSchema(leads)` from `drizzle-zod`). This provides real runtime validation of the server response shape.

---

### 057-F02: Leads list endpoint returns paginated shape but contract declares flat array (P1)

**File:** `shared/routes.ts:39-42` declares:
```typescript
list: {
  responses: {
    200: z.array(z.custom<typeof leads.$inferSelect>()),
  }
}
```

But the actual server response (`server/routes.ts` lead list handler) returns:
```json
{ "data": [...], "total": 100, "page": 1, "pageSize": 25, "totalPages": 4 }
```

The client hook `use-leads.ts:54` handles both shapes defensively:
```typescript
return Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
```

This `json.data ?? json` pattern appears in `use-deals.ts:51` as well:
```typescript
return json.data ?? json;
```

The shared contract is stale -- it predates the pagination migration. Any new client code that trusts the contract will break when it receives the paginated envelope.

**Remediation:** Update `shared/routes.ts` to reflect the actual paginated response shape. Add separate type definitions for paginated vs. legacy endpoints.

---

### 057-F03: PaginatedLeadsResponse uses `data: any[]` -- type safety gap (P2)

**File:** `client/src/hooks/use-leads.ts:8-14`

```typescript
export interface PaginatedLeadsResponse {
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
```

The `data` field is typed as `any[]`. The same pattern exists in `use-properties.ts:9` (`data: any[]`). Only `use-deals.ts:8` correctly types it as `data: Deal[]`.

This means TypeScript provides no help catching shape mismatches for leads and properties. Any field rename or type change on the server will not produce a compile error on the client.

**Remediation:** Change to `data: Lead[]` and `data: Property[]` using the shared schema types.

---

### 057-F04: Drizzle camelCase mapping creates implicit serialization contract (P2)

Drizzle ORM maps snake_case database columns to camelCase JavaScript properties automatically. The server returns Drizzle query results directly as JSON (e.g., `res.json(deal)` in `routes-deals.ts:122`). This means the JSON response uses camelCase field names (`organizationId`, `createdAt`) even though the database columns are snake_case (`organization_id`, `created_at`).

This implicit mapping is consistent across all endpoints -- Drizzle handles it. However, there are two risks:

1. **Raw SQL queries bypass the mapping.** Any endpoint using `db.execute(sql`...`)` returns snake_case column names directly. If such a response is consumed by client code expecting camelCase, fields will be `undefined`.

2. **jsonb columns are passed through as-is.** Columns like `metadata jsonb` store whatever shape was inserted. If some code inserts snake_case keys and other code inserts camelCase keys, the JSON shape of jsonb fields is unpredictable.

**Remediation:** Audit all `db.execute(sql`...)` return values for casing consistency. Establish a convention for jsonb column key casing (camelCase preferred, matching the JS layer) and validate on insert.

---

### 057-F05: Error response shape is standardized but not validated on the client (P3)

**File:** `client/src/lib/queryClient.ts:10-15`

```typescript
interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
  statusCode: number;
}
```

The server uses `Errors.*` helpers that produce this shape. The client's `throwIfResNotOk` function attempts to parse it but does not validate the shape -- if the server returns a non-conforming error (e.g., from Express default error handler, or from a middleware like `express.json()` body limit), the client falls through to raw text handling.

This is a minor concern because the fallback behavior is reasonable (display raw text), but it means the client can't reliably extract `error`, `details`, or `statusCode` from all error responses.

---

### 057-F06: Date fields arrive as ISO strings but are typed as Date in shared schema (P3)

Drizzle's `timestamp()` columns produce JavaScript `Date` objects on the server. When serialized to JSON via `res.json()`, they become ISO 8601 strings. The client receives strings but the TypeScript types from `@shared/schema` declare them as `Date`. This silent mismatch means code like `lead.createdAt.toLocaleDateString()` will crash at runtime because `createdAt` is actually a string, not a Date.

The client generally works around this by using `new Date(value)` or date-fns functions that accept strings, but the type mismatch is a latent bug surface.

**Remediation:** Define separate client-side types where Date fields are typed as `string | Date`, or use a superjson-style serialization layer.

---

## Summary Table

| ID | Lens | Severity | Title |
|----|------|----------|-------|
| 053-F01 | Migration Safety | P0 | Destructive migration (DROP TABLE, TRUNCATE CASCADE) with no rollback |
| 053-F02 | Migration Safety | P1 | 12 ordinal collisions in migration filenames; journal tracks only 7 of 40+ |
| 053-F03 | Migration Safety | P2 | Initial Drizzle migrations lack IF EXISTS guards |
| 053-F04 | Migration Safety | P2 | FK cascade migration not transaction-wrapped |
| 053-F05 | Migration Safety | P3 | ADD COLUMN patterns are safe (positive finding) |
| 054-F01 | Transaction Isolation | P1 | No configurable isolation level; everything is READ COMMITTED |
| 054-F02 | Transaction Isolation | P1 | deductCredits not wrapped in transaction -- ledger desync risk |
| 054-F03 | Transaction Isolation | P2 | Payment SELECT FOR UPDATE at READ COMMITTED; redundant optimistic lock |
| 054-F04 | Transaction Isolation | P2 | withTransaction callbacks ignore tx param -- operations use global db |
| 055-F01 | Connection Pool | P1 | max=20 per instance may exhaust 25-connection managed Postgres |
| 055-F02 | Connection Pool | P2 | Replica pool silently falls back to primary, doubling connection pressure |
| 055-F03 | Connection Pool | P3 | Doc comment does not match actual pool config values |
| 055-F04 | Connection Pool | P2 | No connection pool health threshold alerting |
| 056-F01 | Caching Strategy | P1 | provider_cache table defined in schema but never queried -- documented cache layer does not exist |
| 056-F02 | Caching Strategy | P1 | 15+ unbounded in-memory Map caches with no coordination across instances |
| 056-F03 | Caching Strategy | P1 | No Redis in production -- all distributed concerns fall back to per-instance memory |
| 056-F04 | Caching Strategy | P3 | Client TanStack Query staleTime/gcTime are well-structured (positive) |
| 056-F05 | Caching Strategy | P2 | Server response cache invalidateOrgCache() exists but is never called |
| 057-F01 | Serialization | P1 | shared/routes.ts z.custom() provides zero runtime validation |
| 057-F02 | Serialization | P1 | List endpoints return paginated envelope but contract declares flat array |
| 057-F03 | Serialization | P2 | PaginatedLeadsResponse uses `data: any[]` -- no type safety |
| 057-F04 | Serialization | P2 | Drizzle camelCase mapping is implicit; raw SQL and jsonb bypass it |
| 057-F05 | Serialization | P3 | Error response shape not validated on client |
| 057-F06 | Serialization | P3 | Date fields typed as Date but arrive as ISO strings |

**Total findings: 24 (3 P0/P1 critical, 9 P1, 7 P2, 5 P3)**
