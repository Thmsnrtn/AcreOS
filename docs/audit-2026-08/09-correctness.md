# 09 — Correctness (money math, dates, idempotency, swallowed failures)

**State of the region.** The money *core* of AcreOS is genuinely well-built and I could not break it: monetary values are handled in **integer cents** (`centsFromDecimal`, `*_cents` columns), summed-then-rounded per-row (`bookkeeping.ts:595` has an explicit "never sum floats then round" comment), rent charges post through `ON CONFLICT DO NOTHING` on a unique period key (`rentChargeGenerator.ts:157`), rent payments post inside a transaction (`paymentPosting.ts`), the payment/webhook/credit races (DEFECT-0005/0006/0007) are all fixed and hold, and TCPA quiet-hours math is DST-correct via `Intl.DateTimeFormat`. The float-vs-cents defect class the charge asked me to hunt is **largely absent** — the team already fought it.

**The single defect class that survives every gate here:** **UTC calendar-day boundaries computed against `timestamp` money columns** (`new Date(x).toISOString().slice(0,10)` and `Date.UTC(y,0,1)`), used to decide *tax year* and *YTD* on real IRS filings and regulated statements. No lint sees it (`lint:date-format` only matches `.toLocaleDateString`/`Time`, display-only — verified in `scripts/lint-date-format.mjs`), no date-boundary test exists, and `tsc` is blind to it because the types are correct. DEFECT-0060 registered *one* instance (a borrower view route) as P2-OPEN; the same class lives, unregistered, in the code path that **actually files with the IRS**. Two smaller idempotency/fire-and-forget edges round out the region.

---

### F-09-1 — 1098/1099 batch files interest in the WRONG tax year for year-end payments (UTC-day boundary on a `timestamp` column), and does so inconsistently between originated and acquired notes
**Severity:** P2 real
**Surfaced by:** slice 09 (correctness)
**Survives which gates:** `tsc` — types are correct (`Date`→`string`); `lint:date-format` — matches only `.toLocaleDateString/Time`, not `.toISOString().slice(0,10)` (see `scripts/lint-date-format.mjs` SCOPE comment); `lint:no-fabrication` — this is a real value put in the wrong bucket, not an invented one; no test exercises a Dec-31-evening payment. DEFECT-0060 registered the *sibling* site (`routes-borrower.ts:663-668`, the borrower's on-screen view) but not this one, the actual filing generator.
**Evidence:**
- `server/services/form1098Batch.ts:271` — `toIsoDay` on a `Date` returns `value.toISOString().slice(0,10)` = the **UTC** calendar day.
- `server/services/form1098Batch.ts:1036-1045` — `collectOriginatedCandidates` loads `payments.paymentDate`, which is `timestamp("payment_date")` (`shared/schema.ts:1575`), and runs each row through `toIsoDay`.
- `server/services/form1098Batch.ts:339-340, 423-430` — the Box-1 interest sum and principal resolution filter those day-strings against `` `${taxYear}-01-01` `` / `` `${taxYear}-12-31` ``.
- Contrast `server/services/form1098Batch.ts:975` — `collectAcquiredCandidates` reads `notePayments.paymentDate`, which is `date("payment_date")` (`shared/schema/notes-vertical.ts:295`) — a bare `YYYY-MM-DD`, no timezone. So the **same batch** buckets acquired-note payments correctly and originated-note payments by UTC.
**What's wrong:** A note payment recorded Dec 31, 10:00 PM in a non-UTC-negative zone (e.g. `America/Los_Angeles`) is stored as a `timestamp` whose UTC instant is Jan 1. `toIsoDay` yields next year, so that interest lands on the *following* year's Form 1098/1099-INT. The lender's filed Box-1 total and the borrower's copy disagree with the money actually received in the calendar year. Acquired notes don't have the bug (date column), so a mixed portfolio files two different conventions.
**Impact:** Burns trust after sale — a lender whose IRS filing is off by a December payment looks incompetent to their borrower and to the IRS; the asymmetry between note types makes it look non-deterministic. Not a first-sale blocker (needs on-platform originated notes with real payments).
**Fix:** Bucket by the org's servicing timezone, or store/compare the payment's local date. Simplest: change `payments.payment_date` to a `date` column (it already only ever needs day granularity for tax purposes) OR compute the day in a fixed documented zone via `Intl.DateTimeFormat(zone).format`. Then make acquired + originated paths share one `dayInZone()` helper so they cannot diverge.
**Gate it:** Add a unit test in `form1098Batch.test.ts` that posts a payment at `2025-12-31T22:00:00-08:00` and asserts it appears on tax year 2025 (not 2026) for BOTH note sources. Fold the DEFECT-0060 view-route fix into the same helper so one test covers both. Optionally extend `lint-date-format.mjs` with a rule flagging `.toISOString().slice(0,10)` inside `server/services/**` financial modules (measured baseline: 20 such call-sites across `form1098Batch.ts` / `periodicStatements/` / `bookkeeping.ts` / `irsFireFormat.ts`).
**Effort:** M
**Blast radius:** `form1098Batch.ts`, `payments` schema (migration if column type changes), `routes-borrower.ts:663-668` (DEFECT-0060), and by the same mechanism `periodicStatements/index.ts:791` YTD (see F-09-2 note).
**Confidence:** high — column types and the `toIsoDay` body are pasted above; the acquired-vs-originated asymmetry is directly observable.

---

### F-09-2 — Statement email delivery idempotency is check-then-act with no atomic claim, so a concurrent regenerate + cron can double-send a §1026.41 loan statement (and YTD totals share the F-09-1 UTC boundary)
**Severity:** P2 real
**Surfaced by:** slice 09 (correctness)
**Survives which gates:** no test drives two concurrent `notifyStatementGenerated` calls for one `statementId`; `tsc`/lints see nothing; the repo's *own* fix pattern for this exact class (atomic `onConflictDoNothing().returning()` / `SELECT FOR UPDATE`, DEFECT-0005/0006) was applied to the webhook path but **not** to this send path.
**Evidence:** `server/services/periodicStatements/delivery.ts:197-200` reads `if (statement.deliveryStatus === "delivered") return …skipped`; the email is sent at line ~285 (`emailService.sendEmail`); the row is flipped to `delivered` only afterward at lines 288-300. There is no `SELECT … FOR UPDATE`, no transactional claim, no unique send-ledger insert between the read and the send. Two callers exist — `index.ts:651` (originated) and `index.ts:1166` (acquired, reached with `regenerate` reusing the same persisted id, `index.ts:1150`).
**What's wrong:** The idempotency guarantee is only "sees committed state" (line 181 re-read). If the cron batch and a manual regenerate (or an overlapping cron tick — the repo runs jobs as in-process `setInterval`, per the registry's 44-timer note) both observe `deliveryStatus !== "delivered"` before either commits, both call `sendEmail`. The borrower receives two copies of the same regulated periodic statement.
**Impact:** Burns trust after sale — a borrower getting duplicate mortgage statements reads as a billing system malfunction. Probability is bounded (needs concurrency: overlapping cron or manual re-run racing cron), so not P1.
**Fix:** Make the claim atomic: `UPDATE periodic_statements SET delivery_status='sending' WHERE id=$1 AND delivery_status<>'delivered' RETURNING id` and only send if a row came back; or insert into a unique send-ledger keyed on `statementId` with `onConflictDoNothing().returning()` before sending (the DEFECT-0006 pattern). On send failure, reset to `pending`.
**Gate it:** Test firing two `notifyStatementGenerated(sameId)` in parallel and asserting `emailService.sendEmail` is called exactly once. Rewrite (don't delete) any existing idempotency test to assert the atomic claim, per CLAUDE.md wave-discipline rule 4.
**Effort:** S
**Blast radius:** `periodicStatements/delivery.ts`, `periodicStatements/index.ts`.
**Confidence:** high on the mechanism (pasted); medium on real-world firing frequency (depends on cron overlap + manual regenerate usage). *Related, same UTC class as F-09-1:* `index.ts:791` computes YTD from `Date.UTC(year,0,1)` against `paymentApplications.appliedAt` (`timestamp`, `schema.ts:17886`), so statement YTD principal/interest also misattributes year-boundary payments — fold into the F-09-1 fix.

---

### F-09-3 — Paid-provider credit debit is fire-and-forget and fails open, so a debit error silently undercounts COGS / consumed credits
**Severity:** P3 minor
**Surfaced by:** slice 09 (correctness)
**Survives which gates:** the debit's own comment calls the failure "non-fatal"; no test asserts a debit row is written when `poolDebit` throws; nothing gates on it (`enforce: "record"` means it never blocks access anyway).
**Evidence:** `server/services/providers/provider-registry.ts:306-313` — after a **paid, non-cached** provider success, the debit is `this.debitPaidLookup(...).catch((debitErr) => logger.warn("Credit debit error (non-fatal)"))`. The result is already returned to the caller regardless. `debitPaidLookup` (line 627-657) is the only thing that writes the credit/COGS ledger row via `poolDebit`.
**What's wrong:** If `poolDebit` throws (DB blip, deadlock, import failure), the paid vendor data is served to the customer and the ledger row is never written — no retry, no dead-letter, no reconciliation. The comment "Lena, close the margin leak" is contradicted by treating the debit failure as droppable. It is the exact swallowed-money-operation class this slice hunts, just low-frequency and pre-revenue.
**Impact:** Neither blocks first sale nor burns customer trust — it quietly understates AcreOS's own COGS/credit consumption (margin telemetry), the founder's number, not the customer's. Matters once paid lookups actually run at volume.
**Fix:** On debit failure, enqueue a retry / write a `credit_debit_failures` row for reconciliation instead of only `logger.warn`. Keep it off the request's critical path but make the failure durable, not lost.
**Gate it:** Unit test: stub `poolDebit` to throw, assert a durable failure record is created (not just a log line). No ratchet needed.
**Effort:** S
**Blast radius:** `provider-registry.ts` (`debitPaidLookup` + its call site).
**Confidence:** high on the mechanism; low on impact magnitude (zero paying customers, non-gating). The `.catch(() => {})` siblings nearby (lines 247/297/363/403/411/515/817) are all genuinely non-fatal telemetry writes — I checked each; only the debit touches money and it is correctly the *only* one given a logged handler.

---

## Coverage ledger

**Examined exhaustively (read the relevant spans):**
- `server/services/form1098Batch.ts` (1204 L) — date boundaries, cents handling, both candidate collectors.
- `server/services/bookkeeping.ts` (956 L) — interest/principal accumulation, $600 threshold (correctly in cents at line 251), tax report rounding.
- `server/services/financialOSService.ts` (592 L) — amortization/accrual math (integer bps + cents, correct).
- `server/services/periodicStatements/delivery.ts` (332 L) + `index.ts` (1211 L, YTD + notify paths).
- `server/services/rental/rentChargeGenerator.ts` + `paymentPosting.ts` — idempotency + allocation (both clean).
- `server/services/tcpaCompliance.ts` — quiet-hours math (clean, DST-correct).
- `server/services/providers/provider-registry.ts` — credit debit + all `.catch(() => {})` sites.
- `server/services/communicationDeduplication.ts` — reviewed; **zero callers** (dead code, TOCTOU moot; handed to slice 04, not reported here).
- `scripts/lint-date-format.mjs` — confirmed the gate's scope excludes the surviving class.

**Examined by sampling:**
- `server/routes-accounting.ts` / `routes-borrower.ts` — grepped date-boundary + money coercions, did not read line-by-line (routes-borrower.ts is 2154 L; DEFECT-0060's cited lines confirmed as a known-open sibling of F-09-1).
- `irsFireFormat.ts` — spot-checked cents formatting (`Math.round`, clamp ≥0 — clean).
- Empty `catch {}` inventory (40+ hits) — sampled; the concentration is in AI/autopilot theater services (`crisisLeadershipEngine`, `trustEvolution`, `warRoomService`, `agentInitiativeEngine`), none on a money/send path, so not reported.
- `server/ai/tools.ts` price-per-acre / median comps math (lines 2480-2517) — divide-by-zero guarded, median correct; values are informational/hedged (peer slice 22 owns AVM fabrication).

**Did NOT examine:**
- `client/` money rendering (peer 22 number-provenance owns displayed numbers).
- The Stripe subscription/webhook charge path in depth (peer 20 T1 owns it; I did not re-audit F-20-1..3).
- Campaign send DNC/CAN-SPAM/BYO idempotency (peer 21 T2 owns it).
- `countyAssessorIngest.ts` / ETL import math beyond a divide-by-zero spot-check.
- Concurrent-write races outside the money/statement paths (peer 23 T4 owns tenant-boundary races).
- Escrow/tax-payment (`schema.ts:1608` second `payments`-like table) math — noted the `timestamp` column exists but did not trace its aggregations.

## Constitution Collisions

None. All three findings are internal correctness on existing surfaces (tax filing, statement delivery, credit metering) — no new nav entry, no new AI destination, no money moving onto AcreOS's own account (F-09-3 is AcreOS debiting its *own* customers' prepaid credit pool, which is the sanctioned subscription-adjacent metering, not customer-to-third-party money movement), no fabrication (F-09-1/2 put *real* values in the wrong time bucket — the opposite of invented data), no relitigation of a DO-NOT-DO item.
