# Decision memo — Develop every vertical to its fullest (2026-10-04)

**Decider:** Founder ("take the reins on this and develop every vertical to its
fullest potential"). The engineering rulings below were delegated to the
engineering lead in the same instruction.
**Status:** DECIDED.

## Context

The landing labels 13 of 15 investor verticals BETA. That label is enforced, not
editorial: `shared/business-types/publicClaims.ts` lowers the public claim (OD-5,
2026-08-17) until a vertical closes the canonical loop. Closing it means a
production surface records a deterministic **scenario** with the vertical's own
economics, then a **decision** citing it, with a review date. That review date is
what makes the Today door ask for the outcome, and outcomes are what feed
calibration. Only fix-and-flip and subdivider qualified.

Measured 2026-10-04: every vertical has real surfaces (modules, templates,
operating maths). The gap is the loop, not the screens. Five economics engines
already exist (land deal, flip MAO, note payoff, rental returns, multifamily
NOI); three of them are never called from production.

## Decision

1. **The vertical program runs now, ahead of W10.2–W10.8.** It is feature work,
   and the 2026-09-30 stop rule would otherwise freeze it after W10.8. The
   founder directs that it proceed. The stop rule still governs everything else.
2. **Definition of done for a vertical** ("fullest potential"). The
   vertical's core underwriting decision is:
   - computed by a deterministic, versioned, tested engine;
   - frozen as a scenario;
   - recorded as a decision under the vertical's own strategy pack, citing that
     scenario;
   - given an operator-chosen review date, so it becomes gradeable;
   - reachable from a surface behind one of the existing doors.

   Then its BETA demotion is removed in the same commit that earns it. No new
   doors, no new verticals, no invented numbers.
3. **Ownership ruling (evidence rule v2).** A decision counts for a vertical when
   the scenario behind it was computed by an engine that **declares** that
   vertical, and the decision is recorded under that vertical's strategy pack.

   It no longer turns on which menu a page sits in. The old rule (route file
   owned by nav gating) would have kept land BETA: its blind-offer wizard is
   land arithmetic, land rules and a land fee-simple guard, but it is reachable
   from the Map door by every persona. The new rule is stricter where it
   matters:
   - a CRM batch with no scenario does not count;
   - the generic decisions API does not count;
   - a scenario from another vertical's engine does not count, and neither does
     a scenario the decision does not itself cite (one recorded by another
     handler in the same file);
   - a local function named like the stores does not count; the calls must be
     the real, imported ones;
   - an endpoint no client surface calls does not count.

   `tests/support/verticalEvidence.ts` implements the rule with the TypeScript
   parser, and `verticalReadiness.test.ts` holds a canary for each clause.
4. **Composite verticals.** `hybrid` (land + notes) is decided when both of its
   parts are, because its surfaces are exactly theirs.
5. **Gradeability is part of done.** A vertical's decision route must require
   the review-date answer rather than hard-coding none. Null ("no set date") is
   an answer; an omitted key is refused, because an optional key let the land
   wizard record "never" without anyone choosing it. Its engine must predict
   `acquisition_cost` or `profit`, the metrics the outcome prompt measures (`shared/outcomes/outcomeMeasures.ts`; `total_cost` until DEFECT-0287). The
   law is universal over the decisions that CREDIT a vertical: one ungradeable
   crediting route makes the vertical ungradeable. Decisions that credit
   nothing are outside it — the offer-letter batch (no scenario) and the
   generic `POST /api/decisions` (optional review date, any pack) record land
   and other decisions the law does not read.

## Options not taken

- Gating the blind-offer wizard to land personas, so land "owns" it by menu.
  This removes a working tool from every other persona to satisfy a proxy.
- Counting any decision tagged with a strategy pack. Too weak: a pack id is a
  string anyone can write.
- Relabelling verticals `core` without closing the loop. That fabricates a
  public claim.

## Waves

- **V0:** the evidence rule v2, the shared underwriting kit, land promoted, and
  buy-and-hold built on the kit as its reference vertical.
- **V1:** wholesaler, multifamily, developer, note investor, then hybrid.
- **V2:** short-term rental, commercial, creative finance, tax lien / deed,
  mobile home / park, agent-investor, and subdivider made gradeable.

Each wave runs the full gates, then an independent audit, then a commit.
Pushes to `main` (which deploy production) remain the founder's call.
