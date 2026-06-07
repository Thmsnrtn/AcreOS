# AcreOS — System Elevation Roadmap

_Synthesized by Solene, 2026-06-07, from all 11 team-member lenses (detail in `_elevation/`). Tom's ask: pre-first-customer, what would each member refine / improve / elevate / develop across the whole system — customer and founder sides — to take a good system to a great, distinctive one. This builds beyond everything shipped in the first-customer-readiness arc._

## The one meta-finding (my COO read)

**Almost every lens's "most embarrassing gap" is the same shape: we built world-class *substrate* in the big push and skipped the cheap *last mile* that makes it visible, enforced, or consistent.** Independently, Iris, Beatrice, Quinn, Andrei, Iyari, Tess, Soren, and Lena all said a version of "the hard part is done — the elevation is wiring the good thing we already have into the surface that's actually touched." Two consequences:

1. **The highest-ROI work right now is cheap** (S-effort last-mile fixes), not a new build phase.
2. **A cluster of those last miles are honesty/consistency *regressions* that contradict our own shipped honest-data posture** — and a sharp, data-literate first customer (ours will be) catches them fast. Those come first.

A second meta-finding: **six domains independently asked for the same two things** — a per-domain *continuous-audit loop* and a synthesized *founder "is it green?" cockpit*. Don't build six. Build one shared findings substrate + one founder Command surface (see "Shared infrastructure" below). That's the COO-level leverage.

---

## P0 — Honesty, consistency & safety debt (fix before customer #1; mostly S-effort)

These are not elevation — they're places the big push left a seam that undercuts our core "honest, trustworthy" promise. Several are live landmines.

| # | Gap | Lens | Why it's P0 | Effort |
|---|---|---|---|---|
| 1 | **`maps.tsx` still fabricates data** — a `Math.sin()` price-per-acre sparkline with per-month dollar tooltips + a synthetic parcel boundary rendered as authoritative. | Krieger, Iris | The exact "trust bomb" we eliminated everywhere else — the honest-data pass *missed the Map door*. Adjacent code literally brags about killing the radar version. | S |
| 2 | **`demographicBiasFindings: []` is a hardcoded stub** behind the public `/transparency` schema that advertises a bias audit. | Quinn | A fabricated clean-bill-of-health *inside the alignment surface* — immutable #1 violated by the system built to enforce it. Make it honestly "not yet measurable — no volume." | S |
| 3 | **Detractor NPS never reaches the founder** — the live dialog POSTs `/api/nps` (no alert); the detractor-alert code sits on an orphaned `/api/nps/submit` no client calls. | Rafe | A customer rates us 3, types "about to cancel," hits submit → silence. Our whole CS identity is "every detractor is a same-day call." | S |
| 4 | **Sitemap will silently delete our 10 best `/learn` pages on next build** — generator reads `public-routes.ts` (zero /learn) and overwrites the committed file. | Soren | Our statute-grade content is one `npm run build` from vanishing from Google. | S |
| 5 | **Pax chat surface has no standing AI-disclosure / "tool, not advisor" rail** — enforced server-side, cited in our ledger, but invisible on the one screen customers live in. | Beatrice | Pillar #1 of our doctrine, absent where it matters most. An attorney spots it in ten seconds. | S |
| 6 | **Hero renders frozen fake numbers** (14 comps / $2,840 / 87% / $14,200 offer) — the pattern `copy.ts` documents removing for truth-engine reasons. | Soren | A source-reading customer sees the fabricated-value pattern we publicly killed. Frame as "Example output" or cycle real fixtures. | S |
| 7 | **Founder runway is `FOUNDER_CASH_ON_HAND_USD` ÷ crude 30-day burn, dressed as a model**; `monthlyPayment` collection % uses `noteCount × $500` ("rough average"). | Lena | We sell a provenance contract that refuses unsourced numbers while our own dashboards show fabricated ones. | S–M |
| 8 | **Alerts never ring Tom's phone** — VAPID push is wired to "deal accepted," not to incidents/SEV-1; the in-app monitor lives inside the suspended app it watches. | Tess | A 3am production failure produces a DB row + an unread email. "Twitter found out first" by construction. | S–M |
| 9 | **Pax's strongest gate (`gateOutputOrThrow` + critical eval cases) is CI-only, not on the live path.** A paraphrased hallucination ("low-risk flood area" after a miss) clears the heuristic guard + substring eval. | Andrei | "Pax won't guess" is a claim we can't fully defend on the live turn until the gate runs at runtime. | S |

I can start on this batch immediately — most are afternoon fixes, like the iOS/landing fixes were.

---

## Elevation tracks (the "good → great" work, by theme)

### A. One data spine + the longitudinal moat _(Iris + Iyari — same bet from two seats)_
- **Collapse the 4 parallel data front-doors** (provider-registry / data-source-broker / data-source-lookup / parcelIntelligenceFusion) onto **one `resolveParcel` facade** via strangler-fig (migrate public widget first, shadow-compare diffs, then delete). _The honesty contract is enforced on only 1 of 4 today — same APN in two doors can disagree._ **L.**
- **Every resolved field writes to the `parcel_observations` ledger; every surface (incl. Pax grounding) reads from it.** Makes "two doors disagree" structurally impossible and turns "how do you know this?" into a real, time-stamped answer. _This is the credibility moat a scraped-data competitor can't fast-follow._
- **Mine the time series, not the first difference** — a **"Parcel Biography"** engine (assessed-value velocity, owner-tenure clock, tax-delinquency recurrence) from history we already capture free. _"PropStream shows you today; AcreOS shows you the story."_ **M.**
- **Backfill the ledger now** from historical fields counties already expose (assessment year, prior values, deed dates) with backdated `observed_at` — a **now-or-never** window; organic accrual takes years. **M.**
- **Publish `llms.txt` + an agent-discovery card** — we built the hard MCP surface and the agentic web literally can't find us. **S.**

### B. Trust, published — the constitutional-company moat _(Beatrice + Quinn — converge)_
- **Ship the public Transparency Report** (the aggregator runs nightly; the page says "coming soon") — refusals by immutable, appeals upheld/reversed, founder-bypass count, drift findings. _After fixing the bias stub (P0 #2)._ **M.**
- **Close the customer-recourse loop**: when Pax refuses, show the cited rule in plain language + an **"Appeal this"** affordance → review → outcome returned. _Nobody else lets you appeal the AI; EU AI Act Art. 86 is in our own schema header._ **M.**
- **OFAC/sanctions counterparty screening** (soft warn, audit-logged) before money/documents move. _Strict-liability; no land tool does this._ **M.**
- **Weekly audit-chain verification + a customer-visible "your history is tamper-evident, last verified <date>" attestation.** **S.**
- **Unify the two constitutional enforcement paths** (sovereign vs customer immutables) into one reasoner + one finding sink; add an **LLM-judge floor** under the regex (shared with Pax — see D). **L.**

### C. Indispensability & product coherence _(Maren)_
- **"Close & Carry" — weld the Deals door and the Finance door into one continuous object** (closing a seller-financed deal one-click-originates the serviced note; no re-keying). _The single feature that turns AcreOS from "tools a customer visits" into "the ledger they can't leave" — retention becomes data-gravity._ **L. (Maren's + arguably the company's boldest product bet.)**
- **Make `/today` a habit loop, not a digest** — resolve queue items *in place* (Done / Snooze / "Pax, draft the follow-up") to inbox-zero, with a designed "all clear" reward state. **M.**
- **Vertical *home screens*, not vocabulary swaps** — a tax-lien operator's Today leads with the redemption clock; a note investor's with payments-due/delinquency. **M.**
- **Cut the persona long tail before customers see it** — 14 `businessType` enum values, 5 gated; offer only the verticals we can be best-in-class at. **M (decision).**
- **Land Snapshot → action** — wire the Snapshot's confident fields into the blind-offer wizard (parcel → offer in under a minute). **M.**
- **A Finance "Book" view** that answers worth / inflow / delinquency at a glance (mirror the Today consolidation). **M.**

### D. Pax → genuinely expert + measured _(Andrei + Quinn)_
- **Live eval gate on the Pax path** (P0 #9) → then a **semantic LLM-judge** (cheap Haiku→Sonnet cascade; `scpLLMJudges` exists) replacing substring checks — catches paraphrased hallucinations. _Shared judge backs Quinn's alignment detectors too._ **M.**
- **Measure + publish Pax's hallucination rate** — the `aiQualityAudit` 7-detector loop (charter, not built) → one trustworthy number ("99.x% data-grounding accuracy, calibrated") surfaced honestly. _Every competitor says "may be inaccurate" in 8pt gray; we'd measure and show the work._ **Andrei's boldest bet. M–L.**
- **Land-expertise retrieval layer** — a small curated, cited land-knowledge corpus (FEMA zone semantics, SSURGO class meaning, seller-finance/usury mechanics, diligence traps) so Pax sounds like a 20-year investor, not a generic chatbot. Voyage client + pgvector already built + idle. **M–L.**
- **Confidence calibration** — deterministic bands from provider confidence + staleness, measured (Brier) over time. **M.**
- **Prompt-versioning as enforced CI** (every customer-facing prompt versioned + eval-covered; fail PRs that edit a prompt without bumping/covering). **S.**

### E. UX craft — premium feel from primitives we already under-consume _(Krieger)_
- **Boldest: a streaming "Snapshot assembling" experience** — stream each gov source in as it resolves (tile flips "Querying FEMA NFHL…" → value + provenance + a soft haptic), with a "5 federal sources · 1.2s" meter. _Converts our biggest liability (cold-parcel latency) into our biggest demo asset, on the public widget a customer hits pre-signup._ **L.**
- **View Transitions API** for list→detail morphs; **optimistic UI + haptics** on the daily-loop mutations; **animated counters** on money figures; a **shared-element sliding nav indicator**; **pull-to-refresh** (component built, unused). All from existing motion/haptic tokens. **S–M each.**

### F. Customer success craft _(Rafe)_
- **Boldest: the Recourse Loop** — every negative signal (detractor NPS, ≤2 support rating, escalation, cancel) auto-drafts a *personal* reply seeded with the customer's verbatim + account context, one-click edit-and-send, persisted back into their thread. _Overlaps Quinn's appeal-the-AI; build as one capability. No SaaS at our stage does this._ **L.**
- KB-draft **inline editor + customer "was this helpful?"** loop; **onboarding instrumented to a value event** (`first_land_snapshot_viewed`, not a click); **Pax→human handoff continuity** (owner state visible, reply lands in-thread); the **AcreOS support voice** over the generic Pax-Support prompts. **S–M.**

### G. Self-defending reliability _(Tess)_
- **The closed chain**: external Cloudflare-Worker eye → detection → auto-open incident → **VAPID push to Tom's phone** → ack-timer → blameless post-mortem. _Today we have every component and almost none of the connections; the watchman lives inside the building it watches._ **Tess's boldest bet. M (mostly wiring).**
- **Burn-rate SLO alerting** (not pull-only), **light up OTel** (Honeycomb free tier — traces of the first real sessions), **worker heartbeat** checked externally, honest "since boot" labels on amnesiac counters, **run the first real DR drill** (history has zero entries). **S–M.**

### H. Financial machinery → a CFO co-pilot _(Lena)_
- **Runway-to-zero, three scenarios, one number** (real burn from `financial_ledger`, not the env var) → the spine for everything. **L.**
- **The finance-audit loop** (envelope overrun / tax-reserve shortfall / runway crunch detectors) + **LTV:CAC:payback** modeling + **a live "Paid-Data Readiness" card** that tells you when the Regrid buy becomes rational. **Lena's boldest bet: one CFO cockpit that states a position, not six dashboards that show numbers.** **M–L.**

---

## Shared infrastructure (build once, not six times) — my strongest COO recommendation

Six domains (Lena, Beatrice, Quinn, Andrei, Tess, Iyari) each asked for **(a) a continuous-audit detector loop writing findings, and (b) a founder surface that says "is my domain green?"** Building these bespoke six times is the trap. Instead:

1. **One `domain_audit_findings` substrate** + a shared detector interface (severity, cited reason, source domain, status) — every domain's loop writes to it.
2. **One founder "Command" cockpit** (`/founder` home elevation) that aggregates all domains' open/aged findings into a single "is the company green right now?" view — Lena's runway, Beatrice's compliance tiles, Quinn's bypass reviews, Andrei's Pax quality, Tess's SLO burn, Iyari's "acorn still growing." Each domain contributes a tile; the cockpit is the synthesis.
3. **One LLM-judge service** (generalize `scpLLMJudges`) backing both Pax grounding (Andrei) and alignment detectors (Quinn).
4. **One source-of-truth registry pattern** already proven (data-licenses, disclosureRegistry) extended to disclaimer strings (Beatrice) + brand/voice (Soren).

This is the difference between six teams each building a dashboard and **one coherent founder command surface** — and it's exactly the "synthesis, not numbers" thing Lena, Beatrice, and I all independently flagged.

---

## Suggested sequencing

1. **P0 honesty/safety batch** (all of the table above) — cheap, and they protect the trust thesis. Start now.
2. **Shared audit-findings substrate + founder Command cockpit** — unblocks H/B/D/G's loops cheaply.
3. **Pick the two boldest bets to anchor the next arc:** **Close & Carry** (Maren — indispensability) and **One spine → the Parcel Biography** (Iris + Iyari — the data moat). These are the two that change what AcreOS *is*.
4. **Trust-published** (Transparency Report + Recourse Loop) — the distinctive, externally-legible moat, once the bias stub is honest.
5. UX craft + Pax expertise + reliability spine + CFO co-pilot — in parallel as capacity allows, on the shared substrate.

---

_Per-lens detail: `docs/internal/roadmap/_elevation/{iris,soren,beatrice,krieger,maren,lena,rafe,andrei,tess,iyari,quinn}.md`._
