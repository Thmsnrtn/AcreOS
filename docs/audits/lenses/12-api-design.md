# Lens 12 -- API Design Specialist

Auditor: API Design Specialist (Lens 12)
Date: 2026-04-15
Scope: 926 endpoints across 122 route files. Sampled 15 route files in depth, ran pattern-level counts across all route files.

---

## Executive Summary

AcreOS has a well-structured core CRM API (leads, properties, deals) with proper pagination, Zod validation, and a standardized `Errors.*` helper system. However, the error response contract is broken across the majority of route files: only 27 of 122 route files use the `Errors.*` helpers, while the remaining 90+ files emit ad-hoc error shapes that violate the documented `{ error, message, details, statusCode }` contract. List endpoints are inconsistently paginated -- the three core entities paginate correctly, but campaigns, conversations, agent configs, support tickets, and dozens of other collections return raw arrays. The API also has no versioning strategy (the `/api/v1/` passthrough alias just rewrites to `/api/`), two competing pagination paradigms (page/pageSize vs limit/offset), and pervasive response envelope inconsistencies that will make client-side error handling unreliable.

---

## Findings

### F12-01 [P1] Error response shape is inconsistent across 90+ route files

**What:** The codebase defines a canonical error shape in `server/utils/errors.ts`:

```typescript
interface ApiErrorResponse {
  error: string;    // e.g. "NOT_FOUND"
  message: string;  // human-readable
  details?: unknown;
  statusCode: number;
}
```

However, counting across all route files:
- **1,086 `Errors.*` helper calls** across only **27 route files** (the core CRM routes, billing, communications, team-messaging, etc.)
- **562 raw `res.status(400).json({...})` calls** across **79 route files**
- **1,247 raw `res.status(500).json({...})` calls** across **90 route files**
- **215 raw `res.status(404).json({...})` calls** across **47 route files**

The raw responses use at least three different shapes:
1. `{ error: "message" }` -- marketplace, portfolio-sentinel, setup, founder-intelligence, and dozens more
2. `{ message: "message" }` -- support-tickets, analytics, dashboard, admin, misc, va-engine, and dozens more
3. `{ message: "...", errors: [...] }` -- admin routes for validation

**Impact:** Clients cannot reliably parse error responses. A client expecting `response.data.error` will get `undefined` when hitting a route that returns `{ message }`, and vice versa.

**Files (sample):**
- `server/routes-marketplace.ts` -- uses `{ error: error.message }`
- `server/routes-support-tickets.ts` -- uses `{ message: error.message }`
- `server/routes-portfolio-sentinel.ts` -- uses `{ error: err.message }`
- `server/routes-analytics.ts` -- uses `{ message: error.message }`
- `server/routes-admin.ts` -- mixes `{ error }`, `{ message }`, and `{ message, errors }`

### F12-02 [P1] Most list endpoints return raw arrays without pagination

**What:** Only 3 route files define a `paginationQuerySchema` (leads, properties, deals). The vast majority of list endpoints return bare arrays:

- `GET /api/campaigns` -- `res.json(campaigns)` (raw array)
- `GET /api/agents/configs` -- `res.json(configs)` (raw array)
- `GET /api/agents/tasks` -- `res.json(tasks)` (raw array)
- `GET /api/conversations` -- `res.json(conversations)` (raw array)
- `GET /api/ai/conversations` -- `res.json(conversations)` (raw array, limited to 30 with hardcoded `.limit(30)`)
- `GET /api/support/tickets` -- `res.json(tickets)` (raw array)
- `GET /api/support/cases` -- `res.json(casesWithSla)` (raw array)
- `GET /api/sequences` -- `res.json(sequences)` (raw array)
- `GET /api/target-counties` -- `res.json(counties)` (raw array)
- `GET /api/credits/transactions` -- `res.json(transactions)` (raw array, manual `limit` param only)
- `GET /api/usage/records` -- `res.json(records)` (raw array, manual `limit` param only)

**Impact:** As data grows, these endpoints will return unbounded result sets. Clients have no way to know total count or request subsequent pages. Some endpoints apply a hardcoded `.limit()` without telling the client there are more results.

### F12-03 [P1] Two competing pagination paradigms with no standard

**What:** The codebase uses two different pagination approaches with no shared implementation:

1. **Page-based** (leads, properties, deals): `{ page, pageSize, sortBy, sortOrder }` returning `{ data, total, page, pageSize, totalPages }`
2. **Offset-based** (marketplace, communications, va-engine, deal-hunter, field-scout, transaction-fees): `{ limit, offset }` with no standard return shape

Additionally, the leads route has a **third** paradigm -- cursor-based pagination at `/api/leads/paginated`: `{ cursor, limit }` returning `{ data, nextCursor, hasMore, total }`.

The pagination schema is copy-pasted into each of the 3 files that use it rather than being shared:

```typescript
// Duplicated in routes-leads.ts, routes-properties.ts, routes-deals.ts
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.string().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
```

**Impact:** Clients must handle three different pagination contracts. The duplicated schema will drift. Offset-based endpoints don't return `total` or `hasMore`, making UI pagination controls impossible.

### F12-04 [P1] 429 rate-limit responses bypass Errors.limitExceeded

**What:** There are 13+ instances of `res.status(429).json({...})` that use ad-hoc response shapes instead of `Errors.limitExceeded()`:

```typescript
// routes-ai.ts:55
return res.status(429).json({
  message: `Daily AI request limit reached (${usageCheck.current}/${usageCheck.limit}).`,
  current: usageCheck.current,
  limit: usageCheck.limit,
  resourceType: usageCheck.resourceType,
  tier: usageCheck.tier,
});

// routes-ai.ts:1484 (different shape in same file!)
return res.status(429).json({ message: "AI request limit reached." });
```

The `Errors.limitExceeded` helper exists but is never used for usage-limit responses. Even within the same file (`routes-ai.ts`), the 429 shape varies.

**Files:** `server/routes-ai.ts`, `server/routes-leads.ts`, `server/routes-properties.ts`, `server/routes-finance.ts`, `server/routes-due-diligence.ts`

### F12-05 [P2] Inconsistent response envelope patterns

**What:** Successful responses use at least 5 different envelope patterns:

1. **Raw entity** -- `res.json(deal)` (single resource, no wrapper)
2. **Paginated envelope** -- `res.json({ data, total, page, pageSize, totalPages })` (core CRM only)
3. **Named-key wrapper** -- `res.json({ listings })`, `res.json({ alerts })`, `res.json({ bids })` (marketplace, portfolio-sentinel)
4. **Success flag** -- `res.json({ success: true, listing, ... })` (217 occurrences across 62 files)
5. **Raw array** -- `res.json(campaigns)` (most list endpoints)

**Impact:** Clients must inspect each endpoint individually to know where the data lives -- is it in `response.data.data`, `response.data.listings`, `response.data`, or the array itself? The `{ success: true }` wrapper is redundant (HTTP 2xx already signals success) and not used consistently.

### F12-06 [P2] HTTP verb misuse for state-change actions

**What:** State-change actions (accept, reject, close, resolve, pause, resume, dismiss, approve) uniformly use `POST` instead of `PATCH`:

- `POST /api/support/tickets/:id/close` -- should be `PATCH /api/support/tickets/:id` with `{ status: "closed" }`
- `POST /api/support/tickets/:id/resolve-human`
- `POST /api/enrollments/:id/pause`
- `POST /api/enrollments/:id/resume`
- `POST /api/enrollments/:id/cancel`
- `POST /api/bids/:id/accept`
- `POST /api/bids/:id/reject`
- `POST /api/founder/v6/initiatives/:id/approve`
- `POST /api/founder/v6/absence-mode/activate`
- `POST /api/founder/v6/absence-mode/deactivate`
- 40+ more similar patterns

While `POST` is technically acceptable for RPC-style actions, the inconsistency with the portfolio-sentinel routes (which correctly use `PATCH /api/portfolio-sentinel/alerts/:id/ack`) means the codebase has two competing conventions.

Additionally, `POST /api/founder/setup/delete` and `POST /api/bulk/leads/delete` use POST for deletion instead of DELETE.

**Files:** `server/routes-campaigns.ts`, `server/routes-support-tickets.ts`, `server/routes-marketplace.ts`, `server/routes-founder-v6.ts`, `server/routes-founder-intelligence.ts`, `server/routes-setup.ts`, `server/routes-bulk.ts`

### F12-07 [P2] PUT used for partial updates instead of PATCH

**What:** The codebase uses `PUT` for partial updates across core CRM routes:

- `PUT /api/leads/:id` -- accepts partial body via `updateLeadSchema = insertLeadSchema.partial()`
- `PUT /api/properties/:id` -- accepts partial body via `updatePropertySchema = insertPropertySchema.partial()`
- `PUT /api/deals/:id` -- accepts partial body
- `PUT /api/campaigns/:id` -- accepts partial body
- `PUT /api/sequences/:id` -- accepts partial body

Per HTTP semantics, `PUT` implies a full replacement of the resource, while `PATCH` indicates partial modification. All these endpoints accept `.partial()` schemas, making them PATCH operations wearing PUT clothes. Total: 60 PUT endpoints, 76 PATCH endpoints -- the codebase is split roughly evenly.

### F12-08 [P2] Naming conventions inconsistent across URL paths

**What:** Endpoint naming conventions vary:

- **Plural nouns (correct):** `/api/leads`, `/api/properties`, `/api/deals`, `/api/campaigns`
- **Kebab-case compound names:** `/api/target-counties`, `/api/night-cap`, `/api/deal-rooms`, `/api/field-scout`
- **Verb-first action paths:** `/api/leads/bulk-delete`, `/api/direct-mail/verify-address`, `/api/leads/merge`
- **Noun-first action paths:** `/api/campaigns/:id/send-direct-mail`, `/api/campaigns/:id/estimate-cost`
- **Versioned sub-paths:** `/api/founder/v6/...`, `/api/founder/v7/...`, through `/api/founder/v14/...` (9 version segments for founder routes alone)
- **Mixed nesting depth:** `/api/campaigns/:id/variants/:variantId/declare-winner` (4 levels deep)
- **Singular nouns:** `/api/subscription/cancel` (should be `/api/subscriptions/:id/cancel`)

The founder routes are especially problematic with 9 separate versioned route files (`routes-founder-v6.ts` through `routes-founder-v14.ts`) all mounted simultaneously, suggesting abandoned-but-still-active API surfaces.

### F12-09 [P2] No API versioning strategy

**What:** The only versioning mechanism is a passthrough alias in `routes.ts`:

```typescript
// T7: API Versioning -- /api/v1/ passthrough alias
app.use("/api/v1/{*splat}", (req, res) => {
  const newPath = req.originalUrl.replace("/api/v1/", "/api/");
  res.redirect(307, newPath);
});
```

This is not versioning -- it is an alias. There is no `v2` path, no version header support, no content negotiation. The OpenAPI spec declares version `1.0.0` but the actual endpoints are unversioned at `/api/*`.

Meanwhile, the internal founder API has informal versioning via path segments (`/api/founder/v6/`, `/api/founder/v7/`, etc.) that coexists with the top-level un-versioned API.

### F12-10 [P2] Duplicate and overlapping endpoints

**What:** Several endpoints are defined in multiple places:

1. `GET /api/dashboard/stats` is defined in both `routes.ts` (line 645, with in-memory caching) and `routes-dashboard.ts` (line 27, without caching). Express will hit the first-registered one, making the second dead code.
2. `POST /api/leads/:id/mark-contacted` (routes.ts:689) and `POST /api/leads/:id/record-contact` (routes.ts:759) do essentially the same thing -- update `lastContactedAt`.
3. `GET /api/support/tickets` and `GET /api/support/cases` are separate systems (support-tickets.ts vs admin.ts) with different response shapes for what appears to be the same concept.

### F12-11 [P2] 139 uses of `req.user as any` bypasses type safety

**What:** Across 21 route files, user identity is extracted via unsafe casts:

```typescript
const user = req.user as any;
const userId = user?.claims?.sub || user?.id;
```

This pattern appears 139 times. The codebase provides `getUserId(req)` from `server/types/request.ts` specifically to avoid this, but most route files don't use it. This is both a type-safety issue (documented in CLAUDE.md) and an API design issue -- if the auth middleware fails silently, these routes will proceed with `undefined` user IDs.

### F12-12 [P2] 402 Payment Required responses use non-standard shape

**What:** Document generation endpoints return `402` errors with a custom shape:

```typescript
return res.status(402).json({
  error: "Insufficient credits",
  required: pdfCost / 100,
  balance: balance / 100,
});
```

This doesn't match the `ApiErrorResponse` contract (missing `message`, `statusCode` fields) and uses numeric values in cents/dollars inconsistently (sometimes cents, sometimes dollars).

**File:** `server/routes-documents.ts`

### F12-13 [P3] No consistent query parameter validation on filter endpoints

**What:** Core list endpoints validate pagination with Zod, but filter parameters are extracted with unsafe casts:

```typescript
const stage = req.query.stage as string | undefined;
const assignedToFilter = req.query.assignedTo as string | undefined;
```

This pattern appears throughout the codebase. Unexpected query values (arrays from `?stage=a&stage=b`, objects, numbers) are silently coerced to strings and may produce incorrect query results without errors.

### F12-14 [P3] Inconsistent 201 vs 200 for resource creation

**What:** Resource creation endpoints inconsistently return `201 Created` vs `200 OK`:

- `POST /api/deals` -- returns `201` (correct)
- `POST /api/properties` -- returns `201` (correct)
- `POST /api/campaigns` -- returns `201` (correct)
- `POST /api/marketplace/listings` -- returns `200` (should be `201`)
- `POST /api/support/cases` -- returns `201` (correct)
- `POST /api/marketplace/listings/:id/bids` -- returns `200` (should be `201`)

Total: 109 endpoints return `201`, but many POST-creation endpoints return `200`. Only 22 endpoints use `204 No Content` for deletions (found in 7 route files), while most deletions return `200` with a body.

### F12-15 [P3] OpenAPI spec is incomplete and stale

**What:** The `server/openapi-spec.ts` defines a skeleton OpenAPI 3.0 spec with only Lead and Property schemas, covering a tiny fraction of the 926 endpoints. The spec references `sessionCookie` auth but the app primarily uses Clerk JWT tokens. The spec has not been updated to reflect the actual API surface.

**File:** `server/openapi-spec.ts`

---

## Summary Table

| ID | Sev | Finding | Scope |
|----|-----|---------|-------|
| F12-01 | P1 | Error response shape inconsistent: 1,800+ raw calls vs 1,086 Errors.* calls | 90+ route files |
| F12-02 | P1 | Most list endpoints return raw arrays without pagination | ~100 list endpoints |
| F12-03 | P1 | Three competing pagination paradigms, schema duplicated | 3 files + 15 offset-based |
| F12-04 | P1 | 429 responses bypass Errors.limitExceeded with inconsistent shapes | 5 route files, 13+ instances |
| F12-05 | P2 | Five different success response envelope patterns | 62+ route files |
| F12-06 | P2 | POST used for state-change actions; POST used for deletions | 40+ endpoints |
| F12-07 | P2 | PUT used for partial updates (should be PATCH) | 60 PUT endpoints |
| F12-08 | P2 | URL naming conventions inconsistent; 9 founder version segments | All route files |
| F12-09 | P2 | No real API versioning (v1 is a passthrough alias) | routes.ts |
| F12-10 | P2 | Duplicate/overlapping endpoints | routes.ts, routes-dashboard.ts |
| F12-11 | P2 | 139 `req.user as any` casts bypass type safety | 21 route files |
| F12-12 | P2 | 402 responses use non-standard shape | routes-documents.ts |
| F12-13 | P3 | Filter query parameters not validated with Zod | Most route files |
| F12-14 | P3 | Inconsistent 201 vs 200 for creation, 204 vs 200 for deletion | ~40 creation endpoints |
| F12-15 | P3 | OpenAPI spec covers <5% of endpoints, stale auth scheme | openapi-spec.ts |

---

## Recommended Remediation Priority

1. **Standardize error responses** (F12-01, F12-04, F12-12): Create an ESLint rule or middleware that intercepts non-Errors.* responses. Migrate all `res.status(4xx/5xx).json()` calls to use `Errors.*` helpers. This is the single highest-impact fix.

2. **Extract shared pagination** (F12-03): Move `paginationQuerySchema` to `server/utils/pagination.ts` with both page-based and cursor-based variants. Standardize on one approach for new endpoints.

3. **Add pagination to list endpoints** (F12-02): Audit all `GET` endpoints returning arrays. Add pagination to any endpoint whose backing table can grow beyond ~100 rows.

4. **Standardize response envelopes** (F12-05): Adopt a convention -- all list endpoints return `{ data: T[], meta: { total, page, ... } }`, all single-resource endpoints return the entity directly, all mutations return the entity with `201`/`200`/`204` as appropriate.

5. **Consolidate founder routes** (F12-08): The 9 versioned founder route files should be collapsed into a single `routes-founder.ts` with the latest implementations.
