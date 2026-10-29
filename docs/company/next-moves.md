# Next moves

The running hand-off between sessions. Update it at the end of every session:
what shipped, what it measured, and the top next moves. Newest first.

## 2026-10-29 — V-Tax-1 T3a — bid discipline: max bid from the rights stack, over-max flag, pre-bid discards, Courthouse Mode recording again — on `claude/tax-v1-t3a-bid-discipline` (stacked on T2b)

- **Storage.** Migration 0297 adds columns only; the table count is unchanged (founder decision 2026-10-28).
  - `tax_sale_listings.max_bid_basis`: the rights-stack decision record.
  - `tax_sale_listings.discard`: the kill reason, CHECKed to the four reasons.
  - `auction_bid_log.max_bid_cents_at_action` and `over_max_reason`. A CHECK means a reason can only exist beside the max it went over, on an amount that exceeded it.
- **Max bid** (`shared/tax/maxBid.ts`). It is value − liens the operator's own search says survive − other taxes − costs − required return. Each line carries its source and as-of date.
  - It is labelled a screen; the recorded line items are the decision record.
  - A missing line refuses and names itself. "Searched, none found" is stated; "not searched" is missing, never 0.
  - AcreOS does not decide which liens survive a sale; the line is named for what the operator recorded.
  - The worksheet editor previews with the same function the server records with. A typed max that differs drops its basis and reads "your typed number — no basis recorded".
  - Golden cases are in `shared/tax/golden/max-bid-golden.json`.
- **Over-max.** A bid or win now needs the amount actually bid or paid.
  - Over the max, it is flagged in the dialog BEFORE it is sent, and the server refuses it without a stated reason (422, nothing recorded). With a reason, it is recorded beside the max it exceeded.
  - The worksheet Bid button used to log the max itself as the amount bid, so the check could never fire. The Won dialog pre-filled the max as "what you paid". Both are fixed.
- **Discards.** A lot is discarded before bidding with one of: unbuildable, landlocked, contaminated, or other (with its reason).
  - Bidding on it is refused; passes still record. Reopening keeps the discard on record and restores the prior status.
  - Triage moves discarded lots out of the diligence order into their own list, and shows a recorded lien search instead of "no lien search has been performed".
- **Courthouse Mode recorded nothing, ever.** It POSTed to `/api/auction-listings/:id/log-bid`, a route that never existed, toasted "Action queued — we'll sync" and advanced anyway. The service worker queued that same dead prefix.
  - It now posts to the real bid log, and asks for what was paid on a win, with the over-max flag.
  - It advances only when the action was recorded or queued by the service worker; a refusal stays on screen. Skip writes nothing.
  - `sw.js` queues exactly the bid-log path (`OFFLINE_QUEUEABLE_PATTERNS`). A test fails if any queued prefix is not a mounted route.
- **ORM fixed (T2b's note).** `tax_certificates.id` is uuid in shared/schema now, the 15th uuid id family.
- **Escalated, not fixed — a national default (stop condition).** `preForeclosureNoticeMonths: 1` is the same value for 45 of 51 states in `shared/regulatory/taxLienStateRules.ts`.
  - It reaches the cert workflow payloads (`stateForeclosureNoticeMonths`, `server/services/certificateEvents.ts`) and the state-rules text ("roughly 1 month of pre-foreclosure notice", `server/routes-tax-rules.ts`).
  - The T0 remedy (refuse, don't present) would apply. It needs the founder's call, as T0's four did. T3b's foreclosure-filing deadline does not use it.
- **Next.** T3b covers three things:
  - the auction calendar in the county's own timezone. No county→zone mapping exists anywhere in the repo, and every tax date is UTC midnight today; the zone will be stated with its source, never guessed.
  - the bidder-registration checklist as a stage gate on `tax_sale_auctions` (columns, no table);
  - the certificate ledger (subsequent taxes paid, notices recorded, foreclosure-filing deadline) as `tax_events` types.

  Then T4.

## 2026-10-29 — V-Tax-1 T2b — redemption clock, calendar, alerts, locks, quiet-title gate — on `claude/tax-v1-t2b-clock-gates` (stacked on T2a)

- **Storage.** Migration 0296 adds `tax_events`: the tax calendar, where each redemption expiry carries the rule it rests on.
  - It is append-only and leaves only with its certificate.
  - The FK is `uuid`, because the DB's `tax_certificates.id` is uuid although the ORM says varchar.
  - It also adds `tax_certificates.deadline_source` and `quiet_title_cases.market_exception`, and retires `auction_readiness_checklists`. The founder's four-for-four swap is complete; the table count is 748.
- **Clock** (`shared/tax/clock.ts`, `GET /api/tax-certificates/:id/clock`). It covers:
  - the countdown, the rule cited (AcreOS's preliminary rule, or the county record entered) and the 90/30/7 alert dates;
  - the next action, and the "do not improve, do not market" lock with what clears it;
  - the capital tied up, and marketability in AcreOS;
  - a cross-check against the county procedure's stated period, where a mismatch is shown and never resolved.
  - On the redemption-clock page it opens from a per-certificate "Clock" button.
- **Nightly job.** It never overwrites a deadline the operator entered; until now it clobbered won-bid overrides in the 10 encoded states.
  - A computed deadline it corrects is re-registered on the calendar.
  - New one-shot 90- and 30-day alerts fire only the tightest threshold crossed. The daily 7-day alert and the workflow lanes are unchanged.
- **Quiet title.**
  - A case opens only once redemption has expired; redeemed and cancelled certificates are refused.
  - An attorney-reviewed exception can be recorded with the attorney's name and the reason.
  - Marketable in AcreOS means the deed is held AND the petition is filed or the exception is recorded. AcreOS never declares title marketable.
- **Flat-penalty honesty.** The redemption-clock Rate column now reads "25.00% flat penalty", "x/mo" or "x/yr". The workflow templates' "statutory rate" now reads "20% penalty — one-time, not an annual rate" for GA and TX.
- **Escalated, not fixed (attorney-gated legal reading).** Encoded TX `flat_first_period` adds the 50% second-period premium ON TOP OF the 25% (75% total) once past 6 months, and uses a 6-month first period even in the 24-month owner-occupied case. Whether that matches Tex. Tax Code §34.21 is a legal reading for the founder or an attorney.
- **Guard correction.** The guarded drops in 0294–0296 check for rows through `EXECUTE` (see the deletion ledger), and the fix is ported to T1 and T2a.

## 2026-10-29 — V-Tax-1 T2a — procedure objects + county-verification gate + bidding lock — on `claude/tax-v1-t2-procedure-clock` (stacked on T1)

- **T2 ships as two PRs, each net zero on tables.**
  - T2a: procedure objects and the bidding lock.
  - T2b: the clock and calendar (`tax_events`), 90/30/7 alerts, the redeemable-deed lock, the quiet-title gate, and flat-penalty honesty on the existing surfaces.
- **Storage.** Migration 0295 adds `tax_procedure_objects`.
  - It is versioned: UPDATE and TRUNCATE are refused, and a change is a new version. DELETE stays allowed so erasure completes.
  - It is org-private: one organization's verification is never shown to another.
  - It retires `county_redemption_rates` with the guarded, atomic drop. The table count stays 748.
- **The procedure object** (`shared/tax/procedure.ts`) records instrument, bid method, interest or penalty, redemption period, notice, foreclosure / quiet-title path and subsequent taxes.
  - Every field carries its source, its as-of date, state law or county practice, and its verification. AcreOS authors none of them.
  - A source over 12 months old raises the stale-law banner. County practice is labelled "not state permission".
- **The bidding lock (T2 [AUDIT]).** A county is biddable only with every required field, no stale field, and a county-verification task under 12 months old. Otherwise `POST …/bid-log` refuses `bid`/`won` with a 422 and the reasons, and records nothing.
  - `passed`, `outbid` and `no_show` stay open.
  - **Every county starts locked** until someone records its procedure and verifies it. This is the spec's intent; it will block bidding for existing users until they do.
- **UI.** A procedure card on each county watch: standing, reasons, banner, every field with its provenance, and forms to record a version and complete the verification.
- **Flat penalties** are described as "one-time, not an annual rate" (`describeReturn`).
- **Not in T2a.** The clock, alerts, locks and quiet-title gate (T2b). Seeding procedure objects from the old state tables was not done: that would put AcreOS-authored "law" into a store whose whole point is sourced, verified fields.

## 2026-10-29 — V-Tax-1 T1 — tax-list import, county watches, triage — on `claude/tax-v1-t1-watch-triage` (stacked on T0)

- **Storage (founder swap, net zero).**
  - Migration 0294 adds `tax_county_watches` and `tax_lot_observations`; the observations table is append-only and leaves only with its lot.
  - It retires `tax_sale_alerts` and `lien_search_records` with a guarded drop. The checks and the drops are ONE statement, because `migrate.mjs` runs the next statement after a failure.
  - It was proven by hand that a retired table holding a row survives, and so does its empty sibling.
  - `tax_sale_listings` gains `sale_date` and `import_id`, and `total_tax_owed` becomes nullable.
  - The table count stays 748.
- **Import (extended in place, not a parallel importer).**
  - The existing lot-list import gains a sale date, which is required unless the list is imported into an auction with a date (that date is recorded with the auction as its source), and delinquent years, which are required.
  - Amount owed becomes optional. Unstated is null, never 0, and is not summed.
  - The commit is one transaction. It writes the lots, a provenance observation per stated cell (file, row, column, raw), a recorded blank for each optional column the list has but leaves blank, the parcel/APID match, and a county watch per county.
  - Owner names are not copied into observations.
- **One parcel resolver.** `landData/resolveOwnedParcelRef` is extracted from the note-tape commit, which now calls it, so "matched" means the same thing in Notes and Tax.
- **Watches and triage.** Routes: `GET /api/tax-watches`, `PUT /api/tax-watches/:id/terms` and `GET /api/tax-watches/:id/triage`.
  - A watch's terms are stated values with a source, or unknown.
  - Triage (`shared/tax/triage.ts`) lists each lot's unknowns ordered by decision weight ÷ cost kind. It is labelled a screen. Costs are kinds, never dollars.
  - The panel sits on the auction worksheet, behind the tax-delinquent door.
- **Golden.** `shared/tax/golden/tax-list-golden.csv` plus its hand-written expected output.
- **Not in T1.**
  - Address-only lots: the APN stays required, which is stricter than the spec's "APN and/or address".
  - A row-level all-or-nothing commit: rejected rows are reported and the valid ones import, as before. Required columns still refuse the whole file.
  - Procedure objects and the clock (T2), bid discipline (T3), and the disagreement panel (T4).

## 2026-10-28 — V-Tax-1 started (Notes V1 complete: N1–N4 merged, main `45ed282`). T0 — tax defaults refuse instead of inventing — on `claude/tax-v1-t0-refuse-defaults`

- **Send gate re-verified.**
  - Main is `45ed282`.
  - The D2c tables (`parcel_apids`, `parcel_apn_windows`, `parcel_lineage_events`) are in migration 0291 on that head.
  - Staging deploy run 40743046229 succeeded on `45ed282`.
- **Map first.** Main already has nine tax-sale tables, two CSV importers, a redemption clock with a nightly job, quiet title and an auction worksheet.
  - None of it records per-field provenance or resolves to an APID.
  - Three rule stores disagree with each other.
  - Four tables are dead: nothing reads or writes them.
  - `note_events` cannot hold tax dates, because it requires an acquired note.
  - The forward-calendar registry the package assumes still does not exist.
- **Founder decisions** (`docs/company/founder-decisions-2026-10-28-tax.md`):
  - Swap the four dead tables for four purpose-built ones; the table count stays 748.
  - Fix the national defaults first, in their own PR.
- **T0 fixes.**
  - No 12% fallback: a state with no rule gets no amount, and the reason is stated.
  - No owned-deed fabrication: a certificate with no computable deadline is refused unless the county's deadline is entered with its source.
  - Quiet-title steps open undated, in procedure order.
  - An unknown redemption period scores nothing in the county opportunity score.
- **Left for T2.**
  - GA/TX flat penalties are still shown beside annual rates. Annualised-return honesty belongs to T2.
  - The nightly job still overwrites deadlines in the 10 encoded states.
  - Quiet title has no status gate yet.
  - SCRA tolling is still unimplemented; it is a founder decision, tracked in `statuteRegister`.

## 2026-10-27 — V-Notes-1 N4 — disagreement capture and negative knowledge — on `claude/notes-v1-n4-disagreement` (stacked on N3)

- **Disagreement.** For each term and yield field, the note record returns every distinct value any import stated, each with all its sources, plus which value the book holds (`bookValueIs`). A source stating a value the book lacks also counts as a disagreement: a later tape fills a field the first left blank, and a re-import never updates the book row. Nothing is resolved, averaged or deleted.
- **On the page.** A "Sources disagree on N terms" panel sits above the terms. It lists every value with its provenance chip, marks the book value, and says AcreOS has not picked one. Each disagreeing row carries a "sources disagree" badge.
- **Negative knowledge.** The import now records a `searched_none` observation for an optional field when the tape HAS the column but the cell is blank. The record distinguishes `blank_on_source` ("blank on the tape (column X) — asked, nothing stated") from `never_stated` (no import had the column). A later tape lacking the column does not erase the earlier "asked and blank". Collateral, liens, tax status and hazards already carried searched-none vs never-searched from N1/N2.
- **Tests rewritten to the new truth, not deleted.** `noteTapeCommit.realdb` and `noteRecord.realdb` had pinned "a blank field has no row". They now pin that a blank is never a value: it is a searched-none row, and a field the tape has no column for still has no row.
- **Not in N4.** Warehouse-vs-tape disagreement on a TERM: the warehouse holds no note terms, so there is nothing to compare yet. Collateral value comes only from the warehouse. Operator resolution of a disagreement (choosing a book value) is a write path the spec did not ask for.

## 2026-10-27 — V-Notes-1 N3 — outcome and forward-calendar hooks — on `claude/notes-v1-n3-events` (stacked on N2)

- **Storage.** `note_events` (migration 0293 + mirror) is the second of the founder-approved +2 tables, so the table count is now 748. It is append-only and org-private on the same terms as `note_field_observations`: a row leaves only with its note, so org erasure still completes (real-DB tested). CHECKs tie each event type to its category, and allow a recurrence only on a payment due that stays inside maturity.
- **Outcome hook.** Each imported row records one `performance_reported` event (status, paid-through date, balance), dated by the tape's as-of, or by the import date with that said. No model reads it. It is raw material for V-Notes-2 calibration.
- **Calendar hook.** Every imported row registers its maturity. Next payment due (monthly through maturity), balloon and next rate adjustment are registered only when the tape STATES them. A next due date is never derived from the due day. A new optional tape field, "Next rate adjustment", is stored as an observation and an event; it has no `acquired_notes` column.
- **Validator.** A next due, balloon or rate-adjustment date after maturity now refuses its row and names the cell.
- **Read.** The note record gains `outcomes` (every report, oldest first) and `calendar` (the latest registration per type, or why none is on record). The note page shows a "Dates on record" card: recorded only, nothing scheduled or sent.
- **Not in N3.** Alerts, clocks, reminders and borrower comms (V-Notes-2, inside the consent rails). No calibration model. Posted servicing payments are not mirrored into outcome events: that would touch the payment-posting path, which is money-adjacent.

## 2026-10-27 — V-Notes-1 N2 — the note page record — on `claude/notes-v1-n2-note-page` (stacked on N1)

- **Route.** `GET /api/notes/:id/record` (`server/routes-note-record.ts` + `services/notes/noteRecord.ts`). Owner/admin only; another org's note and a malformed id are the same 404.
- **Provenance on every value.** Each term and yield field carries the observation that states it: tape file, row, cell, as-of, confidence. A value entered outside the import says "no source recorded".
- **Investment-to-value** is purchase price ÷ the collateral's market value on record, shown only when both are known.
- **Document set.** present / missing / exception / no record, with the critical gaps named.
- **Collateral picture.** From the owned public-record parcel: value with its source and retrieval date, tax amount and year, APID or the reason there is none. Tax status, senior liens and hazards say "not searched" (no data model or lookup exists yet), never clean. Unmatched and never-searched are separate empty states, each with its next action.
- **UI.** `NoteRecordPanels.tsx` on `/notes/:id`: terms first, documents and yield beside them, collateral second, the existing ledger below as the timeline. Provenance chips open to the tape row and cell.
- **Not in N2.** The disagreement panel (N4; the record already returns every observation of a field). A live lien or hazard lookup (none exists; one would be a provider call and money-adjacent).

## 2026-10-27 — V-Notes-1 started (D2 merged as #412). N1 — note-tape import — on `claude/notes-v1-n1-import`

- **Storage (founder-approved +2 tables).** `note_field_observations` (0292) holds every stated value with provenance, plus recorded absences. It is append-only and leaves only with its note. `note_events` lands with N3. The table count is now 747. Decision record: `docs/company/founder-decisions-2026-10-27-notes.md`.
- **Importer.** `shared/notes/noteTapeFields.ts` (catalogue) and `server/services/notes/noteTapeImport.ts` (pure validator).
  - Refusal before build: an unmapped required field refuses the whole file.
  - Row errors carry the field, the cell and the fix. Nothing is coerced; missing is null.
  - Targeted per-cell corrections are recorded as `operator_correction`.
  - The document set (note, mortgage/DOT, assignment chain) must be mapped, and an exception must be recorded.
  - Yield fields are first-class: three new nullable columns on `acquired_notes`.
- **Commit.** `noteTapeCommit.ts` runs in one transaction.
  - It refuses unless every row is valid or explicitly excluded.
  - An existing loan number is never overwritten: values are appended and the differing fields are reported (N4's raw material).
  - Collateral is resolved to an owned public-record parcel, and to an APID where a FIPS reference exists. Otherwise it is recorded as `searched_none`, or as nothing when there was no APN.
- **Routes and UI.** `POST /api/note-tape/preview` and `POST /api/note-tape/commit` sit behind `canImportData`. `NoteTapeImport.tsx` is mounted in the existing notes import dialog (Finance door → notes tab, and `/notes?action=new`).
- **Retired.** The old acquired branch of `POST /api/import/notes` (`importAcquiredNotesFromCSV`) wrote rate 0, term 360 and a derived maturity, and called any unknown status "performing". The branch now refuses, and the function is deleted.
- **Golden note.** `shared/notes/golden/note-tape-golden.csv` plus a hand-written expected output, asserted end to end.
- **Not in N1.** The note page (N2), events (N3), the disagreement panel (N4), and borrower TIN import (deliberately not imported).
- **Spec gaps flagged.** The four design docs the spec cites (`files/platform-*.md`, the deepening doc) are not in the repo, so the nano-bar audit can only be run against what the spec itself states. The spec says the forward-calendar registry exists; it does not (`note_events` in N3 is that registry).

## 2026-10-27 — Delta audit on e398c3a3: the last gap, `source_parcel_id` dedupe in release assembly (founder: implement)

- **Dedupe.** `assembleAndStoreRelease` now reads each included county's parquet back (digest-checked) and keeps ONE row per `source_parcel_id`.
- **Which row wins.** The LAST copy in artifact order. That is the stable id sort over the source's `OBJECTID ASC` paging, so the highest source OBJECTID wins, i.e. the most recently inserted feature. There is no per-row edit date to judge recency, so this is stated as the deterministic rule. The rule is documented in the code header and in INTEGRATION-D2b.
- **What the release names.** A county with a repeat gets a deduped artifact pair, uploaded and bucket-confirmed like a build's, and the release names that pair. A county without one is named exactly as built.
- **Reporting.** Drops are reported in `AssemblyReport.deduped`.
- **No unchecked release.** With no object store, assembly refuses to store a release it could not check.
- **Downstream refusals stay** as defense in depth: lineage `duplicate_source_id` and the release diff.
- **Proof.** `tests/unit/releaseAssemblyDedupe.test.ts` drives the real entrypoint on real artifacts in a file-backed bucket. The as-built artifact is refused by lineage; the stored release names the deduped pair (the later copy wins) and lineage accepts it. A no-dedupe mutant and a first-copy-wins mutant each turn it red.
- **Docs cleaned.** The stale per-lane D2b/D2c "STAGED pending approval" lines in the 2026-10-24 entry now point to the 2026-10-25 wiring.

## 2026-10-26 (later) — CI round trip red on 5f14b02d: client tools newer than the server

- **What broke.** In CI run 40321419022, `build-schema` sub-check 10/10 failed on `pg_restore: ERROR: unrecognized configuration parameter "transaction_timeout"`. Nothing in the repo had changed: the same scripts passed on `5d11a766` the day before, and none of the dump/restore/workflow files had changed since 2026-10-11. `db-backup.sh` and `db-restore.sh` called whatever `pg_dump`/`pg_restore` came first on PATH. The runner's client tools moved past the `pgvector:pg16` service, and a 17+ client sends `SET transaction_timeout`, which 16 rejects.
- **Fix at the source.** `scripts/lib/pg-client-for-server.sh` resolves `pg_dump`/`pg_restore` of the SERVER's major version and refuses a mismatch, naming the package to install. Both scripts use it, and the manifest records `serverVersion`. CI installs `postgresql-client-16` (falling back to the PGDG repository). The round-trip check is unchanged.
- **Proof.** A local shim reporting "17" that sends `SET transaction_timeout`: the old scripts reproduce CI's exact error; the new ones resolve 16's tools and pass. The full `build-schema` run passes 10/10 with the shim on PATH. `offProviderBackupIsProvenInCi.test.ts` now pins the resolved call, and its credential check reads the `$PG_DUMP`/`$PG_RESTORE` calls. A bare-`pg_restore` mutant turns it red.
- **Follow-up, not changed.** `server/jobs/dbBackup.ts` (the production backup job) still runs a bare `pg_dump`. It has the same hazard if the Fly image's client ever moves past the database's major version. It is a production path, so it is flagged here rather than changed in a CI fix.

## 2026-10-26 — D2 consolidated audit fix list (Tom decided every open item); same branch, nothing merged

### What shipped
- **Org erasure deletes the text-keyed tenant tables** (Tom: delete, not retain). `deleteOrganization` now compares each tenant key in its own type (integer key → number, text key → its decimal string). It refuses to start when a key has a type it cannot match. Only an FK violation (23503) is retried; any other DELETE error throws `OrgErasureError` BEFORE the org row is deleted, and so does a failed `financial_ledger` detach. `onboarding_funnel_metrics` and `pax_user_context` rows are now erased. Proven on a database built from the repo (`orgErasureTextKeyedTables.realdb.test.ts`); the old integer comparison turns it red. Retention (1A) unchanged and re-verified: `financial_ledger` is detached, `purpose_ledger` is kept.
- **D2e batch per lead (2A).** Each lead's debit and purpose row commit in that lead's own transaction, and its vendor call follows that commit. A refusal or ledger failure skips only that lead, and a failed lookup refunds only that lead's debit. If the pool refuses every lead, the response is 429 with nothing run. The single door is unchanged. Isolation tests are mutation-proven.
- **FCRA citation.** written_consent is §1681b(a)(2); the other three are (a)(3). The enum is unchanged, and the real thrown message is pinned.
- **Claim corrections** (verified against the repo before editing):
  - D2c has 44 tests counted syntactically (19 + 18 + 7), and 65 at runtime (`it.each` expands lineageGolden to 28). Quote it as "44 tests, 65 cases".
  - D2h has 22 numbered entries, not 23.
  - D2d: wave-1 states other than FL never auto-promote; FL (Nassau) does.
  - D2a: 310 MB is a lane-reported figure, not a measured one. The pinned bound is the 400 MB internal ceiling under the 512 MB gate cap.
  - The D2h E1 guard is at `streamingArtifacts.ts:355-390`.
  - The INTEGRATION-D2c §4 heading now says three tables.
- **Close-out verification.**
  - Migrations 0290 and 0291 are mirrored in `migrate.mjs`.
  - The table count stands at 746, with approval notes.
  - The new tables are in the tenancy lint's population and classified global (they have no tenant key).
  - 14 D2b/D2c reachability entries said "STAGED pending table approval". They are reclassified as TRACKED FOLLOW-UP: the exports are still unreached, so the entries stay.
  - **Release assembly did NOT dedupe `source_parcel_id`.** Downstream it failed closed (lineage refused the county). Implemented 2026-10-27; see that entry.
- **Evidence logs** are kept in `docs/evidence/2026-10-26/`.

### Tracked only (not fixed)
- D2b §4 served-answer stamping (`served_release_id` exists; nothing writes it).
- D2c §3 crosswalk proposal.
- `source_parcel_id` dedupe in release assembly (done 2026-10-27).
- Non-TN lineage: refused until there is a national county FIPS reference.
- D2d disclosed gaps.
- Cache `answeringLayer`.
- D3 parcel-delta cross-source disagreement.
- Regrid org-scoping policy.
- An FCRA counsel ruling before skip-trace volume grows.
- Regrid price verification before the first paying customer.
- Human reads of the TN and NC terms before activation.
- D2f go-live prerequisites.
- D2a TN-47000 key reconcile (read-only count first).
- Other `§1681b(a)(3)(F)` mentions outside `fcraAttestation.ts` (`ai/tools.ts`, `routes-leads.ts`, `statuteRegister.ts`, …) were left as they are; only the cited line was in scope.

## 2026-10-25 — D2 pre-merge fix list (Tom approved seven decisions via Muse); same branch, nothing merged

### What shipped (follow-up commits on `claude/d2-bulk-wave1-identity-trust`, no history rewritten)
- **Org erasure (merge blocker).** `purpose_ledger` keeps no FK to `organizations` and sits in `RETAINED_TABLES` (Art. 17(3)(b)). `deleteOrganization()` now finishes for an org with ledger rows. Proven against a real DB built from the repo, differentially against a ledger-free control org; re-adding the FK turns it red.
- **P0a.** Pax `get_lead_details` strips `taxId`/`taxIdType` (`omitSecretColumns`), proven on the serialized tool result.
- **P0b + D2e Option B.** `fundSkipTraceLookups` debits the pool and writes the purpose rows in ONE transaction, before any vendor call. `POST /api/skip-traces` is now funded: 429 on refusal, refund on a failed lookup.
- **D2b wired.** Migration 0290, `releaseStore`, `releaseAssembly` (inactive job), founder promote/rollback/inventory behind Controls, and the real inventory in `/api/ops/data`.
- **D2c wired.** Migration 0291 creates exactly 3 tables (the doc heading said two; its DDL has three). It adds `apidStore` and `releaseLineage` (inactive job; TN-only FIPS; refuses other states).
- **Table count.** 741 → 746 (+2 D2b, +3 D2c), each approved.
- **D2f.** Stays unwired.
- **Real-DB proofs.** Every real-DB proof was falsified per index and trigger.

### Escalations (open, not fixed here)
- `deleteOrganization` never sweeps the two text-keyed tenant tables, `onboarding_funnel_metrics.org_id` and `pax_user_context.organization_id`: `text = integer` errors silently, so they are residual on EVERY erasure. Whether to delete or retain them is a customer-data-deletion decision.
- `parcelDeltaDetector` fires `owner_changed` on source disagreement.
- Regrid facts are stored with no org.
- FCRA cite (a)(3)→(a)(2).
- Confirm the Regrid price from the invoice.
- D2h TN/NC holds.
- A national Census county-FIPS reference (lineage is TN-only until then).
- D2b §4 served-answer stamping: the `served_release_id` column exists, but nothing writes it.

## 2026-10-24 — Package D2, delivered per workstream on branch `claude/d2-bulk-wave1-identity-trust` (Muse audits each; nothing merged from this lane)

Worked as a fleet: one worktree agent per workstream (D2a–D2h) plus two spec tracks, file-disjoint, with every shared file (migrations, migrate.mjs, schema, etlHandlers, registry, ratchets, next-moves) changed only by the integrator. Each lane's claims were re-run centrally; reachability was fixed per landing, never by raising a baseline.

### What shipped
- **D2a.** Streamed statewide template (`statewideCadastral.ts`, `streamingArtifacts.ts`) with dossier-gated live upload (no receipts, no "ingested"). Bounded TN Comptroller loader, county by county with metros first and statewide refused (`tnComptrollerCounty.ts`; bounded under an internal 400 MB RSS ceiling pinned in `tnComptrollerCounty.test.ts`, below the memory gate's 512 MB cap; accumulating mutants OOM in that gate. A 310 MB peak was reported from one lane run under fleet load and is not quoted as measured: that run was not reproduced centrally). Rows are sorted by parcel id in UTF-8 order via a bounded external sort. The object key carries the digest, so a same-day rebuild can no longer overwrite a receipted object. TX refuses explicitly (`TX_BEACHHEAD_COUNTIES` is empty, with its reason). Dossier drafts for 9 states in `docs/land-data/dossiers/` (no terms read; network). The whole-county in-memory artifact path is deleted (pmtilesWriter, writeGeoParquet/readGeoParquet, uploadAndConfirm, persistLoadedCounty); tests were ported. `completeLoadedCounty` is now the one canonical way to complete a county load.
- **D2b.** Pure release core in `server/services/landData/releases/`: content-addressed manifest id, `acreos-parcels vYYYY.MM.N` names, a bounded sort-merge diff, and an append-only promote/rollback pointer. 128 tests. Storage was approved and wired on 2026-10-25 (migration 0290, `releaseStore`, `releaseAssembly`); see the 2026-10-25 entry above.
- **D2c.** `shared/landData/lineage.ts` + `apid.ts`: lineage classification (with an explicit `ambiguous` outcome), APIDs that are never reused, non-overlapping APN windows, and inheritance; a synthetic golden lineage case. 44 tests counted syntactically (`apid.test.ts` 19, `lineage.test.ts` 18, `lineageGolden.test.ts` 7); 65 at runtime, because `lineageGolden`'s `it.each` expands to 28 (`docs/evidence/2026-10-26/d2c-d2d-suites.log`). Tables were approved and wired on 2026-10-25 (migration 0291, three tables, `apidStore`, `releaseLineage`); see the 2026-10-25 entry above. Crosswalk defect fixed: a retired parcel key was re-minted for a split remainder.
- **D2d.** Remap hardened against 20 drift shapes; six defects fixed (greedy assignment, degenerate proof, a throwing live read, duplicate golden parcels, unverified adoption, empty drift). Semantic JV→JV_HMSTD is rejected by golden. Wave-1 states other than FL have no golden county, so they never auto-promote; FL (Nassau, `shared/landData/golden/fl-golden-county.json`) is the golden county that does.
- **D2e.** Purpose ledger (0289, append-only, proven on real PG — log kept 2026-10-26: `docs/evidence/2026-10-26/purposeLedgerAppendOnly.log`, run under ACREOS_REQUIRE_REAL_DB). Receipts are unforgeable (WeakSet). Census of 221 person-adjacent surfaces: 214 are in a shrink-only debt register.
- **D2f.** Historical-use screening: verdict is adverse / no adverse in verified sources / inconclusive, never "clean"; a verified absence needs a positive control. Indiana end to end on fixtures. Entry point deliberately unwired (route/Pax tool held for COO).
- **D2g.** `GET /api/ops/data`: paid fall-through no longer counts failed attempts as paid; coverage by state against a stated denominator; release inventory reads `not_built`; layer vocabulary derived from the writers.
- **D2h.** `docs/land-data/d2h-research-verification.md`: 22 numbered entries checked (A1–A3, B1–B12, C1, D1–D3, E1, E2, E2a); only the PMTiles/GeoParquet format facts are confirmed at source.
- **Spec tracks** (separate worktree branches, not on the D2 branch): D3 conflation-disagreement spec + prototype; vertical + Pax groundwork specs.

### Not done, and why
- No live runs: the container's proxy denies state hosts, Regrid, USGS and ChatGPT.
- D2f exposure waits on a COO decision (route / Pax tool). D2b/D2c storage was decided and wired on 2026-10-25.
- The research, the design docs (v1/v2/Amendment 2) and vendor invoices are not in the repo (paths are proposed in D2h §3).

### Escalations raised to the COO (not fixed here)
- `server/ai/tools.ts` `get_lead_details` sends the lead row incl. encrypted `taxId`/`taxIdType` to the model provider (D2e P0).
- `parcelDeltaDetector.ts:406` fires `owner_changed` when two sources disagree (D3 finding).
- The Regrid ETL stores Regrid facts platform-wide with no org (`etlHandlers.ts:239-243`; D3 finding).
- Holds proposed by D2h: TN bulk upload, NC bulk storage (G.S. 132-10). Also: FCRA consent cite (a)(3)→(a)(2), and confirm the Regrid price from the invoice.
- `POST /api/skip-traces` makes a paid vendor call with no customer debit (pricing question, D2e).

### Next moves
1. Muse: audit each landed workstream; decide D2b/D2c tables, D2f exposure, D2e Option B (debit and ledger in one transaction), and the escalations above.
2. A networked session: read state terms into the dossiers; record positive controls for the D2f adapters; establish a golden county per wave-1 state.
3. D3 (conflation disagreement) is ready to start from its spec once D2b/D2c storage lands.

## 2026-10-23 — Package D1, data-sourcing foundation (bucket-independent parts), branch `claude/d1-data-sourcing-foundation`

### What shipped
- **D1a.** The Regrid cost table is at the published per-record floor (10¢ Standard / 15¢ Premium), and an empty answer or a free-source answer now costs 0. The credit-weight re-base was held at first (D1 stop condition): weights are what a customer's pool is debited, so changing them changes price. The founder decided it on 2026-10-23 (`b576d53f`): `parcel_lookup_paid` 8→10, `owner_lookup` 8→15, `valuation_lookup` 10→15, so no lookup weight sits below Regrid's cost.
- **A3.** `provider_lookup_log` gains `intent_class`, `answering_layer` and `confidence_served` (migration 0287), and the registry writes them on every path. A row with an org is that org's demand event. There's no reader yet.
- **D1c + A4.** `statewide_layer_metadata_v1` makes two metadata calls per statewide layer and reports drift against the last poll, the last ingest and the documented cadence. The orchestrator's new `finalize()` writes `etl_runs.observation` once per run, so the runs form an append-only snapshot series.
- **A2.** Every statewide row carries a dossier and a derived policy block. Every block is restrictive, because no terms were read.
- **D1b + A1.** `fl_statewide_cadastral_v1` refuses on a missing mapped field, an unbounded run, or an unverified county field. It writes canonical records with per-group provenance and decay class, GeoParquet and PMTiles locally, and `uploaded:false` receipts. It is never "ingested" without bucket-confirmed receipts and resolved use classes.
- **A5.** `tests/fixtures/golden/fl-golden-county.json` (moved in D2 to `shared/landData/golden/`; since established — five verified Nassau parcels) had five honest pending slots, and a CI harness checks them.
- Both jobs are seeded **inactive**.

### Not done, and why
- **Not run against live data.** The build container's network policy denies the state and Regrid hosts, so none of the live parts ran: the FL dry run, the 5-parcel spot check, the golden-county values and the live poll. They need a session that can reach `services9.arcgis.com`, `geodata.floridagio.gov`, `floridarevenue.com` and the other statewide hosts.
- **Design docs not in the repo.** `files/data-sourcing-intelligence-*.md` weren't available, so the D1 package text was used. The assumptions (Layer names, §12 use-class mapping, §8 RCW section) are noted in the code.

### Next moves
1. In a session that can reach the hosts:
   - run the FL dry run on one county;
   - fill the five golden slots from the county appraiser;
   - read the nine terms pages into the dossiers;
   - arm the poller.
2. D2 (TN county ingest) and D3 (delta ingest + `lastIngestedAt` per source).

## 2026-10-21/22 — Readiness packages 1–5 and the PR train (implementation lane; Muse audits and merges)

### Merged to main (main = 14748ed7 at 2026-10-22 03:40Z)
#388 (follow-redirects + vite advisories), #389 (entry chunk under budget),
#390 (letter-render launch timeout), #392 (Package 2, CAM FKs), #393
(Package 3, desktop-feel harness auth), #394 (Package 1, one org per signup),
#377 (transfer tax from statute), #391 (ops/ledger/kill-switch routes before
the /api catch-all).

### Refreshed onto main, waiting on CI and Muse (do NOT merge from this lane)
- **#395 Package 5, refund posting** — head 8d3d8ed0, 17/17 green. #394's
  restructure merged textually clean but put the chart-of-accounts seed
  OUTSIDE `if (provisioned.created)`; moved inside, after the `!isFounder`
  block (founders get charts). `chartOfAccountsSeedCallSite.test.ts` parses the
  file and fails on git's auto-merged version. Muse verified the carry.
- **#378, #380–#383, #385–#387** — each a merge of main with its port files
  equal to main and ratchets set from `--measure` on the merged tree (as-any:
  #378 → 1061, #381 → 1058; everything else at baseline). #382/#387
  migrate.mjs checked line-by-line against the merge base (both sides kept).
- **#379** — head 734c0f01 (merge of 14748ed7, as-any → 1062); draft, Muse
  marks ready. **#384** stays held until #379 merges (stacked; routes-elite-
  features.ts needs a semantic merge).
- **Package 4, canonical uuid ids (this branch).** The 14 parents and their 40
  child columns are uuid in shared/schema; KNOWN_DB_PUSH_MISMATCHES (38) is
  gone; `CONVERGE_UUID_ID_FAMILIES` in migrate.mjs converts a db:push-built
  database in place (no-op on prod). Evidence on 14748ed7: db:push of main vs
  this branch into scratch DBs differs in exactly 54 columns, all varchar →
  uuid (14 ids + 40 children), 738 tables / 656 FKs both sides; 0 of 648
  schema-declared FK columns mismatched; full suite 18,284 green with realdb.
  Refreshed onto post-train main bd35343b (2026-10-24): `npm run check` exit 0
  (no baseline moved), full suite 18,713 green, `db:build-from-repo` PASS on
  a fresh Postgres 16 with the 14 ids and the CAM trio's `lease_id` (cam_reconciliations,
  commercial_sales_reports, lease_rent_schedule) uuid with live FKs, and the
  convergence test 4/4 against real Postgres. The stale "STILL UNRESOLVED"
  note on the CAM block in migrate.mjs now records the resolution.

### Found, not fixed (needs a person)
- **npm's audit service is failing** (2026-10-22 ~02:35–03:20Z: 503, then 400
  "this endpoint is being retired. Use the bulk advisory endpoint"). npm
  Dependency Audit (and Security Gate with it) went red on #381, #382, #385;
  the same gate passes locally once npm answers. Needs "Re-run failed jobs" —
  this session's token gets 403.
- **The audit gate reads an audit that never ran as "0 vulnerabilities"**
  (`scripts/npm-audit-gate.mjs` never checks the report's error key). It went
  red tonight only because the accepted list is non-empty; with an empty list
  it would pass green over no scan. Security Gate then says "found critical
  vulnerabilities" when none were found. Proposed to Muse as its own PR.
- **drizzle-kit push exits 0 when a statement fails** — onto an unconverted
  varchar database ("cannot be cast automatically to type uuid"), and onto a
  database missing pgvector ("type vector does not exist"). Staging must
  converge through `migrate.mjs --ddl-only` (the nightly reconcile) before any
  manual db:push; noted in scripts/setup-staging.sh.

### Top next moves
1. Muse merges the refreshed train; re-check each remaining PR with
   `git merge-tree` after every merge, refresh only what conflicts.
2. After Package 4 merges, confirm the next staging-schema-reconcile run logs
   `OK: DO $uuid_ids$` and staging's 14 parents read uuid.
3. D1 (data sourcing: Regrid true cost, Florida bulk ETL, change-detection
   poller) — waits for Muse's spec.

## 2026-10-21 — Customer Journey Audit, next layer (issue #359), branch `claude/cj-journey-next-layer`

### What was wrong (each verified by running it locally against a production build)
- **One signup became several orgs.** A new user's first screen fires its
  queries in parallel and each reached `getOrCreateOrg` with no org: 5 orgs in
  23 ms for one user locally. `getOrganizationByOwner` had no ORDER BY, so an
  UPDATE (finishing onboarding) moved the resolved org and the next request
  landed in a fresh, un-onboarded one — /today bounced back into the wizard
  ("no first-value CTA"). The same race ran the signup rate limit once per
  request (5/email/hour), so a new user's own first page could 429 itself.
  Fixed: per-process coalescing + per-user advisory lock with re-check, and
  oldest-org resolution. Test: `tests/integration/orgProvisioningIsSingular.db.test.ts`.
- **"Transition was skipped" page errors**: `client/src/lib/view-transitions.ts`
  discarded the ViewTransition; skips now handled, real failures still
  reported once. Test: `tests/unit/viewTransitionSkipIsHandled.test.ts`.
- **The staging E2E token path was not exempt from the per-user rate limit**
  (the local flag always was): one synthetic user walking 9×2 viewports spent
  300/min and 429'd its own /today. `isE2eTestTraffic` now exempts both; never
  true in production (no token there). Test: `tests/unit/e2eTokenTrafficSkipsUserRateLimit.test.ts`.
- **Harness**: token now sent on every same-origin request (documents too —
  without it a document gets Clerk's handshake redirect), service workers
  blocked for CJ1 (SW-reissued /api requests lost the token), the consent
  banner is answered, and the config no longer leaks the token as
  `x-e2e-test-auth` to every origin.
- **A decorative gate found on the way**: CJ1's "clickwrap" check matched the
  cookie banner's "Privacy" text on bare /auth (sign-in, which has no
  clickwrap). It now opens `/auth?mode=register` and reads the ToS checkbox.

**Measured (local, production build, 12 Chromium projects, CI retries):**
before 2 expected / 6 flaky / 4 red (15 attempts "no first-value CTA", 6
click timeouts, 5 orgs for one user, 148 429s); after 12/12 passed on the
first attempt, 1 org, 0 429s, 0 page errors.

### Not verified here
- WebKit (iPhone projects): no WebKit build in this sandbox. The "composer
  missing on /ai" class is WebKit-only in CI; the next CI run is the check.

### Top next moves
1. Dispatch the audit on the branch; if iPhone stays red, read its
   error-context artifact before changing anything.
2. Count production users owning more than one org (counts only) — the race
   predates this fix; merging duplicates is a founder decision (customer data).
3. The consent banner covers the onboarding Continue button at 360 px — design call.

## 2026-10-21 — #386 amended to land-only (COO ruling under the founder's delegation)

- Land released; buy-and-hold is NOT. Its decision route
  (`server/routes-buy-and-hold-underwriting.ts`), page
  (`client/src/pages/rentals/underwrite-rental.tsx`), nav entry and spotlight
  module are removed from #386 and kept intact on
  `claude/buy-and-hold-underwriting` for a later PR gated on end-to-end journey
  evidence in the Readiness Atlas. The `rental_acquisition` engine stays as a
  calculator: it records nothing on its own, so buy-and-hold measures below
  `decided` and the demotion law requires its `beta` claim.
- `PUBLIC_CLAIM_DEMOTIONS` 11 → 12 entries (buy_and_hold restored); overclaim
  baseline 12 (main 13); ladder entry `surfaced`.

## 2026-10-20 — V0 vertical program re-applied (staged, not committed)

### Staged on `claude/recover-v0-vertical-program`
- Stranded commit `6f6c65f4` (V0: evidence rule v2, underwriting kit, land and
  buy-and-hold released) re-applied onto main. Its defects were renumbered
  because main had issued 0285–0288 meanwhile: 0285 → **DEFECT-0290**,
  0286 → **0291**, 0287 → **0292** (0289 reserved by another branch).
- One vertical rule, not two: `shared/governance/evidenceLadder.ts` no longer
  restates the OD-5 demotions by hand. Each vertical entry states one readiness
  tier and its claim/caveat derive from it; `verticalReadiness.test.ts` pins the
  ladder to the measured tier, the demotion map and the gradeable set
  (mutation-checked). Land and buy-and-hold now read "closes the canonical loop";
  subdivider carries "decided, not yet gradeable".
- New wall-clock reads from the stranded commit converted to `clock`.

**Measured:** targeted vitest 50 files (routeManifest run twice) / 776 test runs green; lint:reachability,
clock-reads, no-fabrication, boundaries, browser-safe-shared, org-fetch exit 0.
`npm run check`, the full suite and the build were NOT run (memory limits).

### Top next moves
1. Run `npm run check`, full `npm test` and `npm run build`, then an
   independent audit of the re-applied wave before committing.
2. DEFECT-0292 (acquisition-cost wording vs `total_cost`) is a founder-visible
   product choice.

## 2026-10-19 — Open Fieldstone items closed (Muse)

### Shipped to main
- **Company branding editor.** Settings → Organization now has a Company
  branding card: accent color (picker + hex, 6-digit validated), logo URL
  (absolute http(s), live preview), density (compact/comfortable/adaptive).
  Writes go through PATCH /api/tenant-theme (owner/admin only, enforced
  server-side); everyone else sees it read-only. Reset-to-defaults clears all
  three back to the theme. Test: `tests/unit/brandingEditor.test.ts`.
- **Accessibility prefs follow the person.** `/api/me/preferences` now accepts,
  validates, and deep-merges an `accessibility` blob (same JSONB column as
  appearance); the client hydrates from the server on login and debounced-PATCHes
  changes — the same pattern as appearance in theme-context.tsx. localStorage
  stays the fast-boot cache. The stale header comment about the non-existent
  `use-sync-accessibility-prefs` hook is corrected.
  Tests: `tests/unit/accessibilityPreferencesSync.test.ts` (15 tests).

**Measured:** new unit tests 15/15 green; appearanceContract + tenantKey
suites still green (56 tests); tsc clean on changed files.

### Top next moves

1. Then resume the 2026-10-18 list below (land the waiting branches; time to
   first deal; every paid action covers its cost).

## 2026-10-18 — Fieldstone redesign (`claude/fieldstone-redesign-q48nuj`)

### Built, on a branch with a draft PR, waiting for founder review

The approved Fieldstone redesign (founder decisions recorded in
`founder-decisions-2026-10-18-fieldstone.md`), implemented in the real app:

- **Three colorways, one product.** Fieldstone (default), Bedrock, Meridian ×
  Light / Dark / Match device, from one contract (`shared/appearance.ts`) read
  by both pickers, the boot script, the server and the gates. Retired themes
  migrate (Homestead → Bedrock, others → Fieldstone) with no customer row
  rewritten.
- **Appearance = Colorway + Display.** Font, density, motion and list-style
  pickers retired; Accessibility & comfort is its own section and owns reduced
  motion (the device setting is now honoured — it was being switched off).
- **One mark** across the app, auth, public pages and every installed icon /
  launch image (regenerated, reproducible from the manifest and index.html).
- **Fixed on the way** (each with a test that fails without the fix): undefined
  `--card-border` (every card outline was the text colour), `useIsMobile()`
  used as a boolean in four components, dialog close buttons dropped to the
  bottom, Today's section spacing lost on phones, the Map toolbar overlapping
  on phones, Finance's heading below its cards, the banner hidden under the
  rail, and — found by the independent review — the deploy-time migrator that
  would have deleted every Homestead user's choice on the next release.

**Measured:** `npm run check` exit 0; `npm test` and `npm run build` results are
in the PR. Real-app screenshots (production build, E2E test auth, seeded
fixture data) for all 6 colorway × mode combinations at desktop and iPhone,
plus 320px and tablet spot checks, are under `docs/design/fieldstone/`.

**Entry-chunk budget:** CI's Build job measured the entry chunk at 747 KB against
the 745 KB ceiling in `scripts/bundle-budget.json` (CI reads ~6 KB higher than a
local `NODE_ENV=production` build of the same tree, so `main` sits close to the
line there). The ceiling was not raised. The quick-appearance dialog now
lazy-loads its pickers, which takes the entry chunk below `main`'s own
(local: 755.0 KB on the branch, 756.2 KB on `main` at `e413ab6`).

**Not verified here:** the logged-out landing and sign-in pages (no real Clerk in
this environment — the public server answers the Clerk proxy's 502, and test
auth has no logged-out identity); real map imagery (no map key locally); real
Safari on an iPhone.

### Top next moves

1. **Founder review of the Fieldstone PR** — look at the screenshots, try the
   three colorways on the phone, then merge and run the manual deploy.
2. **Company branding editor.** Org accent/logo are applied safely now, but no
   UI sets them (only the API). Put a small editor under Settings → Organization.
3. **Accessibility prefs follow the person.** They live only in this browser;
   the sync hook the context's header mentions does not exist. Store them with
   the account like appearance.
4. Then resume the 2026-10-18 list below (land the waiting branches; time to
   first deal; every paid action covers its cost).

## 2026-10-18 (earlier sessions)

### Built, on branches, waiting for review and merge

| Branch | What it does |
|---|---|
| `claude/billing-entitlement-truth` | Seats: plans include their seats without support; add-on billing counts only seats past the included ones. One plan table. Included Pax turns charge no credits; past the allowance, purchased credits or an own key fund turns; background AI jobs follow the same rule. |
| `claude/lead-to-deal` | "Make this a deal" on a seller lead: creates or links the property and the deal in one transaction; idempotent; honest refusal when parcel facts are missing. |
| `claude/persona-vocabulary` | Deals and Finance use each persona's vocabulary; route hiding matches by path in every nav surface. |
| `claude/route-load-performance` | Map code loads only on Map; quick-add sheet loads on tap; build-graph gate. Mobile door pages download about 1–1.7 MB less JavaScript. |
| `claude/isolation-sweep-in-ci` | By-id isolation sweep runs in CI; the public log carries counts only; empty runs fail. |
| `claude/sim-followups` | Statement portal answers 503 when unconfigured; `phone_normalized` declared as the generated column it is in production. |
| `claude/declared-uniques-enforced` | Migration 0281 creates the 17 declared unique constraints idempotently (warn and skip, never fail a deploy); founder-org diagnostics on `/founder/readiness`. |
| `claude/house-mail-option` | Physical mail via AcreOS house mail (purchased credits only, priced above cost + card fees + margin) or the org's own Lob key. |

Each needs: an independent review, a merge of current `main`, then a PR.

### Remember

- Production deploys are manual now (Actions → "Deploy to Fly.io"). Merging
  to `main` does not change production.
- The 2026-10-17 repricing needs new Stripe prices and updated Fly secrets
  before checkout charges the new amounts.

### Top next moves

1. **Land the branches above** (review → merge main → PR → founder merges →
   manual deploy).
2. **Time to first deal.** Re-run `tests/simulation/campaign/lifecycle-90-days.ts`
   and remove each stall: new parcels start with `land_status` "unknown",
   which blocks offer letters; double-submitting "Add lead" in the browser can
   create duplicates; `/api/trial/status` reads wrong for a fresh org.
3. **Every paid action covers its cost.** Apply the house-mail rule (price ≥
   cost × card fees × margin, purchased credits, refuse unknown cost) to skip
   tracing and paid data lookups; add a founder view of margin by action.
4. **Close the remaining simulation findings:** the team list returns more
   than viewer roles need; 137 by-id routes the isolation sweep cannot probe
   yet; real (non-simulated) send credit charges are not exercised end to end.
5. **The unverified ground** (`docs/testing/verification-plans/`): real Safari
   on iPhone, Stripe test mode end to end, Twilio/SES/Lob sandboxes,
   backup-and-restore drill, load at 1,000 organizations.

### Waiting on the founder

- Current Lob prices for every mail spec (to confirm the house-mail cost table).
- Whether to unify the two house-mail price lists, once real Lob prices are in.

## 2026-10-20 — Lead imports keep the parcel facts (`claude/p4-csv-import-keeps-parcel-facts`, uncommitted)

### Built (working tree, not committed)
- **One parser module, every import path.** `shared/leads/parcelFacts.ts`
  reads ACREAGE, ASSESSED value (county), ESTIMATED value (market) and
  TAX-DELINQUENT status (flag, amount owed, years) — refuse-not-fabricate:
  "N/A" / blank / garbage / a county 0 are null, never 0; a positive amount or
  years count implies delinquent. Used by POST /api/leads/csv-import,
  POST /api/leads/import/tax-delinquent, importLeads() (POST /api/leads/import,
  /api/import/leads + its background job) and processTaxDelinquentImport();
  header rule shared by the Smart CSV sheet and the tax-delinquent importer.
- **Migration 0286** (+ migrate.mjs mirror): `leads.assessed_value`
  numeric(14,2), `tax_delinquent_amount` numeric(12,2), `tax_delinquent_years`
  integer. Assessed ≠ estimated, never one written into the other.
- **Lead detail Parcel card**: property address, APN/county, acreage,
  "Assessed value (county)" vs "Estimated value", tax delinquent / owed / years.
- **Fixed on the way:** the Smart CSV sheet's `parseCsv` stripped quotes before
  splitting cells, so any quoted comma ("$45,000", "SMITH, JOHN") split a cell
  and shifted the row.

**Measured:** new tests `leadImportKeepsParcelFacts` (44) +
`leadCsvImportParcelFacts` (8); 31 related files / 556 tests green; 12
mutations all red. Lints schema-migrate-mirror / schema / ghost-fields /
measurement-defaults / reachability / no-fabrication / org-fetch exit 0;
ratchet measure at baseline. NOT run: npm run check / tsc / full suite.

### Next
1. Run `npm run check` + full suite on a machine that can, then commit.
2. processTaxDelinquentImport() still has no production route
   (`/api/import/tax-delinquent` is named in a 404 hint but never mounted).
3. The synchronous `/api/import/:entityType` path ignores a `fieldMap` the
   job path honours (no client sends one today).
