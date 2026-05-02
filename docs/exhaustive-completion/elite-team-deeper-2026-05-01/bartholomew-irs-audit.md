# Bartholomew Prescott — IRS Audit Readiness

**Persona:** Bartholomew Prescott, 58, Cincinnati. Land Investor, 14 years active. Carries 31 active seller-financed notes, ~60 closed deals across three years.
**Trigger:** CP2000 + Form 4564 IDR (Information Document Request) for tax years 2022, 2023, 2024. CPA Margaret needs three years of transactions, basis schedules, depreciation schedules, and copies of all 1098-INTs issued to borrowers.
**Stress level:** High. Audit window is 30 days; Margaret bills $385/hr; every reconstructed record costs Bartholomew real money and the threat of disallowed deductions costs more.
**Wave:** 3 — "the IRS letter arrived."

---

## What Bartholomew Needs From AcreOS in the Next 72 Hours

1. A clean export of every transaction — purchase, sale, payment received, payment disbursed — for the audit window with date, amount, counterparty, property, and source document.
2. A per-property cost basis schedule showing original basis, capital improvements, depreciation taken, and adjusted basis at year-end for each year.
3. A per-property depreciation schedule (method, recovery period, in-service date, prior depreciation, current-year depreciation).
4. Copies of every 1098-INT he issued to borrowers in 2022/2023/2024, regenerable as PDFs.
5. A way to give Margaret read-only access to AcreOS without exposing pipeline, marketing, or buyer PII she shouldn't see — and an audit trail proving exactly what she viewed and when.
6. Confidence that the records he hands over have not been modified after-the-fact, and that any retroactive correction is itself logged.

---

## What AcreOS Has Today

### Audit log infrastructure
- `audit_log` table (`shared/schema.ts:4149`) — `organizationId`, `userId`, `action`, `entityType`, `entityId`, `changes.before/after/fields`, `ipAddress`, `userAgent`, `metadata`, `createdAt`. Strong shape.
- `storage.createAuditLogEntry()` is called from `routes.ts`, `routes-organization.ts`, and `routes-import-export.ts` — covering org changes, exports, and most CRUD on core entities.
- Query API at `GET /api/audit-log` (`routes-import-export.ts:300`) supports filters by action, entityType, entityId, userId, startDate, endDate.
- A separate `fee_audit_log` table (`schema.ts:10352`) captures every settlement fee mutation indexed by org, settlement, and createdAt — exactly the right shape for IRS-grade fee proof.
- `founderAuditService` writes higher-level "decision events" (autonomous actions, AI confidence, executed-vs-deferred) — useful for explaining why a number landed where it did.

### Cost basis tracker
- `costBasisTracker.ts` records initial basis (purchase price + closing costs), tracks improvements as separate adjustments, applies typed adjustments (`depreciation`, `casualty_loss`, `insurance_recovery`, `partial_sale`, `other`), and exposes adjusted basis.
- `taxOptimizationEngine.ts` queries `depreciationSchedules` for per-property schedules with method (straight_line / accelerated / bonus).
- `routes-tax-optimization.ts` exposes `GET /tax-optimization/cost-basis/:propertyId`, `GET /tax-optimization/depreciation/:propertyId?method=`, and analyze/scenario endpoints.

### 1098 generation
- `routes-borrower.ts:770` generates 1098 data on-demand from the payments ledger filtered by tax year. Sums `interestAmount` from completed payments where `paymentDate` falls inside the year.
- Client-side PDF rendering at `client/src/pages/borrower-portal.tsx:481` produces a printable Form 1098 ("Mortgage Interest Statement").

### Export
- `services/export.ts` produces CSV for leads, properties, notes (originalPrincipal, currentBalance, interestRate, payments, dates).
- `GET /api/export/:entityType?format=csv|json` (`routes-import-export.ts:199`) for leads, properties, deals, notes.
- `GET /api/export/backup` returns a JSON bundle of all org data with `metadata.exportedAt` timestamp.
- Both export paths log an `audit_log` entry for the export action.

### Document storage
- `documentAnalysis` table (`schema.ts:7667`) stores `documentType`, `documentName`, `fileUrl`, `fileHash` (sha-style for dedupe), `rawText`, `ocrConfidence`, and structured `extractedData` (grantor, grantee, legal description, recording info, consideration amount).
- `dealRoomDocuments` and `investorVerificationDocuments` add domain-specific tables.

### Roles and access
- Role guard middleware (`server/middleware/roleGuard.ts`) supports `owner`, `admin`, `acquisitions`, `marketing`, `finance`, `member`, `viewer`. Read-only mapped to all roles for GETs.
- `teamMembers.role` (`schema.ts:137`) is free-text — extensible to a CPA role.

---

## What Will Hurt Bartholomew Right Now

### 1. No "audit packet" export endpoint
Margaret wants one ZIP. AcreOS gives him:
- `/api/export/properties` (CSV)
- `/api/export/notes` (CSV)
- `/api/export/backup` (JSON of everything)
- A 1098 generator that returns JSON, with PDF rendering only inside the **borrower portal** — not the founder dashboard.
- Cost basis and depreciation only available per-propertyId via separate calls.

There is no "give me everything I'd hand to the IRS for tax year 2024" button. He has to script three different exports, then write the basis/depreciation calls in a loop over `propertyIds`, then somehow extract per-borrower 1098 PDFs from the borrower portal where he isn't the borrower.

**Fix:** Add `GET /api/audit-packet?taxYear=2024&format=zip` that bundles:
- transactions.csv (every payment in/out, every closing)
- properties.csv (acquisition/sale dates and prices)
- basis-schedule.csv (one row per property, end-of-year adjusted basis)
- depreciation-schedule.csv (one row per property-year)
- 1098s/ folder with one PDF per active note for that year
- audit-log.csv (every mutation in the tax year window, server-side)
- manifest.json with sha-256 of each file and the export timestamp signed by org key

### 2. Exports are not signed or hashed
The current `audit-log` action is "we exported," but the file itself has no integrity proof. If Bartholomew exports today and the IRS asks for the same export in eight months, there's no way to prove the second pull matches the first.

**Fix:** When `audit-packet` is generated, store `manifest.json` plus its sha-256 in `audit_log.metadata`. Re-export with the same parameters checks the stored hash and warns if it doesn't match — that's the retroactive-modification signal.

### 3. Soft delete exists but is inconsistent
`schema.ts:382, 692, 798, 903` use `deletedAt` for soft delete, but only on four tables. Payments, notes, properties, costBasis adjustments are not soft-deleted — a row UPDATE leaves no trail beyond `audit_log` (which depends on the route having remembered to call `createAuditLogEntry`). Routes in `routes-finance.ts`, `routes-borrower.ts`, and `routes-deals.ts` were not found to call the audit logger directly.

**Fix:** Either (a) move all financial tables to soft-delete + immutable insert pattern (no UPDATE, only versioned INSERT), or (b) install a Drizzle middleware that captures `before/after` and writes `audit_log` for every UPDATE/DELETE on a denylist of tables: `payments`, `notes`, `cost_basis`, `depreciation_schedules`, `properties`, `deals`. Bartholomew cannot afford any mutation path that doesn't land in `audit_log`.

### 4. No CPA-only role
`teamMembers.role` accepts free text but `roleGuard.ts` only knows owner/admin/acquisitions/marketing/finance/member/viewer. There is no role that says "see basis, depreciation, payment ledger, 1098s, and audit log only — nothing else." A `viewer` sees everything; a `finance` member can mutate.

**Fix:** Add `cpa` and `auditor` roles. Permissions:
- READ: properties, costBasis, depreciationSchedules, payments, notes, 1098 generator, audit-log, audit-packet
- DENY: leads, marketing campaigns, lead notes, contact PII unless tied to a closed transaction, founder dashboards, AI agents
- Every read by a `cpa`/`auditor` role appends to `audit_log` with `action: "audit_view"` so Bartholomew can prove to the IRS exactly what Margaret looked at.

### 5. 1098 generator is borrower-portal-only
The PDF rendering happens in the borrower's session at `borrower-portal.tsx:531`. A founder cannot batch-generate 1098 PDFs for all notes in one tax year. The data endpoint exists at `/api/borrower/.../statements?type=1098&year=2024` but is scoped to a single note and gated by borrower auth.

**Fix:** Add `POST /api/founder/1098/batch?taxYear=2024` returning a ZIP of PDFs, server-rendered (don't trust client jsPDF for an IRS document), with a deterministic filename pattern `1098_<taxYear>_<noteId>_<borrowerLastName>.pdf`. Log each generation to `audit_log` so Bartholomew can show "I issued 31 1098s on 2025-01-31, here is the manifest."

### 6. Retention rules will silently erase IRS-relevant rows
`server/jobs/dataRetention.ts` purges `activity_log` after 90 days, `agent_events` after 60, `usage_events` after 90, `notification_history` after 60. None of these are tax-critical individually, but `activity_log` is exactly where a "you sent borrower X a payoff statement on date Y" record lives. The IRS can ask for any of this within the seven-year window.

**Fix:** Carve out retention rules per org tier. For any org with `tier !== 'free'` extend retention on `activity_log` to 2,555 days (7 years). Add a `legal_hold` flag on `organizations` that, when set, freezes all retention purges. When the IRS letter lands, Bartholomew's first click should be "Place legal hold" — and that click itself logs to `audit_log` with `action: "legal_hold_engaged"`.

### 7. Document retrievability is uneven
`documentAnalysis.fileUrl` is a URL — not a guaranteed-retrievable artifact. If the underlying object storage purges or the URL rotates, the audit trail points at a 404. `fileHash` exists for dedupe but isn't verified on retrieval.

**Fix:** On every document access by an `auditor`/`cpa` role, recompute the hash from current bytes and compare to stored `fileHash`. Mismatch = `audit_log` entry with `action: "document_integrity_fail"`. Also: dual-write closing documents to a write-once location (S3 Object Lock or R2 immutable bucket) on initial ingest — and store the immutable URL alongside `fileUrl`.

### 8. Cost basis adjustments are mutable
`costBasisTracker.ts` does `db.update(costBasis)...` to apply adjustments — overwriting `currentBasis` and appending to `adjustments` JSON. That works for the common case but means a typo correction silently overwrites the prior adjusted basis. The IRS will ask "what was your basis on 12/31/2023?" and the answer needs to be the basis as known on that date, not as currently believed.

**Fix:** Append-only adjustments table. `currentBasis` becomes a derived view: `originalBasis + sum(adjustments where effectiveDate <= asOf)`. Corrections are themselves new adjustment rows with `correctsAdjustmentId` pointing at the row they reverse.

---

## Bartholomew's 30-Day Path Through Today's AcreOS

What he can actually do this week with the system as shipped:

1. Pull `/api/export/notes?format=csv` for the master ledger of all seller-financed notes.
2. Pull `/api/export/properties?format=csv` for acquisition/sale dates and prices.
3. For each of his 31 active notes, log into the borrower portal as the borrower (he can't — this is a hole) **OR** call `/api/borrower/.../statements?type=1098&year=2024` for each note via curl with founder admin token (workable but undocumented).
4. For each property, call `/tax-optimization/cost-basis/:propertyId` and `/tax-optimization/depreciation/:propertyId` — script in Python, paste into Margaret's spreadsheet.
5. Pull `/api/audit-log?startDate=2024-01-01&endDate=2024-12-31` to demonstrate provenance of any disputed line.
6. Pull `/api/export/backup` as a paranoia copy and store offline.

This is workable but takes a weekend, and a non-technical Land Investor could not do it without help.

---

## Priority Ranking for Wave 3 Engineering

1. **P0 — `audit-packet` endpoint.** One click, one ZIP, one signed manifest. Removes the entire "weekend of scripting" failure mode.
2. **P0 — `cpa` / `auditor` role + read-only scoping + view-logging.** Margaret cannot start without this.
3. **P0 — Legal hold flag freezing retention purges.** Without this, evidence ages out during the audit.
4. **P1 — Server-side batch 1098 PDF generation.** IRS doesn't trust client-rendered PDFs, and 31 manual exports is fragile.
5. **P1 — Drizzle middleware to force `audit_log` writes on every UPDATE/DELETE of financial tables.** Closes the silent-mutation gap.
6. **P1 — Append-only cost basis adjustments with `effectiveDate` and `correctsAdjustmentId`.** Required for "what did you know on 12/31/2023?" questions.
7. **P2 — Hash verification on document retrieval + immutable dual-write.** Document tamper-detection.
8. **P2 — Export manifest with stored sha-256 + reproducibility check.** Prove that today's export equals last month's.

---

## Files Touched If We Build This

- `shared/schema.ts` — add `legal_hold` boolean on organizations; new `audit_packet_exports` table; refactor `cost_basis` to append-only adjustments.
- `server/routes-import-export.ts` — new `audit-packet` handler, signed manifest writer.
- `server/routes-borrower.ts:770` — extract 1098 logic into a service callable from a new `routes-tax-optimization.ts` batch endpoint.
- `server/middleware/roleGuard.ts` — add `cpa`/`auditor` roles and view-logging hook.
- `server/services/costBasisTracker.ts` — adjustment append-only refactor.
- `server/jobs/dataRetention.ts` — legal-hold check before purge; tier-based retention.
- New: `server/middleware/auditMutations.ts` — Drizzle middleware that captures before/after on financial tables.
- New: `server/services/auditPacket.ts` — assembly + signing.

---

## What Bartholomew Will Say When This Ships

"I clicked one button. Margaret clicked one link. The IRS got one folder. I slept."

That's the deliverable.
