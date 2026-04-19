# Aggregator Rubric

Rules for combining findings from the structural, workflow, AI output, and UX coherence evaluators into a single journey verdict. The aggregator runs after all individual evaluations are complete and produces the final `JourneyVerdict`.

## Input Sources

The aggregator consumes four sets of findings:

1. **Structural findings** from `structural-rubric.md` -- each with a severity (CRITICAL, HIGH, MEDIUM, LOW).
2. **Workflow evaluation** from `workflow-rubric.md` -- friction event count, preliminary outcome, and satisfaction score.
3. **AI output evaluations** from `ai-output-rubric.md` -- each with a five-dimension score and an overall verdict (CREDIBLE, QUESTIONABLE, NOT_CREDIBLE).
4. **UX coherence findings** from `ux-coherence-rubric.md` -- each with a severity.

## Escalation Rules

Escalation rules override the workflow evaluator's preliminary outcome when structural, AI, or UX findings indicate a worse result than the workflow alone suggests. Escalation only raises severity; it never downgrades.

### Structural Escalations

- **Any CRITICAL structural finding** on the journey's core flow forces the outcome to `BLOCKED`, regardless of whether the persona found a workaround. A 500 error on a primary API endpoint is a product failure even if it was intermittent.
- **2+ HIGH structural findings** escalate the outcome to `COMPLETED_UNSATISFIED` at best. The product is technically usable but unreliable.
- **5+ MEDIUM structural findings** escalate the outcome to `COMPLETED_UNSATISFIED` at best. A pattern of console errors and slow loads indicates systemic issues.

### AI Output Escalations

- **Any NOT_CREDIBLE AI output on a core flow** (parcel analysis, valuation, due diligence, AI assistant conversation) caps the outcome at `COMPLETED_UNSATISFIED`. An AI tool that produces untrustworthy results on its primary use case fails the journey even if everything else works.
- **2+ QUESTIONABLE AI outputs** cap the outcome at `COMPLETED_UNSATISFIED`. A pattern of mediocre AI responses erodes the product's value proposition.
- **Any NOT_CREDIBLE AI output on a secondary flow** (e.g., a tooltip hint, a minor suggestion) adds a friction event but does not force an escalation by itself.

### UX Coherence Escalations

- **Any CRITICAL UX finding** (dead end on core flow) forces the outcome to `BLOCKED`.
- **2+ HIGH UX findings** escalate the outcome to `COMPLETED_UNSATISFIED` at best.

## Friction Count Integration

The aggregator adjusts the satisfaction score based on total friction events (from the workflow evaluator) combined with the severity-weighted finding count from structural and UX evaluators.

**Severity-to-friction conversion:**
- Each HIGH structural or UX finding adds 1 friction event to the total.
- Each CRITICAL finding adds 2 friction events.
- MEDIUM and LOW findings do not add friction events (they are recorded but do not affect satisfaction math).

**Satisfaction thresholds (after friction adjustment):**

| Total Friction Events | Maximum Satisfaction |
|---|---|
| 0 | 5 |
| 1 | 4 |
| 2 | 3 |
| 3-4 | 2 |
| 5+ | 1 |

If the workflow evaluator assigned a higher satisfaction than the friction count allows, the aggregator caps it. The aggregator never raises satisfaction above what the workflow evaluator assigned.

## Final Verdict Assembly

The aggregator produces a `JourneyVerdict` with:

- **outcome**: The final outcome after all escalation rules are applied.
- **satisfaction**: The final satisfaction score after friction-count capping.
- **wouldRecommend**: Derived from outcome and satisfaction per the workflow rubric rules (`yes` for satisfaction 4-5 + COMPLETED_SATISFIED, `not_yet` for satisfaction 3 or COMPLETED_UNSATISFIED, `no` for satisfaction 1-2 or ABANDONED/BLOCKED).
- **reasoning**: A one-paragraph summary that cites the escalation rules applied, the friction count, and the dominant finding category.
- **topIssues**: The 3 most impactful findings across all categories, selected by severity then by impact on the persona's stated goal. Each is a single sentence.
