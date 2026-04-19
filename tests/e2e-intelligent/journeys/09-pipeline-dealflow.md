---
id: pipeline-dealflow
name: Pipeline Dealflow
title: Pipeline Dealflow
goal: Move a deal through the full pipeline from new lead to closed acquisition, verifying stage transitions and data integrity.
description: End-to-end deal progression through the CRM pipeline stages.
start_url: /
max_steps: 150
timeout_minutes: 30
estimated_duration_minutes: 25
starting_state: Authenticated user with at least one lead in the "new" pipeline stage.
success_criteria:
  - User can view the deal pipeline with all stages visible (board or list view)
  - User advances a deal from "new" through subsequent stages (contacted, qualified, offer sent, under contract, due diligence, closing, closed)
  - Each stage transition requires or prompts for relevant data (e.g., offer amount when moving to "offer sent")
  - Pipeline stage history is recorded with timestamps and the user who made the change
  - Deal detail page updates to reflect the current stage and accumulated data
  - Invalid stage transitions are prevented (e.g., skipping from "new" directly to "closed")
success_conditions:
  - Deal successfully moves through at least 3 pipeline stages
  - Stage transition history is visible on the deal record
  - Deal detail page reflects current stage
  - No data is lost during stage transitions
abandonment_criteria:
  - Pipeline board fails to render or shows an empty state despite having deals
  - Drag-and-drop stage change does not persist after page refresh
  - Stage transition silently succeeds but the deal does not appear in the new stage column
  - Required fields for a stage transition are not enforced, allowing incomplete data
  - Pipeline view takes more than 5 seconds to load with 20+ deals
common_failure_modes:
  - Drag-and-drop on the Kanban board fires the update but the optimistic UI reverts
  - Stage transition API returns 200 but the database update fails due to a validation error
  - Deal counter per stage column is not updated after a transition
  - Moving a deal backward (e.g., from "under contract" back to "qualified") is blocked without explanation
  - Concurrent edits by multiple users cause last-write-wins data loss
---

# Journey Context

The deal pipeline is the operational backbone of a real estate professional's workflow. Every parcel they evaluate, every offer they send, every deal they close flows through a series of stages. The pipeline provides visibility into where each deal stands, what needs attention, and how the overall business is performing.

This journey tests the full pipeline lifecycle. The persona starts with a lead in the "new" stage and progresses it through the pipeline, simulating the real-world progression of a land deal from initial identification to closed acquisition.

The persona navigates to the Deal Pipeline page, which typically presents as a Kanban board with columns for each stage: New, Contacted, Qualified, Offer Sent, Under Contract, Due Diligence, Closing, Closed Acquired. Each column shows the deals currently in that stage, with key summary information visible at a glance — property address or APN, owner name, acreage, and estimated value.

The persona selects a deal in the "New" column and begins advancing it. The first transition — New to Contacted — might be as simple as clicking a "Move to Contacted" button or dragging the card to the next column. The system should prompt for or record relevant data: when was the owner contacted? By what method (phone, mail, text)? What was the outcome?

Each subsequent transition has its own data requirements. Moving to "Qualified" might require the persona to confirm the seller's asking price, motivation level, and timeline. Moving to "Offer Sent" requires an offer amount, offer date, and expiration date. Moving to "Under Contract" requires a signed purchase agreement date. Moving to "Due Diligence" triggers the due-diligence checklist. Moving to "Closing" requires a closing date and closing method. Moving to "Closed Acquired" requires the final purchase price and acquisition cost breakdown.

The persona also tests the pipeline's guardrails. Can they skip stages? They should not be able to jump from "New" directly to "Closed" — the system should enforce the stage order or at least warn about the skip. Can they move a deal backward? Sometimes a deal falls through during due diligence and needs to go back to "Qualified" — the system should allow this with a reason.

Stage transition history is important for accountability and analysis. The persona checks the deal's history to verify that each transition is logged with a timestamp, the user who made the change, and any notes. This history becomes valuable when the persona reviews their deal velocity — how long does a typical deal spend in each stage?

What "good" looks like: the persona moves a deal through 4-5 stages in under 10 minutes, the transitions feel natural and guided (not bureaucratic), the data requirements at each stage are reasonable and relevant, and the deal's detail page tells a coherent story of the deal's progression. The pipeline view loads quickly even with dozens of deals across stages, and the persona can scan the board and immediately identify which deals need attention.

Variations include: the persona manages multiple deals simultaneously (testing the board with 20+ cards), the persona uses list view instead of board view, or the persona encounters a deal that needs to move backward due to a failed inspection.
