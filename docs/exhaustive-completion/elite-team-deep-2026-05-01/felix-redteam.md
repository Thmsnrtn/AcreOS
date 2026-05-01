# Felix Brenner — Red-Team Deep Audit

> Wave-2 follow-up to Sam Reyes (`elite-team-2026-05-01/sam-security.md`).
> Scope: actively try to break things. SSRF / IDOR / CSRF / mass-assignment / race
> conditions / open redirect / XSS / privilege escalation / file upload abuse /
> webhook spoofing / info disclosure. Sam covered the bones; I'm here for the gaps.

**One-line verdict:** Sam's right that the foundation is solid, but there are at
least three more reachable bugs in the public attack surface that he didn't list,
plus a class of mass-assignment + cross-tenant write paths that pen-testers
will find on day 2. **Pen-test-readiness: 5/10.** Don't engage HackerOne or Bishop
Fox until F1, F2, F3 are closed.

---

## 1. Verified vulnerabilities (pen-tester finds these in <1 day)

### F1 — SSRF via `POST /api/webhooks/test` (HIGH, CVSS ~8.5)
**`server/routes-integrations.ts:1702-1730`**

```ts
api.post("/api/webhooks/test", isAuthenticated, getOrCreateOrg, async (req, res) => {
  const { url, secret } = req.body;
  if (!url || typeof url !== "string") return Errors.badRequest(res, "url is required");
  // ...
  const response = await fetch(url, { method: "POST", headers, body: payload });
  res.json({ status: response.status, ok: response.ok });
});
```

`url` comes straight from the body and is fetched server-side with **no validation,
no scheme/host filter, no DNS check**. Sam already noted that `validateUrl()` exists
in `server/middleware/fileUploadSecurity.ts:273`, with private-range blocking — it
just isn't called here. Same gap exists in the production dispatch path
`webhookDispatcher.ts:215` (`fetchWithRetry(endpoint.url, …)`).

**Reproduction:**
```http
POST /api/webhooks/test
x-csrf-token: <valid>
{"url":"http://169.254.169.254/latest/meta-data/iam/security-credentials/"}
```
Response status code (200 vs 404 vs 401) leaks AWS metadata reachability. Same
vector hits `http://localhost:5432/`, internal Fly.io 6PN addresses
(`fdaa::*` IPv6 — ranges Sam's `validateUrl` does cover), and any other internal
service. The status + response time channels exfiltrate even though we don't
return the body.

**Fix:** mount `validateUrl(url)` (which already exists) before both calls.
Add DNS resolution + re-check after resolving (defeats DNS rebinding) and bind
`fetch` to an `undici` agent that rejects redirects to private addresses.
The current `validateUrl` checks the **hostname string** — a hostname resolving to
`127.0.0.1` slips through. Fix that as part of the same change.

### F2 — Inbound-email webhook is unauthenticated to the world (HIGH, CVSS ~7.5)
**`server/routes-inbound-email.ts:32-48`** + `server/middleware/csrf.ts:26` exempts it.

No HMAC, no SNS signature check, no source-IP allowlist, no SNS subscription-
confirmation handling. The `INBOUND_EMAIL_HMAC_SECRET` Sam noted in
`secretsValidation.ts` is used only to **mint** per-lead reply-to addresses
(`inboundEmailService.ts:27`); the webhook itself trusts the JSON body.

**Attack:** anyone who has ever received an AcreOS lead-thread reply (and thus
seen one `inbox+{leadId}-{hash}@replies.acreos.com` address) can replay POSTs
to this endpoint forever. Per-lead `verifyReplyHash` (`inboundEmailService.ts:89`)
blocks cross-lead spoofing — but for the captured lead they can inject arbitrary
`bodyText` / `bodyHtml`, flip `leads.status` to `"responded"` poisoning pipeline
metrics, mint fake `lead_activities` rows, and spam the AI engagement scorer.
No lead-id-space rate-limit, so they can flood thousands of fake "responded"s.

**Fix:** verify SNS signature (mirror `twilioSignature.ts`). Reject payloads
whose SNS signing cert URL doesn't end in `*.amazonaws.com`. Per-IP 60/min on
this route specifically. Audit-log every parsed inbound delivery.

### F3 — Mass assignment: `PUT /api/tasks/:id` cross-tenant write (HIGH, CVSS ~7.0)
**`server/routes.ts:1764-1779`**

```ts
const existingTask = await storage.getTask(orgId, id);            // org-scoped read
if (!existingTask) return res.status(404).json(...);
const updates: any = { ...req.body };                             // 🚨
const task = await storage.updateTask(id, updates);               // no orgId
```

`storage.updateTask(id, updates, organizationId?)` (`storage.ts:4461`) makes
`organizationId` optional, identical to the `updateGeneratedDocument` problem
Sam flagged. Combined with the `...req.body` spread:

**Reproduction:**
```http
PUT /api/tasks/123
{"title":"hi","organizationId":99999}
```
The task is moved to a target org you don't belong to. You lose access; the
victim org gains a hijacked row with attacker-controlled content. If the victim
org has automation that fires on `task.created` / `task.updated` webhooks
(via `dispatchWebhook`), payloads exfiltrate.

Same structural smell at:
- `server/routes-communications.ts:237, 480, 970, 1322, 1359` — multiple
  `...req.body` spreads, several without explicit org-scoping in storage.
- `server/routes-crm-extras.ts:253, 300` — same.
- `server/routes-analytics.ts:248, 321, 810` — same.
- `server/routes-integrations.ts:1327` — same.
- `server/routes-epic-services.ts:308` — same.

I sampled 4 of them; 3 of 4 don't filter the spread before `update()`. Treat
this as a class bug, not a one-off.

**Fix:** ban `...req.body` in update handlers via lint rule. Every update path
should `pick()` the editable fields explicitly (Zod `.pick()` or a hand-coded
allowlist), and storage update helpers must require `organizationId`.

### F4 — TOCTOU / double-sign race on public e-sign (MEDIUM, CVSS ~5.8)
**`server/routes-public-sign.ts:127-153`**

```ts
if (signers[signerIdx].signedAt) return res.status(409)...;       // check
// ...async DB writes...
await storage.createSignature({ ... });                            // act
await storage.updateGeneratedDocument(doc.id, { signers: updatedSigners, ... });
```

Two concurrent POSTs with the same valid token both pass the pre-check and both
insert `signatures` rows. `signatures` has no unique constraint on
`(documentId, signerEmail)` (verified by absence in `shared/schema.ts:4825-4826`
neighborhood — this needs a migration check, not a regex). Result: duplicate
signatures, ambiguous `signedAt`, and `updateGeneratedDocument` last-write-wins
on the `signers` array.

For an ESIGN-Act record this is the kind of inconsistency that ends the chain
of evidence. Even if courts wouldn't care, it makes Sam's R2 (mutability) twice
as bad: now you have *two* "official" signatures.

**Fix:** wrap insert+update in a transaction with `SELECT … FOR UPDATE` on the
document row, OR add a partial unique index `(document_id, signer_id) WHERE
signature_data IS NOT NULL`.

### F5 — Field-scout photo metadata IDOR (MEDIUM, CVSS ~5.5)
**`server/routes-field-scout.ts:148-205`**

```ts
const photoRecord = await storage.createFieldScoutPhoto({
  visitId: meta.visitId ? parseInt(meta.visitId) : null,         // 🚨 user-controlled, no verify
  leadId,
  ...
});
```

The route verifies the lead belongs to the org but blindly accepts
`meta.visitId` from the body's metadata array. There is no
`storage.getFieldScoutVisit(orgId, visitId)` check before using it. Photos can
be attached to other orgs' visits — corrupting another org's audit trail.

**Fix:** if `meta.visitId` is provided, verify
`storage.getFieldScoutVisit(meta.visitId)` belongs to `org.id` and to the same
lead. Or drop the field entirely and let the server pick the active visit.

### F6 — OAuth callback missing `state` parameter (MEDIUM, CVSS ~5.0)
**`server/auth/oauth.ts:118-172`** (Google) and **`:180-237`** (Microsoft)

The authorization URL is built without a `state` parameter, and the callback
doesn't validate one. Standard OAuth-CSRF: an attacker initiates an OAuth
flow with their own `code`, and tricks a victim's browser into hitting the
callback. The callback then calls `findOrCreateOAuthUser` and on the next
`/auth` redirect the victim's *Clerk* session ends up linked to the
attacker's Google identity.

The mitigation today is "we redirect to `/auth` and Clerk re-authenticates."
This is the kind of thing that's safe-by-accident; it stops being safe the
first time someone uses the AcreOS-side user record before Clerk re-asserts
identity. Fix it now.

**Fix:** mint a `crypto.randomBytes(16)` state, store in a short-lived signed
cookie, verify on callback. 30 minutes of work.

### F7 — `req.headers["x-forwarded-for"]` raw fallback in public sign (LOW-MEDIUM)
**`server/routes-public-sign.ts:141`**

```ts
ipAddress: req.ip || (req.headers["x-forwarded-for"] as string) || null,
```

`app.set("trust proxy", 1)` is set in `index.ts:220`, so `req.ip` is correct.
But the fallback to the raw header lets a sufficiently determined attacker
inject a comma-separated chain like `1.2.3.4, 5.6.7.8` into the `signatures`
audit row by sending the header from a host with no proxy in front of it.
Useless if Fly.io always fronts you, but on local dev / staging it's
exploitable.

**Fix:** drop the fallback. `req.ip` after `trust proxy` is canonical.

---

## 2. Likely vulnerabilities — pattern-based, untested

- **L1** — `crossOrgAdminGuard` (`routes-admin.ts:664`) defined but used
  nowhere. Any future admin route with `:orgId` inherits the gap.
- **L2** — `insertSchema.parse({...req.body, organizationId: org.id})` pattern
  in `routes-ai.ts:33, 65`, `routes-deals.ts:135`, `routes-dashboard.ts:436`.
  Safe today (overwrite wins), but one careless edit away from unsafe. Make
  insert schemas `.omit({ organizationId, id, createdAt, updatedAt })`
  explicitly.
- **L3** — `res.status(500).json({ message: err.message })` violates project
  standard at `roleGuard.ts:93`, `routes-field-scout.ts:78, 203`,
  `routes.ts:1760`, plus many handlers in `routes-organization.ts`. Leaks
  Drizzle SQL fragments + schema column names in prod.
- **L4** — `webhookDispatcher.ts:241-258` doesn't pass `redirect: "manual"`.
  A malicious webhook endpoint can `302 Location: http://localhost:6379/` to
  bounce dispatch into internal Redis. Delayed-SSRF class.
- **L5** — `routes-public-sign.ts:139` stores `String(signatureData)` with
  no length cap. 50MB POST → Postgres. Add 500KB cap.
- **L6** — `routes-integrations.ts:668` Twilio credentials are decrypted and
  used with user-supplied query strings to hit Twilio. Marketing-role
  compromise = phone-search-history read. Add per-org daily cap.
- **L7** — `getOrCreateOrg` silently creates an org for any anonymous-but-
  claimed-identity request. If any handler forgets `isAuthenticated` but
  keeps `getOrCreateOrg`, instant org-spam. Add an ESLint rule.
- **L8** — `csrf_token` cookie is `sameSite: "lax"` and not `httpOnly`
  (by design — double-submit needs JS read). Any XSS anywhere reads it. CSP
  is solid; document the trade-off.

---

## 3. Hardening recommendations beyond Sam's list

- **H1 — Postgres role separation.** Generalize Sam's `audit_log` REVOKE:
  `acreos_app` should have only INSERT/UPDATE/SELECT on the tables it writes,
  and DELETE only on `provider_cache`. A theoretical SQLi shouldn't be a
  `DROP TABLE`.
- **H2 — Webhook outbound payload size cap.** `webhookDispatcher.ts:197` has
  no limit on `JSON.stringify(payload)`. Truncate or reject above 256KB.
- **H3 — Per-token rate limit on public sign.** Sam's R5 covers expiry; add
  5/min/IP + 30/hr per `(docId, signerId)` separately.
- **H4 — HKDF-derive signing-token keys per document** so a leaked
  `SESSION_SECRET` doesn't retroactively compromise every doc.
- **H5 — Audit-log IP/UA must never be `null`.** `routes-public-sign.ts:141`
  falls back to `null` — for ESIGN, "we don't know who signed from where" is
  worse than nothing. Refuse if both `req.ip` and `x-forwarded-for` are unset.
- **H6 — Host-header trust audit.** `req.host` / `req.hostname` /
  `req.headers.host` should never be used to construct URLs anywhere — only
  the configured `APP_URL`. Open-redirect + cache-poisoning vector.
- **H7 — CORS audit.** Verify `Access-Control-Allow-Origin` is never `"*"`
  on cookie-reading endpoints; strict origin allowlist only.
- **H8 — Clerk JWT alg pinning.** `clerkAuth.ts` should pass
  `{ algorithms: ["RS256"] }` explicitly to `jwtVerify` — defense-in-depth
  on top of jose's defaults.
- **H9 — `security.txt` + `X-Content-Type-Options` audit on `server/static.ts`.**
  Bug-bounty hygiene + static-path header verification.
- **H10 — CSP `style-src 'unsafe-inline'` mitigation.** Tailwind needs it,
  but stage Trusted Types (`require-trusted-types-for 'script'`) in CSP
  report-only first — sets up the eventual removal.

---

## 4. Pen-test prep — fix BEFORE engaging external firm

Estimated cost of a bishop-fox / NCC / TrustedSec engagement on AcreOS today:
they will burn ~20% of their hours on F1, F2, F3 — bugs cheap enough to fix
internally. Fix these first; the report you get back will be more valuable.

**Must close before pen-test:**
1. F1 (SSRF webhook test) — 2 hr.
2. F2 (inbound email no auth) — 1 day. Get SNS signature verify working in staging.
3. F3 (mass-assignment class) — 2 days. Add lint rule + fix top 6 sites.
4. Sam's R1 (broken founder check) — 1 hr.
5. Sam's R4 (2FA non-functional) — 1 day.
6. F6 (OAuth state) — 30 min.
7. L4 (webhook redirect follow) — 30 min.
8. H10 (host header audit) — 1 hr.

**Also assemble for the firm:**
- Threat model doc (1-pager) — what we ARE worried about, what's out of scope.
- Architecture diagram showing Clerk/Stripe/Twilio/SES boundaries.
- Test account creds (3 orgs, 3 roles each, sample data populated).
- Read access to `audit_log` so they can confirm their probing is being seen.
- A scope doc that explicitly **includes** the public sign URL flow,
  the inbound-email webhook, and the e-sign legal-evidence chain.

---

## 5. Bug-bounty readiness assessment

**Today: not ready.** Public bounty before F1-F3 close = HackerOne flooded
with dupes and a scoreboard that says "auditor missed an SSRF."

**Private bounty (3-5 trusted researchers) requires:** §4 closed,
`security.txt` published, `security@acreos.io` monitored with 24h SLA,
a safe-harbor + scope + payout doc, and a test environment with isolated
data so no researcher touches prod.

**Public bounty requires:** all of the above + 90 days of private bounty with
zero criticals + a pen-test report (§4) with all H/C resolved + SOC2 Type 1
in progress (Sam §6).

**Realistic timeline:** private launch in 8-10 weeks, public in 6 months.
Don't accelerate. AcreOS holds signed deeds — a "AcreOS leaked my deed"
Twitter thread is existential.

---

## 6. The 2-week red-team-response sprint

Single owner per item, all PRs reviewed by Sam.

**Week 1 — public surface**
- D1 AM: F1 webhook-test SSRF — wire `validateUrl` + DNS resolve check + `169.254.169.254` regression test.
- D1 PM: F6 OAuth state param — mint, store in signed cookie, verify.
- D2: F2 inbound-email — implement SNS signature verify + cert URL allowlist.
- D3: Sam R1 + `crossOrgAdminGuard` audit — mount guard everywhere, regression test.
- D4-5: F3 mass-assignment sweep — ESLint `no-spread-into-update`, fix top 10, make `organizationId` required on all storage update helpers.

**Week 2 — e-sign + hardening**
- D6: F4 + Sam R2 — wrap signature insert/update in tx, add unique index, reject content updates on `status=signed`.
- D7: Sam R3 — encrypt `skip_traces.results` + backfill migration.
- D8: Sam R4 — pick Clerk-native MFA, rip out broken `require2FA`, ship 428 regression test.
- D9: H1-H8 hardening sweep — single headers + DB-role PR.
- D10: F7, L3, L5, L6 cleanup — pure hygiene PR.

**End-of-sprint deliverables:**
1. All §4 items closed.
2. `security.txt` live.
3. `red-team-response.md` with PR + regression-test path per item.
4. `scripts/redteam/` — attacker-harness scripts for F1-F3 we re-run every release.
5. Go/no-go for external pen-test next quarter.

---

## Closing note

Sam's audit is correct on what it covers. It's a **defender's audit** — list
the controls, verify each one. The reason F1 / F2 / F3 didn't surface is
they're **attacker's bugs** — bugs you find by typing
`http://169.254.169.254/` into a field and seeing what comes back, not by
reading middleware. Both modes are necessary.

If I had only one paragraph to give Thomas: AcreOS is not at the
"customer-trust-leaks" tier yet, but it is one careless PR away. The mass-
assignment class bug (F3) is the kind of thing that ships because the test
for it doesn't exist. Add the lint rule. Re-run this audit in 90 days. Don't
engage an external firm until the §4 list is green.

— Felix
