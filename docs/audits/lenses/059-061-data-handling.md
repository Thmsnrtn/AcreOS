# Lenses 059-061 -- Data Handling Audit

Auditor: Claude Opus 4.6 (1M context)
Date: 2026-04-18
Tier: 2
Lenses: 059 (Pagination/Cursor Correctness), 060 (Search/Filter Correctness), 061 (File Upload/Blob Storage)

---

## Lens 059 -- Pagination/Cursor Correctness

**Distinct-value declaration:** I independently verified every finding below by reading source code line-by-line across `server/middleware/pagination.ts`, `server/storage.ts`, `server/routes-leads.ts`, `server/routes-properties.ts`, `server/routes-deals.ts`, `client/src/components/list-pagination.tsx`, and `client/src/hooks/use-infinite-scroll.tsx`. No prior audit has covered this combination of issues.

### Architecture

The codebase contains **three distinct pagination systems**:

1. **Page/offset pagination** (`server/storage.ts` PaginationOptions) -- Used by `/api/leads`, `/api/properties`, `/api/deals`. Each route defines its own Zod `paginationQuerySchema`, then delegates to `storage.getLeadsPaginated()` / `getPropertiesPaginated()` / `getDealsPaginated()`.

2. **Cursor pagination** (`server/middleware/pagination.ts` `parseCursorPagination`) -- Defined in middleware but **never imported by any route file**. The `/api/leads/paginated` endpoint implements its own cursor logic inline instead.

3. **Shared pagination middleware** (`parsePagination` / `paginatedResponse` in `server/middleware/pagination.ts`) -- A well-designed utility that is **completely unused**. No route file imports it. Each route duplicates its own pagination Zod schema with slightly different field names (`pageSize` vs `limit`).

### Findings

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 059-1 | **P1** | **`/api/leads/paginated` loads ALL leads into memory** then applies cursor pagination client-side. Line 166: `storage.getLeads(org.id, ...)` fetches every lead for the org, scores them all, then slices. This defeats the purpose of pagination entirely and will OOM on large datasets. | `server/routes-leads.ts:166` |
| 059-2 | **P1** | **Stage filter on `/api/leads` also loads all leads.** When `stage` query param is provided, line 112 calls `storage.getLeads()` (unbounded), scores every lead in JS, filters, then slices for the requested page. Count is correct but performance degrades linearly with dataset size. | `server/routes-leads.ts:111-123` |
| 059-3 | **P2** | **`sortBy` field is unsanitized -- arbitrary column access.** The sort column is resolved via `(leads as any)[options.sortBy]` (storage.ts:1287). While it falls back to `createdAt` if the column doesn't exist, the `sortBy` string from the request is used as a property lookup on the Drizzle table object. An attacker could pass internal Drizzle properties. The pagination middleware's `parseSortParams` has an allow-list, but the routes don't use it. | `server/storage.ts:1287,1588,1683` |
| 059-4 | **P2** | **Pagination middleware is dead code.** `parsePagination`, `paginatedResponse`, `parseSortParams`, and `parseCursorPagination` are defined in `server/middleware/pagination.ts` but imported by zero route files. Each CRM route duplicates its own pagination logic. | `server/middleware/pagination.ts` |
| 059-5 | **P2** | **Client-side search filter applied after server pagination creates inaccurate counts.** The leads page receives one page of data from the server, then applies search/GIS filters client-side (leads.tsx:908-957). The `totalLeadItems` shown comes from the server's unfiltered count, so the displayed "Showing X-Y of Z" is wrong when search is active. | `client/src/pages/leads.tsx:960-962` |
| 059-6 | **P3** | **Inconsistent response shape.** The pagination middleware produces `{ data, pagination: { page, limit, total, ... } }`, but the routes produce `{ data, total, page, pageSize, totalPages }`. The infinite-scroll hook expects `{ data, nextCursor, hasMore, total }`. Three different response shapes exist. | Multiple |
| 059-7 | **P3** | **Empty-set edge case in pagination middleware.** `paginatedResponse` with `total=0` computes `totalPages = Math.ceil(0/limit) = 0`, but the route implementations use `Math.max(1, ...)` producing `totalPages=1`. Tests at line 164 confirm the middleware returns 0 for empty sets while routes return 1. | `server/middleware/pagination.ts:65` vs `server/storage.ts:1284` |
| 059-8 | **P3** | **Hard-coded `.limit(5000)` in non-paginated getLeads/getDeals/getProperties.** These are still called by several routes (focus list, export, stage filter) and silently truncate at 5000 records. | `server/storage.ts:1271,1578,1673` |

### Positive Observations

- Zod validation of page/pageSize with min/max clamping is solid.
- Server-side paginated queries for leads/properties/deals use correct `LIMIT/OFFSET` SQL.
- Client-side `ListPagination` component correctly handles edge cases (zero items, boundary pages).
- The infinite-scroll hook uses IntersectionObserver properly.

---

## Lens 060 -- Search/Filter Correctness

**Distinct-value declaration:** I traced every search and filter pathway from UI to database query. I independently discovered the SQL injection risks in `supportAgent.ts` and `routes-leases.ts`, the duplicate `/api/search` route registration, and the client/server filter split that corrupts pagination counts. These findings are unique to this audit.

### Architecture

Search is implemented at three levels:

1. **Full-text search** (`server/services/fullTextSearch.ts`) -- PostgreSQL `to_tsvector`/`to_tsquery` with GIN indexes. Proper parameterized queries. Falls back to ILIKE on error.
2. **Entity search** (`storage.searchPaxEntities`) -- Uses Drizzle `ilike()` with `%query%` patterns. Parameterized.
3. **Client-side filtering** -- Leads, properties, and deals pages filter the current page of data in the browser using `.filter()` on the array.

### Findings

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 060-1 | **P0** | **SQL injection via `sql.raw()` in support agent.** `paxMemory.memoryType` query builds `ARRAY['type1','type2']` by interpolating unsanitized strings into `sql.raw()`: `types.map((t: string) => \`'${t}'\`).join(',')`. A type value containing `'` breaks out of the string literal. | `server/ai/supportAgent.ts:4507` |
| 060-2 | **P1** | **`sql.raw()` with field names from whitelist in support agent is safe but fragile.** The `searchableFields` object acts as an allow-list, so `sql.raw(f)` on line 3940 is safe *today*, but any future addition of user-controlled field names would introduce injection. The pattern should use Drizzle column references instead. | `server/ai/supportAgent.ts:3940` |
| 060-3 | **P1** | **Duplicate `/api/search` route registration.** Both `routes.ts:587` and `routes-micro-features.ts:213` register `GET /api/search`. Express will match the first-registered handler; the second is dead code with a different response shape (grouped vs flat). This creates confusion about which is active. | `server/routes.ts:587`, `server/routes-micro-features.ts:213` |
| 060-4 | **P1** | **Client-side search on server-paginated data produces wrong results.** The leads page fetches page N from the server, then applies a text search filter client-side (leads.tsx:914-920). This only searches within the current page, not across all leads. A lead matching the search on page 3 won't appear if the user is on page 1. | `client/src/pages/leads.tsx:908-957` |
| 060-5 | **P2** | **Fallback search in fullTextSearch swallows all errors silently.** The ILIKE fallback catches all exceptions with an empty `catch {}` block, meaning database connection failures during search return empty results with no error indication. | `server/services/fullTextSearch.ts:247` |
| 060-6 | **P2** | **No search capability on properties or deals list pages.** While leads has a search input (client-side only), the properties page has only status/GIS filters and deals has only type/status filters. There is no text search on these list views. | `client/src/pages/properties.tsx`, `client/src/pages/deals.tsx` |
| 060-7 | **P2** | **Full-text search does not filter out soft-deleted records.** The `fullTextSearch.search()` queries against `leads`, `properties`, and `deals` tables without checking `deletedAt IS NULL` or `status != 'deleted'`. Deleted records appear in search results. | `server/services/fullTextSearch.ts:64-93` |
| 060-8 | **P3** | **tsquery construction strips all non-alphanumeric chars.** The query builder at line 51 uses `.replace(/[^a-zA-Z0-9]/g, "")`, which means searching for an APN like "1234-5678-001" becomes `123456780011:*`. Hyphenated identifiers, email addresses, and phone numbers won't match via full-text search (they work via ILIKE fallback only if the tsvector query throws). | `server/services/fullTextSearch.ts:51-52` |

### Positive Observations

- Full-text search uses parameterized `to_tsquery()` -- the tsQuery value is passed as a parameter, not interpolated.
- Drizzle ORM's `ilike()` function parameterizes values correctly.
- The `findDuplicateLeads` function properly normalizes phone numbers before searching.
- Search input has a minimum length check (2 chars) to prevent expensive wildcard-only queries.
- LIKE queries in storage use Drizzle's parameterized sql template literal, which prevents injection.

---

## Lens 061 -- File Upload/Blob Storage

**Distinct-value declaration:** I independently discovered that the file upload security middleware (`createUploadMiddleware`, `validateFileMiddleware`) is defined but never used by any route, that photo uploads discard file data, and that the deal-rooms SSRF check is broken by a missing `await` and wrong return type check.

### Architecture

File uploads use **multer** with `memoryStorage()` everywhere. There are five distinct upload configurations:

| Route File | Max Size | Type Filter | File Count |
|-----------|----------|-------------|------------|
| `routes-leads.ts` | 5 MB | CSV only | 1 |
| `routes-properties.ts` | 5 MB | CSV only | 1 |
| `routes-import-export.ts` | 5 MB | CSV only | 1 |
| `routes-field-scout.ts` (voice) | 25 MB | None | 1 |
| `routes-field-scout.ts` (photo) | 10 MB | None | 10 |
| `routes-ai.ts` (voice) | 25 MB | None | 1 |

### Findings

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 061-1 | **P0** | **SSRF check in deal-rooms is broken.** `validateUrl()` is `async` (returns `Promise<URL>`) but is called without `await`. The result is then checked for `.safe` property, which doesn't exist on a Promise or URL object. The truthiness check on a Promise always passes, so SSRF protection is entirely bypassed. | `server/routes-deal-rooms.ts:182-185` |
| 061-2 | **P1** | **File upload security middleware is dead code.** `createUploadMiddleware` and `validateFileMiddleware` from `server/middleware/fileUploadSecurity.ts` (which does magic-byte validation, EXIF stripping, dangerous extension blocking) are never imported or used by any route. Every route creates its own ad-hoc multer instance without content validation. | `server/middleware/fileUploadSecurity.ts` |
| 061-3 | **P1** | **Photo uploads discard file data entirely.** The field-scout photo upload route (line 191) saves metadata (filename, mimeType, sizeBytes) to the DB but never stores the actual `file.buffer`. The photo data is lost after the request completes. The schema expects a `url` field but the route passes `filename` instead. | `server/routes-field-scout.ts:191-200` |
| 061-4 | **P1** | **No file storage backend exists.** All uploads use `multer.memoryStorage()`. There is no S3, GCS, local disk, or any persistent storage integration. CSV imports are processed in-memory (which is fine), but photo and voice uploads are accepted and then discarded. The deal-rooms document upload expects a pre-existing `fileUrl` but has no actual upload mechanism. | Multiple |
| 061-5 | **P2** | **Voice upload routes have no MIME type validation.** Both `routes-field-scout.ts:20-23` and `routes-ai.ts:1638` accept any file type up to 25 MB with no filtering. A user could upload any file as the "audio" field. | `server/routes-field-scout.ts:20-23`, `server/routes-ai.ts:1638` |
| 061-6 | **P2** | **Photo upload has no image type validation.** `routes-field-scout.ts:26-29` uses `photoUpload = multer({ ... })` with no `fileFilter`, accepting any file type (executables, scripts, etc.) up to 10 MB x 10 files. | `server/routes-field-scout.ts:26-29` |
| 061-7 | **P2** | **CSV upload type check is bypassable.** The CSV multer config checks `file.mimetype === "text/csv" || file.originalname.endsWith(".csv")`. The MIME type is client-reported and the extension check accepts files like `malware.exe.csv`. Without magic-byte validation (which exists in the unused middleware), a non-CSV file can be processed. However, since the content is parsed as CSV text, the blast radius is limited. | `server/routes-leads.ts:59-65` |
| 061-8 | **P2** | **Document signing uses a hardcoded fallback secret.** Deal room document download URLs are signed with `process.env.DOCUMENT_SIGNING_SECRET ?? 'dev-secret'`. If the env var is not set, all download URLs use a predictable secret. | `server/routes-deal-rooms.ts:266` |
| 061-9 | **P3** | **Three duplicate multer configs for CSV.** `routes-leads.ts`, `routes-properties.ts`, and `routes-import-export.ts` each define identical multer configurations for CSV upload. These should use the shared `createUploadMiddleware`. | Multiple |

### Positive Observations

- The file upload security middleware itself is well-implemented: magic-byte detection, EXIF stripping for JPEG, SSRF protection for URLs, dangerous extension blocking.
- CSV imports enforce a 500-row limit to prevent memory exhaustion.
- Memory storage is appropriate for CSV processing (parse-and-discard).
- File size limits are present on all upload endpoints.

---

## Summary of Critical Issues

| Priority | Count | Key Items |
|----------|-------|-----------|
| P0 | 2 | SQL injection via `sql.raw()` (060-1); SSRF bypass in deal-rooms (061-1) |
| P1 | 7 | Full-table loads defeating pagination (059-1, 059-2); client-side search on paginated data (060-4); dead upload security middleware (061-2); photo data discarded (061-3); no storage backend (061-4); duplicate search route (060-3) |
| P2 | 9 | Unsanitized sortBy (059-3); silent error swallowing (060-5); missing search on pages (060-6); deleted records in search (060-7); no MIME validation on uploads (061-5, 061-6); bypassable CSV check (061-7); hardcoded signing secret (061-8) |
| P3 | 5 | Inconsistent response shapes; empty-set edge case; tsquery stripping; hard-coded limits; duplicate multer configs |

## Recommended Fix Priority

1. **Fix the `sql.raw()` injection** in supportAgent.ts (060-1) -- use parameterized `= ANY($1::text[])`.
2. **Fix the SSRF bypass** in deal-rooms (061-1) -- add `await` and handle thrown errors.
3. **Wire up the file upload security middleware** to all upload routes (061-2).
4. **Move search to server-side** or debounce a search API call when text input changes (060-4, 059-5).
5. **Add a proper file storage backend** (S3/GCS) before shipping photo/document features (061-4).
6. **Use the pagination middleware** or consolidate into one shared implementation (059-4, 059-6).
