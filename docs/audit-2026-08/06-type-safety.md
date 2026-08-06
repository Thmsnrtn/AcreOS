# 06 — Type Safety Past the Ratchet

*Dimension slice 06. Read-only. Region: the `: any` **annotation** residue and its relationship to the ratcheted `as any` **cast**.*

**State of the region:** The `as any` cast is ratcheted (baseline **1417**, `server/**/*.ts` only), driven strictly down, and audited commit-by-commit — a genuinely well-run gate. Its uncounted sibling, the `: any` **type annotation**, is gated by **nothing**: **3,720** annotations across server/shared/client (excl. tests), of which **1,574 are non-`catch`** — real domain surfaces. The single defect class that survives every gate here is **a tenant key or money value annotated `: any`** — the exact `leads.organizationId`-widening shape the cast ratchet was built to stop, walking straight past it because the ratchet only pattern-matches the token `as any`. I found the live specimen (`landCredit.generateLandCreditReport(propertyId: any, organizationId: any)`) and two structural blind spots (client/shared casts uncounted; `Promise<any>` returns on org-scoped services).

---

### F-06-1 — The `: any` annotation is the uncounted sibling of the `as any` ratchet, gated by nothing
**Severity:** P1 serious
**Surfaced by:** slice 06 (type-safety)
**Survives which gates:** (1) the `as-any` ratchet matches only the literal token `as any` (`scripts/ratchets/as-any.json` → `"pattern": "as any"`) — a `: any` annotation is a different token and never counts. (2) The `eslint-ratchet` runs `npx eslint client/src -f json` (`scripts/lint-eslint-ratchet.mjs:47`) and its baseline (`scripts/eslint-rules-baseline.json`) ratchets only the **5 custom `acreos/*` rules**; `@typescript-eslint/no-explicit-any` is **not in the baseline**. (3) `no-explicit-any` is set to `"warn"` (`.eslintrc.json:34`), and per the ratchet script's own header the raw ESLint CI step is `continue-on-error: true` — informational only. So all three plausible gates miss it.
**Evidence:** measured at HEAD (`5ca0f29`):
```
as-any ratchet:  current=1417 baseline=1417  (server/**/*.ts, via ratchet.mjs --measure)
: any (excl tests): server 3093 | shared 46 | client 581  = 3720
  server breakdown: catch(e:any) 2078  |  non-catch 1015
non-catch : any total (server+shared+client): 1015 + 46 + 513 = 1574
lines matching BOTH 'as any' and ': any': 55  (the two counts are ~disjoint)
```
**What's wrong:** The ratchet exists because `as any` on a money/tenant path is where a mispriced charge or cross-org leak hides. A `: any` annotation erases the type checker at exactly the same surfaces (function params, returns, variable decls) and is 2.6× more numerous non-`catch`. The team drove the counted token to 1417 while the uncounted sibling floats free — a `leads.organizationId: any` param would be invisible to CI.
**Impact:** Neither directly — it is the *enabling condition* for F-06-2/-04. Burns trust after sale when the untyped surface is a tenant key or money value that TS would otherwise have caught at compile time.
**Fix:** Add a `: any`-annotation ratchet. Recommend **two configs** so the noisy `catch` class doesn't drown the signal:
  - `explicit-any-noncatch`: `pattern` matches `:\s*any\b` **minus** `catch (…: any)` — measured baseline **1,574** over globs `["server/**/*.ts","shared/**/*.ts","client/**/*.{ts,tsx}"]`, excl. `**/*.test.*`,`**/*.spec.*`, direction down. (Note: `ratchet.mjs`'s regex can't do the catch-exclusion in one pattern; either add a `subtractPattern` field to `ratchet.mjs`, or ratchet `catch\s*\([a-zA-Z_]+:\s*any\)` separately at baseline **2,146** and total `: any` at **3,720**.)
  - Priority drive-to-zero: the tenant/money/auth subset first (F-06-2, F-06-4).
**Gate it:** the ratchet above. Measured baseline **1,574 non-catch** (or 3,720 all-in) — glob `server/**/*.ts` + `shared/**/*.ts` + `client/**/*.{ts,tsx}`, excl. tests, direction down.
**Effort:** S (add JSON config + one `subtractPattern` line in `ratchet.mjs`)
**Blast radius:** whole repo; one new ratchet file + one runner tweak.
**Confidence:** high — counts reproduced via the repo's own `ratchet.mjs --measure` and grep; gating verified by reading all three gate scripts.

---

### F-06-2 — `generateLandCreditReport(propertyId: any, organizationId: any)` + unscoped property read: latent cross-tenant leak guarded only by call ordering
**Severity:** P2 real
**Surfaced by:** slice 06
**Survives which gates:** `as-any` ratchet (no `as any` token on the line); `lint:org-fetch` (the unscoped `findFirst` uses `eq(properties.id, …)` with no org predicate — the lint keys on org-scoped-fetch patterns, and a fully-unscoped read on a `: any` id isn't flagged here); TS (`organizationId: any` param defeats the checker).
**Evidence:** `server/services/landCredit.ts:1373` — the ONLY tenant-key `: any` in the repo:
```ts
async generateLandCreditReport(propertyId: any, organizationId: any): Promise<Buffer> {
  const score = await this.calculateCreditScore(organizationId, propertyId); // line 1376 — org-scoped, THROWS if not owned
  const property = await db.query.properties.findFirst({
    where: eq(properties.id, propertyId),   // line ~1379 — NO organizationId filter
  });
```
Route: `server/routes-land-credit.ts:153-159` passes `req.params.propertyId` (untrusted external input) + `org.id.toString()`.
**What's wrong:** The second query fetches ANY property by id regardless of org and prints its address/APN/county/acreage into the PDF. Today it's saved by ordering: `calculateCreditScore` (line 1376) filters `and(eq(id), eq(organizationId))` and `throw new Error('Property not found')` at `landCredit.ts:362` for a foreign property, so the unscoped read at 1379 is never reached. That is defense-by-accident. Reorder the two calls, or make `calculateCreditScore` return a default instead of throwing, and org A gets org B's property details in a downloadable PDF. The `: any` on both params is why TS can't see the id-type/ownership mismatch flowing from route params.
**Impact:** Burns trust after sale (cross-tenant property-data disclosure) if the guard ordering ever changes; a paying customer's parcel details leak to another tenant.
**Fix:** (1) Add the org predicate to the line-1379 read: `where: and(eq(properties.id, Number(propertyId)), eq(properties.organizationId, Number(organizationId)))`. (2) Type the params `propertyId: number, organizationId: number` (or `string`) — remove both `: any`.
**Gate it:** the F-06-1 ratchet catches the `: any`; `lint:org-fetch` should be extended to flag a `properties.findFirst`/`.select` whose `where` has no `organizationId` predicate. Measured: 1 tenant-key `: any` at HEAD — ratchet that subset at baseline **1**, direction down.
**Effort:** S
**Blast radius:** `server/services/landCredit.ts`, `server/routes-land-credit.ts`.
**Confidence:** high — read the full call chain (route → generateLandCreditReport → calculateCreditScore throw at line 362). The leak is currently unreachable; severity is P2 not P0 because the throw guards it, but the type erasure + missing filter is a real latent hole.

---

### F-06-3 — `as-any` ratchet is server-only: 230 casts in client/shared are uncounted
**Severity:** P2 real
**Surfaced by:** slice 06
**Survives which gates:** the ratchet glob is `["server/**/*.ts"]` (`scripts/ratchets/as-any.json`), so `client/` and `shared/` are never walked for `as any`. The client-side eslint-ratchet doesn't ratchet `no-explicit-any` (F-06-1). Net: a money/tenant cast written in `client/` or `shared/` walks free.
**Evidence:**
```
as any casts:  server 1417 (ratcheted)  |  client 226 (ungated)  |  shared 4 (ungated)
```
**What's wrong:** The ratchet's own description says its purpose is that "on money and multi-tenant paths that's where a mispriced charge or a cross-org data leak hides." `shared/` holds schema/types touched by both tiers; `client/` renders money and org context. A `(x as any).organizationId` in `shared/` is exactly the guarded class, in an unguarded directory. shared/ at only 4 casts is cheap to fold in immediately.
**Fix:** Extend the `as-any` ratchet globs to `["server/**/*.ts","shared/**/*.ts","client/**/*.{ts,tsx}"]`. Measured new baseline: **1417 + 4 + 226 = 1647** (server unchanged; add shared=4, client=226). Or add `shared` now (baseline 1421) and phase in client.
**Gate it:** the same `as-any.json` with widened globs; measured combined baseline **1647**, direction down.
**Effort:** S
**Blast radius:** one JSON glob edit; forces a client/shared cast cleanup or an honest baseline.
**Confidence:** high — glob read directly; counts by grep excl. tests.

---

### F-06-4 — `Promise<any>` / `: any` return types on org-scoped service functions propagate untyped domain objects to every consumer
**Severity:** P2 real
**Surfaced by:** slice 06
**Survives which gates:** F-06-1 (annotation ungated). The params are correctly typed (`organizationId: string`) so nothing looks wrong at the signature glance, but the **return** is `any` — every field access on the result downstream is unchecked, silently.
**Evidence:**
```
server/services/negotiationOrchestrator.ts:321  async getThread(organizationId: string, threadId: string): Promise<any>
server/services/negotiationEnhancements.ts:94    export async function quickOfferData(leadId, orgId): Promise<any>
server/services/propertyIntelligenceEnhancements.ts:93  getShareablePropertyData(propertyId, orgId): Promise<any>
server/services/leadScoring.ts:660               formatFactorsForStorage(...): any
```
**What's wrong:** A `Promise<any>` return is more corrosive than a `: any` param — the erasure travels to every call site. A consumer reading `.amountCents` or `.organizationId` off `getThread(...)`'s result gets no check that the field exists or is the right type; a schema rename won't fail the build at the consumer. This is how the `leads.organizationId` widening propagated originally (per CLAUDE.md wave note).
**Impact:** Burns trust after sale — a renamed/removed field on a negotiation or property-share payload compiles clean and 500s (or renders `undefined`) at runtime for a paying user.
**Fix:** Give each a concrete return type (Drizzle row type or a declared interface). These four are the org-scoped subset; prioritize them in the F-06-1 drive-to-zero.
**Gate it:** F-06-1 ratchet (return-type `: any` is included). No separate gate needed.
**Effort:** M (define ~4 return shapes; verify consumers)
**Blast radius:** 4 service files + their call sites.
**Confidence:** medium — I confirmed the signatures; I did not enumerate every consumer, so runtime impact is inferred from the type erasure, not a reproduced 500.

---

### F-06-5 — Stripe webhook `event: any` and `sessionConfig: any` discard SDK types on money paths
**Severity:** P3 minor
**Surfaced by:** slice 06
**Survives which gates:** F-06-1 (annotation ungated). Registry P0-0006 confirms the webhook **signature** is verified — this is not that. This is the type of the verified event object being thrown away.
**Evidence:** `server/routes-billing.ts:1118` `let event: any;` — but `stripe.webhooks.constructEvent(...)` (line 1122) already returns the precise `Stripe.Event` union. `server/stripeService.ts:41` `const sessionConfig: any = {` — Stripe ships `Stripe.Checkout.SessionCreateParams`.
**What's wrong:** Downstream `event.type` / `event.data.object.amount` and every `sessionConfig.*` mutation are unchecked. A typo in a Stripe field name (e.g. `amount_total` vs `amount`) compiles clean. Low blast because the values are echoed to Stripe/logged, not used to compute a charge here — but it's money-path type erasure that the SDK already solves for free.
**Impact:** Neither directly; latent maintenance hazard on the billing path.
**Fix:** `const event = stripe.webhooks.constructEvent(...)` (infers `Stripe.Event`); type `sessionConfig` as `Stripe.Checkout.SessionCreateParams`.
**Gate it:** F-06-1 ratchet.
**Effort:** S
**Blast radius:** 2 files.
**Confidence:** high — both lines read in full context.

---

### F-06-6 — `@ts-ignore`/`@ts-expect-error` surface is small and each production use is justified; ungated but low-risk
**Severity:** P3 minor
**Surfaced by:** slice 06
**Survives which gates:** no ratchet counts suppression directives (none exists). ESLint `ban-ts-comment` is not configured.
**Evidence:** repo-wide (excl. node_modules): **1** `@ts-ignore` + **~26** `@ts-expect-error`. Production (non-test): exactly **5**, each with a stated reason:
```
server/mcp-server.ts:122            @ts-expect-error -- dynamic import; module may not exist at compile time
server/middleware/httpCacheHeaders.ts:17  @ts-ignore — transitive dep via `compression`, no types
server/services/paidDataEvalHarness.ts:432 @ts-expect-error indexed assignment across the union is safe
server/routes.ts:995               @ts-expect-error -- requestId added at runtime for request tracing
server/routes-deal-rooms.ts:83     @ts-expect-error -- wss attached by WebSocket middleware at runtime
```
The remaining ~21 are in `*.test.ts` deliberately feeding invalid inputs (e.g. `solene/*`, `pax/userContext.test.ts`) — legitimate.
**What's wrong:** Nothing acute. `@ts-expect-error` is self-healing (fails if the error disappears); the one `@ts-ignore` (untyped transitive dep) is the only non-self-healing suppression and is benign. Flagging only so the count is on record: it is ungated and would silently grow.
**Impact:** Neither. Recorded for completeness.
**Fix:** None required. Optionally set `@typescript-eslint/ban-ts-comment` to require `@ts-expect-error` + description (bans bare `@ts-ignore`), and ratchet the count at **5** to stop growth.
**Gate it:** ratchet `@ts-(ignore|expect-error)` at measured baseline **5** (production globs, excl. tests), direction down.
**Effort:** S
**Blast radius:** lint config only.
**Confidence:** high — all 27 sites enumerated and read.

---

## Coverage ledger

**Examined exhaustively:**
- All three candidate gates for `: any`, read in full: `scripts/ratchets/as-any.json`, `scripts/ratchet.mjs` (counting semantics), `scripts/lint-eslint-ratchet.mjs`, `scripts/eslint-rules-baseline.json`, `.eslintrc.json`. Confirmed `: any` annotation is gated by nothing and the `as-any` ratchet is server-only.
- The overlap question: measured `as any` vs `: any` are ~disjoint (55 shared lines of 1417+3720).
- All 27 `@ts-ignore`/`@ts-expect-error` sites (grep-enumerated, 5 production sites read in context).
- The single tenant-key `: any` (F-06-2) traced end-to-end: route → `generateLandCreditReport` → `calculateCreditScore` throw guard.
- Counts reproduced with the repo's own `ratchet.mjs --measure` (as-any=1417 confirmed) plus grep for the annotation classes.

**Examined by sampling:**
- The 1,015 non-catch server `: any` characterized by category (catch 2078, arrow-param 307, Record<string,any> 520, any[] 162, Promise/Map<any> 70) rather than line-by-line.
- Money/tenant/auth `: any` found by targeted keyword grep (organizationId, amount|cents|price|payment, userId|session|token, req|body|payload). This surfaces annotations whose *identifier* names the sensitive value; it MISSES an untyped tenant key hiding behind a generic name (e.g. `id: any`, `ctx: any`).
- Top-20 `: any` files identified (routes-admin 180, routes-founder-intelligence 142, routes-va-engine 135…) but not each read.

**Did NOT examine:**
- Whether each of the 3,720 `: any` is individually load-bearing — only the sensitive-identifier subset was chased to blast radius.
- The 226 client + 4 shared `as any` casts individually (counted, not classified).
- Type soundness of the ~520 `Record<string, any>` (a softer erasure than bare `any`; deferred).
- `unknown`-vs-`any` discipline and structural `as unknown as X` double-casts (a separate escape hatch the `as any` pattern doesn't match) — flagged here as a gap for a follow-on but not measured.

## Constitution Collisions

None. Every finding is a type-safety/gate proposal; none adds a nav entry, AI destination, marketplace/API surface, or moves customer money. The proposed ratchets are additive CI gates consistent with the repo's existing ratchet idiom and the wave-discipline mandate to "fix the occurrence, not the baseline."
