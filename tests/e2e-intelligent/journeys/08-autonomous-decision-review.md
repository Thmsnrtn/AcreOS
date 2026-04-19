---
id: autonomous-decision-review
name: Autonomous Decision Review
title: Autonomous Decision Review
goal: Locate, review, and approve or reject a recommendation made by the Pax autonomous executor.
description: Review and act on an autonomous AI recommendation from the Pax executor cycle.
start_url: /
max_steps: 100
timeout_minutes: 20
estimated_duration_minutes: 15
starting_state: Authenticated user with at least one pending autonomous recommendation in the decisions inbox.
success_criteria:
  - User navigates to the decisions inbox or AI Hub and finds pending recommendations
  - Each recommendation displays the action proposed, confidence score, and reasoning
  - User can view the underlying data that informed the recommendation
  - User can approve, reject, or modify the recommendation
  - Approved recommendations are executed and the result is logged
  - Recommendations above the $500 hard-stop threshold are clearly flagged as requiring manual approval
success_conditions:
  - Decisions inbox shows at least one pending recommendation
  - Recommendation detail displays confidence score and reasoning
  - User can take an approve or reject action
  - Action result is confirmed in the UI
abandonment_criteria:
  - Decisions inbox is empty with no explanation of how to trigger autonomous recommendations
  - Recommendation shows a confidence score but no reasoning or supporting data
  - Approve button executes an action with no confirmation step
  - There is no way to see what action will be taken before approving
  - Rejected recommendations reappear in the inbox without being marked as reviewed
common_failure_modes:
  - Autonomous executor cycle has not run, so the inbox is genuinely empty
  - Confidence score is displayed as a raw decimal (0.78) instead of a percentage (78%)
  - Recommendation reasoning references internal system IDs instead of human-readable names
  - Approval triggers a 500 error because the underlying action's prerequisites are no longer met
  - Hard-stop threshold is not enforced, allowing high-value actions to auto-execute
---

# Journey Context

The autonomous executor is one of AcreOS's most distinctive features — and one of the most trust-sensitive. Every 30 minutes, the Pax executor cycle scans the decisions inbox, evaluates pending items, and auto-executes any recommendation that meets the confidence threshold (75% or above) and falls below the financial hard stop ($500). Recommendations above the threshold or below the confidence level wait for human review.

This journey tests the human-in-the-loop side of that equation. The persona is not watching the system in real time — they log in after the executor has already run a cycle or two, and they need to review what it recommended, understand why, and decide whether to approve or reject.

The persona navigates to the decisions inbox, which might live in the AI Hub, the Inbox section, or a dedicated Autonomous Decisions page. They see a list of pending recommendations, each with a summary, a confidence score, and a status (pending, auto-executed, approved, rejected). The persona clicks into a pending recommendation to see the full detail.

The recommendation detail page is where trust is built or broken. The persona needs to see: what action the system is proposing (e.g., "Send blind offer letter to John Smith for parcel APN 123-456-789 at $4,500"), the confidence score (e.g., 82%), and the reasoning chain that led to the recommendation (e.g., "Comparable sales in this area average $12,000/acre. Parcel is 1.2 acres with no access issues. Recommended offer at 30% of estimated value. Owner has been delinquent on taxes for 3 years, indicating motivation to sell.").

The persona evaluates this reasoning against their own judgment. Maybe they agree with the analysis but think the offer price is too high. Maybe they disagree with the comp selection. Maybe they approve it as-is. The interface should support all three outcomes: approve (execute the action), reject (dismiss with a reason), or modify (adjust the parameters and then approve).

For recommendations that were auto-executed (because they met the confidence threshold and were below $500), the persona reviews the outcome. Did the action succeed? What was the result? Can it be undone if the persona disagrees? This retrospective review is important for calibrating trust in the autonomous system over time.

The $500 hard stop is a critical safety mechanism. Any recommendation that involves spending over $500 (e.g., a large direct-mail campaign, an offer on an expensive parcel) must require manual approval regardless of confidence score. The persona verifies that these are clearly flagged and cannot be auto-executed.

What "good" looks like: the persona reviews 3-5 recommendations in under 10 minutes, understands the reasoning behind each one, makes informed approve/reject decisions, and feels like the autonomous system is a helpful assistant that respects their authority — not a black box making decisions without their input. The persona might approve 3, reject 1 (with a note about why the comp selection was wrong), and modify 1 (adjusting the offer price downward).

Variations include: the inbox is empty because no executor cycle has run (the system should explain this clearly), all recommendations were auto-executed (the persona reviews outcomes only), or a recommendation fails on approval because the underlying data has changed since it was generated.
