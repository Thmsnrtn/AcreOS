# Deal document store — design (slice 5, autonomy gap §8, register gap #2)

**Date:** 2026-11-10 · **Status:** design only, no implementation in this session
**Approval:** Tom approved a NEW org-scoped documents table on 2026-11-10.
**Estimated build:** $6–9. No gold-plating: no delete endpoint, no versioning, no
OCR/extraction, no required-documents checklist (later slice).

---

## 1. The gap and the acceptance story

Today a user cannot attach a file to anything a deal is made of. Every PSA, title
commitment and deed lives in Drive, Dropbox or an inbox. The only file bytes this
product keeps are rehab photos (`server/routes-rehab-photos.ts`) — images, on a
rehab, for a fix-and-flip.

**Acceptance story — "the title commitment arrives":** a user drags a PDF onto a
deal; the bytes are kept; a row records it against the deal; it appears on the
deal's timeline; it is listable and downloadable. Everything is org-scoped, and a
cross-org request returns **404**. The tests falsify that by **swapping the
organization id on the request**, never by removing a symbol (CLAUDE.md, "a
load-bearing gate must be falsified against the SEMANTIC defect").

---

## 2. Grounding — what already exists

| Thing | Where | What it gives us |
|---|---|---|
| Byte store | `server/services/documentStore.ts` | `documentStoreConfigured()`, `putOrgObject(orgId, key, bytes, contentType) → s3://…`, `getOrgObject(orgId, ref)`, `signedOrgObjectUrl(orgId, ref, ttl)`, `deleteAllOrgObjects(orgId)`. **Tenancy is in the key** (`org/<orgId>/…`); every read re-checks the prefix *and* rejects `.`/`..`/empty segments, so a mis-attributed row cannot hand one tenant another's bytes. **Dormant until configured** — `putOrgObject` throws rather than silently dropping bytes. |
| The honest-refusal precedent | `server/services/photoStorage.ts` + `server/routes-rehab-photos.ts:96-98` | `photoStorageAvailable()` checked **before** any row is written; refusal is `Errors.serviceUnavailable(res, PHOTO_STORAGE_UNAVAILABLE_MESSAGE)` → **503**, with a message that says what did *not* happen and what to do instead. |
| Upload middleware | `server/middleware/fileUploadSecurity.ts` | `createUploadMiddleware({ maxSizeMB, allowedTypes })` (multer, **memory storage**, filename sanitised, dangerous-extension blocklist, max 5 files/req) + `validateFileMiddleware(["pdf"])` (**magic-byte** sniff — `%PDF` = `25 50 44 46`; mismatch → 400 `BAD_REQUEST`, empty file → 400). Mounted as `app.post(path, isAuthenticated, getOrCreateOrg, upload.single("file"), validatePdf, handler)` — exactly as `routes-rehab-photos.ts:71-77`. |
| Timeline | `activity_events`, read by `GET /api/{deals,properties,leads}/:id/timeline` (`client/src/components/activity-timeline.tsx:208`) and unioned by `GET /api/deals/:id/track` (`server/routes-deals.ts:261`, `server/services/dealTrack.ts`) | Writer: **`activityLogger.logDocumentUploaded(orgId, entityType, entityId, documentName, documentUrl?, userId?)`** — `server/services/activityLogger.ts:186-204`. The event type `document_uploaded` is **already** declared in `shared/constants/activity.ts:32` with an icon (`Upload`) and a colour in `activity-timeline.tsx:44,68`. |
| Error helpers | `server/utils/errors.ts` | `Errors.notFound` (404), `Errors.badRequest` (400), `Errors.serviceUnavailable` (503), `Errors.internal` (500). All responses are `{ error, message, details?, statusCode }`. |
| Request typing | `server/types/request.ts` | `AuthenticatedRequest`, `getOrganizationId(req)`, `getUserId(req)`. **Org never comes from the body.** |
| Mounting | `server/routes.ts` (`registerDealRoutes`, `registerRehabPhotoRoutes`, …) + `server/routeManifest.ts` | Register-style files attach their own paths; the manifest is a *descriptive mirror* and `tests/unit/routeManifest.test.ts` fails on drift. |
| Route-shadowing gate | `scripts/check-route-shadowing.mjs` | Builds a **global ordered table** by walking `server/routes.ts` top-to-bottom and expanding `registerFoo(app)` bodies, then asks path-to-regexp whether an earlier registration can swallow a later one. Cross-file order is the real order. |
| Tenancy lint | `scripts/check-org-scoped-fetch.mjs` | Any unit touching an org-scoped table whose signature+body never mentions `organizationId` / `orgId` / `forOrg(` / `unscopedForPlatformOps(` is an offender, with a down-only baseline. |
| Migration pattern | `migrations/0308_notes_v2_seller_finance_gate_records.sql` + its block in `scripts/migrate.mjs:13160-13198` | A `.sql` file of flat idempotent statements **and** the same statements mirrored as template literals in `migrate.mjs`, introduced by a `// 03NN — <summary>. Mirrors migrations/03NN_<name>.sql.` comment. |
| Table-count ratchet | `scripts/ratchets/table-count.json` | `baselineCount` currently **754**, direction `down`, pattern `pgTable\(` over `shared/**/*.ts`. |
| S3 test seam | `tests/unit/documentStore.test.ts:12-40` | The established seam is **`vi.mock("@aws-sdk/client-s3")` + `vi.mock("@aws-sdk/s3-request-presigner")`** with a `vi.hoisted()` recording double, plus setting/clearing `DOCUMENTS_S3_BUCKET` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. |
| Real-DB harness | `tests/helpers/realDb.ts`, example `tests/unit/apidStore.realdb.test.ts` | `useRealDb("<file>")` at module scope **before** anything imports `server/db`; `describe.runIf(realDbAvailable)`; `afterAll` ends the pool; fixtures are synthetic and self-namespaced. |

---

## 3. Decisions

### 3.1 Which "note"?

`/api/notes/*` and `/notes/:id` are the **acquired-notes** book
(`server/routes-notes.ts:1-13,22`, `client/src/pages/note-detail.tsx:1-13`).
`acquired_notes.id` is **uuid** (it is in the uuid-id family converged by
`scripts/migrate.mjs:68`). The seller-finance servicing book is the separate
`notes` table with an **integer** id. **This slice attaches documents to
`acquired_notes`** — that is the surface a user can reach, and the collateral
file (note, mortgage/DOT, allonge, assignment chain) is what a note investor
actually has to upload.

The seller-finance `notes` book is **out of scope** and is a one-column
follow-on, not a blocker.

### 3.2 Table name — `uploaded_documents`

`generated_documents` already exists (queried in `server/routes-deals.ts:68-84`)
and means *documents AcreOS produced*. The sibling namespace is already crowded:
`document_templates`, `document_versions`, `document_packages`, `signatures`.
`uploaded_documents` is the exact mirror of `generated_documents` — *documents
the customer brought* — collides with nothing, and reads correctly at a call
site (`uploadedDocuments` next to `generatedDocuments`).

### 3.3 Object link — three nullable FK columns, not polymorphic type+id

The repo does both. `activity_events` and the audit log are polymorphic
(`entity_type` + integer `entity_id`); `sanctions_screenings` is polymorphic with
a **text** id *because it explicitly has no FK to point at*. But the nearest
sibling — a document table — is `generated_documents`, which carries a real
`deal_id` column.

Two facts decide it:

1. The three parents have **different id types**: `deals.id` and `properties.id`
   are integer, `acquired_notes.id` is uuid. A single polymorphic `object_id`
   would have to be `text`, which throws away every foreign key and every cascade.
2. We want `ON DELETE CASCADE` so a hard-deleted deal does not leave document
   rows pointing at nothing (bytes are separately swept by
   `deleteAllOrgObjects` on org erasure, which is prefix-based and does not care
   about rows).

So: `deal_id integer`, `property_id integer`, `acquired_note_id uuid`, all
nullable, with `CHECK (num_nonnulls(deal_id, property_id, acquired_note_id) = 1)`
— the database itself refuses a row attached to nothing or to two things.

### 3.4 Route shape — nested per object, generated from one enumerated table

Convention in this repo is nested: `/api/rehabs/:rehabId/photos`,
`/api/deals/:id/track`, `/api/deals/:id/timeline`, `/api/notes/:id/payments`.
A unified `/api/documents` surface would also have to carry `objectType` in the
body or query, which is exactly the shape that lets an org id or an object kind
arrive from the client.

So the routes are nested — **including download**, so a document is always
reached through its parent object and the org⇢object⇢document scoping chain is
identical on all three verbs. The three kinds are registered from ONE constant
table and ONE handler factory, so the population is enumerable and a fourth kind
cannot be added without appearing in the list the test reads:

```ts
export const DOCUMENT_OBJECT_KINDS = [
  { kind: "deal",     segment: "deals",      column: "dealId",          idType: "int"  },
  { kind: "property", segment: "properties", column: "propertyId",      idType: "int"  },
  { kind: "note",     segment: "notes",      column: "acquiredNoteId",  idType: "uuid" },
] as const;
```

**Shadowing:** every new path has the literal segment `documents` after the
`:objectId` param, so none of them can be swallowed by an existing
`/api/deals/:id/<literal>` route, and none of them swallows one. `registerObject
DocumentRoutes(app)` is registered in `server/routes.ts` **after**
`registerDealRoutes` / `registerPropertyRoutes` / `registerNoteRoutes`; since the
earlier files register literal-tailed two-segment paths only, nothing earlier
matches `/api/deals/:id/documents`. `scripts/check-route-shadowing.mjs` is the
gate that proves it, and it must be run (not reasoned about).

### 3.5 Byte/row order — bytes FIRST, row inside the transaction

`routes-rehab-photos.ts` inserts a placeholder row, writes bytes, then updates
`s3Key`, because it needs the generated row id to build the key. We do not: the
route generates the document uuid itself (`crypto.randomUUID()`), so the key is
known before anything is written.

Order: **check storage configured → validate file → resolve the parent object for
this org → `putOrgObject` → `db.transaction` { insert row; log timeline event }**.

A failure after the put leaves an orphan object under `org/<orgId>/documents/…`
with no row. That is the *safe* direction — the forbidden state is a row for
bytes we did not keep (DEFECT-0164) — and orphans are removed by
`deleteAllOrgObjects`, which sweeps the whole org prefix regardless of rows.

### 3.6 `category` — a nullable text column, kept

One nullable `category text` column costs one line of DDL and one optional
multipart field. It is what makes the later required-documents-checklist slice a
read over existing rows rather than a backfill of files already uploaded blind.
No enum, no CHECK, no UI beyond a free-text select — the checklist slice owns the
vocabulary.

### 3.7 Purpose-ledger census — **neither LEDGERED nor a DEBT entry**

`tests/unit/purposeLedgerCensus.test.ts` derives its population from source: a
candidate is a *surface* (route / MCP tool / dispatch-switch case / webhook /
model call) that performs a **person-adjacent read**, defined by `DIRECT_READ`
(`server/services/purposeLedger.ts` + the census test, lines 51-63) as a read of
`leads` / `skipTraces` / `parcelSnapshots`, of an `ownerAddress` /
`mailingAddress` / `ownerMailingAddress` field, or a `skipTracingService.trace()`
call.

The new routes read `uploaded_documents`, `deals`, `properties` and
`acquired_notes`, and write S3 bytes. **None of those is in the predicate**, so
these surfaces never enter the census population at all. That is not an
oversight to be papered over: the census registers are closed both ways — "a
register entry with no candidate fails (stale)" — so adding a DEBT entry for
these routes would make `purposeLedgerCensus.test.ts` **go red**.

**Call: no `recordPurpose`, no DEBT entry.** The reason, stated for the next
reader: the purpose ledger governs *reads of person-adjacent contact data the
server holds in known tables*. A PDF's contents are opaque bytes; the ledger
cannot describe a purpose for data it cannot see, and pretending otherwise would
dilute the three ledgered surfaces into a general-purpose access log. The honest
privacy posture for uploaded bytes is tenancy-in-the-key plus org-prefix erasure,
both of which `documentStore.ts` already provides. If a later slice *extracts*
owner contact data out of an uploaded document into a lead or a skip-trace row,
**that** extraction is a census candidate and must be ledgered then.

---

## 4. Schema

### 4.1 Where it goes

`shared/schema/uploaded-documents.ts`, re-exported from `shared/schema.ts`
alongside the other extracted modules (the `export * from "./schema/…"` block at
the end of `shared/schema.ts`). A new module rather than more lines in the
14k-line barrel; the re-export is what makes `drizzle-kit push` create it, which
is why every table in the repo has to be re-exported (see the drift-closure note
at `shared/schema.ts:14136-14144`).

`shared/constants/activity.ts` is **not** touched — `document_uploaded` is
already there.

### 4.2 Columns

```ts
export const uploadedDocuments = pgTable("uploaded_documents", {
  id:              uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId:  integer("organization_id").notNull()
                     .references(() => organizations.id, { onDelete: "cascade" }),

  // Exactly one of the three is non-null (CHECK in the migration).
  dealId:          integer("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  propertyId:      integer("property_id").references(() => properties.id, { onDelete: "cascade" }),
  acquiredNoteId:  uuid("acquired_note_id").references(() => acquiredNotes.id, { onDelete: "cascade" }),

  fileName:        text("file_name").notNull(),      // sanitised originalname from multer
  contentType:     text("content_type").notNull(),   // the DETECTED mime, not the client's claim
  byteSize:        integer("byte_size").notNull(),   // CHECK > 0
  storageRef:      text("storage_ref").notNull(),    // s3://<bucket>/org/<orgId>/documents/...
  category:        text("category"),                 // nullable, free text — see §3.6
  uploadedBy:      text("uploaded_by").notNull(),    // getUserId(req)
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("uploaded_documents_org_deal_idx").on(table.organizationId, table.dealId, table.createdAt),
  index("uploaded_documents_org_property_idx").on(table.organizationId, table.propertyId, table.createdAt),
  index("uploaded_documents_org_note_idx").on(table.organizationId, table.acquiredNoteId, table.createdAt),
]);

export type UploadedDocument = typeof uploadedDocuments.$inferSelect;
export type InsertUploadedDocument = typeof uploadedDocuments.$inferInsert;
```

Conventions honoured: uuid PK with `gen_random_uuid()` (0306/0307/0308);
`organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`
(0305/0306/0307); `timestamptz … DEFAULT now()`; **org-LEADING composite
indexes** for `scripts/check-org-leading-index.mjs`.

**No soft-delete columns** — there is no delete endpoint in this slice, and an
unreachable `deleted_at` is dead schema. **No append-only trigger** — 0305-0308
carry them because they are ledgers; this is a file index, and the build needs no
UPDATE path either (the ref is known before the insert, §3.5).

---

## 5. Migration — PROVISIONAL 0309

`migrations/0309_uploaded_documents.sql`, mirrored statement-for-statement in
`scripts/migrate.mjs`. **The number is PROVISIONAL**: 0309 is the next free slot
on `main` today, and it is renumbered at merge time if another leg takes it first
(exactly as 0307→0308 was renumbered for PR #529 — see the `lastBumpNote` in
`scripts/ratchets/table-count.json`). Both the filename and the `migrate.mjs`
comment must say "provisional 0309" until merge.

Shape: flat idempotent statements (`CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`), as 0305/0306/0308 create their tables — not a
`DO` block, which this repo reserves for conditional constraint rewrites.

```sql
-- 0309 — Deal document store (autonomy gap §8 slice 5, register gap #2):
-- uploaded_documents, the customer's own PDFs attached to a deal, a property or
-- an acquired note. PROVISIONAL NUMBER — renumbered at merge if the slot moves.
--
-- Mirror of generated_documents (what AcreOS produced) for what the customer
-- brought. Bytes live in S3 under org/<orgId>/ (server/services/documentStore.ts);
-- this table is the index, and storage_ref is the s3:// reference the store
-- re-checks against the caller's org prefix on every read.
--
-- EXACTLY ONE PARENT: three nullable FKs rather than a polymorphic type+id,
-- because deals/properties are integer-keyed and acquired_notes is uuid-keyed —
-- a text object_id would have thrown away every FK and every cascade. The CHECK
-- is what makes "attached to nothing" and "attached to two things" unrepresentable.
--
-- ORG-OWNED, CASCADING: organization_id NOT NULL with ON DELETE CASCADE, and each
-- parent FK cascades too, so a hard-deleted deal leaves no orphan rows. Orphan
-- BYTES (a put that succeeded before a failed insert) are swept by
-- deleteAllOrgObjects, which walks the org prefix and ignores rows.
--
-- NO append-only trigger: this is a file index, not a ledger. Nothing updates a
-- row — the storage reference is known before the insert.
CREATE TABLE IF NOT EXISTS "uploaded_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "deal_id" integer REFERENCES "deals"("id") ON DELETE CASCADE,
  "property_id" integer REFERENCES "properties"("id") ON DELETE CASCADE,
  "acquired_note_id" uuid REFERENCES "acquired_notes"("id") ON DELETE CASCADE,
  "file_name" text NOT NULL CHECK (length(trim("file_name")) > 0),
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL CHECK ("byte_size" > 0),
  "storage_ref" text NOT NULL CHECK ("storage_ref" LIKE 's3://%'),
  "category" text,
  "uploaded_by" text NOT NULL CHECK (length(trim("uploaded_by")) > 0),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uploaded_documents_exactly_one_parent"
    CHECK (num_nonnulls("deal_id", "property_id", "acquired_note_id") = 1)
);
CREATE INDEX IF NOT EXISTS "uploaded_documents_org_deal_idx"
  ON "uploaded_documents" ("organization_id", "deal_id", "created_at");
CREATE INDEX IF NOT EXISTS "uploaded_documents_org_property_idx"
  ON "uploaded_documents" ("organization_id", "property_id", "created_at");
CREATE INDEX IF NOT EXISTS "uploaded_documents_org_note_idx"
  ON "uploaded_documents" ("organization_id", "acquired_note_id", "created_at");
```

In `scripts/migrate.mjs`, appended to `STATEMENTS` in the same shape as the 0308
block (`scripts/migrate.mjs:13160-13198`), introduced by:

```js
// 0309 — Deal document store: uploaded_documents (customer-uploaded PDFs on a
// deal / property / acquired note; exactly one parent, org-owned, cascading).
// PROVISIONAL NUMBER. Mirrors migrations/0309_uploaded_documents.sql.
```

**Ratchet:** `scripts/ratchets/table-count.json` — `baselineCount` **754 → 755**,
**expected delta +1 table**, with a `lastBumpNote` naming the slice, the
provisional migration number and Tom's 2026-11-10 approval. The baseline is set
by **measurement on the final tree** (`node scripts/ratchet.mjs --measure`), not
by arithmetic in this document; if the measured number is not 755, the build
stops and finds out why rather than writing 755 down.

---

## 6. Service module

`server/services/objectDocuments.ts` — the one place that knows the key layout,
the parent-resolution rule and the refusal message. Every function takes
`organizationId` as its first argument, which is also what keeps it clean under
`scripts/check-org-scoped-fetch.mjs`.

```ts
import type { PrimaryDb } from "../db";

export const DOCUMENT_STORAGE_UNAVAILABLE_MESSAGE =
  "Document storage isn't connected yet, so this file was not saved. " +
  "Keep the original — re-upload it once storage is connected.";

export type DocumentObjectKind = "deal" | "property" | "note";

export interface DocumentObjectKindDef {
  readonly kind: DocumentObjectKind;
  readonly segment: "deals" | "properties" | "notes";
  readonly column: "dealId" | "propertyId" | "acquiredNoteId";
  /** activity_events can only carry an integer entity id — see §7. */
  readonly timelineEntityType: "deal" | "property" | null;
}

/** The ENUMERATED population. A fourth kind must appear here, and the test reads it. */
export const DOCUMENT_OBJECT_KINDS: readonly DocumentObjectKindDef[];

/** True only when DOCUMENTS_S3_BUCKET + AWS credentials are present. */
export function documentStorageAvailable(): boolean;

/**
 * Does this object exist IN THIS ORG? Returns the normalised parent id, or null
 * (→ the route answers 404). The ONLY place an object id is trusted.
 */
export function resolveDocumentParent(
  organizationId: number,
  kind: DocumentObjectKind,
  rawObjectId: string,
): Promise<{ dealId: number | null; propertyId: number | null; acquiredNoteId: string | null } | null>;

/**
 * Bytes first, then the row (§3.5). THROWS if storage is unconfigured — the
 * route checks `documentStorageAvailable()` before calling, so nothing can
 * record a row for bytes that were dropped.
 */
export function storeObjectDocument(input: {
  organizationId: number;
  kind: DocumentObjectKind;
  parent: Awaited<ReturnType<typeof resolveDocumentParent>> & {};
  fileName: string;
  contentType: string;
  bytes: Buffer;
  category: string | null;
  uploadedBy: string;
}): Promise<UploadedDocument>;

/** Newest first. Org-scoped AND parent-scoped. */
export function listObjectDocuments(
  organizationId: number,
  kind: DocumentObjectKind,
  parent: NonNullable<Awaited<ReturnType<typeof resolveDocumentParent>>>,
): Promise<UploadedDocument[]>;

/**
 * The row, only if it is this org's AND hangs off this parent. null → 404.
 * Both predicates matter: org alone would let a caller download their own org's
 * document through someone else's deal id, which is a smaller leak but the same bug.
 */
export function getObjectDocument(
  organizationId: number,
  kind: DocumentObjectKind,
  parent: NonNullable<Awaited<ReturnType<typeof resolveDocumentParent>>>,
  documentId: string,
): Promise<UploadedDocument | null>;

/** Bytes for a row this org owns. documentStore re-checks the org prefix in the key. */
export function readObjectDocumentBytes(
  organizationId: number,
  doc: UploadedDocument,
): Promise<Buffer>;
```

Key layout: `documents/<segment>/<objectId>/<documentId>.pdf`, passed to
`putOrgObject(orgId, key, …)`, which prefixes `org/<orgId>/`. The stored
`storage_ref` is the full `s3://<bucket>/org/<orgId>/documents/…` reference, never
the bare key — the same choice `routes-rehab-photos.ts:174-177` made, and what
makes the read path's prefix check meaningful.

---

## 7. Timeline integration

**Deals and properties: a real `activity_events` row.** Inside the same
transaction as the insert, call

```ts
await activityLogger.logDocumentUploaded(
  orgId, "deal" /* or "property" */, parentId, doc.fileName,
  `/api/deals/${parentId}/documents/${doc.id}/download`, userId,
);
```

The event type `document_uploaded` already exists in
`shared/constants/activity.ts:32` and already renders (icon `Upload`, slate
badge) in `client/src/components/activity-timeline.tsx:44,68` — it had **no
production writer**. This slice is what makes it real, which is the exact
"canonical thing with zero call sites" shape CLAUDE.md warns about. The row shows
up unchanged in `GET /api/deals/:id/timeline`, `GET /api/properties/:id/timeline`
and in the unioned `GET /api/deals/:id/track`.

`documentUrl` carries the **API download path**, never a signed S3 URL: a signed
URL expires in 300s and a timeline is permanent, so storing one would put a dead
link in the record.

**Acquired notes: no timeline row, and this is stated rather than worked around.**
`activity_events.entity_id` is an integer and `TrackEvent.entityType` is
`"lead" | "property" | "deal"` (`server/services/dealTrack.ts:38-39`;
`activityLogger` signatures, `server/services/activityLogger.ts:17`). An acquired
note's id is a uuid. Widening `entity_id` to text would touch every reader of a
hot CRM table for one new row type — a schema change far larger than this slice.
`note_events` is not the alternative either: its `category`/`event_type` CHECKs
are bound both ways (`scripts/migrate.mjs:13095-13124`), so a document event
would need a constraint migration, and that table means loan outcomes, calendar
dates, analysis and delinquency — not files.

So for notes the client reads `GET /api/notes/:id/documents` directly and renders
the panel. **No workflow trigger is emitted for any kind** — a new
`document.uploaded` trigger would require a matching entry in
`shared/workflow-live-triggers.ts` in the same change
(`server/services/propertyEvents.ts:27-29`), and that is a separate slice.

---

## 8. Routes

New file `server/routes-object-documents.ts`, export
`registerObjectDocumentRoutes(app: Express): void`. All nine routes are produced
by one factory looping `DOCUMENT_OBJECT_KINDS`, so there is one implementation of
each behaviour and three registrations of each path.

Middleware chain, identical to `routes-rehab-photos.ts:71-77`:
`isAuthenticated, getOrCreateOrg, pdfUpload.single("file"), validatePdf`
where `pdfUpload = createUploadMiddleware({ maxSizeMB: 25, allowedTypes: ["pdf"] })`
and `validatePdf = validateFileMiddleware(["pdf"])`.

| # | Method | Path | Auth | Behaviour |
|---|---|---|---|---|
| 1 | POST | `/api/deals/:objectId/documents` | `isAuthenticated` + `getOrCreateOrg`; org from `getOrganizationId(req)`, user from `getUserId(req)` — **never from the body** | multipart field `file` (single), optional `category`. Order: 503 if storage unconfigured → 400 on bad/absent file (middleware) → 404 if the deal is not this org's → `putOrgObject` → insert + timeline row in one transaction → **201** `{ document }` |
| 2 | GET | `/api/deals/:objectId/documents` | same | 404 if the deal is not this org's; else **200** `{ objectType, objectId, total, storageAvailable, documents: [...] }`, newest first |
| 3 | GET | `/api/deals/:objectId/documents/:documentId/download` | same | 404 if the deal is not this org's; 404 if the document is not this org's **or** not on this deal; 503 if storage unconfigured; else **200** with `Content-Type: application/pdf`, `Content-Length`, `Content-Disposition: attachment; filename="<file_name>"`, body = bytes |
| 4-6 | — | `/api/properties/:objectId/documents[…]` | same | identical, parent = `properties` |
| 7-9 | — | `/api/notes/:objectId/documents[…]` | same | identical, parent = `acquired_notes`; no timeline row is written (§7) |

### Every refusal, explicitly

| Condition | Status | Body |
|---|---|---|
| Storage unconfigured, on upload | **503** | `Errors.serviceUnavailable(res, DOCUMENT_STORAGE_UNAVAILABLE_MESSAGE)` → `{ error: "SERVICE_UNAVAILABLE", message: "Document storage isn't connected yet, so this file was not saved. Keep the original — re-upload it once storage is connected.", statusCode: 503 }`. Checked **before** any row is written (DEFECT-0164). |
| Storage unconfigured, on download | **503** | same helper, message "Document storage isn't connected, so this file can't be downloaded right now." |
| Parent object does not exist, or belongs to another org | **404** | `Errors.notFound(res, "Deal" \| "Property" \| "Note")` — the same answer for both, so the endpoint never confirms that another org's id exists |
| Document id does not exist, belongs to another org, or hangs off a different parent | **404** | `Errors.notFound(res, "Document")` |
| Non-numeric `:objectId` on deal/property, non-uuid on note | **400** | `Errors.badRequest(res, "Invalid deal id")` — matches `routes-deals.ts:265` |
| No file, empty file, or magic bytes are not `%PDF` | **400** | from `validateFileMiddleware` — `Unable to determine file type for: x.txt` / `File type not allowed: image/png. Allowed: pdf` |
| File > 25 MB, or a blocked extension | **400/413** | multer limit via the shared error path |
| Anything else | **500** | `Errors.internal(res, err)` |

`storageAvailable` is returned on the list response for the same reason
`routes-rehab-photos.ts:264-271` returns it: rows whose bytes cannot currently be
served must say so rather than render a download button that 503s.

---

## 9. Client

One shared panel, three mount points — the bundle budget is the constraint, and
`shared/constants/activity.ts:1-17` is the standing reminder that a careless
import here drags 364 KB of DDL into the client entry chunk. The panel imports
**no** schema types from `@shared/schema`; it declares its own row interface.

**New:** `client/src/components/documents-panel.tsx`

```tsx
<DocumentsPanel objectType="deal" | "property" | "note" objectId={string | number} />
```

- `useQuery` on `/api/{segment}/{id}/documents`.
- Drag-and-drop + file picker → `POST` as `FormData` with field `file`;
  `accept="application/pdf"`.
- Loading → `<Skeleton />` shaped like the row list (never a spinner).
- Empty → `<EmptyState />` with a purposeful CTA ("Add the title commitment").
- Error → `<QueryErrorState />` with retry.
- `storageAvailable: false` → an inline honest notice carrying the server's own
  message; the upload control is disabled with that message as its reason, not
  hidden.
- List animated with `staggerContainer` / `staggerItem` from
  `client/src/lib/animations.ts`.
- Download is an `<a href>` to the download path — no blob juggling.
- Accessibility: the icon-only remove/overflow affordances are **not built** (no
  delete this slice); the drop zone is a real `<button>` with a visible focus
  ring and an `aria-label`; the file input has an associated `<label>`.
- shadcn/ui + Tailwind design tokens only; no hardcoded colours.

**Mount points (3):**

| Surface | File | Placement |
|---|---|---|
| Deal | `client/src/components/deal-detail-content.tsx` | a **Documents** tab in the existing `<Tabs>`, beside the activity timeline — serves both `/deals/:id` (`client/src/pages/deal-detail.tsx`) and the drawer on `/deals` |
| Property | the property detail surface that renders the property's `<ActivityTimeline entityType="property" />` | a Documents card in the same column |
| Acquired note | `client/src/pages/note-detail.tsx` | a Documents card beside `<NoteAssignmentsCard />` / `<NoteComplianceCard />` |

No new nav entry, no new route, no new door — the panel lives behind **Deals**,
**Map** and **Finance** respectively, as the five-doors rule requires.

> **Build note:** the exact filename of the property-detail component was not
> pinned in this design session. The build resolves it by finding the file that
> renders `<ActivityTimeline entityType="property" …/>` and mounts there; if that
> surface turns out not to exist, the property panel mounts on the property
> detail page and the fact is recorded in the PR rather than invented here.

---

## 10. Test plan — `tests/unit/dealDocuments.realdb.test.ts`

Harness, exactly as `tests/unit/apidStore.realdb.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";
useRealDb("dealDocuments.realdb.test.ts");
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
describe.runIf(realDbAvailable)("deal document store — real database", () => {
  afterAll(async () => { const { pool } = await import("../../server/db"); await pool.end(); });
  …
});
```

**S3 seam (named):** `vi.mock("@aws-sdk/client-s3")` + `vi.mock("@aws-sdk/s3-request-presigner")`
with a `vi.hoisted()` recording double — the identical seam
`tests/unit/documentStore.test.ts:12-40` already uses. The three env vars
(`DOCUMENTS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) are set in
`beforeAll` and cleared per-case for the unconfigured test. **No real S3 call in
any case.**

**HTTP seam:** an `express()` app in the test with `express.json()` and
`registerObjectDocumentRoutes(app)`, with `./auth`'s `isAuthenticated` and
`./middleware/getOrCreateOrg` mocked to install `req.user` and `req.organization`
from a per-test variable. **That variable is the org-id swap** — the cross-org
cases change *who is asking*, not what exists, which is what the brief requires
and what a symbol-removal test can never prove. Requests go through `supertest`.

**Fixtures:** two real organizations created in `beforeAll` (`orgA`, `orgB`) with
synthetic names, plus in `orgA` one deal, one property and one acquired note, and
in `orgB` one deal. A 9-byte buffer beginning `%PDF-1.7` is the PDF; a buffer
beginning `PNG` is the non-PDF.

| # | Case | Asserts |
|---|---|---|
| 1 | **Round trip — deal.** POST → GET list → GET download, all as `orgA` | 201 with a document id; list returns exactly that row (`fileName`, `contentType: "application/pdf"`, `byteSize`); download returns 200, `content-type: application/pdf`, the same bytes |
| 2 | **Round trip — property** | as #1 against `/api/properties/:id/documents` |
| 3 | **Round trip — acquired note** | as #1 against `/api/notes/:id/documents`, proving the uuid parent path works |
| 4 | **Tenancy is in the key** | the inserted row's `storage_ref` starts `s3://<bucket>/org/<orgA.id>/documents/` — read from the row in the real DB, and from the recorded `PutObjectCommand` input `Key` |
| 5 | **Exactly one parent (DB-level)** | a direct `INSERT` naming two parents, and one naming none, both fail with `23514` (check violation) — the constraint is proved in the database, not in the route |
| 6 | **Cross-org 404 — upload** | `orgB` POSTs to `orgA`'s deal id → **404**, and `select count(*)` on `uploaded_documents` for that deal is unchanged |
| 7 | **Cross-org 404 — list (org-id swap)** | the *same* GET that returned the document in #1, replayed with the acting org swapped to `orgB` → **404**, body `error: "NOT_FOUND"`, no documents leaked |
| 8 | **Cross-org 404 — download (org-id swap)** | the *same* download URL from #1, replayed as `orgB` → **404**, and the S3 double recorded **no** `GetObjectCommand` |
| 9 | **Wrong-parent 404** | `orgA` downloads its own document id through its *property* path instead of the deal path → **404** (org alone is not enough) |
| 10 | **Unconfigured store refuses, and keeps nothing** | with the three env vars deleted, POST → **503**, body message is `DOCUMENT_STORAGE_UNAVAILABLE_MESSAGE`, the S3 double recorded no `PutObjectCommand`, **and** `uploaded_documents` gained no row |
| 11 | **Unconfigured store, download** | env cleared, download of an existing row → **503**, not a 500 and not a 200 with empty bytes |
| 12 | **Non-PDF rejected** | a PNG-magic buffer named `deed.pdf` → **400** `BAD_REQUEST`, no row, no put. (Named `.pdf` deliberately: the gate must be the magic bytes, not the extension.) |
| 13 | **Empty file rejected** | zero-byte upload → **400**, no row |
| 14 | **Timeline row written for a deal** | after #1, `activity_events` holds a row for `(orgA, "deal", dealId)` with `event_type = 'document_uploaded'`, a description naming the file, and `metadata.documentUrl` equal to the API download path (**not** an `https://` signed URL) |
| 15 | **No timeline row for a note** | after #3, no `activity_events` row references the note — the stated limitation of §7 is pinned, so a later widening has to update this assertion rather than silently diverge |
| 16 | **Every kind is covered** | iterate `DOCUMENT_OBJECT_KINDS` and assert each `segment` appears in the cases above — a fourth kind added without a case fails here (the enumerated-population rule) |

Case 16 is the vacuity guard: without it, a kind quietly dropped from the
registration loop would leave every other case green.

---

## 11. Build manifest

**Created (6)**

| File | What |
|---|---|
| `shared/schema/uploaded-documents.ts` | the `uploadedDocuments` pgTable + `UploadedDocument` / `InsertUploadedDocument` |
| `migrations/0309_uploaded_documents.sql` | the migration (PROVISIONAL number) |
| `server/services/objectDocuments.ts` | kind table, key layout, parent resolution, store/list/get/read, refusal message |
| `server/routes-object-documents.ts` | `registerObjectDocumentRoutes` — 9 routes from one factory |
| `client/src/components/documents-panel.tsx` | the one shared panel |
| `tests/unit/dealDocuments.realdb.test.ts` | the 16-case plan above |

**Modified (7)**

| File | Change |
|---|---|
| `shared/schema.ts` | `export * from "./schema/uploaded-documents";` in the module re-export block (required for `drizzle-kit push`) |
| `scripts/migrate.mjs` | the mirrored 0309 block appended to `STATEMENTS`, in the 0308 comment+template-literal shape |
| `scripts/ratchets/table-count.json` | `baselineCount` 754 → **755** (+1, measured) with a `lastBumpNote` naming slice 5, provisional 0309 and Tom's 2026-11-10 approval |
| `server/routes.ts` | `import { registerObjectDocumentRoutes } from "./routes-object-documents";` + the call, after the deal/property/note registrations |
| `server/routeManifest.ts` | `{ file: "routes-object-documents.ts", mountPath: null, kind: "register", export: "registerObjectDocumentRoutes" }` — otherwise `routeManifest.test.ts` fails on drift |
| `client/src/components/deal-detail-content.tsx` | a Documents tab mounting `<DocumentsPanel objectType="deal" …/>` |
| `client/src/pages/note-detail.tsx` | a Documents card mounting `<DocumentsPanel objectType="note" …/>` |

**Modified (1, filename to be resolved by the build)** — the property detail
surface, per the build note in §9.

**Explicitly NOT touched:** `shared/constants/activity.ts` (`document_uploaded`
already exists), `shared/workflow-live-triggers.ts` (no new workflow trigger),
`server/services/purposeLedger.ts` and the census registers (§3.7),
`server/services/documentStore.ts` (used as-is).

**Gates to run — and to read without a pipe** (`npm run check > /tmp/check.log
2>&1; echo $?`, never `| tail`):

- `npm run check`, `npm test`, `npm run build`
- `node scripts/check-org-scoped-fetch.mjs` — every new unit names `organizationId`
- `node scripts/check-org-leading-index.mjs` — the three composite indexes lead with org
- `node scripts/check-route-shadowing.mjs` — the nine new paths are reachable
- `node scripts/ratchet.mjs --measure` then set table-count to the measured value
- `tests/unit/routeManifest.test.ts`, `tests/unit/purposeLedgerCensus.test.ts`,
  `tests/unit/clientBundleHasNoOrm.test.ts`

---

## 12. Flags

**No BLOCKED-DRIVER.** Nothing in this slice needs a founder decision beyond the
one already given, needs a second new table, or touches a DO-NOT-DO line. For the
record, the three that were checked and cleared:

- **One table only.** The timeline reuses `activity_events` and an event type
  that already exists; no second table.
- **No money, no send rail, no e-sign ceremony.** The slice keeps bytes and
  serves them back. It does not sign, attest, or claim a counterparty did
  anything (`POST /api/signatures` remains the only signature record).
- **No new door.** Three panels behind three existing doors; no nav entry.

Three things are **deliberately out of scope and named here so the next session
does not rediscover them as bugs**:

1. **Acquired notes have no timeline entry** (§7). Stated behaviour, pinned by
   test case 15, not a defect.
2. **The seller-finance `notes` book cannot hold documents** (§3.1). Adding it is
   one nullable `note_id integer` column plus one `DOCUMENT_OBJECT_KINDS` entry —
   a later slice, not a blocker, and it *would* get a timeline row since that
   table is integer-keyed.
3. **No delete, no versioning, no extraction, no checklist.** A re-upload is a
   second row. The checklist slice owns `category`'s vocabulary.
