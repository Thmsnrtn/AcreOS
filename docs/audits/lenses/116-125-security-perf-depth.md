# Lenses 116-125: Security & Performance Depth Audit

Auditor: Tier 3 (Security & Performance Depth)
Date: 2026-04-18
Scope: Third-party scripts, supply chain, log injection, deserialization, SSRF, cold deploy, hot paths, memory, N+1 queries, render-blocking resources

---

## Lens 116 -- Third-Party Script Risk

### Finding 116-A: Massive Render-Blocking Google Fonts (P1)
**File:** `client/index.html:28`

A single `<link>` tag loads **26 font families** from Google Fonts in a single render-blocking request. This includes Architects Daughter, DM Sans, Fira Code, Geist, Geist Mono, IBM Plex Mono, IBM Plex Sans, Inter, JetBrains Mono, Libre Baskerville, Lora, Merriweather, Montserrat, Open Sans, Outfit, Oxanium, Playfair Display, Plus Jakarta Sans, Poppins, Roboto, Roboto Mono, Source Code Pro, Source Serif 4, Space Grotesk, and Space Mono. The response size from Google is enormous and blocks first paint.

Additionally, `client/src/index.css:1` loads yet another font (`SF Pro Display` / `SF Pro Text`) via `@import url(...)` -- a CSS @import is also render-blocking.

**None of these external resources have SRI (Subresource Integrity) hashes.** If Google Fonts CDN were compromised, arbitrary CSS could be injected.

**Impact:** First Contentful Paint delayed by 500ms-2s+. No integrity verification on CDN resources.

### Finding 116-B: Third-Party Scripts in CSP Allowlist (P2 - noted)
**File:** `server/middleware/security.ts:25-46`

The CSP allows `https://js.stripe.com`, `https://api.mapbox.com`, `https://*.clerk.accounts.dev`. These are necessary third-party services. Stripe and Clerk are loaded via their respective SDKs, Mapbox for GIS. The CSP is properly configured with nonces for inline scripts. No arbitrary third-party analytics, chat widgets, or tracking scripts found -- this is good.

---

## Lens 117 -- Dependency Supply Chain

### Finding 117-A: @types Packages in Production Dependencies (P1)
**File:** `package.json:92-96`

Five `@types/*` packages are listed in `dependencies` instead of `devDependencies`:
- `@types/cookie-parser`
- `@types/mapbox-gl`
- `@types/multer`
- `@types/pdfkit`
- `@types/puppeteer-core`

These ship to production, increasing deploy size and attack surface unnecessarily. Type packages occasionally contain postinstall scripts and should never be in production deps.

### Finding 117-B: 106 Production Dependencies (P2 - noted)
The dependency count (106 prod) is high. Notable inclusions:
- `puppeteer-core` (browser automation -- large transitive dep tree)
- `mammoth` (DOCX parsing)
- `jspdf` (PDF generation)
- `openai` + `@anthropic-ai/sdk` (two AI SDKs)
- `@capacitor/*` (14 mobile framework packages that ship to server)

The Capacitor packages are client-side mobile framework deps that should be separated from the server bundle.

### Finding 117-C: Override for drizzle-kit esm-loader (P2 - noted)
**File:** `package.json:175-179`

An override replaces `@esbuild-kit/esm-loader` with `tsx`. This is a legitimate workaround but should be documented and periodically verified.

---

## Lens 118 -- Log Injection

### Finding 118-A: User-Controlled Data in Log Messages Without Sanitization (P1)
**File:** `server/utils/logger.ts`

The logger itself does not sanitize messages. In production mode (`IS_PRODUCTION`), it serializes log entries as JSON via `JSON.stringify(entry)` (line 64), which provides structural integrity. However, the `message` field is a raw string and is interpolated directly by callers.

Concrete examples of user-controlled data flowing into log messages:

- `server/routes-misc.ts:295` -- `logger.info(\`[Twilio Webhook] Incoming SMS from ${From} to ${To}: ${Body.substring(0, 50)}...\`)` -- SMS body content from incoming webhooks goes directly into log messages.
- `server/webhookHandlers.ts:605` -- `logger.error(\`Note not found for accessToken: ${accessToken}\`)` -- access tokens logged directly.
- `server/routes-admin.ts:2201` -- `logger.error("Property enrichment error", { error: err.message, propertyId: req.body?.propertyId })` -- user-supplied propertyId in metadata (safe in JSON mode, risky in dev plaintext mode).

**Mitigating factor:** In production, JSON serialization prevents newline injection from creating fake log entries. The PII masking interceptor (`server/middleware/piiMasking.ts`, installed at line 42 of index.ts) catches phone/email/SSN/CC patterns. However, the SMS body log (routes-misc.ts:295) could contain arbitrary text that creates misleading log entries in dev mode.

**Impact:** Low in production (JSON mode), moderate in development (plaintext mode allows newline injection).

---

## Lens 119 -- Deserialization Safety

### Finding 119-A: Pervasive JSON.parse on AI/LLM Responses Without Schema Validation (P1)
**Files:** 50+ occurrences across server/services/ and server/ai/

Dozens of `JSON.parse()` calls parse LLM output directly and trust the resulting structure:
- `server/ai/executive.ts:44` -- `JSON.parse(result.choices[0].message.content || "{}")`
- `server/services/aiBoardOfDirectors.ts:260` -- `JSON.parse(response.content)`
- `server/services/ceoCognitiveModelV11.ts:63,142,179` -- three more
- `server/services/aiOfferService.ts:223,356` -- parsed into offer data

Most of these do wrap in try/catch, but none validate the parsed result against a Zod schema or similar. If an LLM returns unexpected keys or types, they flow through the system unchecked. Prototype pollution is not a direct risk from `JSON.parse` (it doesn't set `__proto__`), but incorrect types (e.g., a string where a number is expected) can cause downstream failures.

**Impact:** Data integrity risk. Malformed LLM output could produce incorrect offer calculations, wrong agent actions, or silent data corruption. Not a direct security exploit, but a reliability/correctness vulnerability.

### Finding 119-B: JSON.parse on User-Supplied Body Fields (P2 - noted)
**Files:** `server/routes-import-export.ts:172`, `server/routes-field-scout.ts:178`

Both parse `req.body.fieldMap` and `req.body.metadata` via `JSON.parse()`. Both are wrapped in try/catch. Since Express has already parsed the outer JSON body, these are string fields that the client chose to JSON-encode. Low risk but indicates inconsistent API design (nested JSON strings instead of proper JSON objects).

---

## Lens 120 -- SSRF Around Agent Tools

### Finding 120-A: Browser Automation Has SSRF Protections, But DNS Check Is Disabled (P1)
**File:** `server/services/browserAutomation.ts:805-826`

The `browseWeb` function has extensive SSRF protections:
- Protocol allowlist (HTTP/HTTPS only)
- Private IPv4 blocking (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x)
- IPv6 blocking
- Hostname pattern blocking (localhost, .local, .internal, metadata.*)
- Octal/hex IP format blocking
- Shorthand IPv4 blocking

**However, the DNS resolution check is explicitly disabled** (line 818-819):
```
// DNS resolution check disabled temporarily for debugging
// Will use URL pattern matching only for SSRF protection
```

This means a DNS rebinding attack is possible: an attacker could register a domain that initially resolves to a public IP (passing the pattern check) but then resolves to `169.254.169.254` (cloud metadata) or `127.0.0.1` during actual connection. The request interception callback (line 936-958) also calls `resolveAndCheckHost` but that function returns `{ allowed: true }` for any non-IP hostname since DNS resolution is disabled.

**Impact:** An attacker who can control a URL passed to `browseWeb` (e.g., through an agent tool or admin interface) could potentially access cloud metadata endpoints or internal services via DNS rebinding.

### Finding 120-B: External Service Fetches Use Hardcoded URLs (Low Risk)
**Files:** `server/services/connectors/executor.ts`, `server/services/censusDataService.ts`, etc.

All external API calls in provider services use hardcoded base URLs (Stripe API, Google APIs, Census API, etc.). User input is only used for query parameters (properly encoded). No user-controlled base URLs found outside the browser automation service.

---

## Lens 121 -- Cold Deploy Performance

### Finding 121-A: Heavy Startup Import Chain (P2 - noted)
**File:** `server/index.ts`

The server startup imports 30 top-level modules synchronously before the Express app starts listening. Key imports:
1. OpenTelemetry tracing (line 2)
2. Express + all middleware (lines 5-17)
3. Sentry initialization (line 26, called at line 34)
4. Secrets validation (line 37-38)
5. PII masking console interceptor (line 41-42)
6. Provider initialization (line 72-73)
7. DB pool creation (via `./storage` import, line 13) -- establishes connection immediately
8. Schema import (14,883 lines of schema definitions loaded via `@shared/schema`)

The DB pool connects eagerly at import time (db.ts creates `new Pool()` at module scope). The `connectionTimeoutMillis: 10_000` means a cold start to a slow database could block for 10 seconds before the first connection is established.

Production migrations run at startup (line 331-343), adding another potential delay.

**Impact:** Cold start on Fly.io likely takes 3-8 seconds depending on database latency. With only 2 machines and rolling deploy, one machine handles all traffic during the other's restart.

---

## Lens 122 -- Hot Path Profiling

### Finding 122-A: Middleware Stack Applied to Every Request (P2 - noted)
**File:** `server/index.ts:211-327`

Every request passes through this middleware chain:
1. Telemetry middleware
2. Security headers (CSP nonce generation with `crypto.randomBytes(16)`)
3. Metrics middleware
4. CORS middleware
5. Request timeout
6. Query param sanitization
7. Body parsing (JSON + urlencoded)
8. Cookie parser
9. Content-type validation
10. Request logging
11. Rate limiting (multiple layers)

The CSP nonce generation (`crypto.randomBytes(16)`) on every request adds ~0.1ms of entropy collection. Not significant individually but across 926 endpoints under load it adds up.

### Finding 122-B: getLeads/getProperties/getDeals Fetch All Rows (P1)
**File:** `server/storage.ts:1261, 1573, 1668`

The `getLeads(orgId)`, `getProperties(orgId)`, and `getDeals(orgId)` methods fetch ALL records for an organization with no LIMIT clause. These are called by the MCP server (`server/mcp-server.ts:92`) which then does in-memory filtering and slicing:
```typescript
let leads = await storage.getLeads(orgId);
if (status) leads = leads.filter((l) => l.status === status);
return leads.slice(0, Math.min(Number(limit), 200));
```

If an organization has 10,000+ leads, every MCP `get_leads` call fetches all of them from the database, transfers them over the wire, deserializes them, then throws most away. Paginated variants (`getLeadsPaginated`) exist but are not used in the MCP path.

**Impact:** Database and memory pressure scales linearly with data volume. A large organization could see 100ms+ query times and multi-MB memory allocations per request.

---

## Lens 123 -- Memory Budget Under Load

### Finding 123-A: Unbounded In-Memory Collections in Background Jobs (P1)
**File:** `server/storage.ts:6520-6570`

The `getApiUsageCosts` method fetches all API usage logs into memory (line 6521-6523) with no LIMIT, iterates them (line 6533), then fetches another unbounded set of recent logs (line 6553-6555) and iterates again (line 6558). For an organization with heavy API usage, this could mean tens of thousands of rows loaded into memory per call.

### Finding 123-B: Metrics Histogram Stores All Values In-Memory (P2 - noted)
**File:** `server/middleware/metrics.ts:25`

The metrics system pushes every request duration into an in-memory array (`bucket.values.push(value)`). This array is never truncated or sampled. Over time, this will grow unboundedly:
- At 10 req/s, that's 864,000 entries/day
- Each entry is a number (8 bytes), so ~7MB/day of monotonically growing memory

The 4GB RAM budget (from Fly.io config) gives plenty of room, but this is still a slow memory leak.

---

## Lens 124 -- Query N+1 Hunter

### Finding 124-A: getSequenceStats -- Classic N+1 (P1)
**File:** `server/storage.ts:3910-3926`

```typescript
async getSequenceStats(orgId: number) {
  const sequences = await this.getSequences(orgId);      // Query 1
  for (const seq of sequences) {
    const enrollments = await this.getSequenceEnrollments(seq.id);  // Query per sequence
    ...
  }
}
```

This fetches all sequences (1 query), then for each sequence fetches all its enrollments (N queries). Called from `GET /api/sequences/stats`. With 50 sequences, this is 51 queries. Should be a single JOIN + GROUP BY.

### Finding 124-B: Campaign Lead Address Verification -- N+1 (P1)
**File:** `server/routes-campaigns.ts:1277-1294`

```typescript
for (const leadId of leadIds) {
  const lead = await storage.getLead(org.id, leadId);  // 1 query per lead
  ...
  const verificationResult = await verifyAddress({...}); // 1 API call per lead
}
```

Each lead ID triggers a separate DB query + external API call. For a 500-lead mail campaign, this is 500 sequential DB queries and 500 sequential API calls. The DB queries should use `getLeadsByIds` (which exists), and the API calls should be batched or parallelized with p-limit.

### Finding 124-C: Deal Pipeline Undo -- N+1 (P1)
**File:** `server/routes.ts:1197-1209`

```typescript
for (const state of previousStates) {
  const deal = await storage.getDeal(org.id, state.id);  // 1 query per deal
  await storage.updateDeal(state.id, { status: state.previousStage }); // 1 update per deal
}
```

Each deal in the undo batch triggers 2 sequential queries. Should batch-fetch with `getDealsByIds` and use a single UPDATE with CASE/WHEN.

### Finding 124-D: initDefaultVaAgents -- N+1 (P2 - noted)
**File:** `server/storage.ts:2554-2557`

```typescript
for (const agent of defaultAgents) {
  const created = await this.createVaAgent(agent);  // 1 insert per agent
}
```

Sequential inserts for 4 default agents. Minor since this only runs once during org setup, but should be a batch insert.

---

## Lens 125 -- Render-Blocking Resource Hunter

### Finding 125-A: 26-Family Google Fonts Stylesheet Blocks Render (P0)
**File:** `client/index.html:26-28`

The Google Fonts `<link>` tag on line 28 is render-blocking. The browser cannot paint until this massive stylesheet (requesting 26 font families with many weight ranges) is downloaded and parsed. This single request likely returns 50-100KB of CSS with @font-face declarations pointing to dozens of individual font files.

Additionally, two `<link rel="preconnect">` tags (lines 26-27) establish early connections but do not help with the blocking nature of the stylesheet itself.

**Fix:** Add `media="print" onload="this.media='all'"` to defer loading, or better: remove unused fonts (the app likely uses 2-3 families maximum), self-host the fonts used, and load them with `font-display: swap`.

### Finding 125-B: CSS @import in index.css (P1)
**File:** `client/src/index.css:1`

```css
@import url('https://fonts.googleapis.com/css2?family=SF+Pro+Display:...');
```

This is a CSS @import of an external stylesheet, which is doubly render-blocking: the browser must first download the CSS bundle containing this @import, then discover and fetch the Google Fonts CSS, then download the font files. This creates a waterfall chain that delays First Contentful Paint.

**Note:** SF Pro Display / SF Pro Text are Apple system fonts not actually served by Google Fonts -- this @import likely returns an empty or error response, adding latency for nothing.

### Finding 125-C: No Deferred/Async on Module Script (Low Risk)
**File:** `client/index.html:41`

The main entry point `<script type="module" src="/src/main.tsx">` is a module script. Module scripts are deferred by default in browsers, so this is not render-blocking. The inline dark-mode script (lines 31-38) is tiny and intentionally synchronous to prevent FOUC. Good pattern.

### Finding 125-D: Service Worker Registration Has No Fallback (P2 - noted)
**File:** `client/src/main.tsx:10-19`

The service worker registration attempts to load `/sw.js` in production. Per the orientation doc (issue #20), this file may not exist, causing console errors. While not render-blocking, failed SW registration causes unnecessary network requests on every page load.

---

## Summary

| ID | Lens | Severity | Title |
|----|------|----------|-------|
| 125-A | Render-Blocking | **P0** | 26-family Google Fonts stylesheet blocks first paint |
| 120-A | SSRF | **P1** | DNS resolution check disabled in browser automation SSRF guard |
| 122-B | Hot Path | **P1** | getLeads/getProperties/getDeals fetch all rows with no LIMIT |
| 124-A | N+1 | **P1** | getSequenceStats loops DB queries per sequence |
| 124-B | N+1 | **P1** | Campaign address verification: 1 query + 1 API call per lead |
| 124-C | N+1 | **P1** | Deal pipeline undo: 2 queries per deal in loop |
| 116-A | Third-Party | **P1** | 26 font families loaded with no SRI, blocks render |
| 117-A | Supply Chain | **P1** | @types packages in production dependencies |
| 118-A | Log Injection | **P1** | SMS body and access tokens logged without sanitization |
| 119-A | Deserialization | **P1** | 50+ JSON.parse calls on LLM output with no schema validation |
| 123-A | Memory | **P1** | Unbounded API usage log fetches into memory |
| 125-B | Render-Blocking | **P1** | CSS @import of external font (likely invalid SF Pro from Google) |
