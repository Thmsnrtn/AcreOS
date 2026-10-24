# Next moves

The running hand-off between sessions. Update it at the end of every session:
what shipped, what it measured, and the top next moves. Newest first.

## 2026-10-24 — Package D2, bulk wave 1 + identity/trust (partial), branch `claude/d2-bulk-wave1-identity-trust`

### What shipped (Muse audits; nothing merged from this lane)
- **D2a (code path only).** One statewide template, `server/services/landData/statewideCadastral.ts`, replaces the FL-only module. It streams page → normalize → spill-to-disk partitions (`streamingArtifacts.ts`). It uploads only when the state's dossier resolves every use class and the bucket confirms each object by HEAD bytes (`uploadFileAndConfirm`), so a run with no receipts is never reported as "ingested". The NC/WI/AR/MT jobs are seeded inactive (0288). IN, OH and TX refuse because their mappings are unseeded. Memory gate `scripts/d2-bounded-memory-gate.ts`, child capped at 448MB: 400k parcels peaked at 225MB, and a mutant that accumulates rows OOMs.
- **D2d.** Self-healing adapters (`server/services/openData/adapterRemap.ts`). On schema drift the adapter proposes a remap. It promotes the remap only if the golden county re-queried live reproduces its assessor values, and logs the attempt on `etl_runs.observation` (also on failed runs, via `runState.failureObservation`). The golden fixture moved to `shared/landData/golden/fl-golden-county.json` (Nassau, established). A file marked established with fewer than five verified parcels now yields no ground truth.
- **D2e.** `purpose_ledger` (0289) is append-only. DB triggers block UPDATE and DELETE, proven on real Postgres, and the DBA GUC is the only bypass. Without a purpose code there is no row, and without a row there is no read: `skipTracingService.trace` requires a receipt; skip-trace result reads are ledgered, and results are withheld where no purpose was recorded; the registry refuses `owner_info`/`skip_trace` without a receipt. Paid doors debit first and refund if the ledger write fails (compensation, not one transaction; held for COO). table-count 740 → 741.
- **D2g.** `GET /api/ops/data` (ops token, read-only) serves:
  - county coverage and statewide build status;
  - paid fall-through per 1k lookups (vendor-billed only);
  - warehouse-served lookups against the $0.001 target, with cost reported as "not measured";
  - remap rates;
  - purpose-ledger volume by surface.

### Not done, and why
- **No live runs.** This container's proxy denies the state GIS hosts, Regrid, USGS and ChatGPT, which blocks:
  - live D2a builds;
  - IN/OH/TN/TX discovery and the dossiers;
  - D2f sources;
  - D2h verification.
- **D2b/D2c not started.** The design docs (v1, v2, Amendment 2) are not in the repo. Open questions:
  - Do releases cover `parcel_snapshots` or the bucket artifacts?
  - Does APID extend `shared/landData/parcelCrosswalk.ts`?
  - ~3 new tables need approval.
- **TN.** The comptroller loader (`scripts/land-data/build-tn-showcase.ts`) still accumulates a whole county and needs the streaming rewrite.
- **TX.** No verified beachhead counties.
- **D2h.** Needs the research content in the repo.

### Next moves
1. Muse: answer the D2b/D2c model questions, the network access, and the debit/ledger transaction choice.
2. Bounded TN loader; then D2b releases, D2c APID/lineage, D2f one state end to end.

## 2026-10-23 — Package D1, data-sourcing foundation (bucket-independent parts), branch `claude/d1-data-sourcing-foundation`

### What shipped
- **D1a.** The Regrid cost table is at the published per-record floor (10¢ Standard / 15¢ Premium), and an empty answer or a free-source answer now costs 0. The credit-weight re-base was held at first (D1 stop condition): weights are what a customer's pool is debited, so changing them changes price. The founder decided it on 2026-10-23 (`b576d53f`): `parcel_lookup_paid` 8→10, `owner_lookup` 8→15, `valuation_lookup` 10→15, so no lookup weight sits below Regrid's cost.
- **A3.** `provider_lookup_log` gains `intent_class`, `answering_layer` and `confidence_served` (migration 0287), and the registry writes them on every path. A row with an org is that org's demand event. There's no reader yet.
- **D1c + A4.** `statewide_layer_metadata_v1` makes two metadata calls per statewide layer and reports drift against the last poll, the last ingest and the documented cadence. The orchestrator's new `finalize()` writes `etl_runs.observation` once per run, so the runs form an append-only snapshot series.
- **A2.** Every statewide row carries a dossier and a derived policy block. Every block is restrictive, because no terms were read.
- **D1b + A1.** `fl_statewide_cadastral_v1` refuses on a missing mapped field, an unbounded run, or an unverified county field. It writes canonical records with per-group provenance and decay class, GeoParquet and PMTiles locally, and `uploaded:false` receipts. It is never "ingested" without bucket-confirmed receipts and resolved use classes.
- **A5.** `tests/fixtures/golden/fl-golden-county.json` (moved in D2 to `shared/landData/golden/`) has five honest pending slots, and a CI harness checks them.
- Both jobs are seeded **inactive**.

### Not done, and why
- **Not run against live data.** The build container's network policy denies the state and Regrid hosts, so none of the live parts ran: the FL dry run, the 5-parcel spot check, the golden-county values and the live poll. They need a session that can reach `services9.arcgis.com`, `geodata.floridagio.gov`, `floridarevenue.com` and the other statewide hosts.
- **Design docs not in the repo.** `files/data-sourcing-intelligence-*.md` weren't available, so the D1 package text was used. The assumptions (Layer names, §12 use-class mapping, §8 RCW section) are noted in the code.

### Next moves
1. In a session that can reach the hosts:
   - run the FL dry run on one county;
   - fill the five golden slots from the county appraiser;
   - read the nine terms pages into the dossiers;
   - arm the poller.
2. D2 (TN county ingest) and D3 (delta ingest + `lastIngestedAt` per source).

## 2026-10-21/22 — Readiness packages 1–5 and the PR train (implementation lane; Muse audits and merges)

### Merged to main (main = 14748ed7 at 2026-10-22 03:40Z)
#388 (follow-redirects + vite advisories), #389 (entry chunk under budget),
#390 (letter-render launch timeout), #392 (Package 2, CAM FKs), #393
(Package 3, desktop-feel harness auth), #394 (Package 1, one org per signup),
#377 (transfer tax from statute), #391 (ops/ledger/kill-switch routes before
the /api catch-all).

### Refreshed onto main, waiting on CI and Muse (do NOT merge from this lane)
- **#395 Package 5, refund posting** — head 8d3d8ed0, 17/17 green. #394's
  restructure merged textually clean but put the chart-of-accounts seed
  OUTSIDE `if (provisioned.created)`; moved inside, after the `!isFounder`
  block (founders get charts). `chartOfAccountsSeedCallSite.test.ts` parses the
  file and fails on git's auto-merged version. Muse verified the carry.
- **#378, #380–#383, #385–#387** — each a merge of main with its port files
  equal to main and ratchets set from `--measure` on the merged tree (as-any:
  #378 → 1061, #381 → 1058; everything else at baseline). #382/#387
  migrate.mjs checked line-by-line against the merge base (both sides kept).
- **#379** — head 734c0f01 (merge of 14748ed7, as-any → 1062); draft, Muse
  marks ready. **#384** stays held until #379 merges (stacked; routes-elite-
  features.ts needs a semantic merge).
- **Package 4, canonical uuid ids (this branch).** The 14 parents and their 40
  child columns are uuid in shared/schema; KNOWN_DB_PUSH_MISMATCHES (38) is
  gone; `CONVERGE_UUID_ID_FAMILIES` in migrate.mjs converts a db:push-built
  database in place (no-op on prod). Evidence on 14748ed7: db:push of main vs
  this branch into scratch DBs differs in exactly 54 columns, all varchar →
  uuid (14 ids + 40 children), 738 tables / 656 FKs both sides; 0 of 648
  schema-declared FK columns mismatched; full suite 18,284 green with realdb.
  Refreshed onto post-train main bd35343b (2026-10-24): `npm run check` exit 0
  (no baseline moved), full suite 18,713 green, `db:build-from-repo` PASS on
  a fresh Postgres 16 with the 14 ids and the CAM trio's `lease_id` (cam_reconciliations,
  commercial_sales_reports, lease_rent_schedule) uuid with live FKs, and the
  convergence test 4/4 against real Postgres. The stale "STILL UNRESOLVED"
  note on the CAM block in migrate.mjs now records the resolution.

### Found, not fixed (needs a person)
- **npm's audit service is failing** (2026-10-22 ~02:35–03:20Z: 503, then 400
  "this endpoint is being retired. Use the bulk advisory endpoint"). npm
  Dependency Audit (and Security Gate with it) went red on #381, #382, #385;
  the same gate passes locally once npm answers. Needs "Re-run failed jobs" —
  this session's token gets 403.
- **The audit gate reads an audit that never ran as "0 vulnerabilities"**
  (`scripts/npm-audit-gate.mjs` never checks the report's error key). It went
  red tonight only because the accepted list is non-empty; with an empty list
  it would pass green over no scan. Security Gate then says "found critical
  vulnerabilities" when none were found. Proposed to Muse as its own PR.
- **drizzle-kit push exits 0 when a statement fails** — onto an unconverted
  varchar database ("cannot be cast automatically to type uuid"), and onto a
  database missing pgvector ("type vector does not exist"). Staging must
  converge through `migrate.mjs --ddl-only` (the nightly reconcile) before any
  manual db:push; noted in scripts/setup-staging.sh.

### Top next moves
1. Muse merges the refreshed train; re-check each remaining PR with
   `git merge-tree` after every merge, refresh only what conflicts.
2. After Package 4 merges, confirm the next staging-schema-reconcile run logs
   `OK: DO $uuid_ids$` and staging's 14 parents read uuid.
3. D1 (data sourcing: Regrid true cost, Florida bulk ETL, change-detection
   poller) — waits for Muse's spec.

## 2026-10-21 — Customer Journey Audit, next layer (issue #359), branch `claude/cj-journey-next-layer`

### What was wrong (each verified by running it locally against a production build)
- **One signup became several orgs.** A new user's first screen fires its
  queries in parallel and each reached `getOrCreateOrg` with no org: 5 orgs in
  23 ms for one user locally. `getOrganizationByOwner` had no ORDER BY, so an
  UPDATE (finishing onboarding) moved the resolved org and the next request
  landed in a fresh, un-onboarded one — /today bounced back into the wizard
  ("no first-value CTA"). The same race ran the signup rate limit once per
  request (5/email/hour), so a new user's own first page could 429 itself.
  Fixed: per-process coalescing + per-user advisory lock with re-check, and
  oldest-org resolution. Test: `tests/integration/orgProvisioningIsSingular.db.test.ts`.
- **"Transition was skipped" page errors**: `client/src/lib/view-transitions.ts`
  discarded the ViewTransition; skips now handled, real failures still
  reported once. Test: `tests/unit/viewTransitionSkipIsHandled.test.ts`.
- **The staging E2E token path was not exempt from the per-user rate limit**
  (the local flag always was): one synthetic user walking 9×2 viewports spent
  300/min and 429'd its own /today. `isE2eTestTraffic` now exempts both; never
  true in production (no token there). Test: `tests/unit/e2eTokenTrafficSkipsUserRateLimit.test.ts`.
- **Harness**: token now sent on every same-origin request (documents too —
  without it a document gets Clerk's handshake redirect), service workers
  blocked for CJ1 (SW-reissued /api requests lost the token), the consent
  banner is answered, and the config no longer leaks the token as
  `x-e2e-test-auth` to every origin.
- **A decorative gate found on the way**: CJ1's "clickwrap" check matched the
  cookie banner's "Privacy" text on bare /auth (sign-in, which has no
  clickwrap). It now opens `/auth?mode=register` and reads the ToS checkbox.

**Measured (local, production build, 12 Chromium projects, CI retries):**
before 2 expected / 6 flaky / 4 red (15 attempts "no first-value CTA", 6
click timeouts, 5 orgs for one user, 148 429s); after 12/12 passed on the
first attempt, 1 org, 0 429s, 0 page errors.

### Not verified here
- WebKit (iPhone projects): no WebKit build in this sandbox. The "composer
  missing on /ai" class is WebKit-only in CI; the next CI run is the check.

### Top next moves
1. Dispatch the audit on the branch; if iPhone stays red, read its
   error-context artifact before changing anything.
2. Count production users owning more than one org (counts only) — the race
   predates this fix; merging duplicates is a founder decision (customer data).
3. The consent banner covers the onboarding Continue button at 360 px — design call.

## 2026-10-21 — #386 amended to land-only (COO ruling under the founder's delegation)

- Land released; buy-and-hold is NOT. Its decision route
  (`server/routes-buy-and-hold-underwriting.ts`), page
  (`client/src/pages/rentals/underwrite-rental.tsx`), nav entry and spotlight
  module are removed from #386 and kept intact on
  `claude/buy-and-hold-underwriting` for a later PR gated on end-to-end journey
  evidence in the Readiness Atlas. The `rental_acquisition` engine stays as a
  calculator: it records nothing on its own, so buy-and-hold measures below
  `decided` and the demotion law requires its `beta` claim.
- `PUBLIC_CLAIM_DEMOTIONS` 11 → 12 entries (buy_and_hold restored); overclaim
  baseline 12 (main 13); ladder entry `surfaced`.

## 2026-10-20 — V0 vertical program re-applied (staged, not committed)

### Staged on `claude/recover-v0-vertical-program`
- Stranded commit `6f6c65f4` (V0: evidence rule v2, underwriting kit, land and
  buy-and-hold released) re-applied onto main. Its defects were renumbered
  because main had issued 0285–0288 meanwhile: 0285 → **DEFECT-0290**,
  0286 → **0291**, 0287 → **0292** (0289 reserved by another branch).
- One vertical rule, not two: `shared/governance/evidenceLadder.ts` no longer
  restates the OD-5 demotions by hand. Each vertical entry states one readiness
  tier and its claim/caveat derive from it; `verticalReadiness.test.ts` pins the
  ladder to the measured tier, the demotion map and the gradeable set
  (mutation-checked). Land and buy-and-hold now read "closes the canonical loop";
  subdivider carries "decided, not yet gradeable".
- New wall-clock reads from the stranded commit converted to `clock`.

**Measured:** targeted vitest 50 files (routeManifest run twice) / 776 test runs green; lint:reachability,
clock-reads, no-fabrication, boundaries, browser-safe-shared, org-fetch exit 0.
`npm run check`, the full suite and the build were NOT run (memory limits).

### Top next moves
1. Run `npm run check`, full `npm test` and `npm run build`, then an
   independent audit of the re-applied wave before committing.
2. DEFECT-0292 (acquisition-cost wording vs `total_cost`) is a founder-visible
   product choice.

## 2026-10-19 — Open Fieldstone items closed (Muse)

### Shipped to main
- **Company branding editor.** Settings → Organization now has a Company
  branding card: accent color (picker + hex, 6-digit validated), logo URL
  (absolute http(s), live preview), density (compact/comfortable/adaptive).
  Writes go through PATCH /api/tenant-theme (owner/admin only, enforced
  server-side); everyone else sees it read-only. Reset-to-defaults clears all
  three back to the theme. Test: `tests/unit/brandingEditor.test.ts`.
- **Accessibility prefs follow the person.** `/api/me/preferences` now accepts,
  validates, and deep-merges an `accessibility` blob (same JSONB column as
  appearance); the client hydrates from the server on login and debounced-PATCHes
  changes — the same pattern as appearance in theme-context.tsx. localStorage
  stays the fast-boot cache. The stale header comment about the non-existent
  `use-sync-accessibility-prefs` hook is corrected.
  Tests: `tests/unit/accessibilityPreferencesSync.test.ts` (15 tests).

**Measured:** new unit tests 15/15 green; appearanceContract + tenantKey
suites still green (56 tests); tsc clean on changed files.

### Top next moves

1. Then resume the 2026-10-18 list below (land the waiting branches; time to
   first deal; every paid action covers its cost).

## 2026-10-18 — Fieldstone redesign (`claude/fieldstone-redesign-q48nuj`)

### Built, on a branch with a draft PR, waiting for founder review

The approved Fieldstone redesign (founder decisions recorded in
`founder-decisions-2026-10-18-fieldstone.md`), implemented in the real app:

- **Three colorways, one product.** Fieldstone (default), Bedrock, Meridian ×
  Light / Dark / Match device, from one contract (`shared/appearance.ts`) read
  by both pickers, the boot script, the server and the gates. Retired themes
  migrate (Homestead → Bedrock, others → Fieldstone) with no customer row
  rewritten.
- **Appearance = Colorway + Display.** Font, density, motion and list-style
  pickers retired; Accessibility & comfort is its own section and owns reduced
  motion (the device setting is now honoured — it was being switched off).
- **One mark** across the app, auth, public pages and every installed icon /
  launch image (regenerated, reproducible from the manifest and index.html).
- **Fixed on the way** (each with a test that fails without the fix): undefined
  `--card-border` (every card outline was the text colour), `useIsMobile()`
  used as a boolean in four components, dialog close buttons dropped to the
  bottom, Today's section spacing lost on phones, the Map toolbar overlapping
  on phones, Finance's heading below its cards, the banner hidden under the
  rail, and — found by the independent review — the deploy-time migrator that
  would have deleted every Homestead user's choice on the next release.

**Measured:** `npm run check` exit 0; `npm test` and `npm run build` results are
in the PR. Real-app screenshots (production build, E2E test auth, seeded
fixture data) for all 6 colorway × mode combinations at desktop and iPhone,
plus 320px and tablet spot checks, are under `docs/design/fieldstone/`.

**Entry-chunk budget:** CI's Build job measured the entry chunk at 747 KB against
the 745 KB ceiling in `scripts/bundle-budget.json` (CI reads ~6 KB higher than a
local `NODE_ENV=production` build of the same tree, so `main` sits close to the
line there). The ceiling was not raised. The quick-appearance dialog now
lazy-loads its pickers, which takes the entry chunk below `main`'s own
(local: 755.0 KB on the branch, 756.2 KB on `main` at `e413ab6`).

**Not verified here:** the logged-out landing and sign-in pages (no real Clerk in
this environment — the public server answers the Clerk proxy's 502, and test
auth has no logged-out identity); real map imagery (no map key locally); real
Safari on an iPhone.

### Top next moves

1. **Founder review of the Fieldstone PR** — look at the screenshots, try the
   three colorways on the phone, then merge and run the manual deploy.
2. **Company branding editor.** Org accent/logo are applied safely now, but no
   UI sets them (only the API). Put a small editor under Settings → Organization.
3. **Accessibility prefs follow the person.** They live only in this browser;
   the sync hook the context's header mentions does not exist. Store them with
   the account like appearance.
4. Then resume the 2026-10-18 list below (land the waiting branches; time to
   first deal; every paid action covers its cost).

## 2026-10-18 (earlier sessions)

### Built, on branches, waiting for review and merge

| Branch | What it does |
|---|---|
| `claude/billing-entitlement-truth` | Seats: plans include their seats without support; add-on billing counts only seats past the included ones. One plan table. Included Pax turns charge no credits; past the allowance, purchased credits or an own key fund turns; background AI jobs follow the same rule. |
| `claude/lead-to-deal` | "Make this a deal" on a seller lead: creates or links the property and the deal in one transaction; idempotent; honest refusal when parcel facts are missing. |
| `claude/persona-vocabulary` | Deals and Finance use each persona's vocabulary; route hiding matches by path in every nav surface. |
| `claude/route-load-performance` | Map code loads only on Map; quick-add sheet loads on tap; build-graph gate. Mobile door pages download about 1–1.7 MB less JavaScript. |
| `claude/isolation-sweep-in-ci` | By-id isolation sweep runs in CI; the public log carries counts only; empty runs fail. |
| `claude/sim-followups` | Statement portal answers 503 when unconfigured; `phone_normalized` declared as the generated column it is in production. |
| `claude/declared-uniques-enforced` | Migration 0281 creates the 17 declared unique constraints idempotently (warn and skip, never fail a deploy); founder-org diagnostics on `/founder/readiness`. |
| `claude/house-mail-option` | Physical mail via AcreOS house mail (purchased credits only, priced above cost + card fees + margin) or the org's own Lob key. |

Each needs: an independent review, a merge of current `main`, then a PR.

### Remember

- Production deploys are manual now (Actions → "Deploy to Fly.io"). Merging
  to `main` does not change production.
- The 2026-10-17 repricing needs new Stripe prices and updated Fly secrets
  before checkout charges the new amounts.

### Top next moves

1. **Land the branches above** (review → merge main → PR → founder merges →
   manual deploy).
2. **Time to first deal.** Re-run `tests/simulation/campaign/lifecycle-90-days.ts`
   and remove each stall: new parcels start with `land_status` "unknown",
   which blocks offer letters; double-submitting "Add lead" in the browser can
   create duplicates; `/api/trial/status` reads wrong for a fresh org.
3. **Every paid action covers its cost.** Apply the house-mail rule (price ≥
   cost × card fees × margin, purchased credits, refuse unknown cost) to skip
   tracing and paid data lookups; add a founder view of margin by action.
4. **Close the remaining simulation findings:** the team list returns more
   than viewer roles need; 137 by-id routes the isolation sweep cannot probe
   yet; real (non-simulated) send credit charges are not exercised end to end.
5. **The unverified ground** (`docs/testing/verification-plans/`): real Safari
   on iPhone, Stripe test mode end to end, Twilio/SES/Lob sandboxes,
   backup-and-restore drill, load at 1,000 organizations.

### Waiting on the founder

- Current Lob prices for every mail spec (to confirm the house-mail cost table).
- Whether to unify the two house-mail price lists, once real Lob prices are in.

## 2026-10-20 — Lead imports keep the parcel facts (`claude/p4-csv-import-keeps-parcel-facts`, uncommitted)

### Built (working tree, not committed)
- **One parser module, every import path.** `shared/leads/parcelFacts.ts`
  reads ACREAGE, ASSESSED value (county), ESTIMATED value (market) and
  TAX-DELINQUENT status (flag, amount owed, years) — refuse-not-fabricate:
  "N/A" / blank / garbage / a county 0 are null, never 0; a positive amount or
  years count implies delinquent. Used by POST /api/leads/csv-import,
  POST /api/leads/import/tax-delinquent, importLeads() (POST /api/leads/import,
  /api/import/leads + its background job) and processTaxDelinquentImport();
  header rule shared by the Smart CSV sheet and the tax-delinquent importer.
- **Migration 0286** (+ migrate.mjs mirror): `leads.assessed_value`
  numeric(14,2), `tax_delinquent_amount` numeric(12,2), `tax_delinquent_years`
  integer. Assessed ≠ estimated, never one written into the other.
- **Lead detail Parcel card**: property address, APN/county, acreage,
  "Assessed value (county)" vs "Estimated value", tax delinquent / owed / years.
- **Fixed on the way:** the Smart CSV sheet's `parseCsv` stripped quotes before
  splitting cells, so any quoted comma ("$45,000", "SMITH, JOHN") split a cell
  and shifted the row.

**Measured:** new tests `leadImportKeepsParcelFacts` (44) +
`leadCsvImportParcelFacts` (8); 31 related files / 556 tests green; 12
mutations all red. Lints schema-migrate-mirror / schema / ghost-fields /
measurement-defaults / reachability / no-fabrication / org-fetch exit 0;
ratchet measure at baseline. NOT run: npm run check / tsc / full suite.

### Next
1. Run `npm run check` + full suite on a machine that can, then commit.
2. processTaxDelinquentImport() still has no production route
   (`/api/import/tax-delinquent` is named in a 404 hint but never mounted).
3. The synchronous `/api/import/:entityType` path ignores a `fieldMap` the
   job path honours (no client sends one today).
