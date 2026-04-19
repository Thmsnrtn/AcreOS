# Workflow Rubric

Rules for evaluating journey outcomes, friction events, and persona satisfaction. These map directly to the `JourneyVerdict` type in `src/harness/types.ts`.

## Journey Outcome Definitions

### COMPLETED_SATISFIED

The persona completed the journey's stated objective and all acceptance criteria defined in the `JourneyConfig.successConditions` array are met. The persona encountered no more than minor friction and would realistically continue using the product. The AI outputs encountered (if any) were rated CREDIBLE. The persona's in-character reasoning reflects confidence in the product.

### COMPLETED_UNSATISFIED

The persona technically completed the journey (reached the end state, data was saved, the action executed) but the experience was poor enough that a real user matching this persona would not return without improvement. Triggers include: excessive friction (3+ friction events), confusing information architecture, AI output rated QUESTIONABLE or NOT_CREDIBLE on a core flow, or a workflow that required unintuitive workarounds. The task got done but the persona is not sold.

### ABANDONED

The persona quit the journey before completing the objective for a reason that is realistic given their backstory. Abandonment must align with the persona's defined `abandonmentTriggers` and `patience` level. A persona with `patience: "low"` abandons after 2 friction events. A persona with `patience: "high"` persists through 4-5 before quitting. The abandon decision records the persona's in-character reasoning for leaving.

### BLOCKED

The persona cannot proceed due to a product defect, not a persona choice. A 500 error on the only path forward, a form that cannot be submitted, a required page that does not load. BLOCKED is a product problem; ABANDONED is a persona problem. If a workaround exists, the outcome is not BLOCKED -- it may be COMPLETED_UNSATISFIED.

## Friction Events

A friction event is any moment where the persona must stop, re-read, backtrack, retry, or express confusion in their in-character thought. Friction events are counted per journey and feed into both the outcome and satisfaction score.

**Counting rules:**
- Each distinct friction moment counts as one event, even if it spans multiple steps.
- Repeated friction from the same root cause (e.g., clicking a broken button three times) counts as one event, not three.
- A friction event caused by the persona misunderstanding the UI (given their tech comfort level) still counts -- the product should be clear to its target audience.
- Console errors that the persona cannot see do not count as friction events (they are structural findings only).

## Satisfaction Scale (1-5)

| Score | Label | Criteria |
|---|---|---|
| 5 | Delighted | Zero friction. Journey felt intuitive. Persona's in-character thought expresses positive surprise. |
| 4 | Satisfied | 1 minor friction event. Persona completed confidently. Would recommend. |
| 3 | Neutral | 2 friction events, or 1 significant one. Persona completed but with reservations. |
| 2 | Dissatisfied | 3+ friction events. Persona completed but expressed frustration. Would not recommend yet. |
| 1 | Frustrated | Journey abandoned or blocked. Or completed but with so much friction that the experience was negative. |

## Would Recommend

Derived from satisfaction and outcome:
- `yes` -- satisfaction 4-5 and outcome is COMPLETED_SATISFIED.
- `not_yet` -- satisfaction 3 or outcome is COMPLETED_UNSATISFIED.
- `no` -- satisfaction 1-2 or outcome is ABANDONED/BLOCKED.
