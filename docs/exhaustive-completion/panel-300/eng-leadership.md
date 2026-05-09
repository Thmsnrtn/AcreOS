# Engineering Leadership — 15 personas

## 91. Vesper Holloway — VP Engineering
**Lens:** Team-shape decisions at inflection points.
**Backstory:** Scaled engineering from 10 → 200 across a proptech unicorn; obsessed with whether to hire or outsource at each layer.
**What I see:** The schema monolith (`shared/schema.ts`, 17,468 LOC) is the debt accruing; `MASTER-FINDINGS-RECONCILIATION.md` defers refactor until 150+ customers. But the vertical-pack pricing model (FW-TEGAN-1) forces a decision NOW: modular schema or separate repos per vertical?
**Highest-leverage move:** Decide on one: freeze schema refactoring until 150+ customers (keeps velocity), OR extract a `billing-schema` module today (blocks next feature by 5 days). I'd freeze and accept the debt.
**Biggest risk:** If you pick refactoring, the team ships nothing for the next 3 weeks while you're mid-restructure.

## 92. Roan Pakulski — CTO
**Lens:** Build-vs-buy at every architectural layer.
**Backstory:** 3rd-time CTO; ships SaaS infra faster than most teams hire for it.
**What I see:** Stripe Tax (P0-19, shipping today per FW-MARISOL-1) is the canonical win — one Stripe API call beats 400 LOC of custom tax math. But the eval harness (FW-THEO-1 + FW-INDIRA-1) is the canonical lose — building in-house when OpenAI/Anthropic have shrunk-wrapped evals. The tension: compliance mandatory (Indira frame) vs engineering observability (Theo frame).
**Highest-leverage move:** Wire the eval harness for *governance* — fail-closed on model swap (no swap unless 5 baseline tests pass). Let Theo own the corpus seeding; flip governance ownership to Indira at 90-day gate. 1-day decision, prevents $50K audit rework.
**Biggest risk:** If governance frame wins upfront, Theo's cost-ceiling alerting gets deprioritized, and you blind-ship Pax with zero latency budget.

## 93. Hadiya Mansour — Engineering Manager
**Lens:** 1:1 cadence and feedback loops at velocity.
**Backstory:** EM at a Series-C; leads 6 engineers; obsessed with whether 1:1s are lagging or leading indicators.
**What I see:** The 30-day workstream (`_FORWARD-SYNTHESIS.md` §4.1) has 12 items; 10/12 are already shipped. The open 2 are (30-8 persona-aware checklist) and (30-11 runbooks). Both are force-multipliers for the team. Checklist unblocks onboarding velocity; runbooks unblock incident response without founder context.
**Highest-leverage move:** Run two parallel tracks: one engineer owns the persona-aware checklist (2w, UI-heavy, mentorship moment for a mid-level); another owns the 8 runbooks (5d, async-friendly). Both land by 2026-06-08. Pair the checklist owner with Yuna (who owns personas); pair runbooks with Olu (who owns ops).
**Biggest risk:** If runbooks are deferred, your SRE team stays founder-dependent for incidents.

## 94. Cyrus Pendleton — Staff Engineer
**Lens:** Technical-decision docs as leverage points.
**Backstory:** 15-year IC; designed payment-idempotency layers; obsessed with RFCs that scale past the author's brain.
**What I see:** The Dropbox Sign webhook (P0-10, `post-may1-resweep.md` §1) is fixed; the Stripe pattern is there in `webhookHandlers.ts`. But `eSigningService.ts:381-440` still mutates directly with no state-machine guard. The decision is: idempotency via SELECT FOR UPDATE (current Stripe model) vs event-sourcing replay (Caspar's dream). One RFC kills two years of debate.
**Highest-leverage move:** Write a 1-page RFC titled "Webhook Idempotency: SELECT-FOR-UPDATE vs Event Sourcing" with two decision trees (effort vs correctness). Wire Dropbox to the decision. This RFC becomes the pattern for all future vendors (Twilio, Lob, Plaid).
**Biggest risk:** If you defer the RFC, each vendor integration becomes a separate rabbit-hole.

## 95. Olivia Rasmussen — Tech Lead
**Lens:** Weekly demo discipline and forward visibility.
**Backstory:** Leads 8-person team; ships 2-week sprints; obsessed with whether the demos are accurate.
**What I see:** The forward panel (`_FORWARD-SYNTHESIS.md` §4) has 90-day verification gates; every one is measurable (e.g., eval harness ≥5 test cases, Wendell's amortization acceptance test). But the 30-day gates are less crisp — "persona-aware checklist live with time-to-aha measured ≤4:00" assumes telemetry infra (FW-CAMILA-1) is already wired. Is it?
**Highest-leverage move:** Map the verification gates to your demo cadence — one gate per sprint, one owner per gate. Wire a Slack bot that reports gate-status every Friday EOD. This turns synthesis into a shipping heartbeat instead of a retrospective artifact.
**Biggest risk:** If the gates stay in the synthesis doc unacknowledged, you'll miss 2-3 of them and lose credibility with the panel.

## 96. Pasha Yeremenko — Principal Engineer
**Lens:** Architecture Decision Records (ADRs) and irreversibility.
**Backstory:** Owns architecture at a 300-person unicorn; every decision she makes is irreversible 12 months later.
**What I see:** The vertical-pack pricing model (FW-TEGAN-1) is the canonical ADR that's missing. It commits to a billing-schema shape for 18 months; the decision is: separate `vertical_packs` table (extensible, complex) vs jsonb `packs` column on `organizations` (tight, future-rigid)? One choice doubles or halves migration pain if you pivot.
**Highest-leverage move:** Write an ADR with two architectures diagrammed (ER notation): (a) relational packs, (b) jsonb packs. Map each to the 4 founder-judgment decisions (D1 raise/exit, D2 depth/breadth, D6 geofence, D8 eval ownership). Recommend (a) if multi-vertical is the moat (Ashok frame), (b) if Land+NI wedge is the narrative (Caspar frame).
**Biggest risk:** If you ship the packs without an ADR, a later CEO will second-guess the schema shape and you'll own the rework.

## 97. Hannelore Schmitt — Distinguished Engineer
**Lens:** When to disagree-and-commit vs cascade-the-doubt.
**Backstory:** 25 years; built 3 database engines; obsessed with knowing the cost of being wrong.
**What I see:** The note-ledger paranoia test (FW-WENDELL-1) caught + fixed 2 real bugs in the amortization library. That's the signal you need more paranoia tests, not fewer. The eval harness (FW-THEO-1) has zero test cases; the complianceAI post-validator (FW-INDIRA-2) has zero attestation that its outputs are correct.
**Highest-leverage move:** Propose a "paranoia-test sprint" (1 week, 2 engineers): one owns note-ledger edge cases (payment schedule splits, balloon-payment arithmetic); one owns complianceAI output correctness (does TX §5.069 disclosure match the IRS template?). Every bug found is a customer lawsuit prevented.
**Biggest risk:** If you don't run paranoia tests, the first customer-facing bug will be a federal disclosure violation, not a rounding error.

## 98. Kaapo Lindholm — Developer Advocate
**Lens:** Onboarding-time-to-first-API-call as the DX moat.
**Backstory:** Built DX at 3 dev-tool companies; measure everything in seconds to first win.
**What I see:** AcreOS isn't a dev-tool, but the operator-onboarding journey (7:30 → 2:30, per FW-YUNA's persona-aware checklist) is the same problem: how fast until the user feels smart? The `/founder/*` endpoints are shipping (recovery console, financials dashboard), but the operator-facing equivalent is still manual (spreadsheet-based deal tracking).
**Highest-leverage move:** Write a 3-step "Time to First Deal" checklist: (a) sign up (60s), (b) import 1 property (120s), (c) analyze 1 comp (180s). Ship that as the default `/onboarding/aha-moment` route. Measure the conversion rate from signup to step-3 completion daily. Target: ≥60% by month-end.
**Biggest risk:** If you don't measure time-to-aha, Yuna's 2:30 target will slip to 5:00 after the first feature release.

## 99. Elara Voss — Hiring Lead
**Lens:** Calibration drift in engineering interviews.
**Backstory:** Designed eng interview loops at scale; every calibration session finds 2-3 "we've been grading too hard" signals.
**What I see:** The team is 5 engineers (per the roster); you're shipping 10-15 features per week. That velocity implies either superhuman execution or unsustainable hours. The panel doesn't mention hiring; the forward synthesis doesn't mention new headcount. But the 30/90/180/365-day gates assume that velocity **increases**, not decreases.
**Highest-leverage move:** Run a 2-week hiring sprint before 2026-05-22 (mid-month mark). Target 3 hires by 2026-06-08: one fullstack (for persona-aware checklist + bulk actions), one backend (for eval harness + cost ceiling), one SRE (for runbooks + synthetic checks). Calibrate your loop against Vesper's team-shape decision.
**Biggest risk:** If you hire without a team-shape decision, you'll build to the current debt structure, not the future one.

## 100. Devanshi Shroff — L&D Lead
**Lens:** Promotion criteria clarity as a retention lever.
**Backstory:** Built engineering ladders at a 200-person SaaS; every promotion conversation surfaces 3-5 ambiguities.
**What I see:** The team shipped 21/24 P0s, then 10/12 of the 30-day gates. Whoever owned those initiatives (likely same 2-3 people) is already a Staff-track candidate. But there's no visible L&D motion — no growth paths for individual contributors, no promotion rubrics in the codebase. The risk: your best engineer gets poached by a company that has a clear "Staff Engineer" title.
**Highest-leverage move:** Write a 1-page "Engineering Ladder: IC3 to Principal" doc with 4 level descriptions (Senior/Staff/Principal/Distinguished) and one example achievement per level drawn from the codebase (e.g., "Staff: owned the ESIGN integrity layer end-to-end"). Publish internally. Pair with Roan on compensation bands.
**Biggest risk:** If you don't have a ladder, your next engineer conversation is a re-negotiation, not a promotion.

## 101. Oren Brandt — RFC Author
**Lens:** Comment-density discipline in async decision-making.
**Backstory:** Architected RFC process at scale; every RFC with <3 comments is a red flag (either obvious or unread).
**What I see:** The founding-thesis (`_DECISIONS-PACKET.md`) has 4 open founder-judgment decisions (D1, D2, D6, D8). Each is multi-dimensional (raise vs exit vs bootstrap, depth vs breadth, geofence state, eval governance). But there's no RFC template for these trade-offs. The synthesis doc is rich, but it's not a decision artifact — it's context.
**Highest-leverage move:** Convert D1 / D2 / D6 / D8 into 4 RFCs using your standard template (Problem, Proposal, Tradeoffs, Decision). Require ≥5 substantive comments per RFC before the founder resolves. This slows down decision-making by 3 days but prevents founder regret.
**Biggest risk:** If you don't RFC the decisions, they'll be re-litigated in 6 months when a quarterly review shows the wrong path.

## 102. Ingrid Solberg — Architecture Review Board
**Lens:** API stability over time and backward compatibility.
**Backstory:** Chairs ARB at a 400-person fintech; every API change goes to her board first.
**What I see:** The tier-pricing consolidation (P0-1, commit `b1150fa7`) killed 5 variants of price-fetching. That's the right move at this scale. But the vertical-pack pricing model (FW-TEGAN-1) introduces 5 new Pack endpoints. Are they stable enough to ship without ARB review?
**Highest-leverage move:** Submit the vertical-pack endpoints to ARB review (even if the board is just Roan + Pasha + yourself). Define the contract once: `GET /api/orgs/:id/packs`, `POST /api/orgs/:id/packs/:id/toggle`, `PATCH /api/pricing/packs/:id`. Lock them with API versioning. This prevents 3 subsequent refactorings.
**Biggest risk:** If you ship vertical-pack endpoints without API review, you'll have 5 customers integrated before you realize the contract is wrong.

## 103. Maxim Kornilov — Engineering Blog Editor
**Lens:** Author voice consistency and technical depth.
**Backstory:** Edits engineering blog at a public-eng-brand company; every post reflects founder values or it doesn't run.
**What I see:** The forward panel (`_FORWARD-SYNTHESIS.md` §2.1 C6) ships "Founder-voice audit pass" as consensus item — "audit `/auth`, `/pricing`, `/money`, error-toasts for competitive-frame paragraph." That's the *customer-facing* copy. But your engineering blog is silent — no post on the schema monolith strategy, no post on the Dropbox webhook idempotency lesson, no post on the vertical-pack architecture decision.
**Highest-leverage move:** Commission 3 internal posts for publication: (a) "Why We Deferred Schema Refactoring (And You Should Too)" by Vesper, (b) "Webhook Idempotency Patterns: SELECT FOR UPDATE vs Event Sourcing" by Cyrus, (c) "Vertical-Pack Pricing: A Modular Billing Architecture" by Roan. Publish every Friday in June. This attracts engineering talent and clarifies the technical strategy externally.
**Biggest risk:** If you don't publish engineering narratives, hiring team spends 2x time recruiting because candidates don't understand the codebase philosophy.

## 104. Yara Castillo — OSS Lead
**Lens:** Contributor onboarding and maintenance burden.
**Backstory:** Maintains 3 widely-used OSS libraries (50K+ stars total); obsessed with whether a new contributor can make a meaningful first PR.
**What I see:** AcreOS isn't open-source; it's a SaaS. But the 5 internal engineers are, effectively, the only "contributors" to a 17K+ LOC schema. If any of them leave, the schema becomes a bus-factor risk. The `post-may1-resweep.md` explicitly defers "schema monolith refactor" to 150+ customers. That means 6+ months of single-threaded schema knowledge.
**Highest-leverage move:** Document the schema as if it were OSS — internal README per vertical (Land/Notes/BH/etc.) describing the entity model, example queries, invariants. Pair this with the Vesper/Hannelore "modular schema" ADR. This transforms a single-author codebase into one 2-3 engineers can own.
**Biggest risk:** If the schema remains undocumented and person-dependent, onboarding the first new backend engineer adds 3 weeks.

## 105. Bartolomeu Pinto — Engineering Brand
**Lens:** Stack visibility and hiring narrative.
**Backstory:** Owns "best place for SWEs" narrative at a 150-person SaaS; measures success by glassdoor + referral rate.
**What I see:** The 30-day verification gate (2026-06-08) includes "persona-aware checklist live with time-to-aha ≤4:00." If your team ships that in 2 weeks alongside Dropbox idempotency + runbooks + ESLint enforcement, that's 4 simultaneous pushes. The hiring narrative should be: "Engineers shipping at velocity, owning pieces end-to-end, not bottlenecked by founder."
**Highest-leverage move:** Write a 2-minute "Why I Shipped [X]" video for each of the 5 team members, filmed in 1 hour on 2026-06-01 (after the 30-day gates land). Publish on your jobs page + Twitter. This is your hiring moat.
**Biggest risk:** If you don't tell the story of engineering velocity, the next 3 engineers you recruit come from your network, not from public signal.

---

## Category synthesis — top 5 recommendations

1. **RFC the 4 founder-judgment decisions (D1 capital, D2 depth, D6 geofence, D8 eval) with ≥5 substantive comments per RFC before founder resolves.** · cited by: oren-brandt (RFC discipline), roan-pakulski (decision architecture), cyrus-pendleton (decision leverage), pasha-yeremenko (irreversibility), ingrid-solberg (API stability precedent)

2. **Hire 3 engineers by 2026-06-08 (fullstack + backend + SRE) and run 2-week hiring sprint starting 2026-05-22, calibrated against Vesper's team-shape decision (schema freeze vs modular refactor).** · cited by: elara-voss (calibration), vesper-holloway (team-shape inflection), hadiya-mansour (velocity tracking), oren-brandt (process discipline), ingrid-solberg (architectural impact)

3. **Own the eval harness as governance-mandatory until 90-day gate (SOC 2 prep), then flip ownership to Indira's compliance frame; let Theo seed 5 baseline test cases in parallel.** · cited by: roan-pakulski (build-vs-buy), hannelore-schmitt (paranoia tests), kaapo-lindholm (metrics-driven velocity), cyrus-pendleton (decision trees), devanshi-shroff (promotion opportunities for test owners)

4. **Document the schema as if it were OSS (internal README per vertical + modular architecture ADR) to prevent bus-factor risk on single engineer; pair with 3 internal engineering blog posts (schema strategy, webhook patterns, vertical-pack architecture) for recruiting narrative.** · cited by: yara-castillo (contributor onboarding), vesper-holloway (team scalability), maxim-kornilov (blog narrative), bartolomeu-pinto (hiring signal), pasha-yeremenko (ADR discipline)

5. **Build a team retention lever via 1-page "Engineering Ladder: IC3 to Principal" doc with 4 levels and example achievements from shipped work; pair with compensation bands and promotion rubric.** · cited by: devanshi-shroff (ladder clarity), kaapo-lindholm (onboarding velocity), hadiya-mansour (1:1 feedback loops), elara-voss (hiring calibration), bartolomeu-pinto (glassdoor narrative)

