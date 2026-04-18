# Lens 058 -- Time Zone / Date-Math Reviewer

**Auditor Persona:** Time zone and date arithmetic specialist
**Tier:** 2
**Date:** 2026-04-18
**Scope:** All server and client date handling, with emphasis on financial date calculations (payment due dates, amortization schedules, payoff quotes, 1098 statements, delinquency tracking).

---

## Executive Summary

The codebase has **one well-written utility** (`server/utils/dateUtils.ts` -- `addMonths` with month-end clamping) and **one well-implemented timezone-aware scheduler** (`server/services/paxScheduler.ts`). However, the rest of the date handling is ad-hoc, inconsistent, and riddled with timezone-naive patterns that will produce wrong results for users outside the server's local timezone. The highest-severity issues involve **financial calculations where money is at stake**: payment schedules, payoff quotes, delinquency detection, and tax reporting.

---

## Findings

### F-058-01: `addMonths` import split -- date-fns vs. dateUtils (P1, Financial Risk)

**Location:** `server/services/financialOSService.ts:48`, `server/services/propertyTaxService.ts:15`, `server/services/freedomCalculator.ts:11`

These three services import `addMonths` from `date-fns`, while **24 other files** (including `routes-finance.ts`, `routes-borrower.ts`, `webhookHandlers.ts`) import the custom `addMonths` from `server/utils/dateUtils.ts`.

The custom `addMonths` has **month-end clamping** (Jan 31 + 1 month = Feb 28). The `date-fns` version also clamps, but the two implementations may diverge on edge cases (e.g., negative month arithmetic, crossing year boundaries). More critically, having two different `addMonths` functions in a financial codebase is a maintenance hazard -- a developer could easily pick the wrong one.

The `financialOSService.ts` is particularly dangerous because it generates the **canonical amortization schedule** via `generateAmortizationSchedule()`, which uses `date-fns/addMonths` for due date computation, while the code that **advances** `nextPaymentDate` after a payment (in `routes-borrower.ts:450` and `webhookHandlers.ts:671`) uses the custom `addMonths`. If the two ever disagree on a date, the schedule and the tracker will drift apart.

**Recommendation:** Standardize on a single `addMonths`. Either (a) re-export `date-fns/addMonths` from `dateUtils.ts` so all imports converge, or (b) replace all `date-fns` calls with the custom version. Add a lint rule to prevent direct `date-fns/addMonths` imports.

---

### F-058-02: `stripeConnect.ts` does not advance `nextPaymentDate` (P0, Financial Bug)

**Location:** `server/services/stripeConnect.ts:441-444`

When a Stripe Connect `payment_intent.succeeded` is processed, the handler updates `currentBalance` and `status` but **never advances `nextPaymentDate`** and never updates `amortizationSchedule`. Compare to the borrower-portal webhook handler (`webhookHandlers.ts:671-677`) and the borrower route (`routes-borrower.ts:450-455`), both of which correctly call `addMonths(nextPaymentDate, 1)` and mark the schedule entry as paid.

**Impact:** For notes paid via Stripe Connect (the direct payment-intent flow rather than checkout sessions), the note's `nextPaymentDate` stays frozen at the original date. This causes:
- The delinquency detector (`financeAgent.ts:39-44`) to falsely flag the note as overdue.
- Reminder emails to be sent for already-paid periods.
- The borrower portal to display an incorrect next-due date.

**Recommendation:** Replicate the schedule-advance logic from `webhookHandlers.ts:659-677` into `stripeConnect.ts:handleSuccessfulPayment`.

---

### F-058-03: Server-side `toLocaleDateString()` uses server locale (P1, Display Bug)

**Locations:**
- `server/webhookHandlers.ts:687,696,702` -- payment receipt emails
- `server/routes-borrower.ts:570,571` -- payoff quote PDF
- `server/routes-documents.ts:349,367,370,431` -- legal documents (promissory notes, closing statements)
- `server/routes-ai.ts:782,801` -- conversation export
- `server/routes-doc-system.ts:339,341,342` -- document template previews
- `server/agents/monthly-review.ts:45` -- month name

`toLocaleDateString()` without arguments produces locale-dependent output based on the **server's** `LANG`/`LC_*` environment, which on Fly.io is typically `en_US` or `C`. This means:
1. All borrower-facing dates in emails and PDFs render in the server's locale, not the borrower's.
2. Legal documents (promissory notes!) embed dates formatted by Node.js's default locale, which could produce unexpected output on different deployment environments.
3. Payment receipt emails sent to borrowers show "Payment Date: 4/18/2026" using server-local `new Date().toLocaleDateString()`, which is **not timezone-adjusted** -- a payment processed at 11 PM ET on April 18 might actually be April 19 in the borrower's timezone.

**Recommendation:** For legal documents, use explicit `format(date, "MMMM d, yyyy")` from `date-fns`. For emails to borrowers, use the org's stored `timezone` setting to format dates in the user's local time.

---

### F-058-04: Payoff quote uses 30-day approximation for "last payment date" (P1, Financial Accuracy)

**Location:** `server/routes-borrower.ts:539-542`

```typescript
const lastPaymentDate = note.nextPaymentDate
  ? new Date(new Date(note.nextPaymentDate).getTime() - 30 * 24 * 60 * 60 * 1000)
  : new Date(note.startDate);
```

This estimates "last payment date" as nextPaymentDate minus exactly 30 days (2,592,000,000 ms). Problems:
1. **Months are not 30 days.** February is 28-29 days, some months are 31. For a note with payments on the 31st, the "last payment" computed this way will be wrong by 1-3 days.
2. **DST transitions** add or subtract an hour (3,600,000 ms), which can shift the calendar day for dates near midnight.
3. **The actual last payment date is available** from the `payments` table. Querying for the most recent completed payment would give the exact date.

The accrued interest calculation that follows uses this approximate date to compute `daysSinceLastPayment`, directly affecting the dollar amount of the payoff quote.

**Recommendation:** Query `payments` for the most recent completed payment date. If none exists, fall back to `note.startDate`.

---

### F-058-05: Founder digest agent uses server-local `getHours()` (P2, Scheduling Bug)

**Location:** `server/agents/founder-digest.ts:21`

```typescript
if (now.getHours() < 7 || now.getHours() > 9) return;
```

This checks whether the current hour (in the **server's timezone**) is between 7-9 AM. The Fly.io deployment is in IAD (US-East), so the server likely runs in UTC. This means the digest runs at 7-9 AM UTC, which is 2-4 AM Eastern or 11 PM-1 AM Pacific. The code even has a comment: "configurable via org timezone later" -- that TODO was never completed.

The `paxScheduler.ts` has a proper timezone-aware implementation (`getLocalParts`, `localToUtc`) that could be reused here.

**Recommendation:** Use the org's `timezone` setting (defaulting to `America/New_York`) and the `getLocalParts` helper from `paxScheduler.ts` to determine the local hour.

---

### F-058-06: Deal-hunter scraping job uses server-local `setHours(2, 0, 0, 0)` (P2, Scheduling Bug)

**Location:** `server/index.ts:1217`

```typescript
next2AM.setHours(2, 0, 0, 0);
```

This schedules the deal-hunter scraping at "2 AM" in the server's local timezone. On Fly.io (likely UTC), this is 2 AM UTC. While this is a system job (not user-facing), the comment says "daily at 2 AM" without specifying the timezone, and the behavior will change if the deployment moves regions.

Compare to `startCountyAssessorIngestJob()` at line 1450, which correctly uses `setUTCHours(23, 0, 0, 0)` and documents "nightly at 11 PM UTC".

**Recommendation:** Use `setUTCHours(2, 0, 0, 0)` for consistency, or document the intended timezone.

---

### F-058-07: Night-cap "today" boundary uses server timezone (P2, Data Accuracy)

**Location:** `server/routes-night-cap.ts:103-106`

```typescript
const today = new Date();
today.setHours(0, 0, 0, 0);
const todayEnd = new Date();
todayEnd.setHours(23, 59, 59, 999);
```

The Evening Review feature aggregates "today's payments." But "today" is defined by the server's timezone. A payment received at 10 PM Pacific (which is 1 AM UTC the next day) would appear in tomorrow's snapshot for a California-based user.

This same pattern appears in: `server/agents/founder-digest.ts:28`, `server/agents/growth.ts:39`, `server/agents/operations.ts:119`, `server/agents/revenue.ts:137`, `server/services/alerting.ts:181`, `server/services/usageLimits.ts:180`.

**Recommendation:** Accept or derive the user's timezone from `organization.timezone` and compute day boundaries in that timezone using `Intl.DateTimeFormat` or `date-fns-tz`.

---

### F-058-08: `timestamp` columns without explicit `withTimezone` (P2, Schema Consistency)

**Location:** `shared/schema.ts` -- all 429 tables

Drizzle ORM's `timestamp()` helper maps to PostgreSQL `timestamp without time zone` by default. This means **all timestamps in the database are stored without timezone information**. Since the server inserts dates via `new Date()` (which produces UTC on Node.js), the stored values are UTC but the column type does not enforce this.

If any code ever constructs a Date from a local-time string (e.g., `new Date("2026-04-18")` which is parsed as local time in some engines) and inserts it, the stored value will be server-local time masquerading as UTC. Additionally, PostgreSQL `CURRENT_TIMESTAMP` in default-value expressions would return session-timezone time, not UTC, unless the session timezone is set.

The `notes` table is the most critical example: `startDate`, `firstPaymentDate`, `nextPaymentDate`, `maturityDate` are all `timestamp` without timezone, yet they represent business dates that the user enters in their local timezone.

**Recommendation:** Either (a) migrate all `timestamp` columns to `timestamp with time zone` (the PostgreSQL best practice), or (b) add a convention document and ensure all inserts use `new Date()` (UTC) and add a check to the PostgreSQL session config (`SET timezone = 'UTC'`).

---

### F-058-09: 1098 tax statement year boundaries ignore timezone (P2, Tax Reporting)

**Location:** `server/routes-borrower.ts:663-668`

```typescript
const yearStart = new Date(taxYear, 0, 1);
const yearEnd = new Date(taxYear, 11, 31, 23, 59, 59);
```

These boundaries are constructed in the **server's local timezone**. A payment processed on December 31 at 10 PM Pacific (which is January 1 UTC) would be excluded from the correct tax year if the server runs in UTC. For a 1098 form (IRS tax document), this is a compliance error.

**Recommendation:** Construct year boundaries in the org's timezone, or at minimum document that all payment dates are stored in UTC and adjust the boundary accordingly.

---

### F-058-10: Delinquency calculation uses raw `getTime()` difference (P2, DST Bug)

**Location:** `server/services/financeAgent.ts:39-44`

```typescript
const diffTime = now.getTime() - nextPaymentDate.getTime();
const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
```

This computes days by dividing millisecond difference by 86,400,000. During DST transitions, a "day" can be 23 or 25 hours. While this mostly doesn't matter (the error is <1 day), it can cause a note to appear 1 day delinquent when it isn't, or to miss the exact threshold for sending a late notice.

The same pattern appears in:
- `client/src/pages/finance.tsx:126` -- loan health indicator
- `client/src/pages/borrower-portal.tsx:582` -- borrower-facing status badge
- `server/routes-borrower.ts:542` -- payoff quote
- `server/services/dunning.ts:147` -- dunning stage calculation
- `server/services/portfolioSentinel.ts:158` -- tax payment alerts

**Recommendation:** Use `date-fns/differenceInCalendarDays` or `differenceInDays` (which handles DST correctly) instead of raw millisecond division.

---

### F-058-11: Manual payment recording in client sends `paymentDate: new Date()` (P2, Timezone Mismatch)

**Location:** `client/src/pages/finance.tsx:1237`

```typescript
paymentDate: new Date(),
```

When a user manually records a payment, the client sends `new Date()` (browser-local time) as the `paymentDate`. The server stores this as-is into a `timestamp without time zone` column. If the user is in Pacific time and the server interprets it as UTC, the stored payment date will be off by up to 8 hours. For a payment made late on December 31 PST, this could push the recorded date into January 1, affecting 1098 tax reporting.

The same issue occurs at `client/src/pages/finance.tsx:1238` for `dueDate`.

**Recommendation:** Either (a) send an ISO string with timezone offset (the `Date.toISOString()` method), or (b) send only the date portion (`YYYY-MM-DD`) and let the server construct the timestamp. Option (b) is better for financial dates that represent business days.

---

### F-058-12: No `date-fns-tz` dependency -- no timezone conversion library (P2, Systemic Gap)

The project uses `date-fns` for date manipulation but does **not** depend on `date-fns-tz` (confirmed by grep -- zero imports). The only timezone-aware code is the manual `Intl.DateTimeFormat` implementation in `paxScheduler.ts`.

This means there is no standard way to:
- Convert a UTC timestamp to the user's local timezone for display.
- Compute "start of day" or "end of day" in the user's timezone.
- Format a date in a specific timezone.

The org schema has a `timezone` field (default `America/New_York`), but it is only used by `paxScheduler.ts` for scheduled task computation. No other code reads or uses it.

**Recommendation:** Add `date-fns-tz` or create a shared utility that wraps the `Intl.DateTimeFormat` approach. Build helper functions: `startOfDayInTz(date, tz)`, `formatInTz(date, format, tz)`, `toOrgTimezone(date, orgId)`.

---

### F-058-13: `forecasting.tsx` computes month labels at module load time (P3, Minor)

**Location:** `client/src/pages/forecasting.tsx:52-54`

```typescript
const MONTH_LABELS = Array.from({ length: 12 }, (_, i) =>
  format(addMonths(new Date(), i), "MMM yy")
);
```

This runs at module import time. If the app stays loaded overnight or across a month boundary, the labels will be stale. This is a minor UX issue.

**Recommendation:** Move inside the component or use `useMemo` keyed on the current month.

---

### F-058-14: `date.today` template variable in legal documents uses server locale (P2, Legal Risk)

**Location:** `server/routes-doc-system.ts:341-342`

```typescript
"date.today": new Date().toLocaleDateString(),
"date.current": new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
```

Legal documents (promissory notes, deeds, closing statements) embed `date.today` and `date.current` template variables. These are formatted in the server's timezone. If the server is UTC and the user signs at 9 PM Pacific, the document will show the next day's date.

**Recommendation:** Format using the org's timezone setting.

---

## Summary Table

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| F-058-01 | P1 | Consistency | Two different `addMonths` implementations in financial code paths |
| F-058-02 | P0 | Financial Bug | Stripe Connect handler never advances `nextPaymentDate` |
| F-058-03 | P1 | Display | Server-side `toLocaleDateString()` uses server locale in emails/PDFs |
| F-058-04 | P1 | Financial Accuracy | Payoff quote uses 30-day approximation instead of actual last payment |
| F-058-05 | P2 | Scheduling | Founder digest agent uses server-local hours |
| F-058-06 | P2 | Scheduling | Deal-hunter job uses local `setHours` instead of `setUTCHours` |
| F-058-07 | P2 | Data Accuracy | Night-cap and agent "today" boundaries ignore user timezone |
| F-058-08 | P2 | Schema | All `timestamp` columns lack explicit `with time zone` |
| F-058-09 | P2 | Tax Compliance | 1098 year boundaries constructed in server timezone |
| F-058-10 | P2 | DST | Delinquency uses ms division instead of calendar-day difference |
| F-058-11 | P2 | Timezone Mismatch | Client sends `new Date()` for payment recording |
| F-058-12 | P2 | Systemic Gap | No timezone conversion library; `org.timezone` field unused |
| F-058-13 | P3 | Minor UX | Forecast month labels computed at module load time |
| F-058-14 | P2 | Legal Risk | Legal document dates formatted in server timezone |

---

## Positive Findings

1. **`server/utils/dateUtils.ts`** -- The custom `addMonths` with month-end clamping is correctly implemented and well-documented. The modular arithmetic `((targetMonth % 12) + 12) % 12` handles negative months correctly.

2. **`server/services/paxScheduler.ts`** -- The `computeNextRun` / `getLocalParts` / `localToUtc` system is a solid timezone-aware scheduler that correctly uses `Intl.DateTimeFormat` for DST-safe conversions. This is the gold standard for the codebase and should be extracted into a shared utility.

3. **`server/index.ts:1450`** -- The county assessor ingest job correctly uses `setUTCHours(23, 0, 0, 0)` and documents its timezone convention.

4. **Drizzle `timestamp().defaultNow()`** -- PostgreSQL's `now()` function returns the current timestamp in the session's timezone, which for a properly configured PostgreSQL instance is UTC. This is correct for `createdAt`/`updatedAt` columns.

5. **Borrower session expiry** (`routes-borrower.ts:78`) -- correctly computed via millisecond arithmetic from `new Date()`, avoiding timezone issues.
