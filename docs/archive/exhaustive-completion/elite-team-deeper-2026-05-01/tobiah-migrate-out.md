# Tobiah Ellingsworth — AcreOS through the right-to-leave lens

I'm Tobiah Ellingsworth. Fifty-one. Land Investor based in Eugene. I've been on AcreOS for eighteen months. I am leaving. The reason doesn't matter to this document — what matters is that I want to take my work with me, intact, and I want my personal data deleted afterward in a way I can hand to my attorney in case anyone ever asks. I am the customer your data-portability story has to survive. So I sat down with the source tree and pulled the seams apart.

The summary, before the detail: the pieces of a clean exit exist, but they were built by three different people on three different days and they don't compose. A determined customer can get most of their data out. They cannot get *all* of their data out. And they cannot do it without already knowing how AcreOS is wired internally — which is the one thing a leaving customer should never need to know.

---

## 1. There are three export systems and they fight

I found three independent export subsystems in `server/`. They were not designed together.

- **`server/services/importExport.ts`** (1,265 lines) — the production CSV/JSON export for `leads`, `properties`, `deals`, `notes`. Registered via `routes-import-export.ts` at `/api/export/:entityType` and `/api/export/backup`. Filters: `status`, `type`, `startDate`, `endDate`. Hard cap: implicit (uses `storage.getLeads(orgId)` with no limit). Filename pattern: `leads_export_2026-05-01.csv`.
- **`server/routes-communications.ts:807-901`** — a *second* set of routes registered at `/api/export/leads`, `/api/export/properties`, `/api/export/deals`, `/api/export/notes` (no `:entityType` segment). They call the *same* underlying CSV functions but with a different filename pattern: `leads-2026-05-01.csv`. They are registered *after* `registerImportExportRoutes` in `server/routes.ts:1630-1635`, so Express's last-wins routing means the parameterized route wins for `/api/export/leads` only when nothing matches a more specific path — but the second registration creates a literal-vs-parameter ambiguity that depends on registration order and is genuinely confusing to reason about. It also means there are *two* PDF/JSON behaviors layered on top of each other.
- **`server/services/dataPortability.ts`** — a *third* full export at `/api/export/full` and `/api/data/export`, JSON-only, `orgId`-scoped, capped at `10,000` records per table. Used by `client/src/components/settings/download-data-section.tsx` ("Download All My Data").
- **`server/services/gdprService.ts`** — a *fourth* export at `/api/privacy/export`, `userId`-scoped (not org-scoped), capped at `100,000` records per table, used by `client/src/pages/privacy-settings.tsx`.

So there are four "export everything" buttons, in four different places, with three different scope rules (`orgId`, `userId.assignedTo`, `userId.senderId`), three different record caps (none, 10k, 100k), and two different filename conventions. None of them produce the same archive. A user who runs all four gets four different snapshots of partially overlapping data and has no documentation telling them which one is canonical.

For a leaving customer, **the canonical archive must be one button, one file, one schema**. The current state means I have to run all four to be confident I have everything, and then I have to reconcile the overlaps myself.

---

## 2. The data-export page lies about what it can do

`client/src/pages/data-export.tsx:53-102` — the customer-facing Data Export page — declares six export targets: leads, properties, deals, **campaigns**, notes, **activity log**, and a **full account archive**. Of those:

- `/api/export/campaigns` — **not registered anywhere on the server.** Search the tree. Doesn't exist. Click the button, get a 404, get a destructive toast that says "Couldn't export data."
- `/api/export/activities` — **not registered anywhere on the server.** Same.
- `/api/export/archive` — **not registered.** The server route is `/api/export/backup`. Click the "Download archive" button on line 196-203, get a 404. The filename in the UI is `archive-export.zip`; the server returns a JSON file (see §4 below) named `backup_<slug>_<date>.json`.

Three of seven exports on the data-export page are dead links. This is not a missing-feature problem — it's a *false-advertising* problem. A customer who clicked "Download archive" expecting a ZIP and got a 404 would reasonably conclude that AcreOS is hiding their data. I would.

The fix is fifteen lines: register the missing routes (campaigns, activities/audit-log, and a real archive endpoint), or remove the buttons. Pick one. Don't ship both.

---

## 3. The PDF report is a paywall that says "premium feature"

`server/routes-communications.ts:903-923` — `/api/export/report?format=pdf` returns:

```json
{ "message": "PDF export is a premium feature. Please upgrade your plan.", "placeholder": true }
```

That is not a PDF. That is a 200 OK with a JSON body claiming to be a PDF. The Content-Type is `application/json`, not `application/pdf`. There is no PDF generator wired in. There is no premium SKU that unlocks it — I checked the billing schema. The "upgrade your plan" message is aspirational copy with no plan behind it.

For a leaving customer, this matters because *the most operationally useful artifacts in a CRM are the PDFs*: the offer letters I sent, the settlement statements I generated, the property flyers I emailed. Those are what I need to take to the next system or to my CPA. AcreOS will *generate* a PDF for any of those (`/api/documents/offer-letter`, `/api/documents/generate/settlement-statement`, `/api/documents/generate/property-flyer`, `/api/documents/generate/promissory-note`, `/api/documents/generate/warranty-deed` — all in `routes-documents.ts`) but **there is no endpoint that returns *all* generated documents for an organization as a downloadable archive**. They live in the `generated_documents` table (`shared/schema.ts:4757`) and on whatever blob storage you're using, and there is no zip-them-up-and-give-them-to-me path.

There is also no endpoint that downloads `attachments` from `team_messages` (`schema.ts:4254`), `inbox_messages` (`schema.ts:5194`), or anywhere else they live. An eighteen-month customer accumulates attachments — title commitments, plat maps, scanned deeds, photos. The schema has columns to hold pointers to them. The export pipeline does not read those columns.

If I leave AcreOS today, I lose the offer letters I sent and every attachment I ever uploaded. That is the single most damaging gap in the export story, and it is the one a competitor's onboarding team will weaponize against you in three sentences: "we'll import everything from AcreOS — except they don't let you take your documents."

---

## 4. The "ZIP backup" is not a ZIP

`server/services/importExport.ts:933-969` — `createBackupZip()` is misnamed. It returns:

```ts
{ files: Array<{ name: string; content: string }>, organization: ... }
```

— a JavaScript object containing CSV strings as fields. The route at `routes-import-export.ts:266-293` then serializes that object as JSON and sends it with `Content-Type: application/json`. It is *not* a ZIP file. There is no `archiver`, `jszip`, or `yazl` import anywhere in the server tree. The customer downloads a `.json` file (filename `backup_<slug>_<date>.json`) containing CSVs as escaped strings inside JSON keys.

To use it, I would have to write a Node script to walk the JSON, extract each `content` field, and re-write each as a `.csv` file. That is *exactly* the work an export feature is supposed to do for me.

The fix: install `archiver`, stream a real ZIP, set `Content-Type: application/zip`, set the `.zip` extension. Twenty lines.

---

## 5. The communication history is not exported. Anywhere.

`shared/schema.ts:2141-2180` defines `seller_communications` — the table that stores every email, SMS, call log, mailer, and Facebook DM tied to a lead. Channel, direction, content, call duration, call notes, call outcome, sentiment, urgency score, AI-generated flag, the works. Eighteen months of my outbound campaign history lives in this table.

It is **not exported** by any of the four export systems:

- `importExport.ts` exports leads/properties/deals/notes — not communications.
- `dataPortability.ts:30-59` exports leads/deals/properties/notes/campaigns — not communications.
- `gdprService.ts:79-123` exports leads/deals/properties/tasks/`teamMessages` (internal staff chat)/supportTickets — not `sellerCommunications`.

Same gap for `inbox_messages` (5165), `borrower_messages` (5432), and `messages` (1462). None of these tables are reachable by any export endpoint. If I leave, I cannot tell my next CRM "here is every conversation I had with seller X over the last eighteen months." That history is locked in.

It is also worth saying out loud what's *retained* but not *exported*: `aiConversations`, `aiMessages` (schema:1786), `agentEvents`, `agentMemory`, the AI's notes on me. Some of those are deleted by the GDPR anonymize flow (`gdprService.ts:158-161`). None of them are exportable. If a regulator asks me "what does AcreOS know about you that it has not given you?" the answer today is *the AI's memory of you* — and a CCPA "right to know" request would catch that gap.

This is the gap that would push me from "leaving cleanly" to "leaving angrily." Communication history is the *operational memory* of a CRM. It is the difference between the next platform being able to pick up where AcreOS left off, and the next platform getting an inert pile of names and APNs.

---

## 6. The GDPR export is user-scoped; the Data Export page is org-scoped; nobody told the customer

`server/services/gdprService.ts:79-123` filters every record by `assignedTo = userId` (or `senderId` for messages, `userId` for tickets). That makes sense for an Article 15 personal-data-of-a-natural-person request. It does **not** make sense if I'm a solo operator whose org has one user (me) but whose leads were imported via CSV and never had `assignedTo` set — those leads have `assignedTo = NULL` and are excluded from my GDPR export. I would not know this without reading the source.

The Data Export page (`pages/data-export.tsx`) and the "Download All My Data" button (`download-data-section.tsx`) hit *org-scoped* endpoints and return the full org's data. The GDPR Privacy Settings page (`pages/privacy-settings.tsx`) hits a *user-scoped* endpoint and returns a strict subset.

Two buttons labeled "export your data" in the same product return different datasets, and the difference is not explained anywhere in the UI. A leaving solo operator who clicks "Export your data" on the GDPR page will silently get less than they think they're getting. That is a regulator-noticeable defect under both GDPR Article 12(1) (transparency) and CCPA §1798.130(a)(2) (the disclosed scope must match the delivered scope).

Fix: a single export endpoint, org-scoped for org admins, with a UI sentence that says "this includes every record in your organization, not only records assigned to you."

---

## 7. The "delete my data" button leaves business records

`server/services/gdprService.ts:130-198` — `anonymizeUser()` does the right thing for GDPR Article 17: it overwrites PII (email, name, phone) with hashes and placeholders, and it retains business records (deals, notes with legal significance, anonymized leads). Anonymization is the correct posture for a CRM with seven-year IRS retention obligations on closed deals.

But the customer-facing copy in `privacy-settings.tsx` says "Account anonymized. Your personal data has been deleted." That is *technically* true and *operationally* misleading. The user's `users` row is still there, with a hashed email like `deleted-user-a3f7c2@gdpr-deleted.invalid`. The leads they touched still exist with first name `[Deleted]` and last name `[User]`. Their deal records are untouched. Their `sellerCommunications` rows are untouched (and unexported — see §5). Their `notes` (lead notes) are untouched. Their `aiMemory` is untouched (`gdprService.ts:155` — "agentMemory is org-scoped, not user-scoped").

A regulator-defensible disclosure would say: *"Your name, email, and phone have been replaced with placeholders. Business records required for tax and legal compliance — deal records, signed documents, transaction history — are retained in anonymized form for seven years."* The current copy does not mention the seven-year retention, does not mention the business-record carve-out, and does not surface a list of what's being kept. That gap is what gets a CCPA letter from the California AG.

---

## 8. Account deletion has no path

There is no UI for "delete my account, cancel my subscription, and tear down my organization." `cancellation-dialog.tsx` cancels a Stripe subscription. `privacy-settings.tsx` anonymizes a user. Neither of them deletes the *organization* — and an org with one anonymized user is a ghost org. There's no `deleteOrganization` flow exposed to customers; the comment at `gdprService.ts:156` ("org-level agentMemory is purged separately via deleteOrganization(orgId)") refers to a function that, as far as I can tell, is only callable internally. A solo operator who wants to fully exit AcreOS has to: (a) export, (b) anonymize their user, (c) email support to delete the org. Step (c) is invisible until you ask.

Document the three-step flow or build a one-button "Close my account" that runs all three. Right now you have neither.

---

## 9. Audit-log access for my own actions

`/api/audit-log` (`routes-import-export.ts:300-334`) exists, returns JSON, supports filters, paginated to 100 max. Good. Two problems:

- It is not exported as CSV anywhere. The `/api/export/activities` button on the data-export page targets a route that doesn't exist (§2). I cannot download my own audit trail in any portable format.
- The audit-log UI is not on the same page as the export UI. A leaving customer who wants "everything I did, in order, with timestamps" has to go to one page to see it and a different (broken) page to download it.

Audit trails matter on exit because they're how I prove to the next vendor — or to a court, or to the IRS — that a record I'm bringing with me is authentic and timestamped. I want a CSV, dated, hashed, and downloadable in one click.

A related observation: `audit_log` retains entries (`routes-import-export.ts:407` defaults to 2,555 days for audit logs and closed deals), but the export pipeline has no concept of *retention dates per record*. If I export today and AcreOS purges leads older than 365 days tomorrow per the configured `retentionPolicies.leads`, my export is the only copy. The export is silent about this — there is no "this record is scheduled for deletion on 2027-04-30" field. A CRM that thinks of itself as the customer's system of record should surface deletion horizons to the customer, especially in the export.

---

## 10. The CSV format is portable, the JSON format is half-portable

Credit where due: the CSV escaping in `server/services/export.ts:3-9` and `importExport.ts` is correct (RFC 4180 — quotes the value if it contains a comma, double-quote, or newline; doubles embedded quotes). It will round-trip through Excel, LibreOffice, Sheets, and the next CRM's import wizard without surprises. Currency is rendered as a bare number with two decimals — no thousands separators, no currency symbol — which is what import wizards want. Dates are ISO `YYYY-MM-DD`. Tags are joined with `"; "`. All correct.

What's *not* portable: foreign-key columns are exported as raw integer IDs — `Property ID`, `Borrower ID` — with no resolution. A leaving customer who imports the `notes` CSV into a new system gets a `propertyId: 4471` field that means nothing outside AcreOS. The CSVs need either (a) a denormalized address/APN column inline, or (b) a stable external key (a UUID or a cross-system slug) rather than a serial integer. Today they have neither.

The JSON exports (`/api/export/:entityType?format=json` and `/api/data/export`) preserve the integer IDs and add nothing. That makes them a worse choice than CSV for migration — CSV at least gives you the human-readable columns. JSON is only useful here if you're piping into a tool that already understands AcreOS's schema, and there is no such tool outside AcreOS.

The `notes` table has a particularly bad case: `borrowerId` is a foreign key to a `users` row in the borrower-payment system, and the export ships the integer without ever joining in the borrower's name, email, or phone. The receiving system gets payment schedules with anonymous borrowers attached. That is operationally unusable.

---

## What a leaving customer needs, in order of priority

1. A single, working "Download everything" button that produces a real ZIP with: every leads/properties/deals/notes record (CSV + JSON), every `seller_communications` / `inbox_messages` / `borrower_messages` row (CSV), every `generated_documents` PDF as a real file in a `/documents/` subfolder of the ZIP, every `audit_log` row (CSV), and a `manifest.json` that lists what's included and what's *not* included with reasons.
2. Remove or implement the three dead buttons on `pages/data-export.tsx` (campaigns, activities, archive).
3. Replace the JSON-pretending-to-be-ZIP backup with a real ZIP.
4. Either implement the PDF report or remove the route.
5. Reconcile the four export systems into one canonical pipeline. Document which is which until you do.
6. Fix the GDPR-export scope mismatch and add a transparency line to the UI explaining what's included.
7. Add a one-click "Close my account" that anonymizes the user, cancels the subscription, deletes the org, and emails me a final receipt with a download link to my archive.
8. Publish a "data retention and deletion policy" page. The seven-year retention number is in `routes-import-export.ts:407` and nowhere else customer-visible.

I'd ship items 1, 2, and 3 this week. They're each less than a day of work and they're the difference between a clean exit and a customer-support ticket. The rest is a quarter.

The right to leave is the foundation of trust in a SaaS relationship. AcreOS is closer to having it than the average CRM I've evaluated; it is not yet close enough that I'd recommend it to a peer who asked "what happens when I want to leave?" That's the bar. Get there.
