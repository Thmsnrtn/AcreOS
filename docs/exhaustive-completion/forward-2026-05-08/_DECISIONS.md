# Founder-judgment ledger — 2026-05-08

The 20-persona panel surfaced ≥10 decisions where the panel split
fundamentally. These are NOT items I'll execute — they're calls the
founder owns. Each row names the question, the panel split (with the
specific personas on each side), what the synthesis recommends as the
*sequencing* default if the founder doesn't pick, and the trigger at
which the call must be made.

## D1. Capital strategy — raise, bootstrap, or sell

> *"What do we do with the credibility the rock-solid sweep just built?"*

| Option | Backers | Headline |
|---|---|---|
| **Raise Series A in Q3 2026** | marisol-vega, ashok-bhatt | $12M / $60M post on multi-vertical-SaaS thesis after `subscription_events` + NRR + COGS land |
| **Clean acqui-hire path** | harlowe-stone | $14M-$18M LOI to Buildium/Yardi/AppFolio in 12-18 months; data-room + earnout-gates work starts now |
| **Pick the narrative first** | bryn-halliday | Vertical-SaaS leader (Procore-style, 14x ARR) vs SMB-Ops platform (AppFolio-style, 10x ARR) — pricing, roadmap, hiring all flow from this choice |

**Default if not picked:** keep raise *and* exit paths viable through
2026-08-08; both require the same legible-numbers stack (90-day work).
After 2026-08-08, paths diverge — raise demands TAM defense + investor
narrative, exit demands clean books + earnout gates.

**Trigger:** decide by 2026-08-31 (90-day verification gate). Ledger
+ COGS work is path-agnostic; everything after isn't.

---

## D2. Sequencing — depth or breadth

> *"Do we deepen Land before adding a 7th vertical, or chase the multi-vertical narrative the investors want?"*

| Option | Backers | Headline |
|---|---|---|
| **Deepen Land (and only Land)** | wendell-hart | Bulk actions, map default, comp dossier, note ledger acceptance test. Don't widen until existing customers say "irreplaceable" |
| **Land + NI as the wedge** | caspar-ng | Suspend vertical-7. De-staff the 5 non-wedge verticals to maintenance mode. Ship NI to $1M ARR before anything else |
| **Hold breadth; let community signal** | diego-marchetti | Don't de-staff for 90 days. Let founder-letter + community signal which vertical customers actually use |
| **Multi-vertical is the Series-A story** | ashok-bhatt, ana-solis | Breadth IS the moat. Masthead-+-named-verticals brand. Pricing-pack model future-proofs vertical 7+. |

**Default if not picked:** ship the 90-day legible-numbers stack first
(it's vertical-agnostic). At 2026-08-08 evaluate Caspar's revenue gates
— if NI < $50K net-new ARR, pivot to depth-only; if NI ≥ $50K, breadth
holds.

**Trigger:** Caspar's gate evaluation at 2026-08-08 forces the call.

---

## D3. Acquisition channel — loops, CSM ops, or community

> *"How do we acquire customers cheaply and durably?"*

| Option | Backers | Headline |
|---|---|---|
| **Growth loops (deal-room retrofit)** | mireille-saint-clair | Unauthenticated deal-room view + signup CTA. Measure share→signup. Don't turn on paid until ≥3% loop conversion |
| **CSM ops + pre-churn ladder** | camila-reyes | Health scoring, D30 verdict branching, NPS at D7, power-user dashboard. Plug retention before pouring acquisition |
| **Founder-led community** | diego-marchetti | Weekly founder letter, deal-room community feed, Thursday office hours. 1hr/week founder time forever, 24-week minimum cadence |

**Default if not picked:** all three are sequencing-compatible.
30-day: founder-letter infra + persona-aware checklist (Diego + Yuna).
90-day: deal-room loop retrofit + D30 branching (Mireille + Camila).
180-day: power-user dashboard + ambassador layer.

**Trigger:** when paid-acquisition spend is being considered. Don't
spend until loop conversion measured (Mireille's gate).

---

## D4. Pricing model — flat, per-seat, or vertical-pack

> *"What's the pricing shape that scales to 6+ verticals?"*

| Option | Backers | Headline |
|---|---|---|
| **Flat tier + seat ceilings** | tegan-russo | $249 flat for 3 seats beats $100+$80/seat in customer interviews. Operator-class names ($49/$99/$199/$399) |
| **Per-seat (Series-A credibility anchor)** | bryn-halliday | AppFolio comp uses per-seat. Ship flat publicly, wire per-seat backend-side, toggle post-funding |
| **Vertical packs** | ashok-bhatt, caspar-ng | One base price per tier, verticals as +$100-$200/mo packs. Future-proofs the 4-vertical roadmap |

**Default if not picked:** ship vertical-packs in 90-day backlog (C7).
Per-seat metering wired backend-side without activation (compatible
with all three paths).

**Trigger:** before Series-A pitch deck (T1 path) or before 7th
vertical (T2 path).

---

## D5. International timing

> *"When does AcreOS leave the US?"*

| Option | Backers | Headline |
|---|---|---|
| **Audit now, launch gated on US wedge** | phoebe-lethbridge | Mark `regions_available` enum on every feature. Pilot UK Land Registry + Rightmove integration as PoC. Launch only when 2 US verticals @ $500K ARR |
| **Defer until Series B** | caspar-ng | International is post-Series-A complication. Don't even audit until US wedge proves |
| **Canada before UK** | ashok-bhatt | Canada is ~3x easier than UK as first international (similar legal frame, no GDPR, US-shape data) |

**Default if not picked:** Phoebe's audit (low-cost, runs in
parallel with US stabilization) is sequencing-compatible; UK launch
itself is gated on US wedge proof. Treat audit as 365-day item.

**Trigger:** US-wedge proof (T2 resolution) → triggers vertical-7
choice (UK BTL vs Wholesale Lending).

---

## D6. Litigation surface — what's the next-tier exposure

> *"RS-1..7 closed customer-facing security. What's the litigation gap?"*

| Option | Backers | Headline |
|---|---|---|
| **FCRA/TILA/RESPA hardening** | wynne-ohaegbu | Skip-trace gate, TX/OK geofence, retention policy, substantive attestation form — class-action exposure is open even though security is closed |
| **AI hallucination liability** | indira-lockwood | Eval harness as governance-mandatory, model-deprecation lifecycle, AI-generated-doc legal-defense — different liability vector |
| **Foundational security first** | sam-reyes | RS-1..7 closed customer-facing; ESIGN, encryption, audit-log REVOKE are next — litigation vectors come after |

**Default if not picked:** all three are 30/90/180-day staged in the
backlog. Wynne's geofence (TX/OK only) is the single highest-value
defensive move and goes in the 30-day cluster.

**Trigger:** before BH/NI launch beyond TX/OK (Wynne's geofence
release condition).

---

## D7. Community spend — measurable enough to justify

> *"Is community spend a real line item or a vanity exercise?"*

| Option | Backers | Headline |
|---|---|---|
| **Community is the SMB flywheel** | diego-marchetti | Founder-letter + weekly office hours + ambassador layer. Measurable via cohort-LTV at month 6+ |
| **Community is unmeasurable** | marisol-vega, ashok-bhatt | Burn-rate accountability. Community spend doesn't show up in Series-A diligence in measurable form |

**Default if not picked:** Diego's first 6 weeks (founder-letter infra
+ Thursday office hours) cost ~1hr/week founder time and zero capex.
Cohort-LTV measurable at month 6. Low blast radius — ship it; if at
month 6 the data is null, kill it.

**Trigger:** monthly review. If founder time consistently displaces
higher-leverage work, kill.

---

## D8. Eval-harness ownership — engineering or governance

> *"Who owns the AI eval harness — engineering as cost-discipline, or governance as compliance-mandatory?"*

| Option | Backers | Headline |
|---|---|---|
| **Engineering (cost + quality)** | theo-okuda | Cost ceilings per org, latency budgets, model-version A/B. Engineering metric. |
| **Governance (compliance-mandatory)** | indira-lockwood | SOC 2 + FCRA require explainability + bias audit. Eval is compliance evidence, not engineering tooling |

**Default if not picked:** ship the harness in 90-day backlog (C3).
Frame both as outputs — Theo gets the cost-ceiling table, Indira gets
the bias-eval test cases. The harness itself is one artifact serving
two consumers.

**Trigger:** SOC 2 Type II audit (Q3-Q4 2026) or first
customer-impacting hallucination incident.

---

## D9. Paid-Slack-or-Discord community

> *"Do we open a real-time community surface in 2026?"*

| Option | Backers | Headline |
|---|---|---|
| **No real-time community in 2026** | diego-marchetti, ana-solis | Notion's Slack gated → community starved. Linear's Discord became spam. Async founder-letter wins at 200 customers |
| **Open invite-only Slack** (not endorsed by panel) | — | Default expectation; panel rejects |

**Default if not picked:** D5 deferral stands.

---

## D10. Onboarding-v2 redesign trigger

> *"When do we revisit the deferred 1,543-line onboarding monolith?"*

| Option | Backers | Headline |
|---|---|---|
| **Wait for n≥30 signups/month** | yuna-park | Pre-condition telemetry already shipped. Drop-off signal is unreadable below n=30 |
| **Per-step bailout >50%** | yuna-park | Already wired — auto-trigger on signal |
| **Notes/both customer friction** | yuna-park | Vertical-specific friction is the third pre-condition |

**Default if not picked:** Yuna's three pre-conditions are the spec.
Hands-off until one fires.

---

## Summary — what the founder must decide vs what synthesis defaults

| # | Question | Sequencing-compatible? | Founder must decide? |
|---|---|---|---|
| D1 | Capital strategy | Yes (path-shared 90d work) | By 2026-08-31 |
| D2 | Depth vs breadth | Yes (Caspar's gate forces it) | By 2026-08-08 |
| D3 | Acquisition channel | Yes (all three sequenceable) | When paid spend considered |
| D4 | Pricing model | Yes (vertical-packs default) | Before pitch / vertical-7 |
| D5 | International timing | Yes (audit-only, low cost) | When US wedge proves |
| D6 | Litigation surface | Yes (30/90/180 staged) | Wynne geofence is the gate |
| D7 | Community spend | Yes (low-cost MVP) | Month-6 review |
| D8 | Eval-harness ownership | Yes (one artifact, two outputs) | SOC 2 trigger |
| D9 | Paid Slack/Discord | Already deferred | n/a until 2027 |
| D10 | Onboarding-v2 trigger | Already deferred + auto-trigger | n/a until signal |

**Of the 10, four require active founder calls in the next 6 months:**
D1 (by 2026-08-31), D2 (by 2026-08-08), D6-Wynne-geofence (before BH
launch beyond TX/OK), D8 (SOC 2 trigger window).

The other six are sequencing-compatible — the synthesis default ships
the work in a way that preserves all options, and the call gets made
when a downstream trigger fires.

---

*Authored 2026-05-08 from 20 persona memos. Founder owns these calls;
synthesis owns the work that keeps options open until the call is
made.*
