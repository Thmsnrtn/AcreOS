# Pre-launch simulation campaign — AcreOS and Foundry

**Run:** 2026-10-05 → 2026-10-06 · **AcreOS:** `main` @ `d2f46b3`, production build, local Postgres 16 + Redis · **Foundry:** `claude/foundry-v3-north-star-finish-vxq2ea` @ `49a837c`, re-confirmed on `6ac66fb` (the two commits between touch no file behind a finding).

Every claim below was verified against code, not against a sim's own report. An independent auditor that built none of the sims re-checked the top findings and found four holes in the campaign itself; each is fixed and re-run, and its corrections are folded in. Where something could not be verified, this document says so.

## Verdict

**AcreOS is not ready for public launch, and the distance is short and well-defined.** Two defects stop the ship: a tenant-isolation defect (reported privately to the owner and not described here until it is fixed), and a payments table that cannot record a single note payment on a database built from this repository. More P1s sit on money, compliance, roles and security. Everything else that a launch depends on held under real pressure: 284 by-id routes probed with zero other breaches, exact credit and usage arithmetic, signed-webhook verification, Redis loss, a Postgres restart, 150 concurrent users with zero errors, 30 personas on 12 device profiles with zero breakage.

**Foundry holds up as an institution and strains as a daily experience.** Over 1,080 lock-respecting routine runs across 30 simulated days, 35 of 36 routines never failed for a code defect; Stop-everything held for 30 mornings; Stripe events recorded exactly once under replay, tampering, staleness and ten-way concurrency; a dead model door stayed inside its spend cap and never leaked a provider message. What breaks is smaller and closer to the owner: the job lock does not exclude a second run in the same process, Home can answer 503 on the very first visit, and the one thing that needs him is never on the first screen — on any device, on any day.

### Readiness scorecard

| Dimension | AcreOS | Foundry | Evidence |
|---|---|---|---|
| Tenant isolation | **Fail** (reported privately) | n/a (one owner) | 457-route sweep, live proof |
| Money correctness | **Fail** (payments, bookkeeping units) | Pass | lifecycle, entitlements, Stripe replay |
| Compliance (TCPA/CAN-SPAM) | **Fail** (email to DNC) | n/a | lifecycle |
| Roles and permissions | **Fail** (VA scoping) | n/a | entitlements matrix |
| Billing meters and walls | Pass | n/a | entitlements |
| Resilience | Pass | Pass | chaos, model door, panic |
| Load | Pass (to ~145 req/s/instance) | Pass | loadConcurrency |
| Accessibility | Needs work | Needs work | axe on every page |
| Mobile ergonomics | Pass (contracts) / polish | Needs work | mobile contracts, owner walk |
| Operability | Needs work | Pass | boot logs, health body, chaos |
| Gate honesty | Needs work | Needs work | four gates measured the wrong population |

## Stop-ship — AcreOS

### Security findings — reported privately
This repository is public. One P0 tenant-isolation defect, proven live, and three P1 security findings are described only in the private report sent to the owner, and will not be described here until they are fixed.

### P0 · No note payment can be recorded on a database built from this repository
`migrations/0023_payment_race_condition.sql:9` creates a **partial** unique index on `payments.transaction_id`; every payment insert uses `onConflictDoNothing({ target: payments.transactionId })` with no predicate (`portalPaymentPosting.ts:394`, `achAutopay.ts:1264`, `:1375`), and Postgres cannot match a partial index to a bare `ON CONFLICT`. Result: `POST /api/payments`, borrower-portal payments and ACH autopay all 500. A database built by `drizzle push` gets a full constraint and works, so **production may be unaffected — that could not be checked from here** — but staging, any disaster-recovery rebuild, and every CI database built from migrations are. Every test of this path stubs `onConflictDoNothing`, so it has never run against a real schema.
**Fix:** a migration that replaces the partial index with a full unique constraint (Postgres treats NULLs as distinct), plus one integration test that inserts a payment into a migration-built database.

### P1s
- **Email campaigns go to do-not-contact leads.** `send-email` filters recipients only on "has an email" (`routes-campaigns.ts:2034`); `emailService.filterSuppressed` reads only `email_suppressions`. An SMS "STOP" sets `doNotContact` meaning *all channels* (`smsService.ts:571`), and email ignores it. Measured: 5 of 5 DNC leads received the campaign. The same loop ignores `sendEmail`'s `{success:false}`, so failed and suppressed sends are charged, recorded as delivered, and never refunded.
- **The VA role does not work end to end.** A VA invited the normal way sees every lead (`team_members.view_only_assigned_leads` is `NOT NULL DEFAULT false` and overrides the role default for va and viewer, `permissions.ts:295-299`); `/api/me/permissions` reports that false value as the truth; no representation of `assignedTo` is accepted (validated as a `users.id`, stored as a `team_members.id`, `orgScope.ts:159`); and a correctly scoped VA cannot edit the leads assigned to them (`assignedLeadGate.ts` compares an integer with a uuid). Lead assignment is unreachable from the API.
- **Bookkeeping is wrong twice.** Net P&L shows `$NaN` for every organization, because the page expects fields the server never returns (`bookkeeping.ts:726-736` vs `bookkeeping.tsx:28-35`). And interest and principal display and export at **1/100th** of the real amount: the server already returns dollars and the page divides by 100 again (`bookkeeping.tsx:69-70`, CSV at 97-104). A note investor would hand their accountant interest income a hundred times too small.
- **Enrichment without coordinates is a 500**, not "add coordinates first" (`propertyEnrichment` throws; the route maps every throw to `Errors.internal`).

## Foundry — what breaks

- **P1 · The job lock does not stop a second run of the same routine in the same process.** `job-lock.ts:10` keys ownership on one `INSTANCE_ID` per process, so a holder re-acquires its own lock; the second run's `finally` then deletes the first run's lock, exposing it to other instances too. An hourly routine that overruns, or the boot catch-up firing during a tick, double-executes. Pinned as `it.fails`.
- **P2 · Home answers 503 "I can't reach my own records" on the owner's first visit** when two requests arrive together (phone and laptop, a prefetch). `markVisit` (`services/founder/what-changed.ts:45-55`) reads, then inserts with no conflict clause. Reproduced deterministically: three simultaneous first visits returned 200, 503, 503. One-clause fix: `ON CONFLICT(founder_id) DO NOTHING`. Pinned as `it.fails`.
- **P2 · A hung model door costs 6+ minutes per call with nothing owner-visible** until the routine ends (measured: 3 attempts at the client's timeout; the 120 s default makes it ~363 s per call, and the forge makes several).
- **P2 · Resuming after Stop everything erases the only record that the estate was ever stopped.** While paused, reason, who and when are held on the Workshop row; `resumeEconomicActivity` nulls all three and `stopEverything` writes no audit row. Pinned as `it.fails`.
- **P2 · The runtime auth dependency is deprecated and flagged.** `npm audit`: 1 critical + 11 high, including `@clerk/clerk-sdk-node` via `@clerk/backend` → `js-cookie` (cookie-attribute injection). The vitest/vite criticals are dev-only.
- **P3 · Home names "a routine failed" but never the model door, its credit or its key**; only Controls reads `productionFacts`. Pinned as `it.fails`.

## What held

These are results, not absences of evidence; each was driven to the point where it could have failed.

- **Isolation, outside the privately reported defect:** 457 by-id routes enumerated, 284 probed with forged rows in two tenants, 216 clean rejects with working positive controls, every remaining "2xx to a foreign id" traced by hand to an org-scoped `WHERE` (empty result, no data). Original 8-type IDOR fuzz: 0 breaches.
- **Money meters:** credit arithmetic exact (refusal before deduction; 100¢ → 100 sends → 0¢; one ledger row); usage meters equal database counts at every checkpoint; every tier wall at its documented number; paused and dunning orgs read but cannot write.
- **Webhooks:** unsigned and forged Stripe events rejected (AcreOS); signed Stripe events recorded exactly once under replay ×5, tampered body, 10-minute-old signature and ten-way concurrency (Foundry). A forged inbound-email signature got 401 and a forged Twilio signature 403; a replayed inbound email (same Message-ID) was deduplicated.
- **Compliance rails that did hold:** an SMS "STOP" set the lead to do-not-contact and the next SMS send excluded and named it; a 12% note on an Arizona parcel was refused at the 10% usury limit; a closed deal could not be moved back to negotiating; recording a payment requires an `Idempotency-Key`.
- **Resilience:** Redis loss caused zero errors; the app recovered from a proven Postgres restart in 2.4 s without a process restart.
- **Load:** 5,000 leads under 40 and 150 concurrent users, zero 5xx, p95 701 ms and 1,613 ms. Latency scales linearly with concurrency, so per-request CPU — not the database — is the ceiling (~110–145 req/s per instance on 4 shared cores). Comfortable for the expansion ladder's horizon.
- **Devices:** 30 personas across 12 device profiles walked all seven doors with no hard breakage — no 5xx on a product path and no founder-codename leak (the only console errors came from billing being unconfigured); mobile-feel contracts 105/105 at iPhone, Pixel and iPad sizes.
- **Foundry's month:** 35/36 routines clean for 30 days; a deliberately silenced routine was named on Home and the absence page in the owner's words; Stop held for 30 mornings with exactly one message (already at the provider) leaving after Stop; model-door spend stayed under its cap with the provider's message never shown.
- **Hygiene:** server logs mask lead emails and phones; a 2 MB body is refused with 413; unknown `/api` paths answer a JSON 404; a 100,000-row request is capped server-side.

## Elevating the customer experience (AcreOS)

1. **First-run credibility.** A new org's first Pax message is a 402 "Insufficient credits" with no path to credits in the response; a pro org cannot invite its first teammate (default `seat_count=1` versus the 2 seats pro includes); the free tier allows zero campaigns. Each is defensible alone; together they are a first week of walls. Seed trial credits, align seat defaults with the tier, and say what unlocks what.
2. **Limits should read as limits.** Every plan-limit 429 says "You're sending requests faster than the system can handle"; the upgrade path lives only in `details`. Say "You've reached 50 leads on Free — Starter allows 250."
3. **The list import every land investor has.** A UTF-8 BOM + CRLF CSV — Excel on Windows, most county exports — is refused as "Unable to determine file type"; imports cap at 500 rows with "please split into smaller files". Accept the BOM and run large files as a background job.
4. **Workflow seams.** No lead→deal conversion (a deal needs a property record first); ISO date strings are refused for `closingDate`, `consentDate` and `sentAt`, so closed deals carry no closing date and fall out of the P&L, and TCPA consent is stored with no consent date; offers never stamp `sent_at`/`responded_at`; dunning says "Reminder sent successfully" while the row is `queued` for want of a connected identity. These are the details that make reports wrong months later.
5. **Persona promise.** Vocabulary defined for note, tax-lien and wholesale personas does not appear on Deals or Finance for 17 of 30 personas; a note servicer reads land-investor words. CLAUDE.md promises persona changes the content behind each door — today it mostly changes the nav.
6. **Accessibility.** axe on every page: missing button names on 9 routes, invalid ARIA values on Inbox and Tasks (one shared component, likely), missing form labels, and serious contrast failures on 36 routes. Touch targets under 44 px on 30+ route×viewport combinations, worst on Leads (10).
7. **Speed perceived.** On localhost (no network), median LCP is 1.4–1.7 s and p90 2.5–3.6 s; Maps reaches 5.2 s on Pixel 5. A median page view transfers 548 KB of JavaScript, and the map vendor chunk is 1.8 MB. Real networks will add to every number.
8. **Degrade quietly.** Settings fires `GET /api/stripe/products` and logs a console error for every persona when billing is unconfigured; feature-flagged routes render a generic "Not Found" instead of "not available yet".
9. **Defaults that block.** Offer letters are refused for every new parcel until its land status is verified (deliberate and good), but the refusal calls an unverified parcel "Federal trust property", and the update path silently stores invalid values such as `fee_simple`, which keep it blocked forever.

## Elevating the owner's experience (Foundry)

1. **Put the one thing on the first screen.** Home's "one thing that needs you" card was below the first viewport on every device and every simulated day: top at 851–920 px on phones (667–844 px screens) and 1,185–1,392 px on desktop. Home itself carries ~720–774 words and 52 controls on a phone.
2. **Cut the reading.** The heaviest phone pages on day 39: an experiment decision page at 2,506 words, Controls 1,425, Absence 1,274, Needs-you 1,126 (29 controls). The median page is 189 words — the institution can be brief; the pages where he decides are where it isn't.
3. **Tap targets.** 33 phone page-views had controls under 24 px and many more under 44 px; the recipients page has 49 under 44 px, Settings 28.
4. **Dead tabs.** A company's Economics, Customers, Experiments and Evidence tabs each bounce back to the company page; `/foundry/decisions` bounces to Needs-you. Either make them real or remove them.
5. **Say what broke, not which routine.** When the model door is down, Home says a routine failed. Name the door, the credit and the key, as Controls already does.
6. **The human-review artifact is stale.** `npm run sim:golden` still renders "what Maya reads over coffee" about a 40-seat Meridian contract — the retired commercial persona — so the one artifact meant to judge the Letter judges a product that no longer exists. `sim:walkthrough` and `sim:golden:ai` point at deleted files.

## Gates that measured the wrong thing

The repo's third law, in this campaign's own data:

- **`npm run test:simulation` is vacuous.** Its helper signs up through `POST /api/auth/signup`, which returns 403 under Clerk, and every case early-returns without a session. A green simulation gate that exercises nothing.
- **The IDOR fuzz reads 8 resource types; the population is 457 routes.** This campaign's own first sweep read 180 because its route regex accepted only `app|router|r` receivers while 940 registrations use `api.` — the auditor caught it, and the sweep now has a population floor and a second detector rule (a response stamped with the victim org's id) that was falsified against a real defect before being trusted.
- **`rawSqlColumnsExist` cannot read upserts.** Its `TABLE_REF` regex takes `DO UPDATE SET` as a table named `set`, so every upsert lands in the "unresolved" budget instead of being column-checked.
- **`check-db-column-mirror` checks columns, not constraints** — which is how a partial index broke every payment insert while the schema gate was green. Constraint-name drift (`_key` vs `_unique`) also makes `drizzle-kit push` non-idempotent on a migration-built database.
- **`route-sweep.spec.ts` lists `/negotiation`,** which no longer exists; the hand-kept list has drifted from the app.
- **Foundry's full-surface crawl reports "Findings: 0" over ~30% of the surface:** `:id` pages are never filled with real ids, a 503 Home counts as a pass, and its seeded founder email does not match the owner email, so the Workshop is only ever seen as a 403.
- **Two `/api/documents/generate` handlers exist;** the template-driven one is unreachable because of mount order, and `lint:route-shadowing` does not see it.

## What this campaign did not exercise

Stated so nobody mistakes a green here for coverage it did not have:

1. **Real Safari.** The container has no WebKit; iPhone and iPad sizes ran under Chromium, which proves layout, not Safari's engine.
2. **Real Clerk auth** — sign-up, MFA, session expiry, org switching. Everything used the test-auth cookie.
3. **Third-party sandboxes** — Stripe test mode end to end, Twilio, SES, Lob, OpenRouter with real keys.
4. **The production database.** Whether production carries the partial or the full payments constraint is one SQL query away and could not be run from here.
5. **Scale** — 1,000 orgs, 100k leads, pool exhaustion, crons under load.
6. **Backup, restore and migration rollback.**
7. **Email deliverability** — SPF/DKIM/DMARC on BYO identities, one-click unsubscribe, the bounce → suppression → DNC loop.
8. **Assistive technology** — VoiceOver/NVDA and keyboard-only flows; axe is necessary, not sufficient.
9. **POST by-id isolation, SSRF on enrichment,** and time-zone/DST edges for late fees and crons.
10. **Everything after the first payment** — late fees, payoff, 1099s with real data — because no payment could be recorded.

## Recommended order

1. Fix the privately reported security findings; the P0 within the day.
2. Run `SELECT indexdef FROM pg_indexes WHERE indexname = 'payments_transaction_id_unique'` on production; then add the full-constraint migration regardless.
3. Honor `doNotContact` in email sends and use the send result.
4. Fix the VA path as one change: default the per-user flag from the role, validate `assignedTo` as a team-member id, compare like with like in the write gate.
5. Fix Bookkeeping's contract and units, with a test that renders a known payment.
6. Foundry: `ON CONFLICT` in `markVisit`, a per-acquire token in `job-lock`, an audit row for Stop and Resume, and move the one thing above the fold.
7. Make the vacuous gates honest: retire or rewire `test:simulation`, widen the IDOR population into CI using this campaign's sweep, teach the column mirror about constraints.
8. Then close the coverage gaps above, starting with real Safari and real Clerk on staging.

## Running the suite

AcreOS (local production build, E2E test auth; never valid against a deployed instance):

```bash
bash scripts/ci/build-schema-from-repo.sh              # DATABASE_URL → empty Postgres 16 with pgvector
E2E_TEST_AUTH=1 … node dist/index.cjs                   # env as in .github/workflows/e2e-mobile.yml
DATABASE_URL=… npx tsx tests/personas/seedDb.ts
SIM_BASE_URL=http://localhost:5050 DATABASE_URL=… npx tsx tests/simulation/campaign/idor-sweep.ts
SIM_BASE_URL=… DATABASE_URL=… npx tsx tests/simulation/campaign/robustness.ts
SIM_BASE_URL=… DATABASE_URL=… npx tsx tests/simulation/campaign/entitlements-and-billing.ts
SIM_BASE_URL=… DATABASE_URL=… npx tsx tests/simulation/campaign/lifecycle-90-days.ts
SIM_BASE_URL=… SIM_ENV_FILE=… SIM_START_SCRIPT=… npx tsx tests/simulation/campaign/infrastructure-chaos.ts
PLAYWRIGHT_BASE_URL=… npx playwright test --config=playwright.campaign.config.ts
PLAYWRIGHT_BASE_URL=… npx playwright test --config=playwright.campaign-mobile.config.ts tests/e2e-mobile/mobile-feel-contracts.spec.ts
```

Each sim appends to `tests/simulation/reports/campaign-2026-10-05/{findings,skips,metrics}.jsonl` (gitignored; `CAMPAIGN_OUT` overrides). A step that cannot run is recorded as a skip with its reason, never as green. The by-id sweep exits 2 if its route population falls under its floor and 1 on a breach.

Foundry's campaign ships in its own repository under `tests/simulation/campaign/`.
