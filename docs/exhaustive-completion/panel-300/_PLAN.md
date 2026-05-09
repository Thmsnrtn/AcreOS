# Panel-300 Actionable Plan

**Source:** `_ROSTER.md` (300 personas) + 20 category files +
`_SYNTHESIS.md` (cross-cutting).
**Date:** 2026-05-08.
**Companion to:** `_FORWARD-SYNTHESIS.md` (20-panel) and
`_DECISIONS-PACKET.md` (founder forks).

This is the deliverable: a prioritized, horizon-stratified backlog
with effort estimates, dependencies, and verification gates. Reads
top-to-bottom as a 365-day work order. Each row traces to ≥1
category synthesis; founder-judgment items flagged explicitly.

---

## The thesis (in two sentences)

The 300-panel agrees AcreOS is **safe but not legible, sellable but
not scalable, and credible but not contractual.** Translation: the
next 90 days convert the rock-solid foundation into operational
rigor (API contracts, eval gating, DR drills, substantive
attestations, role-scoped permissions) and the next 180 expand
defensibility into moats (domain-expert workflows, fair-lending
audit, SOC 2, hire 3 engineers, customer narrative). Capital and
breadth decisions stay deferred until the operational gates exist —
which they don't yet.

---

## Five operational gates that gate everything else

The 300-panel's most surprising reframe of the 20-panel: D1 capital,
D2 breadth, D6 BH, D8 eval are *not founder forks first*. They're
**dependencies on five operational gates that don't exist yet.** Until
the gates ship, every founder-decision rests on incomplete data.

| Gate | What it produces | Without it, you can't… |
|---|---|---|
| **G1: Eval-as-gate (T1)** | Verdicts on every Pax/complianceAI generation; reject-on-fail audit log | Defend the AI surface in SOC 2 audit or class-action discovery |
| **G2: API contract layer (T2)** | OpenAPI from Zod, validateBody, schemathesis CI | Prevent silent breaking-changes that destroy customer trust |
| **G3: Idempotency + circuit-breaker + rate-limit triad (T3)** | Replay protection across webhooks; service-failure containment | Survive a vendor outage or an Asher-takeover replay |
| **G4: Substantive attestation + adverse-action specificity (T4)** | 3-screen FCRA forms with CRA-cited notices; TILA timing cron | Scale BH or skip-trace beyond TX/OK without litigation exposure |
| **G5: DR drill + blue/green deploy + MTTR target (T5)** | Quarterly restore-time validation; instant rollback; postmortem template | Sustain >$50K MRR with founder-sleep nights |

**Sequencing rule:** ship G1-G5 in the next 30-90 days. Founder-
judgment items (D1/D2/D6/D8) get RFC'd in parallel, resolved AFTER
the gates land. Picking before the gates is picking with one eye
closed.

---

## Next 30 days (through 2026-06-08)

The 30-day window is the gates + the founder-decisions track in
parallel. 15 items, ranked.

| # | Item | Effort | Source | Status |
|---|---|---|---|---|
| 1 | **G1 — Eval harness as gate** (reject-on-fail; pass-rate ≥95% on critical-severity cases; block deploy on miss) | M | T1 + ai-ml-eng + security-compliance + adversarial-stress | extends FW-THEO-1 + FW-INDIRA-1 (data layer shipped) |
| 2 | **G2 — API contract layer** (OpenAPI from Zod + validateBody on every route + schemathesis in CI) | M | T2 + backend-eng + frontend-eng + devops-sre | new |
| 3 | **G3 — Idempotency + circuit-breaker + rate-limit triad** (idempotencyKeys table + circuit breakers wrapping Anthropic/Stripe/SendGrid/Twilio + 10 req/sec per IP + auth-fail lockouts) | M | T3 + backend-eng + devops-sre + security-compliance + adversarial-stress | extends P0-10 |
| 4 | **G4 — Substantive 3-screen FCRA/skip-trace attestation + CRA-cited adverse-action** (replaces FW-WYNNE-2's jsonb-only form with a live UI) | M | T4 + security-compliance + adversarial-stress | extends FW-WYNNE-2 |
| 5 | Persona-aware checklist (FW-YUNA-1 already shipped) + WCAG 2.2 AA pass on 5 surfaces + iOS safe-area + 44px targets + react-window on `/leads` | M | T6 + frontend-eng + product-design-ux | extends FW-YUNA-1 |
| 6 | Discovery-intake rubric + SDR routing (founder unblock; ≤30min discovery → ≤15min sales-eng → ≤45min close) | S | sales-gtm + marketing-growth + executive-strategy | new (launch kit primes this) |
| 7 | Real-money note-ledger acceptance test on Wendell's portfolio (1w dedicated QA on top of FW-WENDELL-1 1,000-sched paranoia test) | S | customers-verticals + executive-strategy | extends FW-WENDELL-1 |
| 8 | Pre-commit hook + ESLint codename ban + import sort + lint-staged + Husky migration audit | S | eng-leadership + frontend-eng | already healthy; verify |
| 9 | **FOUNDER-JUDGMENT (D1-comp):** Pick AppFolio 10x vs Procore 14x vs ServiceTitan 12x as narrative anchor; drives pricing, hiring, deck framing | S | T8 + investors-capital + executive-strategy | RFC by 2026-05-22, decision by 2026-06-08 |
| 10 | **FOUNDER-JUDGMENT (D6-BH):** TX/OK geofence shipped as `enabled_states` enum on `tenant_screenings` + Stripe checkout gate + "Coming Q4" honest banner for non-supported states | S | adversarial-stress + security-compliance + customers-verticals | gates BH non-TX/OK launch |
| 11 | Hire kickoff: post fullstack + backend + SRE roles by 2026-05-15; IC3-to-Principal ladder doc (1-page) | S | eng-leadership + executive-strategy + investors-capital | bus-factor mitigation |
| 12 | Customer-launch kit field test: invite first 5 friendly customers; run them through `docs/launch/01-friendly-customer-onboarding-script.md` | S | sales-gtm + cs-support + product-leadership | docs ready (Direction-1 commit) |
| 13 | Schema-monolith documentation pass: 1-page reference doc per vertical (`docs/schema/`) — bus-factor + onboarding new hires | S | eng-leadership + product-leadership | new |
| 14 | Pricing-elasticity A/B test setup ($199 vs $249 Solo) — instrument now, run for 14 days, conclude before 90-day backlog kicks off | S | product-leadership + investors-capital + sales-gtm | new |
| 15 | Founder-letter cadence start: 1 letter per week starting 2026-05-15 — uses FW-DIEGO-1 already-shipped backbone | S | marketing-growth + cs-support + executive-strategy | extends FW-DIEGO-1 |

**30-day verification gates (by 2026-06-08):**
- G1, G2, G3, G4 in production with green pass-rates
- 5 friendly customers onboarded; time-to-aha ≤4:00 measured
- D1-comp picked (Procore vs AppFolio vs ServiceTitan); narrative paragraph published
- D6 geofence enforced; banner live on non-TX/OK BH surfaces
- 3 engineers under offer; founder-letter cadence at 4 published

---

## Next 90 days (through 2026-08-08)

15 items. The gates are done; this is the moats + the diligence-readiness layer.

| # | Item | Effort | Source |
|---|---|---|---|
| 16 | **G5 — Quarterly DR drill** (run + measure + document RTO/RPO + blue/green deploy with 1-click rollback + postmortem template + status page + MTTR <15min target) | M | T5 + devops-sre + eng-leadership |
| 17 | Hallucination detector + prompt-injection sanitizer + "skip-trace without screening follow-up" abuse pattern in `anomaly_detector.ts` | M | T9 + ai-ml-eng + security-compliance + adversarial-stress |
| 18 | Role-scoped permission model: `hasRoleScope()` + 8 permission-guarded routes + async report-delivery for VAs/bookkeepers/attorneys/family-co-owners | L | T7 + customers-roles + customers-verticals + security-compliance |
| 19 | Reconciliation cron: nightly Stripe/wire/1099 reconciliation + audit-log every discrepancy + tile-quota-cost dashboards (extends FW-MARISOL-2/3) | M | T8 + adjacent-industries + executive-strategy |
| 20 | Disclosure-timing cron (TILA T-3 by construction; closing_date → disclosure_send_date → cron fires) + statutory-form registry per state | M | T10 + adjacent-industries + adversarial-stress + domain-real-estate |
| 21 | Hire complete: 3 engineers onboarded by 2026-08-01; ramp-time ≤4w via internal `/docs/schema/` per vertical (T12 deliverable) | L | T12 + eng-leadership + executive-strategy |
| 22 | Multi-vertical consolidated P&L + W-2-exit calculator (Magnus / Imani personas) — converts $79 → $379 ARPU | M | H2 + customers-verticals + customers-roles + future-emerging |
| 23 | Deal-room growth-loop retrofit complete: signup CTA on FW-MIREILLE-1 share-page + utm_source attribution + weekly waterfall measurement | M | T8 + marketing-growth + sales-gtm + cs-support |
| 24 | D30 verdict-branching shipped (FW-CAMILA-1 already wired) + 1:many CSM automation (cohort views, weekly digest, in-app NPS) + power-user dashboard | M | cs-support + product-leadership + customers-verticals |
| 25 | Vendor adoption telemetry: 5 vendors (Stripe, Clerk, Lob, Sentry, Regrid) with adoption %, DAU, error rate, freshness — extends `/founder/financials` | M | T8 + vendor-partners + executive-strategy |
| 26 | GDPR DSAR endpoint with 24h SLA + quarterly self-DSAR audit (extends FW-SAM-2 sub-processor list) | M | H1 + adversarial-stress + security-compliance |
| 27 | Pricing-elasticity A/B test conclusion + roll-forward; vertical-pack price-anchor optimization from FW-TEGAN-1 baseline | S | product-leadership + investors-capital + sales-gtm |
| 28 | **FOUNDER-JUDGMENT (D2):** depth-vs-breadth resolution by 2026-08-08; right-staff product org to match | S | T12 + product-leadership + eng-leadership + customers-verticals |
| 29 | **FOUNDER-JUDGMENT (D8):** eval-harness ownership (engineering through Series-A close, then flip to compliance for SOC 2 prep) | S | ai-ml-eng + eng-leadership + security-compliance |
| 30 | Public-comp benchmarking dashboard cadence (monthly board review vs. AppFolio/Procore/ServiceTitan) feeds D1 + Series-A narrative | S | T8 + investors-capital + executive-strategy |

**90-day verification gates (by 2026-08-08):**
- G5 DR drill ran successfully; RTO/RPO documented; blue/green live
- Role-scoped permissions in production; ≥3 non-operator personas onboarded (a VA + a bookkeeper + an attorney-as-customer)
- D30 verdict cohorts measurable; 1:many CSM automation cuts founder-time-on-CS by 50%
- NRR endpoint reports a real number (cohort-2 data exists); customer-concentration <20% top-1 share
- D2 resolved (Land+NI wedge OR multi-vertical breadth); product org right-staffed
- 5 vendor adoption dashboards live; COGS-per-customer attributed
- 8-12 founder letters published; community feedback loop measured

---

## Next 180 days (through 2026-11-08)

15 items. The narrative + governance layer for Series-A or acquirer
diligence. This is where AcreOS becomes legibly investable.

| # | Item | Effort | Source |
|---|---|---|---|
| 31 | SOC 2 Type I evidence collection via `/founder/compliance-dashboard` (Drata/Vanta integration); auditor-ready package by 2026-10-01 | L | T12 + security-compliance + investors-capital |
| 32 | Title/courthouse/Regrid data-feed — Texas Tier 1 (10 counties) + California Tier 2 (5 counties); real-time parcel push (24h → 2h) | L | T11 + domain-real-estate + vendor-partners |
| 33 | CMA-builder + auction-readiness checklist + lien-search registry — domain-expert moats (Ruairidh, Lev, Imogen) | L | H4 + domain-real-estate + customers-verticals |
| 34 | Fair-lending audit + RESPA vendor-referral-fee public transparency page + monthly fair-lending cron (>5% divergence flags) | M | T10 + adversarial-stress + security-compliance |
| 35 | State-by-state contract-for-deed templates + statutory_form versioning + 2-year resign cadence | M | T10 + domain-real-estate + adversarial-stress |
| 36 | Schema modularization Phase 1: split `shared/schema.ts` (17,468 LOC) into per-vertical files + cross-cutting common; eliminate migration collision | L | eng-leadership + backend-eng + ines-travers (returning) |
| 37 | Founder-dashboard v2 extraction: founder-home tile composition, ops console split, owner-experience refactor | L | eng-leadership + product-leadership + product-design-ux |
| 38 | Tiered external pen-test (Phase 1 public+admin $3K, Phase 2 API $5K); remediate findings by 2026-11-01 | M | adversarial-stress + security-compliance |
| 39 | Note Investor closed-beta GTM: 5 customers @ $50/mo → 10 customers @ $500/mo; uses customer-launch kit + the multi-vertical P&L | M (GTM) | sales-gtm + product-leadership + customers-verticals |
| 40 | Wordmark commission + agent origin paragraphs + motion signatures; brand visual system unification | M | product-design-ux + marketing-growth |
| 41 | Power-user dashboard expansion: cohort weekly query → quarterly trend; tier ascent / descent attribution | S | cs-support + customers-verticals |
| 42 | Pax prompt versioning + caching (saves ~20% tokens; baseline-cost benchmark for Series-A pitch) | M | ai-ml-eng + executive-strategy |
| 43 | Co-investor invite layer on deal-rooms (extends FW-MIREILLE-1 with multi-org sharing + permission matrix) | M | marketing-growth + customers-verticals + customers-roles |
| 44 | Founder office hours weekly cadence + ambassador recruitment + 1 customer video per vertical | M | marketing-growth + cs-support + executive-strategy |
| 45 | CRO hire trigger evaluated: at $50K+ ACV first NI customer, formalize hire process | S | sales-gtm + executive-strategy + investors-capital |

**180-day verification gates (by 2026-11-08):**
- SOC 2 Type I package complete; auditor sign-off
- Texas + California title-feed integrations live; lien-search 95% completeness
- Fair-lending audit ran; vendor-referral-fee transparency page live
- Schema split into per-vertical files; migration collision resolved
- Pen-test report received; ≥80% findings remediated
- 10 NI customers paying; ≥3 verticals at named-revenue gates
- Founder-letter cadence sustained 24 weeks unbroken
- D1 capital strategy resolved (raise OR exit OR bootstrap); pitch deck or data room ready

---

## Next 365 days (through 2027-05-08)

10 items. The horizon where capital strategy ships and the platform
becomes either a Series-A grower, an acqui-hire, or a sustainable
bootstrap.

| # | Item | Effort | Source |
|---|---|---|---|
| 46 | **D1 Resolution Phase 2:** Series-A close ($12M / $60M post on multi-vertical-SaaS thesis) OR clean acqui-hire LOI ($14M-$18M to Buildium/Yardi/AppFolio) OR bootstrap with milestone-based debt | strategic | T8 + investors-capital + executive-strategy |
| 47 | Canada (ON+BC) portability pilot — precedes UK; gated on 2 US verticals @ $500K ARR each (reframes 20-panel H4) | L | H3 + future-emerging + investors-capital |
| 48 | Per-seat metering wired backend-side (toggle-able post-funding; Bryn's Series-A credibility anchor) | M | T8 + product-leadership + investors-capital |
| 49 | International compliance scaffold: GDPR full + UK ICO + AU OAIC + Canada PIPEDA framework | M | future-emerging + security-compliance |
| 50 | NRR ≥120% sustained; gross margin ≥70%; bus-factor mitigated (VP Product or technical co-founder hired) | strategic | executive-strategy + investors-capital |
| 51 | Founder-dashboard v3 (operator-experience-first; consumer-grade ops console replacing legacy /founder-home) | L | product-design-ux + product-leadership |
| 52 | Trademark filing (USPTO IC 042 + IC 036) + Snyk/FOSSA license audit + IP defensibility review | S | executive-strategy + security-compliance |
| 53 | Schema modularization Phase 2: per-vertical schema files own their migration cycle; founder-dashboard refactored to consume modular APIs | L | T2 + backend-eng + eng-leadership |
| 54 | OpenAI bypass migration to `routeAITask` — top-10 callsites migrated; cost-attribution per-org complete | L | ai-ml-eng + executive-strategy |
| 55 | Hallucination eval expansion beyond Pax draft (board votes, self-assessment, complianceAI disclosures) — corpus N≥500 cases | L | T1 + ai-ml-eng + security-compliance |

**365-day verification gates (by 2027-05-08):**
- D1 resolved with concrete outcome (raise / exit / bootstrap)
- $1.5M+ ARR; NRR ≥120% sustained 3+ months
- Schema modularization Phase 1 + 2 done; bus-factor mitigated
- Canada pilot live; UK audit complete
- Hallucination eval N≥500 cases; pass-rate >97% on critical-severity
- AcreOS team ≥7 (founder + 3 eng + VP Product + CSM + CRO-or-bizdev)

---

## Founder-judgment items — the 4 forks

Each fork has a 30-day or 90-day forcing date. Do NOT pre-decide before
the 5 gates land — the data the gates produce is what makes the fork
decidable.

| # | Fork | Forcing date | What needs to be true to decide |
|---|---|---|---|
| 21 | **D1-comp** (which public comp anchors our valuation: AppFolio 10x / Procore 14x / ServiceTitan 12x) | 2026-06-08 | Pricing-elasticity A/B test conclusion + 5 customer onboarding patterns + Bryn-Halliday writeup |
| 22 | **D2** (depth-vs-breadth: Land+NI wedge or multi-vertical breadth or community-signal hold) | 2026-08-08 | NI revenue gate evaluation ($50K net-new ARR) + multi-vertical operator (Magnus persona) feedback |
| 23 | **D6** (BH geofence: TX/OK only or nationwide compliance-by-state) | Before first BH non-TX/OK signup | Substantive attestation form live + state-specific disclosure registry seeded for top-3 (CA, NY, FL) |
| 24 | **D8** (eval ownership: engineering or compliance or hybrid stage) | SOC 2 Type II audit kickoff (2026-10) | Eval pass-rate trend + first compliance-audit dry-run + Theo / Indira capacity check |

---

## What we're NOT doing (panel-rejected non-goals)

The 300-panel was emphatic about deferrals. These items appear in
roughly half the categories as "we should do this!" but the synthesis
explicitly rejects:

1. **No paid Slack/Discord community in 2026** — Diego/Ana convergence: founder-letter beats real-time at <200 customers. (D9 stays deferred.)
2. **No EU launch in 2026** — too many tax regimes, compliance regimes, and disclosure regimes for the team size. UK BTL is post-Series-A; Canada pilot precedes UK. (D5 stays sequenced.)
3. **No Wholesale Lending vertical (#7) until $50K ARR on NI** — Caspar revenue gate. (Founder D2 fork.)
4. **No paid acquisition until deal-room loop conversion ≥3%** — Mireille principle. (Already in 30-day rollout.)
5. **No founder-dashboard v2 extraction until customer 150+** — Ines + Vesper convergence: schema-monolith refactor + dashboard extraction would burn velocity during the only window where velocity matters. (Stays in 365-day.)
6. **No model rotation (Opus 4.6 → 4.7 etc.) without eval pass ≥98% on critical-severity** — Indira / Theo gate. (Compliance-mandatory.)
7. **No automated underwriting decisions in BH** — Reg-B / Wynne convergence: triggers disparate-impact liability without bias-audit infrastructure. (Indefinite defer.)
8. **No Web3/tokenization (Pelagia)** — interesting but pre-imaginary; Pelagia herself flags as "design-aware, do not implement until post-Series-A and customer signal." (Stays in design space.)

---

## Verification cadence (how the founder knows it's working)

- **Weekly (15 min):** review `/founder/financials` + `/founder/synthetic-checks/recent` + `community_letters` cadence.
- **Bi-weekly (30 min):** review the gate-status table (G1-G5) — green/yellow/red per gate.
- **Monthly (1 hr):** Top-30 backlog status flip (this doc); `_DECISIONS-PACKET.md` re-evaluation.
- **Quarterly (half-day):** synthesis vs reality; founder-judgment items re-evaluation; 365-day horizon refresh.

---

## How this plan got built

300 personas across 20 categories produced 300 individual memos +
20 category-level syntheses + 1 cross-category synthesis. This plan
clusters them. Where personas disagreed, the synthesis surfaces the
conflict in `_SYNTHESIS.md §5`; this plan does not adjudicate — the
founder does, with the data the gates produce.

The 30-day backlog is the gate-laying phase. The 90-day is the
moat-and-diligence phase. The 180-day is the audit-and-trust phase.
The 365-day is the capital phase.

Read the file. Mark items shipped as you ship them. The plan is a
living document; flip statuses, add new items as new evidence
surfaces, kill items when their premise expires.

---

*Authored 2026-05-08 by panel-300 synthesis on top of 300 persona
memos + 20 category syntheses + 1 cross-cutting synthesis. The
prior 211-corpus and 20-panel are in scope; this plan supersedes
neither — it composes with both.*
