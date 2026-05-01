# Sam Reyes — Security & Compliance Audit

> Audit window: 2026-05-01. Stack reviewed: Express 4, Drizzle/Postgres, Clerk auth (proxied via acreos.io), Fly.io, Stripe + native e-sign + Twilio + AWS SES.
> Reviewed: `server/auth/clerkAuth.ts`, all 27 files in `server/middleware/`, `server/index.ts`, `server/routes-admin.ts`, `server/routes-leads.ts`, `server/routes-doc-system.ts`, `server/routes-public-sign.ts`, `server/services/signingTokens.ts`, `server/webhookHandlers.ts`, `shared/schema.ts`.
> Verdict: **strong baseline, three real bugs, several SOC2 prerequisites missing.** Real-trust territory is reachable, but not in the next 14 days unless the items in §7 ship.

---

## 1. Top 5 Risks Ranked (Likelihood × Impact)

### R1 — Broken founder check leaks cross-tenant feature requests (HIGH × HIGH)
**`server/routes-admin.ts:465` and `:485`**
```ts
if (org.ownerId !== (user.claims?.sub || user.id)) {
  return res.status(403).json({ error: "Founder access required" });
}
```
This passes for **every org owner**, not the founder. Any customer who owns their own org (i.e. all of them) calls `GET /api/founder/feature-requests` and gets `storage.getAllFeatureRequestsForFounder()` — unfiltered, cross-tenant. Same bug on `PATCH /api/founder/feature-requests/:id`. Mutations there will succeed for any owner.
The correct guard exists 180 lines below (`isFounderAdmin` at `routes-admin.ts:642`); these two endpoints just don't use it. **Fix: replace the inline check with `isFounderAdmin`.**

### R2 — Signed documents are mutable (HIGH × HIGH for legal exposure)
**`server/routes-doc-system.ts:725-753`**
`PUT /api/generated-documents/:id` accepts arbitrary `name`, `content`, `status`, `signers` updates. There is **no check that `existing.status !== 'signed'`**. After ESIGN-Act-binding signatures are captured (via `routes-public-sign.ts`), an org user with the right role can overwrite `content` and the document of record changes — destroying the chain of evidence. Signatures stored in `signatures` table still reference the old content hash conceptually, but no content hash is ever computed or stored (see R5). This breaks UETA §12 and ESIGN §101(d) document-integrity requirements.

### R3 — Skip-trace results stored unencrypted in JSONB (HIGH × HIGH)
**`shared/schema.ts:4531-4560` (`skip_traces.results`)**
The `results` field is `jsonb` containing owner phones, emails, addresses, employer, relatives. The encryption helper `encryptContactRecord` at `server/middleware/fieldEncryption.ts:264` only covers `ssn, taxId, bankAccountNumber, routingNumber, creditScore` — phone-laden skip-trace JSON is **not on the list**. A `pg_dump` from a leaked replica or any read-only DB credential = full dossier on every property owner the customer ever traced. This is the single highest-trust dataset in AcreOS and it is at-rest plaintext.

### R4 — `req.session` referenced for 2FA but no session middleware mounted (MEDIUM × HIGH)
**`server/middleware/require2FA.ts:31`**, `server/index.ts` (no `express-session` import)
`require2FA` checks `(req as any).session?.twoFactorVerified === true`. Auth is Clerk-only (no express-session). On the live admin route mount `app.use("/api/admin", isAuthenticated, require2FA)` (`server/routes.ts:1625`), this expression is always `undefined`, so the middleware then falls through to the DB check and **returns 428 only if `users.twoFactorEnabled === true`**. Net result: founder can opt into 2FA, but every admin request will 428 forever — no path to set `twoFactorVerified`. In practice 2FA is non-functional.

### R5 — Public e-sign tokens never expire on their own (MEDIUM × HIGH)
**`server/services/signingTokens.ts:23` ("Token does NOT expire on its own")**
HMAC-SHA256 of `{docId}:{signerId}` with `SESSION_SECRET`. If `SESSION_SECRET` is ever rotated, every outstanding signing link breaks (acceptable). But: a leaked email forward, a screen-shared inbox, or a compromised mailbox six months later still produces a valid-looking signing URL until the document's `expiresAt` (default 30 days). There is also **no IP rate-limit** on `/api/public/sign/:docId` — `routes-public-sign.ts:23,93` are registered before the `/api` rate limiter and have no dedicated bucket. A signing URL is a credential; it should rate-limit and short-expire.

---

## 2. Multi-Tenant Data Isolation Review

**Verdict: solid for the storage layer, mostly enforced at the route layer, with two structural risks.**

- Storage primitives are uniformly org-scoped: `storage.getLead(orgId, id)` / `getProperty(orgId, id)` / `getGeneratedDocument(org.id, id)` etc. — see `server/storage.ts:1311, 1618, 5643`. Every multi-row query I sampled `WHERE`s on `organizationId`. The pattern is consistent.
- 37/37 mutation routes in `routes-leads.ts` go through `isAuthenticated, getOrCreateOrg`. Sample audit endpoint `PUT /api/leads/:id` (`routes-leads.ts:396`) correctly fetches `existingLead = storage.getLead(org.id, leadId)` before update.
- **Cross-org guard exists but is used inconsistently:** `crossOrgAdminGuard` at `routes-admin.ts:664` validates that URL-path `:orgId` matches authed org. I could not find a usage of it in `routes-admin.ts`. Routes that take `:orgId` in the path should mount it explicitly; today they rely on storage-layer scoping which works only if every handler remembers to pass `org.id`.
- **`updateGeneratedDocument` org-scoping is optional (`storage.ts:5643`):** the `organizationId` parameter is `?` and the route handlers in `routes-doc-system.ts:741, 810, 918, 979` **don't pass it**. The handler does fetch `getGeneratedDocument(org.id, id)` first, but the update itself can target any document by id. A TOCTOU race or any future handler that skips the read can update across tenants. **Make `organizationId` mandatory.**
- `getOrCreateOrg` (`server/middleware/getOrCreateOrg.ts:31`) auto-creates a personal org if a logged-in user has none. Combined with `req.organization` being set everywhere, isolation works. The fail-open default means any auth bypass = any-org access; this is fine **only as long as auth itself is sound**.

---

## 3. Sensitive-Data Inventory

| Data | Table / Column | At-rest protection | Notes |
|---|---|---|---|
| Email/phone (lead) | `leads` columns | **plaintext** | Indexed; needed for dedupe. PII masking applies to logs only. |
| SSN, tax ID, bank acct | `leads`, `borrowers` | AES-256-GCM via `encryptContactRecord` | `fieldEncryption.ts:239`. ✓ |
| Credit score | encrypted | ✓ | `LAND_SENSITIVE_FIELDS` |
| **Skip-trace dossier** | `skip_traces.results` (jsonb) | **plaintext** | R3. Phones, relatives, employer. **Highest-risk gap.** |
| Owner contact (property) | `properties` (assumed plaintext, schema not re-read) | plaintext | Same exposure class as leads. |
| Signature image | `signatures.signature_data` (base64 PNG) | plaintext | Acceptable — image of a signature is not a credential. IP/UA captured ✓. |
| Document content | `generated_documents.content` | plaintext | Mutable post-sign — see R2. |
| Stripe customer/sub IDs | `organizations.stripe*` | plaintext | These are non-secret references, fine. |
| Conversation/inbox bodies | `conversations`, `inbox_messages` | plaintext | Consider encrypting `message_body` for SMS replies that include phone numbers. |
| Session tokens | Clerk-managed | external (Clerk) | ✓ |
| HMAC secrets | env (`SESSION_SECRET`, `DOCUMENT_SIGNING_SECRET`, `INBOUND_EMAIL_HMAC_SECRET`, `CERT_SECRET`) | Fly secrets | `secretsValidation.ts:65-68` ≥32 chars enforced in prod. ✓ |
| `FIELD_ENCRYPTION_KEY` | env (32 bytes hex) | Fly secrets | `secretsValidation.ts:33` warns-only in prod (`required: false`). **Should be `required: true`.** |

**PII in logs:** `installConsoleInterceptor()` (`server/index.ts:42`, `piiMasking.ts`) regex-masks phone/email/SSN/CC in any string written via console. Solid baseline. Caveats: structured `logger.info("...", { metadata: { phone } })` flows through the structured logger which doesn't apply `maskString` to object values — verify this is wrapped, otherwise fields remain unmasked.

---

## 4. Audit-Log Gap

The `audit_log` table (`shared/schema.ts:4149-4165`) is well-shaped (entityType, entityId, before/after, ip, ua, metadata). Wiring is partial:

**Logged today (verified):**
- `PUT /api/leads/:id` — `routes-leads.ts:409-418` writes a full before/after diff. ✓
- Lead delete (soft) is presumably similar (didn't re-read).

**Gaps I can confirm by absence:**
- **Login / logout events** — Clerk holds these out-of-band. AcreOS has no record of "who logged in from what IP at what time." For SOC2 CC6.1 you need them in `audit_log`. Hook `hydrateUser` (`clerkAuth.ts:54-105`) to write a `login` row on first session per day.
- **Role changes / team-member add-remove** — `teamMembers` mutations have no visible audit calls in the storage layer.
- **Founder-admin actions** — `isFounderAdmin` routes (revenue, set-founder, alerts ack/resolve) do not write audit rows. `POST /api/admin/set-founder` (`routes-admin.ts:929`) flips `organizations.isFounder` with no audit row.
- **Document signed events** — `routes-public-sign.ts:133` creates the signature row but no `audit_log` entry. ESIGN compliance is met by the `signatures` row itself, but for forensics you want a unified action log.
- **Mailer / outbound SMS dispatch** — every cost-bearing customer-facing send should log to audit.
- **Permission denials** — 403s should be auditable to detect probing.
- **Tamper-evidence** — `audit_log` is a plain pgtable. No hash chain, no append-only constraint. SOC2 will accept this if combined with restricted DB credentials + WAL backup, but the row is overwritable today by anyone with DB access. Consider `REVOKE UPDATE, DELETE` on the table from the app role.

---

## 5. E-Sign Legal Compliance (ESIGN Act + UETA)

**What's already done well:**
- Consent text captured per signature, default text states binding effect (`routes-public-sign.ts:144-145`, `routes-doc-system.ts:780`).
- IP + user-agent stored on `signatures` (`schema.ts:4825-4826`). ✓
- Signed-at timestamp stored. ✓
- Per-signer HMAC token (`signingTokens.ts`) with timing-safe compare. ✓
- Token bound to `(docId, signerId)` so re-issuing rotates. ✓
- 410 Gone after `expiresAt` (`routes-public-sign.ts:60-62`). ✓

**What's missing / weak:**
- **Document immutability after sign** — R2. Critical. Without it, ESIGN §101(d)(1) "accuracy and accessibility" of the record cannot be attested.
- **Content hash at signing time** — no SHA-256 of `content` is stored on the signature row. Add `signatures.documentContentHash` so post-hoc tampering is detectable.
- **Identity attestation step missing** — neither flow asks the signer to confirm name/email match the link before drawing. Best-practice flows show "You are signing as <Name>, <Email> — confirm to proceed." This is what survives a "that wasn't me" challenge.
- **No record of the email that delivered the signing URL.** If you're sued, you need to prove the URL went to the email of record. Hook the dispatch path to write to audit.
- **No reasonable verification of signer identity** — UETA §9 requires a process "reasonably designed to verify identity." A bare HMAC + email link is the floor. For real-estate transactions some states (e.g. NY RPL §309) require notarization, which AcreOS does not handle. Add a state-aware capability check before allowing self-sign on deeds.
- **Token has no per-token expiry** — R5. Add a `tokenIssuedAt` to the HMAC payload (sign `{docId}:{signerId}:{iat}`) and reject tokens where `now - iat > 14d`.
- **Signed document download/PDF archive** — I didn't see a path that stamps a final tamper-evident PDF (with embedded signatures + audit trail) and pins it in object storage. Without this, the "completion certificate" courts ask for is computed on-the-fly, not archival.

**Net:** Today's stack would survive a low-stakes consumer dispute. It would not survive a real-estate-deal contested signing without R2 + content-hash + delivery-audit fixes.

---

## 6. SOC2 Prep Readiness

| Control | Status | Evidence file:line |
|---|---|---|
| CC6.1 Logical access — auth | ✓ Clerk-managed | `clerkAuth.ts:117` |
| CC6.1 — MFA available | partial | `routes-2fa.ts`, `require2FA.ts` — **non-functional, see R4** |
| CC6.1 — Account lockout / brute force | partial | `authLimiter` 20/15min `index.ts:284`. No per-account lockout. |
| CC6.1 — Session timeout | partial | 30s grace on JWT skew (`clerkAuth.ts:40`); actual session lifetime is Clerk-config — verify it's ≤24h. |
| CC6.6 — Encryption in transit | ✓ | HSTS preload (`security.ts:66`), upgrade-insecure-requests in prod CSP. |
| CC6.7 — Encryption at rest | partial | Field encryption for SSN/credit only. Skip-trace plaintext (R3). DB-level rest encryption depends on Fly.io Postgres config — verify. |
| CC6.8 — Audit logs | partial | Table exists; coverage gaps in §4. Not tamper-evident. |
| CC7.1 — Vulnerability management | unverified | No CI SAST step visible. Recommend `npm audit --omit=dev` gate + Snyk. |
| CC7.2 — Anomaly detection | partial | Sentry + rate-limit-hit alerting (`rateLimit.ts:14-33`). No SIEM integration. |
| CC7.3 — Security incident response | not started | No runbook in repo. |
| CC8.1 — Change management | partial | Git + PRs; no formal approval gates. |
| C1.1 — Confidentiality (data classification) | not started | No data-classification matrix. §3 above can seed one. |
| P3.2 — Notice/consent (CCPA/GDPR) | unverified | No `/api/privacy/data-export` or `/api/privacy/data-delete` endpoint visible. Schema has `audit_log.action` literal `'export'` (`schema.ts:4199`) but no implementation grep'd. |
| P4.2 — Data deletion | partial | Soft-delete (`deletedAt`) on leads. No documented hard-delete-after-N-days job. |
| Sub-processor list | not started | `users.md` notes processors (Clerk, Fly, Cloudflare, Stripe, Twilio, AWS SES, OpenRouter); no public DPA list. |
| Breach-notification SLA | not started | No documented 72h GDPR / state-AG notification process. |

**Bottom line:** AcreOS is at "Tier 1 startup baseline" — Clerk + helmet-equivalent + Stripe webhooks correct + audit table + field encryption. To get a SOC2 Type 1 in 90 days, the gating items are: (a) functional MFA (R4), (b) full audit-log coverage (§4), (c) sub-processor list + DPAs, (d) IR runbook + 1 tabletop exercise, (e) data-deletion + export endpoints.

---

## 7. Pre-Launch Security Hardening Sprint (10 items, 2–3 weeks)

Order is dependency-first. Each item carries a reviewer.

1. **Fix R1: replace inline founder checks with `isFounderAdmin`** — `routes-admin.ts:465, :485`. 1 hr. Ship with a regression test that calls `/api/founder/feature-requests` as a non-founder org owner and asserts 403.
2. **Fix R2: enforce document immutability after sign** — in `storage.updateGeneratedDocument` (`storage.ts:5643`), reject mutations to `content` when `existing.status === 'signed'`. Add `documentContentHash` (sha256) to the `signatures` table and persist at sign time. 1 day.
3. **Fix R4: make 2FA functional** — pick one: (a) flip to Clerk's native MFA flow and remove `routes-2fa.ts` + `require2FA`; (b) wire `express-session` and persist `twoFactorVerified`. (a) is faster and aligns with the rest of the auth stack. 1 day.
4. **Fix R3: encrypt skip-trace results** — add `skip_traces.results` to a `SKIP_TRACE_SENSITIVE_FIELDS` list in `fieldEncryption.ts`; encrypt before insert in the skip-trace service; ship a one-shot migration job to re-encrypt existing rows. 2 days incl. backfill.
5. **Make `FIELD_ENCRYPTION_KEY` required in production** — `secretsValidation.ts:33` flip `required: true` (gated on `productionOnly`). Verify Fly secret set. 30 min.
6. **Tighten public-sign endpoint** — add per-IP + per-token rate limit (10/min/IP, 5/min/token); add `iat` to HMAC payload with 14-day max; add identity-confirmation step before sign. `routes-public-sign.ts`, `services/signingTokens.ts`. 1 day.
7. **Audit-log fan-out** — write `audit_log` rows for: login (in `hydrateUser`), team-role change, founder-admin mutation, document signed, mailer dispatched, permission denied. `clerkAuth.ts`, `routes-admin.ts`, `routes-public-sign.ts`. 2 days.
8. **Lock down `audit_log` writes** — DB migration `REVOKE UPDATE, DELETE ON audit_log FROM acreos_app` and create a separate `acreos_dba` role for compliance access. Document the chain-of-custody. 0.5 day.
9. **Make `updateGeneratedDocument` org-scope mandatory** — `storage.ts:5643` change `organizationId?:` to required; update 4 callers in `routes-doc-system.ts`. Apply same pattern to any other `update*(id, updates, organizationId?)` storage helpers. 0.5 day.
10. **Privacy endpoints + sub-processor page** — implement `POST /api/privacy/data-export` (zip of all org-scoped rows) and `POST /api/privacy/data-delete` (soft-delete + 30d hard-delete cron); publish `acreos.io/legal/sub-processors`. Required for CCPA right-to-know + GDPR Art. 30. 2 days.

**Reviewer rotation:** R1+R2+R3 reviewed by Sam directly. R4+5+6 reviewed by whoever owns auth. 7+8 reviewed by whoever owns ops/DBA. 9+10 reviewed by whoever owns the API surface.

---

## Closing Note

The team has done the boring-but-correct things — helmet-equivalent CSP with per-request nonce, HSTS preload, double-submit CSRF with documented mount-prefix gotcha, Stripe `constructEvent` + idempotency claim, AES-256-GCM with auth tag, secret-validation at boot, field-encryption key rotation helper, structured logger + console-interceptor PII masking. That foundation is real.

The bugs above are concentrated in the gap between "auth works" and "auth-aware features work." R1 (broken founder check) and R4 (non-functional 2FA) are the kind of bugs that ship because the test for them was never written. Before any meaningful customer trust is at stake, the sprint in §7 needs to land **and** an external pen-test against the public sign flow + admin surface needs to come back clean. Without those two, the story we tell prospects ("we're not Land Geek; we're built for the Land Investor") is technically true but legally fragile.
