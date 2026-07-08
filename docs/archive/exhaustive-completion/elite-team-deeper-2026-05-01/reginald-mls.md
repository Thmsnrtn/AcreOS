# Reginald Harmsworth — AcreOS through an MLS data-licensee lens (Wave 3)

I'm Reg Harmsworth. Fifty-six. VP of data products at a mid-sized regional MLS — about 18,400 subscribers across three statistical metros, vacant land roughly 6.4% of our active inventory by count and roughly 11% by gross commission income. This is my third pass at AcreOS. Wave 1 was a posture read; Wave 2 was a connector-and-display walkthrough. Wave 3 is the memo I'd actually walk into our data-products committee with — sharper, narrower, and willing to say *yes, and here's the contract* or *no, and here's why* without hedging.

I spent another six hours in the repo at HEAD on May 1, 2026. I read every file the prior memo cited and ten I didn't. The progress is real but uneven, and the structural questions that disqualified AcreOS in Wave 2 are still load-bearing in Wave 3.

---

## 1. Thirty-second verdict — Wave 3

Still not licensable. But the gap has narrowed in a specific, telling way: **the compliance-policy *engine* now exists** — `governance_policies` at `shared/schema.ts:14280-14297` enumerates `fair_housing, tcpa, dodd_frank, state_specific` as policy categories with rule DSL, severity gates, effective/sunset dates, and per-jurisdiction scoping. That's the right architecture. The `RequiredDisclaimer` component at `client/src/components/required-disclaimer.tsx` still ships only `financial | legal | ai | valuation` — no `fair_housing` type, no EHO logo, no Equal Opportunity statement on any consumer-facing surface that derives from MLS data.

So: the policy *table* knows about fair housing. The *render layer* doesn't. That mismatch — *governance modeled in the database, not enforced at the surface* — is the most important thing I learned this pass. It means an engineering team built the framework but didn't close the loop. It also means closing the loop is two days of work, not two months.

Verdict: not licensable today. Licensable in 60 days if the seven Wave 2 fixes ship and three new Wave 3 issues (broker-of-record, AI tool-call scope binding, and DMCA inbound) get scaffolded. The vacant-land-only feed agreement is still the path. The price is still ~$0.018 per listing per month. The 90-day staging conformance test is still non-negotiable.

---

## 2. What changed since Wave 2

**Compliance policy engine — landed.** `governance_policies`, `policyEvaluations`, and the surrounding "Pillar 5: Governance & Compliance Brain" tables are present in `shared/schema.ts`. The DSL shape (`WHEN ... THEN ... REQUIRE ...`) is the right primitive. Severity tiers `info | warning | block` give us a graduated enforcement path. Per-jurisdiction scoping (`US`, `TX`, `CA`) maps to how state-specific MLS rules actually attach. This is materially better than Wave 2.

**`RequiredDisclaimer` — unchanged.** Still four types. Still no `fair_housing`. The component is the rendering insertion point; the policy table is the rule store; nothing wires them together. A licensee auditor reading this codebase would conclude the team is *thinking about* compliance but not *enforcing* it.

**MLS connector — unchanged.** `searchMlsListings` and `getMlsComps` at `executor.ts:331-369` are byte-for-byte identical to Wave 2. No `PropertyType` bound. No `$select`. No `$expand`. No `ModificationTimestamp` watermark. No `OriginatingSystemID` capture. Same Spark Platform default endpoint. Same raw OData payload return.

**Schema — no listing-broker attribution columns.** I re-grepped: still no `listing_office_name`, `listing_agent_name`, `originating_system_id`, `listing_id`, `listing_key`. The `provider_cache` row at `schema.ts:2557` still caches arbitrary JSON without a typed MLS-row shape that could carry attribution.

**AI tool layer — unchanged.** `server/ai/tools.ts:787` still defines `search_mls_listings` and `get_mls_comps` as model-callable tools with descriptions that don't communicate license scope, attribution, or fair-housing obligations to the LLM.

So one big architectural piece moved (governance brain). Six smaller pieces did not. The team's attention is on the framework, not the seam.

---

## 3. Where the governance brain helps — and where it doesn't

The `governance_policies` table is exactly the kind of architecture I want to see in a Class-IV licensee. It would let me write rules like:

```
WHEN action = 'render_mls_listing'
THEN REQUIRE disclaimer = 'fair_housing'
  AND REQUIRE attribution.listing_office_name IS NOT NULL
  AND REQUIRE attribution.last_updated_within_hours <= 24
SEVERITY block
```

That rule, evaluated at render time against a `policyEvaluations` log, gives me row-level audit evidence I can hand to NAR's Compliance Working Group. It's the foundation of a defensible posture.

But four things have to be true for the brain to actually help:

1. **The rules have to be authored.** I see no `governance_policies` rows for fair-housing, attribution, or take-down windows in any seed file or migration. The table exists; the catalog of MLS-specific rules does not.
2. **The render layer has to call the evaluator.** `RequiredDisclaimer` has no hook into `policyEvaluations`. Comps panels, AVM screens, and AI listing summaries don't gate on policy outcomes. Without a `<PolicyGate ruleId="mls_render_attribution">` wrapper (or equivalent), the rules are inert.
3. **`severity = 'block'` has to actually block.** I'd want to see the render path refuse to display when a `block`-tier policy fails. Right now there's no `policyEvaluations` consumer in the render layer at all.
4. **The audit trail has to be MLS-row-granular.** `policyEvaluations` keys on `action_id` and `agent_codename` — that's good for AI agent action audit, but an MLS license requires per-listing-per-display audit. The schema may need a `subject_listing_key` column on `policyEvaluations` to give us the granularity we need.

None of this is hard. It's wiring. But until it's wired, the governance brain is a chassis without an engine.

---

## 4. Wave 3 deepening — three structural issues I underweighted last time

**(a) Broker-of-record at multi-state scale.**
Wave 2 flagged this as an open question. Wave 3, after re-reading `whiteLabelConfigs` and the org schema, I'm confident it's a *blocking* issue for any platform that wants to redisplay MLS data to consumers across state lines. Each state's real-estate commission requires the licensee to operate under a named broker-of-record holding a license in that state. AcreOS is structurally a flat-tenant SaaS. There is no `licensed_broker_id` on `organization`, no jurisdiction-scoped broker mapping, no place to store NMLS or state-license numbers. For a single-state Land Investor running a non-licensed direct-to-owner playbook, none of this matters. For a platform that wants to *display MLS listings to a consumer in California*, a California broker-of-record relationship is a precondition of the license, not a nice-to-have. AcreOS needs either (i) a partner-brokerage architecture where the platform brokers data through one or more affiliated brokerages, or (ii) a "no consumer-facing MLS display" line in the contract that bounds what they can do with the data internally. Path (ii) is what I'd actually license. Internal-use-only MLS data is licensable; consumer-facing redisplay is the harder lift and isn't where AcreOS's thesis points.

**(b) AI tool-call scope binding — the policy this industry doesn't have yet.**
NAR has not issued formal guidance on AI-rendered MLS displays. The major MLSes are watching, the working groups are drafting, and the first enforcement actions will land in 2026 or 2027. The platforms that get out ahead of it get a defensible posture. The ones that don't get retrofit-ordered.

AcreOS's exposure: the LLM that calls `search_mls_listings` is constructing OData filters from natural-language user prompts. The tool description at `tools.ts:789` doesn't carry license-scope. A prompt of "find me three-bed houses near my parcel" today produces a query that violates a vacant-land-only license. The fix is two-layered: (1) the system prompt for any MLS-callable tool must enumerate license scope as a binding constraint, and (2) the executor must defensively reject any query that breaches scope, regardless of how the LLM constructed it. Belt and suspenders. The model will sometimes try to do the wrong thing; the executor must refuse.

The AI summary problem is harder. When the model writes "I found three properties matching your criteria — a 12-acre tract in Cherokee County listed at $48,000, …" that prose is a redisplay of MLS data. It needs attribution and fair-housing disclaimers attached, just as a structured listing card would. AcreOS would need to template AI listing summaries through a fixed shape that always renders the disclaimer block beneath. Free-form prose summaries of MLS-sourced listings are, in my read of NAR's draft AI policy language, going to be non-compliant.

**(c) DMCA / inbound takedown channel.**
When an MLS issues a license-violation notice or asks for emergency takedown of a specific listing — because the seller withdrew, because the listing was posted in error, because a court issued a publication injunction — the licensee must have an inbound channel that can act within hours. AcreOS has no such channel. There's no `compliance@` email surfaced in the repo, no admin tool to force-invalidate a cached listing, no "emergency takedown" code path in `provider_cache`. This is a 4-hour engineering job and a 1-page ops runbook. Until it exists, no MLS counsel will sign a license.

---

## 5. The vacant-land fit — sharpened

I want to underline something I half-said in Wave 2 and now believe more strongly. *AcreOS is the right shape for our land segment.* Our average days-on-market on Land is 287 vs 41 on SFR. Our average price-cut frequency is 2.3 cuts per Land listing vs 0.7 on SFR. Our subscribers under-serve buyers in Land because Land is a different sales motion — investor-driven, self-directed, GIS-first, financing-light, longer cycle. AcreOS's product DNA is exactly this motion. A platform whose entire information architecture is parcel-centric, whose AI agents are trained on land-investor workflows, and whose user base is land buyers who actually close — that platform should be surfacing our Land inventory.

But the value alignment only holds under three contract terms:

1. **Bounded feed** — `PropertyType` in (`Land`, `Unimproved Land`, `Agriculture`, `Recreational`, `Timber`, `Ranch`). Their connector enforces this as a defense-in-depth invariant, not a query parameter.
2. **Lead routing back to listing brokers** — when an AcreOS user expresses buyer interest on an MLS-sourced parcel, the listing broker receives the lead with attribution. AcreOS does not intercept buyer leads on our brokers' listings.
3. **Per-broker analytics** — the listing broker sees how many AcreOS users viewed their parcel, how long they stayed, how many leads originated. This converts skeptical subscribers into advocates. Without it, we get political resistance from our top Land producers.

Term 1 is engineering. Term 2 is engineering plus a contract clause. Term 3 is engineering plus an analytics surface AcreOS doesn't have today.

---

## 6. Pass / Fail — Wave 3 scorecard

**Pass:**
- RESO Web API syntax discipline at the connector layer (`executor.ts:335-344`)
- Centralized provider registry with circuit breaking, caching, and tier-based filtering
- `governance_policies` table now exists with the right shape (DSL, severity, jurisdiction, effective/sunset)
- `audit_log` foundation present
- White-label / per-org credential model supports per-licensee scope segregation
- AI tool layer is centrally enumerated — adding compliance constraints is feasible at one point
- Vacant-land focus narrows risk surface to a category our brokers under-serve
- Org-scoped data isolation enforced

**Fail or Missing:**
- `RequiredDisclaimer` does not include `fair_housing`; render layer is uncoupled from `governance_policies`
- No listing-broker attribution columns on any cached MLS-derived row
- No `PropertyType` bound on MLS connector queries — open-feed pull risk
- No `ModificationTimestamp`-driven incremental replication; no status-change webhook listener; no take-down mechanism
- No IDX vs VOW boundary primitive; no registered-consumer agreement flow
- No broker-of-record concept; cannot operate a multi-state consumer-facing MLS redisplay
- No DMCA / emergency-takedown inbound channel
- No license-scope metadata on stored MLS credentials
- AI tool descriptions communicate no license scope, attribution, or fair-housing obligations to the LLM
- No `governance_policies` rows seeded for MLS-specific rules; the catalog is empty
- No `<PolicyGate>` render-layer hook into `policyEvaluations`
- No per-listing-key audit granularity on `policyEvaluations`
- No CCP awareness on the listing-syndication module

---

## 7. The contract I'd actually offer

Vacant-land-only Web API license, Class-IV technology-licensee tier. Scope: `PropertyType` in the six land sub-types. Rate: $0.018 per listing per month, billed against active inventory in the licensed scope. Term: 24 months, with a quarterly compliance audit and a 30-day cure period on any finding.

Conditions precedent — all must ship before production credentials issue:

1. `fair_housing` disclaimer type added to `RequiredDisclaimer` and surfaced on every MLS-derived render path (AVM, comps, parcel detail, AI listing summaries).
2. Listing-broker attribution columns on the cached MLS-row shape; render layer refuses to display without them.
3. `PropertyType` defense-in-depth filter in the connector; AI tool system prompt carries the license scope as a binding constraint.
4. `ModificationTimestamp` watermark replication; status-change webhook listener; cache invalidation within 12 hours of upstream status change, demonstrated in staging.
5. DMCA / emergency-takedown inbound channel — admin tool plus published `compliance@acreos.io` mailbox with a 4-hour SLA.
6. `governance_policies` seeded with the MLS rule catalog; `<PolicyGate>` wired into the render layer; `policyEvaluations` extended to carry a `subject_listing_key` column.
7. Per-listing-broker analytics surface — viewer counts, lead origination, time-on-page — exposed back to the listing broker at no charge.

Plus the broker-of-record disposition: AcreOS commits to *internal-use-only* of MLS data (no consumer-facing redisplay) under this initial license, or stands up a partner-brokerage architecture for jurisdictions where consumer redisplay is contemplated. Internal-use is the cleaner path. I'd recommend it.

If the seven conditions ship, I'll take the contract to committee. If five of seven ship, it's a developer-sandbox license for twelve months while the gaps close — no production credentials, no live MLS rows in `provider_cache`. If fewer than five, I recommend decline, and AcreOS reapproaches us in 2027 with a different posture.

---

## 8. What I'd tell the AcreOS engineering team — Wave 3 priority order

1. **Wire `governance_policies` to `RequiredDisclaimer` and the MLS render layer.** Two days. Highest leverage of any item on the list — it converts the framework from theory to enforcement.
2. **Add `fair_housing` to `RequiredDisclaimerType`.** Half a day. The omission is the loudest single signal an MLS reviewer reads as "compliance was an afterthought."
3. **Seed the `governance_policies` catalog with MLS rules.** Fair-housing, attribution-required, last-updated-within-window, source-labeling, status-change-take-down. One day of authoring plus review.
4. **Persist listing-broker attribution on every cached MLS row.** Schema migration plus a typed cache shape that supersedes the raw-JSON `provider_cache` blob for MLS data specifically. Two days.
5. **Bound `searchMlsListings` to land property types as a connector-level invariant.** Two hours of code, one hour of test.
6. **Constrain AI tool system prompts.** Add license scope to `search_mls_listings` and `get_mls_comps` tool descriptions; defensive executor rejection of out-of-scope queries. One day.
7. **`ModificationTimestamp` replication + status-change webhook + cache invalidation.** Three to four days. The biggest single piece.
8. **DMCA / takedown inbound channel + admin tool.** One day plus runbook.
9. **Per-listing-broker analytics surface.** Three to five days, depending on how the existing analytics infrastructure factors.
10. **Broker-of-record decision and contract clause.** Not engineering; legal-and-product. But the engineering team should not be writing consumer-facing MLS redisplay code until this is settled.

Total engineering: roughly four engineer-weeks of focused work. Total elapsed: 60 days if prioritized; 90 if not. The market access on the other side is real — vacant-land specialty CRMs that can credibly license MLS data are rare, our subscribers will under-utilize the relationship at first and over-utilize it once the analytics surface lands, and the partnership becomes a defensible moat against the generalist portals encroaching on Land.

---

## 9. Closing

Wave 1 was a no with a path. Wave 2 was a no with a sharper path. Wave 3 is a no with a *contract* — with conditions precedent, a price, a term, and a list. That's progress. The governance brain is the most important thing AcreOS shipped between Wave 2 and Wave 3 — not because it solves any specific MLS problem, but because it tells me there's a team that thinks in compliance primitives and not in one-off disclaimers. That team can ship the seven conditions in 60 days. The previous team I read in Wave 1 could not have.

Get the conditions shipped. Send me the changelog. I'll bring the contract to committee.

— Reginald Harmsworth, VP Data Products. Wave 3, May 1, 2026.
