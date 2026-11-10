# Notes V2 Leg 3 — Step 0 inventory (items 7, 8, 9, 11)

- **Date:** 2026-11-09
- **Tree:** `claude/notes-v2-leg3-api` @ `0f86695ba` (Leg 1 and Leg 2 are already in the base)
- **Scope:** inventory only. This file is the only file written. No code, schema or commit changes.
- **Spec source:** the condensed §5 spec in the session brief. The package file is not in this repo, so test names for §7.3 tests 12–17 and §7.4.18 are **UNVERIFIED**. They are mapped here by subject only.

> **READ FIRST: a binding founder decision already amends §5.4.**
> `docs/company/founder-decisions-2026-11-05-b1-notes-v2.md` §3 (Muse, 2026-11-05, under the founder's standing rule) does two things:
> - It **cancels the new ATR determination record in §5.4** and reuses the existing `notes.atr_determination` jsonb.
> - It **closes the `POST /api/notes` bare-flag activation bypass** on every path.
>
> It also allows at most one append-only audit entry per determination write, and only "if it rides the existing `persistAtrDetermination` path cleanly". The condensed brief's §5.4 ("a record behind the 0099 boolean") must be read through this decision. This report follows the decision.

---

## ITEM 7 — Originated-book ATR state

### 7.1 Columns (Drizzle) and where they were introduced

| Column | Drizzle (`shared/schema.ts`) | Introduced by |
|---|---|---|
| `atr_determination` jsonb (8 factors, verification docs, QM class, attestation) | `:1114`–`:1143` | `scripts/migrate.mjs:287`. This is an idempotent ADD COLUMN list (comment `:283-286`: "Schema defines these … without a SQL migration"). **No numbered `migrations/*.sql` file creates it.** |
| `atr_determination_completed` boolean default false | `:1147` | `scripts/migrate.mjs:288` (same list) |
| `atr_determination_completed_at` timestamp | `:1148` | `scripts/migrate.mjs:289` |
| `atr_exemption_code` text `$type<"raw_land"\|"business_purpose"\|"commercial_borrower"\|"legacy"\|null>` | `:1161`–`:1163` | `migrations/0099_notes_atr_origination_gate.sql:29-30`, mirrored in `scripts/migrate.mjs:401` and in the CHECK blocks at `:8861-8915` |

The two CHECK constraints, quoted from `migrations/0099_notes_atr_origination_gate.sql`:

```sql
-- :38-42
ADD CONSTRAINT "notes_atr_exemption_code_check"
  CHECK (
    atr_exemption_code IS NULL
    OR atr_exemption_code IN ('raw_land', 'business_purpose', 'commercial_borrower', 'legacy')
  );
-- :60-66
ADD CONSTRAINT "notes_atr_origination_gate"
  CHECK (
    status <> 'active'
    OR atr_determination_completed = true
    OR atr_exemption_code IS NOT NULL
  );
```

- Grandfather UPDATE at `:48-52`: active rows with no ATR are set to `'legacy'`.
- Partial index `notes_atr_exemption_idx (organization_id, atr_exemption_code) WHERE atr_exemption_code IS NOT NULL` at `:70-72`.
- The CHECK constraints are also in `migrate.mjs` (`:8893-8913`), which is the migrator production runs. `abilityToRepayGate.test.ts:635-667` pins this.

### 7.2 Application paths that set them today

| Write | Sets | file:line |
|---|---|---|
| `persistAtrDetermination()` | `atrDetermination` = payload with `attestedAt = clock.now()`, `atrDeterminationCompleted = true`, `atrDeterminationCompletedAt` | `server/services/atrSafeHarbor.ts:216-258` (write at `:237-246`). **WHERE is `eq(notes.id)` only. It is not org-scoped.** It is listed in the org-scope lint register at `scripts/check-org-scoped-fetch.mjs:714`. The only caller pre-checks the org. It **overwrites in place.** |
| `POST /api/notes/:id/originate`, ATR branch | calls `persistAtrDetermination` with the attestor taken from the session | `server/routes-finance.ts:500-530` |
| `POST /api/notes/:id/originate`, exemption branch | `atrExemptionCode` ∈ {raw_land, business_purpose, commercial_borrower} | `server/routes-finance.ts:541-552`. Direct `db.update(notesTable)` with `eq(notesTable.id)` only (no org predicate). The route checks `storage.getNote(orgId, …)` first, at `:488`. |
| `POST /api/notes/:id/originate`, activation | `storage.updateNote(noteId, {status:"active"}, orgId)` | `server/routes-finance.ts:556-558`. Not in a transaction with the ATR/exemption write. |
| `POST /api/notes` | passes `req.body` (incl. a **bare `atrDeterminationCompleted: true`** or an exemption code) through `insertNoteSchema`, then `storage.createNote` | `server/routes-finance.ts:280-305`. **This is the bypass founder decision §3.2 orders closed.** |
| `PUT /api/notes/:id` | cannot set ATR fields: the strict `updateNoteSchema` excludes them | `server/routes-finance.ts:43-99` (`.strict()` at `:99`). Pinned by `abilityToRepayGate.test.ts:562-571`. |
| CSV import (`importNotesFromCSV`) | `atrExemptionCode: "legacy"` on **every** imported row | `server/services/importExport.ts:1676-1698`. Callers: `server/routes-import-export.ts:208` and `server/services/migrationJobs.ts:667`. |
| Demo seed | `atrExemptionCode: "business_purpose"` | `server/services/onboarding/demoDataSeeder.ts:131-135` |
| Sample seeder | `business_purpose` on every fixture; the fixture type mandates it (`:140`) | `server/services/onboarding/sampleSeeder.ts:204,236-238,266,410,525` → `:801` |
| Scripts | `'legacy'` via raw SQL | `scripts/seed-test-borrower.mjs:198-210`, `tests/e2e-mobile/global-setup.ts:292-310` |

### 7.3 What `tests/unit/abilityToRepayGate.test.ts` pins

**createNote gate** (`:161-246`):
- `status='active'` with no ATR and no exemption → refuses with `ATR_DETERMINATION_REQUIRED` before any insert.
- An omitted status fails closed (the DB default is `'active'`).
- `atrDeterminationCompleted` must be `=== true`; a truthy `1` refuses.
- An unknown or case-variant code refuses. An object smuggled through the code field refuses.
- `atrDeterminationCompleted=true` is allowed and persisted.
- **All four codes, `legacy` included, are allowed on create** (`:228-240`, `it.each`).
- `pending` with no ATR is allowed.

**updateNote gate** (`:254-331`):
- Refuses →active when the stored row has neither ATR nor exemption.
- Fails closed when the row is missing.
- Allows the stored ATR, a stored code, or `atrDeterminationCompleted=true` in the same update.
- An explicit `false` in the update overrides a stored `true` and refuses.
- An invalid code in the update refuses.
- Non-activating updates skip the gate select.

**Refusal shape** (`:338-360`):
- The message cites Reg Z §1026.43(c), names `persistAtrDetermination` and every code.
- `routes-finance.ts` maps `ATR_DETERMINATION_REQUIRED` to 422 **exactly 3 times** with `regulatoryCite`.

**`validateAtrDetermination`, pure** (`:397-444`):
- Accepts a complete payload.
- Names the missing factor.
- Requires third-party verification documents.
- Rejects tampered attestation text.
- The canonical text cites (c)(2), (c)(3) and §1026.25(c)(3).

**`persistAtrDetermination`** (`:447-490`):
- Writes all 8 factors, the documents, the attestation and the flag with its timestamp.
- Validates before writing.
- Throws when the note row is missing.

**Caller-path completeness** (`:516-611`):
- **RATCHET:** the only `.insert(notes|notesTable|sellerFinanceNotes)` sites are `server/routes-subdivisions.ts` and `server/storage/noteRepo.ts`.
- The subdivision bridge lands `pending`.
- `POST /api/notes` downgrades to `pending` unless active was requested with ATR or exemption. **It pins the string `req.body.atrDeterminationCompleted === true` at `:554`.** Leg 3 must rewrite this assertion, not delete it.
- The PUT schema has no `atr` keys.
- The from-deal carry maps to `pending`.
- The CSV import declares `legacy`.
- The demo seed declares `business_purpose`.
- The sample fixture type mandates `business_purpose`.

**DB CHECK** (`:614-690`):
- 0099 defines the gate exactly.
- `migrate.mjs` carries it inside a guarded DO block, with the grandfather UPDATE before it.
- No later migration drops it without re-adding it.

**Population gap (a finding):** the ratchet reads only `.insert(` sites. **No test enumerates `.update(notes).set({ status: … "active" … })` sites.** These are the payment-side flips in Item 8. `shared/governance/statuteRegister.ts:265` already names them as a "Residual: three payment-side status flips … rely on the DB CHECK alone".

### 7.4 `server/services/atrSafeHarbor.ts`

It is pure validation plus one persisted write.
- **Exports:** `ATR_ATTESTATION_TEXT` (`:113`), `attestorUserIdToInt` (`:133`), `validateAtrDetermination` (`:141`), `persistAtrDetermination` (`:216`), `computeBackEndDtiBps` (`:271`), `AtrIncompleteError` (`:97`), and types.
- **Callers:** `persistAtrDetermination` / `attestorUserIdToInt` / `AtrIncompleteError` are used only in `server/routes-finance.ts:28-31,500-530`. `computeBackEndDtiBps` call sites were not checked (**UNVERIFIED**).
- **Overwrite in place:** every call replaces `atr_determination`, so there is no history. This is the "overwrite-in-place concern" in founder decision §3.4.
- **`attestedAt`** is server time at write (`:219`). In the originate route, persist always runs before the activation, so `attestedAt < activation` holds on that path. **No activation timestamp is recorded anywhere** (see 8.4), so "dated AFTER activation refuses" cannot be checked today.

### 7.5 How `legacy` rows are represented and identified

- **Representation:** `notes.atr_exemption_code = 'legacy'` (`shared/schema.ts:1161`; CHECK at 0099 `:41`).
- **Indexed:** `notes_atr_exemption_idx` (org, code).
- **Counter rule (proposed):** a row with `atr_exemption_code = 'legacy'` is excluded from every track and reported in a separate labelled bucket ("legacy, flagged, not counted"). It is a single equality on an indexed column.
- **Conflict that needs a decision:**
  - The spec says "`legacy` can never be newly claimed".
  - Today `noteRepo.createNote` accepts `legacy` (`server/storage/noteRepo.ts:112`, pinned by the test at `:228-240`).
  - The CSV import (`importExport.ts:1697`) and the seed scripts newly claim it on every run.
  - If the gate refuses `legacy` on create, the originated-notes CSV import breaks.
  - **Proposed:** refuse `legacy` on `updateNote` and on any non-import create. Allow it only via an explicit import entry. Rewrite the `:228-240` assertion to that truth. This needs a ruling (see Open Questions).

---

## ITEM 8 — Origination path census

### 8.1 Status vocabulary of `notes`

- **Column:** `status: text("status").notNull().default("active")`, comment `// pending, active, paid_off, defaulted, foreclosed` (`shared/schema.ts:1046-1047`).
- **No CHECK constraint** on `notes.status` was found in `migrations/` (searched `notes_status`; only the index `notes_status_idx`).
- **Accepted by routes:** `PUT` takes `z.enum(["pending","active","paid_off","defaulted","foreclosed"])` (`server/routes-finance.ts:76`). `POST` resolves only to `pending` or `active` (`:285`).
- **Values written that are outside the comment:**
  - `late`, `suspended` — import, `importExport.ts:1513-1521`; the default fallback is `"active"`.
  - `delinquent` — `sampleSeeder.ts:238`.
  - `late` / `delinquent` are read as live in `portalPaymentPosting.ts:287` and the `webhookHandlers.ts:2066-2075` comment.
  - `cancelled` / `charged_off` / `sold` are read as closed in `trust/collateralWatchService.ts:26`.
- **"Consummated / activated":**
  - **NOT RECORDED as a fact.** There is no `activated_at` column and no activation event.
  - The only historical evidence is indirect. The 0099 CHECK forces every row that was ever `active` to hold `atr_determination_completed = true` or a non-null code.
  - A `pending` note can be PUT straight to `paid_off`/`defaulted`/`foreclosed` without ever activating. `updateNote` gates only `status === "active"` (`noteRepo.ts:190`). So "status ≠ pending" does **not** prove consummation.
  - **Proposed historical predicate:** `status <> 'pending' AND (atr_determination_completed = true OR atr_exemption_code IN ('raw_land','business_purpose','commercial_borrower'))`, excluding `legacy`.
  - **Going forward:** the activation record (Item 9) is the fact.
- **"Cancelled-before-consummation":**
  - **There is no `cancelled` status on this book.** A never-consummated deal is a `pending` row or a hard-deleted row.
  - `deleteNote` is a hard `DELETE` (`noteRepo.ts:242-246`; route `routes-finance.ts:607`).
  - **Finding:** hard-deleting an *activated* note today removes it from any count derived from `notes`, which would undercount the counter. See Item 9.

### 8.2 Every path that creates a `notes` row or moves one to `active`

| # | Path | Write file:line | Lands / moves to | Gate today |
|---|---|---|---|---|
| 1 | `POST /api/notes` (Finance form `client/src/pages/finance.tsx:2051,2083` defaults to `status:"active"`; `client/src/hooks/use-notes.ts:15`) | `server/routes-finance.ts:305` → `noteRepo.createNote` `:167` | `active` if body has the bare `atrDeterminationCompleted===true` or a non-legacy code (`:280-285`), else `pending` | app gate in `createNote` (`noteRepo.ts:104-123`) + 0099 CHECK. **Bypass: the bare flag with no record (founder decision §3.2).** |
| 2 | `PUT /api/notes/:id` (status → active) | `routes-finance.ts:385` → `noteRepo.updateNote` `:235` | `active` | app gate `noteRepo.ts:190-222` (reads the stored row) + CHECK |
| 3 | `POST /api/notes/:id/originate` (`client/src/components/AtrGate.tsx:189`) | `routes-finance.ts:530` / `:546-552` then `:558` → `updateNote` | `active` | ATR validation or exemption enum, then the `updateNote` gate + CHECK |
| 4 | Close & Carry `POST /api/notes/from-deal/:dealId` (`client/src/components/carry-note-dialog.tsx:101`) | `server/routes-notes.ts:3450` → `createNote`; mapper `routes-notes.ts:782-858` | always `pending` (`:855`) | activation goes through #3 |
| 5 | Subdivision lot→note bridge | `server/routes-subdivisions.ts:513-532` direct `db.insert(notes)` | `pending` | none needed at insert; activation via #3. Pinned at `abilityToRepayGate.test.ts:535-542`. |
| 6 | CSV import (`/api/import…` → `importNotesFromCSV`; migration jobs) | `server/services/importExport.ts:1676` → `createNote` | `active` (default), `paid_off`, `defaulted`, `late`, `suspended` | `createNote` gate passes on `legacy` |
| 7 | Demo seed (Settings → Add Demo Data, `server/routes-admin.ts` → `seedDemoDataForOrg`) | `server/services/onboarding/demoDataSeeder.ts:131` → `createNote` | `active` | passes on `business_purpose` |
| 8 | Sample seeder ("Try with sample data") | `server/services/onboarding/sampleSeeder.ts:801` → `createNote` | `active` / `delinquent` | passes on `business_purpose`. **These are synthetic rows; `realNote()` (`server/services/onboarding/sampleFilters.ts:31`) identifies them.** |
| 9 | **`noteRepo.createPayment`** (borrower portal verify-payment, `server/routes-borrower.ts:1045`) | `server/storage/noteRepo.ts:297-310` | sets `status: newBalance<=0 ? "paid_off" : "active"` **from any prior status, including `pending` and `defaulted`** | **0099 CHECK only** (no app gate) |
| 10 | `achAutopay` settlement | `server/services/achAutopay.ts:1304-1316` | `"active"` unless `defaulted`/paid off, so `pending`/`late`/`delinquent` all become `active` | **CHECK only.** Debits are created only for `status==="active"` notes (`:278`), so `pending` is unreachable in normal flow, but the write does not guard it. |
| 11 | Portal payment posting `postServicedNotePayment` | `server/services/borrower/portalPaymentPosting.ts:442-452` | same expression as #10 | **CHECK only.** The upstream guard `servicedNoteTakesPayment` (`:287-289`, used at `routes-borrower.ts:773`, `routes-finance.ts:1456`) excludes `pending`. |
| 12 | Stripe refund reversal | `server/webhookHandlers.ts:2063-2080` | `paid_off → active` only | CHECK only. **Reactivation, not first activation.** |
| 13 | ACH return reversal | `server/services/achAutopay.ts:1405-1410` | `paid_off → active` only | CHECK only. Reactivation. |
| 14 | Scripts | `scripts/seed-test-borrower.mjs:198` (INSERT `'active'`,`'legacy'`), `scripts/seed-james-note.ts:60` (update), `scripts/seed-wipe-tom-org.sh:286` (UPDATE) | various | CHECK only. Not production paths. |

Other writers of `notes` (`propertyTaxService.ts:202,269,391,405`, `achAutopay.ts:1438`, `financeAgent.ts:232` (`delinquencyStatus` only), `routes-borrower.ts:853,945,1074,1503,1569,1646`, `servicingWindDown.ts:112`, `routes-finance.ts:756`) were scanned. **None writes `status`** (filtered for `status`). The Pax tools only read notes: `get_notes` filter, `server/ai/tools.ts:166-178,1658`. No AI path creates or activates a note.

### 8.3 The chokepoint

There is **no single chokepoint today.**
- `noteRepo.createNote` (`server/storage/noteRepo.ts:88`) and `noteRepo.updateNote` (`:180`) are the app-level gates. Paths 1–4 and 6–8 pass through them. Path 5 inserts directly but only as `pending`.
- **Bypasses (status → `active` outside the repo gate):** rows 9, 10 and 11 can turn a non-active row `active`. Rows 12 and 13 do it only from `paid_off`.

**Proposed smallest hook set:**

1. **`noteRepo.createNote`, when the resolved status is `active`.** This covers paths 1, 6, 7 and 8. The gate does not hook the import/seed paths specially: `legacy` keeps them out of scope (see the 7.5 ruling), and `business_purpose` on seeds is non-consumer.
2. **`noteRepo.updateNote`, when `updates.status === "active"` AND the stored status is `pending`** (first activation). This covers paths 2 and 3. Transitions from `late`/`delinquent`/`defaulted`/`paid_off` to `active` are servicing cures, not consummation, and are not re-gated.
3. **One shared pure helper, `nextServicedStatus(prior, balanceCents)`, used by rows 9, 10 and 11.** It never yields `active` when `prior === 'pending'`; a pending row stays pending. This removes the payment-side activation door rather than gating it. It also lets a new ratchet enumerate every `.update(notes…)` site that writes `status` and require the helper (this is the population gap in 7.3). Rows 12 and 13 already require `prior === 'paid_off'`.
4. **Optional DB backstop (in 0307).** A `BEFORE INSERT OR UPDATE OF status ON notes` trigger that refuses `pending→active` (and `INSERT … 'active'` with a non-legacy code) unless an `activation_gate_passed` record exists for the row in the same transaction. **Constraint the design must solve:** on a direct INSERT the row has no id yet, so the trigger cannot look up a record keyed by note id. That case would have to be refused, or keyed differently.

   The app gate cannot be the only defense because the count is computed outside the row. A CHECK cannot count. The trigger is the "mutate the thing it governs" backstop. It is flagged as optional because a trigger on `notes` is new ground for this table.

### 8.4 Facts the counter and gate need: where each lives

| Fact | Where | Status |
|---|---|---|
| Org | `notes.organization_id` `shared/schema.ts:1011` | recorded |
| **Seller key** | The org is the seller on the originated book. The only per-seller discriminator is `notes.owning_entity` text, nullable, free text ("Smith Land LLC", `:1093`). `properties.owning_entity` is the same (`:847`). There is **no entity table** (searched `legalEntities`/`entities`/`businessEntities`). `deals` has no seller field (`type` acquisition/disposition only, `:881`). | **NOT RECORDED as a structured key.** Proposed seller key = `(organization_id, normalized owning_entity)`. `NULL` means "the organization itself". Stated as a limitation: two spellings of one LLC are two sellers. The activation record should snapshot the seller key the gate used. |
| Seller type (natural person / estate-trust / entity) | — | **NOT RECORDED** anywhere on `notes`/`deals`/`properties` |
| Seller-financed flag | Implicit: every `notes` row is a seller-financed note the org originated (comment `shared/schema.ts:1095-1103`). `acquired_notes` is the separate book. | recorded **by table** (population = `notes`) |
| Dwelling-secured | — on `notes`. Proxies only: `properties.structure_type` text (`shared/schema.ts:829`, includes `vacant_land`) and `atr_exemption_code='raw_land'` (implies non-dwelling). `acquired_notes.collateral_is_dwelling` exists but **only on the acquired book** (`shared/schema/notes-vertical.ts:235-236`). | **NOT RECORDED** for originated notes |
| Consumer / business purpose | — on `notes`. Proxy: `atr_exemption_code='business_purpose'` / `'commercial_borrower'`. `acquired_notes.is_consumer_purpose` is acquired-only. | **NOT RECORDED** |
| Consummation / activation date | `notes.start_date` NOT NULL (`:1040`; carry sets it to `deal.closingDate`, `routes-notes.ts:810`). `created_at` (`:1171`). `atr_determination_completed_at` (`:1148`). An `audit_log` row with `action:"originate"` (`routes-finance.ts:570-586`) on path 3 only. | **No activation timestamp column.** Proposed: consummation date = `start_date`; activation time = the new activation record. |
| Exemption claimed under §1026.36(a)(4)/(a)(5) | — | **NOT RECORDED.** The `atr_exemption_code` vocabulary is §1026.43 scope, not (a)(4)/(a)(5). |
| RMLO engagement | — | **NOT RECORDED** |

**Historical rows (pre-Leg-3) have no dwelling, purpose or seller-type facts.** A row with `atr_determination_completed=true` implies a consumer dwelling (ATR was only needed for those). `raw_land` implies non-dwelling. `business_purpose` / `commercial_borrower` leave dwelling unknown. Counting unknown-dwelling history in track (a) is a policy decision. See Open Questions.

### 8.5 Terms elements for §5.2.3

| Element | Where it lives | Can it be UNANSWERED? |
|---|---|---|
| Balloon | **NOT RECORDED on `notes`.** `notes` is a fully-amortizing schedule built from (principal, rate, term) (`noteRepo.ts:25-62,125-133`). There is no balloon column. A balloon can exist only in free text (`notes_text`, e.g. `sampleSeeder.ts:410` "Balloon review at year 5"). | Yes. No field exists, so it is always unanswered today. |
| Negative amortization | **NOT RECORDED.** The generated schedule cannot neg-am when payment ≥ interest, but `monthlyPayment` can be PUT (`routes-finance.ts:51`) and nothing checks it against interest. | Yes, always. |
| Rate type / first adjustment / caps | **NOT RECORDED.** `notes.interest_rate` is a single numeric (`:1018`). There is no rate-type, adjustment or caps column. | Yes, always. |
| Seller-constructed dwelling | **NOT RECORDED** | Yes, always. |

**Consequence:** every §5.2.3 element is unanswered for every originated note today. Under "an UNANSWERED element refuses and names itself", **every claimed (a)(4)/(a)(5) exclusion refuses until the operator records the terms facts.** Leg 3 must add the place to record them (Item 9) as tri-state `yes | no | unanswered`. Absence of the key means `unanswered`, never `false`.

---

## ITEM 9 — Storage for the §5.3 RMLO record and the §5.4 ATR record

### 9.1 What Leg 1 and Leg 2 did

- **Leg 2 (0301)** and **Leg 1 (0302)** each widened only the CHECK constraints on `note_events`: category, source and type↔source binding (`migrations/0301_*.sql`, `migrations/0302_*.sql`). There was no new table. The append-only triggers from 0293 (`note_events_guard`, `migrations/0293_notes_v1_note_events.sql:51-73`) are unchanged. Registration is mirrored in `scripts/migrate.mjs:13066-13124`.
- **Vocabulary after 0302:**
  - categories `outcome | calendar | analysis | delinquency`
  - sources `note_tape | operator_correction | workout_engine | aging_engine | operator_recorded`
  - types `performance_reported`, `payment_due|maturity|balloon|rate_adjustment`, `workout_analysis_run`, `delinquency_stage_entered|default_review_recorded`
  - (`shared/schema/note-events.ts:24-46`, CHECKs at `:68-80`)

### 9.2 Why `note_events` cannot carry Leg 3's records

- `note_events.note_id` is `uuid NOT NULL REFERENCES acquired_notes(id) ON DELETE CASCADE` (`shared/schema/note-events.ts:52-54`).
- Leg 1 and Leg 2 are **acquired-book** features (UUID ids, `routes-note-delinquency.ts:11-13` states the two books never share a route).
- Leg 3's population is the **originated `notes` book, keyed by integer `notes.id`.** A `note_events` row cannot reference a `notes` row.
- Making `note_id` nullable and adding an integer FK would alter a founder-approved table and change `NoteEvent.noteId` to `string | null` for every acquired-book reader. That is wider than adding a table.

**The other carriers fit no better:**
- `notes` columns would be mutable, not append-only, and need a migration anyway. They would also be about a dozen new columns.
- `founder_settings` (`shared/schema.ts:10423`) is a global, mutable KV (`updatedAt`/`updatedBy`). It is not org-scoped or append-only.
- `note_payoff_quotes` (`shared/schema/notes-vertical.ts:1134`) shows a cross-book key (`note_system` ∈ {acquired_note, serviced_note} + `note_ref` text, `:1128`). It is a quote table and the wrong shape.

### 9.3 DECISION — (b) one new table, PROVISIONAL migration 0307 (Tom-approval pending; disclosed in the PR)

**Table: `note_origination_records`** (domain module `shared/schema/note-origination-records.ts`, re-exported via the barrel. The `schema-monolith-tables` ratchet forbids adding it to `shared/schema.ts`.)

| column | type | notes |
|---|---|---|
| `id` | uuid pk default `gen_random_uuid()` | |
| `organization_id` | integer NOT NULL | every reader filters on it; no FK to organizations (same posture as `note_events`) |
| `note_id` | integer **NULL** REFERENCES `notes(id)` **ON DELETE SET NULL** | deliberate deviation from `note_events`' CASCADE. §1026.25(c)(3) retention plus counter integrity: a hard-deleted activated note must still count. |
| `note_id_at_record` | integer NOT NULL | snapshot, so a record whose note was deleted stays attributable |
| `kind` | text CHECK ∈ (`origination_facts`, `rmlo_engagement`, `activation_gate_passed`, `threshold_release`, `atr_determination_written`) | |
| `detail` | jsonb NOT NULL | shape per kind, below |
| `supersedes_id` | uuid NULL REFERENCES self | corrections are new rows that supersede by reference |
| `recorded_by` | text NOT NULL CHECK (length(trim) > 0) | user id from the session |
| `recorded_at` | timestamptz NOT NULL default now() | |

- **Triggers:** the 0293/0305 pattern. No UPDATE, no TRUNCATE. DELETE only via the org cascade if one is added, otherwise never.
- **Index:** `(organization_id, kind, recorded_at)` and `(organization_id, note_id)`.

**`detail` shapes (zod in `shared/notes/sellerFinanceGate.ts`):**
- `origination_facts`: `{ sellerKey, sellerType: 'natural_person'|'estate_or_trust'|'entity'|'unanswered', dwellingSecured, consumerPurpose, claimedExclusion: 'a4'|'a5'|'none', balloon, negativeAmortization, rateType: 'fixed'|'adjustable'|'unanswered', firstRateAdjustmentMonths|null, ratecapsStated: 'yes'|'no'|'unanswered', sellerConstructedDwelling, consummationDate }`. Booleans are tri-state `'yes'|'no'|'unanswered'`.
- `rmlo_engagement` (§5.3): `{ originatorName, licenceIdentifierAsStated, engagementDate }`, with `recorded_by` as the recorder. **Completeness of the stated fields only; the gate never claims licence verification.**
- `activation_gate_passed`: the full gate input snapshot (the counts used per track with their population ids, the facts record id, the ATR basis or exemption code, the checker element verdicts, engine version) and `activatedAt`. This follows the `note_payoff_quotes` / `workout_analysis_run` input-snapshot precedent. It is **the activation fact the counter reads going forward.** It is a record of a past event, not a stored count; counts are still recomputed at check time.
- `threshold_release` (§5.2.4): `{ threshold: 'creditor_1026_2_a_17_v', calendarYear, rollingCount, calendarYearCount, decisionRef }`. `recorded_by` must satisfy `isFounderUserId` (`server/services/founder.ts:90`). **Recorded-decision pattern found:** there is no existing per-org founder-release table. The repo's founder decisions are prose (`docs/company/founder-decisions-*.md`), mirrored in `shared/governance/constitution.ts`. `founder_settings` is global and mutable, and `decisions_inbox_items` (`shared/schema.ts:9346`) is a founder inbox with mutable status. Proposed: a `threshold_release` row whose `decisionRef` points at the dated decision doc or decisions-inbox item id, written by a founder-only route. **This needs Tom/Muse confirmation.**
- `atr_determination_written`: an audit copy of each `persistAtrDetermination` payload, written in the same transaction as the column write. Per founder decision §3.4 this is allowed **only if** it rides that path cleanly: one row per write, no column change. Whether it fits cleanly is **UNVERIFIED** until built. If it does not fit, it ships as the named follow-up.

**Boolean projection (§5.4, under founder decision §3):**
- **Record:** the determination record stays `notes.atr_determination`. `atr_determination_completed` / `_completed_at` remain the projection that `persistAtrDetermination` writes. No other code path may set them.
- **Enforcement:** (i) remove the bare flag from `POST /api/notes`; (ii) `createNote`/`updateNote` treat `atrDeterminationCompleted===true` as satisfied **only** when `atrDetermination` is non-null, passes `validateAtrDetermination`, and `attestedAt ≤ activation time`; (iii) a new test proves `atrDeterminationCompleted:true` with `atrDetermination:null` refuses on every path.
- **Making it structural is not required by the decision.** It would need a 0307 CHECK `atr_determination_completed = (atr_determination IS NOT NULL)`, which needs a backfill review: rows may hold `true` with null jsonb (e.g. `tests/db/paymentsInsertOnBuiltSchema.ts:78` inserts `true` with no record). **UNVERIFIED how many prod rows violate it.** Recommended for a later migration, not 0307.

**Ratchet effect:** `scripts/ratchets/table-count.json` `baselineCount` 749 → 750, with `lastBumpNote` naming migration 0307 and PROVISIONAL / Tom-approval pending.

---

## ITEM 11 — Checker library shape

### 11.1 `server/services/doddFrankChecker.ts` (416 lines)

- **Exported:** `checkDoddFrankCompliance(input: DoddFrankInput): DoddFrankCheckResult` (`:137`), and the types `DoddFrankInput` (`:53`), `ComplianceRisk` (`:107`) and `DoddFrankCheckResult` (`:109`).
- **Not exported:** `evaluateSellerFinancerExclusions(input): ExclusionEvaluation` (`:322`). Its doc comment says "Exported for tests" (`:320`), but it is not exported. `ExclusionEvaluation` (`:307`) is also internal.
- **Purity:** pure. The only import is `DISCLAIMER_WORKSHEET` (`:51`). No DB, request or response coupling. Callable at activation time.

**Element checks (all inside `evaluateSellerFinancerExclusions`):**
- **Balloon:** `hasBalloon` from `rateType ∈ {balloon_under_5yr, balloon_5yr_plus}` or `balloonAfterMonths > 0` (`:326-329`). It fails (a)(4) at `:344` and is permitted under (a)(5).
- **Negative amortization:** `negativeAmortization === undefined` → `unknown` (`:337-338`). Fails or unknown for both exclusions (`:345-346`, `:357-358`).
- **Rate:** `adjustable` with no `firstRateAdjustmentMonths` → `unknown`, `< 60` → `failed` (`:332-336`). **Rate caps are NOT modelled.** There is no caps input, although the header (`:17-18`, `:28-29`) names "reasonable caps". The spec's "or without stated caps" has **no implementation to reuse.**
- **Seller-constructed:** `sellerConstructedDwelling` is a required **boolean** (`:61`). It fails both exclusions (`:343`, `:356`). **It cannot be "unanswered"**, and the route defaults it to `false` (`routes-dodd-frank.ts:38`), which is an assumed answer.
- **Count:** `n > 3` fails (a)(4) (`:342`); `n > 1` fails (a)(5) (`:355`).
- **(a)(5) seller type:** `entity` fails it (`:354`). `estate_or_trust` passes.
- **ATR for (a)(4):** `abilityToRepayDetermined` `undefined` → unknown (`:349-350`).
- **`hasDwelling`:** a required boolean (`:59`). It cannot be unanswered.

**How "unanswered" is represented:**
- **Inputs:** an optional field left `undefined` (only `negativeAmortization`, `firstRateAdjustmentMonths`, `abilityToRepayDetermined`).
- **Outputs:** `unansweredElements: string[]` (`:113`, `:298`) in human prose ("whether the schedule can negatively amortize"). There are no stable codes.
- **Gap:** the evaluation picks the *best* exclusion. It does not return a verdict for a *claimed* exclusion. A balloon note that claims (a)(4) but qualifies for (a)(5) returns `1_property_natural_person`.

**What the gate should import:** export a new pure function from the same module. Proposed name `evaluateClaimedExclusion(claim: 'a4'|'a5', facts)`. It returns per-element `{ element: ElementCode, verdict: 'met'|'failed'|'unanswered', reason }`.
- It reuses the existing element logic by refactoring `evaluateSellerFinancerExclusions` to build on it, so the page and the gate share one rule (the "canonical with real adoption" law).
- It adds `rateCapsStated` and tri-state `sellerConstructedDwelling` / `hasDwelling` / `sellerType` as optional inputs. When omitted they are `unanswered` **for the gate**. The page path keeps its current defaults so the existing tests stay green.
- Existing `checkDoddFrankCompliance` output must stay byte-identical for current inputs: `doddFrankChecker.test.ts`, `legalDisclaimers.test.ts:90-120` and `paxDoddFrankClaimsMatchTheRule.test.ts`.

### 11.2 `shared/regulatory/rmloAdvisor.ts` (391 lines) and the usury modules

- **`advise(input: AdvisorInput): AdvisorOutput`** (`:292`) is a pure per-deal posture: RMLO likely, Reg-Z timing, state usury cap in bps, SCRA, HOEPA warning, checklist. Its input `collateralType` (`:26-34`) distinguishes dwelling vs `vacant_land` and `isBusinessPurpose`. That is useful vocabulary for the origination-facts record, **but it is an advisory, not a record.** It is consumed by `server/services/usuryConsensus.ts:45`, and its output is cached on acquired notes (`compliance_posture_json`, `shared/schema/notes-vertical.ts:213-224`).
- **`assessHabitualness({ loansOriginatedTrailing12Months, … })`** (`:200`) is a tiered self-assessment of the org-level count: `exempt_de_minimis | low_volume_review | likely_habitual (4+) | definitely_habitual (5+ / ads / brokering)`, `:160-198`.
  - This is **the only existing consumer of a seller count.** Its input is typed, not derived.
  - Leg 3's counter could feed it as a second consumer. That is optional and not required by §5.
  - **Call sites of `assessHabitualness` outside its file: NOT FOUND** in `server/` or `client/` (grep for `rmloAdvisor` returned only `usuryConsensus.ts` and comments). It has zero production callers.
- **Nothing about RMLO engagement records exists anywhere** (NOT FOUND).
- **Usury:** `server/services/usury.ts` (`checkUsury`, used at `routes-finance.ts:240-256,317-330`), `usuryCeiling.ts`, `usuryConsensus.ts`. These are unrelated to Leg 3's gate and should stay untouched.
  - `shared/governance/statuteRegister.ts:724` records that four usury tables exist and disagree.
  - `shared/regulatory/sellerFinancingRules.ts` is the state contract-for-deed rules module, which is not reused.

### 11.3 The checker page and route today

- **Client:** `client/src/pages/dodd-frank-checker.tsx`. Route `/dodd-frank` (`client/src/App.tsx:291,1791-1792`, `FlaggedRoute`). It is linked from `client/src/lib/today-vertical-surfaces.ts:142`.
- **API:** `POST /api/dodd-frank/check`, in `server/routes-dodd-frank.ts:13-52`, mounted at `server/routes.ts:122,2360` (`app.use('/api/dodd-frank', isAuthenticated, doddFrankRouter)`). Manifest entry: `server/routeManifest.ts:130`.
  - The route uses `sendError`, not `Errors.*`, and untyped `Request`.
  - It does **no org lookup**, so it can see no deal today.
- **Count input:** **typed by the user.** It is `form.sellerFinancedDealsLast12Months`, default `"1"` (`dodd-frank-checker.tsx:59`), a text input at `:139-140`, sent via `parseInt` (`:82`).
  - **§5.5 work:** add an optional `noteId`. When it is present, the server derives the count from the counter (org-scoped; a cross-org note returns 404) and labels it "from your book". With no `noteId`, the typed count stays and is labelled "hypothetical".

---

## PATTERNS (how Leg 1 and Leg 2 built)

- **Routes:**
  - The feature file `server/routes-note-<feature>.ts` exports `registerNote<Feature>Routes(app)`. Examples: `routes-note-workout.ts`, `routes-note-delinquency.ts:28`.
  - It is imported and called in `server/routes.ts:200-201,2448-2449`.
  - It is listed in `server/routeManifest.ts:233-234` (`kind: "register"`, `mountPath: null`) and checked by `tests/unit/routeManifest.test.ts`.
  - Guard: `[isAuthenticated, getOrCreateOrg, requireRole(["owner","admin"])]`. Another org's note returns `Errors.notFound`. The service module is loaded with `await import` and `Errors.*` is used throughout.
- **Services:** `server/services/notes/*.ts` (e.g. `delinquencyLadder.ts`, `workoutAnalysis.ts`, `noteRecord.ts`). They do org-scoped loads and return `null` meaning 404.
- **Pure shared logic:** `shared/notes/*.ts` (`workoutEngine.ts`, `workoutRunRecord.ts`, `delinquencyLadderView.ts`, with a `golden/` fixtures dir).
- **Migrations:**
  - `migrations/NNNN_<area>_<what>.sql`, guarded `DO $migNNNN$ … $migNNNN$` blocks, header comment stating what changes and what does not.
  - **Mirrored verbatim** as entries in `scripts/migrate.mjs`, each with a comment "// NNNN — … Mirrors migrations/NNNN_….sql" (`:13066-13140`).
  - The highest in this tree is `0305_wholesale_buy_boxes.sql`. Numbers 0303, 0304 and 0306 are absent here; whether other branches use them is **UNVERIFIED**.
  - `0305` is the closest precedent for a new append-only table (`migrate.mjs:13127-13140+`: CHECK on `created_by`, guard trigger).
- **Ratchets that will notice Leg 3:**
  - `table-count.json` (749, down-only; the bump needs a note).
  - `schema-monolith-tables.json` (358; a new table must go in `shared/schema/`).
  - `storage-linecount.json` (`server/storage.ts` only, untouched by the plan).
  - `route-shadowing.json` (new `/api/notes/:id/...` integer-id paths must not shadow the acquired-book UUID routes in `routes-notes.ts`).
  - `res-status-raw.json` (use `Errors.*`; note that `routes-finance.ts` already has raw `res.status(422)` sites, which the `abilityToRepayGate` test counts at exactly 3).
  - `sql-raw.json`, `as-any.json`, `req-as-any.json`, `clock-reads.json` (use `clock.now()`), `console-in-server.json`.
  - No line-count ratchet covers `routes-finance.ts` (1,675 lines) or `routes-notes.ts` (3,577). Not found in `scripts/ratchets/*.json`.
  - Also `tests/unit/paxDoddFrankClaimsMatchTheRule.test.ts`, which scans **every string literal in `server/` and `shared/`** mentioning 1026.36(a). New gate messages must cite (a)(4) as 3-property and (a)(5) as 1-property and never say a balloon breaks (a)(5).
- **Yield and payoff precedent (item 6 context):**
  - `GET /api/notes/:id/yield` (`server/routes-notes.ts:2373`) reads **acquired notes only** (`acquiredNotes`, `:2382-2386`) and their `notePayments`. It computes `computeYields(...)` live from stored terms and payment history and stores nothing.
  - `note_payoff_quotes` (`shared/schema/notes-vertical.ts:1134-1180`) is the persisted counterpart. Each quote stores its inputs as columns plus `engine_version` and a verbatim `engine_input_json`, "so the number can be recomputed and defended years later". It is keyed across both books by `note_system ∈ {acquired_note, serviced_note}` + `note_ref` (`:1128`).
  - Leg 3's `activation_gate_passed` record follows this pattern: a full input snapshot plus engine version, recomputable.

---

## OPEN QUESTIONS (need a ruling; not decided here)

1. **`legacy` on create.** The spec says it can never be newly claimed. The CSV import (`importExport.ts:1697`) and the test at `:228-240` depend on it. Proposed: an import-only allowance.
2. **Historical unknown-dwelling rows in track (a).** Pre-Leg-3 active rows with `business_purpose` / `commercial_borrower` / ATR have no dwelling fact. Options: count them conservatively as dwelling-secured, or report them as a labelled "unknown" bucket that still blocks an (a)(4)/(a)(5) claim.
3. **Seller key.** `owning_entity` is free text. Accept `(org, normalized owning_entity)` with the stated limitation, or require a seller key in the facts record and treat history as "the organization".
4. **Threshold release mechanism.** A founder-only `threshold_release` record pointing at a dated decision. Confirm that Tom releases per-org customer activations, and where the decision reference lives.
5. **0307 itself.** The new table, `ON DELETE SET NULL` (diverges from `note_events` CASCADE) and the optional `notes` status trigger all need Tom's approval. PROVISIONAL.
6. **Sample and demo rows.** Exclude with `realNote()` from the counter (recommended: synthetic rows must not move a real gate).

---

## BUILD PLAN (ordered; follows the patterns above)

1. **`migrations/0307_notes_v2_seller_finance_gate_records.sql`** (create, PROVISIONAL). Creates `note_origination_records` with the kind and shape CHECKs and the append-only guard trigger (0305 pattern). Optionally adds the `notes` first-activation trigger (8.3 #4).
2. **`scripts/migrate.mjs`** (modify). Mirror 0307 verbatim after the 0305 entry, with a "// 0307 — … Mirrors …" comment.
3. **`shared/schema/note-origination-records.ts`** (create) plus a barrel re-export in `shared/schema.ts` (export line only; no table in the monolith).
4. **`scripts/ratchets/table-count.json`** (modify). 749 → 750, with a `lastBumpNote` citing 0307 PROVISIONAL / Tom-approval pending.
5. **`shared/notes/sellerFinanceGate.ts`** (create, pure).
   - Zod schemas for each record kind and the tri-state element type.
   - The track definitions (a), (b) and (c).
   - `decideActivation(facts, counts, atr, rmlo, release) → { allowed } | { refused: [{ check, element, curingFact }] }`.
   - All refusal copy, never using the word "compliance".
6. **`server/services/doddFrankChecker.ts`** (modify).
   - Export `evaluateClaimedExclusion(claim, facts)` returning per-element `met | failed | unanswered`, with stable element codes and `rateCapsStated` added.
   - Refactor `evaluateSellerFinancerExclusions` onto it so the page and the gate share one rule.
   - Keep `checkDoddFrankCompliance` output unchanged for existing inputs.
7. **`server/services/notes/sellerFinanceCounter.ts`** (create).
   - `countSellerFinance(orgId, sellerKey, consummationDate, { includeNoteId })`. It is org-scoped on every query and filters with `realNote()`.
   - Population: `notes` only. It excludes `legacy`, never-consummated rows (8.1 predicate) and `acquired_notes`.
   - It returns tracks (a), (b) rolling and (b) preceding calendar year (labelled), (c), the contributing note ids, and the legacy-flagged bucket. Nothing is stored.
8. **`server/services/notes/originationGate.ts`** (create).
   - `assertActivationAllowed(orgId, noteId | draft, tx)`. It loads the latest facts, RMLO and release records, calls the counter, `evaluateClaimedExclusion`, `validateAtrDetermination` (and checks `attestedAt` against activation) and `decideActivation`.
   - On pass it writes the `activation_gate_passed` snapshot in the same transaction. On refusal it throws a typed `ActivationRefused` with the named checks.
9. **`server/storage/noteRepo.ts`** (modify).
   - `createNote` (status `active`) and `updateNote` (stored `pending` → `active`) call the gate.
   - Refuse `legacy` outside the import entry (per the ruling on OQ1).
   - Require `atrDetermination` behind `atrDeterminationCompleted===true`.
   - `createPayment` uses `nextServicedStatus`.
10. **`shared/notes/servicedStatus.ts`** (create). `nextServicedStatus(prior, balanceCents)`: never `pending → active`; `defaulted` stays defaulted. Adopt it in `server/services/achAutopay.ts:1311`, `server/services/borrower/portalPaymentPosting.ts:451` and `noteRepo.ts:301` (modify each).
11. **`server/routes-finance.ts`** (modify).
    - `POST /api/notes`: remove the bare-flag active path (`:280-285`; founder decision §3.2).
    - `/originate`: wrap the persist and the activate in one transaction, and add `organizationId` to the exemption write `WHERE` (`:546-552`).
    - Map `ActivationRefused` to 422 with the named checks. Keep or adjust the raw-422 count pinned at `abilityToRepayGate.test.ts:355`.
12. **`server/services/atrSafeHarbor.ts`** (modify, only if it rides cleanly per founder decision §3.4). Same-transaction `atr_determination_written` audit row. Also scope the UPDATE by `organizationId` (`:245`) and drop the lint-register exemption at `scripts/check-org-scoped-fetch.mjs:714` if it then passes.
13. **`server/routes-note-origination.ts`** (create) with `registerNoteOriginationRoutes(app)`. Integer-id routes on the originated book, owner/admin guard, cross-org returns 404:
    - `GET /api/notes/:id/seller-finance-count`
    - `POST /api/notes/:id/origination-facts`
    - `POST /api/notes/:id/rmlo-engagement`
    - `GET /api/notes/:id/origination-records`
    - plus a founder-only `POST /api/founder/seller-finance/threshold-release` (`requireFounder`) under the Decisions door (no new nav).
14. **`server/routes.ts` + `server/routeManifest.ts`** (modify). Register and list the new file, and update the routeManifest snapshot.
15. **`server/routes-dodd-frank.ts`** (modify, §5.5). Optional `noteId`: when it is present the count is derived by the counter (org-scoped; missing returns 404) and returned with `countSource: "book"`; otherwise `countSource: "hypothetical"`. Switch to `AuthenticatedRequest` and `Errors.*`.
16. **`client/src/pages/dodd-frank-checker.tsx`** (modify). A deal picker; when a deal is chosen the count is read-only "from your book", and the typed count is labelled "Hypothetical deal". Labelled inputs and a11y per CLAUDE.md.
17. **`client/src/components/AtrGate.tsx`** (modify) plus a new `client/src/components/notes/OriginationFactsPanel.tsx` (create). Record facts and RMLO engagement, and show refusals naming the check and the curing fact. Lives inside the existing note drawer in Finance; no new door.
18. **Tests (create):**
    - `tests/unit/sellerFinanceGate.test.ts`: the pure decide, (a)(4)/(a)(5) count edges, unanswered refuses and names itself, (a)(5) entity refusal.
    - `tests/unit/sellerFinanceCounter.realdb.test.ts`: rolling window, the deal counted as next, acquired never counted, legacy and cancelled not counted, the calendar-year vs rolling labels, and **§7.4.18 cross-tenant: an org-B note never counts for org A, and an org-B `noteId` returns 404**.
    - `tests/unit/activationPathCensus.test.ts`: a new population ratchet enumerating every `.insert(notes…)` **and every `.update(notes…)` writing `status`**, each pinned to the gate or `nextServicedStatus`, with a per-member vacuity floor and comments stripped via `tests/helpers/stripComments.ts`.
    - `tests/unit/originationGateRefusals.test.ts`: §7.3 tests 12–17 by subject:
      - (12) (a)(4) count > 3 refuses
      - (13) (a)(5) count > 1 or entity refuses
      - (14) count ≥ 4 with no exclusion and no complete RMLO record refuses, and a complete one passes
      - (15) ATR missing, or a bare flag without a record, or `attestedAt` after activation, refuses; an exemption contradicting a recorded fact refuses; `legacy` newly claimed refuses
      - (16) terms elements: balloon / neg-am / rate < 60 or no caps / seller-constructed refuse under (a)(4); neg-am and rate under (a)(5); unanswered refuses and names itself
      - (17) creditor threshold refuses until a `threshold_release` by the founder

      Package test names are **UNVERIFIED**; map them to the package when it is available.
    - A mutation canary: put a pending→active flip back into a payment path and confirm the census goes red.
19. **Tests (modify, rewrite to the new truth, do not delete):**
    - `tests/unit/abilityToRepayGate.test.ts:228-240` (legacy on create)
    - `:544-557` (POST bare-flag string)
    - `:355` (the 422 count) if it changes
    - `tests/unit/doddFrankChecker.test.ts`: add `evaluateClaimedExclusion` cases and keep the existing 18 `it` sites green.
    - `shared/governance/statuteRegister.ts:265` (residual note: the payment-side flips are now closed) and `:283` (add the new test refs).
20. **Fences to run unmodified:** `moneyCustodyHardStop.test.ts`, the form1099 tests, `paxDoddFrankClaimsMatchTheRule.test.ts`, `constitution.test.ts`, `routeManifest.test.ts`, then `npm run check`, `npm test` and `npm run build` with the exit status captured to a file, never through a pipe.

---

## Test run (read-only, existing tests only)

`npx vitest run tests/unit/abilityToRepayGate.test.ts tests/unit/doddFrankChecker.test.ts` → **Test Files 2 passed (2); Tests 58 passed (58); exit 0.** Output was captured to a file and the exit status recorded; it was not read through a pipe. The source has 37 `it`/`it.each` sites in abilityToRepayGate and 18 in doddFrankChecker; `it.each` expands, which gives the total of 58.

## Not done in this step

`docs/company/next-moves.md` was **not** updated. CLAUDE.md asks for that at session end, but this step's fence allows writing only this file.

---

## COORDINATOR RULINGS on the open questions (Muse, driver, 2026-11-09)

Recorded so the build's answers are provenance, not improvisation. Each
ruling follows the package's own conservative defaults (§5.2 "refuse, never
assume") and the founder's standing decision rule.

- **OQ1 → R1.** `legacy` is refused on every origination create/update path.
  It is allowed ONLY through the CSV import entry point — the book-import
  path for the pre-0099 book, i.e. grandfathering by construction, not a new
  claim. `abilityToRepayGate.test.ts:228-240` is rewritten to that truth.
- **OQ2 → R2.** Historical unknown-dwelling rows are reported by the counter
  in a labelled "unknown" bucket. At activation, for a claimed-exclusion
  test and for the creditor-threshold test, unknown-dwelling consummated
  rows count conservatively as dwelling-secured; a refusal on that basis
  names the bucket and the cure (record origination facts for those notes,
  or proceed via the RMLO path).
- **OQ3 → R3.** Seller key = `(organization_id, normalized owning_entity)`;
  NULL `owning_entity` means the organization itself. The limitation (two
  spellings of one entity are two sellers) is stated on the gate's output.
  Facts and gate-passed records snapshot the seller key the gate used.
- **OQ4 → R4.** The threshold release is a `threshold_release` record in
  `note_origination_records`, writable only by a founder
  (`isFounderUserId`), carrying a `decisionRef` to the dated founder
  decision, scoped per org + seller key + calendar year.
- **OQ5 → R5.** Migration 0307 and the table ship PROVISIONAL on this stack
  (Tom-approval pending; disclosed in the PR). `ON DELETE SET NULL` plus the
  `note_id_at_record` snapshot are adopted: a hard-deleted activated note
  must still count (§1026.25(c)(3) retention + counter integrity). The
  optional `notes` status trigger (8.3 #4) is NOT built — its INSERT-id
  constraint is unsolved and the app gate + census ratchet +
  `nextServicedStatus` helper closes the enumerated population; deferred and
  named in the PR.
- **OQ6 → R6.** Sample/demo rows are excluded from the counter via
  `realNote()`: synthetic rows must not move a real gate.
- **R6' (§5.2.1 clause 3 scope).** "No exclusion claimed and no RMLO path at
  count ≥ 4" applies to consumer-purpose / ATR-record deals. A deal recorded
  non-consumer (exemption code or facts record) is outside the clause; the
  counter still classifies it by its facts.
- **R7 (facts resolution).** (1) The latest `origination_facts` record
  governs; a contradiction between it and the note's exemption code refuses
  (package test 15). (2) Absent a record, facts are implied by the note's own
  columns: a valid `atr_determination` ⇒ consumer=yes, dwelling=yes;
  `raw_land` ⇒ dwelling=no; `business_purpose`/`commercial_borrower` ⇒
  consumer=no, dwelling=unknown; every terms element is unanswered without a
  record. Claiming (a)(4)/(a)(5) REQUIRES a facts record — the claim lives
  there, so no claim can be asserted by implication.
- **R8 (counter population).** Live `notes` rows meeting the §8.1
  consummation predicate (status <> 'pending' AND (atr completed OR code IN
  raw_land/business_purpose/commercial_borrower)), excluding `legacy` and
  synthetic rows, PLUS `activation_gate_passed` records whose note was since
  deleted (dedup by `note_id_at_record`). The window applies to the
  consummation date (`start_date`; `activatedAt` for orphans).
  Cancelled-before-consummation deals (pending rows, deleted drafts) never
  count — there is no `cancelled` status on this book.
