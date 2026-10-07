# Plan 10 — Time zones and daylight-saving transitions

**Status:** Not yet run · **Owner:** [OWNER] founder to assign · **Index:** [README](README.md)

## Goal

Establish that date-dependent behaviour — late fees, due dates, grace periods,
compliance quiet hours, scheduled jobs and period reports — gives the result a
customer in any US time zone would expect, including on and around the
daylight-saving transitions in March and November.

## Why the campaign could not cover it

The campaign ran on a container in UTC, on real wall-clock days, and recorded
no note payment (its report explains why), so nothing after the first payment
— late fees, payoff, year-end forms — ran with real data. It did not move the
clock, vary the process time zone, or cross a DST boundary.

## What the code does today (context for the tester)

- **Late fees.** `server/jobs/servicedLateFeeJob.ts` checks hourly and runs at
  **13:00 UTC** daily; the assessment in
  `server/services/notes/servicedLateFees.ts` computes days with UTC helpers
  (`isoDay` via `toISOString`, `utcDayStart`) and a grace window in whole days.
- **Scheduled jobs.** Many jobs in `server/jobs/runScheduledJobs.ts` (and
  others such as `landCreditScoreRecalcJob.ts`, `referralMaturityJob.ts`) are
  gated on `getUTCHours()`, `getUTCDay()` or `getUTCDate()`. A UTC-fixed job
  lands one hour later or earlier in US local time when DST changes.
- **Stored zones.** `organizations.timezone` (default `America/New_York`),
  `leads.timezone` (for TCPA quiet hours) and `quiet_hours_config.timezone`
  (default `America/Chicago`) in `shared/schema.ts`; quiet hours are computed
  with `Intl` time zones in `server/services/quietHours.ts`.
- **Other date logic to include:** `server/services/notePaymentDueDetector.ts`,
  `server/services/notePaymentMath.ts`, `server/services/borrowerNotices.ts`,
  `server/jobs/borrowerDunningLadder.ts`, `server/services/form1098Batch.ts`,
  `server/services/periodicStatements/delivery.ts`,
  `server/services/tcpaCompliance.ts`.
- Client date display is governed by `npm run lint:date-format`.

## Calendar and zones

US DST transitions in scope (second Sunday of March, first Sunday of
November, at 02:00 local):

| Year | Spring forward  | Fall back         |
| ---- | --------------- | ----------------- |
| 2026 | Sunday 8 March  | Sunday 1 November |
| 2027 | Sunday 14 March | Sunday 7 November |

Zones: `America/New_York`, `America/Chicago`, `America/Denver`,
`America/Phoenix` (no DST), `America/Los_Angeles`, `America/Anchorage`,
`America/Adak`, `America/Puerto_Rico` (no DST); plus `Pacific/Honolulu` (no
DST), which is not under `America/*` but is a US zone customers may use.

## Environment and prerequisites

- Local only; no credentials beyond `DATABASE_URL` for an integration database
  built from the repository. Outbound providers unconfigured.
- Vitest fake timers (`vi.useFakeTimers()` / `vi.setSystemTime()`) for unit
  cases; a controllable clock for integration cases (inject `now` where the
  code accepts it; where it does not, record that as a finding for
  testability rather than editing production code in this plan).
- The ability to run the same suite under different process time zones,
  e.g. `TZ=America/Los_Angeles npx vitest run <files>`. Production runs in
  UTC; a result that changes with `TZ` means the code depends on the host's
  zone, which is itself a finding.

## Procedure

1. **Define expected results first.** For each date concept below, write the
   expected outcome under the founder's ruling (see _Still owed_) before
   running anything. A test with no written expectation cannot fail.
2. **Late fees and grace.** For a note in each zone with a due date on, just
   before, and just after each transition date, and with grace periods of 0,
   1 and 10 days: simulate the 13:00 UTC run on every day from due date to
   due date + grace + 2. Record the first day a fee is assessed and compare
   with the expectation. Include a payment posted at 23:30 local on the last
   grace day.
3. **Due-date rollover.** Month-end due dates (28th–31st), February in leap and
   non-leap years, and a due date that falls on a transition Sunday.
4. **Quiet hours.** For leads in each zone, attempt an SMS at 07:59, 08:00,
   20:59 and 21:00 local on the day before, the day of, and the day after each
   transition; confirm the allow/deny boundary is correct in local time,
   including the hour that does not exist (spring) and the hour that occurs
   twice (autumn).
5. **Scheduled jobs.** For each UTC-gated job that produces something a
   customer sees at a local time (digests, notices, statements), compute its
   local delivery time in each zone before and after each transition, and
   record whether the shift is intended. Confirm no job runs twice or is
   skipped across a transition (the hourly gate in a UTC process should not
   be affected — confirm it).
6. **Reports and period boundaries.** For transactions at 23:30 local on the
   last day of a month and of a year, confirm which month/year they fall in on
   the P&L, statements, and 1098/1099 batches, in each zone.
7. **Host time zone independence.** Re-run steps 2–6 with `TZ` set to
   `UTC`, `America/Los_Angeles` and `America/Adak`; outcomes must not change.

## Pass criteria

- Every case matches the expectation written in step 1.
- No outcome depends on the host process time zone.
- No scheduled job runs twice or is skipped across a transition.
- **Fail:** a late fee assessed earlier than the borrower's local grace end,
  or missed; a quiet-hours send outside the allowed local window; a
  transaction booked in the wrong period; any outcome that changes with `TZ`.

## Results

Not yet run.

## Still owed

- An owner and a date.
- **Founder rulings that define "correct"** (the plan cannot pass without
  them): in which zone a note's due date and grace period are counted — the
  lender organization's, the borrower's, or the property's; whether customer-
  facing scheduled sends should hold a fixed local time or a fixed UTC time
  across DST; which zone defines month and year boundaries for reports and tax
  forms.
- The note-payment path working on a database built from migrations (the
  campaign report's payments finding), since steps 2 and 6 need recorded
  payments.

## Run log

_(empty — append entries per the format in [README](README.md))_
