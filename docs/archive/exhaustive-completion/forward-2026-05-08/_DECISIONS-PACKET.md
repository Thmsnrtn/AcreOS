# Founder-judgment decision packet — D1 / D2 / D6 / D8

**Companion to `_DECISIONS.md`.** That doc lists 10 panel-surfaced
trade-offs; this packet is the deep-dive on the 4 that need active
founder calls in the next 6 months. Read each one, write your call
in the resolution box, and the team executes against it.

The other 6 (D3 acquisition, D4 pricing, D5 international, D7
community, D9 paid Slack, D10 onboarding-v2) are sequencing-compatible
— the synthesis-default work-order keeps every option open. They get
re-evaluated when their named triggers fire.

---

## D1 — Capital strategy: raise, exit, or bootstrap

### The question
*"What do we do with the credibility the rock-solid sweep just built?
Raise Series A in Q3, position for clean acqui-hire in 12-18mo, or
keep bootstrapping toward a different shape?"*

### Panel split

| Position | Backers | Headline |
|---|---|---|
| **Raise Series A in Q3 2026** | marisol-vega, ashok-bhatt | $12M / $60M post on multi-vertical-SaaS thesis after `subscription_events` ledger + NRR + COGS-per-customer land |
| **Clean acqui-hire path** | harlowe-stone | $14M-$18M LOI to Buildium / Yardi / AppFolio in 12-18 months; data-room work starts now, founder retention via earnout-gates |
| **Pick the narrative first** | bryn-halliday | Vertical-SaaS leader (Procore-style 14x ARR multiple) vs SMB-Ops platform (AppFolio-style 10x) — pricing, roadmap, hiring all flow from the choice. Series-A vs exit comes after. |

### What's already true (so the call isn't theoretical)

- ✅ ASC 606 ledger live (FW-MARISOL-2). NRR endpoint shipped (FW-MARISOL-3). Customer-concentration alert live on `/founder-home` (FW-MARISOL-1).
- ✅ ESIGN integrity stack at four layers (R2 hash + route-level guard + DB trigger + completion certificate). Personal-liability exposure on contracts is closed.
- ✅ Audit-events append-only at the DB level (FW-SAM-1). Skip-trace permissible-purpose gated (FW-WYNNE-1). complianceAI post-validator wired (FW-INDIRA-2).
- 🟥 Subscription-event ledger has data flowing in but no real customers paying yet — the NRR number will be `null` until cohort-2 data exists.
- 🟥 Founder bus-factor remains 1 (Ashok + Harlowe both flagged this).

### Consequence map (next 90 days, by path)

**If you pick RAISE:**
- 60 days: hire a part-time CFO consultant to clean books for diligence (Marisol's cohort)
- 75 days: build the IC-memo deck (Ashok's spec — TAM defense, expansion math, comp multiples)
- 90 days: warm intros to 5-7 funds (Series-A leads in vertical-SaaS / proptech)
- The schema-monolith refactor (deferred D2 above) gets PUSHED, because raise-prep dilutes coding time
- The international audit (Phoebe, D5) gets PUSHED to Series-B story

**If you pick EXIT (acqui-hire):**
- 30 days: Trademark filing + Snyk/FOSSA license audit (commit-365-8)
- 45 days: Build a "data room" folder with founding-thesis, customer-list, security-posture (RS-1..7, DB triggers, sub-processor list shipped today directly support this)
- 60 days: Reach out to Buildium / Yardi / AppFolio M&A teams via warm intros
- The vertical-pack pricing model (FW-TEGAN-1) becomes the differentiating story
- Multi-vertical breadth becomes the core narrative — not a hindrance

**If you pick NARRATIVE-FIRST (Bryn):**
- 30 days: Run a public-comp benchmarking exercise (AppFolio 10x ARR, Procore 14x, ServiceTitan 12x). Pick the multiple you want and reverse-engineer the operations to match.
- 45 days: Decide pricing model in conjunction (Tegan's flat-tier vs per-seat — per-seat is the Procore comp; flat is the AppFolio comp).
- 60 days: Restructure investor narrative (deck, website, founder voice) to resemble the chosen comp. Launch revised positioning in pricing-page + landing copy.
- Both raise AND exit options stay open until ~Q4 2026.

### Trigger if not decided

By 2026-08-31 (90-day verification gate). Both raise and exit paths
require the same 90-day work (legible numbers stack); after that the
paths diverge. If not picked by then, the synthesis defaults to "narrative-
first": ship the comp benchmark + pricing decision, defer the raise/exit
call to Q4.

### Recommendation

**Bryn's "narrative-first" is the lowest-regret call.** It buys 6
months of optionality at zero capital cost. Marisol's raise-now is
the highest-upside but assumes you want the dilution + board pressure
+ Series-A growth treadmill. Harlowe's exit-path forecloses optionality
to the upside without any current acquirer interest signaling. Pick
narrative first, let the 90-day data tell you which the comp actually
resembles, and decide raise vs exit in Q4 with real numbers.

### ✅ Founder resolution

```
Decision: ___________________________
Date:     ___________________________
Reasoning (1-2 sentences):
___________________________________
___________________________________
Trigger to revisit: _________________
```

---

## D2 — Sequencing: depth vs breadth

### The question
*"Do we deepen Land before adding a 7th vertical, or chase the
multi-vertical narrative the investors want?"*

### Panel split

| Position | Backers | Headline |
|---|---|---|
| **Deepen Land only** | wendell-hart | Bulk actions on `/leads`, map default on `/properties`, comp dossier — don't widen until paying customers say "irreplaceable" |
| **Land + NI as wedge** | caspar-ng | Suspend vertical-7. De-staff the 5 non-wedge verticals to maintenance mode. Ship NI to $1M ARR before anything else |
| **Hold breadth; let community signal** | diego-marchetti | Don't de-staff for 90 days. Founder-letter + community feedback signals which vertical customers actually use |
| **Multi-vertical IS the moat** | ashok-bhatt, ana-solis | Breadth IS the Series-A story. Vertical-pack pricing future-proofs the 4+ vertical roadmap |

### What's already true

- ✅ All 6 verticals are customer-launchable at the data layer (NI/TD/W/SD/FF/BH).
- ✅ Vertical-pack pricing model live (FW-TEGAN-1: 5 packs $100-$200/mo).
- ✅ Note Investor amortization library bug-fixed (FW-WENDELL-1 — Wendell's specific deal-killer is closed).
- ✅ BH FCRA permissible-purpose + adverse-action notice + audit-trail (RS-1..3 + FW-WYNNE-1) — pre-pilot ready, but the geofence call (D6 below) gates non-TX/OK launch.
- 🟥 No paying customer on any vertical yet. Caspar's revenue gates ($50K ARR/vertical) all read as 0/0/0/0/0/0.

### Consequence map (next 90 days, by path)

**If you pick DEEPEN LAND:**
- 30 days: Ship 90-8 (bulk actions on /leads) + 90-9 (map default on /properties). UI work, founder-time-heavy.
- 60 days: Ship 5 land-power-user features (Wendell's wishlist — call from list, mailer feedback loop, comp-dossier export, etc.)
- 90 days: Trial-to-paid conversion measured on Land cohort only. Other verticals get "we hear you" emails but no new feature investment.
- NI/BH/TD/W/SD/FF customers can still sign up — they just don't get new features.

**If you pick LAND + NI WEDGE (Caspar):**
- 30 days: Land + NI continue active development. Other 4 verticals freeze.
- 60 days: Caspar's revenue gate evaluated at 60-day mark — NI pipeline must show $25K ARR or pause.
- 90 days: Two-vertical wedge proven (or pivot to Land-only). De-staffed verticals stay live but mature into "set and forget" mode.
- Risk: customers who bought BH or W see no investment for 90+ days; concentration risk if any of those 4 leave.

**If you pick HOLD BREADTH (Diego):**
- 30 days: Founder-letter cadence starts (community_letters table is live, FW-DIEGO-1). Each letter asks one specific "what do you wish AcreOS did?" question.
- 60 days: 6 weeks of community feedback. Pattern-match: which vertical is asking for the most depth?
- 90 days: De-staffing decision driven by data, not gut. Highest-signal verticals get continued investment; lowest get paused.
- Risk: 90 days of unfocused work; engineering time spread thin.

**If you pick MULTI-VERTICAL = MOAT (Ashok/Ana):**
- 30 days: Ship the customer-facing /pricing/packs page (the FW-TEGAN-1 backend is ready). Position AcreOS as "the OS for any land-adjacent investor."
- 60 days: All 6 verticals get continued investment, equally. Vertical-pack pricing means each one prices itself.
- 90 days: $25K+ ARR across the cohort, distributed across verticals.
- Risk: Caspar's "compound integration debt" warning — you can't ship deep features in 6 verticals with this team size.

### Trigger if not decided

By 2026-08-08 (90-day verification gate). At that point, the
ASC 606 ledger has cohort data, customer-concentration alert has
fired or not, and Caspar's revenue gates can actually be measured.
Forcing function: the 30-day work order looks different by path.

### Recommendation

**Caspar's "Land + NI wedge" is the highest-conviction call.** Wendell's
"Land-only" is too narrow (forecloses NI which is your second-easiest
GTM); Diego's "wait for community signal" is too slow when you have
zero customers (no signal exists yet); Ashok's "multi-vertical as moat"
is the right narrative but the wrong work order at this team size.
Land + NI wedge: depth where it matters most, freeze the other 4
verticals as feature-complete-but-frozen, revisit after $50K ARR on NI
specifically. The vertical-pack pricing layer means a frozen vertical
can still convert customers — you just don't ship new features.

### ✅ Founder resolution

```
Decision: ___________________________
Date:     ___________________________
Reasoning (1-2 sentences):
___________________________________
___________________________________
Trigger to revisit: _________________
```

---

## D6 — BH (Buy-and-Hold / tenant screening) launch geofence

### The question
*"Can we launch BH tenant-screening nationwide, or do we geofence to
TX/OK at first?"*

### Panel split

| Position | Backers | Headline |
|---|---|---|
| **TX/OK only at launch** | wynne-ohaegbu | CA Civ §1786 and NY Gen Bus §527 each carry $5M+ class-action exposure. Geofence until the substantive attestation form + retention policy + state-specific disclosures are attorney-reviewed. |
| **All states; rely on RS-1..3** | sam-reyes (implicitly) | The shipped permissible-purpose attestation + adverse-action send + audit trail closes the regulatory minimum. Remaining gaps are state-specific paperwork, not core compliance. |

### What's already true

- ✅ FCRA permissible-purpose gate (RS-1) — operator must attest annually + per-tenant.
- ✅ Adverse-action notice send + audit trail (RS-2).
- ✅ Tenant-screening writes through `assertScreeningPermitted()` — no bypass path.
- ✅ Skip-trace also permissible-purpose-gated (FW-WYNNE-1).
- 🟥 No attorney-reviewed disclosure templates for CA, NY, MA, IL, NJ, FL — the operator is currently on their own for state-specific notices.
- 🟥 Substantive FCRA attestation form (180-15) — currently a checkbox, not a structured form capturing the specific permissible purpose per use.
- 🟥 Data-retention policy (180-14) — schema-level rules + automated deletion not in place.

### Consequence map

**If you pick TX/OK ONLY:**
- 30 days: Add `enabled_states` enum to `tenant_screenings`; route gates BH actions on it. Banner on `/bh-customers/how-to-screen`: "CA/NY/etc. support pending state licensing review."
- 60 days: Geofence reflected in Stripe checkout for BH pack — TX/OK customers can buy, others see "Coming Q4 2026" wait-list.
- 90 days: 2-3 TX/OK BH customers prove the wedge; CA/NY pipeline waits.
- Defers: $5M+ class-action exposure window stays closed until counsel sign-off.

**If you pick ALL STATES:**
- 30 days: Hardening on what's already shipped — better operator-facing copy, in-app legal disclaimers per state, "consult your attorney" prompts.
- 60 days: Pen-test of the BH surface. External legal review of the existing flow (cost: $10-20K).
- 90 days: 5-7 BH customers across states — but at non-trivial liability exposure.
- Risk: one CA tenant who feels their adverse-action was wrong files a §1786 claim, opening a class-cert proceeding.

### Trigger if not decided

The first BH customer signup outside TX/OK forces it. Wynne's
recommendation is to ship the geofence BEFORE the first customer to
avoid the awkward retroactive geofence. Could be tomorrow.

### Recommendation

**Wynne's TX/OK geofence.** The class-action math is brutal — $5M
defense cost on a single CA §1786 case, before settlement. The
geofence is a 1-day code change that defers an existential risk
window for ~$200/year/customer of CA market we're not yet equipped
to serve. Open CA/NY in Q4 after attorney review of the disclosure
templates.

### ✅ Founder resolution

```
Decision: ___________________________
Date:     ___________________________
Reasoning (1-2 sentences):
___________________________________
___________________________________
Trigger to revisit: _________________
```

---

## D8 — Eval-harness ownership: engineering or governance

### The question
*"Who owns the AI eval harness — engineering as cost-discipline, or
governance as compliance-mandatory?"*

### Panel split

| Position | Backers | Headline |
|---|---|---|
| **Engineering (cost + quality)** | theo-okuda | Cost ceilings per org, latency budgets, model-version A/B. Engineering metric. Ship the harness as part of the dev loop. |
| **Governance (compliance-mandatory)** | indira-lockwood | SOC 2 + FCRA require explainability + bias audit. The harness is compliance evidence, not engineering tooling. Block model swaps until harness passes. |

### What's already true

- ✅ Eval harness v0 shipped (FW-THEO-1 + FW-INDIRA-1). Schema: `ai_models`, `ai_test_cases`, `ai_test_runs`, `ai_cost_ceiling_overrides`.
- ✅ Per-org AI cost ceiling (`assertWithinAiCostCeiling`) — fail-open on telemetry-table read failure, $50/day default.
- ✅ complianceAI post-validator on AI-generated disclosures (FW-INDIRA-2) — reuses the disclosureRegistry that gates dispatch.
- 🟥 No test cases seeded yet. The harness has zero scenarios in the corpus.
- 🟥 No "block model swap until harness passes" gate — currently the founder can change models freely.
- 🟥 SOC 2 Type I package not started. Indira's "this is governance evidence" claim is true, but no audit is scheduled.

### Consequence map

**If you pick ENGINEERING:**
- 30 days: Theo seeds 5 baseline test cases per surface (Pax inbox, Pax executive, complianceAI). Engineering owns the corpus.
- 60 days: Cost-ceiling alerting wired to `/founder-home`. Latency P95 metrics shipped per model.
- 90 days: A/B model rollout via the harness — "swap claude-opus-4-7 for sonnet-4-6 if pass-rate stays ≥95% and cost drops ≥20%."
- Defers: SOC 2 audit-evidence prep until Q3 (180-1).

**If you pick GOVERNANCE:**
- 30 days: Indira seeds compliance-shaped test cases (FCRA disclosure correctness, TX §5.069 inclusion, no-codename-leak). Compliance owns corpus.
- 60 days: Hard gate: "no model swap unless harness pass-rate ≥98% on critical-severity cases." Founder gets paged on a red.
- 90 days: SOC 2 Type I evidence package starts pulling harness reports as the AI-controls section.
- Risk: harness becomes a velocity bottleneck if test-case authoring is slow.

### Trigger if not decided

When SOC 2 Type I kicks off (180-1, planned 180-day mark). Or when
Anthropic / OpenAI announces deprecation of a model we're using —
that forces a swap, and the harness either does or doesn't gate it.

### Recommendation

**Indira's governance framing wins LONG-TERM, but Theo's engineering
ownership wins NEAR-TERM.** Concrete proposal: Theo owns the harness
infra + cost-ceiling for the next 90 days (gets test cases seeded +
cost alerting wired). At 2026-08-08 (verification gate), flip
ownership to Indira's compliance frame as part of SOC 2 prep. The
artifact is the same; the consumer changes from engineering quality
gate to compliance evidence. One harness, two consumers, sequenced.

### ✅ Founder resolution

```
Decision: ___________________________
Date:     ___________________________
Reasoning (1-2 sentences):
___________________________________
___________________________________
Trigger to revisit: _________________
```

---

## How this packet gets used

1. Founder reads each section + recommendation.
2. Fill in the resolution box at the end of each (decision + date + reasoning + trigger).
3. Save as `_DECISIONS-RESOLVED.md` (commit). The team executes against the resolved version.
4. The other 6 trade-offs (D3, D4, D5, D7, D9, D10) stay in `_DECISIONS.md` as sequencing-compatible — re-evaluate when their named triggers fire.
5. At each 30/90/180/365-day verification gate, check whether the resolutions are still right. They expire when the trigger conditions change.

Authored 2026-05-08 by the synthesis pass on top of 20 persona memos.
The recommendations reflect cross-panel weighting + my read on
sequencing risk; founder owns the call.
