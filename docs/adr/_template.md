# ADR NNN: <short headline of the decision>

**Status**: Proposed | Accepted | Deprecated | Superseded by ADR-NNN
**Date**: YYYY-MM-DD
**Deciders**: <name(s) of the people who made the call>
**Supersedes**: ADR-NNN (omit if this is original)

## Context

What is the problem the decision is solving? Two paragraphs max. Cite the
concrete trigger — bug report, regulation, capacity ceiling, founder
ruling — that forced the choice. If the answer is "we wanted to follow
best practice," the decision isn't worth an ADR; it's just an
implementation detail.

## Decision

State the decision in one sentence. Then 2-4 sentences of what the
implementation looks like at the spine — table names, function signatures,
file locations. Reader should be able to grep for the artifacts named here.

## Rationale

Why this option over the alternatives? Show the alternatives explicitly
— if only one option was considered, the decision wasn't really made,
it was assumed. A table is often the right shape:

| Concern | Option A | Option B (chosen) |
|---------|----------|-------------------|
| ...     | ...      | ...               |

For decisions on regulated surfaces, cite the regulation (e.g.,
§1026.41(d), CCPA §1798.105) and what an enforcement-officer reading would
conclude. For decisions on customer-facing surfaces, name the persona
scenarios considered. For decisions on infra, name the load assumption
the decision was sized against (req/sec, GB stored, p95 budget).

## Consequences

What does future code now have to assume? List both the positive
constraints (the decision unlocks X) and the negative ones (the decision
forecloses Y; if Y becomes necessary, we will need ADR-MMM to supersede).
The fast disqualifier: an ADR that lists only positives is naive — every
decision has a cost, name the cost.

## References

- Commit(s) that landed the implementation: `<sha>`
- Related ADRs: ADR-NNN, ADR-MMM
- External: regulation cite, vendor doc URL, RFC number
