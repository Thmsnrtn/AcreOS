# Panel-300 Cross-Category Synthesis

*Synthesized 2026-05-08 from 20 category-level syntheses (300 personas
total). Companion to `_FORWARD-SYNTHESIS.md` (20-panel) and
`_DECISIONS-PACKET.md` (4 founder-judgment items). This document
clusters across categories; it does not author new recommendations.*

---

## 1. The thesis

The 300-panel says the AcreOS engineering surface is **safe but not
legible, sellable but not scalable, and credible but not contractual.**
RS-1..RS-7 + the 21/24 P0 sweep + ESIGN integrity stack closed the
safety vector that the 20-panel already named. What the 300-panel
adds — and where it diverges from the 20-panel — is operational rigor
underneath the demo: API contracts (Quentin/Marisol/Yusuf), eval
gating (Naoki/Devika), DR drills that actually run (Ananya/Janosch),
CSP/auth-rate-limit/abuse detection (Henrietta/Ife/Magdalena),
reconciliation discipline (Yusra/Penelope), substantive attestations
(Ophelia/Wynne), role-scoped permissions (Catalina/Hudson), and a
fair-lending audit before BH scales (State AG/Wynne). Where the
20-panel saw four founder forks (D1/D2/D6/D8), the 300-panel reframes
them as **dependencies on five operational gates that don't yet
exist** — and refuses the 20-panel's polite framing on three:
governance (adversarial says deeper), depth-vs-breadth (customers-
verticals says go deeper than Caspar already wants), and capital
strategy (investors-capital says pick a comp before D1).

---

## 2. Cross-category convergence map

Themes appearing in ≥4 category syntheses. Sourced from the bottom-of-
file synthesis blocks; "code surfaces" cited only where the category
memo named them.

| Theme | Categories converged | Code/metric surface |
|---|---|---|
| **T1: Eval harness as gate, not observability** — Pre-flight test cases on every Pax/complianceAI generation, reject on fail, audit-log the rejection. Distinct from the 20-panel's "ship eval harness v0" because here it's a *gate*, not telemetry. | ai-ml-eng, security-compliance, eng-leadership, product-leadership, executive-strategy, adversarial-stress | `aiEvalHarness`, `ai_test_cases`, `complianceAI.ts:303` post-validator, `ai_output_flags` |
| **T2: API contract layer (OpenAPI + Zod + breaking-change CI)** — Generate OpenAPI from `shared/schema.ts` at build, validateBody middleware on every route, schemathesis in CI, X-API-Version header. Prevents the silent-drift the 300-panel saw 15 times in 6 months on `/api/leads`. | backend-eng, frontend-eng, devops-sre, vendor-partners, product-leadership | `shared/schema.ts`, all `routes-*.ts`, `/api/deprecations`, `routes-api-docs.ts` |
| **T3: Idempotency + circuit breaker + rate-limit triad** — Beyond the 20-panel's P0-10 fix, the 300-panel wants idempotencyKeys table, per-webhook rate limits, and circuit breakers wrapping Anthropic/Stripe/SendGrid/Twilio. Adversarial adds 10 req/sec per IP + auth-fail lockouts. | backend-eng, devops-sre, security-compliance, adversarial-stress, vendor-partners, ai-ml-eng | `circuitBreaker.ts`, `webhookHandlers.ts`, `routes-ai.ts`, `anomaly_detector.ts` |
| **T4: Substantive attestation + adverse-action specificity (theater that works in depositions)** — Replace checkbox UX with 3-screen FCRA/skip-trace/permissible-purpose forms. CRA-cited adverse-action notices tied to screening timestamp (not batch cron). Disclosure-generation BEFORE signature (TILA timing gap). | security-compliance, adversarial-stress, customers-verticals, domain-real-estate, adjacent-industries, product-design-ux | `fcra_attestations.substantive_form`, `adverse_action_records`, `disclosure_registry`, TILA timing cron |
| **T5: Disaster recovery + deploy safety actually drilled** — Not "we have backups" but quarterly DR drill with restore-time validation, blue/green on Fly with instant rollback, postmortem template, MTTR <15min Sev-1. The 20-panel didn't name MTTR or RTO; the 300-panel does. | devops-sre, security-compliance, vendor-partners, eng-leadership, adjacent-industries | `/docs/runbooks/`, Fly blue/green config, postmortem template, status page |
| **T6: Persona-aware, mobile-first, accessibility-floor frontend** — Persona-keyed checklist (already 20-panel C6), but extended: WCAG 2.2 AA on 5 surfaces, iOS safe-area, 44px targets, react-window virtualization on `/leads`, map clustering on `/properties`. Time-to-aha ≤4:00. | frontend-eng, product-design-ux, customers-verticals, customers-roles, future-emerging | `GettingStartedChecklist`, `/properties` map, `/leads` table, `client/sw-registration.ts` |
| **T7: Role-scoped permissions + async report-delivery + advisor co-pilot** — VAs, bookkeepers, attorneys, retiring operators, family co-owners need *different* views — read-only, annotation-only, email-PDF-only. The 20-panel did not surface this; customers-roles + customers-verticals + domain-real-estate did. | customers-roles, customers-verticals, domain-real-estate, security-compliance, adjacent-industries | `hasRoleScope()` helper, `advisory_notes` table, `/api/reports/email`, 8 permission-guarded routes |
| **T8: Reconciliation, COGS attribution, and pricing-elasticity discipline** — Subscription-event ledger (already 90-1) + nightly Stripe/wire/1099 reconciliation + tile-quota-cost dashboards + pricing-A/B test ($199 vs $249 Solo) before Series-A. | executive-strategy, investors-capital, sales-gtm, product-leadership, vendor-partners, adjacent-industries | `subscription_events`, `/founder/financials`, `/founder/marketing-sla`, `/founder/capacity` |
| **T9: Hallucination + injection + abuse-pattern detection** — Beyond eval: cite-verification via RAG, ARV-vs-comps reasonableness, disclosure-field-vs-schema match, prompt-injection sanitizer, "skip-trace without screening follow-up" abuse pattern. | ai-ml-eng, security-compliance, adversarial-stress, customers-verticals, future-emerging | `hallucinationDetector.ts`, `promptInjectionSanitizer.ts`, `anomaly_detector.ts` |
| **T10: Fair-lending audit + state-by-state disclosure registry + RESPA referral-fee transparency** — Pre-BH-scale historical disparate-impact audit; monthly fair-lending cron flagging >5% divergence; vendor-referral-fee table + public `/transparency/vendor-partnerships`. State-specific contract-for-deed templates re-signed every 2 years. | adversarial-stress, security-compliance, customers-verticals, domain-real-estate, product-leadership, executive-strategy | `fair_lending_audit` job, `vendor_referral_fees` table, statutory_form registry |
| **T11: Title/courthouse/Regrid data-feed currency + lien-search completeness** — Real-time parcel push (Regrid 24h → 2h), lien-type registry (judgment + tax + mechanic + HOA), MLS-license-term enforcement, courthouse-feed daily refresh dashboard. Tier 1 Texas, Tier 2 California. | domain-real-estate, vendor-partners, customers-verticals, adversarial-stress, future-emerging | Regrid push subscription, `lien_search_completeness`, MLS license guard |
| **T12: Hiring + bus-factor + IC ladder + engineering brand** — Hire 3 engineers by 2026-06-08 (fullstack + backend + SRE), schema OSS-style docs to prevent bus-factor, IC3-to-Principal ladder (1-page), 3 engineering blog posts, "Why I Shipped X" videos. The 365-7 founder-judgment moves up to 90-day work. | eng-leadership, executive-strategy, investors-capital, product-leadership, marketing-growth | Internal `/docs/schema/` per vertical, ladder doc, ATS pipeline |

---

## 3. Single-category high-conviction calls

Non-obvious moves where one category is making a contrarian bet that
survives synthesis even though only one category surfaced it.

| # | Category | Move | Trade-off accepted | Why it survives |
|---|---|---|---|---|
| H1 | **adversarial-stress** | **GDPR DSAR endpoint with 24h SLA + quarterly self-test** (Mei-Lin Park, persona 270). Hire DPO or outsource; build `/api/privacy/dsar` to export-everything within 24h; quarterly self-DSAR audit. | Builds compliance ahead of EU customer demand. Hostile-aggressor pattern (file 10 staggered DSARs, count days, file regulator complaint). | Privacy 90-11 already shipped sub-processor list; the missing piece is the *response cron + measurement*. €20M GDPR fine = 4% of Series-A revenue. Cheaper now than post-Series-A. |
| H2 | **customers-verticals** | **W-2-exit calculator + multi-vertical consolidated P&L** for Magnus/Imani personas. Operators running 2+ verticals churn to Excel without cross-vertical IRR view. | Builds expansion-revenue lever before sales/CS team is in place. Camila/Mireille framing this as retention, not features. | Revenue per Magnus jumps from $79 → $379 (Land+NI+BH packs). The 20-panel pricing model (vertical-packs) already supports this; the *visualization* is missing. |
| H3 | **future-emerging** | **`regions_available` enum audit during US stabilization** (Phoebe was 20-panel; the 300-panel adds Lachlan + Nadia: pilot Canada ON+BC *before* UK). Mark every feature with portability, identify 60% US-specific. | Caspar/Ashok say defer. Phoebe says audit, don't ship. The 300-panel sides with audit-now because the audit informs whether vertical-7 is wholesale-lending or Canada-Land. | Canada-first is a 300-panel insight (3x easier than UK; Land Registry is comparable; same investor persona). Reframes the international decision. |
| H4 | **domain-real-estate** | **CMA-builder + auction-readiness + lien-search registry** (Ruairidh, Lev, Imogen). Pre-close verification surfaces with one-click "ready to close/auction" sign-offs by domain expert. | 6 weeks of vertical-specific UI work that the 20-panel deprioritized in favor of horizontal eval/COGS work. | These are the *moats* a competitor can't copy in a quarter. They convert AcreOS from a CRM-with-billing into a defensible workflow tool for the 5 domain-expert personas the 300-panel surfaced. |
| H5 | **adjacent-industries** | **Disclosure-timing automation via cron** (Mariana, Heath). closing_date → auto-calculate disclosure_send_date (T-3 days) → cron fires → delivery confirmed. Zero manual workflow = zero TILA timing violations *by construction*. | Adversarial-stress wants substantive forms; adjacent-industries wants the *cron schedule* underneath. Both, sequenced. | TILA timing violation = $5K per infraction × 100 customers = $500K liability. The cron is 1w; the forms are 2w. Both ship. |
| H6 | **vendor-partners** | **Map-quota optimization + Regrid real-time push** (60% tile reduction = $400/mo + parcel-data 24h → 2h). | Cuts a vendor cost while improving data freshness; usually you trade one for the other. | Already-instrumented vendor adoption telemetry; this is the second-order optimization. Fits the COGS-per-customer dashboard (T8). |
| H7 | **eng-leadership** | **RFC the 4 founder-judgment decisions** (D1/D2/D6/D8) with ≥5 substantive comments per RFC *before* founder resolves. Treat the 4 as governance artifacts, not founder-private. | Slows D1/D2/D6/D8 by 1-2 weeks; founder may already have a clear answer. | The 300-panel's eng-leadership category insists irreversible decisions get RFC discipline. Pasha + Oren cite the API-stability precedent. Cheap insurance. |

---

## 4. Category-by-category top-1

| Category | Top-1 |
|---|---|
| ai-ml-eng | Eval harness → circuit-breaker gate on Pax + complianceAI (Naoki + Caelan + Devika) |
| backend-eng | API contract layer (OpenAPI from Zod + validateBody + schemathesis CI) |
| frontend-eng | Component refactor for correctness + memoization (Saoirse + Adira + Linus) |
| devops-sre | Runbook completeness + incident response discipline (postmortem template + MTTR target) |
| security-compliance | SOC 2 Type I evidence collection via `/founder/compliance-dashboard` (Caspian + Ravi) |
| product-design-ux | Progressive disclosure + cognitive load reduction on 5 core surfaces |
| eng-leadership | RFC the 4 founder-judgment decisions before founder resolves |
| product-leadership | Resolve D2 (depth vs breadth) by 2026-06-08, then right-staff product org |
| executive-strategy | Write the AcreOS narrative (1 paragraph) BEFORE resolving D1/D2/D6/D8 |
| investors-capital | Model two TAM scenarios (single-vertical vs multi-vertical); let TAM drive D2 |
| sales-gtm | Discovery-intake rubric + SDR routing to unblock founder from 100% sales |
| marketing-growth | Deal-room growth-loop retrofit before hiring growth marketer |
| cs-support | Complete D30 verdict-branching + 1:many CSM automation (parallel) |
| customers-verticals | Real-money note-ledger acceptance test (1w dedicated QA) |
| customers-roles | Role-scoped permission model + auth middleware guards (3w) |
| domain-real-estate | Title/courthouse data-feed integration (Texas Tier 1, California Tier 2) |
| vendor-partners | Adoption telemetry + success-metrics dashboards across 5 vendors |
| adversarial-stress | Substantive adverse-action attestation + CRA specificity (replaces checkbox theater) |
| adjacent-industries | Reconciliation + dispute audit trail (nightly Stripe/wire/1099 + audit log) |
| future-emerging | International portability audit + Canada (ON+BC) pilot first, UK after |

---

## 5. Conflict map

Explicit divergences across categories of the 300-panel.

| # | Conflict | Side A | Side B | Side C |
|---|---|---|---|---|
| K1 | **D1 capital strategy** | investors-capital, executive-strategy: pick comp first (AppFolio 10x vs Procore 14x), then raise/exit follows | adversarial-stress, security-compliance: don't raise until SOC 2 Type I lands + DSAR endpoint shipped — diligence will surface gaps | future-emerging: bootstrap to month-10 milestone-based (Júlia micro-VC), Series-A only if Land+NI both >$300K ARR |
| K2 | **D2 depth vs breadth** | customers-verticals (Wendell, Marlena), product-leadership: Land+NI wedge — freeze the other 4 verticals at feature-complete | future-emerging, customers-roles: multi-vertical operators (Magnus persona) become anchor customers if cross-vertical insights ship; *do not* freeze | sales-gtm, marketing-growth: vertical-pack pricing already future-proofs this; don't pick — let revenue signal which to deepen |
| K3 | **D6 BH geofence** | security-compliance, adversarial-stress: TX/OK only, geofence enforced, "Coming Q4 2026" honest banner for CA/NY | customers-verticals (BH trio): permissible-purpose + adverse-action ship by 2026-05-15 makes BH launchable nationwide; geofence is overcaution | domain-real-estate: state-specific deed forms + statutory_form registry can scale BH state-by-state without the binary geofence |
| K4 | **D8 eval governance** | ai-ml-eng, adversarial-stress: eval as gate, reject-on-fail, audit-log; flip ownership Indira (compliance) by 90-day gate | eng-leadership: governance-mandatory until 90d, then transfer to compliance — *staged* ownership | executive-strategy: governance is a Series-A diligence checkbox; Theo owns through Series-A close, then pivots |
| K5 | **Engineering velocity vs Product depth** | eng-leadership: hire 3 engineers + IC ladder + ESLint enforcement to *increase* throughput | product-leadership: right-staff to D2 outcome; if Land+NI wedge, move 3 junior PMs to NI depth | product-design-ux: don't hire eng until brand + visual system + accessibility floor land — UX debt blocks customer #2-5 |
| K6 | **Investors vs Customers (sequencing)** | investors-capital: NRR ≥120% pre-S1, public-comp dashboard, hide schema-monolith debt | customers-verticals (Wendell, Magnus, Imani): real-money tests, multi-vertical P&L, W-2-exit calculator — *don't* push these for diligence-prep work | sales-gtm: discovery-intake rubric + 5-account ABM cohort — close 4 of 5 first, then talk to investors |
| K7 | **Security vs Adversarial vs Future-emerging** | security-compliance: SOC 2 Type I + skip-trace gate + ESIGN immutability are sufficient | adversarial-stress: substantive attestation + fair-lending audit + KYC for high-risk orgs + L7 DDoS + DSAR cron — security-compliance is *under-paranoid* | future-emerging (Hjördís, Eilis): climate-risk integration + WCAG AAA — *different* compliance vector entirely (ESG-aligned investors) |
| K8 | **Founder vs CRO (revenue motion)** | sales-gtm (Hollis + Brielle + Saskia): discovery-intake rubric + SDR routing unblocks founder from 100% sales | marketing-growth (Mireille + Hjalmar): deal-room growth loop is the only thing that scales past $30M ARR; SDR is bridging | cs-support (Camila + Søren): 1:many CSM automation comes first; without it, hiring an AE creates a CS bottleneck |

---

## 6. What this panel adds beyond the 20-panel

Specific items in the 300-panel that were not in `_FORWARD-SYNTHESIS.md`:

1. **GDPR DSAR endpoint with 24h SLA** + quarterly self-DSAR audit (adversarial-stress 270; the 20-panel had privacy endpoints but not the *response cron + measurement*).
2. **API contract layer**: OpenAPI generated from Zod, schemathesis in CI, X-API-Version header, deprecation runbook with 30-14-7-day email cadence (backend-eng).
3. **Role-scoped permissions for non-operator personas**: VAs, bookkeepers, accountants, attorneys, retiring operators, family co-owners, contractor crews, junior analysts (customers-roles 211-225).
4. **Domain-expert workflow surfaces**: CMA-builder, auction-readiness checklist, lien-search registry, 1031-timeline alerts, ESA-ASTM compliance, statutory-form versioning (domain-real-estate).
5. **Substantive 3-screen attestation forms** replacing checkbox theater + CRA-cited adverse-action notices tied to screening timestamp (adversarial-stress 256-258, security-compliance 69+74).
6. **Fair-lending audit + RESPA vendor-referral-fee transparency page** before BH scales (adversarial-stress 258-259).
7. **Multi-vertical consolidated P&L + W-2-exit calculator** for cross-vertical operators (customers-verticals 209-210).
8. **Canada (ON+BC) pilot before UK** (future-emerging 287-288); reframes Phoebe's H4.
9. **Regrid real-time parcel push (24h → 2h) + Mapbox tile-batching ($400/mo savings)** (vendor-partners 253-254).
10. **Reconciliation cron for Stripe/wire/1099 + audit-log every discrepancy** (adjacent-industries 271).
11. **CSP nonce strategy + service-worker offline queue + react-window virtualization** for frontend hardening (frontend-eng 41/40/45).
12. **Hire-3-engineers-by-2026-06-08 sprint** (eng-leadership 99-105) — the 20-panel had this as 365-7; the 300-panel pulls it to 90d.
13. **Quarterly DR drill with measured RTO + blue/green deploy on Fly + postmortem template** (devops-sre 56/59/60).
14. **TILA disclosure-timing cron** (closing_date → T-3 disclosure_send_date by construction) (adjacent-industries 280).
15. **Pricing-elasticity A/B test** ($199 vs $249 Solo, 2 weeks) before Series-A pitch (product-leadership 119).

---

## 7. Top 30 — the unified panel ranking

Rank order is by (a) cited-by-category-count, (b) reversibility cost
if skipped, (c) horizon-fit (closer = sooner). Effort: S=≤1w, M=1-3w,
L=>3w.

| # | Title | Source categories | Effort | Horizon |
|---|---|---|---|---|
| 1 | Eval harness as gate (reject-on-fail + audit-log) on Pax + complianceAI | ai-ml-eng, security-compliance, adversarial-stress, eng-leadership, exec-strategy | M | 30d |
| 2 | API contract layer: OpenAPI from Zod + validateBody + schemathesis CI | backend-eng, frontend-eng, devops-sre, vendor-partners, product-leadership | M | 30d |
| 3 | Idempotency + circuit-breaker + rate-limit triad (extends P0-10 fix) | backend-eng, devops-sre, security-compliance, adversarial-stress, vendor-partners | M | 30d |
| 4 | Substantive 3-screen FCRA/skip-trace attestation + CRA-cited adverse-action | security-compliance, adversarial-stress, customers-verticals, domain-real-estate | M | 30d |
| 5 | Quarterly DR drill + blue/green deploy + postmortem template + MTTR <15min | devops-sre, eng-leadership, vendor-partners, adjacent-industries | M | 90d |
| 6 | Persona-aware checklist (already 30-8) + WCAG 2.2 AA + mobile-first audit | frontend-eng, product-design-ux, customers-verticals, customers-roles | M | 30d |
| 7 | Hallucination detector + prompt-injection sanitizer + abuse-pattern in anomaly_detector | ai-ml-eng, security-compliance, adversarial-stress, customers-verticals | M | 90d |
| 8 | Role-scoped permission model + 8 guarded routes + async report-delivery | customers-roles, customers-verticals, security-compliance, adjacent-industries | L | 90d |
| 9 | Reconciliation cron (Stripe/wire/1099) + audit-log discrepancies | adjacent-industries, executive-strategy, sales-gtm, product-leadership | M | 90d |
| 10 | Disclosure-timing cron (TILA T-3 by construction) + statutory-form registry | adjacent-industries, adversarial-stress, domain-real-estate, customers-verticals | M | 90d |
| 11 | Real-money note-ledger acceptance test (Wendell, 1w QA) — already shipped | customers-verticals, executive-strategy, product-leadership | S | 30d |
| 12 | Hire 3 engineers by 2026-06-08 (fullstack + backend + SRE) + IC ladder doc | eng-leadership, executive-strategy, investors-capital | L | 30d |
| 13 | SOC 2 Type I evidence collection via `/founder/compliance-dashboard` | security-compliance, exec-strategy, investors-capital, sales-gtm | L | 180d |
| 14 | Discovery-intake rubric + SDR routing (founder unblock) | sales-gtm, marketing-growth, executive-strategy | S | 30d |
| 15 | Deal-room growth-loop retrofit (already FW-MIREILLE-1; UI follow-up) | marketing-growth, sales-gtm, cs-support | M | 90d |
| 16 | D30 verdict-branching + 1:many CSM automation + power-user dashboard | cs-support, product-leadership, customers-verticals | M | 90d |
| 17 | Title/courthouse/Regrid data-feed: Texas Tier 1, California Tier 2 | domain-real-estate, vendor-partners, customers-verticals | L | 180d |
| 18 | Vendor adoption telemetry + COGS-per-customer extension to 5 vendors | vendor-partners, executive-strategy, investors-capital | M | 90d |
| 19 | Pricing elasticity A/B test ($199 vs $249) before Series-A pitch | product-leadership, investors-capital, sales-gtm | S | 90d |
| 20 | Multi-vertical consolidated P&L + W-2-exit calculator | customers-verticals, customers-roles, future-emerging | M | 90d |
| 21 | **FOUNDER-JUDGMENT:** Pick comp (AppFolio 10x / Procore 14x / ServiceTitan 12x) — drives D1, pricing, hiring, narrative | investors-capital, executive-strategy, product-leadership, sales-gtm | S | 30d |
| 22 | **FOUNDER-JUDGMENT:** D2 resolution by 2026-06-08 + right-staff product org | product-leadership, eng-leadership, customers-verticals, future-emerging | S | 30d |
| 23 | **FOUNDER-JUDGMENT:** D6 BH geofence (TX/OK only vs nationwide compliance-by-state) | security-compliance, adversarial-stress, customers-verticals, domain-real-estate | S | 30d |
| 24 | **FOUNDER-JUDGMENT:** D8 eval ownership (eng vs compliance vs hybrid stage) | ai-ml-eng, eng-leadership, security-compliance | S | 30d |
| 25 | GDPR DSAR endpoint with 24h SLA + quarterly self-DSAR audit | adversarial-stress, security-compliance, future-emerging | M | 90d |
| 26 | Fair-lending audit + RESPA vendor-referral-fee public transparency page | adversarial-stress, security-compliance, customers-verticals | M | 180d |
| 27 | Schema OSS-style docs per vertical (bus-factor mitigation) + 3 engineering blog posts | eng-leadership, marketing-growth, executive-strategy | M | 90d |
| 28 | Founder-letter community feed (not broadcast) + 1 customer video per vertical | marketing-growth, cs-support, executive-strategy | M | 90d |
| 29 | Canada (ON+BC) portability pilot (precedes UK; reframes Phoebe's H4) | future-emerging, investors-capital, executive-strategy | L | 365d |
| 30 | CMA-builder + auction-readiness + lien-search registry (domain-expert moats) | domain-real-estate, customers-verticals, vendor-partners | L | 180d |

---

*Founder-judgment items (#21-#24) flagged because the 300 panel splits
fundamentally on each — see §5 conflict map K1-K4. Synthesis rule
honored: ≥4 categories required for §2 themes; ≥1 category cited for
§3 single-category calls; no recommendations introduced beyond what
category syntheses surfaced.*
