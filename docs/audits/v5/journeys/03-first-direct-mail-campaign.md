# Journey 03: First Direct Mail Campaign

## Goal

Create a direct mail campaign targeting selected parcels or leads, understand the cost and compliance implications, and queue it for sending.

## Starting State

- Logged in to AcreOS with an active account.
- Has leads in the system (at least 5-10 with mailing addresses).
- Has not created a campaign before.
- Persona understands direct mail as a lead generation strategy but has not used AcreOS's campaign tools.

## Steps

1. Navigate to the campaigns or direct mail section of the application.
2. Initiate campaign creation.
3. Select target leads or parcels for the campaign.
4. Choose or customize a mail template/letter.
5. Review the recipient list and verify addresses look correct.
6. Review cost breakdown (per piece, total, any platform fees).
7. Review compliance information (CAN-SPAM, state-specific rules, opt-out requirements).
8. Confirm and queue the campaign (in test mode if available).
9. Verify the campaign appears in a queue or history view with correct status.
10. Understand what happens next (when it sends, how to track results).

## Acceptance Criteria

| # | Condition | Measurement |
|---|-----------|-------------|
| A1 | Campaign creation is discoverable | User finds the entry point within 1 minute of looking |
| A2 | Lead/parcel selection works correctly | Selected count matches expected; filters narrow results as intended |
| A3 | Cost is transparent before commitment | Total cost, per-piece cost, and any fees are displayed before the user confirms |
| A4 | Compliance requirements are clear | Any legal obligations (return address, opt-out, state rules) are surfaced — not buried |
| A5 | Campaign is queued successfully | Campaign appears in queue/history with status "queued" or "test" and correct recipient count |
| A6 | User understands the next step | The UI explains when mail will be sent, how to track delivery, and how to cancel if needed |

## Abandonment Criteria

The persona should realistically give up if any of the following occur:

- **Campaign creation not findable:** After 2 minutes of navigation, the user cannot locate where to create a direct mail campaign.
- **Compliance is confusing or scary:** Legal language is presented without context, making the user afraid they will violate regulations without understanding what is required.
- **Cost is unclear or hidden:** The user cannot determine what the campaign will cost before committing, or costs appear only after irreversible actions.
- **Template system is broken or empty:** No templates are available, or the template editor does not load.
- **Lead selection is broken:** Filters do not work, selected leads disappear, or the count is clearly wrong.

## Failure Conditions

These are unrecoverable errors that terminate the journey immediately:

- **Campaign creation endpoint crashes:** Submitting the campaign returns a 500 error.
- **Leads sent to wrong addresses:** The system displays addresses that do not match the selected leads.
- **Campaign queued without consent:** The system sends mail (even in test mode) without an explicit confirmation step.
- **Charges applied without warning:** The user is billed for a campaign they thought was in test/draft mode.
- **Data leak in mail merge:** Template preview reveals other users' data or PII from unrelated records.
- **Campaign cannot be cancelled after queuing:** Once queued, there is no way to stop or modify the campaign before it sends.
