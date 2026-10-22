# Next moves

The running hand-off between sessions. Update it at the end of every session:
what shipped, what it measured, and the top next moves. Newest first.

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
