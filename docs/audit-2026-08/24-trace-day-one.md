# Trace T5 — Day One (signup → first genuinely useful moment)

The day-one machinery is **substantially built and mostly honest**: onboarding-v2 is a
clean 3-step (+AI-disclosure) flow, all 15 vertical finish-destinations resolve to real
routes (pinned by `onboardingVerticals.test.ts`), and every one of the five doors carries
real `Skeleton` / `EmptyState` / `QueryErrorState` handling with persona-branched copy. The
empty account does **not** look blank or broken. The single defect class that survives every
gate here is **honesty-of-promise on the activation path**: the recommended day-one CTA
promises "50 realistic leads" and the seeder delivers ≤5, and the primary persona is dropped
onto the one door (Map) that hard-depends on an external key whose absence renders "Map
temporarily unavailable" as the first post-onboarding screen. `lint:no-fabrication` cannot
see either — it greps only for `Math.random`.

Golden-path click count (land_flipper, sample data, org name pre-filled): **4 clicks** — accept
AI disclosure → Continue → "Try with sample data" → "Make your first offer". Required fields: 1
(workspace name, usually pre-filled). Decisions demanded of a zero-context user: 3 (accept
disclosure, business type [defaulted], data path [defaulted-recommended]). This is genuinely good.

---

### F-24-1 — Onboarding's recommended CTA promises "50 realistic leads"; the seeder delivers ≤5
**Severity:** P2 real
**Surfaced by:** T5 (day-one)
**Survives which gates:** `lint:no-fabrication` (`scripts/check-no-fabrication.mjs`) scans for the
literal token `Math.random` only (line 84: `const FORBIDDEN_TOKEN = "Math.random"`). A hardcoded
string constant `"50 realistic leads"` that contradicts the seeder is invisible to it. No test
asserts the copy number matches `buildSampleFixtures` output. `tsc` sees a string literal, not a lie.
**Evidence:**
- Promise: `client/src/pages/onboarding-v2.tsx:1052` — "Pax loads 50 realistic leads so Today is alive from the start." and `:1033` aria-label "Pax loads 50 realistic leads" (screen-reader users hear it too).
- Delivery: `server/services/onboarding/sampleSeeder.ts` — `buildLandFlipperFixtures` seeds **5** leads (lines 182-188); across ALL 15 vertical builders combined there are **40** lead fixtures (`grep -c 'type: "(seller|buyer)"'` = 40), max **5** for any single vertical. No vertical seeds anywhere near 50.
- The toast at `:413` is honest (`Pax loaded ${data?.counts?.leads ?? 50}` uses the real count), which makes the mismatch worse: the user is *promised* 50 on the card, then *told* "5 leads" seconds later on the same flow.
**What's wrong:** The single most-recommended action in the product (the "Recommended" badge, `:1047`) states a specific, falsifiable quantity that is false by 10×. The constitution's own words — "no invented numbers … no placeholder data presented as real" — are violated on the first screen a paying-intent user touches.
**Impact:** Burns trust after signup — every new user who reads the card then counts their leads catches the product in a 10× overstatement on minute one. Primary persona (land_flipper) and every vertical.
**Fix:** Either (a) change copy to "a realistic starter set" / "sample leads" (no number), or (b) make the number data-driven from the same fixture source the toast uses. Preferred: `:1052`/`:1033` drop the "50", say "a handful of realistic leads and parcels so Today is alive."
**Gate it:** Extend `check-no-fabrication.mjs` with a targeted assertion, OR add a unit test that imports the copy and `buildSampleFixtures("land_flipper")` and asserts no onboarding string contains a lead-count integer that exceeds `fixtures.leads.length`. Baseline: 2 offending string sites today.
**Effort:** S
**Blast radius:** `onboarding-v2.tsx` (2 lines) + 1 test.
**Confidence:** high — both the promise and the delivery are read directly; `grep -c` = 40 total fixtures.

---

### F-24-2 — Primary persona finishes onboarding onto the Map door, which hard-depends on VITE_MAPBOX_ACCESS_TOKEN
**Severity:** P2 real (P1 the day it launches without the key)
**Surfaced by:** T5 (day-one)
**Survives which gates:** No gate verifies that a vertical's `finish.path` renders usable content
for a fresh org. `onboardingVerticals.test.ts:60` asserts only that `path="/maps"` is *registered*
in App.tsx — not that /maps produces value without an external key. A missing runtime secret is not
a compile/lint/test failure.
**Evidence:**
- `client/src/lib/onboarding-verticals.ts:56-58` — `land_flipper` (the DEFAULT businessType, `onboarding-v2.tsx:273`) finishes `path: "/maps", cta: "Make your first offer →"`.
- `client/src/components/property-map.tsx:2435` — `if (!isMapEngineConfigured()) return <Card>…"Map temporarily unavailable"…</Card>`.
- `client/src/lib/map-engine.ts:isMapEngineConfigured()` — with the default engine (`getMapEngine()` returns "mapbox" unless `VITE_MAP_ENGINE=maplibre`), returns `false` unless `VITE_MAPBOX_ACCESS_TOKEN` is set. The maplibre alternative uses Stadia tiles that the file itself flags as "explicitly NON-COMMERCIAL … never as an unkeyed production default."
- `docs/company/live-operation-keys.md:30` confirms it Tier-1: "if missing → map surface shows 'unavailable'."
**What's wrong:** The most common new customer, after clicking the celebratory "Make your first offer →", lands on a door whose activation moment requires (1) a provisioned Mapbox token, (2) sample parcels carrying coordinates, and (3) the tile CDN reachable. The empty/coordless states ARE handled well (`maps.tsx:1521-1590`, real basemap + "See a sample" + RequestCountyCTA), but the **unconfigured-token** state is a dead "Map temporarily unavailable" card — the first post-onboarding screen for the primary persona if the launch deploy forgets one secret.
**Impact:** Blocks first value for the primary persona at launch if the key is unset. Documented as a Tier-1 requirement, but the day-one flow routes straight into it with no fallback door, so a provisioning miss = broken first impression rather than degraded-but-usable.
**Fix:** (a) When `!isMapEngineConfigured()`, the onboarding finish for land-family verticals should route to `/today` (which is always alive) rather than `/maps`; or (b) add a boot-time check that logs a loud warning if a vertical finish path resolves to an unconfigured Map. Minimum: keep the Tier-1 key on the launch checklist (already is).
**Gate it:** A deploy smoke test hitting `isMapEngineConfigured()` server-side equivalent, or a launch-runbook assertion. Pure code gate not possible (runtime secret). Reasoning: absence of an env var can't be caught by tsc/lint/unit.
**Effort:** S (reroute) / already-M (runbook)
**Blast radius:** `onboarding-v2.tsx` finish routing OR ops runbook.
**Confidence:** high — token dependency and the unavailable-card branch read directly.

---

### F-24-3 — DEFECT-0059 (two onboarding wizards) is stale-OPEN; V1 is already deleted
**Severity:** P3 minor (documentation drift, not a live defect)
**Surfaced by:** T5 (day-one)
**Survives which gates:** The defect registry is prose; nothing reconciles a "Status: OPEN" row
against the tree. `00-orientation.md` already flagged this for slice 17 — I confirm it from the
day-one angle because it directly concerns the signup path.
**Evidence:** `docs/audits/defect-registry.md:600-607` marks DEFECT-0059 P2 **OPEN** ("V1 `onboarding-wizard.tsx` … and V2 … both exist"). But `client/src/App.tsx:496` comment: "standalone `/pages/onboarding-wizard.tsx` page was deleted as redundant" and `grep -rn onboarding-wizard client/src` returns only that comment — the file does not exist. `OnboardingGate` (App.tsx:667) unconditionally routes fresh signups to `/onboarding-v2`. There is exactly one wizard.
**What's wrong:** Registry contradicts HEAD; the ambiguity it warns about ("no routing logic determines which is served") no longer exists.
**Impact:** Neither — no user harm. Wastes an auditor's time re-investigating a resolved risk on the critical path.
**Fix:** Flip DEFECT-0059 to RESOLVED with resolving evidence (App.tsx:496 comment + absent file).
**Gate it:** Slice 17's registry-reconciliation ratchet (out of my region). None new needed here.
**Effort:** S
**Blast radius:** defect-registry.md 1 row.
**Confidence:** high.

---

### F-24-4 — Onboarding sends users to deep leaf routes (/rehabs, /rent-roll, /leases, /permits, /redemption-clock) whose day-one usefulness is unverified by any gate
**Severity:** P3 minor
**Surfaced by:** T5 (day-one)
**Survives which gates:** `onboardingVerticals.test.ts` proves the route is *registered* and renders a
real component (not a Redirect — verified: each is `ProtectedRoute component={…Page}`). It does NOT
prove the leaf page shows the freshly-seeded sample data or a purposeful empty state. That is exactly
the "built but unwired at the content level" gap between "route exists" and "route is useful."
**Evidence:** `client/src/lib/onboarding-verticals.ts` finish paths → `/rehabs` (fix_and_flip), `/rent-roll` (buy_and_hold/STR/multifamily/mobile_home), `/leases` (commercial), `/permits` (developer), `/redemption-clock` (tax_lien_deed). Routes confirmed to mount real pages at `App.tsx:847/859/882/885/993`. I did NOT verify each leaf renders the seeded sample rows or a good empty state (Coverage ledger).
**What's wrong:** The activation promise ("Open your rent roll →") is only as good as whether that leaf actually shows the seeded rental on arrival. If any leaf has a weak/blank empty state, a non-land vertical's first moment stalls — and no test would catch it.
**Impact:** Neither for land/note (verified doors); potential trust-burn for the ~10 secondary verticals whose finish leaf I could not open exhaustively.
**Fix:** Add a per-vertical "finish leaf renders seeded data OR a purposeful EmptyState" check to `onboardingVerticals.test.ts` (render the leaf with a seeded fixture org, assert non-blank).
**Gate it:** Extend the existing test — baseline: 15 verticals, currently 0 assert leaf-content quality.
**Effort:** M
**Blast radius:** 1 test file + possibly several leaf pages.
**Confidence:** medium — routing verified; leaf content sampled only for maps/today/deals/finance.

---

## Coverage ledger

**Examined exhaustively (read in full or near-full):**
- `client/src/pages/onboarding-v2.tsx` (1,274 lines) — full read, click/field/decision count.
- `server/services/onboarding/sampleSeeder.ts` (792 lines) — full read, all 15 builders, exact lead counts.
- `client/src/lib/onboarding-verticals.ts` finish-path map (all 15) + `tests/unit/onboardingVerticals.test.ts` (what it pins).
- `client/src/App.tsx` onboarding gate + HomeRoute + the 5-door routes + the finish leaf routes (verified real components, not redirects).
- `client/src/components/property-map.tsx` token/config gate + `map-engine.ts` in full.
- `client/src/pages/maps.tsx` empty/loading/error states (lines 1505-1673 read; token refs grepped).
- `client/src/pages/today.tsx` empty-state machine + persona-branched empty content (405-470, grep of full).
- `scripts/check-no-fabrication.mjs` (what the gate actually greps).

**Examined by sampling (grep + targeted reads, not full):**
- `deals.tsx` / `finance.tsx` / `pax.tsx` — confirmed presence of `Skeleton` + `EmptyState`/`QueryErrorState` imports and `isLoading`/`isError` wiring (all three door pages have them; deals=2 error-state refs, finance=4, pax=5). Did not read their empty branches line-by-line.
- Server sample-data route (`routes-organization.ts:1065`) and the `generateSampleData` delegation.

**Did NOT examine:**
- The finish leaf pages themselves (`/rehabs`, `/rent-roll`, `/leases`, `/permits`, `/redemption-clock`, `/money`, `/notes`) — whether each renders the seeded sample rows meaningfully on first arrival (see F-24-4). Only /maps and /today were opened for empty-account quality.
- `/sign/:docId` (`sign-document.tsx`, 468 lines) — this is a **counterparty's** path (seller/borrower arriving via HMAC link), not the signing-up customer's own day-one; GAPS Tier-0 #1 flags it as never-designed, but it is off the T5 first-value path. Left to T1/T2.
- AI-disclosure dialog copy/legal correctness (`AiDisclosureDialog`) — presence and blocking behavior verified; content not audited.
- The actual signup/auth step BEFORE onboarding (auth page, org creation) — assumed upstream of the onboarding gate.
- Runtime verification (could not boot the app); all findings are static.

## Constitution Collisions

**None.** F-24-1 reports code that *violates* the fabrication rule (a valid finding, not a collision).
My fixes stay within the constitution: F-24-2's suggested reroute sends the primary persona to
`/today` (an existing door, not a new nav entry); no finding proposes a new door, a marketplace/API
surface, money custody change, or a new AI destination. The five customer doors and the Map/Today
finish destinations are all pre-existing.
