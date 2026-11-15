# PKG-1 — DSAR / privacy-request readiness: Step-0 design (2026-11-09)

Status: **DECIDED** (design session). Build sessions execute this; they do not re-derive it.
Tree read: main + PR #526 (`shared/privacy/dsarClock.ts` present, `DSAR_CLOCK_HOURS = 24`).
All `file:line` references are to that tree.

Every decision below is final for the build, except the items in **§0 STOP-and-record**. Those
are places where the code contradicts the spec. Each one has a decided default the build ships,
plus a question only the founder or counsel can close.

---

## §0 — Where the code contradicts the spec (read first)

| # | Spec assumption | What the code says | Decision |
|---|---|---|---|
| C-1 | "the existing founder-export pattern in the client" | **No client code calls `generate-export`, `verify` or `erasure`.** The only live founder DSAR UI is `client/src/pages/founder-compliance-ops.tsx`. It calls `/recent` (:49), `/self-test` (:57) and `/:id/fulfill` (:84) only. `FounderDsarPage` was archived 2026-06-01, and `/founder/dsar` redirects to `/founder/bridge` (`client/src/App.tsx:1383-1386`, comment :328). | Mirror the **mutation** pattern of `fulfillDsar` (`founder-compliance-ops.tsx:76-101`) and the **blob-download** pattern of `client/src/components/ui/export-button.tsx:46-59` / `client/src/pages/data-export.tsx:128-141`. The export button is built as well, because nothing exists to follow (§6). |
| C-2 | `requesterIdentityVerified` gates verification | The column exists (`shared/schema.ts:5714`, `scripts/migrate.mjs:3408`), but **nothing in the repo writes it**. It defaults to `false`, so every lifecycle row is unverified today. The only verify endpoint writes the *other* table (`server/routes-dsar.ts:209-240` → `dsar_requests.status/verifiedAt`). | Add the missing writer: `POST /api/founder/dsar/:id/verify-identity` (§2). No new column. |
| C-3 | `exportUserData` is "working" | It is reachable but **cannot match a real user**. `generate-export` parses `userId` as an int (`server/routes-privacy-dsar.ts:159-163`) and calls `exportUserData(String(userId))` (:171-172). `users.id` is a UUID varchar (`shared/models/auth.ts:137` ff.), so every call throws `User N not found`, which the route turns into a 500. | Accept a string UUID through a typed subject selector (§3, §4). |
| C-4 | properties "reportedly hard-coded empty" | **Confirmed.** `gdprService.ts:90-91` (TODO), `:123` (`properties: []`), `:130` (`properties: 0`). The schema has no user→property link. `properties` links people only through `sellerId`/`buyerId → leads.id` (`shared/schema.ts:751-752`). | Properties is exported for **lead** subjects through `sellerId`/`buyerId`. It is explicitly excluded for **user** subjects, with that reason (§4). |
| C-5 | `anonymizeUser` is "hold-checked erasure machinery" ready to call | It is hold-checked, but **not by name**. It throws `LegalHoldViolationError` with a fabricated hold `{id:"(see legal_holds)", caseRef:"active"}` (`gdprService.ts:158-166`). It also **anonymizes every lead ASSIGNED to the user** (:207-220) and **deletes every task assigned to the user** (:183-186). Those rows are third parties' personal data and the org's own business records, not the subject's. Assigned leads include **borrower leads that 1099-INT/1098 read** (`server/services/bookkeeping.ts:197-229`, `server/services/form1098Batch.ts:1514-1533`), so calling it as written would silently rewrite tax-form recipients. That breaks the DEFECT-0101 fence. | Fix `anonymizeUser` before wiring it (§3): name the real hold, and remove steps 4 and 6. It has zero callers today, so the behaviour change reaches no one. |
| C-6 | "borrower-subject export **+ erasure** end-to-end" | A borrower has no `users` row. Borrower identity *is* the lead (`notes.borrowerId → leads.id`, `shared/schema.ts:1013`). 1099-INT reads the borrower lead's name, address and TIN (`bookkeeping.ts:197,216-229`). 1098 reads them with **no note-status filter** (`form1098Batch.ts:1452,1517`). Anonymizing a borrower lead changes IRS filings for any year with payments, whatever the note status. | **STOP-and-record (S-1).** Borrower export ships end-to-end. Borrower **erasure is refused by name**: 422 `RETENTION_REQUIRED_LOAN_RECORDS`, listing the note ids, basis Art. 17(3)(b). Lead erasure *does* ship end-to-end for **non-borrower** leads (seller/buyer contacts). The drill asserts exactly this split (§5). The founder or counsel must rule before borrower erasure is built. |
| C-7 | "per-channel grants" table for consent | No separate grants table exists. Per-channel grants and revocations are append-only `lead_consent_events` rows with a `channels` jsonb (`shared/schema/comms-email.ts:478-520`; writer `server/services/consentEvents.ts:89,99,119`; `TCPA_CONSENT_CHANNELS` :40). The lead-row flags (`tcpaConsent`, `consentDate`, `consentSource`, `optOutDate`, `doNotContact`) are on `leads` (`shared/schema.ts:552-679`). | The consent domain = `lead_consent_events` (all rows for the lead in the org) plus the consent flags on the lead row (§4). |
| C-8 | Two record systems are both live | Only **one** is live. `dsar_requests_lifecycle` is fed by the signed-in customer page (`client/src/pages/privacy-settings.tsx:109,134` → `/api/privacy/export|delete` → `routes-gdpr.ts:62`). It is read by the only founder UI and by the overdue cron (`server/jobs/runScheduledJobs.ts:4850-4864`). `dsar_requests` is fed only by `POST /api/public/dsar` (`routes-dsar.ts:114-170`), which **no client calls**. | Record of record = `dsar_requests_lifecycle` (§1). |

**S-1 (STOP-and-record, founder/counsel):** *Borrower-subject erasure is refused, not performed.* The default ships as described in C-6. To flip it, the ruling must say which borrower fields may be erased given 1099-INT/1098 retention. The build must not design around this. It ships the named refusal and records S-1 in `docs/company/next-moves.md`.

**S-2 (recorded gap, not a stop):** Lead erasure anonymizes the lead's identity anchor: the contact fields on the `leads` row. It does **not** scrub free-text bodies in communications rows that reference the lead by id (messages, inbox, seller communications). The erasure response lists every retained domain with its reason (§3), so the gap is shown, never hidden.

**S-3 (recorded gap):** User erasure anonymizes the AcreOS `users` row. It does not delete the Clerk identity. That is an external call and out of scope ("no sends"). The founder deletes the Clerk user out-of-band, and the erasure response says so in `operatorFollowUps`.

No new tables and **no new columns** are needed (proved per decision below). Table count stays **749**.

---

## §1 — Record of record

**Decision: `dsar_requests_lifecycle` (`shared/schema.ts:5708-5729`) feeds every founder export, verify and erasure action.**

Evidence it is the live system:
- It is the intake for signed-in customers: `routes-gdpr.ts:52-87` (`enqueueDsar`). The public `/api/privacy/dsar` also writes it (`routes-privacy-dsar.ts:37-79`).
- It is the founder queue UI: `founder-compliance-ops.tsx:43-53` reads `/api/founder/dsar/recent` (`routes-privacy-dsar.ts:82-116`).
- It is the overdue cron: `runScheduledJobs.ts:4858-4864` reads lifecycle only.
- It is the existing export route: `routes-privacy-dsar.ts:151-200` loads lifecycle.
- It is the table PR #526's shared clock already stamps (`routes-privacy-dsar.ts:18,43,126`).

**Swappability (Q-C1/Q-C3):** name the choice once, in `shared/privacy/dsarIdentityPosture.ts`:
```ts
export const DSAR_RECORD_OF_RECORD = "dsar_requests_lifecycle" as const;
```
The gate service (§2) loads records only through one adapter, `loadDsarRecord(id): Promise<DsarRecordView | null>`, which returns:
```ts
interface DsarRecordView {
  id: string; table: typeof DSAR_RECORD_OF_RECORD;
  requestType: "access" | "erasure" | "portability" | "rectification" | string;
  requesterEmail: string;           // lower-cased at intake (routes-gdpr.ts:49, routes-privacy-dsar.ts:48)
  verified: boolean;                // ← dsarRequestsLifecycle.requesterIdentityVerified
  fulfilledAt: Date | null; isSelfTest: boolean;
}
```
If counsel later names `dsar_requests` canonical, the swap is a second adapter (`verified ⇐ status ∈ {verified, fulfilling}`) plus the constant. Routes and UI do not change. Do **not** build the second adapter now.

**Routes wired (all in `server/routes-privacy-dsar.ts`, the lifecycle file):**

| Route | Status |
|---|---|
| `POST /api/founder/dsar/:id/generate-export` (existing, :151) | **Rewired**: gate, then typed subject, then registry export. |
| `POST /api/founder/dsar/:id/verify-identity` | **New**: the missing `requesterIdentityVerified` writer. |
| `POST /api/founder/dsar/:id/execute-erasure` | **New**: gated, hold-checked, idempotent erasure. |
| `GET /api/founder/dsar/:id/subject-candidates` | **New**: lists the users and leads whose email equals the record's `requesterEmail`, so the founder picks a subject instead of typing ids. |

**Path names are deliberately distinct** from `routes-dsar.ts`'s `/:id/verify` (:209) and `/:id/erasure` (:291). `registerPrivacyDsarRoutes` is mounted first (`server/routes.ts:2601`, versus `registerDsarRoutes` at :2697). Reusing those paths would make the lifecycle handler shadow the `dsar_requests` handlers for every id.

**The other system (`server/routes-dsar.ts`): POINT. Do not delete, do not deprecate.** Q-C3 (fate of the non-canonical intake) belongs to counsel.
- `POST /api/public/dsar` (:114-170) and its prose "within 30 days" (:165): **untouched**, as the fence requires.
- `GET /api/founder/dsar`, `GET /:id`, `/:id/verify`, `/:id/deny`: **untouched**.
- `/:id/fan-out` (:245-287) and `/:id/erasure` (:291-332): keep the 501. Replace the raw `res.status(501).json(...)` (:277-281, :322-326) with `Errors.notImplemented(res, msg)` (`server/utils/errors.ts:278-280`). The message names the canonical route:
  `"Fulfilment runs on the dsar_requests_lifecycle record: POST /api/founder/dsar/:id/generate-export or /execute-erasure (see docs/pkg1-dsar-design-2026-11.md). This dsar_requests record is not wired."`
  Keep `runFanOutStub`/`runErasureStub` (:103-109) as they are, so the honesty of the 501 is unchanged. Only the response text changes.

---

## §2 — Verification gate and the named identity posture

### Where the check lives (one place, both actions)
New module **`server/services/privacy/dsarActionGate.ts`**:
```ts
export type DsarAction = "export" | "erasure";
export type DsarSubjectSelector =
  | { kind: "user"; userId: string }
  | { kind: "lead"; organizationId: number; leadId: number };
export type DsarSubject =
  | { kind: "user"; userId: string; email: string; organizationIds: number[] }
  | { kind: "lead"; organizationId: number; leadId: number; email: string; isBorrower: boolean; noteIds: number[] };

export type GateRefusal = { status: 404 | 422; reason: DsarRefusalReason; message: string; details?: Record<string, unknown> };
export type DsarRefusalReason =
  | "DSAR_NOT_FOUND" | "DSAR_NOT_VERIFIED" | "DSAR_TYPE_MISMATCH"
  | "SUBJECT_NOT_FOUND" | "DSAR_SUBJECT_MISMATCH";

export async function loadDsarRecord(id: string): Promise<DsarRecordView | null>;
export async function gateDsarAction(
  dsarId: string, selector: DsarSubjectSelector, action: DsarAction,
): Promise<{ ok: true; record: DsarRecordView; subject: DsarSubject } | { ok: false; refusal: GateRefusal }>;
export async function listDsarSubjectCandidates(email: string): Promise<{ users: …[]; leads: …[] }>;
```
`gateDsarAction` is the **only** path to a `DsarSubject`. `buildSubjectExport` (§4) and `eraseDsarSubject` (§3) take a `DsarSubject`, not raw ids, so neither action can be reached around the gate. The routes stay thin: call the gate, map the refusal, call the action.

**Gate order** (each step refuses; nothing is written before the gate passes):
1. Load the record. If it is missing: `404 DSAR_NOT_FOUND` (`Errors.notFound(res, "DSAR request")`).
2. If `!record.verified`: `422 DSAR_NOT_VERIFIED`, message `"Identity is not verified on this DSAR record. Record the verification (POST /api/founder/dsar/:id/verify-identity) before any export or erasure."`. **Field read: `dsarRequestsLifecycle.requesterIdentityVerified`** (`shared/schema.ts:5714`).
3. Check the type. `export` needs `requestType ∈ {access, portability}`; `erasure` needs `requestType === "erasure"`. Otherwise `422 DSAR_TYPE_MISMATCH`. This mirrors `routes-dsar.ts:255-257,301-303`.
4. Resolve the subject. If the user or lead row is missing, or the lead is outside `organizationId` or soft-deleted (`leads.deletedAt`): `404 SUBJECT_NOT_FOUND`.
5. **Email match** (posture): `lower(subject email) === record.requesterEmail`, or `422 DSAR_SUBJECT_MISMATCH`. The refusal `details` never echoes the subject's email.

Routes send refusals with `Errors.unprocessable(res, message, { reason, ...details })` (`errors.ts:288-290`, the helper for "well-formed but the state must change first") or `Errors.notFound`. The machine-readable name is always `details.reason`. No raw `res.status`.

### How a record becomes verified
New `POST /api/founder/dsar/:id/verify-identity` in `routes-privacy-dsar.ts`. Middleware: `isAuthenticated, getOrCreateOrg, requireFounder`, the same as :153-155.
- Body (zod): `{ method: z.enum(DSAR_IDENTITY_POSTURE.acceptedMethods), evidenceNote: z.string().min(DSAR_IDENTITY_POSTURE.minEvidenceNoteChars).max(2000) }`.
- Sets `requesterIdentityVerified = true` and nothing else. **No new column.** Who, when, how and the evidence go into `audit_events` via `auditFromRequest(req, { action: AuditActions.DSAR_VERIFIED, target: { type: "dsar", id }, metadata: { table: DSAR_RECORD_OF_RECORD, method, evidenceNote, posture: DSAR_IDENTITY_POSTURE.id } })` (`server/utils/auditLog.ts:114`, `DSAR_VERIFIED` :144).
- Why `auditNotes` cannot carry the evidence: `/fulfill` overwrites it with `auditNotes ?? null` (`routes-privacy-dsar.ts:210-218`). `audit_events` is append-only and hash-chained, so it is the durable place. That is why no column is needed.
- The call is idempotent. Re-verifying an already-verified record returns 200 with `{ alreadyVerified: true }` and still writes the audit row, so a second attestation is recorded.
- There is **no un-verify** endpoint. It is out of scope; `/deny` exists only on the other table.

### The posture: ONE named place
New **`shared/privacy/dsarIdentityPosture.ts`**. It is pure, has no imports, and sits next to `dsarClock.ts`:
```ts
export const DSAR_RECORD_OF_RECORD = "dsar_requests_lifecycle" as const;

export const DSAR_IDENTITY_POSTURE = {
  id: "strict-operator-attested-exact-email-v1",
  /** A founder must record an identity check on the DSAR record before any action. */
  requireOperatorVerification: true,
  /** The subject's email on file must equal the DSAR requester email exactly (case-insensitive). */
  requireExactEmailMatch: true,
  /** Account-less (lead/borrower) subjects are acted on one organization at a time. */
  leadSubjectsPerOrganization: true,
  acceptedMethods: [
    "signed_in_account_request",   // the intake came from the subject's own authenticated session (routes-gdpr shim)
    "operator_email_loop",         // founder confirmed by a reply from the address on file — sent by the founder by hand; AcreOS sends nothing
    "operator_document_check",     // founder checked a government ID or equivalent out-of-band
    "controller_org_attestation",  // the customer org (the controller for its leads) attested in writing
  ] as const,
  minEvidenceNoteChars: 20,
  /** Quotable statement — PR bodies and the UI quote this verbatim. */
  statement:
    "AcreOS acts on a data-subject request only after a founder records an identity check on that request, " +
    "and only for a subject whose email on file exactly matches the requester's email. A person without an " +
    "AcreOS account (a lead or borrower) is handled one customer organization at a time: a phone, name or " +
    "address match never qualifies, and the same email in another organization is a separate subject. This " +
    "is the strictest plausible default, pending counsel's identity-verification standard (Q-C1/Q-C2/Q-C3).",
} as const;
export type DsarVerificationMethod = (typeof DSAR_IDENTITY_POSTURE.acceptedMethods)[number];
```
Swapping the posture when counsel answers means editing this object. The gate reads `requireOperatorVerification` and `requireExactEmailMatch` from it rather than hard-coding them. The verify route reads `acceptedMethods` and `minEvidenceNoteChars` from it.

**Strictness note on `signed_in_account_request`:** the shim does not record that the intake was signed in. Only the free-text `auditNotes` says "legacy shim" (`routes-gdpr.ts:96,127`), and `/fulfill` can overwrite it. So this method is **still an operator attestation**; the founder picks it after checking. The gate never auto-verifies.

---

## §3 — Erasure wiring

### Route
`POST /api/founder/dsar/:id/execute-erasure` in `routes-privacy-dsar.ts`, middleware `isAuthenticated, getOrCreateOrg, requireFounder`.
- Body (zod discriminated union): `{ subject: { kind: "user", userId: z.string().min(1) } | { kind: "lead", organizationId: z.number().int().positive(), leadId: z.number().int().positive() }, confirm: z.literal("ERASE") }`.
- Handler shape:
```ts
const parsed = eraseBodySchema.safeParse(req.body); if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
const gate = await gateDsarAction(id, parsed.data.subject, "erasure");
if (!gate.ok) return sendGateRefusal(res, gate.refusal);
try {
  const result = await eraseDsarSubject(gate.subject);   // gdprService
  await auditFromRequest(req, { action: AuditActions.DSAR_ERASURE, target: { type: "dsar", id },
    metadata: { table: DSAR_RECORD_OF_RECORD, outcome: "erased", subject: subjectRef(gate.subject), report: result.report, posture: DSAR_IDENTITY_POSTURE.id } });
  return res.json({ erased: true, ...result });
} catch (err) {
  if (err instanceof LegalHoldViolationError) { audit outcome "refused_legal_hold"; return Errors.legalHoldActive(res, err.message, { reason: err.code, organizationId: err.organizationId, holdId: err.hold.id, caseRef: err.hold.caseRef, scope: err.hold.scope, resourceType: err.resourceType, resourceId: err.resourceId }); }
  if (err instanceof DsarErasureRefusedError) { audit outcome err.reason; return Errors.unprocessable(res, err.message, { reason: err.reason, ...err.details }); }
  return Errors.internal(res, err);
}
```
`subjectRef` writes `{kind, userId}` or `{kind, organizationId, leadId}`, never the email. `audit_events` is global and 7-year, so it should not hold the erased person's email. This is a deliberate departure from `routes-dsar.ts:316`, which logs `email`.

### Subject resolution
The lifecycle row has no `userId`, `leadId` or `organizationId`. The subject comes from the founder's selector, constrained by the posture's exact-email match (§2 step 5). `GET /:id/subject-candidates` supplies the choices. It runs one query for `users.email = requesterEmail` (unique, `shared/models/auth.ts`) and one for `leads.email ILIKE requesterEmail AND deletedAt IS NULL` across all orgs. Each lead is returned with `{organizationId, leadId, isBorrower, erased}`, where `isBorrower = EXISTS notes WHERE borrowerId = lead.id AND organizationId = lead.organizationId`. That cross-org read is founder-plane only. See §8 for the org-scope lint.

### What erasure means, per subject kind
New in `server/services/gdprService.ts`:
```ts
export class DsarErasureRefusedError extends Error { constructor(public reason: "SUBJECT_ALREADY_ERASED" | "RETENTION_REQUIRED_LOAN_RECORDS", message: string, public details: Record<string, unknown> = {}) }
export async function eraseDsarSubject(subject: DsarSubject): Promise<{ report: DeletionReport | LeadErasureReport; retained: Array<{ domain: string; reason: string }>; operatorFollowUps: string[] }>;
export async function eraseLeadSubject(organizationId: number, leadId: number): Promise<LeadErasureReport>;
export function isLeadErased(lead: { id: number; email: string | null }): boolean; // email === `deleted-${id}@gdpr-deleted.invalid`
```
`retained` is **derived from the registry** (§4: every domain for that subject kind whose `erasure.action === "retain"`). It is not hand-written.

**User subject → `anonymizeUser(userId)`**, after these required edits (C-5):
1. **Hold naming.** Replace the `orgHasActiveHold` loop (`gdprService.ts:158-166`) with `getActiveHoldsForOrg(orgId)` (`legalHold.ts:68`). If any hold is active in any member org, throw `new LegalHoldViolationError(orgId, "user", userId, { id: h.id, caseRef: h.caseRef, scope: h.scope })` using the **first real hold**. The strictness does not change: any active hold in a member org still blocks. Only the fabricated `"(see legal_holds)"` identity is removed. The `orgHasActiveHold` import goes if it is unused.
2. **Remove step 6** (`:207-220`, anonymize leads assigned to the user). Those leads are third parties and the org's records, and they include borrower leads (DEFECT-0101 fence). Keep `leadsAnonymized` in `DeletionReport`, truthfully `0`.
3. **Remove step 4** (`:183-186`, delete tasks assigned to the user). Tasks are org business records. After the `users` row is anonymized, a `teamMembers.id` reference identifies no one. Keep `tasks` in the report, truthfully `0`.
4. Keep steps 2 (team messages the user sent), 3 (support tickets), 5a (`aiConversations`) and 7 (anonymize the `users` row). The `users` update stays **last**, because it writes the idempotency marker. A crash mid-way therefore leaves the subject *not* erased, and a retry is allowed rather than locked out. The build does not add a transaction; the ordering is the guarantee. Note this in a comment.

**Lead subject → `eraseLeadSubject(orgId, leadId)`** (new; reuses existing machinery):
1. `await assertNotUnderLegalHold(orgId, "lead", leadId)` (`legalHold.ts:109-134`). It throws a `LegalHoldViolationError` with the real hold, covering both `org_wide` and a `lead_specific` match.
2. If the lead is a borrower on **any** note in the org (`notes.borrowerId = leadId AND notes.organizationId = orgId`, any status), throw `DsarErasureRefusedError("RETENTION_REQUIRED_LOAN_RECORDS", "This person is the borrower on note(s) #… — loan, 1099-INT and 1098 records require their identity to be retained (GDPR Art. 17(3)(b)). Erasure is refused; the export is available. Founder/counsel ruling S-1 pending.", { noteIds })`. **S-1.**
3. Otherwise, anonymize the lead row with the **same field set and marker as the existing `anonymizeUser` step 6**. Extract that into a private helper `anonymizeLeadContactFields(leadId)` in gdprService, so the field set lives in one place: `firstName "[Deleted]"`, `lastName "[User]"`, `email deleted-${id}@gdpr-deleted.invalid`, `phone null`, `notes null`. **Extend** it with the address fields the lead carries (`address, city, zip, mailingAddress, mailingCity, mailingZip`, set to null where nullable; the builder checks each column's nullability at `shared/schema.ts:552-679`) and `doNotContact = true`. Do not set `deletedAt`. Soft-deleting would hide the lead from the org's own records and is a separate decision. `taxId` is untouched, but borrowers are already refused in step 2, so non-borrower leads normally have none.
4. Retained, and listed in the response via the registry: `lead_consent_events` (the legal exhibit; never edited or nulled, `comms-email.ts:478` comment), communications rows (S-2), and `email_suppressions` (they must persist to honour the opt-out).

### Legal hold: how it surfaces
- HTTP **423** through `Errors.legalHoldActive(res, err.message, details)` (`errors.ts:386-391`). The body is `{ error: "LEGAL_HOLD_ACTIVE", message: "Legal hold <caseRef> (<holdId>) prevents deletion of <user|lead>:<id> for org <orgId>.", details: { reason: "LEGAL_HOLD_ACTIVE", organizationId, holdId, caseRef, scope, resourceType, resourceId }, statusCode: 423 }`. The message comes from `legalHold.ts:37-39`, so it names the case.
- The attempt is audited (`DSAR_ERASURE`, `outcome: "refused_legal_hold"`, plus caseRef), as `legalHold.ts:105-107` requires of callers.
- Nothing is written before the throw. Both hold checks run before the first mutation.

### Audit row
`auditFromRequest` (`server/utils/auditLog.ts:114`) → `auditLog()` (:68) → the **`audit_events`** table (`shared/schema.ts:4163`, hash chain via `chainAndInsertAuditEvent`). Action: `AuditActions.DSAR_ERASURE` (`"dsar.erasure"`, :148). Target `{ type: "dsar", id }`; `"dsar"` is already in `AuditTargetType` (:29). Every outcome writes a row: `erased`, `refused_legal_hold`, `SUBJECT_ALREADY_ERASED`, `RETENTION_REQUIRED_LOAN_RECORDS`.

### Idempotency: what state proves a prior erasure
The proof is the **subject's own state**, not the DSAR record. That covers a second DSAR record for the same person and both record systems:
- User: `isUserDeleted(userId)` (`gdprService.ts:251-255`, existing and currently zero-caller). Erased means the email ends in `@gdpr-deleted.invalid`.
- Lead: `isLeadErased(lead)`. Erased means the email is `deleted-${id}@gdpr-deleted.invalid`, the same marker family (`gdprService.ts:216`).

`eraseDsarSubject` checks this **first**. A positive check throws `DsarErasureRefusedError("SUBJECT_ALREADY_ERASED", "This subject was already erased; nothing was changed.")`, which becomes 422.

Ordering consequence: an already-erased user's email no longer matches `requesterEmail`, so the gate's step 5 would refuse first with `DSAR_SUBJECT_MISMATCH`, a less useful name. **Decision:** in step 5, when the email does not match, check the erased marker. If the subject is erased, refuse `SUBJECT_ALREADY_ERASED` instead. This happens for both actions; an export of an erased subject is refused by the same name.

Erasure does **not** set `fulfilledAt`. The founder still closes the record with the existing `/fulfill` (`deliveryMethod: "in_app"`), so the SLA metric (`routes-privacy-dsar.ts:236-239`) keeps one writer.

---

## §4 — Export: a declared per-domain registry

### Shape: two modules (pure declaration plus server execution)
**`shared/privacy/dsarDomains.ts`** (pure, no imports; the declared registry the coverage test reads):
```ts
export type DsarSubjectKind = "user" | "lead";
export type DsarExclusionBasis =
  | "third_party_data"      // rows are other people's personal data / the org's records, not the subject's
  | "no_subject_link"       // schema has no column linking the table to this subject kind
  | "hash_only"             // stores only a one-way hash of an identifier
  | "secret_material";      // credentials/tokens — never exported
export type DsarErasureAction = "anonymize" | "delete" | "retain";

export type DsarDomainDecision =
  | { domain: string; decision: "export"; subjectKind: DsarSubjectKind; tables: readonly string[]; // SQL table names
      scope: string;                                  // one-line description of the WHERE clause
      erasure: { action: DsarErasureAction; reason?: string } }   // reason required when action === "retain"
  | { domain: string; decision: "exclude"; subjectKind: DsarSubjectKind | "both"; tables: readonly string[];
      basis: DsarExclusionBasis; reason: string };

export const DSAR_DOMAINS: readonly DsarDomainDecision[];
/** Named debt register: personal-data candidate tables with NO decision yet. May only shrink. */
export const DSAR_UNDECIDED_TABLES: readonly string[];
```
**`server/services/privacy/dsarExporters.ts`** (execution):
```ts
export const DSAR_EXPORTERS: Record<string /* domain */, (s: DsarSubject) => Promise<unknown[]>>;
export async function buildSubjectExport(subject: DsarSubject): Promise<DsarSubjectExport>;
export interface DsarSubjectExport {
  exportedAt: string;
  subject: { kind: DsarSubjectKind; userId?: string; organizationId?: number; leadId?: number };
  posture: string;                                        // DSAR_IDENTITY_POSTURE.id
  domains: Record<string, unknown[]>;
  totalRecords: Record<string, number>;                   // kept: the generate-export audit reads it (routes-privacy-dsar.ts:182)
  exclusions: Array<{ domain: string; basis: DsarExclusionBasis; reason: string }>;
}
```
`buildSubjectExport` iterates `DSAR_DOMAINS` filtered by `subjectKind`. It runs `DSAR_EXPORTERS[domain]` for every `export` decision and copies every `exclude` decision into `exclusions`, so the requester sees what was not included and why. A missing exporter for a declared `export` domain is a **thrown error**, never an empty array.

**Cap:** keep `MAX_EXPORT_RECORDS = 100_000` (`gdprService.ts:41`). If any domain reaches the cap, **throw the existing `ExportTooLargeError`** (the builder greps `class ExportTooLargeError`; `Errors.internal` maps it by name to 413, `errors.ts:502-505`). Never truncate silently. This follows refuse-not-fabricate.

**Every row is org-filtered for lead subjects:** each lead exporter's WHERE includes `organizationId = subject.organizationId` (or joins through an org-filtered note or conversation id set). This is what the isolation assertion in §5 tests.

### Plugging into the existing pipeline (no fork)
- `exportUserData(userId: string)` (`gdprService.ts:81`) stays the user entry point and becomes `return buildSubjectExport(await resolveUserSubject(userId))`. The old `GdprExportData` type is deleted. Its only consumer is `routes-privacy-dsar.ts:171-182`, which uses `totalRecords`, still present.
- New `exportLeadSubjectData(organizationId, leadId)` in gdprService does the same for leads.
- `generate-export` (`routes-privacy-dsar.ts:151-200`): replace the numeric `userId` parse (:159-163) with the zod `subject` selector (same union as erasure). For one release, also accept the legacy `{ userId: string }` as `{ kind: "user", userId }`. Then call `gateDsarAction(id, selector, "export")`, then `buildSubjectExport(gate.subject)`. Keep the audit action string `"dsar_export_generated"` (:176) unchanged; it may be queried. Add `subject: subjectRef` and `posture` to its metadata, and drop `email`. Filename: `dsar-${id}-${kind}-${userId|org-lead}.json`.

### The domain list (decisions)
**User subjects** (account holders):

| domain | decision | tables | scope / reason | erasure |
|---|---|---|---|---|
| `account_profile` | export | `users` | `id = userId`; drop `password` and any `SECRET_COLUMNS` (`server/utils/secretColumns.ts:175`) entry | anonymize (`anonymizeUser` step 7) |
| `team_memberships` | export | `team_members` | `userId = userId` | retain: "org access record; identifies no one once the account row is anonymized" |
| `team_messages` | export | `team_messages` | `senderId = userId` (current `gdprService.ts:109`) | delete (step 2) |
| `support_tickets` | export | `support_tickets` | `userId = userId` (current :110) | delete (step 3) |
| `ai_conversations` | export | `ai_conversations` | `userId = String(userId)`. **New to the export.** Erasure deletes it (:202-205) but the export never included it. | delete (step 5a) |
| `assigned_records` | **exclude** | `leads`, `deals`, `tasks` | `third_party_data`: "records of other people and the organization's own work that the user was assigned to; the organization is their controller. **Removed from the export** (was `gdprService.ts:106-108`)." | — |
| `properties_user` | **exclude** | `properties` | `no_subject_link`: "properties link to people only through sellerId/buyerId → leads (shared/schema.ts:751-752); no column references a user account" (C-4) | — |

**Lead subjects** (account-less people in one org: sellers, buyers, borrowers):

| domain | decision | tables | scope | erasure |
|---|---|---|---|---|
| `lead_profile` | export | `leads` | `id = leadId AND organizationId = org`. Includes the consent flags. `taxId` ciphertext is replaced by `taxIdOnFile: boolean`. | anonymize (`eraseLeadSubject`) |
| `consent_records` | export | `lead_consent_events` | `leadId AND organizationId` (C-7) | retain: "legal exhibit of consent; append-only by design" |
| `loan_notes` | export | `notes` | `borrowerId = leadId AND organizationId`; drop `accessToken` (portal credential) | retain: S-1 (and erasure is refused if any exist) |
| `loan_payments` | export | `payments` | `organizationId AND noteId ∈ loan_notes ids` (`shared/schema.ts:1183-1202`) | retain: "loan/tax records (S-1)" |
| `properties` | export | `properties` | `organizationId AND (sellerId = leadId OR buyerId = leadId)` (C-4) | retain: "transaction record of the organization" |
| `communications` | export | `lead_activities`, `conversations`, `messages`, `seller_communications`, `inbox_messages`, `borrower_messages` | `leadId AND org` for the first, third and fifth tables. `conversations`: `leadId AND org`. `messages`: `conversationId ∈ those`. `borrower_messages`: `noteId ∈ loan_notes AND orgId`. (Lines: `shared/schema.ts:682,1721,1739,2620`; `comms-email.ts:714`; `deal-lifecycle.ts:598`.) | retain: S-2 |
| `borrower_portal_sessions` | export | `borrower_sessions` | `noteId ∈ loan_notes AND organizationId` (`deal-lifecycle.ts:568`) | retain: S-1 |
| `borrower_payment_profiles` | export | `borrower_payment_profiles` | `leadId AND org`, with `SECRET_COLUMNS` and any token/processor-reference column dropped (`comms-email.ts:429`) | retain: S-1 |
| `email_suppressions` | export | `email_suppressions` | `organizationId AND lower(email) = subject email` (`comms-email.ts:58`) | retain: "must persist to keep honouring the opt-out" |
| `owner_suppressions` | **exclude** | `owner_suppressions` | `hash_only`: "stores a one-way hash per identifier, platform-wide (shared/schema/trust.ts:101); nothing recoverable to export" | — |
| `activity_events` | export | `activity_events` | polymorphic: `organizationId AND entityType = 'lead' AND entityId = leadId`. The builder confirms the literal and the column type at `comms-email.ts:554`. If no `'lead'` literal is ever written, convert this to `exclude / no_subject_link` with that evidence. | retain: S-2 |

Spec minimum check: profile/account fields ✔ (`account_profile`, `lead_profile`); properties ✔ (lead) with an explicit exclusion for users; notes ✔ (`loan_notes`); consent records ✔; communications ✔.

**Equivalence pin (canonical-adoption law):** `eraseDsarSubject`'s report must name exactly the domains whose `erasure.action ∈ {anonymize, delete}` for that subject kind. A unit test pins it (§5), so the registry cannot drift from what erasure actually does.

### How the coverage test enumerates personal-data domains
`tests/unit/dsarDomainCoverage.test.ts` (unit, no DB, import-based; it does **not** scan the repo, so no sweep budget, see §8):
- **Population:** `import * as schema from "@shared/schema"`. Keep every value that `is(v, PgTable)` (drizzle-orm), and read it with `getTableConfig` (`drizzle-orm/pg-core`). Confirm `users` is in the population. If it is not re-exported from `@shared/schema`, also import `@shared/models/auth`. A table is a **personal-data candidate** if any of these holds:
  (a) any column's SQL name satisfies `looksLikePII` (`shared/data-classification.ts:155`, patterns :130-143);
  (b) it has a foreign key to `leads.id` or `users.id`, **or** a column named `lead_id`, `borrower_id` or `user_id`;
  (c) any of its columns is classified `pii` or `sensitive_financial` in `CLASSIFICATION_REGISTRY` (:62-118).
  `CLASSIFICATION_REGISTRY` alone is not enough as a population; it says it is "a risk register, not an exhaustive map" (:58).
  For (b), the plain `created_by`/`updated_by`-style actor FKs to `users` are part of the population too. The builder decides them in bulk with one `exclude / third_party_data` domain per family, or lists them in `DSAR_UNDECIDED_TABLES`. Do not narrow the predicate to make the population small.
- **Assertions:**
  1. Every candidate table appears in some `DSAR_DOMAINS[*].tables` **or** in `DSAR_UNDECIDED_TABLES`. Otherwise fail, naming the table. This is the "new domain with no decision fails" property.
  2. Every `DSAR_UNDECIDED_TABLES` entry is still a candidate and is not also decided. Otherwise fail as stale.
  3. Every table named in `DSAR_DOMAINS` exists in the population (catches renames).
  4. Every `export` domain has an entry in `DSAR_EXPORTERS`, and vice versa. Importing `dsarExporters.ts` pulls in `server/db`; mock `../../server/db` the way other unit tests do (`vi.mock("../../server/db", () => ({ db: {} }))`).
  5. Every `retain` erasure has a non-empty `reason`, and every `exclude` has a `basis` and a `reason`.
  6. **Vacuity floors:** the population size is at least a measured floor (`DSAR_CANDIDATE_FLOOR`), and it contains `users`, `leads`, `notes`, `lead_consent_events`, `properties`, `payments`, `conversations` and `support_tickets` by name.
  7. **Canary (semantic falsification):** run the candidate predicate over a synthetic `pgTable("dsar_canary_table", { id: serial("id"), contactEmail: text("contact_email") })` and over one with `leadId: integer("lead_id").references(() => leads.id)`. Assert both are candidates and both would be reported undecided. Then break each predicate arm in turn in a local variant and confirm the matching canary flips.
- `DSAR_UNDECIDED_TABLES` starts as whatever the builder measures after deciding the domains above. It is a **named list, not a count**, so a new table cannot hide behind one that dropped out.

---

## §5 — LQ-11 drill suite

**File:** `tests/unit/dsarDrill.realdb.test.ts`. Real DB, with the repo's harness exactly as in `tests/unit/bookkeepingContract.realdb.test.ts:11-91`:
```ts
import { realDbAvailable, useRealDb } from "../helpers/realDb";
useRealDb("dsarDrill.realdb.test.ts");                 // module scope, before any server/db import
vi.mock("../../server/utils/logger", …);
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q,_s,n) => n(), requireFounder: (_q,_s,n) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_q,_s,n) => n() }));
describe.runIf(realDbAvailable)("LQ-11 DSAR drill", () => { vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 }); … });
```
It drives the real routes: `express()` + `express.json()` + `registerPrivacyDsarRoutes(app)`, called through `supertest`. The auth mock pattern is from `tests/unit/founderAskTotalIsReal.test.ts:9-36`. It skips without `ACREOS_REAL_DATABASE_URL`, and fails if `ACREOS_REQUIRE_REAL_DB` is set (`tests/helpers/realDb.ts`).

**Fixtures** (synthetic only; `tag = dsar-drill-${Date.now()}-${rand}`; every email is `…+${tag}@example.test`):
- **Org A, Org B, Org H** (`organizations` insert, as in bookkeepingContract :30).
- **Customer-individual (user U):** a `users` row (`email u+tag@…`; the builder checks the required columns at `shared/models/auth.ts:137-225`; no realdb test inserts users yet), `team_members` in Org A, one `team_messages` row, one `support_tickets` row, one `ai_conversations` row. Lifecycle record `R_U_access` (access, verified=true) and `R_U_erase` (erasure, verified=true), with `requesterEmail = U.email`.
- **Borrower subject (lead L_A in Org A):** `email b+tag@…`, a note (`status: "paid_off"`, because "active" trips the ATR gate, see bookkeepingContract :44), 2 payments, 1 `lead_consent_events` row (`channels: ["sms"]`), 1 conversation + 1 message, 1 property with `sellerId = L_A`. **Decoy lead L_B in Org B with the same email**, with its own note, consent event and property. Records `R_B_access` and `R_B_erase` (verified).
- **Non-borrower lead (L_S in Org A):** `email s+tag@…`, no note, 1 consent event, 1 lead activity. Record `R_S_erase` (verified).
- **Held subjects:** user H, a member of Org H, with an active `org_wide` hold (`caseRef: "DRILL-${tag}-ORG"`), and lead L_H in Org A with a `lead_specific` hold (`scopeIds: [String(L_H.id)]`, `caseRef: "DRILL-${tag}-LEAD"`). Verified erasure records for both.
- **Unverified subject:** user V (no hold), records `R_V_access` and `R_V_erase` with `requesterIdentityVerified = false`.

**Assertions:**
1. **Clock adoption (spec 1):** with `clock` frozen, inserting through `enqueueDsar` (call the shim `POST /api/privacy/export` with a stub `req.user.email`, or extend `tests/unit/privacy-dsar-shim.test.ts`) gives `slaDeadlineAt − now === DSAR_CLOCK_HOURS·3_600_000`. The unit version goes in the shim test (§7) so it runs without a DB.
2. **Unverified refusal:** `generate-export` on `R_V_access` and `execute-erasure` on `R_V_erase` both return **422**, `details.reason === "DSAR_NOT_VERIFIED"`. Afterwards `users` row V is byte-identical (re-select and deep-equal).
3. **Verify-identity:** `POST /verify-identity` on `R_V_access` with a too-short `evidenceNote` → 422. A valid call → 200, and the row now has `requesterIdentityVerified === true`. An `audit_events` row exists with `action = "dsar.verified"`, `target_id = R_V_access.id` and `metadata.method`. Re-running export now → 200.
4. **Customer-individual export:** `generate-export` on `R_U_access` with `{subject:{kind:"user",userId:U.id}}` → 200. `domains.account_profile[0].email === U.email`, no `password` key, `team_messages`/`support_tickets`/`ai_conversations` have length 1, `exclusions` names `assigned_records` and `properties_user`, and `totalRecords` equals the domain lengths.
5. **Borrower export (end-to-end):** `generate-export` on `R_B_access` with `{kind:"lead",organizationId:A,leadId:L_A}` → 200. `lead_profile`, `loan_notes`, `loan_payments` (2), `consent_records` (1, `channels` includes `"sms"`), `communications`, and `properties` (1) are all populated. No `accessToken` key anywhere. No `taxId` ciphertext; `taxIdOnFile` is present.
6. **Tenant isolation:** walk the borrower export's JSON recursively. **Every** `organizationId`/`organization_id`/`orgId` value equals A. L_B's id, its note id and its property id appear nowhere (string search over `JSON.stringify`). Do the same over the user-U export: no Org B or Org H id appears.
7. **Subject mismatch:** `generate-export` on `R_B_access` with `{kind:"lead",organizationId:A,leadId:L_S}` → 422 `DSAR_SUBJECT_MISMATCH`.
8. **Type mismatch:** `execute-erasure` on `R_U_access` → 422 `DSAR_TYPE_MISMATCH`.
9. **Borrower erasure (S-1):** `execute-erasure` on `R_B_erase` for L_A → **422** `RETENTION_REQUIRED_LOAN_RECORDS`, `details.noteIds` contains the note id, and L_A is unchanged. The audit row has `outcome = "RETENTION_REQUIRED_LOAN_RECORDS"`.
10. **Legal hold, named:** `execute-erasure` for user H → **423**, `error === "LEGAL_HOLD_ACTIVE"`, `details.caseRef === "DRILL-…-ORG"`, `details.holdId` equals the real hold id (not `"(see legal_holds)"`), and the message contains the caseRef. User H is unchanged. The same for L_H gives 423 with `"DRILL-…-LEAD"`. Both write an audit row with `outcome = "refused_legal_hold"`.
11. **Customer-individual erasure:** `execute-erasure` on `R_U_erase` → 200. `isUserDeleted(U.id) === true`, and the U `team_messages`/`support_tickets`/`ai_conversations` counts are 0. **Org A's other leads and tasks are untouched**: seed one task assigned to U's team member and one lead assigned to them, and assert both are unchanged (pins the C-5 removals). `retained` lists `team_memberships`. `operatorFollowUps` mentions the Clerk identity (S-3). An audit row exists with `dsar.erasure`, `outcome = "erased"`, and **no email** in metadata.
12. **Non-borrower lead erasure:** `execute-erasure` on `R_S_erase` for L_S → 200. `isLeadErased(L_S)` is true, `phone` is null, and `doNotContact` is true. `lead_consent_events` for L_S still has 1 row, unchanged. `retained` includes `consent_records` and `communications`.
13. **Second erasure refused:** re-run 11 and 12 → **422** `SUBJECT_ALREADY_ERASED`. Also re-run 11 through a **new** verified erasure record for the same original email → 422 `SUBJECT_ALREADY_ERASED`, not `DSAR_SUBJECT_MISMATCH` (the §3 ordering decision).

**Cleanup (`afterAll`):** delete in FK order with raw SQL scoped to the fixture org ids and user ids (pattern: bookkeepingContract :78-90): messages → conversations → lead_activities → lead_consent_events → payments → notes → properties → tasks → leads → team_messages → support_tickets → ai_conversations → team_members → legal_holds (release first if a trigger requires it; `onDelete: "restrict"` on org) → dsar_requests_lifecycle (by id) → users → organizations. **Do not delete `audit_events`.** It is an append-only hash chain; leave the drill rows, which are tagged by DSAR id.

**Companion unit tests (no DB):**
- `tests/unit/dsarActionGate.test.ts`: mock `../../server/db` with a scripted select. Cover each refusal reason and order (not-found → not-verified → type → subject-missing → mismatch / already-erased). Assert the gate reads the posture flags: flip `requireOperatorVerification` in a mocked module and watch the not-verified refusal disappear, which proves the posture is the switch and not decoration. Assert the refusal details never contain the subject email.
- `tests/unit/dsarErasureRegistryEquivalence.test.ts`: the report keys of `eraseDsarSubject` (with mocked db) for each subject kind equal the registry's anonymize/delete domains, and `retained` equals the registry's retain domains.

---

## §6 — Founder UI

**Host:** `client/src/pages/founder-compliance-ops.tsx`, DSAR tab (:254-331), mounted at `/founder/compliance-ops` (`App.tsx:483,1315-1317`, `FounderProtectedRoute`). **No new route**, so `FOUNDER_ROUTE_BASELINE = 81` (`tests/unit/founderFourDoors.test.ts:20`) is unchanged and no nav entry is added. (compliance-ops is a legacy top-level `/founder/*` route, not one of the four doors. That is pre-existing and not PKG-1's to move.)

**New component:** `client/src/components/founder/DsarSubjectActions.tsx`. One instance per lifecycle row, rendered in the existing "Action" cell (:307-320) next to "Mark fulfilled". The page diff stays small: import, a "Verified" column, and the component.

**Patterns mirrored:**
- Mutations: `useMutation` + `fetch(…, { method: "POST", credentials: "include", headers: csrf() })` + toast + `queryClient.invalidateQueries({ queryKey: ["/api/founder/dsar/recent"] })`, exactly as `fulfillDsar` (:76-101). Move the page's `csrf()` (:23-26) into the component file or pass it in; do not duplicate it.
- Error bodies: parse `await r.json().catch(() => ({}))` and read `body.details?.reason` and `body.message`, as `VendorMetricForm` does (:564-567). `fulfillDsar`'s `Failed (${status})` would discard the named reason.
- Export download: POST, then `res.blob()`, `URL.createObjectURL`, `a.download = <filename from Content-Disposition or dsar-${id}.json>`, click, revoke. This is the `export-button.tsx:46-59` sequence with a POST body.

**Controls and states:**

| Row state (from `/recent` row + action responses) | Renders |
|---|---|
| `requesterIdentityVerified === false` | A **"Verify identity"** button opens a `Dialog`: method `Select` (options from `DSAR_IDENTITY_POSTURE.acceptedMethods`, imported from `@shared/privacy/dsarIdentityPosture`) and an evidence `Textarea` (with `Label`s; minimum length shown). The posture `statement` is shown verbatim. **Export / Erase are disabled** with visible reason text "Identity not verified — record the check first", tied to the button with `aria-describedby`. |
| verified, `requestType ∈ {access, portability}` | **"Generate export"**: a subject picker dialog fed by `GET /:id/subject-candidates` (radio list: "Account holder" / "Lead in org #N" with a "borrower" badge). Then download. |
| verified, `requestType === "erasure"` | **"Erase subject"**: the same subject picker, then a shadcn `AlertDialog` confirmation that requires typing `ERASE` (sent as `confirm: "ERASE"`). Borrower candidates show "Erasure will be refused — loan records retained (S-1)" before submit. |
| response **423** `LEGAL_HOLD_ACTIVE` | An inline destructive `Alert` (`role="alert"`) in the dialog: "Refused — legal hold **{caseRef}** ({holdId}) in org #{organizationId}." No retry button. |
| response 422 `SUBJECT_ALREADY_ERASED` | A neutral inline state: "Already erased — nothing changed." The candidate list shows `erased` candidates disabled. |
| response 422 `RETENTION_REQUIRED_LOAN_RECORDS` | An inline warning naming the note ids, with an "Export instead" hint. |
| response 422 `DSAR_NOT_VERIFIED` / `DSAR_SUBJECT_MISMATCH` / `DSAR_TYPE_MISMATCH` | The inline message from the server (`body.message`). |
| erase 200 | Toast "Subject erased — audit_events updated". The dialog shows the `retained` list and `operatorFollowUps` (Clerk deletion, S-3) before closing. |

Loading: `Skeleton` in the candidate list. Empty candidates: the `EmptyState` component ("No account or lead matches this requester's email"). Fetch error: `QueryErrorState` with retry. Accessibility: every icon-only button has an `aria-label`, there are visible focus rings (shadcn defaults), and every input has a `Label`. Design tokens only; no hard-coded colours.

---

## §7 — File plan

**Session A: server**

| File | Change |
|---|---|
| `server/routes-gdpr.ts` | Delete `const SLA_HOURS = 24` (:45). Import `DSAR_CLOCK_HOURS` from `@shared/privacy/dsarClock`. Line :60 becomes `new Date(clock.nowMs() + DSAR_CLOCK_HOURS * 60 * 60 * 1000)`, the identical idiom to `routes-privacy-dsar.ts:43`. The `"24h"` copy at :101/104/132/135 is untouched (published copy). Leave `shared/schema.ts:3459` `SLA_HOURS` alone. |
| `shared/privacy/dsarIdentityPosture.ts` | **New.** `DSAR_RECORD_OF_RECORD`, `DSAR_IDENTITY_POSTURE`, `DsarVerificationMethod` (§2). |
| `shared/privacy/dsarDomains.ts` | **New.** `DSAR_DOMAINS`, `DSAR_UNDECIDED_TABLES`, types (§4). |
| `server/services/privacy/dsarActionGate.ts` | **New.** `loadDsarRecord`, `gateDsarAction`, `listDsarSubjectCandidates`, refusal types (§2, §3). |
| `server/services/privacy/dsarExporters.ts` | **New.** `DSAR_EXPORTERS`, `buildSubjectExport`, `DsarSubjectExport` (§4). |
| `server/services/gdprService.ts` | `exportUserData` delegates to the registry, plus `exportLeadSubjectData`. `anonymizeUser`: named hold and steps 4/6 removed. Add `eraseLeadSubject`, `anonymizeLeadContactFields` (private), `isLeadErased`, `eraseDsarSubject` and `DsarErasureRefusedError`. Delete `GdprExportData`. |
| `server/routes-privacy-dsar.ts` | Rewire `generate-export`. Add `verify-identity`, `execute-erasure`, `subject-candidates`, and a local `sendGateRefusal(res, refusal)` that maps to `Errors.*`. Update the header comment's route list. |
| `server/routes-dsar.ts` | Fan-out/erasure 501s go through `Errors.notImplemented`, with a message pointing at the lifecycle routes. Nothing else. |
| `scripts/ratchets/reachability.json` | **Lower** `unreachedExports` (and `internalOnlyExports`, if it applies) by the measured drop: `anonymizeUser` and `isUserDeleted` gain production callers. Run `node scripts/lint-reachability.mjs --measure`; never raise. |
| `tests/unit/purposeLedgerCensus.test.ts` | Register only if the census goes red. The new route keys (`…route:POST /api/founder/dsar/:id/execute-erasure`, `…verify-identity`, `…GET …/subject-candidates`) go beside the existing `generate-export` entry (:759, `"lead_contact_bulk"`). |
| `docs/company/next-moves.md` | Record PKG-1 progress, **S-1**, S-2, S-3, and Q-C1/C2/C3 still open. |

**Session B: tests**

| File | Change |
|---|---|
| `tests/unit/dsarDrill.realdb.test.ts` | **New.** The §5 drill (13 assertions). |
| `tests/unit/dsarDomainCoverage.test.ts` | **New.** The §4 coverage, with vacuity floors and canaries. |
| `tests/unit/dsarActionGate.test.ts` | **New.** Gate refusal order, posture-as-switch, no email in details. |
| `tests/unit/dsarErasureRegistryEquivalence.test.ts` | **New.** Erasure report ≡ registry. |
| `tests/unit/privacy-dsar-shim.test.ts` | **Extend.** Behavioural clock assertion: frozen `clock`, inserted `slaDeadlineAt − now === DSAR_CLOCK_HOURS h`. Optionally add a comment-stripped source check (`tests/helpers/stripComments.ts`) that `routes-gdpr.ts` declares no hour literal for the deadline; the behavioural check is the load-bearing one. |

**Session C: client**

| File | Change |
|---|---|
| `client/src/components/founder/DsarSubjectActions.tsx` | **New.** Verify, export and erase dialogs and the states from §6. |
| `client/src/pages/founder-compliance-ops.tsx` | Add the "Verified" column, mount `DsarSubjectActions` in the Action cell, and share `csrf()`. |
| `tests/unit/dsarSubjectActions.test.tsx` | **New.** Render states: unverified shows disabled buttons plus the reason text. Mocked 423 shows the caseRef. Mocked already-erased shows the refused state. Mocked retention shows the note ids. |

Session order: A → B (B runs against A's real routes) → C (C needs only A's response contract, which §2–§3 fix, so C can run in parallel with B).

---

## §8 — Risks and ratchets

| Fence | Risk | Mitigation |
|---|---|---|
| **Table count 749** (`scripts/ratchets/table-count.json`) | None. No `pgTable(` is added. The coverage test's canary `pgTable` lives in a **test** file; confirm `scripts/ratchet.mjs` globs only `shared/**/*.ts` (it does, per the json). | Do not put the canary in `shared/`. |
| **No new columns** | Verification state uses `requesterIdentityVerified` (exists). Method/evidence/who go to `audit_events`. Erasure state uses the subject's own marker (`@gdpr-deleted.invalid`). | None needed. If a builder finds they "need" a column, that is a STOP: record it, do not add it. |
| **Reachability** (`scripts/lint-reachability.mjs`, baselines `scripts/ratchets/reachability.json:7-13`, down-only; tests do not count as callers, script :225-231) | Every new service export (`gateDsarAction`, `buildSubjectExport`, `eraseDsarSubject`, `eraseLeadSubject`, `exportLeadSubjectData`, `listDsarSubjectCandidates`, `isLeadErased`, `DSAR_EXPORTERS`) must have a **production** caller in a route. The `routes-privacy-dsar.ts` dynamic `await import("./services/gdprService")` (:171) makes the module "opaque" to the gate; switch it to a static import so callers are visible. Wiring `anonymizeUser` and `isUserDeleted` *lowers* the unreached count. | Lower the baseline in the same commit (law 5). No STAGED-SEAM allowlist entries should be needed. If one is, the reason must be ≥20 chars (script :335-353). |
| **Org-scope lint** (`scripts/check-org-scoped-fetch.mjs`) | `listDsarSubjectCandidates` reads `users` and `leads` **across orgs** by email. That is founder-plane by design. Every lead exporter and eraser is org-filtered. | Run the lint. Register the candidate read through the lint's existing founder-plane exemption mechanism with a reason naming the posture. Do not widen any other query. |
| **Purpose-ledger census** (`tests/unit/purposeLedgerCensus.test.ts`, `DEBT_BASELINE = 212` :823) | New routes that read `leads` may count as person-adjacent reads. | Register them as COVERED/LEDGERED beside :759. Do not raise `DEBT_BASELINE`. |
| **Sweep budget** (`tests/helpers/sweepBudget.ts:23`, `REPO_SWEEP_TIMEOUT_MS`) | None of the new tests scan the repo. Coverage is import-based; the gate test is mocked. | If a builder adds any fs walk (e.g. the optional source check in the shim test reads one file, which is not a sweep), a multi-file scan **must** declare `vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS })`. |
| **Date validators** | None added (no date inputs). | If one is added: `isCalendarDate` refine from `@shared/dates/calendar` (`shared/dates/calendar.ts:83`). |
| **Realdb CI wiring** (`tests/unit/realDbTestsRunWhereASchemaIsBuilt.test.ts`) | The new realdb file may need to be picked up by the CI job's glob or list. | Run that test. If it enumerates files, add the drill. |
| **Route ordering** | Founder routes on `/api/founder/dsar/*` are registered by two files (`server/routes.ts:2601` before `:2697`). | Use distinct path names (§1). Add a supertest assertion in the drill that `POST /:id/verify-identity` on a **`dsar_requests`** id returns 404 `DSAR request` (lifecycle lookup) and does not touch `dsar_requests`. |
| **Published copy** | `routes-dsar.ts:165` "within 30 days" and the shim's `"24h"` strings. | Untouched. Only the operator-facing 501 text in `routes-dsar.ts` changes. |
| **No sends** | `operator_email_loop` names a manual founder action. | No mail or SMS import in any new file. The posture text says AcreOS sends nothing. |
| **moneyCustodyHardStop / DEFECT-0101** | Borrower-lead anonymization would change 1099-INT/1098 recipients. | Borrower erasure is refused (S-1). `anonymizeUser` step 6 is removed (C-5). `taxId` is never written. Drill assertion 9 pins it. |
| **Audit PII** | `audit_events` is global and 7-year. | New audit metadata carries subject ids, not emails. Existing intake events (which log email) are unchanged. |
| **`lint:no-fabrication`** | Empty arrays for unimplemented domains would be fabricated "nothing found". | Missing exporter → throw. Over the cap → `ExportTooLargeError` (413). Exclusions are stated in the export itself. |
| **Constitution registry** (`shared/governance/constitution.ts`) | None. No DO-NOT-DO entry changes. Erasure is founder-only, consistent with the "customer-data deletion stays founder-only" hard-stop. | None. |

Observed but **out of scope** (record only): `tests/unit/schemaDrift.allowlist.json:501` lists `subscription_events.requester_identity_verified`, which looks like the wrong table. `dsar_requests_lifecycle.id` is `varchar` in the schema (:5711) but `uuid` in `scripts/migrate.mjs:3405`.

---

## PR-body quotables

- **Posture:** the `DSAR_IDENTITY_POSTURE.statement` string above, verbatim.
- **Record of record:** "Founder export and erasure act on `dsar_requests_lifecycle` records — the table the signed-in privacy page, the founder queue and the overdue cron already use. `dsar_requests` (public `/api/public/dsar`, no client caller) is left in place, and its fan-out/erasure stubs now point here. Which intake is canonical stays counsel's question (Q-C1/Q-C3)."
- **Borrower erasure:** "Borrower erasure is refused by name (`RETENTION_REQUIRED_LOAN_RECORDS`): 1099-INT and 1098 read the borrower's identity from the lead record. The export ships; the erasure rule waits on a founder or counsel ruling (S-1)."
