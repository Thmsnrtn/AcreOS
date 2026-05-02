# Magdalena Dufresne — REI Pro → AcreOS Migration

**Persona:** Magdalena Dufresne, 47, Land Investor. 8 years on REI Pro.
**Stack today:** REI Pro (CRM, mailers, deal pipeline, docs vault), QuickBooks Online, DocuSign, a Google Drive labeled `lots-2018-thru-now` with 11K PDFs. Twilio number for SMS.
**Inventory I'm dragging across:** 4,200 leads, 380 deals, 50 active notes (paper-on-paper from owner-finance sales), ~9,000 communication records (calls/SMS/emails), ~7,000 documents (purchase agreements, deeds, releases of liens, payoff letters), 14 saved tags I rely on (`hot-redneck-riviera`, `q3-2024-mailer`, `divorce-pipeline`, `inheritance-2023`, `dnc-stayaway`, `hispanic-heir`, etc.).
**Wave 3 audit. 2026-05-01.**

I'm not switching for features. I'm switching because REI Pro raised my seat to $189/mo and the support tickets sit in queue for 11 days. AcreOS at $499 Operator is more money — but only if my history comes with me. **If I land in AcreOS with 4,200 leads stripped of their tags, their original source, their assigned-VA, and their call history — I have not switched. I have started over. Eight years of context worth more than the $189 I'm trying to escape.**

This audit is about whether the migration door is wide enough to fit my eight years through it.

---

## 1. Thirty-second verdict

**The CSV import path exists** (`server/services/import.ts`, `server/services/importExport.ts`, `client/src/components/import-export.tsx`). It accepts leads, properties, deals, and notes (the mortgage kind, not freeform notes). It has column auto-mapping. It has a preview step. It has duplicate detection on email/phone/name. **All of that is real and working.**

What is not real: **the migration scope is leads + properties + deals + mortgage notes. Nothing else.** No communication-history import. No document/file import. No tag import (tags are *exported* — see `importExport.ts:598` `lead.tags.join("; ")` — but the import side at `importExport.ts:307-320` does not parse a `tags` column at all). No `assignedTo` / owner / VA-attribution import. No `createdAt` preservation — every imported row is stamped with today's timestamp, which means an 8-year-old REI Pro lead I imported on 2026-05-01 will appear in AcreOS as "created today." That falsifies my pipeline-age metrics on day one.

And the hard cap: **`MAX_CSV_IMPORT_ROWS = 500`** (`server/routes-import-export.ts:18`). My REI Pro lead export is 4,200 rows. **I have to split it into 9 files.** That's the friction tax. Cyrus complained about `MAX_BATCH = 100` on bulk operations; my equivalent is 500 on imports. Same root cause, different surface.

**Verdict: I can get my leads in (over nine round-trips). I cannot get my call history in. I cannot get my documents in. I cannot get my tags in. So 30% of my eight years moves; 70% gets left on REI Pro until that account is canceled, after which it's gone.** That's a deal-killer unless someone tells me there's a path I missed.

---

## 2. The migration walkthrough — what actually happens

**Day 1 morning.** I export from REI Pro. They give me five CSVs: `leads.csv` (4,200 rows, 38 columns), `properties.csv` (4,800 rows — they track properties separately from leads), `deals.csv` (380 rows), `communications.csv` (9,200 rows of calls/SMS/email logs joined to lead IDs), and `documents.zip` (a folder tree with 7,000 PDFs and a manifest CSV mapping each PDF to a deal/lead/property).

I open AcreOS at `/import-export`. The component (`client/src/components/import-export.tsx`) shows three import targets: **Leads, Properties, Deals.** That's it. No "Communications" tab. No "Documents" tab. No "Tags" tab. **Two of my five CSVs and my entire ZIP have nowhere to go.**

I import `leads.csv`. It rejects because the file is 4,200 rows over the 500 cap. I split it into 9 files using `split -l 500` in Terminal. Now I have nine import jobs.

**File 1.** I drop it on the dropzone. Preview opens. The auto-mapper recognized `firstName`, `lastName`, `email`, `phone`, `address`, `city`, `state`, `zip`. Good. **Did not** recognize `Owner_FirstName` / `Owner_LastName` (REI Pro's actual column names) — I had to manually rename my CSV headers before re-uploading. The `LEAD_COLUMN_MAP` in `server/services/import.ts:99-122` only maps `firstName / first_name / "first name"`. REI Pro exports `Owner_FirstName`. **One header rename × 9 files = 9 manual steps before I can even start.**

**Looking at the preview.** Rows show valid/invalid. Good. But the preview doesn't tell me: (a) how it's planning to handle duplicates (will it skip? merge? overwrite?); (b) what happens to columns it didn't map (silently dropped? warned?); (c) which fields were defaulted (status `new`? source `import`? — yes it does this silently, see `importExport.ts:317-318`). I have to read the source code to know my `Lead_Source = "Cold call - Yuma 2019"` becomes `source = "import"` — **the original source attribution is overwritten with the literal string `"import"`. Eight years of source data, gone, on the import that's supposed to preserve it.**

**File 1 imports.** 480 succeeded, 16 duplicates skipped, 4 errors. Good news: dedup works on email/phone/name (`importExport.ts:331-336`). Bad news: **dedup is per-file, not cross-file.** When file 2 contains a row that already came in via file 1, the dedup query (`storage.findDuplicateLeads`) catches it — *if* I ran file 1 first. If I run file 2 in parallel via two browser tabs, both windows will see "no duplicate," both will write, and I'll have 4,200 doubles. The serial-only dedup works for me only if I never split-screen.

**Files 2-9.** Three more files have rows where my CSV's `Notes` column contains line breaks and embedded commas. The `parseCSVLine` parser (`import.ts:71-97`) handles double-quoted fields with embedded commas correctly — I tested. But it does **not** handle embedded newlines inside a quoted field (the parser does `csvString.trim().split(/\r?\n/)` *before* respecting quotes). That means any REI Pro note that spans two lines becomes two CSV rows in AcreOS's parser. I have ~340 notes with embedded newlines. Those rows will fail or silently corrupt. **This is a CSV-parser bug, not a UX gap. Multi-line quoted fields are RFC 4180 standard.**

**Day 1 afternoon.** Leads done. ~3,800 imported (3,360 succeeded, 440 skipped/dropped due to dedup, parser errors, and missing required fields). Now the 4,800-row property CSV — same 500-row cap, 10 round-trips. Then 380 deals — one round-trip, fine.

**Day 2.** Communication history. **There is no surface.** I check `/import-export` again. I check the API: `POST /api/import/:entityType` accepts `leads`, `properties`, `deals`, and via the notes dialog (`notes-import-dialog.tsx`) it accepts mortgage notes. There is **no `POST /api/import/communications`**, no `POST /api/import/activities`, no `POST /api/import/lead-activities`. The schema *has* a `leadActivities` table (`shared/schema.ts:398`) with the right columns (type, description, metadata, performedBy, createdAt). The schema *has* a `sellerCommunications` table (`schema.ts:2141`). **The receiving end exists. The import path doesn't.**

So on day 2 I have a choice: (a) write a custom script against the AcreOS API to push my 9,200 communication records in (assumes I can authenticate as my org and the schema is exposed — neither obvious); (b) lose them; (c) keep REI Pro as a read-only archive at $189/mo *forever* so my CSR can answer the question "did we already talk to this seller in 2022?" Option (c) means I never actually leave REI Pro. Option (a) requires engineering I don't have. Option (b) is what 90% of users will do.

**Day 3.** Documents. The 7,000 PDFs in my ZIP. AcreOS has a `/documents` page and the schema has a `documents` table. I cannot find a bulk-document-import surface anywhere — no manifest-CSV importer, no S3-bucket-sync, no "drop a ZIP, we'll fan it out and link by deal_id." If I want my documents in AcreOS, I'm uploading them one at a time. 7,000 PDFs × 10 seconds per upload = 19.5 hours of clicking. I will not do that. They stay on Drive, AcreOS becomes a CRM that doesn't know about my paperwork, and when a buyer asks "do you have the recorded deed?" I'm in two systems forever.

**Day 4.** Tags. I do not have tags in AcreOS. Period. The exporter writes them out (`importExport.ts:598`), the importer never reads them. My 14 carefully-curated tag groups across 4,200 leads — `hot-redneck-riviera`, `q3-2024-mailer`, `divorce-pipeline`, etc. — all of those are bytes in my REI Pro export that AcreOS silently discards. **I will sit at my desk on day 4 and re-tag 4,200 leads by hand, or I will give up and lose them.** I will give up.

**Day 5.** Custom fields. REI Pro lets me add columns. I have `Heirs_Identified`, `Probate_Court_Number`, `Right_of_Way_Disputed`, `Survey_On_File`, `Spouse_Deceased_Date`. None of those are in AcreOS's `LEAD_COLUMN_MAP`. They will not be imported. They might survive in `notes` (the unstructured text field) if I concatenate them into a single string before upload — but at that point they're un-queryable. The "divorce pipeline" filter I run weekly in REI Pro has no analog after migration.

**Day 6.** Reconciliation. I want to verify nothing was dropped. The import result returns `successCount`, `errorCount`, `duplicatesSkipped`, and an `errors` array (`importExport.ts:5-15`). Good. **It does not return: a CSV of "what got defaulted" (e.g., 3,360 leads with `source = "import"` because their original source was unmapped); a CSV of "fields that existed in your CSV but had no mapping target"; a manifest of "what we wrote, sorted by your original row number."** Without these I can't audit the import. I'll spot-check 20 leads and trust the rest.

---

## 3. Friction list — migration-IN specific

1. **`MAX_CSV_IMPORT_ROWS = 500`** is the wrong number for migration. (`routes-import-export.ts:18`) Day-to-day imports of 500 are fine. *Migration* imports of 4K-50K are the volume. Either lift the cap to 50K for one-time `migration_mode=true` imports, or build a `/migrate` wizard that handles the splitting automatically. This is a **2-hour fix that prevents 9 round-trips.**
2. **No `tags` column in `LEAD_COLUMN_MAP`.** (`import.ts:99-122`) The schema field `leads.tags` is a `jsonb` array (`schema.ts:346`). The exporter joins them with `; `. The importer should split on `; ` and write the array. **15-minute fix.** Without this, every customer migrating from any CRM with tags loses them.
3. **No `Owner_FirstName` / `Owner_LastName` / `Property_Owner` aliases in column maps.** REI Pro, InvestorFuse, Podio, FreedomSoft all export with `Owner_` prefixed columns. Adding 8-12 aliases to `LEAD_COLUMN_MAP` would auto-map ~80% of competitor exports. **30-minute fix.**
4. **No `assignedTo` / `assigned_to` / `assignedUserId` import.** Every CRM tracks "which rep owns this lead." AcreOS ignores it on import. Result: every lead lands unassigned. For a multi-VA shop that's hours of manual reassignment.
5. **`source` defaults to literal `"import"`** (`importExport.ts:318`). Original lead source attribution is destroyed unless the customer happens to have a column literally named `source`. Map `Lead_Source`, `Source`, `Origin`, `Acquisition_Channel` as aliases.
6. **`createdAt` is set to `now()` on every imported row.** This is a database default I can't see being overridden in the import code. **Migration must preserve original timestamps**, otherwise my "average lead age 47 days" metric resets to 0 the day I migrate. Pipeline-age, time-in-stage, and conversion-rate-by-month all break.
7. **No communication-history import surface.** (`leadActivities`, `sellerCommunications` tables exist; no `POST /api/import/activities`.) The single highest-value thing I'm trying to migrate.
8. **No document/file import.** No surface, no ZIP handler, no manifest CSV, no S3 sync. Documents stay in Drive forever.
9. **Custom fields not supported on import.** REI Pro/Podio/Salesforce all let users add fields. A `customFields` jsonb on the lead row is in `schema.ts:1022` (it's there!) but the import doesn't parse it. Could accept any unmapped column as `customFields[colName]`. **45-minute fix that turns 4 unsupported columns into queryable data.**
10. **Multi-line quoted CSV fields silently corrupt.** (`import.ts:43`) RFC 4180 violation. Any seller note with a paragraph break splits into two rows. Use a real CSV parser (`csv-parse` or `papaparse`) — not a regex split. **Half-day fix; high impact.**
11. **No cross-file dedup during multi-file migration.** If I split my 4,200-row CSV into 9 files and upload them in parallel browser tabs, I can dupe-write because the dedup check is per-import-call, not per-organization-batch. Add a `migration_session_id` that holds a temp dedup index across uploads in the same session.
12. **No "what got dropped" report.** The result returns errors but not "fields you uploaded that we ignored." Customers can't audit what made it across without a column-level diff.
13. **No `parallel_run_mode` flag.** I want to run REI Pro and AcreOS side-by-side for 30 days, with new leads dual-written. That requires either (a) a webhook from REI Pro into AcreOS, or (b) a daily delta CSV import. Neither is documented. Without it, the cutover is a hard cliff: pick a Friday, switch, pray.
14. **No `dryRun` import mode.** I can preview row-by-row but I can't say "run the full import end to end and tell me what *would* happen" without actually writing rows. For 4,200-row migrations I need a real dry-run that returns the same result envelope without touching the DB.
15. **Notes-import dialog (mortgage notes) is a totally separate path.** (`client/src/components/notes-import-dialog.tsx`) It has its own auto-detect (`autoDetectField` at line 45-64), its own field set (`ACREOS_NOTE_FIELDS`), its own progression. **Two different import UIs with two different patterns.** A migrator hits both and gets confused which one is canonical. Unify or cross-link.
16. **No payment-history import for owner-finance notes.** The notes import takes the note's metadata (principal, rate, term) but not the 50-90 historical payments per note. For my 50 active notes I have ~3,500 payment records totaling 8 years. Those define my amortization audit trail. Without them, the imported notes are a clean slate — Wendell-the-1098-INT-guy's nightmare from another angle.
17. **Property-to-lead linking on import is unclear.** I have a `properties.csv` with APNs and a `leads.csv` with seller names. The link between them in REI Pro is a `Property_ID` on the lead row. AcreOS has a `propertyId` field on leads (presumably). But the lead importer doesn't appear to handle a `propertyId` column. So I import properties, I import leads, and they're disconnected.
18. **Deal-to-lead-to-property chain doesn't preserve.** Same problem at the deals level. Import deals with no `leadId` / `propertyId` and they're orphans.
19. **No undo on a failed import.** If file 5 of 9 corrupted my data and I want to roll back file 5 only, there's no per-import-batch tag I can use to find-and-delete. The import doesn't write a `batch_id` to the rows it creates.
20. **No saved column-mapping templates.** Every file (1 through 9) makes me re-confirm the mapping if I navigate away. For a 9-file migration that's 9× the same drag-and-drop ritual.

---

## 4. Field-mapping gaps — REI Pro → AcreOS

| REI Pro field | AcreOS target | Status |
|---|---|---|
| `Owner_FirstName` | `firstName` | **No alias** — manual rename |
| `Owner_LastName` | `lastName` | **No alias** — manual rename |
| `Mailing_Address` | `address` | OK if user renames |
| `Property_Address` | (different field — should go to property, not lead) | Ambiguous |
| `Lead_Source` | `source` | **Defaulted to `"import"` — original lost** |
| `Tags` | `tags[]` | **Dropped silently** |
| `Assigned_To` | `assignedUserId` | **No import path** |
| `Created_Date` | `createdAt` | **Defaulted to now()** |
| `Last_Contact_Date` | `lastContactedAt` (if exists) | **No import path** |
| `Custom_Fields_*` | `customFields` jsonb | **Not parsed despite column existing** |
| `DNC_Flag` | `doNotContact` | OK — alias exists |
| `TCPA_Consent` | `tcpaConsent` | OK — alias exists |
| `APN` (on property CSV) | `apn` | OK |
| `Acres` | `sizeAcres` | OK — multiple aliases |
| `County` | `county` | OK |
| `Notes` (free text) | `notes` | OK but multi-line breaks parser |
| Communication log | `leadActivities` | **No import endpoint** |
| Documents folder | `documents` | **No import endpoint** |

The pattern: **simple address-book fields work; everything that makes a CRM a CRM (history, attribution, relationships, tags, custom fields) does not.** A REI Pro user landing here gets a deduped contact list and nothing else.

---

## 5. Parallel-run period — what I need

Real migrations don't cut over on a Friday. They run two systems for 30-90 days while the team builds confidence. AcreOS needs:

1. **A `parallel_run` mode** that disables sending (no SMS, no email, no postcard fulfillment) so I can populate AcreOS with live data without double-touching my sellers.
2. **Webhook-in endpoints** so I can have REI Pro POST every new lead/activity into AcreOS in real-time. I'll write the bridge script myself if the receiving end exists; today, `POST /api/leads` exists for single-lead creation, but I'd want a `POST /api/migration/sync` that's idempotent on a `source_system_id` field.
3. **A `source_system_id` column on every imported entity** so I can deterministically match a REI Pro lead to its AcreOS twin. Today there's no such column — duplicate detection runs on email/phone/name (fuzzy at best).
4. **Daily delta-import support.** "Pull rows changed in the last 24 hours, import them, dedup against the existing org." Without this, parallel-run drifts within a week.
5. **A `migration_complete` switch** that, when flipped, deletes the parallel-run flag and starts charging full rate-limits and full feature surface. Today there's no concept of "I'm in a migration" vs. "I'm operational."

None of this exists. The migration model implicit in the codebase is "one CSV, one shot, hope for the best."

---

## 6. Pricing reaction — through migration lens

**Operator at $499/mo** is the tier I'd land on. The pain isn't the price — it's that I'd pay $499/mo for a system that **on day 30 still doesn't have my call history, my documents, or my tags.** REI Pro at $189/mo *did* have those things. I'd be paying 2.6× to lose data. That math kills the deal regardless of how nice `/today` looks.

**What I'd pay for:** a one-time **white-glove migration** at $1,500-$3,000. Someone on the AcreOS side runs the export on my behalf, writes a custom script that maps my custom fields, imports my communication history into `leadActivities`, ZIPs my documents into the `documents` table with proper foreign keys, preserves my tags, preserves my timestamps, and gives me a reconciliation report. **I would pay $3,000 today to have this done in 48 hours.** The infrastructure (schema tables, API endpoints) is 80% there. The missing piece is a "Migration Concierge" SKU.

**What I want that doesn't exist:** a published list of *"data we can migrate, data we can't"* on the marketing site. Land Investors evaluate switching tools by reading exactly this. The honest list today is: leads (mostly), properties (mostly), deals (basic), mortgage notes (metadata only). The honest list of what we *can't* migrate today: tags, custom fields, assignment history, communication history, documents, original timestamps, original sources. **Publish that. Customers will respect honesty more than they'll respect a vague "we'll help you migrate" marketing line that turns into "here's a CSV uploader with a 500-row cap" once they sign up.**

---

## 7. What's surprisingly good

1. **Auto-detect mapping for the notes (mortgage) importer** (`notes-import-dialog.tsx:45-64`) is genuinely well-thought-out — pattern matches on lowercased de-spaced headers. This same logic should be the leads/properties auto-mapper (it's currently a static dictionary).
2. **Duplicate detection by email + phone + name composite** (`importExport.ts:331-336`) is the right shape. Most CRMs only dedup on email.
3. **Preview-before-write step** with row-by-row valid/invalid display is the right UX. REI Pro doesn't have this.
4. **Schema has the right tables** for everything that's missing on the import side: `leadActivities`, `sellerCommunications`, `documents`, `tags` jsonb on leads, `customFields`. **The data model is ready. The import surface is not.** That means most of these gaps are 1-3 day patches, not architecture rebuilds.
5. **Batch-of-100 fallback to per-row inserts** on transaction failure (`importExport.ts:363-388`) is the right resilience pattern — partial success beats total failure.

---

## 8. The deal-killer

For Cyrus it's the chunking tax. For Wendell it's the note ledger. **For me it's the migration-day silence on the things I care about.**

If I import 4,200 leads and my call history doesn't come, my tags don't come, my documents don't come, my custom fields don't come, my assignment-history doesn't come, my source attribution gets overwritten, and my created-date gets reset — **I haven't migrated. I've started over with a contact list.** Eight years of context worth more than the difference between $189 and $499.

The fix path is shorter than it looks. The schema is mostly there. What's missing:
1. Lift the 500-row cap for migration mode.
2. Add `tags`, `assignedUserId`, `createdAt`, `customFields`, `source_system_id` to the lead column map and the import logic.
3. Build `POST /api/import/activities` that targets `leadActivities`.
4. Build `POST /api/import/documents` that takes a manifest CSV + a ZIP.
5. Add 8-12 alias rows to `LEAD_COLUMN_MAP` and `PROPERTY_COLUMN_MAP` for REI Pro / Podio / FreedomSoft / InvestorFuse exports.
6. Replace the regex CSV parser with a real one.
7. Ship a Migration Concierge SKU at $1,500-$3,000 one-time so the messy bits get handled by humans.

Do those seven things and I sign for 24 months and bring the three other Land Investors I know who are also fed up with REI Pro. Don't do them, and I stay on REI Pro because the cost of switching exceeds the cost of staying angry.

The door is wide enough for me to walk through. It is not wide enough to bring my luggage. The luggage is the whole reason I'm switching.

— Magdalena
