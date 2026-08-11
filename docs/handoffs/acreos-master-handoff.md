# AcreOS Depth Audit — Master Handoff

**For: Claude Fable 5, operating in Claude Code, inside the AcreOS repo (`Thmsnrtn/AcreOS`).**
**From: a full-repo depth audit conducted 2026-08-08/09 (six parts + two addenda, consolidated here).**
**Authority: the founder. This document proposes; the repo's constitution and founder rulings dispose.**

---

## §A. How to use this document

You are receiving a six-part product/feature/liability/revenue/operations/founder-machine audit plus five execution addenda, married into one dependency-ordered program (§D). The six parts (appended in full below as the reference body, §H) contain the *why* and the detail for every workstream; §D is the *order*; each item is shaped as a wave brief: context → files → exit test. Addenda A/B/C are §E/§F/§G, before the reference body; Addenda D/E are §I/§J, **after** it (they arrived later and were appended in the position their packet specified — no renumbering, so existing cross-references stay valid).

**One correction of record lives in the addenda:** §J R.0 supersedes Part 3 §2.4 (`§H`). The BYO physical-mail architecture already exists and is correct; do not execute the §2.4 remediation as written. §2.4 carries an inline banner saying so.

Operating rules, in priority order:

1. **Read `CLAUDE.md` and `shared/governance/constitution.ts` before any work.** Their wave discipline (verify against code, hunt built-but-unwired, independent completeness audit after every wave) and hard rules override anything here. Where this document and the repo disagree, the repo wins — note the drift in the findings ledger and move on.
2. **Re-verify before building.** Line counts, file paths, and finding states in this audit were true at clone time (2026-08-08); the repo moves fast and the engineering audit (`docs/audit-2026-08/`) was only three days old then. Confirm each brief's premises against HEAD before executing it; if a premise no longer holds, record it and re-scope rather than forcing the brief.
3. **Exit tests are mandatory.** No wave starts without its falsifiable exit test stated; no wave closes without the completeness audit verifying that test. Prefer ratchet tests (baseline + direction) over one-shot assertions, in the house style.
4. **Never relitigate founder rulings.** The five customer doors, four founder doors, no-new-AI-destinations, be-the-rail money/send custody, refuse-not-fabricate, the hard-stops (pricing, legal signing, spend >$500, customer-data deletion = founder-only), and the trigger ladder (§C) are settled. Recommendations here were written *inside* those lines; if any item seems to cross one, that's a drafting error — flag it, don't ship it.
5. **Anything touching a hard-stop domain, a send lane, money routing, or gate/ratchet baselines: propose, don't merge.** Surface it to the founder's queue with the deliberation attached.
6. **When data is unknown, refuse-not-fabricate applies to you too** — in code, in copy, in commit messages, and in the statute work of Addendum B.

## §B. Prerequisites (blocking; mostly already briefed in-repo)

The engineering audit's "Ten" (`docs/audit-2026-08/REMEDIATION.md`) are the floor under everything in §D — notably: tenant-boundary fixes, the DNC/SMS choke totality (F-21-1), Pax guard parity on the non-streaming path (F-08-1), and the schema→DDL mirror. Do not ship agentic, growth, or send-adjacent waves ahead of them. §D Wave 0 adds this audit's trust prerequisites to the same floor.

**One dated emergency inherited from slice 18: the ATTOM trial lapses ~2026-08-28** (sole source for residential comps; the probe is structurally blind to it). The F-18-1 fix — expiry registry + countdown pages + step-away check — should land in days, not waves.

## §C. Standing constraints & trigger ladder (consolidated)

Five customer doors forever; four founder doors + `/founder/admin/` tools. No new AI destinations — Pax stays ambient. Customer money moves only on the customer's own connected processor (runtime-asserted). Counterparty email/SMS only on BYO identity; physical mail joins them per Part 3 §2.4 (wedge 5-piece is a *registered* exception). No fabrication anywhere: unknown renders as unknown. Beta stays labeled, in-product and in marketing.
**Triggers (build only when fired):** marketplace ≈25 customers · public API / open MCP ≈50 · residential comps/fabric → its constitutional revenue trigger · bank feeds → first customer ask or ≥10 paying · STR channel APIs → ≥5 paying STR requests · L4 delegated outcomes → P-1/2/6/8 green + an L3 cohort stable 60 days · desktop shell → a real desktop-only customer workflow · county-fabric expansion → the RequestCountyCTA queue + paying customers' counties.

## §D. The unified execution sequence

Waves are dependency-ordered. **[∥]** marks work parallelizable within its wave via sub-agents under the completeness-audit discipline. Sources cite the part/section carrying full detail.

**WAVE 0 — Trust prerequisites (blocking; serial where marked).**
0.1 The Ten (repo REMEDIATION briefs) — confirm state, finish stragglers.
0.2 ATTOM expiry registry + pager + step-away check (P5 §3.3 / F-18-1) — **immediately**.
0.3 Router totality + `.chat.completions.create` allowlist lint across Pax, VA, support, Atlas, Solene (P2 P-5, P5 §5, P6 §5 / F-16-1/2).
0.4 `resolveActionPolicy` — autonomy matrix becomes enforcement at the pending-actions chokepoint + `autonomyEnforcement.test` (P2 P-1).
0.5 Guard totality: `finalizePaxOutput` on non-streaming + subagent recursion; subagent outputs re-enter enveloped; depth/step budgets; injection eval lane in CI (P2 P-2).
0.6 Connectors `executor.ts` P0 disposition: org-scoping on every credential fetch, SSRF guard on URL paths, results enveloped (P2 §8.1).
0.7 MCP server dark/per-org allowlist; hashed-key auth (Data-API infra); shared-store rate limit (P2 §8.2, P3).
0.8 Mail lanes — **re-scoped by §J R.0/R.1** (the original "`lobService` → `resolveProviderCredential`" brief is superseded: the BYO path already exists in `mailProvider.ts`). The real work is consolidating the three parallel mail paths onto `mailProvider`, plus purpose lanes, wedge cap, refuse-don't-fall-back, and the LOB-key grep ratchet + `mailProviderLanes.test` (P3 §2.4 as corrected by §J).
0.9 Critical-job-failure pages + pager-matrix-as-data ratchet; external watchdogs armed (P5 §3.1 / F-13-1, F-18-2).

**WAVE 1 — Feel & foundation.** [∥]
1.1 Invalidation-registry adoption + optimistic mutations as house pattern (P1 §2.1). 1.2 Error states + stale-while-error, five doors (P1 §2.3). 1.3 Today queue keys/snooze/"approve all above threshold"; Deals optimistic drag + column intelligence; Inbox needs-reply view + Superhuman keys (P1 §4.1/4.2/4.4). 1.4 `EntityTable` kit; migrate Leads/Properties/Notes/Rent-roll/Auction-worksheet (P1 §2.2). 1.5 Settings decomposition: five-group left rail, routed sections, redirects, status-row grammar, no-new-TabsContent lint (P2 §1). 1.6 Pax tool dedupe + per-context capability scoping (P2 P-3).
*Exit: create-lead visible on Today instantly; network kill degrades honestly everywhere; QuickFind resolves 100% of the settings inventory; tool registry has zero duplicate verbs.*

**WAVE 2 — Map M0+M1 + honesty plumbing.**
2.1 MapLibre Phase 2 + self-hosted Protomaps basemap (P1 §3.3 M0). 2.2 First 3–5 license-cleared county fabrics as PMTiles vector parcels (P1 M0). 2.3 Click-to-identify → inspector → "Track this parcel" → quick actions (P1 M1). 2.4 Unified provenance/freshness grammar + parcel freshness ledger (P1 §2.5). 2.5 License-aware egress chokepoint over export/report/webhook/MCP + fixture test (P3 §2.6/§5.2). 2.6 Disclaimer-coverage lint (P3 §2.9/§5.3).
*Exit: tap an untracked parcel in a tiled county → owner/APN/acres <1s with zero paid-API calls → tracked → existing offer flow unchanged; a `redistributable:"no"` field cannot leave the platform (test-pinned).*

**WAVE 3 — Depth-per-vertical.** [∥ by vertical]
Aging boards (notes + rent, one ladder component) · auction-day map mode · DriveMode route replay · CAM reconciliation worksheet · MH park rollup + pad map · developer pro-forma · Close & Carry composer · renewal-pipeline kanban · payoff-quote PDF · bid-tape worksheet · offer-batch performance readback (P1 §5, P1 M4). Registry meta lands with it: `mapProfile`, `paxSkills`, `activationEvent` per vertical + the vertical-health founder panel (P1 §5, P4 §5.1). Beta→core flips ride honest completions only.
*Exit: each shipped surface passes its vertical's signature-loop canary; promotion evidence generated by the health panel, not hand-audited.*

**WAVE 4 — Communication & collaboration.**
4.1 Inbox counterparty lenses (P2 §3.1). 4.2 Draft-reply through router + witnessed kernel + objective presets; intent extraction with provenance one-tap writes (P2 §3.2). 4.3 Entity threads + @mentions + approvals-as-objects incl. VA→manager witnessed approvals; Pax @-mentionable in threads (P2 §2). 4.4 Negotiation transplant: lens into deal/thread, standalone + twin service killed per ledger (P2 §6). 4.5 Deal lineage strip + continuous dedupe/stack-score (P2 §4).
*Exit: a two-person org runs a full deal in-thread; `/negotiation` route gone, baselines lowered same commit.*

**WAVE 5 — Acquisition machine + Map M2.**
5.1 Draw-to-search + filter-on-fabric (acreage/absentee/vacant/flood/slope stats precomputed at tiling) (P1 M2). 5.2 Watched searches → Today parcel alerts (P1 M2). 5.3 Audience engine + suppression receipts; cross-channel cadence with consent state machine; CAC-per-county; deliverability cockpit; compliance pre-flight receipts; template attribution at point of choice (P2 §5, P1 §4.7).
*Exit: saved search → audience → mail batch → reply → extracted intent → drafted counter as one instrumented funnel.*

**WAVE 6 — Agency maturation.**
6.1 Memory API consolidation to four tiers; panel shows what/why + per-fact forget (P2 P-4). 6.2 Deal genome with license gate on writers (P2 §4.4, P3 §5.5). 6.3 Plan–act–verify with verifier pass on money/send actions (P2 P-6). 6.4 Customer action ledger + replay (P2 P-8). 6.5 Standing-instruction consent artifacts wired into `resolveActionPolicy`; L2 ships, L3 gated on green P-1/2/6/8 (P2 §9.2, P3 §2.10/§5.4). 6.6 Customer weekly Letter from receipts (P2 §9.3). 6.7 Per-surface cost envelopes with self-pause (P2 P-5, P5 §5.2). 6.8 Uniform Pax invocation + per-vertical skills chips (P2 §2.6, P1 §4.5).
*Exit: Part 2's closing test — an L2 org runs a full week, every send policy-gated, every number sourced, Friday Letter reconciles to the ledger exactly.*

**WAVE G — Revenue engine (parallel track; may start after Wave 0).** [∥]
G1 (pre-first-customer): `activationEvent` declared per vertical + recorder asserts real-entities-only; public demo org; `/for/<vertical>` routes generated from the registry; provable-claims page; `marketing-claims.test` over landing copy; wedge funnel instrumented end-to-end (P4 §§2–5, §8). G2 (customers 1–10): artifacts-that-travel attribution; concierge onboarding with minutes-to-value measured; consented case receipts. G3 (10–25): referral rewards on; paid wedge loop with CAC receipts; per-vertical front doors complete; annual prepay at trust milestones; churn interventions with receipts (P4 §§4,6,8).

**WAVE O — Operations doctrine (parallel track; after Wave 0).** [∥]
O1 `dated_obligations` generalized + step-away integration + integration-time lint (P5 §3.3). O2 First DR restore drill executed, RTO published; quarterly freshness ratchet; `backup_verified` reader (P5 §3.2). O3 Runbook link-lint + top-5 runbooks verified (P5 §3.4). O4 SLOs per surface class; synthetic persona-journey canaries; public status page (P5 §2). O5 Support loop: grounded deflection (post-0.3), severity SLAs into founder queue, resolution→KB/finding/changelog one-taps, fixed-it pings (P5 §4). O6 Unit-economics receipt in the Letter; infra-curve panel (P5 §5). O7 Vacation test run + receipted; deputy break-glass kit + freshness ratchet; continuity statement on /transparency (P5 §6).

**WAVE F — Founder machine (parallel track; after Wave 0).**
F1 Cockpit consolidation to Letter/Decisions/Controls/Story + `/admin` tools, redirects, legacy ratchet → 0; full keyboard treatment (P6 §2). F2 One decision queue: seven inflows merged, reasons captured on every disposition, decisions-vs-outcomes monthly Letter section (P6 §3). F3 Eternal-lines ratchets: self-patch-cannot-merge + gate-tamper pages (P6 §4). F4 Atlas/Solene tool hygiene + envelope + telemetry parity (P6 §5; 0.3 covers the router). F5 Governance store unification with Story as reader; brief template with mandatory exit test; ratchet-coverage report as Letter KPI (P6 §6). F6 Quarterly game-days (worst-day sim, panic/resume) into the drill cadence (P6 §4).

**WAVE S — Staff & autopilot doctrine (parallel track; after Wave 0; overlaps Wave F; brief in §G).** [∥]
S1 Charters over gates: a charter object per Trust-Ledger domain (mandate · metrics owned · senses · hands · standing orders · ladder state + streak · budget · escalation · report cadence); Beatrice formalized as the sixth chartered domain (compliance); staff rendered as charter cards in the Controls door (§G C.2-S1). S2 Autonomy follows perception: no promotion past `draft` while a charter's core senses are unwired (test-pinned); senses built in charter priority order; every unwired core sense prints a blindness line in the Letter (C.2-S2). S3 Hands proportional to mandate: support grounded-resolution hand; deploy + rollback hands (canary-green + `codeChangeGate`; self-patch still never merges itself); ops remediation hands; finance/growth/Beatrice proposal-artifact hands (pricing stays hard-stopped forever); every new hand ships with reflex tests, a kill switch, a ledger entry, and witnessed/net-new discipline (C.2-S3). S4 Scenario library as executable doctrine: the trigger → charter → playbook → autonomy → founder-touch → drill matrix, seeded rows incl. legal-letter always-page and the model-provider-outage drill; game-days walk it; `worstDay` generates rows (C.2-S4). S5 Conflict → negotiation with a record: two-position decision memos on cross-charter contention; founder reasons feed `policyInducer` (rides F2's reasons-on-disposition); repeat resolutions become standing-order proposals; the Operator's `strategyNote` lands in a real Strategy Memory (C.2-S5). S6 The CEO interface, cabinetmaker edition: interrupt contract for declared shop hours; evening queue with recommendation, default, and "what happens if you do nothing" — expiry-to-safe-branch, silent limbo forbidden by construction; Sunday Letter; quarterly charter reviews (C.2-S6). S7 Maturation curve: four trust ledgers (clean-cycle streaks, drill receipts, ratchet coverage, decisions-vs-outcomes), named milestones, annual rhythm (C.2-S7).
*Exit: §G C.3 — all six charters live with metrics/senses/hands and a Letter section, blindness lines printing; promotion integrity test-pinned; the conflict test end-to-end (two-position memo → reason captured → standing-order proposal on repeat); the quarterly Shop-Day Test run and its streak published on the trust page.*

**WAVE X — Addenda A/B (§E/§F): X-A after Wave 0 + G1; X-B may start immediately [∥], gates specific automations.**

**WAVE L — Legal documents & disclosure surface (parallel track; no Wave 0 dependency; start anytime).** [∥]
L1 truth-alignment pass — ToS §6 free-trial divergence, factual re-verification, §20 placeholder, §9 data-license alignment · L2 new ToS sections (Roles & Responsibilities, Customer-Connected Services, Automated Actions & Standing Instructions, missing mechanics) · L3 Beta/Early Access Addendum · L4 disclosure-surface sweep (disclaimer coverage ratchet, send-lane footers, consent capture, checkout, beta badging, statute-bearing surfaces) · L5 single source of truth + acceptance capture + drift ratchet · L6 counsel packet. *Full brief: Addendum D (§I). Standing rules in L.0 are binding — this produces a better draft, not legal sign-off.* L4.2 coordinates with Wave 0 item 0.8.

**WAVE R — Responsibility hardening (R.1 at Wave 0 priority; remainder parallel).** [∥]
**R.0 supersedes Part 3 §2.4** — the BYO Lob architecture exists and is correct; the defect is three parallel mail paths. R1 mail-path consolidation onto `mailProvider` + grep ratchet (**gates safe public signup — pair with R3.1**) · R2 Attestation Gate primitive extracted from `AtrGate` · R3 gates applied (CSV import rights, skip-trace purpose, document adoption, autonomy grant, dunning arming, bulk-send friction) · R4 platform voice — confident but never bare (basis line + mounted disclaimer + editable field; founder ruling, do not neutralize the voice) · R5 statute-bearing surfaces + per-user actor attribution. *Full brief: Addendum E (§J).* R3.4 depends on Wave 0 item 0.4.

*(WAVE S — staff & autopilot doctrine — is registered above with its full item list and exit test; the addenda packet's shorter S line was reconciled into that block rather than duplicated. Its brief is §G, Addendum C.)*

---

## §E. Addendum A — Abuse & Bad-Customer Red Team (wave brief)

**Context.** Parts 1–6 protect the founder and the honest customer; nothing yet models the dishonest customer. The wedge (free 5-piece mail), the outreach rails, the borrower/tenant portals, and the share artifacts are all abusable surfaces, and every abuse lands on rails that — post Part 3 — carry either the org's identity or a *registered* platform exception. Threat inventory and mechanism, in priority:

1. **Wedge farming** — burner orgs harvesting free mail at platform cost/reputation. Mechanism: a signup friction ladder (verified contact before first counterparty send; disposable-domain screen), per-recipient-address dedupe across *all* orgs on the platform Lob lane, wedge velocity caps per signup cohort, and payment-method-on-file to exceed the wedge. Files: signup flow, `lobService` lanes (post 0.8), a new `orgTrustTier`.
2. **Outreach harassment** — one org hammering one human across channels/campaigns. Mechanism: platform-global per-recipient frequency ceilings enforced at the send chokepoints (not per-campaign), global opt-out honored org-wide by construction, complaint/litigator feedback events decrementing the org's trust tier.
3. **Portal-as-phishing** — borrower/tenant links reused as lures. Mechanism: link expiry + rebind on the HMAC tokens, an org-verification treatment on portal headers, and a visible "report this page" affordance feeding an abuse queue.
4. **Scam storefronts** — deal-room/share artifacts dressing up fraud. Mechanism: report affordance on every public artifact, a takedown runbook (founder-approved, since customer-data actions are hard-stopped), ToS enforcement path documented.
5. **Account takeover → mass send.** Mechanism: send-velocity anomaly detection per org baseline, step-up confirmation on new send identity or new payout target, session/device notices (extend existing security settings).
6. **Scraping/exfil** via exports/MCP — already structurally covered by the egress chokepoint (2.5) + rate limits; add per-org export velocity to the anomaly set.

**Design spine:** one `orgTrustTier` (new → established → trusted) gating caps on every abusable lane; abuse signals scored by a sibling of the churn engine; enforcement ladder warn → limit → suspend with founder approval on suspensions. All caps are *chokepoint additions to existing gates* — no new surfaces.
**Exit test:** scripted red-team scenarios as CI fixtures — a burner cohort attempting 50 wedge sends across fresh signups hits the ladder; a recipient's Nth-touch-in-window from any org refuses at the chokepoint; a revoked portal token dies; a reported artifact reaches the abuse queue in one event hop.

## §F. Addendum B — Domain-Truth Verification Program (wave brief)

**Context.** The statute register, state-rules pages, redemption clocks, Dodd-Frank checker, TCPA windows, and county-timeline claims are load-bearing legal/domain assertions currently held as data without systematic sourcing — the F-15-2 claim-truth finding, scaled to a program. Refuse-not-fabricate must apply to law.

**Method.** (1) Inventory every load-bearing claim into per-claim rows: `{claim, jurisdiction, primarySourceCitation, retrievedAt, verifiedBy, confidence, nextReviewDue}` — statute register first, then per-vertical rules pages. (2) Verify in state-by-state waves, prioritized by customer counties then core-vertical coverage; Fable 5 drafts verifications against primary sources (state codes, official county pages) — **rows that gate money, deadlines, or legal exposure (redemption periods, late-fee caps, disclosure requirements) are flagged for licensed-professional spot-check before "verified" status; drafting is not verification for those.** (3) Enforcement: unverified rows render with an explicit unverified treatment and **block dependent automation** — no redemption-deadline notification, no auto-computed late fee, no compliance pass fires from an unverified row. (4) `nextReviewDue` rows feed `dated_obligations` (O1) so law-change review is on the same calendar as vendor renewals. (5) Ratchet: count of load-bearing claims without primary-source citations, baselined and driven to zero; annual re-verification cadence thereafter.
**Exit test:** every state with customer activity fully sourced; zero deadline-bearing automations reachable from an unverified row (test-pinned); the claims-without-citations ratchet trending down in CI.

---

## §G. Addendum C — The Staff & Autopilot Doctrine (wave brief)

*Added 2026-08-10. Slots into the Master Handoff as Wave S (runs parallel after Wave 0; overlaps Wave F). This addendum answers the founder's mandate directly: shape the founder-backend machine into a chartered staff of experts that proactively runs AcreOS — resolving, remedying, and learning from conflicts — so a solo founder who spends his days at a cabinetmaker's bench can own a company that matures on its own. Evidence: deep read of `server/services/autopilot/` — `operator.ts`, `decide.ts`, `council.ts`, `senses.ts`, `domainAutonomy.ts`, `hands/` (7 actuators + registry), `packs/` (land), plus the surrounding organs already cataloged in Part 6.*

### C.1 How the machine actually works today (verified, and better than expected)

The loop, as implemented: **honest senses** (each loader degrades to a truthful zero — the brain never acts on data it doesn't have; support backlog, incidents, compliance findings, envelope status, dunning pressure, complaints, churn signals, deal events are in; uptime and others are honestly absent) → **deterministic ranking** (`decide.ts`: *stabilize > serve waiting customers > unblock activation > grow > optimize*, encoded as transparent rules, unit-testable, no model call) → **the Operator** (a bounded Opus-grade pass over the eagle-eye Context Pack that produces a plan and may *author net-new moves* the catalog lacks — but only proposes: it can reorder within the non-mandatory space, can never promote growth above an open incident, every net-new move is marked maximally novel and forced through witnessed-send, and any malformed plan falls back to the pure deterministic floor) → **deliberate/council** for contested calls (a panel of independent voices whose *measured disagreement* is a first-class caution signal, MIN-combined into confidence so a divided council can only tighten escalation, never loosen it) → **the policy-gate stack** (compliance / eval / budget / witnessed) *plus* the per-domain **Trust Ledger** (`domainAutonomy`: five domains — growth, support, deploy, ops, finance — four earned levels *observe → draft → execute_gated → autonomous_gated*; ten clean cycles raises a founder **promotion card** rather than auto-promoting; any anomaly circuit-breaks a demotion instantly; higher autonomy means less escalation, never fewer gates) → **hands** (apply-refund, dunning-action, run-ad-campaign, send-email/letter/push/sms) → **proof receipts → narrate/board report → learning** (`decisionEval`, `shadowRegret`, `experienceLog`, `policyInducer`) — wrapped in hard-stops, panic-stop, immune system, gate-watcher, budget ramps, and guided resume.

Grade: **the safety architecture is genuinely elite — rules propose the floor, models propose above it, gates dispose, the founder disposes above the gates.** The honest gaps between this and "a staff I trust to run it": **(a)** the five domains are *gates*, not colleagues — no mandates, no owned metrics, no reports, no track record you can read as a person's; you meet your staff as policy rows. **(b)** Perception is thin relative to judgment — the machine is more *careful* than *aware* (few senses wired; the honesty rule rightly keeps it from acting blind, which means today it mostly can't act). **(c)** Seven hands cover money-recovery and messaging; whole mandate areas (support resolution, deploy/rollback, ops remediation) have judgment but no actuator. **(d)** One domain pack (`land`) — the scenario doctrine is one domain deep. **(e)** Conflicts resolve by ladder and confidence math, but nothing captures the *founder's reason* when he breaks a tie, so the learning loop starves at exactly the moments that matter most. **(f)** The Operator's `strategyNote` is parked ("fed to Strategy Memory later") — the machine can win cycles but not yet compound a thesis.

### C.2 The shaping program — from gated domains to a chartered staff

**S1 — Charters over gates.** Bind each Trust-Ledger domain to a **charter object**: mandate · metrics owned (with current values) · senses subscribed · hands granted · standing orders · ladder state + streak · budget · escalation rules · report cadence. The charter is the trust-ledger row made *legible and accountable* — the AI equivalent of an employment agreement, and the thing you review quarterly like comp cycles. Roster: the five domains are the departments; the named layer stays sparse and real — **Atlas** (chief of staff: narrates the Letter, curates the queue, referees), **Solene** (build; the `deploy` domain is her runtime twin), **Beatrice** (compliance — the name already lives in the findings system; formalize her as the sixth chartered domain owning provider roles, statute verification, claims lint, dated obligations). Growth, support/customer, finance, ops may be named or not — trust lives in the charter and its receipts; a name is only the handle. Render the staff as people-shaped surfaces in the Controls door: each charter is a card — mandate, this week's numbers, current level, streak, last three receipts, one button: *review charter*.

**S2 — Autonomy follows perception (the promotion prerequisite).** Codify the rule the honesty design already implies: **a domain cannot be promoted past `draft` while its charter's core senses are unwired.** Then build eyes in charter priority order: the Part-5 canaries + SLO feeds (ops), the Part-4 activation/funnel events (growth), support SLA timers (support), unit-economics + envelope detail (finance), obligation countdowns + claim-verification status (Beatrice), deploy/canary health (Solene). Every unwired core sense appears in the Letter as an explicit *blindness line* — "I cannot yet see X" — so the founder always knows what his staff can't know. Trust grows exactly as fast as sight does, and no faster.

**S3 — Hands proportional to mandate.** Each charter names the actuators its mandate implies; each new hand ships with reflex tests, a kill switch, and a ledger entry, and inherits witnessed/net-new discipline: **support** — a grounded-resolution hand (router-bound, refuse-not-fabricate, escalation on low confidence); **Solene/deploy** — deploy + rollback hands gated on canary-green and `codeChangeGate` (self-patch still never merges itself); **ops** — remediation hands (restart/scale/pause-job, county-fabric tiling); **finance** — dunning exists; add invoice-adjustment-*proposal* (artifact-only; money custody untouched); **growth** — ad-campaign + publish exist; add experiment-*proposal* artifacts (pricing remains hard-stopped forever — staff may prepare the memo, never touch the lever); **Beatrice** — filing/renewal *preparation* hands, submission always witnessed.

**S4 — The scenario library as executable doctrine.** Convert "every possible scenario" from prose into a maintained matrix: each row = `{trigger sense, responsible charter, playbook (standing order or runbook ref), autonomy required, founder-touch (none | queue | page), drill cadence}`. Seed rows: sev incident / failed deploy · support surge · deliverability complaint spike · failed-payment wave · churn signal cluster · trial-ending cohort · vendor key lapse (dated obligations) · **legal letter / subpoena** (always page + counsel path; no staff autonomy, ever) · abuse event (Addendum A ladder) · **model-provider outage** — the brain's own AI down, which this architecture uniquely survives because the deterministic floor keeps ranking and the reflexes keep running: drill it and then *say so* on the trust page · data-breach runbook · growth opportunity (Operator net-new → witnessed) · constitution trigger fired (25/50/revenue ladder → founder decision memo) · founder shop-day · founder vacation · panic-stop + guided resume · gate-tamper page. Quarterly game-days (P6 F6) walk rows; `worstDay` simulations *generate* new rows — the library is how the machine's experience outlives any one incident.

**S5 — Conflict → negotiation with a record ("resolve, remedy, learn," closed).** *Resolve:* the safety ladder stays authoritative (an incident always outranks growth — no negotiation there); for genuine cross-charter contention (budget, growth-vs-finance, speed-vs-compliance), the council votes, and when disagreement exceeds threshold the contention goes to the founder queue as **one decision memo carrying both positions** — each charter's recommendation, cost, risk, and a default. *Remedy:* circuit-breaker demotions and `immuneResponse` already act instantly; add the S4 row linkage so every remedy cites its playbook. *Learn:* the founder's one-line **reason** on every memo disposition (Part 6 F2) feeds `policyInducer`; a conflict resolved the same way twice becomes a proposed standing order (a promotion-card sibling: "may I stop asking you this?"); the Operator's `strategyNote` finally lands in a real **Strategy Memory** the Context Pack reads back — company thesis compounding across cycles instead of evaporating each one. Charter amendments are proposed by the staff, granted by the CEO, and receipted.

**S6 — The CEO interface, cabinetmaker edition.** Make the bench a first-class design parameter: **the interrupt contract** — during declared shop hours, only three things may reach the phone: a hard-stop-class ask with a real deadline, a P0 the machine cannot stabilize, and panic-stop. Everything else batches to the **evening queue (target: twenty minutes)** — every item a decision memo with recommendation, default, and *"what happens if you do nothing"*: unanswered items reach their expiry and take the pre-declared safe branch or re-queue; **silent limbo is forbidden by construction.** The Letter moves to Sunday as the board meeting; charter reviews run quarterly as the comp cycle. Shop hours become standing quiet windows the scheduler plans *around* — the machine times its asks for when the CEO exists, and the step-away verdict quietly runs every morning, not just before vacations.

**S7 — The maturation curve (how the asset hardens on its own).** Trust compounds through four ledgers, all already buildable: clean-cycle streaks per charter (the promotions you grant), drill receipts (DR, game-days, vacation and shop-day tests), ratchet coverage (rules becoming code, reported as a KPI), and the decisions-vs-outcomes mirror (`shadowRegret` scoring your overrides as honestly as the machine's calls). Annual rhythm: the depth-audit tradition (this series) + statute/license re-verification + charter reviews. Name the trust milestones so they're celebrated when earned: first domain reaches `autonomous_gated` · first full shop-week untouched · first month the queue averaged under fifteen minutes a day · first quarter the machine's proposals outperform the founder's overrides in shadow regret · first year the annual audit finds no new defect *class*. The end-state sentence, worth building toward literally: **a company whose rules are code, staffed by charters that earn scope through receipts, reporting to a CEO whose job is twenty minutes in the evening, a letter on Sunday, and the judgment calls only a human owner should make.**

### C.3 Exit tests

Charter coverage: all six domains carry charters with live metrics, senses, hands, and a Letter section — and every unwired core sense prints its blindness line. Promotion integrity: no domain above `draft` with unwired core senses (test-pinned); promotion cards arrive with streak evidence. The conflict test: a forced growth-vs-finance contention produces one two-position memo, the founder's reason is captured, and the second identical contention arrives with a standing-order proposal attached. **The Shop-Day Test:** a simulated ten-hour unreachable window against a randomized slate of scenario-library rows — the machine stabilizes and serves within policy, pages only contract-qualifying events, expires unanswered items to their safe branches, and the evening queue reconciles the whole day in under twenty minutes with zero silent limbo. Run it quarterly; publish the streak on the trust page — it is the single most honest proof this platform can offer its owner, and eventually its customers.

---

## §H. Reference body

The six parts follow in full. They are the detail behind every §D item; read the cited section before executing its brief.

**Two more addenda follow the reference body:** §I (Addendum D — Wave L, legal documents & disclosure surface) and §J (Addendum E — Wave R, responsibility hardening). §J R.0 corrects Part 3 §2.4 below; that section carries an inline supersession banner.

═══════════════════════════════════════════════════════════════════════════════
# AcreOS Feature-Depth Audit — Every Module, Every Vertical, to Best-in-Class

*Prepared 2026-08-08 from a full clone of `Thmsnrtn/AcreOS` (HEAD, ~5,860 files). Read-only analysis. This is the **product/feature/UX depth layer** — it deliberately does not repeat `docs/audit-2026-08` (the engineering audit shipped 2026-08-06). That audit's "Ten" (tenant boundary, DNC choke point, Pax guard parity, schema→DDL mirror, etc.) are treated here as **prerequisites** — nothing below should ship ahead of them. This document answers a different question: for each module, vertical, and UI surface, where does it stand today, and what is the concrete path to the most advanced, intuitive version of itself — benchmarked against the best tool in each category.*

*Everything below is designed to be executable inside the standing constraints in `CLAUDE.md` and `shared/governance/constitution.ts`: five customer doors forever, four founder doors, no new AI destinations (Pax stays ambient), no marketplace before ~25 customers / no public API before ~50, no residential-comps data plane before its revenue trigger, be-the-rail-not-the-provider, refuse-not-fabricate everywhere. Where a recommendation approaches a hard-stop, the trigger is named instead of the stop being relitigated.*

---

## 0. How to read this

Each module section follows the same shape:

1. **What exists** — verified against the code, not the docs (files cited).
2. **Honest grade** — where it stands relative to the best tool a customer could compare it to.
3. **The gap** — what separates it from best-in-class, in priority order.
4. **Development path** — phased, with the signature move named first, and revisit triggers where a phase should wait.

Benchmark set used throughout: **Regrid, Land id (MapRight), LandGlide, onX, AcreValue, Prycd, DealMachine, PropStream** (land/mapping/data); **Linear, Attio, Superhuman, Stripe Dashboard, Vercel** (interaction quality bars); **REISift, Launch Control** (investor outreach); **Stessa, DoorLoop, Buildium, RentRedi** (landlord stack); **Paperstac** (notes); **Parcel Fair, Tax Sale Resources** (tax liens); **BuilderTrend, Buildertrend-class draw tracking** (flips/dev).

---

## 1. State of the platform (product lens)

The platform is far more real than its customer count. The five-doors information architecture is genuinely good — it is the same consolidation move Linear made (few doors, deep content) and it is *enforced by ratchet tests*, which almost no company does. The design system (Fraunces/Inter editorial pairing, dual-token `--acr-*` + shadcn HSL architecture, tokenized depth/glass, motion tokens, CI-ratcheted drift) is ahead of most seed-stage SaaS. The honesty system — `UnknownValue` "Not yet pulled · Check now" affordances, boundary-provenance dashing, refuse-not-fabricate lint, de-fabricated workflow templates — is a genuine market differentiator no competitor has: PropStream and DealMachine happily show stale or modeled numbers as fact.

The pattern that defines the current product stage: **the primitives are built; the connective tissue and the depth-per-vertical are what remain.** The same "built but unwired" defect class the engineering audit found in code shows up at the product layer as "built but shallow": 15 verticals all have real surfaces, but most verticals have a *pipeline-tracking* depth where best-in-class tools have a *decision-making* depth. The map renders eleven data layers but cannot answer the first question every land investor asks a map ("who owns *that* parcel?") without the parcel already being in your inventory. The Deals kanban moves cards but doesn't yet coach the deal. Settings has ~15 surfaces but no single mental model.

Ten verticals are `core`, four are `beta` (commercial, developer, mobile_home, agent_investor), one is `roadmap` (short_term_rental). The activation program (founder ruling #11) has been honest — maturity flips only happened when live emitters existed — which means the remaining promotions are well-defined engineering work, not hope. Section 5 gives each vertical its specific promotion path *and* the depth work that makes "core" mean "best-in-class" rather than "honestly functional."

---

## 2. Seven platform-wide moves (each raises every surface at once)

These are ordered by leverage. Every one is door-neutral and constitution-safe.

### 2.1 Adopt the query-key registry and make state feel alive (prereq tie-in)
F-11-1/2/3/4 from the engineering audit are product defects wearing engineering clothes: the primary door goes stale for 2 minutes after the customer's first create. Best-in-class feel (Linear, Superhuman) is *optimistic UI + instant propagation*. Beyond the audit's fix (wire `invalidateRelated`, add `/api/today` to every `RELATED` entry), take it one step further: make **optimistic updates the house pattern** via the existing `lib/optimistic-mutation.ts` for every create/status-change on Leads, Deals, Properties, Tasks, Notes — card appears instantly, reconciles on response, rolls back with a toast on failure. This single move is most of what makes Linear feel "fast" and it is already half-built.

### 2.2 One table/list kit to rule them all
`leads.tsx` (2,507 lines), `properties.tsx` (3,450), `rent-roll.tsx` (1,564), `notes.tsx`, `auction-worksheet.tsx` (1,895) each hand-roll their own table: their own column defs, filters, bulk bar, saved views, pagination, mobile card fallback. `VirtualTable.tsx`, `MobileCardList.tsx`, `saved-views-selector.tsx`, `bulk-action-bar.tsx`, `list-pagination.tsx` all exist as parts — there is no assembled kit. Build **one `EntityTable` composition** (columns config → server-driven sort/filter/cursor pagination → saved views persisted per-user → bulk bar → density toggle → CSV export → mobile card renderer) and migrate the five biggest lists onto it. This is the Attio/Airtable-grade move: every list in the product instantly gains saved views, column choice, and keyboard range-select, and the next vertical's list surface costs a config object instead of 1,500 lines. It also gives the F-10-2 pagination fix a natural home (cursor pagination in the kit, silent 5,000-row caps eliminated by construction).

### 2.3 Finish the error-state constitution (F-14-1) and then go one better
The audit's fix (add `isError` branches to 48 pages + `query-must-handle-error` lint) is table stakes. The best-in-class layer on top: a **stale-while-error** pattern — when a refetch fails but cached data exists, keep rendering the data with a quiet amber "Showing data from 4:12 PM — retry" chip instead of swapping to a full error card. The provider registry already caches (`provider_cache`); the client should mirror that honesty. This is how Linear and Stripe behave on flaky connections, and it matches the platform's provenance language perfectly.

### 2.4 Promote the keyboard layer + command palette to first-class
`command-palette.tsx`, `cmdkVerbs.ts`, `cmdkRecency.ts`, `keyboard-layer.ts`, `keyboard-shortcuts-dialog.tsx` exist. The gap to Linear: (a) palette verbs should cover **creation and mutation** ("Log payment on Note #…", "Move deal to Under Contract", "Start measurement on map"), not just navigation; (b) per-door single-key schemes (in Deals: `1–7` set stage on the selected card; in Inbox: `e` archive, `r` reply — Superhuman grammar); (c) `?` overlay per door showing only that door's keys; (d) palette results should honor `personaVocabulary.ts` so a wholesaler types "blast" and a note investor types "payoff." The recency infra is already there; this is mostly verb registration.

### 2.5 A single provenance + freshness system
The pieces exist — `DataProvenanceChip`, `data-provenance-tag`, `data-confidence-badge`, boundary `approximate` dashing, comp recency opacity — but each surface invented its own. Codify one **provenance grammar**: every externally-sourced number carries {source, as-of, classification: authoritative | modeled | stale}, rendered by one chip component with one tooltip layout, and every modeled number says what it was modeled *from* (the T3/F-22 label-honesty findings are the punch list). Then put a **freshness ledger on the parcel/property detail**: "County GIS pulled 3d ago · FEMA 2024 panel · AVM modeled from USDA + 2 comps." No competitor does this; it converts the honesty stance from a legal posture into a visible product feature.

### 2.6 The Pax-everywhere pattern, formalized
The constitution says Pax stays ambient — correct, and the rail (`pax-copilot-rail.tsx`, `openWithContext`, frozen `pending_actions`, witnessed send) is the right kernel. What's missing is **consistency of invocation**: the map has "Hand to Pax," some detail pages have `pax-context-button`, most surfaces have nothing. Define one rule: *every entity header and every empty state exposes the same Pax affordance with entity context pre-bound*, and every Pax-drafted artifact opens in the same edit-diff view (`pax-edit-diff.tsx`). Then instrument which contexts get used — that's your roadmap for which subagents to deepen. (Prereq: F-08-1 guard parity, or ambient Pax scales fabrication.)

### 2.7 Mobile as a field instrument, not a smaller desktop
Responsive already works; the differentiator for this customer base is **field mode**. Driving-for-dollars (`/drivemode`), courthouse mode (`courthouse-mode.tsx`), field notes, and the map's mobile bottom sheet are the seeds of a genuine "boots on dirt" kit that DealMachine and LandGlide own today. The path: offline tile packs for selected counties (PMTiles makes this nearly free once Phase 2 lands — see §3), background GPS breadcrumbing in DriveMode with one-thumb capture, camera-first parcel capture with auto-APN via point-in-polygon, and offline queue for captures that syncs on reconnect (`offline-indicator.tsx` exists; give it a queue). Capacitor is already configured; the Tauri desktop shell should stay parked (audit F-14-3) — the field is where the mobile investment pays.

---
## 3. The Map — flagship deep dive

*Files read: `client/src/pages/maps.tsx` (1,673), `client/src/components/property-map.tsx` (3,824), `property-map-lazy.tsx`, `lib/map-engine.ts`, `components/maps/*` (PersonaMapStrip, MarketHeatPanel, OverlayLegend, RequestCountyCTA, SampleParcelPreview), `components/parcels/*` (subdivision-tab 46K, parcel-biography, land-snapshot, arv-calculator), `server/services/parcel.ts` (2,035), `statewideParcelEndpoints.ts`, `arcgis-discovery.ts`, `providers/county-gis-provider.ts`, `regrid-provider.ts`.*

### 3.1 What exists (and it's more than most realize)

The layer stack is already unusually deep for a CRM-attached map: FEMA flood (NFHL), zoning/land-use, terrain contours, OSM buildings, USDA cropland + CLU field boundaries, USGS hillshade, hypsometric tint, computed slope gradient, NWI wetlands, SSURGO soils, property heatmap with opacity control — all persisted per-user in `LayerState`. On top of that: distance/area measurement with unit persistence and an **elevation profile rendered along the measured line**, a solar-position engine with time-of-day animation and sky gradient, a compass rose, dashed rendering for approximate boundaries with provenance sourcing (`isAuthoritativeBoundary`), comp pins colored/faded by sale recency, buyer-demand and prediction heatmap toggles, a market-heat panel, deal-status pin coloring resolved from theme CSS vars, a persona strip that re-jobs the door for all nine persona lenses, a mobile bottom-sheet parcel panel (correctly chosen over a 320px rail for the driving use case), and the **inline blind-offer composer** — parcel → UPL-gated recommended offer → witnessed Pax send without leaving the slide-over. That last flow is the platform's signature interaction and nothing in the benchmark set has it.

Engine status: Mapbox GL live; MapLibre migration Phase 1 done (`map-engine.ts` abstraction + style matrix), Phase 2 (renderer swap) pending, with the Stadia-license landmine correctly documented — production open-source path requires self-hosted **Protomaps PMTiles** (already the plan in `open-data-program.md` Phase 4). Both WebGL engines currently ship in one chunk (audit slice 11 secondary finding).

Parcel data plane: county GIS provider at priority 5 (free, tried first), Regrid demoted behind it, ~11 statewide ArcGIS endpoints + an ArcGIS discovery service, per-county coverage rows with a `RequestCountyCTA` when a county isn't covered, nearby-parcel lookup within ~0.25 mi, and `parcelDeltaDetector` watching owner/tax-status changes on tracked parcels.

### 3.2 Honest grade

**A- as an analysis map of parcels you already track. C as a discovery map.** And discovery is the job for the three sourcing verticals (land_flipper, subdivider, agent_investor) whose onboarding literally finishes at `/maps`. The map's canvas queries are `/api/properties` + `/api/deals` — *your* inventory. Click on the map itself and you get measurement, not identification. Regrid/LandGlide/onX all open on the full parcel fabric: tap any parcel anywhere → boundary + owner + acreage instantly. The README names this honestly ("List building / external property database search" not yet done). Everything else below is refinement; this is the gap that changes the product's category.

### 3.3 Development program

**M0 — Engine swap + tiles (the enabler, do first).**
Execute MapLibre Phase 2 exactly as `map-engine.ts` scripts it (maplibre-gl is API-compatible with mapbox-gl v1; the call-site delta is small), with self-hosted Protomaps basemap PMTiles on Fly + R2/Tigris. Then the key unlock: **build county parcel fabrics as vector tiles** (tippecanoe → PMTiles) from the county GIS/statewide sources already integrated, one county at a time, prioritized by where customers actually operate (the coverage table + RequestCountyCTA queue is literally the demand signal). Serve as a `parcels` vector source; render fill+line with zoom-dependent simplification. This converts the parcel plane from per-lookup API calls into a *canvas*, kills the Mapbox marginal cost curve, makes offline tile packs (§2.7) trivial, and drops the double-engine chunk. Licensing discipline: only tile counties whose `county_gis_endpoints` row has cleared redistribution review — the `data-licenses.ts` machinery already models this.

**M1 — Click-to-identify + inspector (the category change).**
Tap any parcel → highlight boundary → the existing slide-over opens in "fabric parcel" mode: APN, owner-of-record, acreage, situs, with provenance chips — all from the tiled attributes, zero fabrication. One button: **"Track this parcel"** → creates a Property (status: prospect) and inherits every existing intelligence affordance (Check now enrichment, AVM, blind offer). Long-press/right-click → radial quick actions: Track, Measure from here, Comps nearby, Skip trace owner, Add to route. This is the LandGlide/Regrid core loop, and AcreOS finishes it with an *offer* — which they cannot.

**M2 — Draw-to-search + filter-on-fabric (Prycd/PropStream territory, land-only so no residential hard-stop issue).**
Polygon/radius/county draw → filter the fabric: acreage range, owner state ≠ property state (absentee), out-of-county owner, ownership length, improvement value = 0 (vacant), road frontage flag, flood %, wetland %, slope bucket (the DEM layers already exist — precompute per-parcel stats during tiling). Results as list + map with the §2.2 table kit; **"Send results to Leads"** bulk action feeds the wedge (lead in → mail out). Saved searches become **watched searches**: `parcelDeltaDetector` already diffs tracked parcels — extend it to diff saved-search result sets so "new absentee 20–40ac parcels in Bastrop" produces a Today parcel-alert card. That is a Prycd-class list-builder living inside the map, and it is the natural revenue trigger for upgrading county coverage.

**M3 — Analysis depth (make the A- an A+).**
(a) *Comps on canvas*: when a parcel is selected, render its comp set as boundary overlays with $/ac labels and recency fade (pins exist; boundaries + labels don't), plus a comp-set drawer sharing one component with `comps-analysis.tsx`. (b) *Terrain suite consolidation*: slope/aspect/solar/elevation are separate toggles; add a "Buildability read" summary chip on the parcel panel (dominant slope class, aspect, flood/wetland intersection %) — computed, labeled modeled, honest. (c) *Measurement upgrade*: snap-to-parcel-vertex, saved measurements per property, and area presets ("split into N equal lots" preview handing off to the Subdivision tab's real editor). (d) *Printable/sharable map report*: `buildStaticMapUrl` + `publicParcelReport.ts` already exist — compose them into a branded one-page parcel PDF (map, layers chosen, measurements, provenance footer). Land id charges $45/mo largely for this artifact. (e) *3D terrain toggle* (`mapbox-dem` source already added for the profile): free drama for hill-country parcels, one control.

**M4 — The vertical map matrix (one map, per-vertical jobs).**
PersonaMapStrip already re-headlines the door; extend the same registry pattern to **default layers + pin semantics + primary map action** per vertical:

| Vertical | Default layers | Pins mean | Primary map action |
|---|---|---|---|
| land_flipper / agent_investor | parcels fabric, flood | pipeline status | Identify → Track → Offer |
| subdivider / developer | parcels, zoning, contours, slope | parent parcels + lot phases | Split preview → Subdivision tab |
| residential_wholesaler | fabric + route trace | D4D captures, buyer clusters | DriveMode capture / route replay |
| tax_lien_deed | fabric + county boundary | certificates colored by redemption window | Auction-day mode (below) |
| buy_and_hold / multifamily / mobile_home | streets | doors: occupied/vacant/late; parks show pad occupancy | Open unit / dispatch maintenance |
| fix_and_flip | streets | projects by milestone | Open rehab board |
| note_investor / servicer | streets, flood | collateral by delinquency | Open note (collateral risk read: flood chip on collateral is a real underwriting feature) |
| commercial | streets, zoning | leases by expiration horizon | Open lease |
| creative_finance | fabric | deals by carry status | Dodd-Frank check → Close & Carry |

Two of these are signature-grade and cheap: **Auction-day mode** for tax_lien_deed (load the auction worksheet list onto the map, walk the list geographically, strike/bid from the bottom sheet — Parcel Fair's whole pitch, done better because the worksheet math is already built) and **route replay** for wholesalers (DriveMode breadcrumbs rendered as a trace with capture pins — DealMachine's stickiest feature).

**M5 — Ambient intelligence on the canvas.**
Pax gets map tools (`atlasToolRegistry` pattern): `identify_parcel(lat,lng)`, `run_saved_search(id)`, `summarize_viewport()` — so "any new absentee parcels near my Deming section this week?" is answerable in the rail with the map responding (fly-to, highlight). Delta events render as small pulse badges on affected parcels. Keep every heatmap labeled modeled; the prediction layer should carry the §2.5 chip or stay off by default.

*Revisit triggers:* M2 watched-searches cost scales with counties tiled — gate fabric expansion on the RequestCountyCTA queue + first paying land customer's counties. The residential fabric stays out entirely until the residential-comps revenue trigger fires (constitution).

---

## 4. Door by door

### 4.1 Today (`today.tsx`, 858 lines; `routes-today.ts`)

**Exists:** consolidated one-round-trip `/api/today` (queue, brief, progress, receipts, cash strip, activity, meta), inline queue resolution, morning brief as collapsed preamble, receipts strip ("what happened since you left," traceable to real rows), persona lede + the per-vertical "Your surfaces" cluster (`today-vertical-surfaces.ts`, 9 clusters), parcel alerts, cash strip, getting-started checklist, welcome-back state machine, pull-to-refresh, the "Heading out?" DriveMode affordance (time+behavior triggered — genuinely clever), referral nudge, and Pax autonomy threshold read-through for "Pax would handle this" treatment.

**Grade: B+.** The *shape* is right — it's a decision surface, not a dashboard — and the receipts/finishability loop is ahead of the market. Held back by the staleness defect (F-11-1) and by the queue being a flat list.

**Path:** (1) *Make the queue triage-grade*: group by kind (replies / payments / approvals / alerts), rank by $ and SLA, and give it Superhuman keys — `e` done, `s` snooze-to-tomorrow (snooze exists server-side via `today_queue_state`; expose it), `enter` open, `p` hand to Pax. (2) *Cash strip → sparkline strip*: each figure gets a 30-day micro-trend and taps through to the exact Finance tab; late count taps to dunning. (3) *"Pax would handle" → one-tap batch*: the threshold treatment currently only styles items — add "Approve all N above threshold" invoking the same witnessed-action kernel, which is the first real autonomy dividend a customer feels. (4) *Plan-my-day for field verticals*: when ≥3 queue items carry coordinates, offer "Route these" → map with ordered stops (wholesaler/tax-lien daily loop). (5) Fix invalidation + trim the 4-full-table load (F-10-1) so the door is instant.

### 4.2 Deals (`deals.tsx` 1,587; `deal-detail*`, `pipeline.tsx`, offers, blind-offer wizard, negotiation components)

**Exists:** kanban + list with mobile kanban mode, drag between stages via shared `pipeline-status.ts` state machine, 5-tab detail, AI coaching panel, bulk select, deal form, offers + offer batches, blind-offer wizard with UPL gating, contract assignments (the wholesaler mechanic) with doc autofill, single-track view (`/api/deals/:id/track`), earnest money, double close, closing costs.

**Grade: B.** Solid pipeline tracker; not yet a deal *advisor*. Attio/Pipedrive-class polish gaps plus land-specific depth gaps.

**Path:** (1) *Column intelligence*: per-stage aggregate header (count, $, median days-in-stage) and a stale badge on cards exceeding stage-median × 2 — `pipeline-velocity.tsx` already computes the inputs. (2) *Next-action contract*: a deal without a scheduled next step gets a visible "no next step" state and a one-tap "Ask Pax to propose" — the single best predictor of pipeline hygiene, and it feeds the Decision Queue instead of a new surface. (3) *Stage-change side effects made visible*: moving to Under Contract should offer (not force) the checklist: earnest money entry, contingency dates, doc generation — currently the operator must remember four separate pages exist. (4) *Kanban feel*: optimistic drag (2.1), multi-drag, `[`/`]` keyboard stage moves, column WIP hints. (5) *Deal economics header*: every detail opens with the money math (basis → expected exit → margin, integer-cents rails already exist) and its provenance chips. (6) Merge `/pipeline` and `/deals` mental models — two overlapping hubs behind one door reads as drift; pick Deals as canonical, make Pipeline a saved view of it via the §2.2 kit.

### 4.3 Finance (`money.tsx` tab shell → notes / portfolio / optimizer / forecast; `finance.tsx` note register; note-detail 1,085; borrower portal; dunning; notes-tax-readiness; commissions for agent_investor; bookkeeping, cash-flow, P&L, 1099s)

**Exists:** the deepest door in the product. Note register with amortization, payoff calculator, yield panel, basis schedule, splits/assignments, TIN handling, dunning ladder (now revived), borrower portal with HMAC access + Stripe-Connect-only money movement (be-the-rail enforced by `moneyCustodyHardStop`), Close & Carry bridge from deals, Dodd-Frank checker, tax readiness, P&L/cash-flow/bookkeeping, forecasting wired to real tier-mix, commissions (agent_investor).

**Grade: A- for notes (near Paperstac-servicing depth already), B- for the aggregate "money picture."** The tabs are four separate reports; best-in-class (Stessa's dashboard, a good family-office view) opens with one truth.

**Path:** (1) *One Money header above the tabs*: cash position, expected-in 30/60/90 (notes + rent + assignments per vertical), late $, next obligations — every figure provenance-chipped and tab-linked. This is the door's missing thesis. (2) *Notes*: delinquency aging bucket view (30/60/90+ columns like a servicer's book), one-click payoff-quote PDF (packet generator exists for redemptions — reuse the pattern), borrower-portal payment receipts into receipts strip. (3) *Optimizer/Forecast honesty pass*: both carry modeled numbers; apply §2.5 labels and show the driver deltas ("forecast moved because 2 notes went 60+"). (4) *Bookkeeping*: bank-feed reconciliation is the Stessa gap — but it's also a data-plane spend; park behind a revisit trigger (first customer asking, or ≥10 paying) and in the meantime ship rule-based categorization on the existing ledger. (5) Commissions: promote from agent_investor-only page to a Finance tab pattern consistent with the others.

### 4.4 Inbox (`inbox.tsx`, 1,509; unified `/api/inbox/unified`; sms-conversation, email compose sheet, team-inbox)

**Exists:** unified email+SMS threads, server-side channel filter, compose, TCPA-gated SMS send path (post-audit it must route via `sendOrgSMS` — prerequisite #2), unattached-reply queue with attach/create (the W1 fix), hot-lead flip on matched inbound.

**Grade: B-.** Functional unified inbox; the Superhuman-shaped opportunity is untouched, and for this customer the inbox *is* the deal — a seller reply is the wedge's payoff moment.

**Path:** (1) *Triage grammar*: split view (list + reading pane on desktop), `j/k/e/r/s` keys, snooze, and a **Needs-reply** default filter (inbound, unanswered, newest-oldest) — the whole door's job in one view. (2) *Context rail*: selected thread shows the lead/parcel card inline (status, last offer, county) with quick actions — no tab-switch to remember who this is. (3) *Pax reply drafting in-thread*: "Draft reply" → rail opens with thread context → witnessed send. The kernel exists; the entry point doesn't. (4) *SLA surfacing*: response-time chip per thread ("seller replied 3h ago") feeding the Today queue — speed-to-lead is the #1 conversion variable in this niche and nothing currently measures it for the operator. (5) Thread merge/split for the spouse's-phone case beyond attach (real land-seller behavior).

### 4.5 Pax (rail + `/pax` page + `/ai` hub; pax-* component family; server `ai/executive.ts`, tools, memory, knowledge, scheduler)

**Exists:** the richest AI surface I've seen at this stage — rail with context binding, artifacts, edit-diffs, thinking blocks, why-explainer, memory + knowledge + project panels, connectors, scheduling, entity picker, relationship indicator, command palette integration, witnessed-send frozen actions, autonomy thresholds per action, hallucination guard + live eval (streaming path), SCP persona versioning.

**Grade: A- architecture, B- discoverability/consistency.** Customers will meet Pax unevenly (§2.6). Prerequisites: guard parity (F-08-1), tool org-scoping (F-23-3), router coverage (F-16-1).

**Path:** (1) Uniform invocation + context chips (§2.6). (2) *Show the autonomy ledger*: a customer-visible "What Pax did" view = receipts strip filtered to Pax actions with the why-explainer attached — trust is the product here; make it inspectable. (3) *Proactive noticing, rate-limited*: "Pax noticed" cards already exist on Today; give them a per-day budget and a feedback affordance (thumbs → calibration store, which exists founder-side at `pax-calibration`). (4) *Skills per vertical*: the vertical registry should declare 2–3 named Pax jobs each ("Draft balloon-approaching letter," "Prep auction worksheet from this county's list") surfaced as suggestion chips in-context — this is where verticals-as-core becomes tangible daily value. (5) Voice capture in DriveMode (Mic exists in rail imports) — hands-free lead notes is a field differentiator.

### 4.6 Settings (`settings.tsx` 1,843 + 12 sub-pages + 15 setting components; SettingsQuickFind)

**Exists:** 7 tabs (Account, Security, Organization, Billing, Tax & Compliance, Notifications, Integrations) + satellite pages (BYOK, API keys, Pax controls, underwriting, integrations detail, accessibility, lead assignment, tax identity), quick-find, roles incl. VA scoping, quiet hours, provider cards, autonomy panel, persona panel, appearance/theming.

**Grade: B- IA, B+ content.** Everything is *somewhere*; two problems: the monolith page has already produced duplicate-TabsContent bugs twice (comments at 1237/1624 admit it), and the tab model + satellite pages have no single mental model — Pax controls, autonomy, personas, and AI integrations are four places that are one topic in the customer's head.

**Path:** (1) *Adopt the Vercel/Stripe model*: left-rail settings nav with routed sections (`/settings/<section>`), monolith decomposed into the section files that already exist under `pages/settings/` — this is the same decomposition the founder dashboard already went through; do it before the third duplicate-tab bug. Proposed groups: **You** (profile, security, accessibility, appearance) · **Workspace** (organization, team & roles, personas/vertical, vocabulary) · **Pax & Automation** (autonomy, Pax controls, workflows, quiet hours) · **Data & Integrations** (providers, BYOK, mailbox/phone, API keys, data network) · **Money & Compliance** (billing, tax identity, underwriting, compliance) — five groups, ~22 sections, every current surface keeps a home and QuickFind maps old paths. (2) *Every send-adjacent setting shows its live state*: mailbox connected? DNC vendor set? 10DLC status? — the provider-readiness banner pattern, promoted into settings rows with fix-CTAs. (3) *Plain-language risk copy* on autonomy + compliance controls (the voice doc's register), with "what Pax can do at this level" examples inline. (4) Danger zone consolidation (export, erasure, org deletion) in one clearly-marked section — pieces exist (`download-data-section`, right-to-erasure) but are scattered.

### 4.7 Outreach (behind doors: campaigns shell 113 → content components; sequences, templates, buyer blasts, direct mail via Lob, neighbor outreach, my-letter)

**Exists:** campaigns (email/SMS/mail), sequence builder, template editor, A/B variants panel, campaign analytics + attribution, Lob mail with interlock, free-tier 5-piece lifetime first send (wedge opener), buyer blasts, neighbor outreach, tax-delinquent importer feeding lists.

**Grade: B.** The rails and compliance posture beat Launch Control (which pushes gray-area SMS volume); the *craft* layer is behind: list building is thin until Map M2, and creative feedback loops are minimal.

**Path:** (1) *Audience = saved search or list, everywhere* — one audience picker shared by mail/SMS/email/blasts, fed by Map M2 + REISift-style list stacking (a lead in N lists gets a stack score; the data model can carry this as tags + a computed field). (2) *Mail craft*: letter preview with real Lob proof render, merge-var lint (refuse-not-fabricate applied to mail merge — unknown var blocks send with a fix list), and per-template response attribution surfaced next to the template (attribution analytics exists; put it at the point of choice). (3) *Sequence builder → journey view*: show branch outcomes with real counts on each edge (sent/delivered/replied), collapsing the analytics round-trip. (4) *Deliverability cockpit*: domain health (SPF/DKIM/DMARC status from the watchdogs), warm-up pacing, and bounce/complaint trends per identity — BYO-identity is the rule; make its health visible to the customer, not just the founder. (5) Compliance pre-flight on every audience: DNC scrub coverage %, quiet-hours windows by lead timezone, litigator hits — as a *gate with receipts*, turning the legal posture into a visible feature.

---

## 5. The fifteen verticals — from "honestly activated" to "the tool people switch for"

*Current registry truth (`shared/business-types.ts`): 10 core, 4 beta, 1 roadmap. The activation program's honesty bar means "core" = live workflow emitters + real surfaces + no fabricated template variables. This section defines the next bar: **depth** — for each vertical, the signature surface a specialist competitor is judged on, and what closes it. Ordered: core verticals (deepen), then beta (promote + deepen), then roadmap.*

### Core — deepen

**land_flipper (+ hybrid land side)** — *Signature: map-to-offer loop.* Already the strongest story. Closers: Map M1/M2 (identify + list build) is 80% of the remaining gap to Prycd+DealMachine; add offer-batch performance readback (response rate per county/price tier feeding the blind-offer engine's tier suggestion — the data rows exist across offer_batches + inbox) and county intelligence cards inline at offer time. Benchmark: Prycd (pricing), DealMachine (field), neither closes with a witnessed send.

**note_investor** — *Signature: the servicing book.* Depth path: delinquency aging board (4.3), payoff-quote PDF, escrow line honesty (servicer role), lender-facing statements from `note-basis-schedule`, and the acquisition side of Linnea's Day-One path — the CSV import extension + `/notes/:id` acquisition detail already selected as the first expansion is exactly right; add a bid-tape worksheet (yield at price sliders using the existing amortization engine) so acquiring paper is as first-class as servicing it. Benchmark: Paperstac (acquisition UX), plus every spreadsheet servicer this replaces.

**residential_wholesaler** — *Signature: disposition speed.* Buyer blasts + analytics + assignments exist; closers: buyer-list intelligence (match-rate + open/claim analytics per buyer, feeding the AI matcher visibly), a deal-room share page polish pass (`deal-room-share.tsx` — make it the branded artifact buyers judge you by), DriveMode route replay (Map M4), and state-rules surfacing at contract time (page exists; wire it into the stage-change checklist, 4.2). Benchmark: InvestorLift's disposition analytics — beatable because their CRM side is weak.

**fix_and_flip** — *Signature: the rehab board.* Board + milestones + contractors + 70%-rule exist; closers: draw/budget-vs-actual tracking per milestone with photo evidence (mobile camera path exists), punch-list mobile mode, contractor 1099 flow already built — connect it so a paid draw offers the 1099 record. Comps remain BYO-ATTOM by design (hard-stop honored); label accordingly. Benchmark: a light BuilderTrend — you win on the acquisition+finance sides they don't have.

**buy_and_hold / multifamily / mobile_home-family core pieces** — *Signature: the rent roll.* The stack (rent-roll 1,564 lines, units, leases, tenants, maintenance, late-fee statute enforcement, renewal countdowns) is genuinely strong. Closers: renewal pipeline view (90-day horizon kanban), delinquency ladder parity with notes dunning (same ladder component, landlord vocabulary), owner-statement PDF per entity per month (entity-portfolio-view exists — add the artifact), tenant-payment rail status made visible (Stripe Connect BYO — show connection health at the point of charge). Benchmark: Stessa/DoorLoop on reporting; you already beat them on honesty and on the investor-side integration.

**creative_finance** — *Signature: Close & Carry.* The deal→note bridge with balloon lane live is the moat move. Closers: a carry-structure composer (wrap/sub-to/lease-option term sheets from templates with Dodd-Frank checker inline rather than a separate page), and a "paper book" view stitching originated notes to their source deals with margin-over-underlying displayed. Benchmark: none — this is open field; the composer makes it visibly so.

**subdivider** — *Signature: the split.* Subdivision tab (46K) + plan editor + permits/timelines/lot-pricing/CCR templates + live plat/milestone/recorded emitters — already the deepest niche build in the product. Closers: Map M3 split-preview → plan editor handoff, phase P&L per plan (basis recovered exists on the strip — expand to per-phase waterfall), and a county-timeline benchmark read ("median plat approval in this county: 94 days" from `county-timelines` data once ≥N samples; refuse below N). Benchmark: nothing integrated exists — LandDevPro-style spreadsheets are the competition.

**tax_lien_deed** — *Signature: auction day.* Worksheet (1,895 lines) + redemption clock + state rules + quiet title + payoff packet + live cert emitters. Closers: Auction-day map mode (M4), post-auction bulk result entry (won/lost/price in one grid), redemption-clock notification honesty per state (statute-register claim-truth work from F-15-2 lands here), and quiet-title milestone tracking with attorney-handoff artifacts (UPL-safe framing already in the gating system). Benchmark: Parcel Fair (pre-auction data), Tax Sale Resources — neither owns post-auction operations; this build already does.

**agent_investor** *(beta, promote-path is thin by design)* — land surface is deliberately the full land_investor surface; the commission wedge exists behind Finance. To core: commission → closing linkage (auto-record on deal close both directions), a simple pipeline-source split (client vs own-book tag on deals with a Finance rollup), and broker-compliant disclosure snippets in outreach templates for licensee states (the UPL/state-rules registry covers this). That's the honest bar; the depth bar is just the land bar.

### Beta — promote, then deepen

**commercial** — Scoped honestly to base-rent term-lease ops; CAM/NNN excluded. *To core:* the current scope can hold core if labeled — but the better move is a minimal CAM step: annual reconciliation worksheet (inputs: expenses by category, pro-rata shares from lease rows; output: true-up charges as ledger lines) without percentage rent or escalations. That single worksheet converts "honest subset" into "usable for small NNN retail," which is most small commercial operators. *Depth:* lease-abstract fields (options, escalation dates as reminders even if uncalculated), expiration-horizon map pins (M4). Benchmark: nothing at this price point — Buildium's commercial is an afterthought.

**developer** — Now correctly reframed as the entitlement workspace (persona collapses to subdivider). *To core:* it should ride subdivider's core status once the framing copy ships everywhere (landing, onboarding, sidebar labels — grep for the removed "new construction" clause residue), plus one developer-only addition: a simple pro-forma per project (land basis + entitlement costs + lot revenue schedule from lot-pricing) since developers are judged on the pro-forma. *Depth:* county-timeline benchmarks (shared with subdivider).

**mobile_home** — Pad inventory closed (three real write paths). *To core:* park-level rollup surface (pads occupied/offline, lot-rent collected vs billed, park maintenance queue) — the data is all present in rental_units + ledger; it's one dashboard section behind the rent-roll, park-vocabulary via personaVocabulary. Plus lot-lease template pack (park rules/CCR-style attachments reuse ccr-templates machinery). *Depth:* pad-map view (M4) — parks think spatially.

**short_term_rental (roadmap — keep it there, but shrink the honest gap)** — The stated blockers (channel sync, nightly pricing, turnovers) are real and expensive. The lawful middle: (a) *iCal ingestion* (Airbnb/VRBO export URLs) → bookings render on a calendar + block maintenance conflicts — no partner API, no pricing claims; (b) turnover checklist auto-created per checkout from the iCal feed, dispatched via existing maintenance rails; (c) revenue entered or CSV-imported, never scraped. That's an honest beta ("we mirror your calendar; we don't manage channels") that serves the mid-term-rental operators already inside buy_and_hold. Full channel management stays behind a revenue trigger (e.g., ≥5 paying operators requesting it) — it's a support-heavy integration business.

### The vertical *system* itself
Three registry upgrades make every promotion cheaper: (1) extend `business-types.ts` meta with `mapProfile` (M4 matrix) and `paxSkills` (4.5) so vertical behavior is declared in one place like onboarding copy already is; (2) a **vertical health founder panel** deriving, per vertical: orgs, activation %, live-trigger fire counts, template completion — the promotion evidence, generated instead of hand-audited each wave; (3) beta badging consistency sweep — beta verticals promise "Beta badges throughout"; verify the badge actually renders on every businessTypeOnly surface (spot-checks found the gate, not always the badge).

---

## 6. Cross-cutting UI systems

**Design language application.** The token system, editorial type pairing, and depth/translucency scales are codified and ratcheted (`docs/design/design-language.md`, Wave R "Bold Tahoe"); the codebase shows the reskin applied door-by-door (annotations in maps.tsx, money.tsx confirm it). The remaining work is *evenness*: long-tail pages (tools, learn, help, several founder panels) predate the reskin. Cheapest path: extend the existing design-token drift ratchet with a per-route "reskin sign-off" checklist reusing the 2026-04 surface inventory (`docs/refinement/surface-inventory.md`) — it's already ordered by traffic; resume the walk with the nine-lens sign-off format that's proven to work.

**Forms.** No shared form grammar yet: some surfaces use dialogs, some sheets, some inline. Standardize: create = sheet from the right (keeps context), edit-in-place for single fields, destructive = confirm-dialog with typed-name only above a damage threshold (safe-bulk-delete exists — make it the only bulk-delete path). Zod schemas already exist server-side; generate client validation from them so error copy is written once.

**Empty states.** `EmptyState` with purposeful CTAs is used in 105 pages — good. Upgrade the top-10 traffic surfaces to *demonstrative* empty states: one-tap "Load sample" (the machinery exists via onboarding sample data) + a 20-second looping product clip. Empty states are the demo for a solo-founder product with no sales team.

**Onboarding.** onboarding-v2 with per-vertical copy/finish paths is strong; the F-24 findings (seeded-lead overstatement, primary persona routed to a key-dependent door) are the fix list. Add: a *re-runnable* "set up X" mini-wizard per vertical surface (the wizard prefill machinery supports re-runs already) so a customer who picked land can adopt notes later without support.

**Navigation.** Five doors are locked and correct. Two refinements inside the law: door-level badge counts (Inbox unread, Today queue size) on desktop sidebar + mobile bottom nav; and Cmd-K "doors first" ordering with persona vocabulary (2.4).

**Accessibility.** Port jsx-a11y to flat config (F-14-2) and add the two-per-door manual pass: full keyboard walk + screen-reader labels on the five doors' primary flows. The existing `accessibility-panel.tsx` (user-facing) is ahead of market — advertise it.

**Founder surface.** Out of scope for customer polish, but one product note: the four-doors discipline (Letter/Decisions/Controls/Story + admin namespace) is the right end-state; the ~40 legacy `/founder/*` panels still routed should keep collapsing per the ratchet. The one founder feature this audit adds: the vertical-health panel (§5) — it directly powers the activation program you're running.

---

## 7. Sequencing — one program, five phases

*Rule inherited from the roadmap: revenue/legal correctness beats polish; Wave N+1 waits on Wave N's P1s. Phases below assume audit-2026-08's Ten land first (they're ~1–2 weeks and mostly small).*

**Phase A — Feel (1–2 weeks).** 2.1 invalidation+optimistic, 2.3 error/stale-while-error on the five doors, Today queue keys + snooze, Deals optimistic drag, Inbox needs-reply view + keys. *Exit test:* create-lead → visible on Today instantly; kill the network → every door degrades honestly.

**Phase B — Table kit + Settings IA (2–3 weeks).** Build `EntityTable`, migrate Leads/Properties/Notes/Rent-roll/Auction-worksheet; decompose settings.tsx into the routed left-rail model. *Exit test:* saved views work on all five lists; no `TabsContent` duplication class remains; QuickFind maps every legacy settings path.*

**Phase C — Map M0+M1 (2–4 weeks, the category move).** MapLibre Phase 2 + Protomaps basemap; first 3–5 county parcel fabrics tiled (pick from customer counties + CTA queue); click-to-identify + Track-this-parcel. *Exit test:* tap an untracked Bastrop parcel → owner/APN/acres in <1s offline of any paid API → tracked → blind offer flows unchanged.*

**Phase D — Depth-per-vertical wave (3–5 weeks, parallelizable as agent waves).** Per §5: aging boards (notes+rent), auction-day mode, route replay, CAM worksheet, park rollup, pro-forma, Close & Carry composer, renewal pipeline. Each is a bounded brief with existing rails; run them wave-style with the completeness-audit discipline CLAUDE.md mandates. Beta→core flips ride this phase's honest completions.

**Phase E — Map M2 + Outreach craft (ongoing).** Draw-to-search + watched searches feeding audiences; deliverability cockpit; template attribution at point-of-choice. Gate fabric expansion county-by-county on demand signal.

**Standing revisit triggers (do-not-build-until):** residential fabric/comps → constitution's revenue trigger · bank feeds → first customer ask or 10 paying · STR channel APIs → 5 paying STR requests · marketplace/API → 25/50 ladder · desktop Tauri → any customer on desktop-only workflow.

---

## 8. The three moves that matter most

If everything above collapsed to three bets: **(1) Map M1/M2** — it converts AcreOS from "CRM with a great map of your stuff" into the discovery tool the core verticals shop for, on data rails you already own; **(2) the state-freshness pair (2.1+2.3)** — nothing else determines whether the product *feels* alive in a demo; **(3) depth-per-vertical Phase D** — it's what makes "15 verticals, 10 core" a claim a specialist can't laugh at, and every item rides rails that already passed the honesty bar.

*Handoff note: each §3–§5 item is written to be lifted directly into a Solene/Claude Code wave brief — context, files, exit test. The wave-discipline rules in CLAUDE.md (verify against code, hunt built-but-unwired, independent completeness audit) apply to all of it.*

═══════════════════════════════════════════════════════════════════════════════
# AcreOS Depth Audit — Part 2: The Operating-System Layer

*Companion to `acreos-depth-audit.md` (Part 1). Same method, same constraints honored. This part goes deep on the subsystems that make AcreOS an operating system rather than a toolbox: Settings, team collaboration, the inbox family, the deal/inventory engine, the acquisition machine, negotiation, Pax (assessed as an AI system, not a feature), the connector/MCP fabric, and — the through-line — the agency layer that lets the platform genuinely act on the customer's behalf. New code read for this part: `server/ai/*` (executive.ts 2,464 · tools.ts 2,826 · untrustedEnvelope, validators, paxModelTier, paxPromptVersions, dataGroundingEvalCases), `server/services/connectors/{registry,executor}.ts`, `server/mcp-server.ts`, the memory constellation (agentKnowledgeGraph, agentMemoryConsolidation, cognitiveMemoryV13, institutionalMemory, temporalKnowledgeDecayV11, paxMemoryTriggers), team-chat components, negotiation stack, autonomy-panel, and the inbox's existing AI paths.*

---

## 1. Settings — from "everything is somewhere" to "you already know where"

### 1.1 The full inventory (what's actually packed in)

Seven tabs on the 1,843-line monolith (Account, Security, Organization, Billing, Tax & Compliance, Notifications, Integrations) — plus twelve satellite pages (`byok`, `api-keys`, `pax-controls`, `underwriting`, `integrations`, `accessibility`, `lead-assignment`, `tax-identity`, `privacy-settings`, `account-security`, `data-export`, `data-import`) — plus fifteen embedded setting components (autonomy matrix, autopilot setup, persona panel, appearance, quiet hours, mailbox connect, email domains, phone numbers, provider cards, data-network, BYOK, API keys, list-views, contribution report, download-data) — plus settings-shaped content living elsewhere (workflows tab, Pax tasks tab, dashboard settings, compliance settings, theme settings, notification preferences). Conservatively **~45 distinct setting surfaces across ~20 files**, reachable through at least four different navigation patterns. The monolith has already produced the duplicate-`TabsContent` bug class twice (self-documented at lines 1237 and 1624). QuickFind exists and is the one thing holding the current IA together.

### 1.2 The design thesis

Overwhelm doesn't come from the number of settings — Stripe has thousands — it comes from **absent structure, invisible state, and settings that shouldn't be settings.** Three principles drive everything below:

1. **Settings are statements of current state first, controls second.** Every row leads with what's true right now ("Mailbox: connected as tj@… · sending healthy") and offers the change affordance second. A settings page you can *read* is not overwhelming; a wall of inputs is.
2. **Progressive disclosure by consequence.** The 80% path shows ~5 decisions per section; everything consequential-but-rare lives one disclosure deeper, and everything dangerous lives in one clearly-fenced place. The autonomy panel already does this perfectly (4-step scale → expand for per-action overrides) — make that the house pattern.
3. **The best setting is one you never visit.** Anything configurable at the moment of use should be *set* at the moment of use (send-time quiet-hours prompt, first-campaign identity setup, per-list view options) and merely *reviewable* in Settings. Settings becomes the ledger of choices, not the place choices are forced.

### 1.3 The target IA — five groups, left rail, routed

Adopt the Stripe/Vercel model: persistent left rail at `/settings/<section>`, monolith decomposed into the section files that already exist under `pages/settings/`. Five groups, ~22 sections, every current surface mapped (nothing orphaned; QuickFind + `route-redirects.ts` preserve every legacy path and `?tab=` deep link — several onboarding finish paths point at `?tab=tax-compliance`, so redirects are load-bearing):

| Group | Sections | Absorbs (current homes) |
|---|---|---|
| **You** | Profile · Security & sessions · Appearance · Accessibility · Notifications & quiet hours | Account tab, account-security, theme/appearance panels, accessibility panel+page, notification prefs + quiet hours |
| **Workspace** | Organization · Team & roles · Vertical & vocabulary · Views & defaults | Organization tab, invites/roles (incl. VA scoping, lead-assignment), persona panel + persona switcher home, list-views panel, dashboard settings |
| **Pax & Automation** | Autonomy · Pax memory & knowledge · Scheduled tasks · Workflows | pax-controls, autonomy panel, autopilot setup, pax-tasks tab, workflows settings tab (Pax rail's panels stay in the rail; this is the *policy* home) |
| **Data & Integrations** | Connectors · Data providers & credits · BYOK (AI keys) · Mailbox, domains & phone numbers · Import / Export · API & MCP access | integrations tab, connector panel's settings twin, provider cards + data-network, byok, mailbox-connect + email-domains + phone-numbers, data-import/export, api-keys + mcp key |
| **Money & Compliance** | Billing & plan · Tax identity & 1099s · Underwriting defaults · Compliance (TCPA/DNC/UPL/FCRA) · Privacy & data rights | Billing tab, tax-identity + tax-compliance tab, underwriting, compliance-settings, privacy-settings + download-data + erasure |

Group order mirrors frequency (You/Workspace daily-ish → Money rarely). Mobile: the rail collapses to the existing Select — unchanged pattern, new taxonomy.

### 1.4 Section-level patterns (what makes it feel easy)

**Status-row grammar.** Every integration-ish section is a stack of status rows: *icon · name · state sentence · one action*. State sentences are honest and specific ("DNC scrub: **no vendor selected** — SMS sends will refuse", "10DLC: pending carrier review, ~3 days"). The provider-readiness banner logic already computes most of these; relocate it from banner-at-point-of-failure to *also* row-at-place-of-repair.

**Readiness header per group.** Each group opens with a 1-line readiness read ("Data & Integrations: 6 connected · 2 need attention") so scanning replaces reading. This is the founder Letter pattern, miniaturized for customers.

**Plain-language + consequence copy** (per `docs/voice.md` register): every consequential toggle states what changes in the product, not what the flag does — the autonomy levels' copy ("Drafts replies, offers, mailers. You review each.") is the exemplar; apply it to compliance and sending controls, with a one-line "what could go wrong" on the risky ones.

**One danger fence.** Export, erasure, org deletion, key revocation → a single `Privacy & data rights`/danger section with typed-confirmation, never scattered.

**Search-first.** QuickFind gets promoted into the global palette: typing "quiet" anywhere in the app offers *Settings → Notifications → Quiet hours* with the section deep-link — settings findable without knowing the taxonomy at all. Add setting-level anchors (`/settings/notifications#quiet-hours`) so Pax and docs can link to exact rows.

**Just-in-time capture.** The first send with no identity, first SMS with no consent posture, first tax season with no TIN — each already has a gate; upgrade each gate to *complete the setting inline* (mini-sheet with only the required fields) and write it home. Settings then trends toward "review," which is the non-overwhelming end-state.

### 1.5 Migration plan (safe, one wave)

(1) Extract each `TabsContent` body into its section file (most already exist as components — this is largely moves, not rewrites); (2) build the `/settings/:section` shell + rail + redirects map; (3) delete the monolith's duplicate-tab class by construction (one file per section = the bug can't recur); (4) status-row conversion for Data & Integrations + Compliance; (5) ratchet: `settingsRoutes.test.ts` pinning every legacy path/`?tab=` → new route, and a lint forbidding new `TabsContent` in any settings file. Exit test: QuickFind resolves 100% of the 45-surface inventory; a new customer completes mailbox + DNC + tax identity purely via just-in-time prompts without ever opening Settings.

---
## 2. Team chat & internal collaboration

*Read: `team-chat-dock.tsx` (136), `team-chat-panel.tsx` (557 — channels + DMs with lock/private state), `team-general-channel.tsx`, `team-inbox.tsx` (24-line wrapper), `comment-thread.tsx`, `team-offer-approvals.tsx`, `team-manager-dashboard.tsx`.*

**Exists:** a Slack-lite — channel list + DMs in a dock/panel, a general channel, plus the separately-built pieces of real collaboration: entity comment threads, offer approvals, VA role scoping, team manager dashboard, team inbox.

**Grade: C+ as chat, but chat is the wrong bar.** A 1–5 person land shop will not move their banter off iMessage/Slack; rebuilding Slack is a losing race and the Slack *connector* already exists for orgs that live there. What no competitor gives them is **collaboration anchored to the work objects** — and AcreOS already owns the objects.

**The reframe:** demote free-form chat to a supporting channel; promote **entity-anchored threads + assignment + approval** to the collaboration model.

1. **One thread primitive everywhere.** `comment-thread.tsx` becomes the canonical discussion surface on every lead/deal/property/note/rehab/certificate detail, with @mentions. A mention creates an Inbox-adjacent "Team" item and (optionally) a task — mention→assignment is the whole coordination loop for a small crew. The chat panel then re-renders as *the same threads*, grouped by entity, plus the general channel — chat becomes a view of the work, not a second place.
2. **Approvals as first-class objects.** `team-offer-approvals` generalizes into one approval object (offer, blast, mail batch, price change) with requested-by/approver/state — rendered in the Team view, in the approver's Today queue, and in the entity thread. This is also the natural home for role-gated Pax actions: a VA's "Hand to Pax" above their permission produces an approval addressed to the manager — the witnessed-send kernel already models exactly this (frozen `pending_actions` awaiting a human); extend the approver to be *a different human*, and team workflow inherits the whole trust machinery.
3. **Pax in the thread.** Pax is @-mentionable in any entity thread with that entity's context pre-bound: "@pax summarize where this negotiation stands," "@pax draft the counter at $41k" → reply lands in-thread, artifacts open in the rail, sends stay witnessed. This is Linear's agent-in-issue pattern and it requires no new destination — the thread is inside existing doors.
4. **Handoff notes.** A one-tap "hand to <teammate>" on any entity: assignment + a Pax-drafted context brief in the thread (state, last contact, next step, provenance-chipped). Solo→first-VA is the exact growth moment in this segment; this is the feature that makes the seat expansion feel obvious.
5. **Presence, minimally.** Avatar-on-entity ("Maria is viewing") and typing in threads — WebSocket fabric exists (post F-23 fixes). Skip read-receipts and reactions-arms-race.

Exit test: a two-person org runs an entire deal — sourcing note → offer approval → negotiation updates → assignment to close — without leaving the entity's thread, and the Slack connector mirrors thread events for orgs that want them in Slack.

---

## 3. The inbox family — every counterparty, one grammar

Part 1 §4.4 covered triage mechanics (needs-reply view, keys, SLA, context rail). Two deeper structural moves:

**3.1 Counterparty lenses, not more inboxes.** The platform actually converses with five populations — sellers (acquisition), buyers (disposition), borrowers (notes), tenants/vendors (rentals/rehabs), team (internal) — and today they're split across `/inbox`, buyer blasts, borrower portal messages, maintenance comms, and team chat. Keep **one Inbox** with a counterparty-type dimension: lens chips (Sellers · Buyers · Borrowers · Tenants · Team) whose visibility follows the vertical registry (a pure note investor sees Borrowers first; a wholesaler sees Sellers/Buyers), vocabulary via `personaVocabulary`. Same thread component, same keys, same Pax affordances everywhere — the "vast amount packed in" problem solved the same way as Settings: one grammar, lenses for scope.

**3.2 Conversation → structure, honestly.** A correction to Part 1: the inbox *already* has Pax reply drafting (`POST /api/ai/draft-reply` landing in the composer with attribution). Upgrade path: (a) route it through the same finalize/guard + router as the rail (it's exactly the class F-16-1 flags) and offer objective presets (hold price · counter · schedule call · let it die politely) rather than a blank draft; (b) **intent extraction with provenance** — when a seller reply mentions price/timeline/motivation, Pax proposes structured field updates ("Asking $52k — set counterparty ask?") as one-tap accepts writing to the lead with a `from thread, 2:14pm` chip. `seller-intent` prediction + `paxSourceExtraction` already exist; this fuses them at the moment of reading, which is where REISift/Launch Control users burn their evenings doing it manually. Refuse-not-fabricate applies: extraction only proposes what the text actually says.

Borrower/tenant lenses inherit their own compliance framing automatically (dunning read-only enforcement, FCRA gates) because sends already route through the choke points — the lens is UI, the law stays in the kernel.

---

## 4. Deal & inventory engine — one object model, many verticals

The funnel is one spine — **contact → parcel/property → deal → vertical outcome** (note · rehab · lots · certificate · lease · assignment) — and the code already implements each hop (Close & Carry, contract_assignments, cert won-bid handoff, deal→rehab). What's missing is the spine made *visible and load-bearing*:

1. **Single-record truth with lineage.** Every detail page shows its lineage strip: `Lead #341 → 12ac Caldwell APN… → Deal (closed 3/12) → Note #88`. The joins exist (`/api/deals/:id/track` was built for this); render it everywhere and make each hop navigable. This kills the "which page is the truth" confusion that plagues PropStream-class tools.
2. **Dedupe + stacking as inventory hygiene.** `leads-dedupe` exists as a tool; run its matcher continuously and surface "possible duplicate" chips at create/import time. Add list-stacking (Part 1 §4.7) as a computed `stackScore` on the lead row — inventory quality becomes visible in the table kit's default sort.
3. **Vertical inventory views = saved views on one kit.** "Inventory" for a flipper is projects-by-milestone; for a landlord, doors-by-status; for a lien buyer, certs-by-window. Each is a canned saved view (columns + filters + group-by) shipped per vertical in the registry — the §2.2 table kit makes each a config object, and the map's M4 matrix is the same registry's spatial twin.
4. **Underwriting priors from your own book ("deal genome").** Every closed outcome writes back: offer-to-ask ratios by county, days-in-stage, realized margin vs modeled, response rate per template. Stored in institutional memory with sample sizes; surfaced only above N with the modeled-label ("Your last 6 Caldwell exits averaged 1.9× basis — n=6"). This is the compounding moat no data vendor can sell, and the refuse-below-N rule keeps it constitutional.
5. **Forecast from velocity, labeled.** Pipeline-velocity already computes stage medians; project expected closes/cash into the Finance header and Today ("2 deals statistically due to close this month — modeled from your velocity"), driver-linked like Part 1 §4.3.

---

## 5. The acquisition machine — mail, outreach, and the full loop

Part 1 §4.7 covered rails and craft. The machine-level view — what makes acquisition feel like a *system* the platform runs rather than campaigns the user fires:

1. **Audience engine.** One audience object (saved search ∪ list ∪ stack-score filter, from Map M2 + imports) reused by every channel, with suppression sets (active pipeline, DNC, prior opt-outs, recent-touch cooldown) applied by construction and shown as receipts ("1,240 selected → 1,102 sendable: 96 DNC, 31 in pipeline, 11 cooldown").
2. **Cadence orchestration with a consent state machine.** Per-lead channel states (mailable / smsable-with-consent / emailable) drive a simple visual cadence: Mail day 0 → if scanned/QR-hit or replied, SMS day 4 → email day 10 → recycle in 90. The sequence builder exists; this adds the cross-channel edge conditions and renders live counts on edges (Part 1). TCPA/quiet-hours remain kernel-enforced; the orchestrator only proposes.
3. **Spend + CAC per territory.** marketing_spend ledger exists founder-side; give customers the same math on their own outreach: $/mailed, reply rate, cost-per-contract by county/list — displayed exactly where the next batch is being targeted, closing the loop that Prycd/DealMachine leave open ("what did that list actually earn?").
4. **Creative loop.** Template performance (response, contract-rate where attributable) at point-of-choice; A/B variants panel already exists — add auto-promote-winner with a founder-visible floor on sample size, honesty-labeled.
5. **Reply → intent → offer, one gesture.** Inbox extraction (§3.2) feeds the blind-offer engine's context (counterparty ask, motivation) so "Draft counter" is pre-grounded — the wedge (lead in → mail out → response → offer) compresses into a loop the operator can run 30× a day from the queue.

Compliance stays the brand: the pre-flight receipt (scrub coverage, quiet-hours plan, litigator hits) becomes marketing-visible — "the outreach tool that keeps you out of court" is a category position Launch Control cannot take.

---

## 6. Customer communication & negotiation

*Read: `negotiation-copilot.tsx` (607, flag-gated off) + `components/negotiation/` — BATNA calculator, pressure gauge, session replay, strategy analytics/panels — and the deletion ledger's verdict (standalone = un-executed KILL; duplicate services `negotiationCopilot` vs `negotiationOrchestrator`).*

**The disposition:** execute the ledger — but as a **transplant, not an amputation.** The standalone destination violates the "no new AI destinations" instinct that killed it (a separate negotiation app-within-the-app that nobody opens mid-conversation). The *organs* are genuinely good and belong where negotiation actually happens:

1. **Negotiation lens on the deal + thread.** When a deal is in negotiating/countered, the deal detail (and the inbox context rail for its thread) gains a compact lens: BATNA/walk-away (from underwriting defaults + the deal's own math), the counterparty picture (ask, movement history auto-built from extracted intents §3.2), and a strategy read. Pressure-gauge visual only if it earns honesty — it must reflect *stated* facts (their timeline, their ask movement), never invented psychology.
2. **Counter composer.** "Draft counter" presets (anchor low / split difference / terms-for-price: seller-finance trade using the creative-finance rails) → Pax drafts in-thread → witnessed send. Terms-for-price is the differentiator: no generic AI negotiator can counter with a *carry structure* because none owns the note rails.
3. **Session replay → coaching, org-memory powered.** Replay panel becomes "what worked": after closed/dead, the thread is summarized into the deal genome (objections seen, moves that preceded progress), and future lenses cite *your own* history with sample sizes — not canned scripts.
4. **Kill the residue.** Retire `/negotiation` + one of the twin services per the ledger, lower the founder-route/reachability baselines in the same commit, and port the four components into `components/deals/negotiation-lens/`. UPL framing: the lens advises on price/terms strategy, never legal terms — the existing gating banners apply.

---

## 7. Pax — assessed as an AI system

*This section takes the requested altitude: Pax as a piece of AI engineering, judged the way a frontier-lab applied team would judge it.*

### 7.1 What's actually built (it's a serious stack)

**Reasoning core:** `executive.ts` (2,464) with streaming + non-streaming paths, thinking blocks, why-explainer, tool loop. **Tools:** 61 registered (`tools.ts`, 2,826) spanning CRM CRUD, finance math, offers, comms, research (`browse_web`), enrichment, connectors, memory (`remember_fact`/`recall_facts`), knowledge retrieval, scheduling, and recursive `spawn_subagent`. **Safety:** a unified prompt-injection envelope (`untrustedEnvelope.ts` — customer notes, web content, recalled memories, and email bodies all re-enter the model marked untrusted; the marker literals are shared with `sanitizePrompt`/`validatePaxResponse`), output validators, a hallucination guard + live eval on the streaming path, data-grounding eval cases, model-tier routing with margin guards (`paxModelTier`), prompt versioning via SCP. **Action safety:** frozen `pending_actions` witnessed-send kernel; TCPA/DNC/UPL/money choke points below the tools. **Memory:** eight-plus subsystems (knowledge graph, consolidation, cognitive V13, institutional, temporal decay V11, memory triggers, SCP memory, embeddings). **Governance:** an autonomy matrix (Observe/Draft/Execute/Autonomous × per-action × thresholds × time guardrails) — currently *preference, not enforcement* (its own docstring says so). **Learning:** thumbs + edit-diffs client-side; calibration + prompt-evolution surfaces founder-side.

For a solo-built product this is a top-percentile agent architecture. The critique below is about closing the gap between architecture and *system*.

### 7.2 The nine engineering moves, in order

**P-1 · Make autonomy enforcement-true (the keystone).** Today the matrix is read "progressively as Phase E touches action paths" — i.e., the UI can promise a level the kernel doesn't enforce. Invert it: one `resolveActionPolicy(org, agent, action, amountCents, when)` consulted at the *single* choke point where `pending_actions` are written, returning `suggest | draft | require_approval | auto_with_receipt | forbid`. Levels become real by construction; per-action overrides, $ thresholds, and time guardrails all live in that function; the UI reads the same function so promise = behavior. Add `autonomyEnforcement.test.ts` pinning: level-0 org → zero auto actions possible even if a tool is called. Nothing else in this document matters as much for "acts on your behalf," because trust in the ladder is what lets customers climb it.

**P-2 · Guard totality.** F-08-1's fix (`finalizePaxOutput` on the non-streaming path) must explicitly cover the **subagent recursion** — `spawn_subagent` calls `processChat` as `pax_subagent`, so today a subagent can launder a fabrication past the guard and hand it to the parent as a "tool result." Also: subagent outputs should re-enter the parent *inside the untrusted envelope* (they contain model-processed external text). Add depth/step budgets on recursion and an injection eval lane built from envelope fixtures ("lead note instructs send_email") run in CI next to the grounding evals; add the Haiku lane (F-08-2) since free-trial users meet the weakest model with the same tools.

**P-3 · Tool-registry hygiene + capability scoping.** The 61 tools include live duplicates — `schedule_followup` *and* `schedule_follow_up`, `run_comps` *and* `run_comps_analysis`, `draft_offer` *and* `generate_offer`(+`generate_offer_letter`) — which measurably degrades tool selection and bloats every prompt. Dedupe to one canonical tool each (aliases mapped server-side for old traces). Then **scope by context**: the rail bound to a Note exposes note/finance/comms tools; the map context exposes parcel/measure/offer tools; scheduled runs get read-heavy sets. Smaller surface = better routing, lower tokens, and a smaller injection blast radius (an injected instruction can't call a tool that isn't mounted). Declare toolsets in the same registry the verticals extend (Part 1 §5's `paxSkills`).

**P-4 · One memory system with tiers, not eight systems.** The constellation (knowledge graph, consolidation, cognitive V13, institutional, temporal decay V11, triggers, SCP, embeddings) reads as strata of experiments; the risk is inconsistent recall, double-writes, and un-forgettable data. Define one Memory API with four tiers — **working** (conversation), **episodic** (events/receipts, decays), **semantic** (facts about entities + the deal genome, provenance-tagged, decay-scored via the V11 machinery), **procedural** (the org's playbooks/preferences) — one write path with source + confidence, one retrieval that fuses tiers, and the existing modules refactored into layers or retired via the ledger. Customer-facing consequence: the memory panel shows *what Pax knows and why*, with per-fact forget — memory you can audit is the trust feature; memory you can't is a liability. All recalled text stays enveloped (already true — keep it pinned by test).

**P-5 · Router totality + cost envelopes.** Close F-16-1's stragglers (`/api/va`, supportAgent, and verify `draft-reply`) into `aiRouter` so every token is tiered, capped, and eval'd; then give each *surface* a cost envelope (rail chat, scheduled jobs, extraction, subagents) with per-org daily budgets visible in Settings → Pax. Predictable cost is what lets you ship ambient intelligence everywhere without margin fear — the Opus→Sonnet→Haiku downgrade guard already proved the pattern.

**P-6 · Plan–act–verify for consequential work.** For multi-step or money/send-adjacent jobs, make the loop explicit: Pax emits a plan artifact (steps, tools, projected cost) → executes with the existing tool-call stream → a **verifier pass** (cheap model or deterministic checks: does the drafted amount match the approved amount, does the recipient match the lead, do claimed facts carry sources per `paxSourceExtraction`) → only then freeze the pending action. Thinking blocks already render; the plan artifact reuses them. This converts "the model was careful" into "the system checked."

**P-7 · Close the learning loop customer-side.** Edit-diffs and thumbs already flow to founder calibration; add per-org preference distillation ("you shorten Pax's drafts 80% of the time → brevity preference proposed") into procedural memory with explicit accept, and "Pax got better" receipts in the weekly digest. Model-side, keep evolutions founder-gated as designed — customers train *their* Pax's preferences, not the prompt corpus.

**P-8 · Observability parity.** Founder has traces/calibration; the customer needs the **action ledger** (Part 1 §4.5): every autonomous/approved action with inputs, policy that allowed it, cost, and undo where `undoRegistry` supports it — plus per-run replay for scheduled jobs. "You can always see exactly what Pax did and why" is the sentence that sells autonomy.

**P-9 · Feel.** Streaming everywhere (P-5 makes non-stream rare), tool progress with entity names not tool names ("Pulling Caldwell comps…"), interrupt/redirect mid-run, drafts saved on disconnect, and voice capture in field modes. Latency budget: first token <1.5s on rail, and long jobs always hand off to the scheduler with a queue receipt instead of a spinner.

### 7.3 The design position (one paragraph)

One assistant, three verbs. **Ask** (rail, palette, @pax in threads — same brain, context-bound). **Act** (witnessed by default, autonomous by earned policy — P-1). **Anticipate** (noticing, budgeted and rate-limited, always dismissible, always sourced). No second assistant, no assistant-as-destination, no personality theater — Pax's character *is* the honesty system: it cites, it refuses to invent, it shows its work, and it gets out of the way. That position is defensible precisely because every competitor's "AI" is a chat tab.

---

## 8. Connectors & MCP — the platform's nervous system

*Read: `server/services/connectors/registry.ts` (14 connectors: Gmail, Slack, Stripe, QuickBooks, Google Drive, Dropbox, DocuSign, Google Calendar, PropStream, BatchLeads, MLS/RESO, Zapier, Make) · `executor.ts` (direct API implementations, per-org encrypted credentials via `fieldEncryption`) · 16 connector tools mounted into Pax · `pax-connector-panel.tsx` (rail management sheet) · `server/mcp-server.ts` (inbound: AcreOS-as-tools, bearer auth, 100 req/hr in-memory).*

### 8.1 Where it stands

The **shape is right and rare**: connectors exist *for Pax* (tools), not as settings-page trophies — connecting Gmail immediately means Pax can search/send it. Three structural concerns before expansion: (a) the audit's adversarial pass parked a **"7th-P0 pointer" at `connectors/executor.ts`** — treat it as live until dispositioned (the checklist: org-scoping on every credential fetch, the provider-registry's `ssrf-guard` applied to any URL-bearing path, write-tool results enveloped); (b) the **MCP server's auth** admits a "slug-derived token" fallback and in-memory rate limiting — this is the exact key-hygiene class W1 fixed for the Data API (hashed keys, constant-time compare) and it predates that fix; (c) the constitution's **no-public-API-before-~50** trigger arguably covers an MCP endpoint — it *is* an API product wearing a protocol.

### 8.2 The architecture position: MCP-native, both directions

**Outbound (Pax → the world): adopt MCP as the connector substrate.** The bespoke executor hand-implements Gmail/Slack/Stripe/Drive/Calendar REST — all of which now have first-party or mature MCP servers. Refactor the registry so each connector declares `transport: "mcp" | "native"`; MCP-transport connectors get tools *generated* from the server's manifest (filtered through an AcreOS allowlist + the P-3 capability scoping), while land-specific vendors without servers (PropStream, BatchLeads, county GIS) stay native behind the same `ConnectorDef` interface. Wins: the executor's maintenance surface collapses; new integrations become a manifest review instead of an implementation; scopes/versions are declared by the source of truth. Non-negotiables carried over: credentials stay in the per-org encrypted store; **every** MCP tool result passes through `untrustedEnvelope` (external servers are the textbook injection vector); comms-class MCP tools are *blocked at the choke point* — an email MCP server may draft, but sends route through `sendOrgSMS`/`emailService` lanes so DNC/TCPA/witnessing can never be bypassed by transport choice; and each connector's mounted tools obey the P-1 autonomy policy like native ones.

**Inbound (the world → AcreOS): the MCP server is the future API — treat it with API discipline.** Near-term: founder-flag it dark or per-org allowlist; migrate auth onto the hashed Data-API key infra (retire the slug fallback); move rate limits to the shared store (in-memory dies per-machine on Fly's 2-node deploy); scope tokens read-only by default with per-tool grants. At the ~50-customer trigger, this flips from liability to **flagship**: "AcreOS as tools" means a customer's Claude/ChatGPT/agent stack can query their pipeline, pull a payoff quote, or file a lead — with the same org-scoped, policy-gated, receipt-logged kernel underneath. Publish the manifest, version it, and let the MCP server be the public API rather than building a parallel REST product.

### 8.3 Connector fabric across every feature

1. **Health model, one place + point-of-use.** Each connector: state (connected/expiring/erroring), scopes granted, last successful call, error budget — as Settings §1.4 status rows *and* surfaced where the dependency bites (Inbox shows "Gmail token expires in 3 days" on the compose bar, not just in Settings). Wire this into the vendor-expiry ratchet (F-18-1) so customer credentials get the same watchdog the platform's own do.
2. **Per-vertical connector packs.** The registry already carries `integrations` per business type — turn it into onboarding + Settings recommendations ("Note investors usually connect: Stripe, QuickBooks, DocuSign") with one-tap connect flows, and Pax skills that light up on connect ("Now that Calendar's connected, I can schedule seller calls").
3. **Feature-level mounting map** (where each connector actually shows up, so it's woven in rather than bolted on): Gmail/Calendar → Inbox lens + scheduling from threads and the queue; Drive/Dropbox → Documents door + attachment picker in threads/deals; DocuSign → the sign flow's external rail beside native e-sign; Stripe → borrower/tenant rails status (be-the-rail preserved) + payment-link tool; QuickBooks → Finance export + category sync (the honest alternative to building bank feeds now); Slack → team-thread mirroring (§2) + notification routing; PropStream/BatchLeads/MLS → provider registry entries with provenance chips, *not* silent data merges; Zapier/Make → the escape hatch, with recipes published for the top 10 asks.
4. **Trust surface.** Every connector-mediated action lands in the action ledger tagged with the connector + scope used; read vs write scopes requested separately (read-first connect, upgrade on first write attempt); disconnect always shows what stops working.

---

## 9. The Agency Layer — how AcreOS runs a business on the customer's behalf

*The synthesis. Everything above are organs; this is the organism. The claim worth building toward: AcreOS is the first platform in this market where "the software does the work" is enforced by architecture rather than implied by marketing.*

### 9.1 The operating loop, mapped to what already exists

| Loop stage | Exists today | The gap this document closes |
|---|---|---|
| **Perceive** | Live-trigger mesh (`workflow-live-triggers` + per-vertical event emitters), `parcelDeltaDetector`, inbound message matching, payment/lease/cert/rehab detectors | Watched searches (Map M2), SLA timers (§3), connector events (Gmail/Calendar webhooks) feeding the same mesh |
| **Remember** | The memory constellation + deal history | One tiered Memory API (P-4); deal genome (§4.4) |
| **Decide** | Workflow engine templates; Pax reasoning; autonomy matrix (preference) | `resolveActionPolicy` enforcement (P-1); plan artifacts (P-6) |
| **Act** | 61 tools; witnessed `pending_actions`; compliance choke points; `undoRegistry` | Capability scoping (P-3); approvals-as-objects incl. human-to-human (§2.2); MCP-transport actions under the same kernel (§8) |
| **Verify** | Guards/validators/evals (streaming), grounding eval | Guard totality incl. subagents (P-2); verifier pass (P-6); injection lane |
| **Learn** | Calibration, prompt evolutions, edit-diffs | Per-org preference distillation (P-7); genome write-back |
| **Account** | Receipts strip, why-explainer, founder Letter | Customer action ledger (P-8); the weekly Letter for customers (below) |

Nothing in the loop requires new invention — it requires the eleven wiring moves named above. That's the audit's meta-finding repeated at the highest level: **the agent OS is built; it isn't yet closed.**

### 9.2 The customer autonomy ladder (productized)

Make the Observe→Draft→Execute→Autonomous scale a *journey with graduation receipts*, not a settings slider:

- **L0 Observe** (day 1): Pax narrates and suggests. Graduation: 10 accepted suggestions.
- **L1 Draft**: replies, offers, mailers drafted; human sends. Graduation: N drafts sent with <20% edit distance (measured — the diff data exists).
- **L2 Execute-with-approval**: batched morning approvals ("Approve all 7 above 90%" — Part 1 §4.1); scheduled jobs run, sends still witnessed. Graduation: 30 days, zero reversals.
- **L3 Autonomous-within-policy**: routine sends/updates auto with receipts; approvals only above $ threshold, off-hours, or novel counterparties. Weekly digest becomes the primary interface.
- **L4 Delegated outcomes** (the horizon): "Keep my Caldwell pipeline at 5 active deals under $0.45/$ basis" — Pax plans campaigns, works replies, drafts counters, escalating only decisions. Ships only when P-1/2/6/8 are all green and only per-function.

Each level's *unlock moment* is celebrated with evidence ("Pax drafted 42 replies this month; you changed 3 words on average — ready to let it send the routine ones?"). The ladder is the retention curve: every rung climbed is switching-cost compounding, and the graduation criteria keep it honest.

### 9.3 The daily rhythm (what "running your business through it" feels like)

**Morning:** brief + queue, triage in keys, one batch-approve. **All day:** ambient — replies drafted in-thread, intents extracted to records, watched parcels pulse on the map, approvals arrive where you are. **Evening:** receipts strip — what moved, what Pax did, what's frozen for tomorrow. **Weekly:** *the customer Letter* — reuse the founder-Letter machinery for each org: cash picture, pipeline delta, what Pax completed, the one decision that matters next week, every number provenance-linked. **Always:** goals (`goals.tsx`) become live contracts — Pax reports variance against the customer's stated targets in the Letter, honestly labeled, never invented. The founder side already proved this rhythm works for running AcreOS itself; the product endgame is handing the same rhythm to every customer for *their* company.

### 9.4 The guarantees (publish them)

1. Nothing external happens outside the choke points — by construction, transport-independent (§8).
2. Every action is attributable, inspectable, and — where the undo registry covers it — reversible.
3. Autonomy never exceeds the policy you set, and the policy is enforced where actions are born, not where they're displayed (P-1).
4. Pax never states what it can't source; unknown stays "Not yet pulled."
5. Your data trains your Pax's preferences — nothing else (P-7).

These five sentences are simultaneously the safety case, the marketing page, and the reason a solo operator hands over the keys.

---

## 10. Sequencing addendum (extends Part 1's phases)

- **Phase A′ (with Part 1 Phase A):** P-1 enforcement gate, P-2 guard totality + subagent envelope, executor-P0 disposition, MCP server dark/allowlisted + key-infra migration. *These are the trust prerequisites for everything agentic here.*
- **Phase B′ (with B):** Settings decomposition per §1 (same wave discipline as the founder-dashboard retirement); tool dedupe + capability scoping (P-3).
- **Phase C′ (with C/D):** Inbox lenses + intent extraction; entity threads + approvals-as-objects; negotiation transplant + ledger kill executed; deal lineage strip.
- **Phase D′:** Memory API consolidation (P-4) + deal genome; action ledger + customer Letter; audience/cadence engine.
- **Phase E′:** MCP-transport connector refactor (start with Calendar or Slack as the pilot); L3 autonomy graduation shipping; connector packs per vertical.
- **Standing triggers:** inbound MCP public launch → ~50-customer API trigger · L4 delegated outcomes → P-1/2/6/8 green + first L3 cohort stable 60 days · voice → first field-heavy paying cohort · QuickBooks two-way sync → first customer on QBO asking.

**Exit test for the whole part:** a two-person land org at L2 runs a full week — sourcing to counters to a close-and-carry — where every send was policy-gated, every number sourced, the Friday Letter reconciles to the ledger exactly, and Settings was opened zero times.

═══════════════════════════════════════════════════════════════════════════════
# AcreOS Depth Audit — Part 3: Rails, Not Provider

*The liability architecture. Companion to Parts 1–2; same repo evidence base, plus this pass: `customerMoneyRouting.ts` (read in full — it is the founding document of this doctrine), `emailService` purpose lanes, `lobService.ts`, the provider license register (`data-licenses.ts`, per-provider `redistributable` flags), `resolveProviderCredential.ts`, the native e-sign stack (`esign/sealedDocumentPdf`, `signerRequest`, `signingTokens`, `EsignConsentDialog`), `RequiredDisclaimer` (7 typed disclaimers), the FCRA gating on tenant routes, and `docs/cyber-application-self-assessment.md`.*

*One framing note up front, honestly: "nearest to zero" is achievable as an architectural posture — provider roles eliminated by construction, exceptions governed, records that prove the customer was the actor — but no software posture reaches literal zero, and the paper layer in §4 is a build list to take to a lawyer, not legal advice. What this document can do is make sure the code never quietly signs you up for a liability the paperwork disclaims.*

---

## 1. The doctrine, stated so it can be enforced

**AcreOS is the rail: it supplies software, chokepoints, and receipts. The customer is always the actor: the merchant of record for their money, the sender of record for their messages, the licensee of record for their data, the signer and decider of record for their documents and deals — acting through accounts they own and can take with them.** AcreOS's only first-party commercial relationship with money, messaging, or data is running *itself* (subscriptions in, system mail out, its own vendor contracts for its own operations).

The repo already proved *why* this must be code, not policy. `customerMoneyRouting.ts` records that the two live violations of the money ruling were **omissions, not decisions** — a missing `stripeAccount` argument put consumer mortgage payments into AcreOS's own balance; a missing `on_behalf_of` made the platform settlement merchant while taking a cut. Its conclusion is the operating principle for this entire document: *"Prose in a header comment does not catch a missing argument"* — so the correct shape is asserted at runtime, on the way out, with a ratchet test pinning it. Every domain below is graded against that bar: **enforced-by-construction** (chokepoint + ratchet) > **enforced-by-refusal** (feature absent/gated until the customer connects their own) > **policy-only** (prose, one omission from violation) > **leak** (platform is the provider today).

The second principle: **exceptions must be governed, not accidental.** There are places where being a thin provider is the deliberate wedge (system email, the free-tier 5-piece first mail send). Those are fine *if* each is registered, mitigated, owned, and given an exit trigger — §5 proposes the machine-readable register for exactly this, in the style of `constitution.ts`.

---

## 2. Domain-by-domain posture audit

### 2.1 Money — **enforced-by-construction (the gold standard; done)**
Customer money (borrower payments, rent, escrow, distributions) moves only on the customer's own connected Stripe account or is routed out entirely — no platform fallback, no application fee, no funds transiting AcreOS's balance. Chokepoint asserts the request shape at runtime; `moneyCustodyHardStop.test.ts` ratchets it; the founder explicitly chose "route out entirely" over a disclosed 2.5%. Nothing to add except vigilance: every *future* payment-shaped feature (deposits, option fees, JV distributions, marketplace anything) must be born inside this chokepoint. Residual exposure is the ordinary one — Stripe subscription merchant for AcreOS's own revenue — which is unavoidable and fine.

### 2.2 Email — **enforced-by-construction (done)**
Purpose lanes (`system` | `counterparty`) with **no silent fallback**: counterparty mail requires the org's own connected identity; the platform sender exists for system mail only (receipts, digests, auth). This is the correct pattern and the template §2.4 should copy. Keep the customer-visible corollary from Part 2: identity health (SPF/DKIM/DMARC, bounce/complaint) shown to the customer, because a BYO rail makes *their* reputation the asset — the product should help them protect what they now own.

### 2.3 SMS — **enforced-by-refusal → construction (nearly done)**
BYO-Twilio with explicit refuse-not-fallback when unconnected; TCPA consent + quiet-hours moved inside `sendOrgSMS`; DNC/litigator scrub seam at the same choke point. The campaign bypass (F-21-1) is the one hole and is already Brief #2 of the audit's Ten — after it lands, add the grep-ratchet (zero raw `messages.create` outside `comms/`) and this domain is closed. Note the quiet win already in place: because Twilio is BYO, **10DLC registration, carrier vetting, and sender reputation are the customer's regulatory relationship**, not yours — the platform's "still dark by choice: Twilio 10DLC purchase" line should become permanent policy (never purchase platform 10DLC for counterparty traffic).

### 2.4 Physical mail — **LEAK: the one send rail still re-fronted**

> ⚠️ **SUPERSEDED — do not execute this section's remediation as written.** §J (Addendum E) **R.0** corrects it: the BYO physical-mail architecture **already exists and is correct** — `server/services/mailProvider.ts` resolves the org's own Lob credentials first (`getOrgMailCredentials`, line 82) with an interlocked platform fallback (`getDefaultCredentials`, line 106; `mail/liveSendInterlock.ts`). Re-verified true at HEAD 2026-08-11. The actual defect is narrower and a different class: **three parallel mail paths, only one of which does BYO resolution** (`lobService.ts` and `directMail.ts` read `process.env` directly). Build **R.1 (consolidation)**, not a new BYO path. Every other sub-item below (purpose lanes, wedge caps, prohibited-content lint, the refuse-don't-fall-back ratchet) remains valid and attaches to the consolidated path.

`lobService.ts` resolves `process.env.LOB_API_KEY` — a platform key — and no BYO/org-credential path is wired, even though `resolveProviderCredential.ts` exists and other providers use it. Today AcreOS is the mail house's customer of record for every counterparty letter: content originator in Lob's eyes, merchant for postage, refund-holder for failed mail, and the party USPS/Lob complaints route to. This is exactly the posture the 2026-07-17 email ruling rejected — it just wasn't extended to paper.

**Fix, same shape as email:** (a) wire `lobService` through `resolveProviderCredential` so an org's own Lob key is used when present; (b) add the same `purpose` lane discipline — platform key valid only for `system` mail and for the **registered wedge exception** (free-tier 5-piece lifetime first send, which is strategically correct to keep); (c) counterparty mail beyond the wedge on the platform key requires an explicit, small, capped metered lane *or* BYO at Starter+ (recommend: BYO default at Pro/Scale, platform-metered convenience capped low at Starter); (d) mitigations on any platform-keyed send: address verification (already there), a prohibited-content lint on templates (no debt-collection language without the compliance flow, no unfair/deceptive patterns — the `lint:no-fabrication` machinery shows how), per-org daily piece caps, and ToS language putting content responsibility where it belongs; (e) ratchet: `mailProviderLanes.test.ts` — counterparty send with no org key and wedge exhausted must refuse, not fall back. This is the highest-priority item in Part 3 because it is the only place a customer's *outbound speech to strangers* still travels under your name.

### 2.5 Data in (enrichment, skip trace, comps) — **strong license spine; open provider-role decision — decide it BYO-first now**
What's right already: a human-reviewed license register with per-source `redistributable` verdicts, a cache gate that only re-serves `yes`/`attribution` sources (proprietary = live passthrough only), provenance chips, and free/government sources demoted ahead of paid ones. What's undecided: ATTOM/BatchData platform licenses are "still dark by choice" — meaning the *reseller* question hasn't been consummated yet. When AcreOS holds the vendor contract and charges credits, AcreOS is a **data provider**: bound by seat/use restrictions, audit clauses, and (for skip-trace/contact data) the permissible-purpose questions that live near FCRA/GLBA depending on vendor and use. The moment to set posture is *before* signing those contracts:

**Recommended posture — the BYO-data ladder.** Default scaling path is BYO keys (the fix_and_flip vertical already pioneered per-org ATTOM keys; generalize it): the customer signs the vendor's terms, the customer is the licensee, AcreOS is the software that exercises *their* license — identical to the money/email logic. Platform-credit lookups remain as the **convenience lane**: small, capped, priced with margin, and only via vendors whose reseller terms are actually in hand — each such vendor is an entry in the §5 provider-role register with its contract clause cited. Skip-trace specifically: surface the vendor's permissible-use attestation to the *customer* at first use (checkbox with the vendor's language), so the use-purpose representation is theirs. And one structural rule regardless of lane: **AcreOS never builds its own database out of proprietary passthroughs** — the cache gate already enforces this; add the same gate to the deal-genome/institutional-memory writers so learned aggregates derive only from the customer's own records and redistributable sources.

### 2.6 Data out (exports, public parcel reports, webhooks, MCP) — **gap: license-aware egress is a missing chokepoint**
The register answers "can we cache and re-serve?" — nothing yet answers "can this leave the platform?" A CSV export, a public parcel report, a webhook payload, or an MCP tool result containing ATTOM-derived fields is redistribution of `redistributable:"no"` data. Build one **egress filter** consulted by all four surfaces: fields tagged with their source's license at write time (provenance tags exist), stripped-or-attributed at egress per the register, with the customer's *own-entered* data always fully exportable (that's the no-lock-in promise). Ratchet: an egress test with a fixture row carrying a `no` source through export/report/webhook/MCP asserting the field is absent. This also resolves the Part-2 MCP concern cleanly: the MCP server becomes safe to open (at the ~50 trigger) *because* egress is license-aware by construction.

### 2.7 Signatures — **quietly a service-provider role; adopt connector-first**
A native e-sign stack exists (consent dialog, signer tokens, sealed tamper-evident PDFs) — which makes AcreOS an e-signature service operator, carrying the ESIGN/UETA consent-and-retention obligations and the "was this record reliable" burden in any later dispute between customer and counterparty. The DocuSign connector also exists. Policy: **connector-first for instruments** — purchase agreements, notes, assignments, anything recorded or litigated defaults to the customer's own DocuSign (their account, their audit trail, their vendor); native e-sign remains for low-stakes internal artifacts (disclosures, intake acknowledgments) where it already does consent + sealing correctly. Encode it: document templates carry a `signatureRail: connector-preferred | native-ok` field, and the request-signatures dialog routes accordingly with an override the customer makes knowingly.

### 2.8 Screening & regulated determinations (FCRA and friends) — **fields-only; hold that line forever**
Today AcreOS stores screening *fields* with FCRA gating on writes (fix the POST/PATCH parity, F-15-1) and never orders consumer reports — so it is not a CRA and not a user of consumer reports; the customer is. Standing rule for the roadmap: tenant screening, employment-style checks, or credit pulls only ever arrive as **connectors to services the customer contracts directly** (their SmartMove/TransUnion account), never as an AcreOS-branded report. Same shape for anything determination-flavored: Dodd-Frank checker, DNC results, UPL warnings are *decision support with citations*, and adverse-action-style communications (denials, dunning escalations) stay template-assisted but customer-sent under §2.2–2.4 rails.

### 2.9 Advice-shaped outputs (valuations, offers, negotiation, legal/tax adjacency) — **posture is right; make coverage provable**
The stack is genuinely defensive already: refuse-not-fabricate, AVM "AI estimate" labeling with versioned LCS methodology, USDA-fallback honesty on offers, UPL block/warn states with licensed-path off-ramps, dunning read-only enforcement, and a typed `RequiredDisclaimer` (financial · legal · ai · valuation · score · document · worksheet). Two upgrades: (a) **coverage ratchet** — a lint mapping each output class to its required disclaimer type (any surface rendering an AVM value must mount `valuation`; any generated instrument mounts `document`), baseline current gaps and drive to zero, so the disclaimer regime is provable rather than assumed; (b) language hygiene rule in the AI validators: valuation outputs never use appraisal-of-record vocabulary ("appraised value," USPAP-adjacent phrasing), offer/negotiation outputs are always framed as options-with-reasons. The witnessed-action kernel then completes the logic: because a human approved the send, **the customer is the maker of every statement to a counterparty** — the platform drafted; the principal spoke.

### 2.10 AI agency at higher autonomy — **the one place "rails" and "acts on your behalf" tension; resolve it with consent artifacts**
Parts 1–2 push toward L3/L4 autonomy; liability posture must climb the same ladder. The mechanism: **standing instructions as first-class consent artifacts.** Graduating a function to auto-execute mints a record — scope, thresholds, channels, effective date, the exact policy JSON — that the customer affirmatively accepts (and can revoke in one tap), stored beside the action ledger. Every autonomous action then carries a pointer to the standing instruction that authorized it. Combined with P-1 enforcement and P-8's ledger, the evidentiary chain for any disputed send is: *customer-set policy → policy-gated action → receipt* — the platform executed the customer's documented instruction through the customer's own accounts. That chain is the difference between "the AI did it" and "I did it, using a tool," and it should exist before L3 ships, not after the first dispute.

### 2.11 Credentials & custody of keys — **the duty you keep; already handled seriously**
Being the rail means holding everyone's keys — that custody *is* your irreducible responsibility, and it's the one to over-invest in rather than architect away. Present state is strong: per-org field encryption, scoped OAuth, revocation, secrets-audit discipline, credential-liveness watchdogs, and an underwriter-ready cyber/Tech-E&O self-assessment. The Part-3 additions: extend the vendor-expiry watchdog to customer connector credentials (F-18-1 pattern), read-scopes-first connect flows (Part 2 §8.3), a written breach-notification runbook keyed to connector categories, and — the personal-liability line item — **actually bind the cyber + Tech-E&O policy** the self-assessment was written for; it is the cheapest real-world reduction of founder-personal downside in this entire document, alongside routine entity hygiene (the company signs vendor contracts and ToS; you don't).

### 2.12 The platform's own autopilot — **your liability firewall against your own machine; keep the hard-stops eternal**
Pricing changes, legal signing, spends >$500, and customer-data deletion are founder-only forever, ratchet-pinned. This is rails-not-provider applied *inward*: the autonomous layer can operate the business but can never bind you to a contract, a price, or a destructive act without your hand. Nothing to change — just naming it as part of the same doctrine so future waves don't erode it.

---
## 3. The BYO-everything matrix — consolidation without custody

The product thesis this doctrine enables: **one intuitive surface, zero custody.** The customer's Stripe, Twilio, mailbox, Lob, data licenses, DocuSign, QuickBooks, Drive — connected once, orchestrated everywhere, revocable and portable always. The matrix (target end-state; ✅ = enforced today):

| Service | Customer owns | Platform role | Posture | Tier shape |
|---|---|---|---|---|
| Payments (borrower/rent/etc.) | Stripe Connect account | Initiates on their account only | ✅ construction | All tiers; refuse without |
| Email (counterparty) | Mailbox + domain | Composes, sends via their identity | ✅ construction | All tiers |
| SMS | Twilio + 10DLC | Gates (TCPA/DNC/quiet-hours), sends via theirs | ✅ refusal → construction after F-21-1 | All tiers; refuse without |
| Physical mail | Lob account | Renders, verifies, sends via theirs | **build (§2.4)** | Wedge 5-piece platform; BYO default Pro+ |
| Property data | ATTOM/Regrid/etc. licenses | Exercises their license; provenance | **decide BYO-first (§2.5)** | Platform credits = capped convenience |
| Skip trace | Vendor account + use attestation | Runs lookups under their attestation | build | Same ladder |
| Signatures (instruments) | DocuSign account | Prepares envelopes | **connector-first (§2.7)** | Native for low-stakes only |
| Accounting | QuickBooks | Syncs categorized ledger out | connector (exists) | Pro+ |
| Storage/docs | Drive/Dropbox | Reads/writes their files | ✅ connector | All |
| Calendar/comms | Google Calendar, Slack, Gmail | Tools under scoped OAuth | ✅ connector | All |
| AI | BYOK optional | Routes via their key when set | ✅ exists | Any tier |

**The UX that makes BYO feel like ownership, not friction** (this is where "well designed" earns the strategy): connect-at-the-moment-of-need mini-flows (Part 2 §1.4's just-in-time pattern — the first SMS attempt *is* the Twilio connect screen, pre-filled and 90 seconds long); status rows that celebrate ownership ("Sending as **you** — your number, your reputation"); a **Your Rails** overview inside Settings §Data & Integrations showing every connected account, its health, and a one-tap revoke; refuse-states that read as protection, not failure ("AcreOS won't send texts from a shared number — that's how platforms get customers sued. Connect yours: →"); and export-everything always live, so portability is demonstrated rather than promised. Turn the doctrine into copy on `/why` and `/transparency` — the pages exist; the argument ("your accounts, your data, your reputation — we're the operating layer") is the trust story competitors structurally can't tell, because re-fronting rails *is* their margin.

---

## 4. The paper layer (build list for counsel — not legal advice)

The code posture only pays off if the documents match it. A one-sitting punch list to take to a real lawyer, mapped to what already exists:

1. **ToS/MSA alignment:** customer as merchant/sender/licensee/decider of record per §2; platform as software provider and processor; AI outputs as assistance requiring review (the disclaimer texts are the seed); standing-instruction clause authorizing policy-gated automation (§2.10); content responsibility on customer for all counterparty communications incl. the wedge mail lane; indemnity shaped to the actor-of-record model.
2. **DPA + sub-processors:** the sub-processor endpoint already filters by vertical — keep it truthful via the vendor-inventory doc; add customer-connector data flows to the DPA annex (data you touch *because they connected it*).
3. **Consent artifacts:** e-sign consent (exists), skip-trace permissible-use attestation (§2.5), standing instructions (§2.10), SMS consent capture (exists) — each stored, timestamped, surfaced in the ledger.
4. **Records = receipts:** the action ledger + Letters are your evidence layer; retention policy already documented — confirm it covers consent artifacts and pending_actions history for the statute-relevant window.
5. **Insurance:** bind cyber + Tech-E&O off the self-assessment; revisit limits at first paying cohort and at L3 launch.
6. **Entity hygiene:** contracts, vendor accounts, and the MCP/API keys all in the company's name; founder signs as officer. (The founder-autopilot hard-stops already prevent the machine from signing anything at all.)

---

## 5. New chokepoints, ratchets, and the Provider-Role Register

Engineering list, in priority order — each in the house style (runtime chokepoint + ratchet test + machine-readable registry entry):

1. **Mail lanes** (§2.4): `lobService` → `resolveProviderCredential` + purpose lanes + wedge cap · `mailProviderLanes.test.ts`.
2. **License-aware egress** (§2.6): one filter for export/report/webhook/MCP · fixture-driven egress test · unblocks future MCP launch.
3. **Disclaimer coverage lint** (§2.9): output-class → disclaimer-type map, baseline and ratchet.
4. **Standing-instruction gate** (§2.10): `resolveActionPolicy` (P-1) requires a live consent artifact for any `auto_with_receipt` grant · test: revoked instruction → next action downgrades to approval.
5. **Genome license gate** (§2.5): institutional-memory writers accept only own-record + redistributable inputs · test with a proprietary-tagged fixture.
6. **FCRA parity** (F-15-1, already in the Ten) and **campaign-SMS choke** (F-21-1, already Brief #2) — named here because they are rails items wearing bug clothes.
7. **The Provider-Role Register** — `shared/governance/provider-roles.ts`, sibling to `constitution.ts`: every place AcreOS deliberately *is* the provider, as data — `{ role, scope, why, mitigations[], owner, exitTrigger, enforcement }`. Seed entries: system email (permanent), wedge 5-piece mail (exit: BYO-Lob shipped + wedge conversion measured), platform data credits (exit: per-vendor reseller terms on file; cap enforced), native e-sign low-stakes (permanent, scoped), MCP server (dark until API trigger). Ratchet like the constitution's: every entry's enforcement pointer must resolve; **unregistered provider behavior is the thing the register's companion lint hunts** (platform-key usage outside a registered role fails CI). This converts "rails, not provider" from a mentality into the same kind of checkable object the money ruling became — which is the whole lesson of `customerMoneyRouting.ts`.

---

## 6. Why this wins (not just protects)

The liability posture and the product story are the same story. Every re-fronted rail a competitor runs — their shared SMS numbers, their mail account, their data resale, their payments cut — is margin for them and *concentrated risk plus lock-in* for their customer. AcreOS charging for software and orchestration, never for spreads on custody, means: pricing that doesn't tax customer volume, a trust page that reads like an engineering document because it is one, enterprise/security reviews that pass on evidence (the cyber self-assessment's own standard: point to the control), and a customer who stays because the product is good — not because leaving means losing their number, their history, or their rails. "The platform that never holds your money, never sends as itself, and never owns your data — and can prove all three in CI" is a category position with a moat made of ratchet tests.

**Exit test for Part 3:** a hostile reading of the codebase by opposing counsel's expert finds: zero paths moving customer money on the platform account, zero counterparty sends on platform identity outside the register, zero proprietary fields crossing egress, a consent artifact behind every autonomous action, and a register whose exceptions all resolve to live mitigations. When that grep comes back clean, "nearest to zero" is as true as software can make it.

═══════════════════════════════════════════════════════════════════════════════
# AcreOS Depth Audit — Part 4: The Revenue Engine

*Parts 1–3 audited the machine (surfaces), the operating system (agency), and the liability posture (rails). Part 4 audits the system that pays for all of it: how AcreOS earns, activates, keeps, and expands customers — held to the same standard as the code: claims enforced by construction, funnels with receipts, exceptions registered, honesty as the differentiator. New evidence read this pass: `server/services/{activation,churnEngine,referralService,referralReward,growthAdService,marketingSpend,trialBalance,onboardingAutonomy}.ts`, `server/services/billing/`, the landing system (`pages/landing/` — Hero, Positioning, DayInLife, Agents, DataProvenance, LandCreditScore, Quotes, ProductShots, FAQ, Pricing, copy.ts), `pricing.tsx`, `why.tsx`, `transparency.tsx`, `learn/`, `help/`, `changelog.tsx`, plan tiers (`starter | professional | enterprise`).*

---

## 1. Where the revenue engine stands

The striking finding: **the measurement layer of a growth machine is already built, pre-revenue.** Idempotent activation events feeding a founder funnel ("% of orgs hitting each canonical event in 7/30/90 days"), a daily churn engine scoring every paying org on five weighted signals with automatic Pax re-engagement, referral service + rewards, a marketing-spend ledger, trial balances, growth-ad service, onboarding autonomy. Most companies bolt this on at 100 customers; it's here at ~zero. What's *thin* is everything above the product: one landing page for fifteen verticals, no self-serve way to touch the product before signup, a proof story (provenance, rails, honesty) that lives in the codebase but not yet in the market, and no declared activation definition per vertical for all that instrumentation to aim at.

So Part 4's job is not "add analytics" — it's **aim the machine**: positioning and packaging (§2), the proof layer that converts (§3), acquisition motions ranked for one person (§4), activation economics (§5), retention as ladder-climbing (§6), the self-running GTM loop (§7).

---

## 2. Positioning & packaging

**2.1 Wedge-first, breadth-behind.** The roadmap's north star (lead in → mail out, land) is the message; fifteen verticals is the *architecture*, not the headline. Position: *"The operating system for land investors — that your whole strategy can grow into."* Breadth appears as proof of depth ("when you pick up notes, the servicing book is already here"), never as a fifteen-logo grid that reads as unfocused.

**2.2 Per-vertical front doors from the registry you already have.** `onboarding-verticals.ts` holds per-persona copy, day-one promises, and finish paths; `business-types.ts` holds maturity and surfaces. Generate `/for/<vertical>` landing routes from that same registry — hero = that vertical's signature surface (Part 1 §5), the day-in-the-life section re-cut per persona, honest maturity badges on beta verticals right on the marketing page. Fifteen SEO-indexable front doors for the cost of a template, impossible for the registry to let drift from the truth — the marketing-site version of refuse-not-fabricate.

**2.3 Pricing on orchestration, never on custody.** The Part-3 doctrine sets the pricing logic: because rails are BYO, COGS stays flat as customer volume grows — so price on **seats + Pax capability + orchestration breadth**, and treat credits (data, wedge mail) as capped conveniences, not profit centers. Concrete tier shape for the existing `starter|professional|enterprise`: **Starter** = one vertical active, L0–L1 Pax, wedge mail, platform-credit convenience caps; **Professional** = all verticals, L2 (batch approvals + scheduled jobs), BYO rails unlocked everywhere, table-kit saved views/exports; **Enterprise/Scale** = L3 autonomy with standing instructions, team approvals + VA roles, API/MCP when the trigger fires, priority county fabric tiling. The autonomy ladder is the natural upgrade axis because it's also the retention axis (§6) — customers pay more precisely when they trust more, and the graduation receipts (Part 2 §9.2) are the upgrade prompts. One rule imported from the constitution: pricing changes stay founder-only forever; the machine may *propose* discounts into a founder queue, never grant them.

**2.4 The honest-comparison page.** This market's incumbents overclaim (modeled numbers as fact, shared send rails, lock-in). A comparison page that concedes real gaps ("PropStream has nationwide residential data; we don't, on purpose — here's why") buys credibility no feature table can. Honesty is already the engineering brand; make it the sales brand.

---

## 3. The proof layer — trust as the conversion mechanic

1. **Touch-before-signup.** The sample-data machinery + read-only role can compose into a public demo org ("Open the demo — no email") seeded per vertical from the same fixtures onboarding uses. For this audience, ten minutes clicking a live rent-roll or auction worksheet outsells any video. In-product, Part 1's demonstrative empty states finish the same job post-signup.
2. **Provable claims.** `transparency.tsx`, `why.tsx`, and the landing's DataProvenance section are the seed of a page nobody else can ship: claims backed by CI — the ratchet-test list, the money-custody hard-stop, the provider-role register (Part 3 §5), uptime, "we can't fabricate valuations — here's the lint that fails the build." Changelog already exists; add "verified by test <name>" links. Enterprise reviews and skeptical Facebook-group threads are both won by receipts.
3. **Artifacts that travel.** The public parcel report, deal-room share page, and payoff-quote PDF are documents customers *send to other investors* — tasteful "Prepared with AcreOS" attribution + a live link makes every deal a distribution event. This is the highest-leverage viral loop available and it's three footer lines of work.
4. **Case receipts.** The customer weekly Letter (Part 2 §9.3) doubles as case-study raw material: with consent, anonymized Letters become "a real week on AcreOS" content — evidence-shaped marketing from the same receipts system, zero invention possible.
5. **Security page** straight from the cyber self-assessment's honest-answer format — it's already written for underwriters; buyers are an easier audience.

---

## 4. Acquisition motions, ranked for a solo founder

In expected-ROI order for this niche: **(1) Founder-led presence where land investors already gather** — the communities, podcasts, and forums of this niche run on practitioner credibility; the build-in-public + honesty angle ("the platform that refuses to fabricate") is genuinely novel there, and the demo org gives every conversation a destination. **(2) The wedge as the ad unit** — "send your first 5 offer letters free, from a real parcel list" is a self-liquidating offer; run it through `growthAdService` + `marketingSpend` so CAC-per-county gets the same receipts customers get (§7 — the machine dogfoods Part 2 §5's acquisition loop on itself). **(3) Referrals** — the service + rewards exist and the Today nudge is placed; activate with a both-sides reward denominated in the product's own currency (mail credits/seats), and instrument referral-sourced activation separately. **(4) Integration-directory listings** — Stripe, Twilio, Lob, QuickBooks, DocuSign galleries; the BYO architecture makes AcreOS a *featured pattern* for these vendors, and their directories are standing search traffic. **(5) Content via `learn/`** — per-vertical question-space articles (redemption periods by state, subdivide checklists) drafted by Pax, approved by founder (hard-stops), each ending in the relevant demo view; slow compounding, near-zero marginal cost. Deliberately *not yet*: paid social at volume, conferences, outbound SDR motion — all violate the solo-operator constraint for sub-scale return.

---

## 5. Activation economics

1. **Declare the metric per vertical, in the registry.** The events pipeline is built but aimless without a definition of "activated." Add `activationEvent` to `business-types.ts`: land = first offer batch sent; notes = first note fully onboarded with a logged payment; wholesaler = first blast; landlord = first month's rent roll reconciled; lien = first worksheet scored. The founder funnel then reads activation *rate* per vertical — which is also the honest input the maturity-promotion program (Part 1 §5) has been missing.
2. **Time-to-first-value under 10 minutes.** Onboarding-v2 already finishes at a door; instrument minutes-to-activation-event and treat the number like a performance budget. `onboardingAutonomy.ts` is the lever: Pax performs the demo-able steps *with* the customer (imports their CSV, drafts the first letter) at L1 during onboarding — the first mile is also the autonomy ladder's first rung.
3. **The wedge conversion ratio is the north star.** Free 5-piece send → first paid batch is the single number that proves the business. Everything in Parts 1–3 that touches the wedge path (map identify → track → offer → mail → reply → counter) is, in revenue terms, one funnel; report it that way on the founder Letter weekly.
4. **Sample-to-real transition.** Sample data must never pollute real metrics (the F-24 finding) and should self-retire: once real records exist, offer one-tap sample cleanup — activation events only ever fire on real entities (assert it in the recorder).

---

## 6. Retention & expansion — the ladder is the moat

The churn engine's five signals are right; connect its output to governed action: high-risk orgs get a Pax re-engagement *sequence* (value receipt: "here's what sat unworked in your queue"), a founder alert at the top decile, and — because pricing is founder-only — save-offers only as founder-approved queue items. Expansion is autonomy graduation (L1→L2→L3 upgrade prompts with evidence, Part 2 §9.2), the VA/seat moment (the handoff feature is the expansion trigger — instrument "second seat invited"), vertical adoption ("you just logged a note — the servicing book is included; want the tour?" from real signals only), and annual prepay offered at trust milestones (60 days at L2+, not at signup). The weekly customer Letter is the retention artifact: a business that reads its own P&L through you does not churn to a spreadsheet.

---

## 7. The self-running GTM loop (Foundry-grade, hard-stops intact)

Run growth exactly like the customer-facing agency layer, one level up: **Perceive** (activation funnel, wedge ratio, churn scores, CAC ledger, referral events) → **Decide** (weekly growth section in the founder Letter: one experiment proposed with cost + hypothesis) → **Act** (Pax drafts the content, the ad variants, the re-engagement copy; founder approves — spend >$500, pricing, and public claims remain founder-only) → **Verify** (the marketing-claims lint: copy that asserts a capability must reference the capability registry; "unlimited" fails where caps exist; beta stays labeled in ads too) → **Account** (every experiment closes with a receipt in the Letter: CAC, activation delta, keep/kill). One new ratchet makes it durable: `marketing-claims.test.ts` walking `landing/copy.ts` and `/for/*` output against the registry — the marketing site becomes as unable to lie as the app is.

---

## 8. Sequencing & exit tests

**Pre-first-customer (now):** declare activation events; demo org live; `/for/land-flippers` + provable-claims page; wedge funnel instrumented end-to-end; claims lint. *Exit: a stranger can go demo → signup → first 5 letters in one sitting, and every step emitted an event.*
**Customers 1–10:** concierge onboarding (founder + Pax) with minutes-to-value measured; artifacts-that-travel attribution on; first case receipts consented. *Exit: wedge ratio has a real number; three Letters are publishable.*
**Customers 10–25:** referral rewards on; paid wedge loop at small spend with CAC receipts; per-vertical front doors for every core vertical; annual prepay at milestones. *Exit: one acquisition channel shows repeatable CAC < 3-month revenue; churn engine has intervened at least once with a receipt.*
**Triggers unchanged:** marketplace at ~25, public API/MCP at ~50, residential plane on its revenue trigger — the growth system inherits the constitution rather than pressuring it.

**Part 4's single sentence:** the product's honesty system, pointed outward, *is* the go-to-market — provable claims, touchable demos, artifacts that travel, and a funnel that reports to the same Letter as everything else.

═══════════════════════════════════════════════════════════════════════════════
# AcreOS Depth Audit — Part 5: The Operations Layer

*How the company runs when nobody is looking — and how it proves it. Parts 1–4 covered surfaces, agency, liability, and revenue; Part 5 is the layer underneath all four: reliability, support, cost, and continuity, held to the series' standard — every promise gets a sensor, every sensor gets a pager path, every claim gets a drill receipt. Evidence this pass: audit slices 13 (reliability), 16 (cost), 18 (solo-operator) read in full, plus the substrate they audited — `stepAwayReadiness.ts` (8-check machine-verified verdict), the 118-entry `JOB_ROSTER` + deadman, `alertSpine`/`pagerService` fan-out, `backupRestoreVerify`, `aiCostCeiling`/`outreachStopLoss`/`capitalTracker` fail-closed stop-losses, `onboardingAutonomy` (zero-touch signup), `paxSupportResolver`/`supportAgent`, the runbooks directory, and the DR ledger.*

*Relationship to the August audit: its operations findings (F-13-1/2/3, F-16-1/2, F-18-1/2) are treated as prerequisites and are not re-litigated. Part 5 is the doctrine that makes their defect classes — "failure is quieter than absence," "time-based failures during an absence," "spend that bypasses the chokepoint" — structurally unrepresentable, and then turns operations into a customer-visible asset.*

---

## 1. State of the layer

Honest read: **the substrate is unusually mature and the autopilot is real.** Signup→onboarding runs with zero founder steps; outreach and AI spend fail closed and self-pause; a deadman watches 118 jobs; pages reach a phone through three transports; backups self-verify weekly; and "can I leave right now?" is a machine verdict, not a feeling. Almost no seed-stage company has any of this. The audit's finding was not that the machine is weak — it's that the machine has **three blind quadrants**: things that *run and fail* (quieter than absence), things that *expire on a date* (invisible to liveness checks), and things that can only be seen *from outside the app* (the app can't page about its own death). Part 5's program: close the quadrants (§2–3), then extend the same discipline to the two operational systems the audit didn't treat as systems — support (§4) and unit economics (§5) — and finish with continuity as a drilled, receipted capability (§6).

---

## 2. The reliability contract — promises with sensors

1. **Declare SLOs per surface class, not one number.** The product's promises differ in kind: *send lanes* (SMS/email/mail dispatch) promise correctness-then-timeliness; *the five doors* promise interactive latency; *the borrower/tenant portals* promise availability to people who aren't your customers; *background intelligence* (enrichment, deltas) promises eventual freshness with honest staleness display. Write the four classes down with targets (e.g., send-lane dispatch success ≥99.9% with zero compliance-gate bypasses ever; doors P95 < 1.5s; portal uptime 99.9%; intelligence freshness honestly chipped — which Part 1 §2.3/2.5 already builds). SLOs are the polish-vs-feature referee the roadmap currently lacks: when an error budget is burning, Phase work pauses. 
2. **Synthetic journeys as canaries.** The nine-persona sign-off lens (Wave R) becomes automation: a scheduled synthetic org per core vertical walks its signature loop (create lead → draft offer → witnessed send to a sink; log payment; move deal) against production every N minutes, asserting both success *and* honesty affordances (the UnknownValue renders, the provenance chip exists). This is the outside-in sensor the step-away verdict needs (F-18-2's external watchdogs are the transport; the journeys are the content), and it converts "the app is up" into "the *product* works."
3. **A public status page that only tells the truth.** Fed by the canaries and the SLO ledger, with incident history and the same voice as `/transparency`. Ties directly to Part 4 §3's provable-claims layer — reliability becomes marketing evidence, and the page's existence forces the internal sensors to stay honest (you can't publish what you don't measure).

## 3. Evidence-grade resilience

1. **Close the pager matrix (prereq F-13-1, then doctrine).** After critical-job-failure pages land, encode the full severity map as data: every `JOB_ROSTER` entry declares `onFailure: page | queue | tray` and the ratchet asserts no `critical: true` job maps below `page`. The dispatcher's class system already exists; this makes its coverage total and reviewable in one file.
2. **DR as a drilled muscle, not a hope.** Execute the first full restore (F-13-2), publish the RTO number on the status page, then put the drill on a **quarterly cadence with a freshness ratchet** (`dr_drills.ran_at` > 90d fails CI's ops lane) and give `backup_verified` its reader (F-13-3) on the founder ops panel. The standard the audit itself set — "a hope and a credit card" — flips to "a number and a receipt."
3. **The Ops Calendar as a table, not prose.** Generalize F-18-1's fix beyond vendor keys: one `dated_obligations` registry — vendor renewals/trials, data-license re-reviews (the Beatrice cadence), insurance renewal, domain/TLS/DKIM expiries, 1099 season, statute-register review dates, DR-drill due dates, backup-retention audits — each `{what, due, sole-source?, T-14/T-7/T-2 pages, owner}`. It feeds three places: the founder's Today, the step-away verdict (an absence window overlapping any T-14 horizon blocks "all clear"), and a founder-panel year view. Every future vendor or compliance date lands here *at integration time* — a lint on the connector/provider registries requires an obligations row for anything with a renewal. This single table is the structural end of the "known date, zero warning" class.
4. **Runbooks that can't rot.** The audit found a runbook pointing at a nonexistent drill. Add a docs link-check lint over `docs/runbooks/` (paths must resolve; claims of drills must cite a ledger row), and promote the top five runbooks (restore, send-lane outage, provider lapse, key rotation, pager-down) to *verified* status: each has a last-walked date in the drill ledger. A 2 a.m. founder follows only pointers that CI has followed first.

## 4. Support as a system

The pieces exist — Pax support resolver, help/learn content, Intercom connector, support load already weighted in the churn score — but they're not yet a loop. The loop: **Deflect → Resolve → Escalate → Learn → Close.**

1. **Deflect honestly.** In-product Pax support answers only from grounded sources (help content, the org's own state, the changelog) under the same refuse-not-fabricate rules as everything else — "I don't know, here's the human path" beats a confident wrong answer in a support context more than anywhere. Prereq: `supportAgent`/`paxSupportResolver` are two of the six direct-completions offenders (F-16-1's lint baseline) — fold them under the router first so support can't be the margin leak.
2. **Severity SLAs into the founder queue.** Support items classify (broken-money/send P0 → page; blocked-workflow P1 → same-day; question P2 → 48h) and land in the founder's Today with the SLA clock visible — the customer-facing mirror of the pager matrix. Publish the response targets on the status page; a solo founder who *publishes* SLAs and hits them via triage beats a ten-person team that doesn't.
3. **Every resolution compounds.** Closing a ticket offers three one-taps: → KB article draft (Pax, founder-approved), → findings-ledger entry if it revealed a defect class, → changelog line. Support becomes the cheapest product-research channel you have, with receipts.
4. **Close the loop with the customer.** When a fix ships for something a specific org reported, the changelog entry pings them ("you hit this on the 12th — it's fixed"). Retention math aside, it's the trust behavior of the whole platform applied to its own mistakes.

## 5. Cost & margin operations

Prereqs first: router totality + the `.chat.completions.create` allowlist lint (F-16-1/2) so *all* AI spend is visible to the ceilings and telemetry. Then the doctrine layer:

1. **Unit-economics receipts.** A monthly per-org COGS statement (AI by surface, provider credits, comms, storage) against plan price, rolled into the founder Letter with the ≥70% margin gate as the tripwire — the same receipts discipline customers get, applied to your own margins. The `ai_telemetry_events` + provider metering + `marketingSpend` ledgers already hold the inputs; this is a report, not a system.
2. **Cost envelopes per surface with self-pause.** Part 2's P-5 (per-surface budgets) inherits the existing fail-closed pattern: a surface that blows its envelope degrades gracefully (queues, downgrades tier) and files a finding — never silently spends. The stop-loss family (`outreachStopLoss`, `aiCostCeiling`, `capitalTracker`) is the proven shape; extend it to the map-tile serving and canary costs as those ship (Part 1 M0's PMTiles bet is also a *cost* bet — put its curve on the same panel).
3. **The infra curve, watched.** One founder-panel chart: Fly + storage + egress + AI + providers per month, absolute and per-org, with the two planned inflections annotated (county-fabric tiling; canary fleet). Boring, and the difference between discovering a margin problem in a spreadsheet versus in a bank statement.

## 6. Continuity — the vacation test

The step-away machine is the right invention; finish its blind spots and then make continuity a drilled claim like DR:

1. **Verdict totality (prereqs F-18-1/2):** vendor-expiry countdowns and external-watchdog armament join the eight checks — "every system armed" becomes unable to be true while a sole-source key lapses mid-absence or the outside-in probes are dormant.
2. **The deputy path.** A sealed break-glass kit (documented access for one trusted person: hosting, DNS, Stripe, the pager) with a freshness ratchet on its last-reviewed date, and a customer-facing continuity statement on `/transparency`: exports always live (Part 3's no-lock-in promise doing double duty), rails BYO (their Twilio/Stripe/mailbox keep working regardless of AcreOS), and the deputy arrangement acknowledged in the abstract. For a solo-founder platform, *"what happens if you get hit by a bus"* is a sales objection; answer it before it's asked.
3. **Run the vacation test as a drill.** One deliberate 7-day hands-off window (real or simulated): autopilot runs signup/onboarding/support-deflection/collections-of-receipts; hard-stops hold; the ledger records what queued for return. Publish the result internally like the DR drill — RTO for the database, "RFO" (return-from-founder) for the company. The August absence window that F-18-1 flagged is, once its prereqs land, the natural first run.

---

## 7. Sequencing & exit tests

**Ops-A (with the audit's Ten):** F-13-1 pager routing · F-18-1 expiry registry seeded (ATTOM row) · F-18-2 watchdogs armed · F-16-1/2 router totality + completions lint.
**Ops-B:** `dated_obligations` generalized + step-away integration · first DR drill executed, RTO published · runbook link-lint · pager-matrix-as-data ratchet.
**Ops-C:** SLO declarations + canary journeys for the three wedge verticals · status page live · support SLAs published + queue wiring.
**Ops-D:** unit-economics receipt in the Letter · cost envelopes with self-pause on remaining surfaces · quarterly drill cadence ratchets (DR, break-glass review, vacation test annually).

**Exit tests:** a critical job forced to fail pages a phone in <5 minutes · the newest `dr_drills` row is <90 days old and the status page shows its RTO · no dated obligation exists without a countdown, and the step-away verdict refuses an absence overlapping one · a stranger's support message gets a grounded answer or a human SLA, never a confident fabrication · the monthly Letter states per-org margin from ledgers, not estimates · and the vacation test completes with zero customer-visible degradation — the machine ran the company, within the hard-stops, with receipts.

**Part 5's single sentence:** operations become the fifth provable claim — the company that can show you its restore time, its pager matrix, its margins, and its founder-absence drill is the company a customer can safely build a business on.

═══════════════════════════════════════════════════════════════════════════════
# AcreOS Depth Audit — Part 6: The Founder Machine

*The capstone — corrected to the founder's framing: **AcreOS stands alone.** It shares nothing with any other application, and it is operated by one person from inside its own founder backend. Part 6 therefore audits that backend as what it actually is: the second product inside the repo — the cockpit, governance layer, autonomous company-loop, AI colleagues, and build process through which one founder runs the entire business. Same method as Parts 1–5: what exists, honest grade, the path — with the standing rule that everything here remains AcreOS-internal.*

*Evidence this pass: `client/src/pages/founder/` (49 pages + `admin/ customers/ growth/ inspector/ studio/` subdirs), `server/services/autopilot/` (~100 services — the full company loop), `server/services/founder-chat/` (Atlas: agentic loop, sub-agents, tool registry, per-entity org assertion), `server/services/founder/` (life cockpit, tax engine/package/rules, vault encryption, readiness ladder), `shared/governance/` (constitution + statute register), `scripts/ratchets/` (11 families), plus the wave-discipline sections of `CLAUDE.md` and the founder decisions/ledger docs read in earlier parts.*

---

## 1. State of the machine

The autopilot directory is the most remarkable thing in the repository. It is not "automation" — it is a structured company loop with named organs: **perceive** (`senses`, `perception`, `worldModel`, `funnelHealth`, search-console sense) → **deliberate** (`deliberate`, `council`, `reasoning`, `simulate`, `contextualForecast`, `worstDay`) → **decide** (`decide`, `policyGate`, `learnedPolicy`, `domainLadders`, `riskautonomy`, `standingOrders`) → **act** (`act`, `hands/`, `dealActions`, `growthEngine`, marketing channels, publish governor) → **verify & protect** (`hardStops`, `panicStop`, `immuneSystem`/`immuneResponse`, `claimsGate`, `codeChangeGate`, `senseWatchdog`, `safety`) → **learn** (`decisionEval`, `shadowRegret`, `efficacy`, `experienceLog`, `policyInducer`, `learnedGates`) → **account** (`narrate`, `boardReport`, `proofReceipt` + store, event log). There is a witnessed-grant system for the founder mirroring the customer-side pending-actions kernel, a budget ramp with cognition budgets, an escalation ladder, guided resume after pauses, and — handled with appropriate ceremony — a **self-patch GitOps pipeline gated by `codeChangeGate`** (the machine can propose changes to its own code through a gate, with tests present in-tree).

Grade the same way every part has: **top-percentile primitives; consolidation and closure are the remaining work.** Two symptoms: the cockpit sprawls (49 founder pages plus five subdirectories against the declared four-door target of Letter · Decisions · Controls · Story — `cockpit`, `command`, `bridge`, `home`, `feed`, and `studio` are six different "main screens" from different eras), and the founder's decision inputs arrive through at least seven separate surfaces (agent queue, pending hands, witness grants, promotion requests, appeals, feedback inbox, dispatches). The machine's organs are built; the *chair* the founder sits in needs the same one-grammar treatment the customer product got.

---

## 2. Finish the four doors — the cockpit consolidation

Apply the Settings playbook (Part 2 §1) to `/founder/*`, with the ratchet that already exists doing the enforcement:

**Letter** absorbs `home`, `feed`, `boardReport`/`narrate` outputs, and the weekly sections accumulated across this series (growth §P4, margins §P5, ops calendar horizon, decisions-vs-outcomes §3 below). One daily/weekly read, every number receipt-linked. **Decisions** absorbs the seven decision inflows into one queue (§3). **Controls** absorbs `autopilot-control`, `keys`, `recovery-console`, `readiness`, panic stop, budget ramps, witness grants, standing orders — the levers, rendered as Part 2's status-row grammar (state sentence first, control second). **Story** absorbs `autopilot-story`, `event-log`, `pax-traces`, proof receipts, the drill ledgers — the append-only narrative of what the machine did and why, searchable. Everything else — `inspector`, `studio`, `scenarios`, `paid-data-eval`, `all-tools`, `cost-optimizer` — is a *tool*, and tools live under `/founder/admin/` reachable by palette, not by door. Migration mechanics identical to Settings: routed sections, redirects for every legacy path, the existing founder-route ratchet driven to its target count, and — because the founder is the heaviest daily user in the company — full keyboard treatment: `j/k/e/enter` on the queue, palette verbs for every Control, `?` overlay per door. The founder's minutes are the scarcest resource in the company; the cockpit should be the fastest UI in the product, not the leftover one.

---

## 3. One decision queue (the Decisions door as a product)

Everything that requires the founder converges into a single ranked queue with the same grammar customers get on Today: autopilot pending hands and witness-grant requests, promotion requests, appeals, support P1s (Part 5 §4), save-offer approvals (Part 4 §6), standing-instruction changes, spend-over-threshold asks, and the dated-obligation countdowns (Part 5 §3). Each item carries: what the machine wants, why (its deliberation summary), the policy that routed it here, cost/risk read, and a default. Founder actions: approve · edit-then-approve · decline-with-reason · delegate-to-standing-order (turning a recurring approval into policy is the ladder-climbing gesture). Every disposition writes a proof receipt **with the founder's reason captured in one line** — that reason is the training signal `policyInducer`/`learnedPolicy` exist to consume, and it's currently the loosest link in the learning loop. Then close the loop on the human side too: `decisionEval` + `shadowRegret` already score outcomes — surface a monthly *decisions-vs-outcomes* section in the Letter ("you overrode the machine 9 times; 6 aged well, 3 didn't; the machine's counterfactual on the 3: …"). The autopilot has calibration machinery; the founder deserves the same mirror.

---

## 4. The founder-side autonomy ladder — and the two eternal lines

The domain ladders, action ladder, risk-autonomy, and standing orders are the founder-side mirror of the customer L0–L4 (Part 2 §9.2); formalize them identically: **one `policyGate` resolution at the act chokepoint** (the code is already shaped this way — make totality a test, as with customer P-1), graduation by receipts (`efficacy` + proof-receipt streaks), and demotion on reversal patterns, automatically. Two lines get named as eternal, alongside the existing hard-stops (pricing, legal signing, spend >$500, customer-data deletion):

1. **Self-patch never merges itself.** The GitOps pipeline is a legitimate accelerant *as a proposer* — machine-opened PRs with the full gate battery. The human-merge requirement on it is the founder machine's equivalent of the money-custody rule and deserves the same treatment: a constitutional entry plus a ratchet asserting the pipeline cannot reach a merge credential. A company loop that can rewrite its own gates is the one failure mode with no undo.
2. **The immune system protects the gates, not just the app.** `immuneSystem`/`gateWatcher`/`senseWatchdog` should treat *gate weakening* (a ratchet baseline loosened, a hard-stop edited, a policy floor lowered) as a page-severity event — the machine noticing someone (including the machine) moving its own fences. Cheap to add; category-of-one to have.

And schedule the machine's own drills into Part 5's cadence: `worstDay` simulations and a panic-stop/guided-resume exercise become quarterly game-days with Story-door receipts, exactly like DR.

---

## 5. Atlas and Solene — the two colleagues, one standard

Atlas (founder-chat: agentic loop, sub-agents, per-entity org assertion, the untrusted-data doctrine already unified via the shared envelope) is the operating analyst; Solene (build chat + agent queue + `build.tsx`) is the engineering department. Both get the exact hygiene Pax got in Part 2: tool-registry dedupe and per-context capability scoping (P-3), router totality with telemetry and cost envelopes — founder-side spend on the founder's own key still wants the meter (F-16's lint allowlist should end at the router, not at "founder surfaces are trusted") — and guard parity: the founder deserves refuse-not-fabricate *most of all*, because his acceptances become company actions within minutes. One asymmetry is correct and should be explicit: founder agents get broader capability grants than customer Pax ever will, but identical honesty machinery and identical envelope discipline on everything they read. Colleagues with more authority, never looser epistemics.

---

## 6. The build machine — how AcreOS gets made, as a system

The development process is itself one of the repo's inventions: audit → brief → wave → independent completeness-audit, the findings and deletion ledgers, eleven ratchet families, the nine-lens sign-off, CLAUDE.md's hunt-the-built-but-unwired doctrine. Three refinements close it:

1. **Standardize the brief.** Every section of this six-part series was written to lift into a wave brief (context · files · exit test); make that the literal template `build.tsx`/Solene consumes, with the exit test required up front — a wave without a falsifiable exit test doesn't start. The completeness audit then verifies the exit test, not vibes.
2. **Unify the ledgers.** Findings, deletions, decisions, drills, obligations, proof receipts are today separate stores with separate readers. One governance store (append-only, typed rows) with the Story door as its single reader turns "what happened and why" into one query — and makes the audit-every-August tradition mostly a report over data.
3. **Ratchet-coverage as a metric.** The series' whole method has been prose→construction. Apply it reflexively: a report of which constitutional/doctrinal lines have an enforcing test versus prose only (money ✓, send lanes ✓, provider roles → Part 3 §5, marketing claims → Part 4 §7, pager matrix → Part 5, self-patch → §4 above…), with the number driven up in the Letter like any KPI. When that report is green, the company's rules are code all the way down.

---

## 7. The founder as part of the machine

The backend already treats the founder's own life as in-scope — `lifeCockpit`, an estimated-tax engine with rules and packages, vault encryption — which is the right call for a standalone one-person company *if* two disciplines hold: the company/personal boundary stays entity-clean (Part 3 §4.6 — the tax engine's outputs are advice-shaped and should carry the same `RequiredDisclaimer` treatment as customer-facing estimates; it is pointed at the one user who will act on it fastest), and the founder's attention gets the same architecture as everything else: the queue with batch windows *is* the interrupt policy, the Letter *is* the status meeting, and maker time is what the machine exists to protect. The step-away verdict (Part 5 §6) extends naturally to a gentler daily question the machine can already answer: *what actually needs you today?* — and the honest answer, on a good day, should be "the queue, twenty minutes, and nothing else."

---

## 8. Exit tests — and the series, closed

**Part 6 exits:** the founder route count equals the four doors + `/admin/*` with the legacy ratchet at zero · one decision queue with SLA clocks, receipts, and reasons captured on 100% of dispositions · the self-patch human-merge line and gate-tamper paging both exist as ratchets · Atlas/Solene fully behind the router with telemetry and the envelope · a governance store the Story door reads whole · the quarterly game-day ledger has its first row · and the Letter, in one sitting, reconciles company, customers, margins, ops, and the founder's own week — every number a link.

**The series (for handoff):**
**P1** Surfaces — every door, vertical, and the map, to best-in-class. **P2** The operating system — Settings IA, collaboration, inboxes, deal engine, acquisition, negotiation, Pax as an AI system, connectors/MCP, the agency layer. **P3** Rails, not provider — the liability architecture and the provider-role register. **P4** The revenue engine — positioning, proof, activation, retention, the honest-claims machine. **P5** The operations layer — reliability contract, drilled resilience, support loop, unit economics, continuity. **P6** The founder machine — the cockpit, the decision system, the autonomy ladders, the colleagues, the build process. One company, standalone, run by one person and a machine that shows its receipts — with every part written to become the next wave's briefs.

═══════════════════════════════════════════════════════════════════════════════

## §I. Addendum D — Wave L (Legal Documents & Disclosure Surface)

*Added 2026-08-10. Slots into the Master Handoff as **Wave L**, a parallel track that may start immediately — it has no dependency on Wave 0, though L4.2 (mail-lane disclosure) should land alongside Wave 0's item 0.8. Source analysis: `acreos-legal-review.md` (structural review of terms-of-service.md v1.0, privacy-policy.md, data-processing-agreement.md, terms.tsx, privacy.tsx). Read that review before executing; it carries the reasoning behind every item here.*

---

## L.0 Standing rules for this wave (read first)

1. **This wave produces a better *draft*, not legal sign-off.** Nothing in it substitutes for review by a licensed attorney. Every document must retain a visible status footer until counsel review occurs, and the current honest footer — *"Not yet reviewed by outside counsel. Counsel review required before public deployment."* — stays until it is no longer true.
2. **Accuracy over armor.** The goal is documents that *describe the product truthfully* and state the roles the architecture actually implements. Do not write maximally protective-sounding prose; over-broad clauses can be less defensible than modest ones, and false confidence is the failure mode this wave exists to prevent. Where a drafting choice has a real trade-off, do not resolve it — record it in the counsel packet (L6).
3. **Refuse-not-fabricate applies to law.** Do not invent statutory citations, assert enforceability, or state that a clause "protects" against something. Cite only statutes already cited in the existing documents or verifiable against primary sources; anything else goes to the counsel packet as a question.
4. **Entity status stays honest.** AcreOS is a Massachusetts sole proprietorship until the LLC is formed. Do not soften, hedge, or omit that. The §19 assignment mechanism already handles continuity.
5. **No effective-date backdating.** Any material change gets a new version, a new effective date, the §16 notice path, and a version-history entry.

---

## L.1 Truth-alignment pass (highest priority — do first)

**L.1.1 Rewrite ToS §6 "Free Trial" to describe the actual product.** Current text asserts an automatic charge at trial end. Verified product behavior: `pricing.tsx` + `TIER_LIMITS` ship a permanent free tier (free / starter / pro / scale) with caps on leads, properties, notes, AI requests, sequences, seats, and credit pool, plus a 5-letter lifetime wedge send; `server/middleware/getOrCreateOrg.ts` stamps `trialEndsAt` seven days out; `expensiveEndpointGuard.ts` reads it to grant elevated limits during the window. No charge occurs; accounts settle onto free-tier limits. Rewrite the section to describe: the permanent free tier, the new-account elevated-limits window, expiry *to the free tier* with no charge and no card required, and what happens to data above free-tier caps at expiry (verify this in code before writing it — if over-cap records are retained but read-only, say so; if nothing happens, say that). Retitle the section accordingly.

**L.1.2 Re-verify every other factual assertion in all three documents against HEAD.** Treat each as a claim needing a source: named subprocessors in ToS §18 and Privacy §8 (reconcile against the live subprocessor endpoint and the vendor inventory — flag any vendor listed but unused, or used but unlisted), retention periods in Privacy §6 against actual retention jobs, the 7-day deletion commitment in Privacy §7 against the right-to-erasure implementation, breach-notification timelines in Privacy §11 against any documented runbook, DPA Article 5 security measures against what is actually implemented, and the ToS §17 E-SIGN assertion against the real consent flow. Produce a divergence list; fix the document where the product is right, and file a findings-ledger entry where the *product* is the thing that needs to change.

**L.1.3 Fill the §20 placeholder problem.** Remove `[To be confirmed upon LLC formation]` from published output. Until an entity and registered-agent address exist, publish a real business contact address that is not a home address (a mailbox service address is the common approach) or omit the line entirely rather than shipping a bracketed TODO. Note the same address is needed for CAN-SPAM footers on AcreOS's own marketing email — wire one constant, used in both places.

**L.1.4 Align ToS §9 with the Privacy Policy's narrower training promise.** §9 currently licenses customer data "to provide and improve the Service." Privacy §3 is stricter and better: internal training only on aggregated, de-identified data, and no use of lead/contact or customer business data to train models benefiting other customers without explicit consent. Narrow §9 to match. This also aligns the paper with Part 2's P-7 commitment.

## L.2 New ToS sections (free protection, currently absent)

**L.2.1 Roles and Responsibilities.** The paper mirror of Part 3's architecture. Establish that for all activity conducted through the Service the Customer is the **merchant of record** for their payment processing, the **sender of record** for counterparty email, SMS, and physical mail, the **licensee of record** for third-party data accessed via their credentials, and the **signer and decision-maker of record** for documents and transactions — and that AcreOS supplies software executing the Customer's instructions through accounts the Customer owns and controls. Where AcreOS provides a platform-keyed convenience lane (the registered wedge mail exception), say so plainly and state the Customer remains responsible for the content of anything sent on their behalf. Cross-reference the §12 indemnity so the two work together.

**L.2.2 Customer-Connected Services (BYO credentials).** Customer represents they hold valid accounts and have authority to connect them; authorizes AcreOS to act within granted scopes; remains bound by each provider's own terms (name the categories: telephony/10DLC registration, print-mail content policies, data-vendor license and permissible-use restrictions, payment processor terms); is responsible for their own sender reputation and regulatory registrations; and understands that disconnection or credential expiry stops the dependent functionality.

**L.2.3 Automated Actions and Standing Instructions.** Required before any autonomy level above draft ships. Establish that the Customer's configured autonomy policy constitutes their standing instruction; that actions taken within it are the Customer's actions taken through the Service; that the Customer is responsible for reviewing their configuration and the action ledger; that the policy is revocable at any time; and that AcreOS's compliance gates (consent, quiet hours, suppression) constrain but do not replace the Customer's responsibility for their own outreach. Pair with the consent-artifact implementation in Part 3 §2.10.

**L.2.4 Mechanics currently missing.** Add: a gross-negligence / willful-misconduct / fraud carve-out to §11 (flag the trade-off in the counsel packet rather than deciding it); indemnification procedure in §12 (prompt notice, control of defense, cooperation, consent to settle); a feedback license; publicity and testimonial consent (needed for Part 4's case receipts); an accessibility statement with a contact path; and an export-control/sanctions representation.

## L.3 New document: Beta / Early Access Addendum

A short standalone addendum applying to pre-GA participants, accepted separately at cohort onboarding and version-tracked like the main terms. Cover: pre-release status and expected defects; no availability, support, or response-time commitment; features may change or be withdrawn; **no reliance for time-sensitive or legally consequential deadlines** (this is the redemption-clock class of risk — state it explicitly); export your data regularly; feedback licensed to AcreOS; participation may end at any time by either party; and the addendum's relationship to the main ToS (supplements, and controls where it conflicts, for the beta period only). Keep it short and readable — one screen. Wire acceptance into the same capture mechanism as L.5.2.

## L.4 The disclosure surface sweep (beyond the three documents)

Disclosures live in the product, not only in `/terms`. Inventory and bring each to the same standard:

1. **`RequiredDisclaimer` coverage.** Seven typed disclaimers exist (financial · legal · ai · valuation · score · document · worksheet). Build the output-class → disclaimer-type map, baseline current coverage, and ratchet to zero gaps — any surface rendering an AVM or comp mounts `valuation`; any generated instrument mounts `document`. (This is Part 3 §5.3; execute it here.)
2. **Send-lane disclosures.** CAN-SPAM footer with a real physical address on AcreOS's own marketing email; the customer-identity footer on counterparty mail; and, for the platform-keyed wedge lane, whatever attribution the mail vendor's content policy requires. Coordinate with Wave 0 item 0.8.
3. **Consent capture points.** SMS/TCPA consent language at every lead-capture surface; the skip-trace permissible-use attestation surfaced to the customer at first use (Part 3 §2.5); the E-SIGN consent flow (verify against §17's claim); cookie/tracking disclosure against actual analytics behavior.
4. **Checkout disclosure.** Auto-renewal terms shown clearly *before* purchase, with the cancellation path visible — terms-page language alone is generally not the mechanism regulators look at. Flag the UI for counsel review in the packet.
5. **Beta badging.** Verify the badge actually renders on every `businessTypeOnly` surface for beta verticals, in-product and on any marketing page (Part 1 §5).
6. **Statute-bearing surfaces.** Until Addendum B verification completes, any surface computing a legally consequential date or amount (redemption windows, late-fee caps, disclosure deadlines) renders informational-only with a verify-with-your-county/counsel affordance, and its dependent automation stays gated off.

## L.5 Drift prevention (so this never happens again)

**L.5.1 One source of truth.** `terms.tsx` (637 lines) and `privacy.tsx` (881 lines) are hand-maintained mirrors of the markdown — the mechanism that produced the §6 divergence. Generate the rendered pages from the markdown at build time, or invert it; either way, one artifact is authoritative and the other is derived. Keep `LegalDocReadAloud` and `terms-history` working against whichever wins.

**L.5.2 Acceptance capture.** Record version identifier + content hash + timestamp at each acceptance (main terms, beta addendum, DPA if executed, standing instructions). This is the evidence layer that makes the version-history page meaningful.

**L.5.3 The drift ratchet.** A test asserting the rendered pages match the source documents, and a checklist gate requiring a legal-review entry whenever a new send lane, autonomy tier, data source, subprocessor, or pricing mechanic ships. Add it to the ratchet-coverage report (Part 6 §6.3).

## L.6 The counsel packet

Generate `docs/legal/counsel-review-packet.md`: the current documents, a plain-language summary of what changed in this wave and why, the seven open questions from the review (§11 cap structure, MA choice-of-law and Ch. 93A, arbitration economics and mass-arbitration exposure, MA 201 CMR 17.00 / WISP obligation, auto-renewal disclosure at point of sale, DPA incorporation, E-SIGN §101(c) assertion), plus any trade-offs deferred under rule L.0.2 and any product divergences found in L.1.2. Purpose: make the eventual review fast and cheap by handing counsel a prepared file rather than a pile of documents.

---

## Exit tests

- Zero placeholders, TODOs, or bracketed text in any published legal document.
- Every factual assertion in the three documents traces to verified product behavior or a primary source; divergences are either fixed or filed as findings.
- ToS §6 describes the free tier and elevated-limits window as implemented; a fresh account's day-8 experience matches the text exactly.
- Roles and Responsibilities, Customer-Connected Services, and Automated Actions sections exist; no autonomy level above draft is reachable without L.2.3 in force.
- Beta addendum exists, is accepted separately, and its acceptance is captured with version + hash.
- Disclaimer-coverage ratchet baselined at zero gaps; the drift test passes; a deliberate edit to the markdown fails CI until the rendered page follows.
- `counsel-review-packet.md` exists and is current.
- Status footers still say counsel review is required — because it still is.

## What NOT to do

Do not remove the sole-proprietorship disclosure. Do not assert enforceability, "compliance," or protection anywhere in the documents or the commit messages. Do not add clauses copied from another company's terms without checking they describe *this* product. Do not delete the counsel-required footer. Do not resolve any item in the counsel packet unilaterally — the packet is the deliverable, not the answer.

═══════════════════════════════════════════════════════════════════════════════

## §J. Addendum E — Wave R (Responsibility Hardening)

*Added 2026-08-10. Combines the **Customer-Responsibility Audit** (attestation gaps and platform-voice findings) with a **correction to Part 3 §2.4** (the mail-lane finding was wrong; the real defect is different and smaller). Slots into the Master Handoff as **Wave R**, parallel-eligible, with R.1 sharing Wave 0's priority because it gates safe public signup. Companion documents: `acreos-customer-responsibility-audit.md`, `acreos-depth-audit-part3.md`.*

---

## R.0 Correction of record — Part 3 §2.4 was wrong

**What Part 3 claimed:** that `lobService.ts` resolves a platform `LOB_API_KEY` with no BYO/org-credential path wired, making AcreOS the mail vendor's customer of record for every counterparty letter, and that a BYO path needed to be built.

**What is actually true, verified at HEAD:** the BYO architecture **is built and is correct.** `server/services/mailProvider.ts` implements `getOrgMailCredentials(organizationId)`, which reads an org-scoped, `isEnabled` Lob integration from `organization_integrations` and uses the customer's own key first. `getDefaultCredentials()` is a *fallback only*, and it is wrapped in the live-send interlock (`mail/liveSendInterlock.ts`) so the platform key resolves to test mode unless production is explicitly armed. This matches the email and SMS pattern and reflects the founder's stated design intent: **customers connect their own Lob account.**

**The actual defect — narrower, and a different class:** there are **three parallel mail code paths, and only one implements the BYO resolution.**

| Path | Key resolution | Called by |
|---|---|---|
| `services/mailProvider.ts` | **Correct** — org key first, interlocked platform fallback | `autopilot/hands/send-letter.ts`, `routes-organization.ts`, `routes-billing.ts` |
| `services/lobService.ts` | `process.env` only, in the constructor — **no organization parameter exists anywhere in the class** | `services/communications.ts`, `services/healthCheck.ts` |
| `services/directMail.ts` | `process.env.LOB_API_KEY` directly (line 92) | `services/communications.ts`, and others |

So a customer's own key is used when a send routes through `mailProvider`, and silently is not when it routes through the other two. This is the **service-sprawl defect class** the August audit identified in slice 04 — intent implemented in one place while sibling paths route around it — and it is arguably more dangerous than a missing feature, because the architecture reads as BYO-only when read at `mailProvider`.

**Therefore:** the Part 3 §2.4 remediation is superseded. Do **not** build a new BYO path. Consolidate onto the one that already exists (R.1). All other Part 3 §2.4 sub-items (purpose lanes, wedge caps, prohibited-content lint on platform-keyed sends) remain valid and attach to the consolidated path. Record this correction in the findings ledger with a pointer to this addendum so the superseded text is not executed from the Part 3 body.

## R.1 Mail-path consolidation (do at Wave 0 priority — it gates safe public signup)

1. **Make `mailProvider.ts` the single door to any mail vendor.** Refactor `lobService.ts` and `directMail.ts` to call through it, or retire them under the deletion-ledger process if their remaining callers can be migrated outright. Every send path must carry an `organizationId` — a mail function that cannot name the org it is sending for is the bug.
2. **Audit `communications.ts` specifically.** It calls both non-compliant paths and is the most likely live bypass. Trace every mail-sending route from the campaign and outreach surfaces to whichever path they actually reach, and record the map in the brief.
3. **Grep ratchet:** zero references to `LOB_API_KEY`, `LOB_LIVE_API_KEY`, or `LOB_TEST_API_KEY` outside `mailProvider.ts` and its platform-key resolver. Permitted exceptions, allowlisted explicitly: `addressValidation.ts` (address verification is a platform utility, not sending under a customer's name), `healthCheck.ts`, `credentialLivenessDetector.ts`, and setup/validation routes.
4. **Refuse, don't fall back, for counterparty mail.** With consolidation done, an org without a connected Lob integration cannot send counterparty mail — it refuses with a connect-your-account affordance, exactly as SMS does today. The platform key remains reachable **only** for the registered wedge exception and system mail, under the existing interlock.
5. **Wedge lane discipline** (from Part 3, still valid): per-org lifetime cap enforced server-side, recipient-address dedupe across all orgs on the platform lane, prohibited-content lint on templates, and founder approval before any platform-lane piece ships while the entity is unformed.
6. **Exit test:** a fresh org with no Lob integration attempts a counterparty send through every reachable surface (campaign, outreach, autopilot hand, Pax action, bulk blast) and is refused in all of them with the connect affordance; the grep ratchet passes; a wedge send exhausts at the cap and refuses the next.

## R.2 The Attestation Gate primitive

Three strong patterns exist independently — `AtrGate.tsx` (eight Reg-Z factors or an exemption code, with a **database CHECK constraint** backstopping the gate at the data layer), `AssignmentPanel`'s two-tier acknowledgment (hard block on failures, explicit "I understand — create the draft anyway" on warnings), and `EsignConsentDialog`. Extract them as one primitive.

**Shape:** `{ gateId, what the customer affirms, the exact language shown, what it unlocks, where the record is stored, optional DB-level backstop constraint }`, plus an `attestations` table capturing org, user, gate, version of the language shown, timestamp, and payload. **The ATR gate's CHECK constraint is the model** — where feasible, the gated action must be *structurally* unreachable without its attestation row, not merely UI-blocked. Ratchet: a test asserting each registered gate's action cannot execute without a matching attestation row.

## R.3 Apply the gate where the responsibility trace currently breaks

Ordered by value:

1. **CSV import rights attestation — highest priority.** `data-import.tsx` accepts up to 50K rows of leads, properties, deals, and notes, plus communications history and document ZIPs, with **no attestation that the customer has the right to use the data.** This is the highest-volume path by which third-party personal information enters the platform. Add the gate: the customer affirms they have the lawful right to use and process this data, that its use complies with their own obligations, and that they are its controller. Store with the import job. Pair with a suppression-list prompt on first import. *(This, with R.1, is what makes anonymous public signup safe.)*
2. **Skip-trace permissible-use attestation.** Surface the vendor's own permissible-use language at first use; capture the customer's attestation so the use-purpose representation is theirs.
3. **Document adoption.** Any generated instrument (purchase agreements, assignments, letters, notices) gets a uniform review-and-adopt step before it can be sent or signed — the customer sees final text and affirms it. `AssignmentPanel` already does this; generalize. Natural home for the `document` disclaimer type from the coverage ratchet.
4. **Autonomy grant.** Each graduation above draft mints a standing-instruction consent artifact (scope, thresholds, channels, effective date, policy JSON), revocable in one tap, with every autonomous action pointing at the artifact that authorized it. Depends on Wave 0's `resolveActionPolicy` (P-1) — an autonomy promise the kernel doesn't enforce makes the record of *who decided* unreliable.
5. **Dunning arming.** `dunning_sequences.autoStart` defaults to **true** in `shared/schema.ts` — debt-collection-adjacent contact with a consumer beginning by schema default rather than customer decision. Flip the default to false, require an explicit arm behind a gate showing the exact ladder, timing, and channels before it can run. Audit sibling defaults in the same sweep; `pre_authorized_tradeoffs.autoExecute` (founder-side crisis handling) is defensible but should be a *named* pre-authorization rather than an implicit default.
6. **Bulk-send friction.** For outbound or destructive bulk operations above a threshold: show the count, the suppression math ("1,240 selected → 1,102 sendable: 96 DNC, 31 in pipeline, 11 cooldown"), and require typed confirmation.

## R.4 Platform voice — confident, but never bare

**Founder ruling (2026-08-10):** the product keeps its confident voice. Do **not** relabel recommendations into neutral calculator language — an intelligent system that shows its reasoning is the differentiator; a system that reports figures without judgment is a spreadsheet. The earlier draft of this section proposed stripping "Recommended offer"; that is superseded.

The rule instead: **no bare recommendation.** A number carrying the platform's endorsement must always ship with three things attached.

1. **A visible basis line** — always rendered, not hidden behind a tooltip. Names the actual inputs ("Based on 6 comps within 2 miles, county assessed value, and your 55% target"), with full methodology on tap. Where an input is missing or fell back (the USDA-fallback case), the basis line says so.
2. **A mounted disclaimer** — once per step or panel, not per field. `RequiredDisclaimer` already carries `valuation` and `financial` types; this is mounting, not building. Language in the honest register: an AI estimate from available data, not an appraisal, the customer's decision.
3. **Preserved authorship** — the field stays editable, defaults to the suggestion, and the *customer's* number is what actually sends. This is what makes the customer the author regardless of the label, and it is the load-bearing mechanic of the three.

Apply to `blind-offer-wizard.tsx` (~line 945, "Recommended offer") first, then sweep every surface that recommends, scores, or values — AVM displays, lead scores, comp analysis, lot pricing, ARV calculator, yield and payoff figures. The lint to add is **not** a banned-word list; it is a coverage check in the spirit of the disclaimer ratchet: any component rendering a recommendation-class or valuation-class figure must render a basis element and mount its disclaimer type. Bare numbers fail; confident numbers with visible reasoning pass.

**For the counsel packet (L.6):** ToS §3 states Pax offers "suggestions and drafts that you review" and never "direct advice on financial decisions," while the UI labels a figure "Recommended offer." Flag this wording tension for counsel review — likely resolvable by the basis line and disclaimer, but it is a question to ask rather than an assumption to make.

## R.5 Statute-bearing surfaces and actor attribution

- **Statute-derived values stay informational until verified.** Redemption windows, late-fee caps, and disclosure deadlines render with source and a verify-with-your-county affordance, and dependent automations (notifications, auto-computed fees) stay gated off until Addendum B's verification completes for that jurisdiction.
- **Per-user attribution on every witnessed action.** With VA scoping and multi-seat orgs, "the customer acted" must resolve to a named human. Every witnessed action, approval, and attestation records the acting user, not just the org — otherwise the accountability chain inside a customer's own team is invisible.

---

## Wave R exit tests

- Every mail send path resolves credentials through `mailProvider`; the grep ratchet passes; an org without a Lob integration is refused on every reachable counterparty-send surface.
- The `attestations` table and gate primitive exist; each registered gate's action is unreachable without its record, and at least one gate carries a DB-level backstop.
- CSV import cannot complete without a stored rights attestation.
- `dunning_sequences.autoStart` defaults false; arming requires an explicit gate showing the ladder.
- No autonomy level above draft is reachable without a live standing-instruction artifact.
- The recommendation-coverage lint passes: every recommendation- or valuation-class figure renders a visible basis line and mounts its disclaimer type, and its input field remains editable with the customer's value as what sends.
- **The trace test:** pick any consequential action in the product at random and trace backward — a named human, a moment where they were told what they were taking on, a stored record of them affirming it, and a platform statement that described data rather than asserting a recommendation. Where the trace breaks is where the next gate goes.
