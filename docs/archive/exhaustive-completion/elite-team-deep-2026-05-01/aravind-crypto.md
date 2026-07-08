# Cryptography Audit — AcreOS, Pre-100 Customers

**Author:** Aravind Iyer, Cryptography Lead (ex-Cloudflare crypto, ex-Let's Encrypt CT log infra)
**Date:** 2026-05-01
**Lens:** "Most teams use crypto wrong in subtle ways — wrong AEAD, predictable nonces, key rotation that's documented but never run. The library calls compile; the protocol leaks."
**Cross-refs:** Sam (security) confirmed AES-256-GCM field encryption + flagged R3 (skip-trace plaintext). I read every `crypto.*` callsite in `server/`, both encryption modules, both HMAC token paths, the TOTP implementation, the webhook dispatcher, and the rotation script. This is not a duplicate of Sam's review — Sam audited *what is gated*; I audit *whether the gates are mathematically sound*.

---

## 1. One-line verdict

The crypto primitives are correct (AES-256-GCM with random 96-bit nonces, HMAC-SHA256 with `timingSafeEqual`, scrypt for credential KDF), **but there are two parallel encryption modules with two different master keys and two different wire formats, no expiry on signing tokens, the rotation script only covers 2 of ~7 encrypted-bearing tables, and `SESSION_SECRET` triple-purposes as session, e-sign, and (effectively) document-token secret — one leak compromises all three trust domains.**

---

## 2. Encryption-at-rest matrix — what's encrypted, what should be

I traced every encrypted column actually used and every `encryptFields()` callsite. Here is the ground truth.

### 2.1 Encrypted today

| Surface | Module | Algorithm | Key env var | Wire format | Notes |
|---|---|---|---|---|---|
| `landCreditScores.scoreData / creditScore` | `middleware/fieldEncryption.ts` | AES-256-GCM | `FIELD_ENCRYPTION_KEY` | `enc:v1:{base64(JSON{v,iv,tag,ct})}` | Versioned. Good. |
| `portfolioSimulations.simulationData / results` | same | same | same | same | Covered by rotation script. |
| `LAND_SENSITIVE_FIELDS` (creditScore, landCreditScore, financialProjections, cashflowModel, internalNotes) | same | same | same | same | Helpers exist; usage not enforced at the schema/storage layer. |
| `CONTACT_SENSITIVE_FIELDS` (ssn, taxId, bankAccountNumber, routingNumber, creditScore) | same | same | same | same | Same caveat — opt-in helpers, no schema-level guardrail. |
| `organizationIntegrations.credentials` (Stripe/Twilio/Mapbox API keys, OAuth tokens) | `services/encryption.ts` | AES-256-GCM with **scrypt-derived** per-record key | `ENCRYPTION_KEY` | `salt:iv:tag:ct` (v2) or `iv:tag:ct` (v1 legacy with org-id-derived salt) | **Different module, different key, different format** — see §3.1. |
| `users.twoFactorSecret` | encrypted via field encryption (per twoFactorAuth.ts:21 docstring) | AES-256-GCM | `FIELD_ENCRYPTION_KEY` | enc:v1: | Backup codes stored as scrypt(code, salt) with 64-byte hash. |

### 2.2 NOT encrypted but should be (severity-ordered)

| Severity | Surface | Why it's PII/sensitive | Why it's not encrypted today |
|---|---|---|---|
| **R3 (Sam)** | `skip_traces.results` (jsonb) | Phone numbers, emails, addresses, **relatives**, employer, age range — every field a stalker would want | Not in `CONTACT_SENSITIVE_FIELDS`; column type is jsonb not text, so the existing string-based helpers don't fit |
| **P0** | `skip_traces.input_data` (jsonb) | Owner name + mailing address — same threat surface as results | Same |
| **P0** | `leads.email`, `leads.phone`, `leads.firstName`, `leads.lastName`, `leads.address` | This IS the CRM. Every record in production is PII. | Querying these (search, dedup, autocomplete) requires plaintext or deterministic encryption. Field-level random-IV encryption breaks those queries. |
| **P1** | `notes.borrowerSsn`, `notes.borrowerDob`, `notes.borrowerAddress` (loan servicing) | NPI under GLBA | Not in helpers list; manual `encryptFields` call required |
| **P1** | `borrowerSessions.email`, `.ipAddress`, `.userAgent` | Session telemetry | Low value but trivially encryptable |
| **P2** | `notes.accessToken` | Capability token — equivalent to a password for the borrower portal | Stored plaintext as random hex. Should be **hashed** (see §5.2), not encrypted. |
| **P2** | `audit_log` payloads / `activity_log` details | Often contain PII echoed from request bodies | Append-only, very high volume; encryption blows up storage and breaks the search use case |
| **P3** | `ai_conversations` message content | May contain seller financials, deal terms | Not encrypted; OpenAI/OpenRouter sees plaintext anyway |

### 2.3 Recommendation: three encryption tiers, not one

The current model — "if it's sensitive, throw it through `encrypt()`" — fails at scale because random-IV AES-GCM is non-deterministic and breaks equality lookups. You need three tiers:

| Tier | Algorithm | Use for | Key |
|---|---|---|---|
| **T1 random-IV AEAD** (current `fieldEncryption.ts`) | AES-256-GCM, fresh nonce per encrypt | Display-only fields (SSN, bank acct, internal notes, skip-trace results, financial projections) | `FIELD_ENCRYPTION_KEY` |
| **T2 deterministic encryption** (NEW) | AES-256-SIV (RFC 5297) — use the `miscreant` npm package, or HMAC-SHA256(key, plaintext) → first 16 bytes as nonce, then AES-GCM | Searchable PII: `leads.email`, `leads.phone` — equality lookup still works because identical plaintexts produce identical ciphertexts | A SEPARATE deterministic key, never reused for T1 |
| **T3 hashed-only** | HMAC-SHA256 or BLAKE3 with a peppered key | Capability tokens (`notes.accessToken`, API keys, password reset tokens) — never need to be reversed | `TOKEN_PEPPER` |

Without T2 you cannot encrypt the lead/borrower base columns. With it, you can.

---

## 3. Key management audit

### 3.1 The two-encryption-module problem

You have two independently-evolved AES-256-GCM modules:

```
server/middleware/fieldEncryption.ts → uses FIELD_ENCRYPTION_KEY (raw 32-byte key, hex)
server/services/encryption.ts        → uses ENCRYPTION_KEY (UTF-8 string, scrypt-KDF'd to 32 bytes)
```

Both call themselves "the" encryption module in their own docstrings. They produce incompatible wire formats. The rotation script in `server/scripts/rotateEncryptionKey.ts` covers `landCreditScores` and `portfolioSimulations` — i.e., only the `fieldEncryption.ts` users. **Rotating `ENCRYPTION_KEY` (which protects every Stripe/Twilio/OAuth credential in `organizationIntegrations.credentials`) has no script and would silently break every paid integration.** This is the #1 finding in this audit.

**Fix:** Pick one module. I recommend keeping `fieldEncryption.ts` (cleaner, versioned, no per-record scrypt — scrypt every read is gratuitously expensive when you already have a 256-bit master key) and migrating `services/encryption.ts` callsites to it. Then there is one key, one rotation procedure, one wire format.

### 3.2 Where keys live

- `FIELD_ENCRYPTION_KEY`, `ENCRYPTION_KEY`, `SESSION_SECRET`, `DOCUMENT_SIGNING_SECRET`, `CERT_SECRET`, `INBOUND_EMAIL_HMAC_SECRET` — all in **Fly secrets** (`fly secrets set …`, confirmed in `docs/deployment-checklist.md:35-42`).
- Fly secrets are encrypted at rest in HashiCorp Vault and surface as env vars to the running machine. That's fine. Sufficient for pre-100-customer scale.
- `secretsValidation.ts` enforces presence + minimum length at startup. Good.

### 3.3 What's missing

| Gap | Severity | Fix |
|---|---|---|
| **No declared rotation cadence.** The rotation script exists; no calendar entry, no cron, no audit record of last rotation. | P1 | Annual rotation. Document last-rotated date in a SECURITY.md or in `docs/deployment-checklist.md`. Set a recurring calendar reminder; better still, a one-time-agent (the schedule skill in this repo). |
| **No key derivation per environment.** Same `FIELD_ENCRYPTION_KEY` shape in dev vs staging vs prod. | P2 | Use HKDF: master key + env label → derived key. Then a leaked staging dump can't decrypt prod data even if an admin cross-pasted. |
| **Dev fallback key (`Buffer.alloc(32, 0x42)`) is silently activated** in non-production when env var missing. | P3 | OK because production blocks at startup. But a developer who copies a prod DB dump into local-dev *and runs the app* will see decryption failures masquerading as bugs. Add a loud `logger.warn` once per process. |
| **No envelope encryption.** Every record uses the master key directly. | P2 (P0 at 10k+ orgs) | Adopt envelope encryption: per-org DEK encrypted by the master KEK. Lets you "delete" an org's data by destroying its DEK without rewriting rows. Standard at scale; not urgent at <100 customers but bake it in before the schema is too entrenched. |

### 3.4 Recommended rotation procedure (post-merge of the two modules)

1. Generate new key. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Add as `FIELD_ENCRYPTION_KEY_NEXT` in Fly secrets.
3. Deploy a build that reads `_NEXT` and tries it as a fallback during decrypt (dual-key window).
4. Run the rotation script (must be extended to cover *all* tables — see §3.1).
5. Promote `_NEXT` → `FIELD_ENCRYPTION_KEY`. Remove `_NEXT`.
6. Deploy.

This is zero-downtime. The current single-key procedure requires a maintenance window.

---

## 4. Nonce/IV correctness review (AES-GCM)

This is the classic place AEADs go wrong. Let me trace it.

### 4.1 `middleware/fieldEncryption.ts`

```ts
const iv = crypto.randomBytes(IV_BYTES);   // IV_BYTES = 12 → 96-bit nonce
```

- 96 bits of `crypto.randomBytes` → ~1 in 2⁴⁸ collision probability after 2²⁴ encryptions per key. Safe up to ~16 million encryptions per key. AcreOS has < 100 customers; this is fine for years.
- Nonce is fresh per encryption (NOT counter-based). Good. NIST SP 800-38D specifically warns against counter-based IVs across processes you don't synchronize — this code dodges that trap.
- Auth tag is 128 bits (default). Good.
- Tag is verified via `setAuthTag` before `decipher.final()`. Good — Node's GCM throws on tag mismatch.
- Plaintext never leaks on tag failure (`try/catch` returns a generic error). Good.

**Verdict: cryptographically correct.**

### 4.2 `services/encryption.ts`

```ts
const salt = crypto.randomBytes(SALT_LENGTH);  // 32 bytes
const key = crypto.scryptSync(getMasterKey(), salt, 32);
const iv = crypto.randomBytes(IV_LENGTH);      // IV_LENGTH = 16 ← !
```

Two issues:

1. **IV is 16 bytes (128 bits) for GCM.** Node accepts this without error, but NIST SP 800-38D **strongly recommends** 96-bit IVs for GCM because anything else triggers an internal GHASH-based derivation that (a) has no security benefit and (b) increases collision probability on long IVs. This isn't broken, but it's non-canonical and any external auditor will flag it. Match `fieldEncryption.ts` at 12 bytes.
2. **Per-record scrypt KDF on every encrypt and decrypt.** scrypt with default Node params takes ~50–100 ms per call. Decrypting one organization's integration credentials list (Stripe + Twilio + Mapbox + …) is a sub-second hidden cost on a hot path. The master key is already 256 bits — scrypt adds zero security here, only latency. The legitimate use of scrypt is *password*-derived KDFs; you have a high-entropy master key. **Drop scrypt; use the master key directly with a random salt as additional context** (HKDF-Expand if you want clean separation, or just `master_key XOR HKDF(master_key, "context")`).

**Verdict: non-canonical IV size + gratuitous scrypt KDF. Functionally secure, structurally wrong.**

### 4.3 IV reuse across processes

Both modules generate IVs from `crypto.randomBytes()` — the kernel CSPRNG, which is process-independent and seeded per machine. No sharing required. No "two app servers picked the same IV" risk. Good.

---

## 5. Token + HMAC review

### 5.1 E-sign signing tokens (`services/signingTokens.ts`)

```ts
HMAC-SHA256(SESSION_SECRET, `${docId}:${signerId}`)
```

| Property | Verdict |
|---|---|
| Algorithm | HMAC-SHA256. Good. |
| Constant-time compare | `crypto.timingSafeEqual` after length check. Good. |
| Replay protection | **None.** Same docId+signerId always produces the same token. |
| Expiry | Documented as "scoped to docId+signerId, rotated when document re-dispatched, doc has its own `expiresAt`." That works *if* the doc actually checks `expiresAt`. Trust but verify. |
| Token-as-URL-param | Yes (`?t=…`). Browser referer headers, server logs, analytics, partner CDN logs all see this token. Standard signed-URL hazard. |
| Single-use | No. The same URL works until docId is rotated or the document expires. |
| Secret reuse | **`SESSION_SECRET` is the same secret used for express-session signing.** A leaked session-cookie secret also forges signing URLs. |

**Findings:**

1. **P1: Use a dedicated secret.** Add `ESIGN_SIGNING_SECRET` to `secretsValidation.ts`. Trust-domain separation matters — session cookies and external-signer capability tokens have different lifetimes, different blast radii, different rotation cadences.
2. **P1: Add a TTL claim into the signed payload.** Sign `${docId}:${signerId}:${expEpoch}`, encode the exp into the URL alongside the token, verify on read. Defense-in-depth even if `documents.expiresAt` is correctly checked.
3. **P2: Single-use token.** Insert a `signing_token_uses` row at first-render; reject re-use. Mitigates the "URL captured in logs, attacker replays after legitimate signer signs" scenario.

### 5.2 Borrower portal access tokens

`notes.accessToken` is generated once at note creation: `note_${Date.now()}_${random36}` and stored in plaintext.

| Issue | Severity |
|---|---|
| `Date.now()` in the token reveals creation time → reduces effective entropy from ~62 bits to ~25 bits (the random suffix). | **P0** |
| Stored plaintext in DB. A read replica leak or backup theft hands an attacker valid borrower-portal credentials. | **P0** |
| No rotation, no expiry. Issued forever. | P1 |

**Fix:**
1. Generate as `crypto.randomBytes(32).toString("base64url")` — 256 bits of entropy, no timestamp.
2. Store **HMAC-SHA256(`TOKEN_PEPPER`, token)** in the column, not the token itself. Look up by computing the HMAC of the incoming token. The pepper is a Fly secret, not in the DB.
3. Add `accessTokenIssuedAt` + a configurable max age (default 1 year). Re-issue on demand.

### 5.3 Borrower session tokens (`routes-borrower.ts`)

```ts
const sessionToken = crypto.randomBytes(32).toString("hex");
// stored plaintext in borrower_sessions.session_token
// cookie httpOnly, secure (prod), sameSite strict, 24h
```

- Entropy: 256 bits. Good.
- Cookie flags: correct.
- Plaintext storage in DB: same hazard as 5.2 — a DB read leaks all live sessions. **Fix:** store HMAC of the token, not the token itself. Same pattern as Rails' `has_secure_token`.

### 5.4 Outbound webhooks (`services/webhookDispatcher.ts`)

| Property | Verdict |
|---|---|
| Signature | `sha256=<hex(HMAC-SHA256(secret, body))>` — Stripe-compatible format. Good. |
| Per-org secret | Yes — stored in `organizationIntegrations.credentials.endpoints[].secret`. Good. |
| **Timestamped signing** | **No.** Replay window is unbounded. An attacker who captures one delivery can replay it forever. |
| **TLS verification** | Default Node `fetch` — verifies CA, doesn't pin. Acceptable. |
| **HTTPS-only enforcement** | **No check.** Endpoints can be `http://`. Body + signature visible to any on-path attacker. |
| **SSRF prevention** | **No check.** Endpoint URL is operator-supplied; attacker who phishes an admin can register `http://169.254.169.254/latest/meta-data/` and read AWS IMDSv1 metadata if Fly has any (it doesn't, but the principle holds). |
| Retry idempotency | Has retry; no idempotency key sent — receivers can't dedupe. |
| 10s timeout | Good. |

**Fix:**
1. Sign `t={epochSeconds}.{body}`, send timestamp in `X-AcreOS-Timestamp`, document a 5-minute window for receivers to enforce. Already done by `developerApiService.ts:174` — unify these two.
2. Validate URL on save: must be `https://`, must not resolve to a private/link-local/loopback IP. Use a DNS resolver and reject before saving.
3. Add `X-AcreOS-Idempotency-Key: {organizationId}-{event}-{uuid}` per attempt; same key on retries.

### 5.5 Other HMAC paths (audit complete)

| Path | Algorithm | Secret | Notes |
|---|---|---|---|
| `developerApiService.signWebhookPayload` | HMAC-SHA256 with timestamp | per-app | Stripe-style; **the model the outbound dispatcher should adopt**. |
| `inboundEmailService.generateHash` | HMAC-SHA256, **truncated to 12 hex chars (48 bits)** | `INBOUND_EMAIL_HMAC_SECRET` | 48 bits is **borderline**. For a reply-to address verification this is acceptable — an attacker would need ~10¹⁴ probes per leadId, more than email infra would tolerate. But document why 48 bits; future devs will assume it's a bug. |
| `twilioSignature.ts` middleware | HMAC-SHA1 | `TWILIO_AUTH_TOKEN` | SHA1 is Twilio's wire format requirement — not your choice. Compare uses `timingSafeEqual` with a length-mismatch guard. Correct. |
| `routes-deal-rooms.ts` document signed URLs | HMAC-SHA256 | `DOCUMENT_SIGNING_SECRET` | Good — separate secret, validated at startup. |
| `twoFactorAuth.ts` TOTP | HMAC-SHA1 (RFC 6238 mandates) | per-user TOTP secret | Implementation: counter packed BE, dynamic-truncation per RFC. **I read the math; it's correct.** Window=±1 period (30s tolerance). Good. |

---

## 6. Auth-credential hashing review

**There is no AcreOS-managed password store.** Authentication is delegated to Clerk (`clerkMiddleware`, `clerk_user_id` foreign key in `users` table, the `__clerk` proxy in `routes.ts:223-248`). Clerk handles bcrypt/argon2 internally; you don't.

This is the right call. Auditing it:

| Concern | Status |
|---|---|
| Password storage | Clerk's problem. They use argon2id. |
| Session JWT verification | Done by `clerkMiddleware`. Algorithm: RS256 (Clerk default). JWKS fetched from Clerk's public endpoint with key rotation handled by them. Good. |
| One mention of "Passport.js with bcrypt" | `services/permanentSovereignty.ts:365` is **stale documentation**. There's no live Passport instance. Clean it up; it's misleading future auditors. |
| 2FA backup codes | Hashed with `scryptSync(code, salt, 64)` per code. **Salt is per-code, stored alongside the hash.** Good. scrypt is appropriate here (low-entropy 8-char codes). |

**Verdict: nothing to fix on the auth-credential layer. Just delete the `permanentSovereignty.ts` line that claims Passport.**

### 6.1 JWT signing — Clerk only

Internal services do not mint JWTs. The MCP API uses bearer tokens (`MCP_API_KEY`) — opaque, not JWT. Developer API uses HMAC signatures. Borrower sessions use random tokens. **There is no internal JWT signing surface to audit.** This is good — fewer footguns.

If you ever add internal JWTs (e.g., for a microservice), use:
- Algorithm: **EdDSA (Ed25519)** if you control both ends; **RS256** if you need broad library compat. **Never HS256** for service-to-service (symmetric secret leaks compromise both sides).
- `kid` header + JWKS endpoint at `/.well-known/jwks.json` for rotation.
- Always set `exp`, always set `aud`, always validate `aud`.

---

## 7. Crypto-hardening sprint (1-2 weeks)

### Week 1 — Consolidate

| Day | Task | Owner |
|---|---|---|
| 1 | Add HMAC-SHA256 hashed storage for `borrower_sessions.session_token` and `notes.access_token`. Migrate existing rows on next access. | backend |
| 2 | Replace `notes.accessToken` generation with `randomBytes(32).base64url`. Add `access_token_issued_at` column. | backend |
| 3 | Add timestamp + replay window to outbound webhook signing (`X-AcreOS-Timestamp`, `t=….body` signing). Update docs for receivers. | backend |
| 4 | Add `https://` + private-IP validation to webhook endpoint registration. Reject SSRF targets. | backend |
| 5 | Encrypt `skip_traces.results` and `skip_traces.input_data` (R3 from Sam). Extend the helpers to handle jsonb (encrypt the serialized JSON, store as text or in a sibling `_encrypted` column). | backend |

### Week 2 — Consolidate harder

| Day | Task | Owner |
|---|---|---|
| 6-7 | **Merge the two encryption modules.** `services/encryption.ts` callsites migrate to `middleware/fieldEncryption.ts`. New rotation script entry for `organization_integrations.credentials`. | backend |
| 8 | Add `ESIGN_SIGNING_SECRET` (separate from `SESSION_SECRET`). Update `signingTokens.ts` to use it. Add `expEpoch` claim to signed payload. Single-use enforcement table. | backend |
| 9 | Document key rotation procedure in `docs/security/key-rotation.md`. Set calendar entry for first annual rotation (one year from today: 2027-05-01). | infra |
| 10 | Prototype deterministic encryption (T2 tier) for `leads.email` using `miscreant` (AES-SIV). Bench the lookup query. Decide whether to deploy in v2 or wait until pre-IPO compliance forces the issue. | backend |

### Out of scope for this sprint, on the roadmap

- Envelope encryption (per-org DEK / master KEK). Right architecture; wrong time. Re-evaluate at 1k orgs.
- HSM-backed master key (AWS KMS, GCP KMS). Right architecture; wrong cloud — Fly doesn't have native KMS. Re-evaluate if you migrate.
- Post-quantum readiness. Not yet. NIST FIPS 203/204/205 are too fresh; revisit in 2027 when libraries mature.

---

## 8. The single-line takeaway

**Your AES-GCM is right; your HMACs are right; your auth delegation is right. The work is not "fix the math" — it's "fix the architecture": one encryption module not two, one rotation procedure that covers everything, separate secrets per trust domain, hashed storage for capability tokens, and replay protection on the things that travel the network.** Two weeks of focused work, then you can sleep.

— Aravind
