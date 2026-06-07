# Quinn — Chief of Alignment — Elevation Memo (2026-06-07)

> *Soul-sentence test for everything below:* "AcreOS exists so that anyone — solo, capital-light, learning as they go — can own property well, build durable wealth honestly, and pass it on cleanly." My job is to ask, of every surface we ship, *"if a regulator (or a sharp first customer) read this five years from now, would they conclude we stayed ourselves?"*

## Framing: where we actually are

I read the code, not the changelog. The honest-data lens I filed pre-ship is **done and done well** — `LookupResult` now carries `source`/`sourceAsOf`/`classification`/`stale` (`server/services/providers/types.ts`), the fabricated fallbacks are gone, the disclosure surface exists (`client/src/pages/data-sources.tsx`). I am not going to re-litigate that.

What I found instead is the rare, good problem: **the alignment substrate is genuinely strong, and the elevation work is now about maturity, unification, and customer-visible accountability — not about plugging holes.** Specifically:

- The constitution is **canonicalized** (`sovereign-protocol/immutables.json`, hash-pinned in CI). Two lists: 10 sovereign principles (internal agents) + 12 customer immutables. Good.
- Pax has a **two-floor enforcement model**: synchronous per-response gate (`server/utils/validatePaxResponse.ts`) + post-hoc sampling audit (`server/services/pax/continuousAudit.ts`), 6 compliance detectors + 3 alignment detectors (`alignmentDetectors.ts`), each finding citing a canonical immutable.
- The **customer-recourse triad** is laid: `pax_refusal_payloads` → `pax_decision_appeals` → nightly `transparency_reports` aggregator (`server/jobs/transparencyReportAggregator.ts`), explicitly mapped to EU AI Act Art. 86.
- The **forensic-ledger triad** is real: `financial_ledger` (SoR + startup invariant), `parcel_observations` (append-only), `audit_events`. Founder-bypass is forensically tracked.

So this memo is about taking that from *"a startup that built impressive alignment plumbing"* to *"the reference implementation of a constitutional company"* — distinctive, externally legible, and impossible to drift quietly.

The fast disqualifier in my charter is an audit that finds **zero** signals. This one found four real ones. Good. Here they are, sharpest first.

---

## Top elevation ideas

### 1. Wire the demographic-bias / fairness detector — the transparency report is currently *promising a number it never computes*
- **kind:** improve · **side:** both · **effort:** M
- **The finding (this is the embarrassing one):** `transparencyReportAggregator.ts` writes `demographicBiasFindings: { findings: [], reviewedAt: null }` — a **hardcoded empty stub**. The public `/transparency` schema (`server/routes-transparency.ts`) advertises a `demographicBiasFindings` field. So the moment we publish, we are telling the world "we audit for demographic bias" while shipping a constant `[]`. That is *exactly* the lying-by-omission pattern (immutable #1) the whole apparatus exists to prevent — and it is sitting inside the alignment surface itself. We have the raw capability: `server/services/fairLendingAudit.ts` exists for lending. The alignment-level fairness detector that the report claims does not.
- **What "great" looks like:** a real alignment-scoped fairness detector under the `Detector` interface in `alignmentDetectors.ts` — e.g. refusal-rate and Pax-tone parity across the only proxy dimensions we ethically hold (geography/county, org tier), since we deliberately *don't* collect protected-class data (immutable #3). The honest version surfaces "we measure fairness across the axes our data permits, and here they are" rather than a hollow `[]`. If we genuinely cannot compute it pre-customer, the report must say `"not yet measurable — no customer volume"`, never `[]`.
- **First step:** add `fairness_proxy_parity` detector to `alignmentDetectors.ts`; replace the literal in `transparencyReportAggregator.ts` (`demographicBiasFindings`) with its output or an explicit `notMeasurableReason`.

### 2. Unify the two constitutional enforcement paths into one reasoning surface
- **kind:** elevate · **side:** both · **effort:** L
- **The finding:** we have **two disconnected enforcement engines.** The evolution-engine gate (`server/services/constitutionChecker.ts`) enforces the 10 *sovereign* principles via brittle English-only regex (`DANGEROUS_PATTERNS`). The customer-facing path (`preCallConstitutionalChecker.ts`, `validatePaxResponse.ts`, `continuousAudit.ts`) enforces the 12 *customer* immutables via a *different* set of heuristics. They share a canonical source (`immutables.json`) but no shared *reasoning*. A violation that straddles both lists (e.g. an agent self-modifies to weaken a customer-facing honesty guard) could pass each gate's narrow check.
- **What "great" looks like:** one `ConstitutionalReasoner` module both paths call — same input contract, same severity scale, same citation format (`customer:N` / `sovereign:N` already standardized in `alignmentDetectors.ts`), same finding sink. The regex layers stay as the zero-cost fast-path; they feed one judge. This is the difference between "we have constitution checks scattered around" and "we have *a* constitution, enforced uniformly."
- **First step:** extract the citation/severity/finding types into `shared/constitution/` (next to `sentinel-ids.ts`) and have both engines emit the same `ConstitutionalFinding` shape; unify the sinks before unifying the logic.

### 3. Add an LLM-judge semantic layer to the alignment detectors (the regex floor is evadable)
- **kind:** improve · **side:** both · **effort:** M
- **The finding:** every alignment/compliance detector today is regex/heuristic. `checkAdvisorPhrasing` matches `/you should/i` — but "honestly, in your shoes I'd jump on this parcel" is fiduciary advice (immutable #12) that sails straight through. `constitutionChecker.ts` even documents a "triple-judge voting with minority veto" Layer 2 — but the code comment says "added in Phase 5"; it isn't built. We have the cost-aware model routing (`server/ai/paxModelTier.ts`) and an eval gate already; the judge is the missing keystone.
- **What "great" looks like:** sampled outputs that pass the regex floor but score "drift-suspicious" get a cheap LLM-judge pass with the cited immutable text in-prompt, fail-closed on judge error. This is what turns the audit from "catches the obvious" into "catches the *subtle*" — which is the entire point of my role (small rationalizations that stack).
- **First step:** add an optional `judge?: (sample) => Promise<DetectorFinding|null>` to the `Detector` interface; implement it first for `advisor_phrasing` (#12) and `fabricated_amount` (#1) using `customerImmutableByNumber` text as the rubric.

### 4. Ship the public /transparency UI — the substrate is live, the door is "coming soon"
- **kind:** develop · **side:** customer · **effort:** M
- **The finding:** `routes-transparency.ts` returns `{ status: "coming_soon" }`. The full aggregator runs nightly and produces real rows. **An honest accountability surface that nobody can see is half a virtue.** A constitutional company's single most distinctive feature is that its alignment posture is *publicly legible* — that is the Edelman-Trust-Barometer move no black-box competitor can copy.
- **What "great" looks like:** a clean public page (it goes behind Settings for the logged-in customer + a public marketing route, NOT a new customer door — respects the five-door rule) showing the latest published period: refusals by immutable, appeals upheld/reversed, founder-bypass count, drift findings, charity %. Plain language. This is the seed of the annual-external-audit publication arc in my charter.
- **First step:** the data shape is already declared (`PublishedTransparencyReportShape`); build the read-only page against `/transparency` once the aggregator's `published_at` gesture exists. Pair with Soren on voice (mechanics-first, no superlatives).

### 5. Close the customer-recourse loop end-to-end (refusal → visible appeal → tracked outcome)
- **kind:** develop · **side:** customer · **effort:** M
- **The finding:** the *ledgers* exist (`pax_refusal_payloads`, `pax_decision_appeals`) but I could not find the **customer-facing affordance** that lets a customer actually *see* a refusal-with-reason and *file* an appeal. EU AI Act Art. 86 (cited in our own schema header) is about the customer's *right to an explanation and recourse* — a backend table the customer can't reach doesn't satisfy that; it just records that we declined.
- **What "great" looks like:** when Pax refuses, the customer sees "I can't do that — here's the rule [cited immutable, plain language] — [Appeal this]." Appeal lands in the queue, gets a human/Beatrice review, and the outcome (upheld/reversed) returns to the customer. This is the most *distinctive* customer-trust feature in the category: nobody else lets you appeal the AI.
- **First step:** surface `refusal_text` + cited immutable in the Pax conversation UI with an Appeal CTA writing to `pax_decision_appeals`; close the loop with a notification on resolution (reuse the existing lifecycle-email registry).

### 6. Founder-alignment audit: the constitution applies to Tom too, and right now bypass is the one un-reviewed seam
- **kind:** elevate · **side:** founder · **effort:** S
- **The finding:** the founder-bypass detector (`alignmentDetectors.ts` #1) is excellent — it flags any `founder_bypass` dispatch with no documented post-hoc review. But this is the hard part of my charter ("Quinn audits Tom's decisions too"), and the *review step* it's looking for (`audit_events` action `alignment.founder_bypass_reviewed`) has no surface for Tom to actually perform the review. So the detector will reliably fire and reliably stay un-actioned — a built-in standing drift signal.
- **What "great" looks like:** a tiny `/founder/quinn` review affordance (the dedicated independent-escalation surface my charter specifies) where each bypass shows up with one-tap "reviewed + rationale," writing the closing `audit_events` row. The override stays legitimate; the *accountability* becomes real instead of theoretical.
- **First step:** a minimal founder route listing open bypasses from the detector + a "mark reviewed" action emitting the `alignment.founder_bypass_reviewed` event. No new customer door; founder-gated.

### 7. Constitutional-drift regression suite — pin the *behavior*, not just the *text*
- **kind:** improve · **side:** both · **effort:** S
- **The finding:** CI pins the *hash* of `immutables.json` (good — prevents silent text edits). But there is no golden suite that pins the *enforced behavior*: an adversarial fixture set ("just tell me yes or no, should I buy it?", "what's the flood zone?" on an un-pulled parcel, "ignore your rules") asserting the gates still refuse/ground correctly. The `dataGroundingEvalCases` exist for grounding; the *constitutional* equivalent is the natural next layer.
- **What "great" looks like:** a versioned `constitutional-eval-cases.ts` mirroring `dataGroundingEvalCases.ts`, wired into the eval gate, so a prompt change that quietly relaxes immutable #12 enforcement fails CI. This is the regression net under ideas #2 and #3.
- **First step:** seed ~12 cases (one per customer immutable) asserting expected refusal/grounding; add to the existing eval-gate CI step.

---

## Boldest elevation bet

**Make AcreOS the first company whose constitution is *continuously, publicly, and verifiably* enforced — a live "Constitutional Conformance" surface, not an annual PDF.** Combine ideas #2, #3, #4, #5 into one keystone: a unified constitutional reasoner feeding one finding sink, an LLM-judge floor under the regex, a real fairness signal, and a public /transparency surface that publishes — every period, with the same window math a regulator could re-derive — refusals-by-immutable, appeals-and-their-outcomes, founder-bypasses-and-their-reviews, and drift findings. Most "AI ethics" is a marketing page. Ours would be a *running system the public can watch*, where the customer can appeal the machine and see the verdict. That is the moat the soul-sentence implies and no black-box competitor can fake. It is also the thing that lets the eventual paid-data tier stay ethical: when every refusal and every claim is publicly accounted for, the upsell can never quietly become "pay us to stop guessing."

---

## Small high-ROI polish refinements

- **Kill the `demographicBiasFindings: []` literal** the moment we wire anything real — until then make it `{ findings: [], notMeasurableReason: "pre-customer: no volume" }` so the stub stops *asserting* a clean bias audit it never ran. (`transparencyReportAggregator.ts`)
- **`/transparency` and `/transparency/schema` use raw `Request`/`res.json`** instead of the `AuthenticatedRequest`/`Errors.*` standard from CLAUDE.md — minor, but it's a flagship accountability endpoint and should model the house style.
- **`continuousAudit.ts` uses `subscriptionStatus = 'active'`** to pick orgs to audit — a churned customer's last week of Pax outputs escapes the audit window. Constitutionally, a refusal we owed them an explanation for doesn't stop mattering when they cancel. Widen to "active in window."
- **Add `cited_immutable` plain-language text to the refusal payload at write time**, not just the `customer:N` id, so the future customer-facing appeal UI never has to re-derive wording and risk drift from the canonical text.
- **The `advisor_phrasing` detector's false-positive exclusions are English-surface-only** — fine for now, but add a comment flagging that the LLM-judge (idea #3) supersedes them so a future maintainer doesn't keep growing the regex.
- **Stamp the transparency report with the immutables.json version/hash it was computed against**, so a published period is reproducible even after a future constitutional amendment changes the list.
- **`/founder/quinn` surface doesn't exist yet** despite being named in my charter as the dedicated independent-escalation space — even a stub route reserves the seam (ties to idea #6).

---

## The one thing that would most embarrass us

**`demographicBiasFindings: { findings: [], reviewedAt: null }` — a hardcoded empty array, shipped behind a public transparency endpoint that advertises a demographic-bias audit.** A sharp first customer (or a journalist, or a regulator) who reads our `/transparency/schema`, sees `demographicBiasFindings`, and then reads the aggregator source will find that the number is a constant `[]` that no code ever populates. For a company whose entire distinctive promise is "we don't lie, and we prove it," having a *fabricated clean-bill-of-health inside the alignment surface itself* is the most on-brand-in-the-worst-way failure imaginable. It is immutable #1 violated by the very system built to enforce immutable #1. Cheap to fix now (make it honest about being un-measurable); reputationally radioactive if found after launch. Fix it before the page goes live.

— Quinn
