# Journey 04: First Autonomous Decision Review

## Goal

Find a Pax-generated recommendation in the decisions inbox, understand what Pax is proposing, understand why, and approve or reject the recommendation.

## Starting State

- Logged in to AcreOS with an active account.
- Pax (the autonomous agent) has generated at least one pending recommendation or decision.
- The user has not previously interacted with the decisions inbox.
- Persona understands that Pax is an AI agent that monitors their portfolio and makes suggestions.

## Steps

1. Locate the decisions inbox, notification center, or Pax recommendations area.
2. Open a pending recommendation.
3. Read the recommendation summary — what is Pax proposing?
4. Review the supporting evidence — why is Pax recommending this?
5. Assess the confidence level and any risk indicators.
6. Determine whether the recommendation aligns with the user's goals and knowledge.
7. Approve or reject the recommendation.
8. Verify the decision is recorded and the recommendation status is updated.
9. Understand what happens next (what does approval trigger? what does rejection mean?).

## Acceptance Criteria

| # | Condition | Measurement |
|---|-----------|-------------|
| A1 | Decisions inbox is discoverable | User finds it within 1 minute; navigation makes its existence obvious (badge, menu item, notification) |
| A2 | Recommendation is understandable | Persona can explain in plain language what Pax is proposing and why |
| A3 | Supporting evidence is present and linked | The recommendation cites specific data (comps, market trends, parcel attributes) — not just a confidence score |
| A4 | Approve/reject actions are clear | Buttons or actions are unambiguous; the user knows what each choice triggers |
| A5 | Decision is persisted | After approving or rejecting, the recommendation moves out of "pending" and survives a page refresh |
| A6 | Consequences are explained | The user understands what happens after approval (e.g., "Pax will send an offer") or rejection (e.g., "Parcel moved to archive") |

## Abandonment Criteria

The persona should realistically give up if any of the following occur:

- **Cannot find the decisions inbox:** After 2 minutes of looking, the user cannot locate where Pax recommendations live.
- **Recommendation is incomprehensible:** The recommendation is presented as raw JSON, numeric scores without labels, or agent-internal language that a human cannot parse.
- **No explanation for "why":** Pax recommends an action but provides no supporting reasoning, data, or context.
- **Cannot figure out how to respond:** The UI shows a recommendation but no clear approve/reject mechanism, or the buttons are ambiguous (e.g., unlabeled icons).
- **Fear of irreversibility:** The user cannot tell whether approving is reversible or what it will actually trigger, so they refuse to act.

## Failure Conditions

These are unrecoverable errors that terminate the journey immediately:

- **Decisions inbox returns error:** The page crashes or returns a 500 when loading recommendations.
- **Recommendation references nonexistent data:** Pax cites a parcel, lead, or deal that does not exist in the user's account.
- **Action triggers without confirmation:** Clicking approve immediately executes an irreversible action (sends offer, deletes record) without a confirmation step.
- **Decision not recorded:** The user approves or rejects, but the recommendation remains in "pending" state and the action is lost.
- **Pax acts despite rejection:** The user rejects a recommendation, but Pax proceeds with the action anyway.
