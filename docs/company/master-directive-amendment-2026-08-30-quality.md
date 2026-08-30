# Master Directive Amendment — Production Experience & Quality Program
## Issued by the founder 2026-08-30 (verbatim mandate, recorded same day)

> Standing order. Survives sessions, compactions, and container restores.
> Sequencing is explicit: **the current evidence-gated consolidation program
> finishes first, untouched** — the production-evidence window (~2026-09-05),
> the turn-12/13 authority cutovers if the evidence warrants them, and the
> turn-19 independent adversarial closing audit. **Then, without waiting for
> another founder instruction, transition directly into this program.**

---

## The governing question (new, permanent)

> If a real customer or the founder opened AcreOS today with no knowledge of
> its architecture, would the product feel exceptionally coherent, fast,
> trustworthy, understandable, and useful?
>
> Do not answer from code. Prove it through the running product.

The codebase is not the product. The architecture is not the product. The
tests are not the product. **The experience a real person has using the
running system is the product.** Do not merely prove that AcreOS works —
prove that AcreOS is excellent to use.

## Two founder observations, standing as this program's first evidence

### E-1: Founder decision overload (~1,200+ items)

The live founder experience reports roughly **1,200+ items requiring founder
decisions** — inconsistent with the constitutional objective *"Read The
Letter. Decide rarely."* Investigate from first principles. **Do NOT bulk-
dismiss or delete records to make the number look better.** Determine: what
the items are; where they came from; historical artifacts vs. live asks;
whether dev/autonomy work generated them; whether completed/stale asks stay
projected as active; whether operational events are misclassified as founder
decisions; whether duplicate decision systems contribute; whether decision
lifecycle/closure is incomplete; whether the projection layer is semantically
wrong. The queue must ultimately contain only items needing genuine founder
authority or irreducible judgment; everything else is autonomously resolved,
routed, reclassified, archived, closed, or represented as Story. **Treat
unnecessary founder asks as a serious product defect.** The 1,200+ state is
a failure until understood.

### E-2: Real iOS Safari performance

The live customer product **feels slow, glitchy, and takes a long time to
load in iOS Safari**, despite green mobile E2E. Treat that observation as
stronger evidence than functional green. **Measure first; do not optimize
blindly.** The candidate-cause list is recorded in the verbatim mandate
below. Do not merely make E2E tests faster — make the production experience
faster. Do not claim mobile quality solely from Playwright device emulation
if real WebKit behavior materially differs; use the strongest practical
evidence available (Playwright's real-WebKit engine over Chromium
emulation, production probing over localhost).

## Program shape (summary; verbatim text below is the authority)

- **Not just performance**: functional correctness, experience coherence,
  performance, mobile, responsiveness, accessibility, information
  architecture, data truthfulness, AI quality (Pax + Solene grounding),
  error recovery, empty/loading states, cross-browser behavior, real user
  workflows, founder workflows, polish, and DELETION of redundant UX.
- **Test as a customer**: realistic jobs across investor archetypes (new
  investor, experienced land investor, wholesaler, note investor, rental
  where supported) — arrival → understanding → onboarding → first value →
  parcel/deal/finance/map/Pax journeys → failure recovery → returning.
- **Test as the founder**: the away-and-back journey through The Letter,
  Decisions, Controls, Story, Solene; no internal implementation vocabulary
  required to understand any of it.
- **Test real production, not just localhost**, keeping a hard line between
  observing production behavior and causing consequential production
  actions; no customer-facing external effects merely for testing.
- **Browser matrix**: iOS Safari first (founder-observed), desktop Safari,
  Chrome desktop, Chromium mobile, relevant WebKit.
- **Experience budgets** for important flows (Today usable, Letter usable,
  route transition, deal/property detail, Map interactive, Pax ready …),
  thresholds chosen for excellent practical UX; regression ratchets where
  appropriate; no meaningless microbenchmarks.
- **Instrument what users actually experience** (route load, server time,
  slow queries, long tasks, failed requests, stalled loading, workflow
  completion, time-to-first-value) — no invasive surveillance.
- **UX correctness sweep**: surfaces that technically render but are
  experientially false (misleading counts, stale alerts, unknown-as-zero,
  loading-as-empty, dead links, duplicate status systems …).
- **Loading experience**: shell → useful → interactive → secondary; the
  spinner is not an excuse; progressive usefulness.
- **Glitch audit**: layout shifts, flashes, scroll jumps, lost context,
  keyboard/touch/viewport issues — a polished system feels physically stable.
- **Performance as architectural evidence**: fix causes at the correct
  layer; a slow page may indicate wrong boundaries, oversized endpoints,
  duplicated state — not a memoization target.
- **Accessibility** as product quality: keyboard, focus, semantics,
  contrast, touch targets, reduced motion, announcements.
- **Pax and Solene quality programs**: contextual, evidence-grounded,
  uncertainty-honest, latency-acceptable; trustworthy executive
  understanding over confident prose.
- **Cross-surface coherence**: one concept, one language, everywhere —
  continue the epistemic-UX convergence.
- **Visual refinement** after structure and performance are understood:
  calm intelligence, no decorative AI theater.
- **Deletion pass**: more capability, less surface area.
- **Customer-value and founder-attention tests**: first-value time, task
  completion, true vs. false founder decisions, founder minutes/week,
  step-away readiness.
- **Adversarial personas** attack the product (impatient new user, mobile-
  only, skeptical professional, accessibility reviewer, slow network,
  provider failure, founder back after seven days …); the implementer is
  never the sole judge.
- **Quality loop**: observe real experience → identify friction → measure →
  root cause → design → implement → test → deploy → verify live → observe
  again → lock with ratchet/test → delete superseded UX → reassess.
  Continue autonomously; no founder approval for routine fixes.
- **Prioritization** (evidence may reorder): broken functionality → truthful
  state → data-loss/security → founder-attention failure → first-value
  blockers → customer-critical workflows → performance → mobile usability →
  error recovery → coherence → visual polish. No endless polish loop.
- **Maturity checkpoint → independent adversarial audit of the complete
  product experience** (every quality claim a hypothesis) → repair → update
  institutional state → return to the standing Development Institution loop.

## Sequencing state (maintained by the institution)

| Milestone | State |
|---|---|
| Consolidation shadow-evidence window (seamLooser must be 0) | RUNNING, matures ~2026-09-05 |
| Turns 12–13 authority cutovers (if evidence warrants) | PENDING window |
| Turn 19 independent consolidation audit | PENDING turns 12–13 |
| **Quality program transition** | AUTO-STARTS when the row above closes |
| Pre-transition reconnaissance (read-only; no product changes) | PERMITTED during consolidation quiet cycles — investigation of E-1/E-2 that touches nothing the consolidation program owns |

---

## Verbatim founder mandate (2026-08-30)

The full amendment text as issued follows, and is the authority wherever the
summary above compresses it.

AMENDMENT TO THE ACREOS MASTER DIRECTIVE

Do not interrupt or weaken the current evidence-gated consolidation program.

Finish the current coherent arc, including the production-evidence window,
final authority cutovers if warranted by evidence, and the independent
adversarial closing audit.

Then, without waiting for another founder instruction, transition directly
into the following major program:

PRODUCTION EXPERIENCE & QUALITY PROGRAM

The objective of this phase is to stop judging AcreOS primarily from
repository structure, automated tests, architectural coherence, or
development-environment behavior and begin judging it as a real founder and
real customer experience running in production.

The system may be architecturally excellent and test-green while still being
unpleasant, slow, confusing, glitchy, misleading, or difficult to use.

Those are product failures.

Treat actual production experience as first-class evidence.

NEW GOVERNING QUESTION

After the consolidation arc closes, repeatedly ask:

If a real customer or the founder opened AcreOS today with no knowledge of
its architecture, would the product feel exceptionally coherent, fast,
trustworthy, understandable, and useful?

Do not answer from code.

Prove it through the running product.

FOUNDER OBSERVATIONS ALREADY PROVIDED

1. FOUNDER DECISION OVERLOAD — The live Founder experience currently reports
roughly 1,200+ items requiring founder decisions. This appears inconsistent
with the constitutional objective: Read The Letter. Decide rarely.
Investigate this from first principles. Do NOT simply delete or
bulk-dismiss records to make the number look better. Determine: what those
items actually are; where they came from; whether they are historical
artifacts; whether development/autonomy work generated them; whether
completed/stale asks remain projected as active; whether operational events
are being misclassified as founder decisions; whether duplicate decision
systems contribute; whether decision lifecycle/closure is incomplete;
whether the projection layer is semantically wrong. The founder Decision
queue must ultimately contain only things that genuinely require founder
authority or irreducible judgment. Everything else should be: autonomously
resolved, routed elsewhere, classified correctly, archived, closed,
represented as Story/history rather than an ask. Founder attention is a
scarce resource. Treat unnecessary founder asks as a serious product defect.

2. REAL IOS SAFARI PERFORMANCE — The live customer product currently feels
slow, glitchy, and takes a long time to load in iOS Safari, despite mobile
E2E tests being green. Treat this observation as stronger evidence about
actual experience than functional green alone. Investigate real production
mobile performance. Do not optimize blindly. Measure first. Possible causes
to investigate include, without assuming: excessive initial JavaScript;
bundle splitting; route chunk size; hydration cost; API waterfalls;
duplicated queries; unnecessary polling; refetch storms; request
serialization; slow database queries; N+1 behavior; expensive auth
bootstrap; provider/API latency; layout thrashing; React rerenders; large
tables/lists; Map initialization; excessive animation; synchronous work;
memory pressure; Safari-specific behavior; connection assumptions; cache
configuration; stale-time configuration; service-worker behavior; font/image
loading; loading-state design; long tasks; expensive global components
mounted on every route. Determine the actual causes from evidence. Do not
merely make E2E tests faster. Make the production experience faster.

THIS IS NOT JUST A PERFORMANCE PASS — Run the platform through a
comprehensive quality program covering: functional correctness; experience
coherence; performance; mobile; responsiveness; accessibility; information
architecture; data truthfulness; AI quality; error recovery; empty states;
loading states; cross-browser behavior; real user workflows; founder
workflows; product polish; deletion of redundant UX. Do not reduce this to
Lighthouse scores or automated checks.

TEST ACREOS AS A CUSTOMER — Exercise AcreOS as if you were real users from
the supported investor archetypes. At minimum include representative
journeys for: new investor; experienced land investor; wholesaler; note
investor; rental investor where supported; other meaningfully different
supported archetypes. Do not require every persona to exercise every
feature. Choose realistic jobs. Examples: arrive for the first time;
understand what AcreOS is; create an account; onboard; reach first value;
import or create a property; investigate a parcel; evaluate an opportunity;
perform due diligence; understand valuation; work a seller/deal;
communicate; create or follow a workflow; understand documents; inspect
finances; use Map; use Deals; use Finance; use Today; use Pax; recover from
a failure; return after time away. Ask throughout: What would a real person
think is happening? What do they need to know? What are we forcing them to
understand unnecessarily? What information does AcreOS already know that
the person is being asked to re-enter? Where does the experience feel like
several products stitched together?

TEST ACREOS AS THE FOUNDER — Exercise the complete Founder experience as if
the founder had been away. Use: THE LETTER; DECISIONS; CONTROLS; STORY;
SOLENE; deep instruments only when appropriate. Test questions such as:
What happened while I was gone? Does anything actually require me? Why are
there decisions waiting? What is Growth doing? What is Engineering doing?
What changed in production? What failed? What fixed itself? What are
customers doing? What is being spent? What has AcreOS learned? Can I trust
what The Letter says? Can Story prove it? Can Solene explain it? Can
Controls actually enforce my intent? The founder experience should not
require knowledge of Claude Code, migrations, services, jobs, agents, or
internal implementation terminology.

TEST REAL PRODUCTION, NOT JUST LOCALHOST — Quality claims should
increasingly be validated against the actual deployed product. Where
technically possible and safe: verify served SHA; exercise deployed routes;
observe production APIs; measure realistic latency; verify loading
behavior; test authentication; test mobile rendering; test production data
paths; inspect real error boundaries; inspect actual caching; inspect live
integrations. Maintain clear separation between testing production behavior
and performing consequential production actions. Do not create
customer-facing external effects merely for testing unless a safe test path
exists.

BROWSER MATRIX — At minimum establish confidence in: iOS Safari; desktop
Safari; Chrome desktop; Chrome/Chromium mobile behavior; relevant WebKit
behavior. Prioritize iOS Safari because the founder has directly observed
poor behavior there. Do not claim mobile quality solely from Playwright
device emulation if real WebKit behavior materially differs. Use the
strongest practical evidence available.

CREATE EXPERIENCE PERFORMANCE BUDGETS — Establish meaningful budgets for
important flows. Examples may include: initial useful render; Today usable;
Founder Letter usable; route transition; Deal detail usable; property
detail usable; Map interactive; Pax ready; Decision action response; Story
initial render. Choose thresholds based on excellent practical UX rather
than arbitrary numbers. Track regressions. Add down-only or regression
ratchets where appropriate. Do not optimize meaningless microbenchmarks.

INSTRUMENT WHAT USERS ACTUALLY EXPERIENCE — Where privacy, cost and
architecture permit, instrument: page/route load; server response time;
slow queries; client long tasks; failed requests; repeated retries; route
abandonment; error boundaries; frontend exceptions; stalled loading; API
waterfalls; meaningful workflow completion; time to first value. Do not
create invasive surveillance. Collect only what improves product quality.

UX CORRECTNESS — Search systematically for surfaces that technically render
but are experientially false. Examples: badges with misleading counts;
stale alerts; empty tabs that imply data should exist; "success" when only
provider acknowledgment exists; unknown data shown as zero; loading shown
as empty; disabled functions that appear active; decisions that no longer
need deciding; actions that route nowhere; links to dead surfaces; old
terminology beside new terminology; duplicated status systems; error states
that look like legitimate emptiness. A technically valid render can still
be a UX defect.

LOADING EXPERIENCE — Do not accept slow behavior merely because a spinner
exists. For each major route distinguish: time until shell; time until
useful information; time until interaction; time until secondary detail.
Prioritize progressive usefulness. The user should not wait for
low-priority data before seeing high-value state. Eliminate unnecessary
blocking dependencies.

GLITCH AUDIT — Investigate perceived instability including: layout shifts;
flashing states; values changing unexpectedly; skeleton → empty → content
transitions; repeated reloads; scroll jumps; panels reopening; navigation
losing context; form state disappearing; inconsistent back behavior;
duplicate toasts; focus problems; mobile keyboard issues; touch-target
problems; animation jank; Safari viewport issues. A polished system should
feel physically stable.

PERFORMANCE + ARCHITECTURE — Treat performance failures as possible
architectural evidence. Do not simply memoize everything. A slow page may
reveal: incorrect domain boundaries; oversized endpoints; global loading;
duplicated state; unnecessary data fetching; wrong ownership of derived
data; overly generic APIs; too much client responsibility. Fix causes at
the correct layer.

ACCESSIBILITY — Audit real interaction: keyboard; focus; semantic headings;
landmarks; accessible names; contrast; touch target sizing; reduced motion;
screen-reader semantics; error messaging; form labels; status
announcements. Accessibility is part of product quality.

PAX QUALITY PROGRAM — Test Pax contextually. Determine: does it know what
the user is looking at? does it use canonical evidence? does it acknowledge
uncertainty? does it repeat information? does it request context AcreOS
already has? does it recommend nonexistent capabilities? can it safely
perform allowed actions? does it give investor-specific answers? does it
respect deterministic calculations? is latency acceptable? does its UX feel
integrated rather than bolted on? Test with realistic investor questions.

SOLENE QUALITY PROGRAM — Likewise test Solene against actual company state.
Ask difficult questions. Verify answers against: Story; decisions; metrics;
deployment state; institutional memory; current missions; costs; outcomes.
If Solene cannot support a claim from evidence, she should communicate
uncertainty. Do not optimize for confident prose. Optimize for trustworthy
executive understanding.

CROSS-SURFACE COHERENCE — A concept should not look or behave differently
in arbitrary parts of AcreOS. Audit: terminology; status language;
provenance; confidence; dates/times; money; people; properties; deals;
tasks; activity; actions; errors; AI recommendations; loading; empty
states. Continue the epistemic-UX convergence already underway.

VISUAL REFINEMENT — Once structural and performance problems are
understood, perform a deliberate visual refinement pass. Do not repaint
broken workflows. Improve: hierarchy; typography; spacing; density;
responsive composition; mobile affordances; icon consistency; surface
consistency; state language; motion; data visualization; tactile
responsiveness; empty/error/loading states. Aim for: calm intelligence.
Avoid decorative AI theater.

DELETION PASS — Quality improvement should remove software. Search for:
duplicate pages; redundant cards; duplicate metrics; dead tabs; dead
endpoints; impossible actions; stale affordances; legacy assistant
surfaces; old statuses; extra navigation; unnecessary form fields;
unnecessary loading dependencies. More capability should result in less
surface area where possible.

CUSTOMER-VALUE TEST — Do not end the program at "everything loads quickly."
Ask: Does AcreOS meaningfully help property investors perform better work?
Measure where possible: first-value time; task completion; errors avoided;
time saved; decisions improved; evidence completeness; automation
usefulness; repeated usage; activation; retention. UX quality exists to
improve outcomes.

FOUNDER-ATTENTION TEST — Likewise measure whether Founder OS actually
decreases founder burden. Important metrics may include: true founder
decisions; false founder decisions; founder asks per week; founder
minutes/week; decisions resolved autonomously; repeated founder requests;
percentage of Story requiring no action; step-away readiness. The 1,200+
decision state should be treated as a failure until understood.

ADVERSARIAL PERSONAS — Use specialist/subagent review to attack the product
as: impatient new user; experienced investor; mobile-only user; skeptical
professional; accessibility reviewer; privacy-conscious customer; founder
returning after seven days; user on slow network; user encountering
provider failure; user encountering conflicting property data. Do not have
the implementation author be the sole judge of quality.

QUALITY LOOP — Run this program through repeated loops: OBSERVE REAL
EXPERIENCE → IDENTIFY FRICTION → MEASURE → FIND ROOT CAUSE → DESIGN
IMPROVEMENT → IMPLEMENT → TEST → DEPLOY → VERIFY LIVE → OBSERVE AGAIN →
LOCK IMPROVEMENT WITH RATCHET / TEST WHERE APPROPRIATE → DELETE SUPERSEDED
UX → REASSESS. Continue autonomously. Do not ask the founder to approve
routine fixes.

DO NOT CREATE AN ENDLESS POLISH LOOP — This quality program itself requires
prioritization. Do not spend weeks perfecting a low-use icon while
important mobile routes take eight seconds to become useful. Prioritize
approximately by: broken functionality; truthful state; data loss/security
risk; founder attention failure; first-value blockers; customer-critical
workflows; performance; mobile usability; error recovery; coherence; visual
polish. Use evidence to alter prioritization.

TRANSITION OUT OF THIS PROGRAM — The program reaches a meaningful maturity
checkpoint when: major customer journeys function reliably; major founder
journeys function reliably; iOS Safari experience is demonstrably good;
important routes meet established performance expectations; Decision count
represents genuine founder attention; Solene is grounded; Pax is
contextual; errors and unknowns are honest; primary mobile workflows feel
designed; cross-surface semantics are coherent; dead/duplicate UX has been
reduced; automated tests guard major regressions; live production
verification supports the claims. Then perform an independent adversarial
audit of the complete product experience. Treat every quality claim as a
hypothesis. Repair findings. Update institutional state. Then return to
the standing Development Institution loop rather than waiting for another
founder roadmap.

FINAL QUALITY MANDATE — The codebase is not the product. The architecture
is not the product. The tests are not the product. The agents are not the
product. THE EXPERIENCE A REAL PERSON HAS USING THE RUNNING SYSTEM IS THE
PRODUCT. AcreOS should ultimately feel: fast, stable, coherent,
intelligent, honest, contextual, beautiful, and unusually easy to
understand despite the complexity underneath. Do not merely prove that
AcreOS works. PROVE THAT ACREOS IS EXCELLENT TO USE. Finish the current
consolidation program first. Then transition into this program
automatically. Continue autonomously.
