---
id: skip-trace-and-outreach
name: Skip Trace and Outreach
title: Skip Trace and Outreach
goal: Find a property owner's current contact information via skip tracing and initiate an outreach sequence.
description: Owner contact lookup through skip tracing followed by outreach sequence creation.
start_url: /
max_steps: 130
timeout_minutes: 25
estimated_duration_minutes: 20
starting_state: Authenticated user with leads that have missing or outdated contact information, BatchData API key configured.
success_criteria:
  - User selects one or more leads for skip tracing
  - Skip-trace request is submitted to the provider (BatchData) and returns results
  - Returned contact data (phone, email, current address) is merged into the lead record
  - Credit deduction for the skip-trace lookup is visible and correct
  - User can initiate an outreach sequence (call, text, or email) using the returned contact info
  - Provider circuit breaker and fallback behavior is transparent if the primary provider fails
success_conditions:
  - Skip-trace results return at least one contact method per lead
  - Lead record is updated with new contact information
  - Credit usage is logged and visible
  - Outreach sequence is created or initiated
abandonment_criteria:
  - Skip-trace button is grayed out with no tooltip explaining why
  - Submission succeeds but results never appear (stuck in pending state)
  - Credit balance shows zero but there is no clear path to purchase more credits
  - Returned phone numbers are not formatted consistently (mixing formats)
  - Outreach sequence creation requires re-entering contact info that was just skip-traced
common_failure_modes:
  - BatchData API returns partial results (phone but no email) without indicating the gap
  - Skip-trace merge overwrites existing high-quality contact data with lower-confidence results
  - Batch skip-trace of 100+ leads exceeds API rate limits and fails without retry
  - Credit deduction happens even when the provider returns zero results
  - Phone numbers are stored without E.164 normalization, breaking outreach integrations
---

# Journey Context

Skip tracing is the bridge between having a list of property owners and actually reaching them. County records often have outdated mailing addresses — the owner moved, the property was inherited, or the record simply was never updated. Skip tracing fills in the gaps: current mailing address, phone numbers (mobile and landline), email addresses, and sometimes additional data like age and associated persons.

This journey tests the skip-trace-to-outreach pipeline. The persona has a set of leads — perhaps from a recent CSV import or from filtering existing CRM records — where contact information is missing or suspected to be outdated. They want to find current contact details and then immediately start reaching out.

The persona begins in the Leads list or the Skip Tracing section. They select the leads they want to trace — either individually or in bulk (selecting 10-50 leads at once). The skip-trace interface should clearly display: how many records are selected, the estimated cost (number of records times per-record rate, typically $0.05-0.20), and the current credit balance. If the persona does not have enough credits, the system should say so before they submit, not after.

Upon submission, the system sends the batch to the configured provider (BatchData is the primary integration). The persona waits for results — for a small batch of 10-20 records, this should take under 30 seconds. A progress indicator or real-time result stream keeps the persona informed. For larger batches, background processing with notification is appropriate.

Results are displayed in a summary view: 18 of 20 records matched, 2 not found. For each matched record, the persona can see what was returned — phone numbers, emails, current address — and the confidence score. The system merges these results into the lead records automatically, but crucially, it should not overwrite existing data that the persona entered manually unless the new data has higher confidence.

With fresh contact information in hand, the persona pivots to outreach. They might create a calling sequence (call each lead, follow a script, log the outcome), a text/SMS campaign, or an email drip sequence. The outreach tools should pull contact information directly from the lead record — the persona should never have to copy-paste a phone number from one screen to another.

Credit management is a subtle but important aspect. Each skip-trace lookup costs credits. The persona needs to understand their credit balance, the cost per lookup, and how to purchase more credits when they run low. This information should be accessible without navigating away from the skip-trace workflow.

What "good" looks like: the persona skip-traces a batch of leads, gets results within a minute, reviews the data quality, and launches an outreach sequence — all within a single workflow session, without leaving AcreOS or opening a separate tool. The persona feels like the platform saved them the tedious work of manually searching for contact information and copy-pasting it into a spreadsheet.

Variations include: the primary provider (BatchData) fails and the system falls back to an alternative, the persona traces a single lead rather than a batch, or the persona re-traces leads that were previously traced to check for updated information.
