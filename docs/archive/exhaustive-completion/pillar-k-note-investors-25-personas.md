# Pillar K — Note investors as 25 personas

Twenty-five composite personas spanning the note-investing market by
sub-niche, scale, capital source, and experience. Mined for actionable
product insights that aren't already in
`docs/exhaustive-completion/note-investor-followups.md`.

The goal isn't 25 separate workflows. The goal is to surface insights
that map across personas — patterns the platform should solve once and
that benefit many of them. The synthesized insights table at the bottom
is the operative output.

---

## The 25 personas

### Beginner tier (years 0–3)

**1. Allison · First-year note buyer**
- Owns 2 performing 1st-lien seller-financed land notes bought on
  Paperstac. $48K total. Capital: personal savings.
- Pain: doesn't know what to do post-acquisition. Has the docs in
  Dropbox. Hasn't filed anything.
- Tool gap: zero post-acquisition workflow. No prompt to set up
  servicing, no 1098-INT calendar, no payment-receipt template.

**2. Brendan · Solo IRA investor**
- Buys 1–2 notes/year through Quest Trust self-directed IRA.
  Performing 1st-liens on cabins. 4 active.
- Pain: keeping the IRA custodian compliant — every transaction routes
  through the custodian and he forgets which ones need their signature.
- Tool gap: no IRA-custodian routing flag on a note; no "custodian
  approval pending" status; no template letter to the custodian.

**3. Catalina · Compliance-paranoid newcomer**
- Recently retired surgeon. Bought 3 note tapes (~12 notes) from a
  reputable broker. Terrified of Dodd-Frank / RMLO violations.
- Pain: doesn't know which of her notes need RMLO involvement. Doesn't
  know if she's the "creditor" under Reg-Z. Doesn't know her state's
  usury cap.
- Tool gap: no RMLO-required flag per note; no Dodd-Frank ability-to-
  repay checklist; no state-usury reference.

**4. Devon · Land seller-financer (originating)**
- Owns a land business. Sells lots with seller financing. 18 active
  notes he originated. Treats them as a side cash flow.
- Pain: he originated them, so he IS the lender. State licensing for
  servicing them is murky and he's not sure if he needs an SDS license.
- Tool gap: no "I originated this" vs "I bought this" distinction
  beyond the existing `acquired_notes` table.

**5. Eliana · Newer LP-only investor**
- Passive LP in two note funds. Doesn't operate. Receives K-1s.
- Pain: doesn't need AcreOS for ops — she needs aggregated yield + tax
  summary from her LP positions.
- Tool gap: no LP-position tracker for note funds (this might be out of
  scope for AcreOS entirely; flag).

---

### Intermediate tier (years 3–7)

**6. Fitz · Note flipper**
- Buys notes wholesale, flips to retail buyers within 30 days. ~6–10
  flips/month. Doesn't hold paper long-term.
- Pain: tracking inbound tape vs. outbound buyer list, with the deal
  margin between them.
- Tool gap: no "flipping" workflow distinct from "holding" — the
  pipeline assumes you keep the note.

**7. Geena · Reperforming note buyer**
- Buys non-performing 2nd-liens, modifies workout, reclassifies once
  borrower makes 12 on-time payments. ~20 active. ~5 in modification.
- Pain: tracking the 12-payment ladder per modified note. Missing a
  payment resets the counter; her current system is a manual
  spreadsheet.
- Tool gap: no "reperforming progress" counter; no auto-reclassify on
  threshold; no payment-streak field.

**8. Hugo · Tax-lien-to-note convertor**
- Buys tax certificates. When they don't redeem, they convert to deed
  or assignment, often financed back to the prior owner. Hybrid:
  tax-delinquent on the buy, note investor on the sell.
- Pain: living in two systems (tax-lien tracking + note tracking)
  without continuity.
- Tool gap: no flow from a tax-delinquent acquisition into a created
  seller-financed note as a downstream artifact.

**9. Iris · Mobile-home note specialist**
- Manufactured-home plus land deals only. ~30 active. Specific titling
  rules (DMV title vs. real-property title).
- Pain: chain-of-title custody — MH titles are often paper-only,
  recorded at DMV not the county.
- Tool gap: no manufactured-home title attribute on a note; no flag for
  "VIN-titled vs. real-property-titled."

**10. Jacques · Multi-state RMLO operator**
- Buys distressed seller-financed owner-occupied homes across 4 states.
  Has a captive RMLO who does loan estimates + closings.
- Pain: routing every owner-occupied deal to the RMLO at the right
  point. The RMLO needs the loan-estimate timer started before contract.
- Tool gap: no auto-route to RMLO; no loan-estimate timer; no
  state-specific Reg-Z timing dispatcher (we have the
  disclosure-timing dispatcher but it's for land contracts).

**11. Kit · Owner-occupied homestead lender**
- Exclusively finances owner-occupied homestead-protected properties.
  ~40 notes.
- Pain: homestead protection limits her recovery options if a note
  goes non-performing; she has to factor that in at acquisition.
- Tool gap: no "homestead protected" flag on collateral; no recovery-
  scenario calculator.

**12. Lev · Note + tax-delinquent dual operator**
- Buys distressed notes AND tax-delinquent properties. Treats them as a
  shared funnel — picks whichever has better margin per deal.
- Pain: no unified pipeline. She maintains two trackers.
- Tool gap: no shared "distressed-asset" pipeline that spans both
  notes and tax-delinquent properties.

---

### Veteran tier (years 7+)

**13. Maris · Veteran 1st-lien buyer**
- 20 years. ~100 active performing 1st-liens on suburban homes.
  Self-services.
- Pain: at scale, individual-note attention disappears — she needs
  exception-based alerts only (delinquencies, escrow shortfalls,
  insurance lapses).
- Tool gap: no SLA-style "alert me only when something is wrong"
  digest; no insurance-policy expiration tracker; no escrow-shortfall
  flag.

**14. Nico · NPL fund manager**
- 200+ non-performing 2nd-liens. Capital from accredited LPs.
- Pain: cohort-level reporting to LPs — "what's the bucketed status
  of the Q1 acquisitions, with $ recovery to date."
- Tool gap: no cohort-acquisition reporting; LP-statement generator is
  out of scope.

**15. Octavia · Veteran note flipper**
- 10 years. 200+ flips/year. Has a captive funding line.
- Pain: speed of due-diligence on a fresh tape. Wants to filter
  hundreds of rows in minutes.
- Tool gap: no tape-import UI with bulk filtering by criteria
  (referenced in note-investor-followups.md §1 — confirmed real).

**16. Park · Family-office allocator**
- Diversified across 5 asset types. Notes are 15% of book. Treats notes
  as the cash-flow leg.
- Pain: roll-up reporting — combined yield across notes / rentals /
  land / equities. Compatible accounting.
- Tool gap: no portfolio-level cross-vertical yield rollup (we have
  per-vertical metrics but no aggregate).

**17. Quinn · Note + 1031 strategy**
- Sells a leveraged property, 1031-exchanges into a note acquisition.
  Specific timing rules.
- Pain: 1031-identification deadline (45 days) + closing deadline
  (180 days) tracking with a note acquisition as replacement property.
- Tool gap: no 1031-into-note workflow (1031 exists for land/houses;
  not yet wired to notes).

**18. Reyna · Discount-fund operator**
- Buys note pools at 35–45 cents on the dollar. Expected loss factored
  into pricing. Recovery-focused.
- Pain: per-pool P&L tracking — "what did this pool actually return
  net of all recovery costs."
- Tool gap: no "pool" entity in the notes data model; no
  per-pool P&L view.

**19. Sully · Hedge fund acquisition lead**
- Institutional buying, $5M+ pools at a time. Heavy due diligence team.
- Pain: tape diligence with audit trail — every row decision
  attributed to an analyst, with reasoning, for IC review.
- Tool gap: no per-row analyst attribution on a tape diligence;
  no IC-package generator.

**20. Talia · Note broker**
- Doesn't hold paper. Brokers between sellers and buyers. Earns a
  spread or a flat fee per deal.
- Pain: managing a pipeline of buyer + seller intent simultaneously,
  matchmaking on criteria.
- Tool gap: no broker mode (or "marketplace" mode); the platform
  assumes operator-as-buyer.

---

### Niche tier (any years)

**21. Ursa · Servicer-of-record**
- Licensed sub-servicer for other note investors. Doesn't own paper —
  collects for owners.
- Pain: per-owner segregated accounting + remittance to each owner
  monthly.
- Tool gap: no servicer-mode entirely; AcreOS assumes the operator owns
  the note.

**22. Vasco · Commercial-land note buyer**
- Notes secured by commercial land (truck stops, billboard sites,
  cell-tower easements).
- Pain: yield depends on the underlying lease, not the borrower's
  paycheck. Underwriting model is completely different.
- Tool gap: no commercial-land note variant; collateral model assumes
  residential / land-flip valuation.

**23. Willa · Foreclosure-rescue investor**
- Buys NPLs SPECIFICALLY to bring borrowers current via modification.
  Treats it as a social mission as much as a business.
- Pain: PII handling of borrowers' hardship narratives + auto-redaction
  for any reports she shares.
- Tool gap: no PII-classified "hardship narrative" field; no auto-
  redacted export format.

**24. Xander · Partial-note investor**
- Buys partial interests in notes (e.g., first 60 months of P&I).
  Yield calculation specific to the carve-out.
- Pain: schedule splitting and recordkeeping for the carved interest
  vs. the residual.
- Tool gap: no partial-interest accounting on a note; no auto-split
  amortization.

**25. Yuna · Note + Roth-conversion strategy**
- Holds notes inside a Roth IRA she back-doored. Yield is tax-free,
  but custodian must approve every transaction.
- Pain: IRA-custodian paperwork lag. Each note acquisition requires
  authorization + recording of assignment in custodian's name.
- Tool gap: same as Brendan + Yuna's need is a templatable letter +
  custodian-pending status.

---

## Synthesized insights

Twenty-five personas → recurring themes, ranked by how many personas
benefit.

| # | Insight | Personas served | Already in repo? |
|---|---|---|---|
| 1 | **RMLO-required flag + state-usury reference + Reg-Z timing for notes** | Catalina, Jacques, Kit, Devon | No — disclosure-timing dispatcher only covers land |
| 2 | **Workflow templates per note lifecycle event** (payment received, NSF/missed, balloon approaching, insurance expiring, escrow shortfall, modification ladder progress) | Allison, Geena, Maris, all servicers | Partial — LTV Risk Alert + Note Payment Missed exist; missing 4+ more |
| 3 | **Reperforming progress tracker** (consecutive on-time payment streak; auto-reclassify) | Geena, Willa, Reyna | No |
| 4 | **Note "pool" entity** (group notes by acquisition cohort with shared diligence + P&L) | Nico, Reyna, Sully, Octavia | No — `acquired_notes` is one-per-row |
| 5 | **Tape-import wizard** | Octavia, Sully, Nico, Park | Tracked in note-investor-followups.md §1 (validated) |
| 6 | **IRA-custodian routing + templates** | Brendan, Yuna | No |
| 7 | **Manufactured-home title flag + DMV-titled vs real-property-titled** | Iris | No |
| 8 | **Servicer mode (operator services for other owners)** | Ursa | Out of scope — possibly large standalone effort |
| 9 | **Broker mode** | Talia | Out of scope — large standalone effort |
| 10 | **Originated vs acquired distinction reinforced** (some personas wear both hats) | Devon, Hugo | Schema has `acquired_notes`; need explicit `originated_notes` view |
| 11 | **Insurance-policy expiration + escrow-shortfall tracker** | Maris, Kit, Iris | No |
| 12 | **Per-pool P&L view + per-row analyst attribution on a tape** | Reyna, Sully | No |
| 13 | **Partial-note (carved-interest) accounting** | Xander | No |
| 14 | **Tax-delinquent → note conversion flow** | Hugo, Lev | No — Pillar L (tax-delinquent personas) will surface more |
| 15 | **1031-into-note timing workflow** | Quinn | Partial — 1031 exists for land; not wired to notes |
| 16 | **PII-classified hardship narrative + auto-redacted exports** | Willa | No |
| 17 | **Exception-based alerts digest** (only fire on anomalies, not every event) | Maris, all veterans | Partial — workflow engine exists; no digest aggregation |
| 18 | **Commercial-land note variant** | Vasco | No |
| 19 | **Cross-vertical portfolio yield rollup** | Park | No |
| 20 | **LP-position tracker** (for fund investors) | Eliana | Out of scope — AcreOS is operator software, not LP software |

## Action queue — what to ship from this pillar

Ranked by leverage (personas served × current gap size).

### A. Workflow templates — note lifecycle (highest ROI, ships fast)

Add to `server/services/workflow-engine.ts:LAND_INVESTING_WORKFLOW_TEMPLATES`:

1. **Note payment received** — `payment.received` trigger. Auto-send
   payment receipt to borrower; update streak counter; refresh
   reperforming progress (#3).
2. **Insurance policy expiring** — `note.insurance_expiring_60d`
   trigger. Create high-priority task; draft borrower letter
   requesting renewal proof.
3. **Escrow shortfall detected** — `note.escrow_shortfall` trigger.
   Create review task; draft borrower notice with proposed
   payment-increase amount.
4. **Reperforming threshold reached** — `note.reperforming_threshold`
   trigger (12 consecutive on-time payments). Create review task to
   reclassify; update Pax notification.
5. **Balloon approaching** — `note.balloon_approaching` trigger
   (90/60/30-day countdowns). Multi-stage notifications with
   per-stage borrower outreach drafts.

Wires #2, #3, #11 from the insights table.

### B. Persona vocabulary expansion for note sub-niches

`client/src/lib/personaVocabulary.ts` currently has 7 personas. Add
2 specialized sub-personas that solve real distinct workflows:

- **`note_originator`** — Devon, Hugo. "I'm the lender. I'm not
  servicing someone else's paper; this is paper I made." Lead →
  Borrower, Deal → Origination, Closed → Performing.
- **`note_servicer`** — Ursa, large-scale Maris. "I service paper for
  others or at scale where individual-note views break down." Lead →
  Note, Deal → Servicing event, Closed → Resolved.

Smaller change than schema work, ships fast.

### C. RMLO + state-usury reference card

A single static reference module + a `requiresRmlo: boolean` flag on
the note creation form. Doesn't need a full state-regulatory engine —
just a Reg-Z timing reminder and a "looks like an owner-occupied 1-4
family residential loan, RMLO probably required" advisory.

`shared/regulatory/rmloAdvisor.ts` — a pure function that takes the
note's metadata + state + collateral type and returns
`{ rmloLikelyRequired, regZTimingApplicable, stateUsuryCap }`. Surface
on the note creation form + a "Compliance posture" panel on the note
detail page.

Wires #1 and the regulatory side of #2.

### D. Reperforming progress field on `acquired_notes`

Schema addition: `consecutiveOnTimePayments INTEGER DEFAULT 0`,
`reperformingThresholdMet BOOLEAN`. Auto-incremented by the
`payment.received` workflow. Auto-reset on `payment.missed`. Threshold
defaults to 12 (founder-configurable per-org).

Wires #3.

### E. Documented out-of-scope / queue items

The rest get added to `note-investor-followups.md` as new sections so
the next contributor sees them: pool entity (#4), IRA-custodian routing
(#6), MH title flag (#7), insurance/escrow trackers (already in A),
partial-note accounting (#13), commercial-land variant (#18), cross-
vertical rollup (#19), PII-classified narratives (#16). Each gets
~3 sentences + an estimated build size.

---

## What ships in this PR

Five concrete code deliverables (sized to land in one batch):

1. Five new workflow templates (note-payment-received, insurance-
   expiring, escrow-shortfall, reperforming-threshold,
   balloon-approaching).
2. Two new personas in `personaVocabulary.ts` (`note_originator`,
   `note_servicer`) plus their vocabulary entries.
3. New `shared/regulatory/rmloAdvisor.ts` pure-function module.
4. `acquired_notes` schema addition: `consecutive_on_time_payments` +
   `reperforming_threshold_met` (with the migration).
5. Append the out-of-scope items to
   `docs/exhaustive-completion/note-investor-followups.md` so the
   pillar's queue stays one search away.
