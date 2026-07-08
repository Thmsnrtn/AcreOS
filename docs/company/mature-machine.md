# The Mature Machine — AcreOS North Star

*The founder's brief: a rock-solid, self-maintaining, passive-income machine
that supports a family for decades. This document defines what that machine
looks like finished, the gates that mark progress toward it, and the horizons
between gates.*

*Layering: `CONSTITUTION.md` (who we are — never changes) → **this document**
(where we're going — gates and horizons) → `roadmap-YYYY-MM.md` (current
waves under the active horizon) → `autopilot-step-away-doctrine.md` (the
autopilot layer's source of truth) → decision memos (single calls). Wave-level
execution never lives here. Reviewed at every gate crossing and annually with
the Constitution; gate crossings are recorded in place with dates.*

Founder-ratified parameters (2026-07-07): terminal founder role is
**read The Letter, decide rarely** (hours per month, not per week);
organizational form is **solo + agent fleet, by design** (no employees —
every "hire for this" moment becomes an automation requirement); ambition is
**land-deep first, then the broader REI verticals via the conveyor** (§1.2).

---

## 0. The scoreboard

Two numbers, forever:

1. **MRR and its composition** — mature when no single stream exceeds ~50%.
2. **Founder attention: minutes/week per $1K MRR** — measured by the
   step-away readiness surface and Decisions-door throughput. Mature =
   **≤ 2–4 founder hours/week at ≥ $100K MRR**, concentrated in The Letter
   (read), Decisions (a handful/month), a quarterly budget ceiling, and the
   annual constitution review.

A horizon is only "done" when both numbers moved the right direction.
Optimizing MRR while attention rises is failure; so is the reverse.

## 1. The machine at maturity

### 1.1 Product & moat

- **The Land Credit Score is the FICO of rural land**: published, versioned
  methodology; a free single-parcel lookup as the permanent top of funnel;
  cited by land lenders, title shops, and buyers. The score is the brand;
  AcreOS is the terminal you use it in.
- **Data moat, three layers**: (a) county assessor coverage run as an
  industrial ETL line — prioritized by land-transaction volume, per-source
  health ledgers, self-healing scrapers; (b) `transaction_training` fed by
  every on-platform closed deal — proprietary, arm's-length-verified outcome
  data no vendor sells; (c) the valuation model retraining and auto-promoting
  on that private corpus. The flywheel: more customers → more closed deals →
  better model → better scores → more customers.
- **The wedge, complete end to end**: lead in → mail out → seller responds →
  AI-drafted offer → contract → close → seller-financed note → **serviced
  on-platform**. Once a customer's loan book lives here, churn means
  re-platforming a business.
- **Marketplace with real liquidity** in the top land corridors: deals
  sourced by one customer sold to another, take-rate on the transaction,
  buyer-intent data feeding demand signals back into the score.

### 1.2 The vertical conveyor

Land-deep and multi-vertical are not in tension if they are *sequenced*.
The architecture already anticipates this: the five doors are
persona-invariant; verticals are content behind fixed doors. The mature
machine is therefore a **repeatable vertical-winning engine** — the same
playbook (wedge → data moat → autonomy) re-run, one vertical at a time, on
the waitlisted business types.

**The conveyor rule:** only one vertical activation in flight at a time, and
none until the previous one is profitably won (its pack revenue covers its
maintenance surface). Land/notes/hybrid through the first horizons;
tax-lien and wholesaler graduate from beta next (they feed the same deal
flow); buy-and-hold, STR, commercial and the rest activate later, in
whatever order demand evidence dictates.

**Frozen ≠ deleted.** Beta verticals are frozen with written reactivation
criteria in the deletion ledger. Genuinely speculative modules are deleted.

### 1.3 Revenue architecture at maturity (target composition)

| Stream | Nature | Target share |
|---|---|---|
| Subscriptions + seats | Base | 30–40% |
| Note-servicing per-loan fees | Regulated, stickiest | 20–25% |
| Vertical packs (the conveyor's output) | Expansion | 10–15% |
| Usage credits (data, AI, mail) | Activity-scaled | 10% |
| Marketplace take-rate | Liquidity-scaled | 10% |
| Land Credit Score API / data licensing | Highest margin | 10–15% |

**Explicit non-stream: AcreOS never buys land or trades notes as
principal.** The autopilot-as-fund is the most tempting terminal form and it
breaks everything the brief asked for — family capital at market-cycle risk,
a different regulatory regime, and platform-neutrality corruption (customers
will not feed `transaction_training` to a competitor-bidder). If ever
pursued: separate entity, separate capital, outside this document.

### 1.4 The autonomy ladder, fully climbed

End state per domain. Every promotion is still earned through the trust
ledger's clean-cycle physics; this table is the destination, §4 is the
pre-committed schedule.

| Domain | End state |
|---|---|
| Support | Full auto-resolve; human-escalation contractor only for the residue |
| Billing recovery / dunning | Full auto |
| Deliverability & compliance ops | Full auto; DNC/litigator scrub continuous |
| Growth: content/SEO | Full auto within the brand constitution |
| Growth: paid ads | Auto within budget ramp + CAC guardrails; founder sets a quarterly ceiling only |
| Engineering: dependencies & security patches | Auto-merge green patch-level; minor/major via self-patch PR + canary |
| Engineering: self-patch (bugs, deletion, debt) | PR-gated forever; auto-merge only for deletion and green-dependency classes |
| Incidents | Autonomous detect→mitigate→postmortem; founder paged only for novel-class or money/legal |
| Pricing, legal signing, spend >$500, customer-data deletion | **Never autonomous — permanent hard-stops** |

The founder surface stays exactly the four doors: The Letter / Decisions /
Controls / Story. The panic stop stays env-level and unwritable by the
machine, forever. The registration-time `requiresApproval: true` invariant
and the experience-log sacred line are non-negotiable.

### 1.5 Organizational form

Solo founder + agent fleet + a thin human shell: the LLC, Mercury, a
fractional CPA, a retained attorney (TCPA / Reg Z / state servicer
licensing), optionally one part-time support-escalation contractor past
~500 customers. No employees, by design.

### 1.6 The codebase at maturity

**Smaller than today.** Code mass is the existential risk to passive
ownership — a machine the owner (and the agents' context windows) cannot
hold is a machine that cannot be trusted unattended.

- ≤ 600K LOC and ≤ 450 tables by the end of H2; thereafter LOC grows only
  net of deletions and never faster than MRR.
- All lint ratchets blocking; coverage *gating* (not report-only) on
  money/send/compliance paths; credentialed wedge E2E in CI.
- Zero module-level mutable cross-request state (DB-backed per house style).
- `storage.ts` decomposed; `docs/exhaustive-completion` archived.

## 2. Maturity gates

Gates are AND-conditions — revenue AND reliability AND autonomy AND
economics. Consistent with the approved 25/50-customer ladder
(`roadmap-2026-07.md`) and the $200-MRR Phase-1 trigger
(`phase-1-launch-runbook.md`).

| Gate | Revenue / customers | Reliability | Autonomy (trust ledger) | Economics |
|---|---|---|---|---|
| **G0 → H1** (first ad dollar) | — | Wedge E2E green in CI; 30d clean uptime probes; module-state risk fixed or pinned | All acting switches OFF; §4 schedule ratified | DNC scrub vendor live; COGS ceilings tier-proportional |
| **G1 → H2** | 25 paying (~$2K MRR); $200 MRR held 30d fires the Phase-1 runbook | <2 founder pages/week; dunning recovery measured working | Support + billing at `execute` | Gross margin ≥70%; CAC measured, not null |
| **G2 → H3** | 100 paying (~$8K MRR); ≥10 closed deals in `transaction_training`; first organic cross-customer deal | 99.9% quarterly probe uptime; error-budget policy live | Content at `execute`; ads at `execute_gated` | LOC ≤650K & tables ≤500 (deletion campaign delivering) |
| **G3 → H4** | ~500 paying ($40–60K MRR); servicing GA ≥50 loans; API private beta with ≥5 design partners | <1 founder page/week; ≥80% incidents auto-resolved | Ads at `execute` within ramp; self-patch auto-merge (deletion/dep classes) | Non-subscription revenue ≥30% |
| **G4 → H5** | $100–150K MRR; API/data GA | Founder ≤4 hrs/week for a full quarter, verified by the step-away surface | Full ladder end state (§1.4) | 12-month runway held in the LLC; charity ratchet per Constitution |

## 3. Horizons

Each horizon carries a **debt/deletion allocation — a floor, never a cap** —
because shrinkage is survival work, not cleanup.

### H0 — Arm the wedge (now → first ad dollar) · debt floor 30%

Theme: everything ads will pay to exercise must be true, tested, and safe;
everything else must be unable to hurt us.

- Finish `roadmap-2026-07.md` open items (W6.3, W7 starters, query
  consolidation) and the pending founder decisions (DNC vendor; free-tier
  first send; sales-data license).
- Execute the pre-ad hardening list (§6).
- Resolve persona positioning: wedge positioning now; beta-vertical internal
  surface frozen/deleted in H2; note-servicing slotted as the H2 engine.
- **No acting switches flip in H0.** The machine keeps thinking and
  briefing; the §4 schedule is ratified here so H1 flips are pre-decided
  policy, not month-by-month anxiety.

### H1 — Win the wedge, earn first autonomy (first dollar → 25 customers) · debt floor 20%

Theme: one persona (land flipper), one loop (lead→mail→reply→offer), one
channel at a time.

- Ads: founder activates the Meta campaigns the machine drafts — witnessed,
  paused-by-default; the budget ramp earns +50% steps on CAC proof.
- Time-to-first-mail is the product metric; onboarding <90s-to-value is
  defended as sacred.
- The interaction-capture seam lands so learning loops run on real sessions
  (the blocked-on-users item from the July roadmap).
- Phase-1 runbook fires at $200 MRR held 30 days.
- **Switches** (per §4): support auto-resolve after clean cycles on real
  tickets; dunning/billing recovery (reversible, measurable);
  deliverability `execute_gated`. Ads and self-patch stay witnessed.

### H2 — Second engine + the deletion campaign (25 → 100) · debt floor 35%

Theme: add the sticky regulated engine; make the codebase holdable for
decades.

- Note-servicing productized and repriced ($99–299/portfolio class) as the
  downstream of won land deals — flip → seller-finance → service; the
  customer never leaves. State-licensing/compliance scaffolding built once,
  properly.
- Marketplace *seeding*, not building: concierge-match the first
  cross-customer deals; GA only on liquidity proof.
- **The deletion campaign**: execute the deletion ledger verdicts —
  speculative modules deleted, beta verticals frozen with reactivation
  criteria; `storage.ts` decomposition completes; targets ≤600K LOC /
  ≤450 tables.
- **Self-patch flips here, aimed first at deletion work** — the safest
  class of autonomous engineering to learn on.
- **Switches**: content/SEO acting; ads `execute_gated`; self-patch PR-mode.

### H3 — Industrialize the moat (100 → 500) · debt floor 25%

Theme: the data business becomes real.

- County ETL as a production line: coverage by transaction-volume priority;
  per-source health ledger; scraper self-healing.
- Land Credit Score methodology published; free lookup as permanent
  top-of-funnel; score versioning and drift monitoring.
- API private beta (the 50-customer trigger) matures into a priced,
  metered data product.
- Second ad channel (the Google adapter is prewired).
- **First conveyor activation** (tax-lien or wholesaler out of freeze).
- **Switches**: ads acting within ramp; self-patch auto-merge for deletion
  + green dependency patches; autonomous incident response GA.

### H4 — The data & servicing business ($60K → $150K MRR) · debt floor 20%

- API/data licensing GA (lenders, title, funds); marketplace take-rate
  meaningful; the servicing book compounds; next conveyor activation.
- Multi-region/DR posture finally justified — not before — proven by a
  rehearsed cold rebuild from the infra portability doc.

### H5 — Steady state (the passive machine) · debt floor 20%, forever

- Founder cadence: The Letter weekly-read, Decisions a few/month, quarterly
  budget ceiling, annual constitution review.
- Growth, support, ops, and engineering maintenance all inside the ladder's
  end state; the conveyor activates verticals at whatever pace the gates
  allow.
- Succession pack tested annually (§5.7).

## 4. The autonomy switch schedule (pre-commitment)

Ratified in H0 so no switch flip is ever an ad-hoc founder mood. Every flip
still requires the trust ledger's earned clean cycles — this schedule is
*when a domain becomes eligible*, not a bypass.

| Domain | Eligible at | Proof required before acting | Permanent constraints |
|---|---|---|---|
| Support auto-resolve | G1 cohort live | 10 clean witnessed cycles on real tickets | Escalation path always open; refunds hard-stop |
| Dunning / billing recovery | G1 | Recovery ladder measured working; reversible sends only | No pricing changes, ever |
| Deliverability & compliance ops | G1 (`execute_gated`) | Clean scrub + STOP audit trail | DNC scrub fail-closed for cold outreach |
| Growth: content/SEO | G2 | Brand-constitution conformance on witnessed batch | No claims the truth-engine can't verify |
| Growth: paid ads | G2 `execute_gated` → G3 `execute` | CAC truth exists; budget ramp steps earned +50% at a time | Quarterly ceiling founder-set; panic stop halts spend |
| Self-patch engineering | H2 PR-mode → G3 auto-merge (deletion/dep classes only) | Green CI + canary + clean revert path per class | PR-gated forever for all other classes |
| Incident response | G3 GA | ≥80% auto-resolution on shadowed incidents | Novel-class and money/legal always page |
| Pricing, legal, >$500 spend, data deletion | **Never** | — | Hard-stops permanent; env-level panic stop unwritable by the machine |

## 5. What "self-maintaining for decades" demands

Requirements normal SaaS never writes down:

1. **Autonomous incident response** — detect→diagnose→mitigate→postmortem
   with a founder-page budget as an SLO; novel incidents auto-generate
   runbooks.
2. **Vendor rotation seams** — every external dependency (Lob, Twilio,
   Clerk, Stripe, Fly, model providers, every county source) gets a health
   probe, a spend monitor, a documented failover seam, and an annually
   answered "could we swap it in a month?" County scrapers are the
   highest-churn vendor class; their self-healing is H3 core product work.
3. **Model migration as config, not incident** — central model registry
   (done) + deprecation watch + an eval harness so a model sunset is a
   gated config change.
4. **Fail-closed money gates, forever** — the fixed fail-open entitlement
   gates stay fixed; this stance is sacred.
5. **Legal/compliance automation** — continuous DNC/litigator scrub; STOP
   machinery (do-not-regress); when servicing ships: Reg Z statement
   automation and a state-license renewal deadman.
6. **State discipline** — zero module-level mutable cross-request state;
   the outbox/lease-row pattern is the house style — finish the job.
7. **Succession & bus-factor (the family clause)** — a sealed estate pack:
   panic stop, Fly/Mercury/Stripe/Clerk access, the Owner's Manual,
   sell-vs-run guidance, broker contacts. Tested annually with a verified
   step-away drill (founder absent N days; the machine and The Letter carry
   it). This is a gate item, not an afterthought.
8. **Docs-truth ratchet** — the written record must not drift from the code
   (the `replit.md` class of rot); stale docs are deleted or corrected at
   every gate crossing.

## 6. The bridge to now: pre-ad-campaign priorities (H0 exit criteria)

These slot into or extend `roadmap-2026-07.md`'s waves; execution status is
tracked there and in the deletion ledger, not here.

1. DNC/litigator scrub vendor decided and wired (live TCPA exposure until
   then; the scrub seam ships fail-closed for cold outreach).
2. Free-tier first send decision (capped free send recommended — the wedge
   is the demo) and the sales-data license to seed `transaction_training`
   in launch counties.
3. The module-level state files fixed or pinned (correctness before
   traffic).
4. Credentialed wedge E2E (signup → lead → mail → SMS reply → offer) in CI.
5. ESLint blocking; coverage gating on money/send/compliance paths.
6. Land Credit Score public artifact: methodology page + free
   single-parcel lookup as the ad landing surface.
7. §4 switch schedule ratified; Phase-1 runbook paperwork pre-staged.
8. Ad path validated end-to-end at $5/day before real budget (the
   ad-buying hands, budget ramp, and attribution have never carried real
   spend).
9. Docs truth pass: stale docs corrected, `docs/exhaustive-completion`
   archived, this strategy layer cross-linked.
10. Deletion ledger opened: keep/kill/freeze verdict per speculative
    module (deletions execute in H2).

## 7. Traps (named, so future-us doesn't step in them)

1. **Fifteen verticals before one is won** — the conveyor rule (§1.2)
   exists to prevent exactly this.
2. **Marketplace polish before liquidity** — it's built; the scarce input
   is cross-customer deal flow. Gate on that.
3. **Autonomy switches before revenue** — trust needs real outcomes;
   flipping acting switches pre-cohort automates guessing.
4. **The autopilot doing deals as principal** — §1.3's non-stream; the
   seductive wrong terminal form.
5. **API before the moat is real** — selling thin data once burns the data
   brand permanently.
6. **More code as progress** — the ratchet is net-negative LOC until §1.6
   targets hit; planning-artifact sprawl counts too.
7. **Courses / white-label / education revenue** — adjacency risk plus a
   support surface a solo owner cannot carry; keep dead.
8. **Infra over-engineering** — two Fly machines + pgbouncer is right-sized
   for years; multi-region waits for H4.
9. **Repricing as "regulated fintech" before servicing earns it** — price
   follows the shipped compliance moat, not the pitch.

---

*Maintenance: reviewed at every gate crossing and annually with the
Constitution. Record gate crossings in place with dates. Dated roadmaps are
regenerated per horizon from the active horizon's workstreams; this document
changes only when the destination or the gates change.*
