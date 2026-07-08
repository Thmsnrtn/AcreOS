# The January Annual Portfolio Review — AcreOS as a CFO Workbench

**Author:** Persephone Blakemore, 50 — Land Investor, 11-year operator, ~70 active assets across TX/OK/NM/CO + a small NM hunting-lease cohort. Every January 2nd–8th I do a portfolio review: P&L, cost-basis updates, exit decisions, vintage performance, ROI on data + tools spend.
**Date:** 2026-05-01
**Wave:** 3 (deeper) — annual review lens
**Read in full:** `server/services/portfolioPnl.ts`, `server/routes-portfolio-pnl.ts`, `client/src/pages/portfolio-pnl.tsx`, `server/services/portfolioOptimizer.ts:67-75,277-385`, `client/src/pages/portfolio-optimizer.tsx`, `server/services/dealUnderwriting.ts:62-94`, `server/services/costBasisTracker.ts`, `server/routes-tax-optimization.ts`, `server/services/export.ts`, `server/routes-import-export.ts`, `server/services/portfolioHealth.ts`, `server/storage.ts:6767-6823` (apiUsageLogs). MEMORY refs: `feedback_terminology.md`, `feedback_comprehensive_testing.md`.

---

## 1. The job AcreOS has to do for me, in one paragraph

I am not running a real-time dashboard. I am running an **annual close**. From January 2 through January 8 I do exactly four things, in this order: (1) reconcile cost basis on every active asset, (2) compute portfolio P&L for the closed year and compare YoY against the prior three, (3) segment the book by state, deal type, and vintage to see where the actual money was made, (4) decide which assets to exit in Q1 and which to hold. The tool that helps me do this in a half day instead of a week is worth paying for. The tool that requires me to dump CSVs into a spreadsheet to do my own cohorting is not. AcreOS is currently the second tool. The components to be the first tool exist; they are not assembled into the review surface I need.

---

## 2. What works for an annual review today

### 2.1 The P&L primitive is real

`server/services/portfolioPnl.ts` is structurally a CFO-grade primitive. It aggregates closed deals, sale proceeds, and note interest income; computes acquisition cost, gross margin, cash-on-cash, and **annualized IRR via Newton-Raphson over the cash-flow vector** (`portfolioPnl.ts:69-84`). It supports monthly/quarterly granularity (`periodLabel`, line 60). It emits a `PortfolioPnlReport` shape with periods, totals, pipeline by stage, and notes-receivable summary (`portfolioPnl.ts:34-58`). For a 70-property book this is a credible foundation.

### 2.2 The deal-level IRR engine is more sophisticated than the portfolio one

`server/services/dealUnderwriting.ts:62-94` is the better IRR implementation — monthly cash flows, holding-cost timing, sellingCosts at 6%, equity multiple, annualized ROI. This is the calculator I actually want at the *portfolio* roll-up. The portfolio version (`portfolioPnl.ts:69-84`) is annualized-only and assumes flat unit periods, which loses fidelity on staggered closings inside the year.

### 2.3 Cost basis is tracked separately and is queryable

`server/services/costBasisTracker.ts` writes per-property basis records to the `costBasis` table with `getCostBasis(propertyId, orgId)`, `recordCostBasis`, `updateCostBasis`, and a list-by-org query. `server/routes-tax-optimization.ts:133-164` exposes the read/write endpoints. The 1099-S/§1031 strategy engine sits behind `/tax-optimization/strategies` and `/tax-optimization/analyze`. The pieces exist for me to do the January basis reconciliation pass.

### 2.4 Diversification segmentation by state exists

`server/services/portfolioOptimizer.ts:67-75` defines `DiversificationAnalysis` with `byState`, `byCounty`, `byPropertyType`, `byAcreSize`, plus a `concentrationScore` and `topRisks`/`recommendations`. The implementation aggregates current value by state and computes HHI-style concentration scoring (`portfolioOptimizer.ts:295-352`). The Optimizer page renders a state-distribution pie + current-vs-AI-optimized comparison (`portfolio-optimizer.tsx:721-1002`). For state segmentation specifically, this is closer to "production-ready" than anything else in my workflow.

### 2.5 CSV export exists per entity

`server/services/export.ts` exports leads, properties, deals, and notes to CSV; `routes-import-export.ts:203-247` wires it up with `?format=csv|json` and date-stamped filenames. Whatever AcreOS does not give me natively, I can dump and finish in Excel. This is the floor — it should not be the ceiling.

### 2.6 API/tool spend is logged with cost cents

`apiUsageLogs` (`server/storage.ts:137,6767-6823`) stores `estimatedCostCents`, queryable by date range. `server/routes-founder-intelligence.ts:355-357` already aggregates 7-day spend on the founder side. The data is there to compute "ROI per dollar spent on data + tools" — the surface is missing.

---

## 3. What does not work — the actual gaps for the January review

### 3.1 No year-over-year comparison view

`/api/portfolio-pnl/:year` returns one year at a time (`routes-portfolio-pnl.ts:30-37`). The page shows a single year (`portfolio-pnl.tsx:75-78`). There is **no endpoint that returns 2023/2024/2025 side-by-side**, no Δ revenue / Δ net profit / Δ IRR columns, no QoQ-vs-prior-year quarterly grid. I currently cannot answer "did 2025 beat 2024 on net profit per dollar deployed" without running the page three times and copying numbers into Numbers.app. This is the single highest-leverage missing surface for an annual review and would be a 1–2 day build because the primitive already exists.

### 3.2 No vintage / cohort segmentation of the *portfolio*

`routes-cohort-analysis.ts` and `services/cohortAnalysis.ts` exist but per the file structure are oriented at *user/account* cohorts (retention curves, NPS bands), not at *acquisition-vintage* cohorts (assets bought in 2022 vs 2023 vs 2024, returns by hold-year). I cannot ask "what was the realized IRR on my 2022 vintage vs my 2023 vintage" without writing SQL. For an annual review this is the canonical question. Acreage-bracket and propertyType segmentation in `portfolioOptimizer.ts:298-338` is by *current value*, not by *vintage realized return* — a different axis.

### 3.3 No deal-type segmentation in the P&L roll-up

`PnlPeriod` (`portfolioPnl.ts:21-32`) has acquisitionCost / saleProceeds / interestIncome but does **not break out wholesale flips vs buy-and-hold vs seller-financed paper.** I know empirically that my owner-financed 10-year paper has a fundamentally different IRR profile than my 6-month wholesale flips. Aggregating them into one "totalRevenue" line obscures the answer to my main strategic question of the year: *which exit strategy do I lean into in 2026?* The `deals.exitStrategy` (or equivalent) column exists and just needs a `groupBy` in the report.

### 3.4 No exit-recommendation engine surfaced for the annual decision

`portfolioOptimizer.ts:53-64` defines `OptimizationRecommendation` with action `'hold' | 'sell' | 'refinance' | 'develop' | 'subdivide'`, expectedImpact, and confidence/priority — exactly the shape I want. But searching the codebase for the *application* of this to the held portfolio surfaces only Monte-Carlo scenario projection. There is no view that says: "here are your 70 assets, ranked by sell-now NPV vs hold-12-months NPV, given current county appreciation and your tax-loss harvesting room (`taxOptimizationService`)." That is the deliverable I want on January 7. The math is in pieces in three services; nothing assembles it.

### 3.5 No portfolio-summary export — only per-entity exports

`exportPropertiesToCSV`, `exportDealsToCSV`, `exportNotesToCSV` (`export.ts:26-102`) are entity-flat dumps. There is no `exportAnnualReviewPackage` that produces a single workbook containing: (a) prior-3-year P&L with YoY deltas, (b) basis reconciliation per active asset, (c) realized vs unrealized gains, (d) segmentation by state/vintage/deal-type, (e) top-10 candidates for exit. This is the artifact I bring to my CPA on January 12. Today I assemble it manually from four CSVs and the P&L page.

### 3.6 ROI on data + tools spend is invisible to the operator

`apiUsageLogs.estimatedCostCents` exists. The provider registry tracks per-call cost. **Nowhere in `client/src/pages/portfolio-*.tsx` does the operator see what they spent on data this year vs the deals that closed because of it.** The founder dashboard sees aggregate platform cost (`routes-founder-intelligence.ts:355`); the Land Investor sees nothing. For a $300/month subscription plus skip-trace credits plus AVM lookups, my January question is "did the data spend pencil out per closed deal." Today I cannot answer it inside AcreOS.

### 3.7 IRR on the portfolio P&L can return null silently

`portfolioPnl.ts:69-84` returns `null` if Newton-Raphson does not converge in 100 iterations — and the report shape allows `irr: number | null` (`portfolioPnl.ts:44`). The page displays IRR without a "did not converge" callout. For an annual review with mixed cash-flow signs (refinance proceeds, deferred closings, mid-year basis adjustments), non-convergence happens. I need a fallback to bisection or an explicit "IRR could not be computed for this period — review cash-flow signs" message, not a quiet null that renders as "—".

### 3.8 The page header says "annual" but the controls don't reflect it

`client/src/pages/portfolio-pnl.tsx:90-92` calls itself "Annual profit and loss summary" but offers only a single-year selector. There is no comparison toggle, no "compare to prior year" checkbox, no YTD-vs-prior-YTD-through-same-date for mid-year reads. The header writes a check the UI does not cash.

### 3.9 No realized-vs-unrealized split

The P&L `totals` (`portfolioPnl.ts:36-45`) collapse closed-sale proceeds and note-interest income into one `totalRevenue` figure. For the January review I need realized gains (deals with `closingDate` in-period and a `salePrice`) separated from unrealized appreciation on still-held assets (where I track `currentValue` against basis). The optimizer has `currentValue` per holding (`portfolioOptimizer.ts:18-19`); the P&L report does not pull it. Without this split I cannot produce a credible mark-to-market portfolio statement, which is the artifact my LP-style co-investors ask for in Q1.

### 3.10 Notes-receivable IRR is computed against par, not against cost

`portfolioPnl.ts:194-202` aggregates `currentBalance`, `monthlyPayment`, and average rate across active notes — but the IRR cash flow stream (lines 174-184) treats incoming `interestPortion` payments as positive cash without an offsetting basis. For seller-financed paper that I originated by selling property below market for the rate premium, the correct IRR includes the spread between sale price and unfinanced market value as part of basis. Today the IRR overstates note-portfolio returns because it ignores the implicit origination discount. This is a model-correctness issue, not a UI one.

---

## 4. Persona-architecture nit (per MEMORY)

`portfolio-pnl.tsx:90` and the optimizer surfaces avoid Sophie/Forge/Atlas references — good. The optimizer's "AI-optimized allocation" framing (`portfolio-optimizer.tsx:998`) is correct: it refers to the recommendation engine as a tool, not a persona, which is the right boundary for a customer-facing surface. Hold this line; do not let the exit-recommendation engine I am asking for in §3.4 leak Forge/Atlas names into the Land Investor view.

Also per `feedback_terminology.md`: the P&L page is clean ("land portfolio"), no "real estate professional" leakage. Confirmed.

---

## 5. The seven-day January review, today vs after fixes

| Day | Today (AcreOS as-is) | After §6 fixes |
|---|---|---|
| Jan 2 | Export 4 CSVs, dump into Numbers, build YoY pivots manually (~6h) | Open `/portfolio-review/2025`, see prior-3-year side-by-side (~15m) |
| Jan 3 | Reconcile cost basis property-by-property in the UI, copy values to spreadsheet (~5h) | Run `POST /portfolio-review/basis-pass`, review variance report (~45m) |
| Jan 4 | Manual SQL or spreadsheet to segment by state + vintage (~4h) | Vintage cohort table renders in-app, click to drill (~30m) |
| Jan 5 | No exit recommendation — read each property page, decide gut-feel (~6h) | Ranked sell-vs-hold list with NPV deltas + tax-loss room (~1h to review) |
| Jan 6 | Spend day rebuilding the workbook for CPA hand-off (~6h) | Click "Export annual review package" — single workbook out (~5m) |
| Jan 7 | Calculate cost-per-deal manually from credit-card statements (~3h) | Data-spend ROI card on the dashboard reads ~$X / closed deal (~5m to review) |
| Jan 8 | Write decisions, send to attorney + CPA | Same — but with a defensible artifact |

Half a day vs a week is the promise. The components exist. They are not composed.

---

## 6. The fix list, ranked by leverage for the annual review

1. **`/portfolio-pnl/compare?years=2023,2024,2025`** — return an array of `PortfolioPnlReport` with computed Δ% on revenue, netProfit, IRR, and dealsAcquired. Render a side-by-side YoY table. Single-day build; primitive exists. Highest leverage.
2. **Vintage cohort report** — group properties by acquisition year, compute realized + unrealized IRR per cohort, render in `portfolio-pnl.tsx`. Two-day build; needs a `acquisitionYear` derivation off `deals.closingDate`.
3. **Deal-type segmentation in `PnlPeriod`** — extend `PnlPeriod` with `byExitStrategy: { wholesale, ownerFinance, buyAndHold, subdivide }`. Update the Newton-Raphson cash-flow assembly to tag flows by strategy. Three-day build.
4. **Exit-recommendation surface** — wire `OptimizationRecommendation` to a `/portfolio/exits` page that ranks active properties by `sellNowNPV - holdNPV`, joined to `taxOptimizationService` for harvest-loss room. Five-day build; the math services exist, the assembler does not.
5. **`exportAnnualReviewPackage(orgId, year)`** — single XLSX with five sheets (P&L YoY, basis reconciliation, vintage cohorts, exit candidates, data-spend ROI). Two-day build using `exceljs`.
6. **Data-spend ROI card** — `SELECT sum(estimatedCostCents)/100 FROM apiUsageLogs WHERE org_id=? AND created_at IN year` divided by deals-closed in same window. Render on portfolio P&L. Half-day build.
7. **IRR fallback to bisection + explicit non-convergence message** — when `calculateIrr()` returns null, fall back to bisection on `[-0.99, 5]`, and when both fail surface "IRR could not be computed; check cash flow signs in §X." Half-day build.

Items 1, 5, and 6 alone collapse two days of January manual work. Ship those before next January.

---

## 7. The numbers I want on screen January 2, in priority order

These are the cells of my mental spreadsheet. Each one corresponds to a question I ask before noon on day one. If AcreOS cannot show me each, it is not yet a CFO workbench.

1. **Net profit 2025 vs 2024 vs 2023, with Δ% column.** Two clicks max. Today: zero clicks possible, manual spreadsheet build.
2. **Portfolio IRR 2025 vs trailing-3-year IRR.** Computed from the entire deal cash-flow vector across the period, not just one year. Today: only single-year IRR exists in `portfolioPnl.ts`.
3. **Realized IRR by acquisition vintage.** 2022 vintage closed at X%, 2023 vintage at Y%, etc. Today: not computed anywhere.
4. **Realized IRR by deal type.** Wholesale flips at A%, owner-finance paper at B%, subdivide-and-sell at C%. Today: aggregated into a single line.
5. **Realized IRR by state, with HHI concentration trend YoY.** `portfolioOptimizer.ts:67-75` shows current-state mix; nothing shows return-by-state-by-year.
6. **Active-portfolio sell-vs-hold ranking with NPV deltas.** Top 10 candidates for Q1 exit, top 10 candidates to hold past 18 months. Today: zero — `OptimizationRecommendation` is a type, not a surface.
7. **Year-end basis variance.** Properties where my recorded `costBasis` differs from acquisition price + capitalized improvements. Today: per-property reads only, no variance report.
8. **Tax-loss harvest capacity for Q1 sells.** From `taxOptimizationService` — how much realized gain can I offset by selling underwater inventory before the §1031 window matters. Today: tax-optimization analyze runs but is not joined to the exit recommendation.
9. **Total data + tools spend / closed deals = effective cost-per-deal.** `apiUsageLogs.estimatedCostCents` divided by `deals.status='closed'` count, segmented by quarter. Today: founder dashboard sees it; I do not.
10. **Pipeline-as-of-Jan-1 vs pipeline-as-of-Jan-1-prior-year.** Am I starting 2026 with more or less inventory than 2025? `pipeline` exists in the report; YoY comparison does not.

If items 1, 3, 4, 6, and 9 land, my January review is a half-day. If they do not, it is a week — same week I have run for eleven years before AcreOS.

---

## 8. Pricing the gap

I will pay $300/month for AcreOS. I will pay $600/month if it saves me my January week. The fix list in §6 totals roughly 13 engineering days. At a Land Investor TAM that does this same review every January, the LTV uplift on doubling my willingness to pay is the entire ARR of the segment. This is not a feature request. This is the **central job** for any operator north of 30 active assets — and it is the single most leverage-rich quarter for AcreOS to compete on, because every other land tool is also a transaction-tracker, none is a CFO workbench.

---

## 9. The one-liner

AcreOS already has the engines an annual portfolio review needs — IRR, cost basis, diversification, P&L, cohort, tax optimization, usage logs. What it does not have is the **review surface** that composes them into the artifact a 50-year-old Land Investor brings to her CPA on January 12. Build the composer; the parts are paid for.
