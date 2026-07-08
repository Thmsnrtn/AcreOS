# 14. Customer Personas — Verticals (slots 196–210)

**Core tension each persona navigates:** depth vs breadth. Wendell Hart (returning) obsesses over note-ledger bulletproof; Caspar wants Land+Notes wedge scaled to $1M ARR before widening. These 15 personas answer one question each: *What would make this vertical irreplaceable for me, vs "good enough" that I bounce back to Excel?*

---

## 196. Wendell Hart — Land investor (TX, 12yr veteran)

**Lens:** Deal-pipeline depth; operator realism. Returned from forward panel. Obsessed with note-ledger reliability to the cent.

**State read:** P0 sweep shipped tier-pricing single-source; RS-1..RS-7 closed permissible-purpose + account-security. Five-tab `/money` interface still has label swaps. No bulk-action motion in `/leads`. Note-amortization math untested against three-cycle real-money run.

**Highest-leverage move:** Real-operator acceptance test — Wendell brings live portfolio (10–20 notes, escrow, partial payments); AcreOS processes three cycles end-to-end; payoff matches manual tracking to the penny. Not a feature. A verification. Effort: 1 week dedicated QA, fix-first iterations. Unblocks "replaces QuickBooks" confidence for every Land investor.

**Biggest risk:** One silent rounding error on payoff or 1098-INT and Wendell returns to Excel same day, tells every operator he knows "don't use AcreOS."

---

## 197. Sasha Donovan — Land investor (newbie, 2-month customer)

**Lens:** Fear reduction; first-deal anchoring. 2 months in, Sasha made one tax-delinquent offer. Obsessed with not-screwing-up the numbers.

**State read:** Onboarding checklist exists; no persona-aware variant. First-day aha time is 7:30 (target: ≤2:30). No parcel-detail "send blind offer" quick-action. Pax drafts exist but live in separate `/direct-mail-campaigns`.

**Highest-leverage move:** Persona-aware first-day checklist (land_investor variant: 1) county research, 2) find delinquent, 3) draft offer in 5 minutes). Inject Pax hello-world offer draft after step 3. Collapse aha from 7:30 to 2:30. Effort: 2 weeks.

**Biggest risk:** If first offer feels wrong (parcel data stale, comps off by $50K), Sasha abandons platform before learning value.

---

## 198. Roger Beauchamp — Land + flip side hustle (2 deals/yr W-2 employed)

**Lens:** Weekend-only workflow; batch-mode thinking. Splits time between corporate job + investment. Obsessed with "run the whole analysis in Friday afternoon."

**State read:** Map view on `/properties` exists but not default. Bulk actions missing (Roger exports to Excel to filter/assign). Parcel-discovery surface requires real-time dashboard monitoring.

**Highest-leverage move:** Map view as default on `/properties` (green=owned, yellow=under-contract, red=delinquent leads; clustering at zoom-out). Wire parcel-detail open on pin click. Roger thinks in counties, not spreadsheets. Effort: 2 weeks.

**Biggest risk:** Without map-first UX, Roger stays in Excel; AcreOS becomes reference-lookup tool only, not daily driver.

---

## 199. Marlena Lansdale — Note investor (institutional, 4,000+ note portfolio)

**Lens:** Amortization correctness to the cent. Returned from forward panel as vertical PM; here as customer with institutional-scale obsession.

**State read:** 1098-INT generator shipped; hardcoded payer/recipient TIN fixed; tax-year bucketing + excludedFrom1099 filtering live. Note ledger handles escrow holds and partial payments. No 1096 transmittal yet.

**Highest-leverage move:** Institutional-scale note UI: portfolio-aged report (>90 days late grouped), yield-alert dashboard, bulk reclassification (mark 50 notes "escrow pending" atomically). Wire cost-of-capital model to lending dashboard. Effort: 3 weeks.

**Biggest risk:** At 4,000-note scale, UI becomes unusable; Marlena abandons for institutional-only platforms (Nuveen, Blackstone tools).

---

## 200. Bart Henrichsen — Note investor (individual, 12 notes, retired)

**Lens:** Simplicity over features; read-only summary. Retired, manages own notes. Obsessed with "I just want to know if I'm on track."

**State read:** Full note-ledger shipped. Monthly dashboard shows current balance + YTD interest + 1098-INT ready. No automation needed; manual upload works fine.

**Highest-leverage move:** "My notes at a glance" monthly email: top 3 at-risk, YTD yield, 1098-INT PDF ready for CPA. No logins required after setup. Effort: 1 week email template + cron.

**Biggest risk:** If dashboard requires 3 clicks to answer "am I on track," Bart unsubscribes and reads statements from the note servicer instead.

---

## 201. Henrietta Volker — BH operator (1 unit, just-bought)

**Lens:** Not-getting-sued; regulatory fear. First-time landlord, closed 2 weeks ago. Obsessed with tenant screening + adverse-action compliance.

**State read:** BH-1/BH-2 shipped; tenant entity + screening fields live. Permissible-purpose attestation gate + adverse-action notice send both ship 2026-05-15 (RS-1, RS-2).

**Highest-leverage move:** First-tenant workflow: upload lease → auto-run screening → permissible-purpose attestation (1-click) → adverse-action notice (if needed). Henrietta never handwrites a rejection letter.

**Biggest risk:** One missed adverse-action notice = Henrietta gets sued; jury sees she used AcreOS "negligently."

---

## 202. Octavio Pereira — BH operator (multi-state, 80+ units)

**Lens:** Portfolio-level KPIs; state-rule variance. 25-year landlord, managing 80 units across TX, OK, CO. Obsessed with which properties bleed cash.

**State read:** Rent-ledger shipped; maintenance-ticket triage wired. Late-fee engine handles 50-state rules. No consolidated "which property underperforms" dashboard. No state-rule dashboard (TX-specific DTPA, OK rent-control variance).

**Highest-leverage move:** Property-performance dashboard: ROI per unit, cap-rate drift per property, maintenance-cost % of rent by state. Highlight red-flag properties (cap-rate <6%, maintenance >30% rent). Wire to 1031-exchange exit criteria.

**Biggest risk:** Without unit-level visibility, Octavio holds underperforming properties longer than he should; capital sits in drag assets instead of high-yield deals.

---

## 203. Karina Petrov — Wholesaler (assignment, 30 deals/yr)

**Lens:** Assignability-state-rules; deal-sheet speed. 2 years wholesaling, closes 30/yr. Obsessed with "is this assignment legal in CO vs TX vs NY?"

**State read:** Assignment-of-contract flow shipped. State-rule gate exists (`wholesaler_contract_state_rules`). No quick "check assignability before offer" pre-flight.

**Highest-leverage move:** Pre-offer assignability checker: paste address → auto-detect county → highlight legal constraints (CO vs NY assignment rules diff) + recommendation ("double-close required in NY"). Effort: 1 week.

**Biggest risk:** One assignment rejected at closing (state-rule violation Karina didn't know) = deal dies, lost assignment fee, buyer sues for breach.

---

## 204. Beau Gentry — Wholesaler (double-close, 100 deals/yr)

**Lens:** Title-coordination workflow; close-of-escrow clarity. High-volume double-closer, 5 years. Obsessed with escrow timing and title-company comms.

**State read:** Double-close math shipped (side-by-side closing). Pebble mailer integration wired. No escrow-timeline dashboard. No title-company integration surface.

**Highest-leverage move:** Escrow timeline dashboard: contract-to-close countdown per deal, title-order date vs due-diligence deadline overlap warning, auto-alert 3 days before closing (comps needed, final walkthrough scheduled). Wire Lob mailer for blind-offer blasts.

**Biggest risk:** Missed title-order deadline = deal slips 2 weeks; Beau loses buyer to another wholesaler.

---

## 205. Eulalia Mendoza — Fix-and-flipper (single project at a time)

**Lens:** Rehab-budget creep; contractor invoice tracking. Solo flipper, manages own projects. Obsessed with "where did the budget go?"

**State read:** Rehab-budget table shipped; contractor 1099 aggregation wired. No budget-vs-actual dashboard. Invoice-upload is manual (no scanner integration).

**Highest-leverage move:** Budget-creep alert: highlight expenses >10% above line-item budget in red. Auto-aggregate by trade (electrical, plumbing, general labor). Show "still $X to close" for each trade. Wire Lob OCR for invoice autoload.

**Biggest risk:** Without visibility, Eulalia discovers over-budget status at project-end; can't adjust ARV estimate or scope-cut in time.

---

## 206. Tobias Crawford — Fix-and-flipper (multi-project, 4 simultaneous)

**Lens:** Project-status visibility across crews. Manages 4 concurrent rehabs, coordinates 8+ contractors. Obsessed with "is plumbing on track?"

**State read:** Four-project table exists. Per-project dashboard shows budget vs spend. No contractor-status "green light" roll-up or daily-standup integration.

**Highest-leverage move:** Multi-project command center: 4 project tiles showing budget %, schedule % (vs contract end-date), contractor-status (green=on-track, yellow=flag). Sync inspection-photo upload from GoPro crew (S3 auto-ingest). Effort: 3 weeks.

**Biggest risk:** One project overruns 2 weeks because Tobias didn't see plumbing delay until final walkthrough.

---

## 207. Ingvar Sigurdsson — Subdivider (rural land, 100-acre tracts)

**Lens:** Permit-tracker realism; rural county variance. Sells 5–10 acre parcels, files permits in 6 rural counties. Obsessed with "when do I get my parcel map?"

**State read:** Permit-tracker table shipped. County-rule variance exists in schema. No automated permit-status checker (no API to county assessor). Manual status updates only.

**Highest-leverage move:** Permit-status workflow: upload legal description → auto-pull assessed county record → track "record filed date" vs "permit issued date" vs "parcel map received" with calendar alerts (±5 days). Email county assessor integration pilot for top-3 counties.

**Biggest risk:** Ingvar misses "parcel map ready" signal; sits on completed subdivision without selling; 6-month capital delay per subdivision.

---

## 208. Yvonne Bertrand — Subdivider (suburban, in-fill lots)

**Lens:** Zoning-research automation; city variance. Splits city lots in suburban markets. Obsessed with "is this lot even subdividable?"

**State read:** Zoning-rule table exists. Regrid integration wired for parcel-boundary data. No auto-check for "lot-split variance required" or city-council approval timeline.

**Highest-leverage move:** Pre-subdivision zoning check: upload lot → auto-query Regrid + city GIS → flag if split requires variance → estimate city-review timeline (60–120 days per jurisdiction). One-click "apply for variance" workflow (document-autofill + tracking).

**Biggest risk:** Yvonne starts acquisition on lot that's unsplittable; sunk costs ($5K legal, title search, appraisal) become dead weight.

---

## 209. Magnus Ó Brolcháin — Multi-vertical operator (Land + Notes + BH)

**Lens:** Unified P&L across verticals. Runs all three: Land, Notes, BH rentals. Obsessed with "what's my total return across all three?"

**State read:** Three verticals wired. Tier-pricing shows $79 base + $100 NI + $200 BH = $379/mo. P&L isolated per vertical. No cross-vertical consolidation.

**Highest-leverage move:** Consolidated P&L dashboard: total portfolio cashflow (Land sales + note interest + rent), blended IRR across all three, allocation % (how much capital per vertical). Show which vertical underperforms and why.

**Biggest risk:** Multi-vertical operators become AcreOS anchor customers if we nail cross-vertical insights; without it, they consolidate into Excel and run their own reporting.

---

## 210. Imani Whitfield — Side-hustle to full-time transition

**Lens:** Revenue-replacement math; W-2-exit decision. Transitioning from job to full-time investing this year. Obsessed with "when can I quit my job?"

**State read:** Monthly P&L report exists. No cohort-analysis of "how much revenue needed to replace $100K W-2?" No scenario planner.

**Highest-leverage move:** W-2-exit calculator: input target-income, current-portfolio yield, project growth rate → show "months to hit $100K/yr"; show best-case (3 more Land deals) vs baseline (note income + rent roll only). Imani makes data-driven exit decision.

**Biggest risk:** Imani quits job prematurely; portfolio underperforms; she's forced back to W-2, churns AcreOS in frustration.

---

## 211. Category-level synthesis: Customer Personas — Verticals

**Top 5 recommendations clustered from the 15 memos:**

1. **Real-money note-ledger acceptance test (Wendell, Marlena, Bart)** — 1 week dedicated QA. Single highest-leverage move. Unlocks investor confidence that AcreOS doesn't lose money to rounding errors. Precedent-setting for institutional-scale adoption. Effort: 1 week.

2. **Persona-aware first-day checklist + Pax hello-world draft (Sasha, Roger, Imani)** — Collapse time-to-aha from 7:30 → 2:30. Land-investor first-deal confidence increases Day 1 instead of Week 2. Wire Pax draft auto-generation on completion. Effort: 2 weeks.

3. **Map view as default on `/properties` + county-think UX (Roger, Ingvar, Yvonne)** — Land and Subdivision investors think in counties, not spreadsheets. Default map, cluster at zoom-out, parcel-detail on pin-click. Effort: 2 weeks.

4. **Multi-vertical consolidated P&L + W-2-exit calculator (Magnus, Imani, Octavio)** — Operators running 2+ verticals need cross-vertical ROI. Exit planners need scenario modeling. These unlock expansion revenue (Magnus becomes $400+/mo customer; Imani stays longer). Effort: 3 weeks.

5. **Permissible-purpose + adverse-action compliance (BH trio: Henrietta, Octavio, Beau)** — Live by 2026-05-15 (RS-1, RS-2 ship). These unblock real BH tenant-screening launches. Without them, BH is audit-theatre, not law. Effort: Built into Phase 4 backlog.
