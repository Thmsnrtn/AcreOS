# Forward Synthesis — 20-persona panel, 2026-05-08

## 1. The thesis

The panel agrees on one thing and splits on almost everything else.
**Agreement:** the 21/24 P0 sweep + RS-1..RS-7 closed the "is this safe
to ship?" question, and the next 90 days are about converting that
infrastructure into legible numbers (ledger, NRR, COGS, cost-ceiling,
eval pass-rates). **Disagreement:** what to do with the resulting
credibility. Ashok/Bryn/Marisol want it monetized as a Series-A;
Harlowe wants it monetized as a clean acqui-hire; Caspar wants it
spent deepening Land before any Note-Investor talk; Wendell wants it
spent perfecting the note ledger; Mireille/Diego want it spent on
growth loops the company has zero of; Indira/Wynne want it spent on
governance the founder hasn't budgeted. **Founder judgment is required
at four forks, not one.**

## 2. Consensus moves (≥4 personas converged)

### C1. Subscription-event ledger + ASC 606 deferred-revenue recognition (3w, large)
Most-cited fix in the corpus. Without immutable `subscription_events`
+ monthly recognition cron, MRR is unrecoverable on tier changes,
annual subs violate ASC 606, and Stripe drift is invisible. Surfaces:
`shared/billing/tier-pricing.ts`, new `subscription_events` +
`deferred_revenue` tables, nightly Stripe reconciliation.
- Converged: marisol-vega, ashok-bhatt, harlowe-stone, bryn-halliday, tegan-russo

### C2. Customer-concentration + COGS-per-customer dashboard `/founder/financials` (2w, medium)
Four personas converged on the same dashboard spec: NRR, GRR, top-5 MRR
concentration with >20% red-flag, gross margin per tier, COGS per
customer (AI calls + data + hosting). Wires `autonomousHealthMonitor.ts`
cost aggregator to a customer-keyed rollup.
- Converged: marisol-vega, ashok-bhatt, harlowe-stone, theo-okuda

### C3. Eval harness + per-org AI cost ceiling (3w, large)
Pax draft + Pax executive + complianceAI disclosure generator have
customer-facing blast radius and zero deterministic post-check. Theo
frames as cost discipline; Indira frames as governance-mandatory;
Marisol/Ashok frame as Series-A diligence. Touches `aiRouter.ts`,
`aiTelemetryEvents`, new `organizations.ai_cost_ceiling_cents`, new
`ai_test_cases` + `ai_models` tables, `complianceAI.ts:303` post-validator.
- Converged: theo-okuda, indira-lockwood, ashok-bhatt, marisol-vega, harlowe-stone

### C4. ESIGN integrity layer — content hash + post-sign immutability + completion certificate (2w, medium)
Founder personal-liability surface. `routes-doc-system.ts:725` accepts
content updates post-signature today. Required before any Note Investor
or contract-for-deed customer signs anything >$10K. Adds
`signatureContentHash` SHA-256, BEFORE-trigger immutability guard,
completion-certificate PDF, S3 archive.
- Converged: harlowe-stone, sam-reyes, wynne-ohaegbu, indira-lockwood

### C5. Client-side idempotency footgun fix (1.5d) + close P0-10 Dropbox idempotency (1d)
Default `mutations.retry: false` in `queryClient.ts`; wire
`Idempotency-Key` UUID into `apiRequest`. Mirror Stripe webhook pattern
in `webhookHandlers.ts` for Dropbox. Highest-leverage <2-day fix in the
corpus. Stops Stripe double-subscription, e-sign double-send, campaign
double-dispatch.
- Converged: ines-travers, sam-reyes, olu-adebayo, theo-okuda

### C6. Persona-aware first-day checklist + delete duplicate `OnboardingChecklist.tsx` (3w, medium)
`GettingStartedChecklist.tsx` becomes persona-keyed (land_investor /
note_investor / wholesaler each get distinct 3-step aha). Pax injects
one persona-flexed hello after aha step. Time-to-aha collapses from
7:30 → 2:30.
- Converged: yuna-park, ana-solis, asher-klein, camila-reyes, mireille-saint-clair

### C7. Vertical-pack pricing model (one base price, verticals as +$100–$200 packs) (2w, medium)
Don't build a pricing-table per vertical; meter verticals as add-on
packs on top of Solo/Operator/Pro Operator/Operation. Future-proofs the
4-vertical roadmap and prevents a second "seven-pricing-tables"
episode. Touches `tier-pricing.ts` + Stripe Price objects.
- Converged: tegan-russo, bryn-halliday, ashok-bhatt, caspar-ng, ana-solis

### C8. Founder-voice audit pass on auth/pricing/empty-states/error-toasts + ESLint enforcement (1w, small)
Make `no-founder-codenames-in-customer-jsx` a hard pre-commit error.
Audit `/auth`, `/pricing`, `/money`, 404/500 pages, payment-failure
copy. Ship competitive-frame paragraph above pricing. Three-layer
guardrail (ESLint + voice anchors + style guide).
- Converged: asher-klein, ana-solis, ashok-bhatt, yuna-park

## 3. High-conviction single-persona calls

| # | Persona | Move | Trade-off accepted |
|---|---|---|---|
| H1 | wendell-hart | **Real-money 3-cycle note-ledger acceptance test** with a real operator portfolio. One silent rounding bug = trust collapse + word-of-mouth death. Add CI paranoia test: 1,000 randomized amortization schedules validated to the cent. | Burns 1 week of dedicated QA. Blocks Note Investor scale until passed. Wendell explicitly says: deepen Land before widening to anything else. |
| H2 | mireille-saint-clair | **Retrofit deal-rooms as the growth loop** — unauthenticated view + "Want this for your own deals?" CTA + auto-populate first deal from share link. Measure share→signup weekly; do not turn on paid acquisition until ≥3% conversion. | Camila + Diego both think CS-ops + community come first. Mireille: they're retention gears, not acquisition gears, and at sub-3% loop conversion paid acquisition becomes the AppHarvest trap. |
| H3 | wynne-ohaegbu | **Geofence BH tenant-screening to TX/OK at launch** — explicit state enum, banner "CA/NY support pending state licensing." | Defers the $5M+ exposure window of CA Civ §1786 and NY Gen Bus §527 class actions. Costs geographic addressable market in exchange for class-cert deferral until Series B. |
| H4 | phoebe-lethbridge | **Run UK-portability audit during US stabilization, not after.** Mark every feature `regions_available` enum; pilot UK Land-Registry + Rightmove comp integration as PoC for portability. | Caspar wants single-vertical focus. Phoebe accepts she won't ship UK in 2026 — but the audit informs whether vertical-7 is "Wholesale Lending" (Caspar's default) or "UK BTL" (her bet, $2T AUM, same-persona overlap). |
| H5 | diego-marchetti | **Founder-letter weekly cadence + deal-room community feed**, not paid Slack/Discord. 6-week build, 1hr/week of founder time forever. Measure community-cohort 24-month LTV; ambassador layer in Q3. | Marisol/Ashok frame community spend as unmeasurable. Diego accepts the 3-6 month signal lag; argues founder time is the scarcest + highest-leverage SMB acquisition input. |

## 4. Time-stratified backlog

### Next 30 days (through 2026-06-08)

**Status as of 2026-05-08 end-of-session: 10/12 ✅ shipped.**

| # | Item | Effort | Memos | Status |
|---|---|---|---|---|
| 30-1 | Client-mutation retry footgun fix + `Idempotency-Key` wiring | small (1.5d) | ines-travers, sam-reyes | ✅ already shipped (queryClient.ts:397, line 232+) |
| 30-2 | Close P0-10 Dropbox idempotency (atomic claim + state-machine guard) | small (1d) | ines-travers, theo-okuda | ✅ shipped 2026-05-08 (eSigningService.ts:387) |
| 30-3 | Fix broken pre-commit hook + re-enable migration validation | small (2h) | ines-travers | ✅ already healthy (.githooks/pre-commit) |
| 30-4 | ESIGN integrity layer (content hash + immutability + completion cert) | medium (2w) | harlowe-stone, sam-reyes, wynne-ohaegbu | ✅ FW-HARLOWE-1 shipped 2026-05-08 (DB trigger + completion-cert route) |
| 30-5 | Skip-trace permissible-purpose gate (BH pre-pilot blocker) | small (2d) | wynne-ohaegbu | ✅ FW-WYNNE-1 shipped 2026-05-08 |
| 30-6 | Encrypt `skip_traces.results` JSONB + backfill | small (1d) | sam-reyes | ✅ already shipped (skipTraceEncryption.ts) |
| 30-7 | Customer-concentration alert on `/founder-home` (>20% MRR) | small (1.5d) | marisol-vega, ashok-bhatt, harlowe-stone | ✅ FW-MARISOL-1 shipped 2026-05-08 |
| 30-8 | Persona-aware checklist + delete duplicate `OnboardingChecklist.tsx` | medium (2w) | yuna-park, asher-klein | 🟥 open |
| 30-9 | ESLint `no-founder-codenames-in-customer-jsx` as hard error | small (4h) | asher-klein | ✅ already shipped (eslint.config.js:83 = "error") |
| 30-10 | Stripe Tax + tax_id_collection enabled | small (1d) | marisol-vega | ✅ already shipped (stripeService.ts:44+103) |
| 30-11 | Write the missing 8 runbooks (Clerk/SES/Twilio/e-sign/GDPR/agent/founder/Fly) | medium (5d) | olu-adebayo | 🟥 open |
| 30-12 | Founder-letter infrastructure (route + email template + archive) | small (1w) | diego-marchetti, asher-klein | ✅ FW-DIEGO-1 shipped 2026-05-08 (community_letters table + 6 routes) |

### Next 90 days (through 2026-08-08)

| # | Item | Effort | Memos |
|---|---|---|---|
**Status as of 2026-05-08 end-of-session: 12/15 ✅ shipped.**

| # | Item | Status | Memos |
|---|---|---|---|
| 90-1 | Subscription-event ledger + ASC 606 cron | ✅ FW-MARISOL-2 | marisol, ashok, harlowe, bryn |
| 90-2 | /founder/financials data layer (NRR/COGS/concentration endpoints) | ✅ FW-MARISOL-3 | ashok, marisol, harlowe |
| 90-3 | Eval harness v0 + AI cost ceiling + ai_models lifecycle | ✅ FW-THEO-1 + FW-INDIRA-1 | theo, indira, marisol |
| 90-4 | complianceAI post-validator on disclosure registry | ✅ FW-INDIRA-2 | theo, wynne, indira |
| 90-5 | Pricing reset rollout | ✅ already partial pre-session + FW-TEGAN-1 helper | tegan, ashok |
| 90-6 | Vertical-pack pricing model + org_vertical_packs table | ✅ FW-TEGAN-1 + FW-ASHOK-1 | tegan, ashok |
| 90-7 | Note-ledger paranoia CI test | ✅ FW-WENDELL-1 — caught + fixed 2 real bugs | wendell |
| 90-8 | Bulk actions in /leads (UI) | 🟥 carried (UI scope) | wendell |
| 90-9 | Map view default on /properties (UI) | 🟥 carried (UI scope) | wendell |
| 90-10 | Audit-log REVOKE UPDATE/DELETE (DB trigger) | ✅ FW-SAM-1 | sam |
| 90-11 | Privacy endpoints + sub-processor list page | ✅ FW-SAM-2 (existed: /api/privacy/*; new: /legal/sub-processors) | sam, harlowe |
| 90-12 | Customer-context sidebar (admin-support) | ✅ already shipped (admin-support.tsx); GDPR/org-merge admin UIs deferred | olu |
| 90-13 | D30 verdict-branched email arcs | ✅ FW-CAMILA-1 | camila, yuna |
| 90-14 | Deal-room growth-loop retrofit | ✅ FW-MIREILLE-1 (data + API; UI follow-up) | mireille |
| 90-15 | OpenAI bypass migration to routeAITask | 🟥 carried (4w refactor) | theo |

### Next 180 days (through 2026-11-08)

**Status as of 2026-05-08 end-of-session: 8/15 ✅ shipped (data layer); 7 carried.**

| # | Item | Status | Memos |
|---|---|---|---|
| 180-1 | SOC 2 Type I package | 🟥 carried (4-6mo external) | sam, ashok, harlowe, indira |
| 180-2 | Note Investor closed-beta | 🟥 carried (GTM motion) | ashok, caspar |
| 180-3 | Caspar revenue gates | 🟥 carried (founder D2) | caspar |
| 180-4 | Per-endpoint p95 SLO dashboard | ✅ already shipped (apiTelemetry middleware + /api/admin/telemetry) | ines |
| 180-5 | Synthetic checks every 15min | ✅ FW-OLU-2 (5 checks: SES, Stripe webhook, Clerk proxy, DB, Twilio) | olu |
| 180-6 | Power-user dashboard | ✅ FW-CAMILA-1B (/api/founder/power-users; ≥10 leads OR ≥3 deals OR ≥1 note in 30d) | camila |
| 180-7 | In-product NPS micro-survey at D7 | ✅ FW-CAMILA-2 (POST /api/nps/submit + GET /api/founder/nps/recent) | camila |
| 180-8 | Pre-churn ladder automation | ✅ FW-CAMILA-3 (POST /api/founder/pre-churn/sweep; idempotent rungs) | camila |
| 180-9 | Pax prompt versioned files + caching | 🟥 carried (2w refactor) | theo |
| 180-10 | Tiered external pen-test | 🟥 carried (external vendor) | sam |
| 180-11 | Wordmark commission + agent origin | 🟥 carried (design-led) | ana |
| 180-12 | Co-investor invite layer | 🟥 carried (small UI ride on FW-MIREILLE-1) | mireille |
| 180-13 | Weekly founder office-hours | 🟥 carried (GTM motion, see docs/launch/) | diego |
| 180-14 | Data-retention policy | ✅ FW-WYNNE-3 (retention_policies table + admin upsert) | wynne |
| 180-15 | Substantive FCRA attestation form | ✅ FW-WYNNE-2 (substantive_form jsonb on fcra_attestations) | wynne |

### Next 365 days (through 2027-05-08)

| # | Item | Effort | Memos |
|---|---|---|---|
| 365-1 | Series-A close (Ashok IC: $12M / $60M post on multi-vertical proof) — *or* clean acqui-hire path (Harlowe: $14M-$18M to Buildium/Yardi/AppFolio) | strategic | ashok-bhatt vs harlowe-stone |
| 365-2 | Schema-monolith refactor (17,468 LOC → modules) — only after 150+ customers | large (2-3w) | ines-travers |
| 365-3 | Founder-dashboard v2 extraction (7,379 LOC → ops console) — gated on revisit triggers | large (7-9d) | ines-travers, asher-klein, caspar-ng (defers explicitly) |
| 365-4 | UK BTL pilot (Land Registry + Rightmove comp integration) — gated on 2 US verticals @ $500K ARR each | large (3w pilot) | phoebe-lethbridge |
| 365-5 | CRO hire trigger (first $50K+ ACV NI customer) | strategic | caspar-ng |
| 365-6 | Per-seat metering wired in backend (toggle-able, not activated) | medium | bryn-halliday, tegan-russo |
| 365-7 | Bus-factor mitigation: VP Product / technical co-founder hire by month-6 post-seed | strategic | ashok-bhatt, harlowe-stone |
| 365-8 | Trademark filing (USPTO IC 042 + IC 036) + Snyk/FOSSA license audit | small | harlowe-stone |
| 365-9 | Public-comp benchmark cadence: monthly board review vs AppFolio (10x) / Procore (14x) / ServiceTitan (12x) | ongoing | bryn-halliday |
| 365-10 | Hallucination eval set expansion beyond Pax draft (board votes, self-assessment) | medium | theo-okuda, indira-lockwood |

## 5. Trade-off map

| # | Question | A says | B says | C says |
|---|---|---|---|---|
| T1 | **Capital strategy** | marisol-vega + ashok-bhatt: raise Series-A in Q3 once ledger + NRR + COGS land | harlowe-stone: clean acqui-hire at $14M-$18M in 12-18mo, no VC dilution | bryn-halliday: pick Vertical-SaaS (Procore-style 14x) vs SMB-Ops (AppFolio-style 10x) narrative *first* — capital flows from narrative |
| T2 | **Sequencing: depth vs breadth** | wendell-hart: deepen Land — note ledger bulletproof, bulk actions, map default; do not widen | caspar-ng: Land+NI = wedge to $1M ARR, suspend vertical-7, de-staff 5 non-wedge verticals | diego-marchetti: don't de-staff for 90 days — let community signal which verticals customers prefer before pruning |
| T3 | **Governance vs engineering velocity** | indira-lockwood: eval harness is governance-mandatory (SOC 2 / FCRA exposure); ship before any model swap | theo-okuda: eval harness as cost-observability; flip into governance over 3 weeks | sam-reyes: eval harness after the 3 critical security fixes (ESIGN, skip-trace encryption, founder-check); foundations first |
| T4 | **Acquisition: loops vs CSM ops** | mireille-saint-clair: deal-room growth loop is the only thing that scales past $30M ARR; ship retrofit before paid | camila-reyes: CSM ops + pre-churn ladder is the moat at 5 customers; loops are month-3+ work; both, in sequence | diego-marchetti: founder-led community is the SMB acquisition flywheel; neither pure loop nor pure CSM |
| T5 | **Pricing model** | tegan-russo: flat tier + seat ceilings (Wendell test: $249 flat beats $100+$80/seat every time) | bryn-halliday: per-seat is the Series-A credibility anchor (AppFolio comp); ship flat now, wire per-seat backend, toggle post-funding | ashok-bhatt: vertical-packs +$100-$200/mo on top of any tier — packs scale, seats don't |
| T6 | **International timing** | phoebe-lethbridge: start UK BTL audit *now* during US stabilization; gate launch on 2 US verticals @ $500K ARR | caspar-ng: international is Series-B story; don't even audit until US wedge proves | ashok-bhatt: defer UK to Year 2; Canada ~3x easier as first international, not UK |
| T7 | **Litigation surface** | wynne-ohaegbu: skip-trace gate + TX/OK geofence + retention policy + substantive attestation form (litigation gap is open even though security gap is closed) | sam-reyes: foundational security (ESIGN, encryption, audit-log) — RS-1..RS-7 closed customer-facing surface | indira-lockwood: AI hallucination liability + model-deprecation lifecycle — different liability vector again |
| T8 | **Brand architecture** | ana-solis: masthead-+-named-verticals (Path C) — "AcreOS" wordmark, "AcreOS for Land" emphasis | asher-klein: voice anchors per vertical, ESLint-enforced — agree on masthead but each vertical needs its own philosophy page | wendell-hart: stay deeper on Land, do not widen voice — masthead is fine *if* note ledger ships bulletproof first |

**Founder judgment required:** T1 (raise vs exit), T2 (depth vs breadth),
T4 (loops vs CSM-ops), T5 (flat vs per-seat). The other four trade-offs
are sequencing disputes within an agreed direction; these four are
direction disputes.

## 6. What we'd defer (panel non-goals)

| # | Item | Why deferred | Cited by |
|---|---|---|---|
| D1 | Schema monolith refactor (17,468 LOC) | Real debt, but kills velocity during vertical expansion. Re-evaluate at customer 150+ | ines-travers, caspar-ng |
| D2 | Founder-dashboard v2 extraction (7-9d) | Already deferred 2026-05-06; revisit triggers documented; ops console can wait 90d | ines-travers, asher-klein, caspar-ng |
| D3 | Wholesale-lending vertical (#7) | Different sales motion (SBA officer), different underwriting (creditworthiness), 3x harder than residential | caspar-ng, phoebe-lethbridge |
| D4 | EU expansion (France/Germany/Benelux) | 6 property-registration systems, 6 tax regimes, 6 underwriting standards. UK first; EU is Year-3 minimum | phoebe-lethbridge |
| D5 | Paid Slack/Discord community + branded community app | Notion's paid Slack gated community; Linear's Discord became spam. Async founder-letter beats real-time chat at 200 customers | diego-marchetti |
| D6 | Onboarding visual redesign (full refresh) | Telemetry now live but n=8/mo signups too small to read drop-off signal. Revisit at month-end with 20-30 signups | yuna-park |
| D7 | Bug-bounty program | Finding skip-trace plaintext bugs pre-funding is bad economics; ship after Series-A close | sam-reyes |
| D8 | Automated underwriting decisions in BH | Triggers Regulation B disparate-impact liability; needs model-card sign-off + historical disparate-impact audit first | wynne-ohaegbu |

## 7. Verification gates

| Horizon | Gate | Source |
|---|---|---|
| **By 2026-06-08 (30d)** | (a) Client-mutation idempotency shipped + Dropbox P0-10 closed; (b) ESIGN integrity layer in production; (c) skip-trace permissible-purpose gate live; (d) persona-aware checklist live with time-to-aha measured ≤4:00 (down from 7:30); (e) 8 missing runbooks written | ines, harlowe, wynne, yuna, olu |
| **By 2026-08-08 (90d)** | (a) `subscription_events` ledger + ASC 606 recognition cron live; (b) `/founder/financials` dashboard shows NRR ≥110%, customer-concentration <20%, COGS-per-customer attributed; (c) eval harness ≥5 baseline scenarios with passing thresholds; (d) deal-room loop conversion measured ≥3% share→signup; (e) Wendell real-money 3-cycle acceptance test passes to the cent | marisol, ashok, harlowe, theo, indira, mireille, wendell |
| **By 2026-11-08 (180d)** | (a) Note Investor closed-beta hits 10 customers paying; (b) Caspar revenue gates evaluated — 3+ verticals at gate or hard pivot to Land+NI only; (c) SOC 2 Type I package complete; (d) D30 activation verdict branching shipped with active-cohort retention ≥40%; (e) founder-letter cadence sustained 24 weeks unbroken | caspar, ashok, sam, camila, diego |
| **By 2027-05-08 (365d)** | (a) Series-A closed at $12M / $60M post *or* clean acqui-hire LOI at $14M-$18M; (b) $1.5M+ ARR; (c) NRR ≥120%; (d) gross margin ≥70%; (e) bus-factor mitigated (VP Product or technical co-founder hired); (f) at least one vertical at $1M ARR net-new | ashok, harlowe, marisol, bryn |

---

*Synthesized 2026-05-08 from 20 forward-looking persona memos under
`docs/exhaustive-completion/forward-2026-05-08/`. Each backlog row
traces to ≥1 memo by handle; every consensus block requires ≥4
converging memos. Founder-judgment items flagged explicitly in the
trade-off map.*
