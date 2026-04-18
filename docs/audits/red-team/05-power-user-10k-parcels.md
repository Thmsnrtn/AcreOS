# Red Team Review #05: Power User with 10,000 Parcels

**Persona**: High-volume land acquisition company managing 10,000+ parcels across multiple states.
**Reviewer**: Scalability Red Team
**Date**: 2026-04-18
**Scope**: Can AcreOS handle a single org with 10K leads, 10K properties, and proportional deals without degradation?

---

## Summary

| # | Area                    | Verdict     |
|---|-------------------------|-------------|
| 1 | List/table rendering    | CONCERN     |
| 2 | Database queries        | CONCERN     |
| 3 | Pagination              | PASS        |
| 4 | Filter performance      | CONCERN     |
| 5 | Export handling          | FAIL        |
| 6 | Map performance         | CONCERN     |
| 7 | Search                  | PASS        |
| 8 | Bulk operations         | PASS        |
| 9 | Dashboard aggregation   | FAIL        |
| 10| Background job scaling  | FAIL        |

**Overall**: 3 PASS, 4 CONCERN, 3 FAIL

---

## 1. List/Table Rendering

**Verdict: CONCERN**

Virtualization components exist but are NOT used by the primary list pages.

**Evidence**:
- `client/src/components/VirtualTable.tsx` wraps `@tanstack/react-virtual` with `useVirtualizer` (overscan=10, estimateSize=56). Well-built.
- `client/src/components/virtual-list.tsx` is a zero-dependency windowed list renderer. Also well-built.
- **Neither component is imported by `client/src/pages/leads.tsx` or `client/src/pages/properties.tsx`**. Confirmed by grep: zero matches for `VirtualList` or `VirtualTable` in `client/src/pages/`.
- Both pages render a standard `<Table>` from shadcn/ui with direct `.map()` over the current page of results.

**Mitigating factor**: Server-side pagination caps pages at 100 rows (MAX_LIMIT in `server/middleware/pagination.ts` line 39), so the DOM never exceeds ~100 rows per page. This is acceptable for typical use.

**Risk**: If a user selects pageSize=100 with complex row components (score badges, consent toggles, action menus), the initial render could be sluggish on low-end hardware. Not a blocker, but the virtualization components exist specifically for this case and remain unused.

**Recommendation**: Wire up `VirtualTable` for pages with more than 50 rows, or accept the current 100-row cap as sufficient.

---

## 2. Database Queries

**Verdict: CONCERN**

DEFECT-0016 (unbounded SELECTs) was partially fixed: the primary list endpoints now use `getLeadsPaginated`/`getPropertiesPaginated` with SQL LIMIT/OFFSET. However, several hot paths still call the unbounded `getLeads()`, `getProperties()`, and `getDeals()` which load up to 5,000 rows into memory.

**Unbounded query definitions** (`server/storage.ts`):
```
// Line 1263
async getLeads(orgId, filters?) {
  ...
  .limit(5000);   // Hard cap, but still loads 5K rows into Node memory
}

// Line 1581
async getProperties(orgId) {
  ...
  .limit(5000);
}

// Line 1682
async getDeals(orgId) {
  ...
  .limit(5000);
}
```

**Callers of these unbounded methods** (grep of `server/*.ts`):
- `server/routes-leads.ts:103` -- stage filter fallback loads ALL leads
- `server/routes-leads.ts:157` -- `/api/leads/paginated` loads ALL leads, then paginates client-side
- `server/routes-leads.ts:202` -- `/api/leads/focus` loads ALL leads
- `server/routes-leads.ts:616` -- `GET /api/leads/:id/properties` loads ALL properties to find seller match
- `server/routes-dashboard.ts:37-39` -- dashboard intelligence loads ALL leads + ALL deals + ALL properties
- `server/services/importExport.ts:543` -- export loads ALL leads
- `server/services/importExport.ts:613` -- export loads ALL properties
- `server/ai/tools.ts` -- 8+ calls to getLeads/getProperties/getDeals for AI tool execution
- `server/mcp-server.ts:92,101,110,138-140` -- MCP server loads all entities
- `server/routes-team-messaging.ts:552,560` -- messaging loads all leads + properties

At 10K records, loading 5,000 leads with all columns is ~2-5 MB of JSON in memory per request. Multiple concurrent requests from the same org could cause significant memory pressure.

**Index coverage is solid**: migrations `0007_composite_indexes.sql`, `0010_fts_gin_indexes.sql`, and `0013_index_audit.sql` add composite indexes on `(organization_id, status)`, `(organization_id, created_at)`, `(organization_id, assigned_to)`, `(organization_id, deleted_at)`, plus GIN indexes for full-text search. This is thorough.

**N+1 pattern found** in `server/jobs/landCreditScoreRecalculation.ts` (lines 43-63):
```typescript
const allActiveProperties = await db.select().from(properties)
  .where(eq(properties.status, "active"));  // No org filter, no limit

for (const property of allActiveProperties) {
  const [latestScore] = await db.select().from(landCreditScores)
    .where(eq(landCreditScores.propertyId, property.id))  // N+1!
    .orderBy(desc(landCreditScores.createdAt))
    .limit(1);
}
```
This is a classic N+1: for 10K active properties it executes 10,001 queries.

---

## 3. Pagination

**Verdict: PASS**

Server-side pagination is implemented correctly on the primary list endpoints.

**Evidence**:
- `server/middleware/pagination.ts` provides `parsePagination()` with `MAX_LIMIT = 100`, `DEFAULT_LIMIT = 20`.
- `server/routes-leads.ts:80-84` validates pagination with Zod: `page >= 1`, `pageSize 1-100`, default 25.
- `server/routes-properties.ts:73-78` same pattern.
- `server/storage.ts:1276-1299` (`getLeadsPaginated`) does SQL `LIMIT` + `OFFSET` with a separate `COUNT(*)` query.
- `server/storage.ts:1589-1606` (`getPropertiesPaginated`) same pattern.
- Both also have `getDealsPaginated` (line 1690).
- Client hooks (`client/src/hooks/use-leads.ts`, `use-properties.ts`) pass pagination params to the server and use `keepPreviousData` for smooth transitions.
- Client pages wire `currentPage` and `pageSize` state to `useLeadsPaginated` / `usePropertiesPaginated`.
- Cursor-based pagination also available via `parseCursorPagination()` in the middleware.

**One gap**: `OFFSET`-based pagination degrades at very high page numbers (e.g., page 400 of 10K records). The cursor-based endpoint exists for leads (`/api/leads/paginated`) but it still loads all leads into memory first (line 157), defeating the purpose. Only the offset-based `/api/leads` endpoint is truly server-side paginated.

---

## 4. Filter Performance

**Verdict: CONCERN**

Filtering is split across server and client in a way that creates a scalability trap.

**Server-side filters** (working well):
- `assignedTo` filter is pushed to SQL WHERE clause (`routes-leads.ts:88-97`).
- Sort field and order are pushed to SQL ORDER BY.

**Client-side filters** (problematic at 10K):
- **Search**: `leads.tsx:914-921` does `String.includes()` on `firstName`, `lastName`, `email` against the current page only. This is fine for per-page filtering but means search only works within the current page, not across all 10K leads. The user cannot do a global text search from the leads list.
- **Stage filter**: When `?stage=hot|warm|cold|dead` is set, the server falls back to loading ALL leads via `storage.getLeads()` (line 103), computing scores in-memory for every lead, then slicing. At 10K leads, this is an O(10K) computation on every page load.
- **GIS filters**: Applied client-side on the current page only (line 937-945). Cannot filter globally.
- **Properties page**: `statusFilter` and `distressFilter` are applied client-side on the current page (lines 192-206). Filtering only works within the page, not across the full dataset.

**Impact**: A power user filtering by "hot" leads across 10K records forces a full table scan + in-memory scoring on every request. Sorting by score also requires loading all leads since scores are computed, not stored.

---

## 5. Export Handling

**Verdict: FAIL**

Exports load all records into memory with no streaming, no pagination, and no background processing.

**Evidence** (`server/services/importExport.ts`):
```typescript
// Line 539-543
export async function exportLeadsToCSV(organizationId: number, filters?: ExportFilters): Promise<string> {
  let leads = await storage.getLeads(organizationId);  // loads up to 5,000 into memory
  // ... filters applied in-memory ...
  // Returns a single string built by concatenating all rows
}

// Line 609-613
export async function exportPropertiesToCSV(organizationId: number, filters?: ExportFilters): Promise<string> {
  let properties = await storage.getProperties(organizationId);  // same pattern
}
```

The full-data export (`/api/leads/export`, line 851-857) builds the entire CSV as a single in-memory string and sends it via `res.send(csv)`. No streaming.

**Import limit**: 500 rows max (`MAX_CSV_IMPORT_ROWS = 500`, line 54 in routes-leads.ts). A power user with 10K records cannot bulk-import without splitting into 20 files.

**Risks at 10K**:
1. The 5,000-row hard cap in `getLeads()` means an org with >5K leads can only export 5,000. The remaining leads are silently dropped.
2. Memory spike: 5K lead objects serialized to CSV could be 5-10MB. With multiple concurrent exports, this compounds.
3. No timeout protection on the export endpoint.
4. The full org backup endpoint (`exportOrganizationData`) calls `exportLeadsToCSV`, `exportPropertiesToCSV`, `exportDealsToCSV`, and `exportNotesToCSV` in parallel (line 940-944), quadrupling memory usage.

---

## 6. Map Performance

**Verdict: CONCERN**

The property map uses GeoJSON layers (good for boundaries) but individual markers are created as DOM elements without clustering.

**Evidence** (`client/src/components/property-map.tsx`):
- Property boundaries are rendered via a Mapbox GeoJSON source with fill/line layers (lines 1470-1517). This is GPU-accelerated and scales well even with thousands of polygons.
- However, comp markers are created as individual `mapboxgl.Marker` DOM elements (line 1343): each creates an HTML `<div>` with inline styles, a tooltip popup, and event listeners. This does not scale past ~500 markers.
- No evidence of Mapbox's built-in clustering (`cluster: true` on GeoJSON source) or `supercluster` library usage. Grep for `supercluster` returns zero matches in component code.

**Mitigating factors**:
- Comps are typically limited in number (nearby comparable sales).
- Property labels use a Mapbox symbol layer (line 1539), which is GPU-accelerated.
- The main property boundary rendering is efficient.

**Risk**: If a user views all 10K properties on the map at once, the polygon rendering should handle it (GeoJSON layers are performant), but any marker-based overlays will choke the browser.

---

## 7. Search

**Verdict: PASS**

Full-text search uses PostgreSQL `tsvector` with GIN indexes.

**Evidence** (`server/services/fullTextSearch.ts`):
- Constructs `to_tsquery('english', ...)` with prefix matching (line 46-56).
- Queries use `ts_rank()` for relevance scoring (lines 72-81).
- Results are `LIMIT`ed per entity type (line 92: `Math.ceil(limit / 2)`).
- GIN indexes are created in `migrations/0010_fts_gin_indexes.sql` on leads, properties, deals, and support tickets.
- Fallback to ILIKE matching if GIN indexes are unavailable (line 183-193).

**Performance at 10K**: GIN indexes make `tsvector` queries O(log N) even at millions of rows. This is solid.

**Minor gap**: The search only covers the global command palette / search bar. The per-page search on `leads.tsx` (line 914) uses client-side `String.includes()` on the current page, so searching across 10K leads requires using the global search rather than the inline filter.

---

## 8. Bulk Operations

**Verdict: PASS**

Bulk delete and update use single SQL statements with `IN (...)` clauses.

**Evidence** (`server/storage.ts`):
```typescript
// Line 1363
async bulkDeleteLeads(orgId, ids) {
  await db.update(leads)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(leads.organizationId, orgId), inArray(leads.id, ids)));
}

// Line 1372
async bulkUpdateLeads(orgId, ids, updates) {
  await db.update(leads)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(leads.organizationId, orgId), inArray(leads.id, ids),
      sql`${leads.deletedAt} IS NULL`));
}
```

Both use a single UPDATE with `inArray` -- no loops, no N+1.

- Validation uses Zod schemas (`bulkLeadIdsSchema`, `bulkUpdateSchema`) requiring `ids` to be a non-empty array of positive integers.
- Batch insert also uses a single multi-row INSERT (`createLeadsBatch`, line 1319).
- Activity logging for batch operations is also batched (line 1326-1332).

**Minor concern**: There is no upper bound on the `ids` array size in the Zod schema. A client could send 10K IDs in a single request, generating a very large `IN (...)` clause. PostgreSQL handles this reasonably well, but it could be problematic at extreme sizes (50K+). Adding `.max(1000)` to the array schema would be a simple safeguard.

---

## 9. Dashboard Aggregation

**Verdict: FAIL**

The dashboard intelligence endpoint loads entire tables into memory for analysis.

**Evidence** (`server/routes-dashboard.ts:37-39`):
```typescript
// /api/dashboard/intelligence
const allLeads = await storage.getLeads(org.id);        // up to 5,000 rows
const allDeals = await storage.getDeals(org.id);         // up to 5,000 rows
const allProperties = await storage.getProperties(org.id); // up to 5,000 rows
```

Then performs multiple `.filter()` passes in JavaScript (lines 53-121): filtering by date ranges, nurturing stage, status, closing dates, etc. This is O(N * filters) per request.

**The basic stats endpoint is better**: `getDashboardStats()` (`server/storage.ts:2074-2099`) uses SQL `COUNT(*)` aggregations for totals. However, monthly revenue calculation still loads all active notes into memory (line 2082-2084):
```typescript
const activeNotes = await db.select().from(notes)
  .where(and(eq(notes.organizationId, orgId), eq(notes.status, "active")));
const monthlyRevenue = activeNotes.reduce((sum, note) => sum + Number(note.monthlyPayment || 0), 0);
```
This should be `SUM(monthly_payment)` in SQL.

**30-second cache helps** (`server/routes.ts:692-706`): The basic stats endpoint has a 30-second in-memory cache per org. The intelligence endpoint does NOT have a cache.

**Impact at 10K**: Loading 15,000 rows (5K each of leads, deals, properties) into Node memory on every dashboard visit. With the dashboard auto-refreshing or multiple team members hitting it simultaneously, this is a significant memory and CPU concern.

---

## 10. Background Job Scaling

**Verdict: FAIL**

Background jobs have N+1 query patterns and no org-scoping, making them global-scale problems.

**Evidence**:

**landCreditScoreRecalculation.ts** (lines 39-63):
```typescript
async function findStaleProperties(): Promise<any[]> {
  const allActiveProperties = await db.select().from(properties)
    .where(eq(properties.status, "active"));  // ALL orgs, no limit

  for (const property of allActiveProperties) {
    const [latestScore] = await db.select().from(landCreditScores)
      .where(eq(landCreditScores.propertyId, property.id))  // N+1
      .orderBy(desc(landCreditScores.createdAt))
      .limit(1);
  }
}
```

Issues:
1. **No org filter**: Loads ALL active properties across ALL organizations. With 100 orgs each having 100 properties, that is 10K properties. With one power-user org having 10K properties, that is 10K+ right there.
2. **N+1 pattern**: Executes one query per property to check score staleness. At 10K properties = 10,001 queries.
3. **No batching**: Each recalculation is sequential (`for...of` loop at line 131), with no concurrency control.
4. **No pagination**: The job attempts to process ALL stale properties in a single run.

**leadNurturer.ts** (line 382-396):
```typescript
const allLeads = await storage.getLeads(organizationId);
for (const lead of allLeads) { ... }
```
Sequential processing of all leads, though at least org-scoped.

---

## Recommendations by Priority

### P0 (Must-fix before 10K-parcel org onboarding)

1. **Dashboard intelligence**: Replace `getLeads()`/`getDeals()`/`getProperties()` in `/api/dashboard/intelligence` with SQL aggregation queries. Use `COUNT(*) FILTER (WHERE ...)` for week-over-week metrics.

2. **Export streaming**: Replace `exportLeadsToCSV()` with a streaming approach:
   - Use a SQL cursor or chunked pagination (1K rows at a time)
   - Pipe CSV rows directly to `res.write()` with `res.setHeader("Transfer-Encoding", "chunked")`
   - Remove the 5,000-row hard cap

3. **Land credit recalculation N+1**: Replace the for-loop with a LEFT JOIN query to find stale scores in a single SQL statement. Add org-scoping or batch by org.

### P1 (Should-fix)

4. **Stage filter scalability**: Add a `betty_score` and `nurturing_stage` column to the leads table, populated on create/update/rescore. This eliminates the need to load all leads when filtering by stage.

5. **Monthly revenue aggregation**: Replace the in-memory `reduce()` in `getDashboardStats()` with `SELECT SUM(monthly_payment) FROM notes WHERE org_id = ? AND status = 'active'`.

6. **Leads `/paginated` endpoint**: The cursor-based endpoint (`/api/leads/paginated`, line 136) loads ALL leads first, then slices -- defeating the purpose. Either make it truly cursor-based with SQL `WHERE id < cursor`, or remove it.

7. **Bulk operation size limit**: Add `.max(1000)` to the ids array in `bulkLeadIdsSchema` and `bulkIdsSchema`.

### P2 (Nice-to-have)

8. **Map clustering**: Add `cluster: true` to the Mapbox GeoJSON source for property points, or use `supercluster` for custom clustering. Not urgent because polygon rendering is already GPU-accelerated.

9. **Virtual table adoption**: Wire `VirtualTable` into leads/properties pages for `pageSize > 50`. Not urgent because the 100-row page cap keeps DOM size manageable.

10. **Server-side search**: Push the inline search filter (`leads.tsx:914`) to the server so users can search across all 10K leads, not just the current page.

11. **Import batch limit**: Increase `MAX_CSV_IMPORT_ROWS` from 500 to 2,000-5,000 or implement chunked import processing.

---

## DEFECT-0016 Verification

The previously reported unbounded SELECT (DEFECT-0016) has been **partially addressed**:

- **Fixed**: Primary list endpoints (`GET /api/leads`, `GET /api/properties`) now use `getLeadsPaginated()` / `getPropertiesPaginated()` with SQL LIMIT/OFFSET.
- **Still present**: The unbounded methods (`getLeads()`, `getProperties()`, `getDeals()`) are capped at 5,000 rows but remain called from 20+ locations across routes, services, AI tools, and jobs. These are the residual scalability risk.

The 5,000-row hard cap prevents runaway memory consumption but silently drops data for orgs with >5K records of a given type.

---

## Files Referenced

| File | Relevance |
|------|-----------|
| `server/storage.ts` (lines 1263-1274, 1276-1299, 1363-1382, 1581-1606, 1657-1679, 2074-2099) | Core query methods |
| `server/routes-leads.ts` (lines 80-133, 136-197, 533-593, 851-857) | Lead endpoints |
| `server/routes-properties.ts` (lines 73-104, 276-333) | Property endpoints |
| `server/routes-dashboard.ts` (lines 27-39) | Dashboard intelligence |
| `server/middleware/pagination.ts` | Pagination utilities |
| `server/services/fullTextSearch.ts` | FTS implementation |
| `server/services/importExport.ts` (lines 539-559, 609-627, 940-957) | Export/import |
| `server/jobs/landCreditScoreRecalculation.ts` (lines 39-63, 107-141) | N+1 background job |
| `client/src/pages/leads.tsx` (lines 643, 908-957) | Client pagination + filtering |
| `client/src/pages/properties.tsx` (lines 137, 187-206) | Client pagination + filtering |
| `client/src/components/VirtualTable.tsx` | Unused virtualization component |
| `client/src/components/virtual-list.tsx` | Unused virtualization component |
| `client/src/components/property-map.tsx` (lines 1296-1343, 1470-1517) | Map rendering |
| `client/src/hooks/use-leads.ts` (lines 20-41, 47-58) | Client hooks |
| `client/src/hooks/use-properties.ts` (lines 20-38, 45-57) | Client hooks |
| `migrations/0007_composite_indexes.sql` | Index coverage |
| `migrations/0010_fts_gin_indexes.sql` | GIN indexes for FTS |
| `migrations/0013_index_audit.sql` | Comprehensive index audit |
