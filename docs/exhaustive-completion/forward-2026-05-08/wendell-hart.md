# Wendell Hart — Land-investor operator (TX, 12yr veteran)

**Reading list (what I read before writing):**
- `docs/exhaustive-completion/MASTER-FINDINGS-RECONCILIATION.md` (P0-1 tier-pricing single source shipped; P0-21 CSV import 500-row sync + 50K queue shipped)
- `docs/exhaustive-completion/post-may1-resweep.md` (RS-1..RS-7 shipped; no issues in Land vertical surfaces)
- `docs/exhaustive-completion/REMAINING-WORK-INVENTORY.md` (Founder dashboard v2 deferred; onboarding redesign deferred pending signal)
- Wendell-user.md — original audit from 2026-05-01 (five features that would make no-brainer switch; deal-killer is note-ledger bulletproof)
- `client/src/pages/money.tsx` (five tabs, labeled wrong per his audit), `client/src/components/finance-notes.tsx` (1,800 lines), `/api/leads/export` (now rate-limited per RS-7), `/field-scout` (offline sync shipped)
- `server/services/formulas/noteAmortization.ts` (partial-payment + escrow math)

---

## State read

Wendell's deal-killer test from May 1 was simple: does the note ledger work? Can a borrower make a partial payment, an extra principal payment, or an escrow deposit toward taxes without the system breaking? Can I generate a clean 1098-INT in January? RS-1..RS-7 just shipped, which addressed his second-tier friction (export rate-limit on `/api/leads/export`, email-change confirmation, new-location geoIP detection). The financial surfaces still have the same architecture he flagged five weeks ago — one thick `finance-notes.tsx` file, five tabs with swapped IA labels, no bulk-action capability in `/leads`. The note math itself we don't know yet.

---

## Push forward — my 5 moves (ranked)

1. **Bulletproof the note ledger with real-operator acceptance test** — not a feature, not a sprint. A live verification: Wendell (or a customer like him) brings a real note portfolio (10-20 notes, mix of current, late, prepaid, with escrow holds and extra principal). AcreOS processes three full payment cycles end-to-end. At the end, export matches his manual tracking to the penny. Payoff calculation = amortization schedule. Late fees = note terms. 1098-INT = IRS-compliant PDF. This is the single thing that determines whether AcreOS replaces QuickBooks for him or whether he walks to Fintech Express / Fund & Grow. One week of dedicated QA + fix-first iterations. Deferred until done.

2. **Split `/money` into three tabs (Notes / Cashflow / Tax pack) and kill the rest** — Wendell said "five tabs is at least one too many." The current menu has `Finance` labeled as Portfolio, `Portfolio` labeled as Optimizer. This confusion lives in `money.tsx:51-90`. Rename: 1) Notes (the current `/finance` view with amortization detail), 2) Cashflow (portfolio aging + monthly cash position, from current Portfolio tab), 3) Tax pack (depreciation + basis + 1098-INT ready, consolidated from Depreciation-calculator + the IRS-filing surface). Delete Optimizer and Capital Markets tabs (venture-pitch words that land-flippers don't run on). Route cleanup: `/money/notes`, `/money/cashflow`, `/money/tax-pack`. One week. Unblocks his daily workflow.

3. **Bulk actions in `/leads` — select N rows, apply: assign to VA, drop into mailer, mark dead, export** — Wendell said "without bulk actions I bounce to Excel." This is a non-negotiable motion for anyone running 300+ leads. Build `useLeadBulkActions` hook, wire into the leads table row-select (`<tr key={leadId} data-selectable>`), add a sticky footer action bar when ≥1 row selected. Actions: assign-to-user, add-to-sequence, change-status, mark-dead, bulk-export. Two weeks. After this, the `/leads` surface becomes a real daily driver instead of a reference view.

4. **One-click "send blind offer letter" from parcel detail** — Wendell's parcel-detail audit said "best surface in the app" but missing a key motion: he wants to right-click a lead, generate a blind offer letter (Pax draft + property data), and drop it into a Pebble-equivalent mailer without bouncing to a separate `/direct-mail-campaigns` surface. This isn't a new feature; it's a UX consolidation. Build a quick-action menu on `/parcels/:id` detail: "Draft offer / Copy offer / Mail offer." The "Mail offer" path: Pax generates the letter (using `routes-ai-draft.ts:44` reused for offers), opens a `direct-mail-campaigns.tsx` picker, queues the send in one atomic motion. One week. High-leverage because it's 80% done already.

5. **Map view as default on `/properties`** — Wendell: "I think in counties, not spreadsheets. So does every land investor I've ever met." The table view is auditable; the map view is how he thinks. Check if `client/src/components/PropertyMapView.tsx` or equivalent already exists in the codebase. If yes: swap the default to `MapView`, keep table as an alternate toggle. If no: build a React-Leaflet map showing owned (green), under-contract (yellow), tax-delinquent leads (red) with clustering at zoom-out. Wire parcel detail open on map-pin click. Two weeks. Category-defining for land-operator product/market fit.

---

## What I'd defer (and why)

- **Multi-vertical expansion (Wholesale, Notes Investor tier-up).** Wendell disagrees with the masthead-brand thesis. He said: "I want you deeper on Land, not wider on five verticals." His note ledger is his real problem today; solving it perfectly for one person is better than half-solving it for three personas. Don't expand until the Land note-ledger becomes so obviously bulletproof that customers ask for the other surfaces.
- **CSV column-mapper UI.** Wendell asked for it in May; it's a phase-2 feature. The current import (`PortfolioImportStep` in `onboarding-v2.tsx:288-480`) queues a job; people who know the schema can import. A drag-map UI is nice-to-have after the ledger works.

---

## What scares me most (one named risk + mitigation)

**The note ledger has one silent bug that breaks on real money.** Wendell said explicitly: "If a single one of those breaks once on real money — even a rounding error on one borrower's payoff — I'm back in Excel and Google Sheets the same day." This is not a feature risk; it's a trust-collapse risk. One payoff that mismatches by $0.47, one 1098-INT that shows wrong interest, and Wendell tells every land investor he knows "don't use AcreOS." Mitigation: (a) the acceptance test above (three-cycle real-money run) is non-negotiable; (b) add a paranoia test in CI that generates 1,000 random amortization schedules (payment patterns, extra principal, escrow holds) and validates payoff against the schedule to the cent; (c) Wendell himself spot-checks the 1098-INT logic by hand before shipping.

---

**Bottom line for the founder:** Land Investors will pay for depth + reliability, not breadth + features. Wendell is your reference customer for this vertical. Spend the next two months making him unable to go back to Excel on the note ledger, building the bulk-operations motion in `/leads` that he uses every day, and fixing the IA confusion in `/money`. After that, the question becomes "is there an ARR ceiling on Land if we do it perfectly," not "should we try Wholesale next."
