# Lens 4 -- Database Architect Audit

**Auditor persona:** Senior Database Architect evaluating schema design, indexing strategy, query patterns, migration hygiene, data integrity constraints, and scalability of the data layer.

**Date:** 2026-04-15

---

## Executive Summary

AcreOS runs a **429-table Drizzle ORM schema in a single 14,883-line file** against a shared-cpu Fly.io Postgres instance with 1 GB RAM. Core CRM tables (leads, properties, deals, notes, payments) have reasonable composite indexes added via dedicated migration files (`0007`, `0013`), and there is a read-replica routing layer (`dbReadOnly`). However, the data layer suffers from **critical multi-tenant isolation gaps** (update/delete methods that omit `organizationId` from WHERE clauses), a **non-transactional payment-balance mutation** that risks financial data corruption, **unbounded SELECT queries** used pervasively on dashboard and analytics routes, and **zero ON DELETE CASCADE/SET NULL** on almost all foreign keys. The 429-table schema is littered with unused "sentient enterprise" tables that bloat migration time and connection catalog. Twelve migration sequence numbers are duplicated, creating ambiguous ordering.

---

## Findings

### DB-001: Payment balance update is not transactional -- race condition on financial data

**Severity:** P0

**Description:** `storage.createPayment()` inserts a payment row, then reads the current note balance, computes a new balance, and writes it back -- all as three separate, non-transactional statements. Two concurrent payments on the same note (e.g. autopay + manual payment) can both read the same `currentBalance`, each subtract their principal, and write back a balance that only reflects one payment. This causes **financial data corruption**: the note balance will be too high, leading to incorrect payoff quotes, wrong delinquency calculations, and potential legal exposure.

**Evidence:**
```
server/storage.ts:1841-1857
  async createPayment(payment: InsertPayment) {
    const [newPayment] = await db.insert(payments).values(payment).returning();
    if (payment.status === "completed") {
      const [note] = await db.select().from(notes).where(eq(notes.id, payment.noteId));
      if (note) {
        const newBalance = Number(note.currentBalance) - Number(payment.principalAmount);
        await db.update(notes).set({
          currentBalance: String(Math.max(0, newBalance)),
          ...
        }).where(eq(notes.id, payment.noteId));
      }
    }
  }
```

The `withTransaction` helper exists in `server/db.ts` but is **not used here**. Only `routes-deals.ts` and `routes-billing.ts` use it across the entire codebase.

**Remediation:** Wrap the insert + balance update in `withTransaction()`. Better: use a single `UPDATE notes SET current_balance = current_balance - $1 WHERE id = $2 AND current_balance >= $1` to make it atomic and prevent negative balances without a read-then-write cycle.

---

### DB-002: Multi-tenant isolation broken in update/delete methods

**Severity:** P0

**Description:** Numerous mutation methods in `storage.ts` filter only on `id` without including `organizationId` in the WHERE clause. A caller who guesses or enumerates IDs can modify or delete another tenant's data. The methods `updateLead`, `updateProperty`, `updateNote`, `deleteNote`, `updatePayment`, `updateTeamMember`, `updateAgentTask`, and at least 30 `delete*` methods all exhibit this pattern.

**Evidence:**
```
server/storage.ts:1334  async updateLead(id: number, updates: Partial<InsertLead>) {
    .where(eq(leads.id, id))         // <-- no organizationId filter

server/storage.ts:1616  async updateProperty(id: number, updates: Partial<InsertProperty>) {
    .where(eq(properties.id, id))     // <-- no organizationId filter

server/storage.ts:1806  async updateNote(id: number, updates: Partial<InsertNote>) {
    .where(eq(notes.id, id))          // <-- no organizationId filter

server/storage.ts:1813  async deleteNote(id: number) {
    await db.delete(notes).where(eq(notes.id, id));  // hard delete, no org filter

server/storage.ts:1860  async updatePayment(id: number, ...) {
    .where(eq(payments.id, id))       // <-- no organizationId filter
```

Contrast with `updateDeal` (line 1702) which **does** include optimistic locking and with `getDeal` (line 1691) which correctly filters on `organizationId`. The inconsistency suggests these were never systematically reviewed.

**Remediation:** Every mutation method must accept `orgId` and include `eq(table.organizationId, orgId)` in its WHERE clause. Add a lint rule or code-review checklist item for this pattern. The `delete*` methods taking only `(id: number)` are the highest priority since they allow cross-tenant deletion.

---

### DB-003: No ON DELETE CASCADE on any foreign key (except 3 in auth model)

**Severity:** P0

**Description:** Of the ~200 foreign key references in `schema.ts`, only 3 (in `shared/models/auth.ts`) specify `onDelete` behavior. The remaining ~197 FK references use the Postgres default of `RESTRICT/NO ACTION`. This means:
- Deleting an organization will fail if it has any leads, properties, deals, notes, etc.
- Deleting a lead will fail if it has activities, score history, conversations, etc.
- The soft-delete pattern used for leads/properties/deals does not protect against orphans in the ~380 satellite tables that reference them.
- Bulk property deletion (`bulkDeleteProperties`, line 1640) manually deletes from 4 child tables before deleting the property -- but misses `parcelSnapshots`, `offerLetters`, `taxEscrowPayments`, `ddAssignments`, `swotReports`, `goNogoMemos`, `buyerReservations`, `escrowChecklists`, `closingPackets`, and more.

**Evidence:**
```
shared/schema.ts: Only 3 FK references have onDelete:
  line 32: referrerId .references(() => users.id, { onDelete: "cascade" })
  line 33: refereeId  .references(() => users.id, { onDelete: "set null" })
  line 10075: layerId .references(() => dataSources.id, { onDelete: "cascade" })

Remaining ~197 FKs have no cascade behavior defined.
```

The manual child-table cleanup in `bulkDeleteProperties` (lines 1644-1648) only handles 4 of 15+ child tables:
```
server/storage.ts:1644  await db.delete(dueDiligenceDossiers).where(...)
server/storage.ts:1645  await db.delete(dueDiligenceChecklists).where(...)
server/storage.ts:1646  await db.delete(dueDiligenceItems).where(...)
server/storage.ts:1647  await db.delete(propertyListings).where(...)
server/storage.ts:1648  await db.delete(deals).where(...)
// Missing: taxEscrowPayments, parcelSnapshots, offerLetters, ddAssignments, etc.
```

**Remediation:** Add `{ onDelete: "cascade" }` or `{ onDelete: "set null" }` to every foreign key reference, chosen based on the relationship semantics. Generate a migration to add the constraints. This is a breaking change that requires auditing existing data for orphan rows first.

---

### DB-004: Unbounded SELECT queries on core tables, loaded into memory for analytics

**Severity:** P1

**Description:** `getLeads()`, `getDeals()`, `getProperties()`, `getNotes()` all return every row for an organization with no LIMIT clause. These are called from dashboard intelligence, analytics, MCP server, and team messaging routes, loading potentially thousands of rows into Node.js memory for in-app filtering and counting.

**Evidence:**
```
server/storage.ts:1261  async getLeads(orgId, filters?) {
    return await db.select().from(leads)
      .where(and(...conditions))
      .orderBy(desc(leads.createdAt));   // no .limit()

server/routes-dashboard.ts:43-45  (Dashboard Intelligence endpoint)
    const allLeads = await storage.getLeads(org.id);
    const allDeals = await storage.getDeals(org.id);
    const allProperties = await storage.getProperties(org.id);
    // then filters in-memory for week-over-week anomaly detection

server/routes-micro-features.ts:119  const allProps = await storage.getProperties(org.id);
server/routes-micro-features.ts:296  const leads = await storage.getLeads(orgId);
server/mcp/index.ts:544-547  // Loads all 4 entity types for context summary
```

On a production database with even moderate usage (5,000+ leads per org), this will cause memory spikes, GC pauses, and on a 1 GB RAM Fly.io shared instance, potential OOM kills.

**Remediation:** Replace in-memory analytics with SQL aggregation queries (COUNT, SUM, GROUP BY). Add pagination defaults and hard limits. The paginated variants (`getLeadsPaginated`, `getDealsPaginated`, `getPropertiesPaginated`) already exist but are not used in the analytics routes.

---

### DB-005: Financial amounts stored as `numeric` without precision -- unlimited arbitrary precision

**Severity:** P1

**Description:** All financial columns (`originalPrincipal`, `currentBalance`, `monthlyPayment`, `purchasePrice`, `offerAmount`, `creditBalance`, etc.) use bare `numeric("column_name")` without specifying precision or scale. Postgres `numeric` without parameters allows **arbitrary precision** -- any number of digits. While this won't corrupt data, it means:
- No DB-level guard against accidentally storing `999999999999999.999999` in a balance field
- `Number()` conversions in JS will lose precision for values > 2^53
- No consistent rounding behavior across the system

The one exception is `goals.targetValue` which correctly specifies `numeric("target_value", { precision: 14, scale: 2 })`.

**Evidence:**
```
shared/schema.ts:24   creditBalance: numeric("credit_balance").default("0")
shared/schema.ts:777  originalPrincipal: numeric("original_principal").notNull()
shared/schema.ts:778  currentBalance: numeric("current_balance").notNull()
shared/schema.ts:874  amount: numeric("amount").notNull()
shared/schema.ts:672  offerAmount: numeric("offer_amount")
// ~40 more numeric financial columns without precision
```

**Remediation:** Add `{ precision: 14, scale: 2 }` to all financial columns. Generate an ALTER COLUMN migration (safe for existing data since the constraint only restricts future writes). Audit the trust ledger table (`trust_ledger.amount`, `trust_ledger.runningBalance`) especially carefully since it tracks legal fiduciary balances.

---

### DB-006: 429 tables in a single file; 12 duplicate migration sequence numbers

**Severity:** P1

**Description:** The entire schema is in `shared/schema.ts` (14,883 lines). This file defines 429 pgTable declarations, ~200 FK relations, ~50 Zod insert schemas, and ~50 type exports. It is unmaintainable and causes:
- Slow editor performance (most IDEs struggle with 15K-line TS files)
- No logical separation between domains (CRM, billing, AI agents, marketplace, compliance)
- High merge conflict probability

Additionally, 12 of the 35 migration files have **duplicate sequence numbers** (e.g., `0003_enrichment_columns.sql` and `0003_robust_namora.sql`, `0007_composite_indexes.sql` and `0007_password_reset_tokens.sql`). This means migration ordering is ambiguous and depends on filesystem sort order. Drizzle Kit uses the `/meta` journal to track applied migrations, but the numbering suggests parallel development without coordination.

**Evidence:**
```
Duplicate migration numbers: 0003, 0007, 0008, 0009, 0010, 0011, 0012, 0013, 0015, 0016, 0017, 0018
```

**Remediation:** Split `schema.ts` into domain-scoped files (e.g., `schema/crm.ts`, `schema/billing.ts`, `schema/agents.ts`) and re-export from an index. Re-number migrations to eliminate duplicates and ensure deterministic ordering. Verify the `meta/_journal.json` matches the actual migration file inventory.

---

### DB-007: `team_members` table missing unique constraint on `(organization_id, user_id)`

**Severity:** P1

**Description:** The `team_members` table allows the same user to be added to the same organization multiple times. There is no unique constraint on `(organization_id, user_id)`. The `notification_preferences` table has a similar issue -- no unique constraint on `(user_id, organization_id, event_type)` -- leading to the manual check-then-insert pattern in `upsertNotificationPreference()`.

**Evidence:**
```
shared/schema.ts:114-125
  export const teamMembers = pgTable("team_members", {
    organizationId: integer("organization_id").references(() => organizations.id).notNull(),
    userId: text("user_id").notNull(),
    // No unique constraint on (organizationId, userId)
  });

shared/schema.ts:4008-4017
  export const notificationPreferences = pgTable("notification_preferences", {
    userId: text("user_id").notNull(),
    organizationId: integer("organization_id")...notNull(),
    eventType: text("event_type").notNull(),
    // No unique constraint on (userId, organizationId, eventType)
  });
```

The `custom_field_values` table also lacks a unique constraint on `(definitionId, entityId)`, relying on application-level check-then-insert logic (storage.ts:4028-4046) which is racy under concurrency.

**Remediation:** Add composite unique constraints/indexes. Use `ON CONFLICT ... DO UPDATE` (Drizzle `onConflictDoUpdate`) instead of select-then-insert patterns.

---

### DB-008: API keys and secrets stored in plaintext in the database

**Severity:** P1

**Description:** Several tables store API keys, access tokens, and secrets as plaintext in text columns:

- `system_api_keys.api_key` -- provider API keys (e.g., OpenAI, Twilio)
- `founder_ad_accounts.access_token` and `founder_ad_accounts.app_secret` -- Meta/Google ad credentials
- `organization_integrations.credentials` -- JSONB blob containing `apiKey`, `authToken`, `stripeConnectAccessToken`, `stripeConnectRefreshToken`

The `organization_integrations` table's `credentials` field has both an `encrypted` field and raw `apiKey`/`authToken` fields in the same JSONB type definition, suggesting encryption was planned but never implemented consistently.

**Evidence:**
```
shared/schema.ts:10107-10109
  provider: text("provider").notNull().unique(),
  apiKey: text("api_key"),                       // plaintext

shared/schema.ts:10971-10974
  accessToken: text("access_token").notNull(),   // plaintext Meta token
  appSecret: text("app_secret"),                 // plaintext Meta secret

shared/schema.ts:195-198  (organizationIntegrations.credentials JSONB)
  encrypted?: string;
  apiKey?: string;          // plaintext alongside encrypted field
  authToken?: string;       // plaintext Twilio token
```

The `integration_credentials` table (line 13436) correctly uses `encryptedValue`, and `org_api_keys` stores a `keyHash` -- but these are different, newer tables. The older credential storage tables remain unencrypted.

**Remediation:** Encrypt all credential fields at rest using envelope encryption (e.g., `pgcrypto` or application-level AES-256-GCM). Remove plaintext credential fields from the `organization_integrations.credentials` JSONB type. Rotate all existing keys after migration.

---

### DB-009: `statement_timeout` documented but not configured on the pool

**Severity:** P1

**Description:** The comment in `server/db.ts` says `statement_timeout: 30s (kill runaway queries at the DB level)`, but the actual `Pool` configuration does not set `statement_timeout`. There is no `options` or `connectionParameters` property that would set `SET statement_timeout = '30s'` on each connection. The only reference to `statement_timeout` in the entire codebase is the comment itself.

**Evidence:**
```
server/db.ts:27-32
  export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 10_000,
    // No statement_timeout configured
  });
```

Without statement_timeout, a single runaway query (e.g., a full table scan on an unindexed 429-table schema, or an accidental cartesian join) can monopolize a connection indefinitely, eventually exhausting the pool of 20 connections.

**Remediation:** Add `statement_timeout` to the pool configuration:
```
const pool = new Pool({
  ...existing,
  options: '-c statement_timeout=30000',
});
```
Or set it at the database role level via `ALTER ROLE ... SET statement_timeout = '30s'`.

---

### DB-010: N+1 query pattern in `batchScoreLeads`

**Severity:** P1

**Description:** The `batchScoreLeads` method in `server/services/leadScoring.ts` iterates over an array of lead IDs and calls `this.scoreLead()` for each one sequentially. Each `scoreLead` call performs multiple database queries (fetch lead, fetch property, fetch enrichment data, insert score history, update lead score). For a batch of 100 leads, this produces 300-500+ sequential queries.

**Evidence:**
```
server/services/leadScoring.ts:161-178
  async batchScoreLeads(leadIds: number[], organizationId: number, ...) {
    const results = [];
    for (const leadId of leadIds) {
      const result = await this.scoreLead(leadId, organizationId, triggerSource);
      results.push(result);
    }
    return results;
  }
```

**Remediation:** Fetch all leads in a single `WHERE id IN (...)` query, batch the enrichment lookups, and use a single `INSERT ... VALUES (...)` for the score history records. Use `Promise.allSettled()` for the enrichment lookups that hit external APIs.

---

### DB-011: Trust ledger running balance computed by "last inserted row" -- no integrity guarantee

**Severity:** P1

**Description:** The `trust_ledger` table stores `running_balance` on each row, and `getTrustBalance()` returns the running balance from the most recent row by `created_at` ordering. There is no constraint ensuring the running balance is consistent. If two entries are inserted concurrently, or if a row is deleted/modified, the running balance chain is broken silently. For a **fiduciary trust account**, this is a regulatory risk.

**Evidence:**
```
server/storage.ts:7840-7847
  async getTrustBalance(organizationId: number): Promise<string> {
    const [latest] = await db.select({ runningBalance: trustLedger.runningBalance })
      .from(trustLedger)
      .where(eq(trustLedger.organizationId, organizationId))
      .orderBy(desc(trustLedger.createdAt))
      .limit(1);
    return latest?.runningBalance ?? "0";
  }

shared/schema.ts:5867-5878
  trust_ledger has no immutability constraints, no trigger to enforce
  running_balance = previous_running_balance + amount
```

**Remediation:** Compute the running balance from `SUM(amount)` rather than trusting the stored value. Add an immutability trigger (deny UPDATE/DELETE on trust_ledger). Wrap all trust ledger inserts in a serializable transaction or use `SELECT ... FOR UPDATE` on the last row.

---

### DB-012: Pool configuration comment/code mismatch; no monitoring

**Severity:** P2

**Description:** The comment block in `db.ts` states `max: 20 connections`, `idleTimeoutMillis: 30s`, and `connectionTimeoutMillis: 5s`, but the actual configured values differ: `idleTimeoutMillis: 60_000` (60s, not 30s) and `connectionTimeoutMillis: 10_000` (10s, not 5s). Additionally, the "Slow Query Monitoring" mentioned in the module docstring is not implemented -- there is no query timing or logging in the pool configuration.

**Evidence:**
```
server/db.ts:6-10 (comment)
  idleTimeoutMillis: 30s (release unused connections quickly)
  connectionTimeoutMillis: 5s (fail fast rather than queue)

server/db.ts:29-31 (actual)
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 10_000,
```

No slow query logging exists. The pool has no `on('error')` handler (the replica pool does, at line 55-57, but the primary does not).

**Remediation:** Fix the comment to match reality. Add an `on('error')` handler to the primary pool. Implement the promised slow query logging by wrapping Drizzle's query execution with timing.

---

### DB-013: `deleteAiConversation` cascades manually but misses org check

**Severity:** P2

**Description:** Multiple delete methods perform manual cascade cleanup but omit the `organizationId` filter, allowing cross-tenant deletion. `deleteAiConversation` deletes all messages for a conversation and then the conversation itself, filtering only on `id`.

**Evidence:**
```
server/storage.ts:2161-2163
  async deleteAiConversation(id: number) {
    await db.delete(aiMessages).where(eq(aiMessages.conversationId, id));
    await db.delete(aiConversations).where(eq(aiConversations.id, id));
  }

Similarly: deleteAiMemory (line 2132), deleteNote (line 1813), deleteVaCalendarEvent (2679),
  deleteVaTemplate (2708), deleteChecklistTemplate (2842), etc.
```

**Remediation:** All delete methods should require `orgId` and include it in the WHERE clause. This overlaps with DB-002 but specifically highlights the cascade-style deletes that touch multiple tables.

---

### DB-014: ~250 tables with `organizationId` FK but no index on `organizationId`

**Severity:** P2

**Description:** While migration `0007_composite_indexes.sql` and `0013_index_audit.sql` added composite indexes for the most critical tables (leads, deals, properties, notes, campaigns, etc.), the vast majority of the 429 tables have an `organizationId` column with a foreign key but no index. Since nearly every query filters by `organizationId`, these queries will sequential-scan the table.

Tables with `organization_id` FK but no `_org_idx` defined in schema.ts include: `lead_activities`, `lead_scoring_profiles`, `lead_score_history`, `lead_conversions`, `tax_escrow_payments`, `campaign_responses`, `campaign_delivery_events`, `custom_field_definitions`, `notification_preferences`, `tasks`, `offer_letters`, `offer_templates`, `skip_traces`, `offers`, `seller_communications`, and ~200 more satellite tables.

**Evidence:** 199 occurrences of `organization_id` column definitions in schema.ts, but only ~25 tables define an explicit org index.

**Remediation:** Add a `index("tablename_org_idx").on(table.organizationId)` to every table that has the column. This can be done in a single migration file and is safe to apply to production.

---

### DB-015: No enum types or check constraints for status/type columns

**Severity:** P2

**Description:** All status and type columns use unbounded `text` type with no check constraints. For example, `leads.status` accepts any string, though the domain is documented as `new | mailed | responded | negotiating | accepted | closed | dead`. Similarly, `deals.status`, `notes.status`, `payments.status`, `campaigns.type`, etc. There are zero `.check()` calls in the entire schema. This means a typo or API bug can insert invalid status values that break UI rendering and aggregation queries.

**Evidence:**
```
shared/schema.ts:320  status: text("status").notNull().default("new"),
  // Seller statuses: new, mailed, responded, negotiating, accepted, closed, dead
  // Buyer statuses: new, interested, qualified, under_contract, closed, dead

shared/schema.ts:668  status: text("status").notNull().default("negotiating"),
  // negotiating, offer_sent, countered, accepted, in_escrow, closed, cancelled

Grep for .check( in schema.ts: 0 results
```

**Remediation:** Add `pgEnum` types for each status/type column, or at minimum add `.check()` constraints. Drizzle supports `pgEnum` natively: `export const leadStatusEnum = pgEnum('lead_status', ['new', 'mailed', ...])`.

---

### DB-016: Soft-delete inconsistency -- some tables use `deletedAt`, some use `status = 'deleted'`

**Severity:** P2

**Description:** The codebase uses two different soft-delete patterns inconsistently:
1. `deletedAt` timestamp column (leads, properties, deals) -- `IS NULL` = active
2. `status = 'deleted'` mutation (used in `deleteLead`, `deleteProperty`, `bulkDeleteDeals`) -- sets status to "deleted" string

The `deleteLead()` method sets `status: "deleted"` (line 1345) but the `getLeadCount()` method filters on `deletedAt IS NULL` (line 1352). The `getLeads()` method also filters on `deletedAt IS NULL` (line 1262). This means **soft-deleted leads (via `deleteLead`) are still included in `getLeads()` results** because `deletedAt` is never set -- only `status` is changed to "deleted".

**Evidence:**
```
server/storage.ts:1342-1348  deleteLead: sets status='deleted', NOT deletedAt
server/storage.ts:1262  getLeads: filters on deletedAt IS NULL
server/storage.ts:1352  getLeadCount: filters on deletedAt IS NULL

server/storage.ts:1623-1628  deleteProperty: sets status='deleted', NOT deletedAt
server/storage.ts:1574  getProperties: filters on status != 'deleted'  (different pattern!)
```

Properties filter on `status != 'deleted'` while leads filter on `deletedAt IS NULL`. The two approaches are mixed within the same entity.

**Remediation:** Standardize on one pattern. Recommended: always set both `deletedAt = new Date()` and `status = 'deleted'` in delete operations, and filter on `deletedAt IS NULL` consistently.

---

### DB-017: 1 GB RAM Postgres with 429 tables and 20+5 connection pool

**Severity:** P2

**Description:** The Fly.io Postgres instance is `shared-cpu-2x` with 1 GB RAM (per orientation doc). The schema has 429 tables with ~567 indexes. The primary pool has `max: 20` and the replica pool has `max: 5`. With 2-3 Fly.io instances, that is potentially 50-75 connections against a 1 GB instance. PostgreSQL uses ~10MB per connection for `work_mem` and sort buffers, so 75 connections could consume 750MB leaving almost nothing for `shared_buffers` and OS cache.

**Evidence:**
```
Orientation doc: Postgres shared-cpu-2x, 1GB RAM
server/db.ts:29  max: 20 (primary pool)
server/db.ts:50  max: 5  (replica pool, per instance)
Deployment: 2 machines, rolling deploy
```

**Remediation:** Reduce `max` to 10 per instance for the primary pool (total 20 across 2 instances). Use PgBouncer in front of Postgres if more parallelism is needed. Consider upgrading the Postgres instance to at least 4 GB RAM given the schema size.

---

### DB-018: Relations are defined for only 5 of 429 tables

**Severity:** P3

**Description:** Drizzle `relations()` are defined for only `organizations`, `properties`, `notes`, `payments`, and `leads`. The remaining 424 tables have no Drizzle relation definitions, meaning `db.query.tableName.findMany({ with: { ... } })` style queries are unavailable for them. This forces manual JOINs and multiple queries.

**Evidence:**
```
shared/schema.ts:2364-2415 -- only 5 relations() definitions:
  organizationsRelations, propertiesRelations, notesRelations,
  paymentsRelations, leadsRelations
```

**Remediation:** Add `relations()` definitions for key domain tables (deals, campaigns, team_members, agent_tasks, conversations, messages). This is low priority since Drizzle's `select().from().innerJoin()` works without relation definitions.

---

## Embarrassment Test

Three things that would embarrass a database architect:

1. **Payment balance updates are not transactional.** The `createPayment` method reads a note balance, subtracts principal in JavaScript, and writes it back -- three separate statements with no transaction wrapping. This is a textbook lost-update race condition on financial data. Any concurrent payment will corrupt the balance. This is in the "notes receivable" domain -- a regulated financial instrument.

2. **API keys stored in plaintext in the database.** `system_api_keys.api_key` contains raw OpenAI/Twilio keys. `founder_ad_accounts.access_token` and `app_secret` contain raw Meta/Google credentials. `organization_integrations.credentials` JSONB contains both an `encrypted` field (suggesting encryption was intended) and raw `apiKey`/`authToken` fields (suggesting it was never implemented). A single SQL injection or database backup leak exposes all customer API keys.

3. **30+ delete methods accept only `(id: number)` with no tenant filter.** Methods like `deleteNote(id)`, `deleteAiMemory(id)`, `deleteAiConversation(id)`, `deleteVaTemplate(id)`, etc. delete records from any organization. Combined with the lack of ON DELETE CASCADE, this creates a surface where a single misrouted API call can delete another tenant's data or leave orphaned rows across dozens of child tables.

---

## Pride Test

Three things that would make a database architect proud:

1. **Composite index migration discipline.** Migrations `0007_composite_indexes.sql` and `0013_index_audit.sql` demonstrate a methodical approach to indexing -- composite `(organization_id, status)`, `(organization_id, created_at)`, FK indexes, soft-delete indexes, and geographic composite indexes on properties. All use `CREATE INDEX IF NOT EXISTS` for idempotency. The coverage of the core CRM tables (leads, deals, properties, notes, campaigns) is thorough.

2. **Read-replica routing with graceful fallback.** The `dbReadOnly` pool in `db.ts` cleanly routes read-heavy queries to a replica when `DATABASE_REPLICA_URL` is set, falling back to the primary when it's not. This is a mature pattern that shows operational awareness. The replica pool has its own connection limit (`max: 5`), error handler, and configurable pool size via environment variable.

3. **Optimistic concurrency control on deals.** The `updateDeal` method accepts an optional `expectedUpdatedAt` parameter and uses it as a WHERE condition, throwing a clear error message when a concurrent modification is detected. This is the correct pattern for preventing lost updates in a multi-user CRM without pessimistic locking. It demonstrates that the team understands concurrency at the data layer, even though the pattern was only applied to deals and not to other critical entities.
