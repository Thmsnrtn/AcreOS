# 07 — Security Beyond the Registry

*Slice 07. Read-only. Region: secrets-in-bundle, file-upload wiring, rate limits, SSRF, `sql.raw` recurrence, dependency CVEs, PII-in-logs, prompt-injection→tools.*

**State of the region: strong, and mostly ungameable.** Rate limits are comprehensively wired (auth/AI/webhook/import/export/mcp/catch-all), the SSRF guard is robust (scheme + private-range + DNS-rebinding checks) and is actually called before every *customer-facing* outbound fetch, file uploads run magic-byte + EXIF-strip + macro-extension validation, PII is redacted at the log sink by default, and the built client bundle carries only publishable keys. The registry P0s hold. **The one defect class that survives every gate here is `sql.raw`: 38 interpolation sites, zero lint or ratchet.** Every current site is controlled by a whitelist, a DB-derived value, or founder-only auth — so nothing is live-exploitable today — but the *pattern* is gated by nothing, and this repo's own history (an `as any` that widened a tenant key) is the argument for gating it before the next wave adds an unsanitized one.

---

### F-07-1 — The `sql.raw()` class is gated by nothing (38 sites, no lint/ratchet)
**Severity:** P2 real
**Surfaced by:** slice 07
**Survives which gates:** Passes `tsc` (the strings are valid `string`). Passes `lint:no-fabrication` (regex looks for fake-data markers, not SQL). Passes `lint:reachability` (sites are reached). Passes the `as-any` / `req-as-any` ratchets (no cast needed to interpolate a string). Passes `lint:org-fetch` (that gate checks Drizzle query-builder `.where()` org scoping, not raw strings). **There is simply no gate that inspects `sql.raw()` arguments** — confirmed: `ls scripts/ | grep -iE 'sql|inject|raw'` → NONE; ratchet set is 8 files, none SQL-related.
**Evidence:** 38 sites (`grep -rn 'sql\.raw(' server/ shared/`). Representative interpolations I read:
- `server/jobs/archival.ts:220` — `DELETE FROM "${table}" WHERE id IN (${ids.join(",")})` (ids are DB int PKs; table is code-whitelisted at :133).
- `server/routes-cohort-ltv.ts:81-88` — `WHERE organization_id = ${orgId} AND period_start >= '${start.toISOString()}'` (orgId + dates are DB-derived; founder-only route).
- `server/routes-customer-health.ts:47` — `WHERE h.band = '${band}'` where `band` is whitelisted against `HEALTH_BANDS` at :46 before interpolation.
- `server/services/founder-chat/providers/db-ops.ts:458` — snapshot `SELECT * FROM "${table}" ${target.whereClause}` re-interpolates an AI-authored WHERE clause (founder + Tier-3 gated).
**What's wrong:** Today every site is defensible: identifiers are whitelisted or `information_schema`-checked, interpolated *values* are numeric/DB-sourced or member-of-set-checked, and the raw-SQL AI tool (`db-ops.ts`) is founder-only behind `parseSqlSafety` + org-scope guards. But the class has no backstop. The next agent that writes `sql.raw(\`... WHERE name = '${req.query.name}'\`)` in a customer route produces a cross-tenant SQL-injection P0 that ships green — exactly the "wave reports success, is blind to the seam" failure mode CLAUDE.md documents, and the sibling of the `leads.organizationId` widening the reachability ratchet was built to stop.
**Impact:** Neither today (no live-exploitable site). Burns trust catastrophically *if* recurrence lands a user value in a customer-facing site — cross-tenant read/write. The gate is cheap insurance against a class this repo demonstrably reintroduces.
**Fix:** Add `scripts/lint-sql-raw.mjs` to `npm run check`: flag any `sql.raw(` whose argument is a template literal containing `${...}` unless the file/line carries an `// sql-raw-ok: <reason>` allow-comment. Seed the allowlist with the 38 current sites (each already has a controlling mechanism to cite), then baseline. New unannotated interpolations fail CI.
**Gate it:** New lint `lint:sql-raw`, **measured baseline = 38 allow-listed sites at HEAD** (`5ca0f29`); direction: may only shrink. This is the missing member of the ratchet family.
**Effort:** M
**Blast radius:** 1 new script + `package.json` `check` line + 38 one-line allow-comments across the listed files.
**Confidence:** high — I read the four charged files (`db-ops.ts`, `archival.ts`, `investorStatementBatch.ts` header, `orgDataClear` via list) and the six route sites; confirmed no gate exists.

---

### F-07-2 — `integrationFrameworkV12.execute()` fetches an arbitrary URL with an org credential attached and no `validateUrl()`
**Severity:** P3 minor (founder-gated)
**Surfaced by:** slice 07
**Survives which gates:** No SSRF lint exists; `validateUrl` adoption is convention, not enforced. The route sits behind `isAuthenticated + requireFounder` (`routes-founder-real-runtime.ts:32`), so no auth gate flags it. It is the *only* outbound user-URL fetcher that skips the guard every sibling uses.
**Evidence:** `server/services/integrationFrameworkV12.ts:133` `const fullUrl = endpoint;` → `:148 await fetch(fullUrl, { headers: { Authorization: \`Bearer ${apiKey}\` } })`, where `apiKey` is the base64-decoded stored credential (:130) and `endpoint` arrives raw from `req.body.endpoint` (`routes-founder-real-runtime.ts:306-308`). Contrast: `webhookDispatcher.ts:224`, `agentOrchestration.ts:754`, `routes-deal-rooms.ts:226` all `await validateUrl(...)` before fetch.
**What's wrong:** A caller-supplied `endpoint` is fetched with a decrypted integration secret forwarded as a Bearer token, with no scheme/private-range/metadata check. Points it at `http://169.254.169.254/...` (cloud metadata) or `http://attacker.tld` (credential exfil).
**Impact:** Neither — blast radius is founder-only, and the founder can already read every credential via `getCredentials`, so there is no privilege escalation. It is a real SSRF + credential-forwarding hole kept latent solely by the founder-auth wall. Worth closing because it is the single deviation from an otherwise-uniform guard.
**Fix:** `const parsed = await validateUrl(endpoint);` before the fetch at :148; on `SSRFBlockedError` return the existing structured failure. One import, one line.
**Gate it:** Fold outbound-fetch call sites into a `lint:ssrf-adoption` check (analogous to `lint:org-fetch`): any `fetch(<non-literal-url>)` in `server/services|routes` must be preceded by `validateUrl` or carry `// ssrf-ok:`. Baseline = current guarded set.
**Effort:** S
**Blast radius:** `integrationFrameworkV12.ts` only.
**Confidence:** high — read the fetch, the credential decode, and the calling route incl. the `requireFounder` mount.

---

### F-07-3 — Audio-upload routes skip `validateFileMiddleware` content validation
**Severity:** P3 minor
**Surfaced by:** slice 07
**Survives which gates:** No test asserts that every `createUploadMiddleware()` consumer is paired with a `validateFileMiddleware`. `createUploadMiddleware` alone enforces size + a dangerous-extension blocklist, but the magic-byte category check lives only in the separately-applied `validateFileMiddleware`.
**Evidence:** `server/routes-ai.ts:1849` `audioUpload = createUploadMiddleware({ maxSizeMB: 25 })` → `:1850 .post(..., audioUpload.single("audio"), ...)` — no `validateFileMiddleware`. Same shape `server/routes-field-scout.ts:110` `voiceUpload.single('audio')`. All other upload routes (properties/import/leads/rehab-photos/bid-estimates/field-scout-photos/vault) do chain the validator.
**What's wrong:** The audio path accepts arbitrary bytes up to 25 MB into memory with only an extension check — no content-type confirmation. It is a deliberate omission (audio has no signature in `MAGIC_BYTES`, and the buffer is streamed to Whisper), so the practical risk is low: authenticated, org-scoped, size-capped, and the byte stream is handed to a transcription API, not stored or executed.
**Impact:** Neither — authenticated + rate-limited (`aiLimiter` on `/api/ai`). Noise-level; listed for completeness of the upload-wiring audit the charge requested.
**Fix:** Either add an `audio` category to `MAGIC_BYTES` (webm/ogg/mp3/wav signatures) + `validateFileMiddleware(["audio"])`, or add a one-line comment at both sites documenting the intentional skip so a future audit doesn't re-flag it.
**Gate it:** A test that walks route files and asserts each `*.single(`/`*.array(` built from `createUploadMiddleware` is followed by a `validateFileMiddleware` or an `// upload-content-check: n/a` marker. Baseline: 2 marked exemptions (the two audio routes).
**Effort:** S
**Blast radius:** `routes-ai.ts`, `routes-field-scout.ts`.
**Confidence:** high — enumerated every multer consumer and read each route's middleware chain.

---

### What I confirmed is genuinely solid (do not re-flag)
- **Rate limits fully wired** (`server/index.ts:352-508`): `authLimiter`/`authAttemptLimiter` on `/api/auth`+`/api/login`, dual-lane CGNAT-safe `loginLimiter`/`passwordResetLimiter`/`emailVerifyLimiter`, `aiLimiter` on `/api/ai|pax|chat|executive|document-generation`, `webhookLimiter`, `importLimiter`, `exportLimiter`, catch-all `apiLimiter` on `/api`, and `mcpLimiter` on `/mcp` (previously unmetered, fixed T0-3). Redis-backed store.
- **SSRF guard robust and applied** (`middleware/fileUploadSecurity.ts:335`): rejects non-http(s) schemes, private IPv4/IPv6 ranges, CGNAT, IPv4-mapped IPv6, cloud-metadata IPs/hostnames, and re-checks the DNS-resolved address. Called before every customer-facing outbound fetch (webhookDispatcher, agentOrchestration, deal-rooms, ai/tools). *Residual:* app-level DNS-rebinding TOCTOU (validated IP ≠ fetch-time IP) — inherent to this design, not a new defect.
- **No secrets in the client bundle.** Only `VITE_`-prefixed publishable values reach the client (Clerk publishable key, Mapbox/Stadia map tokens, Sentry DSN). `sk_live_`/`AKIA`/`ghp_` matches in the tree are all placeholders, hint strings, or prefix-detection logic — zero hardcoded secrets (`grep` for live-key patterns across `client/`, `server/`, `shared/`).
- **PII redaction at the log sink** (`server/utils/logger.ts:194`): `redactPII` masks SSN, credit cards, emails, and phones on *every* message and metadata value by default unless `metadata.__pii_safe === true`. Interpolated `${email}` in log messages is scrubbed before write.
- **Prompt-injection defense-in-depth:** `promptInjectionMiddleware` on `/api/ai|atlas|chat|executive|pax|support|founder/v6-v14` (`routes.ts:935-949`); `sanitizePrompt`/`sanitizePromptInline` applied where untrusted data enters prompts (executive files, supportBrain, leadNurturer, aiOfferService, paxLearning); `untrustedEnvelope` wrapping + `validatePaxResponse` as the output-side check. The founder-only raw-SQL AI tool is gated by `parseSqlSafety` + `assertWriteScoped` (WHERE + org-scope) + Tier-3 confirm.
- **Dependency hygiene:** `overrides` pin `undici ^7.28.0`, `dompurify ^3.4.11`, `tar ^7.5.16`, `protobufjs ^7.6.3`, `form-data ^4.0.6`, `@opentelemetry/core ^2.8.0` — i.e. transitive CVEs are being force-patched. Direct deps are current (`jspdf 4.2.1`, `stripe 20.4.1`, `openai 6.45`, `@anthropic-ai/sdk 0.110`); no SheetJS/`xlsx`. `npm run audit:security` exists. I could not execute `npm audit` in this offline environment, so I assert no *specific* CVE finding rather than fabricate one.

---

## Coverage ledger
**Examined exhaustively:** all 4 charged `sql.raw` files (`db-ops.ts` full, `archival.ts` full, `investorStatementBatch.ts` header + interpolation context, `orgDataClear.ts` via site listing) plus all 6 route `sql.raw` sites; `middleware/fileUploadSecurity.ts` full; every `createUploadMiddleware`/multer consumer and its middleware chain; rate-limiter wiring in `server/index.ts` + `auth/routes.ts`; client env/secret surface across `client/src`; `logger.ts` redaction path; prompt-injection guard wiring (`routes.ts`, `sanitizePrompt` call sites); `integrationFrameworkV12.ts` fetch + its calling route; `package.json` deps/overrides.
**Examined by sampling:** the ~35 server-side `fetch()` fetchers (grepped for user-URL params; spot-read webhookDispatcher/agentOrchestration/deal-rooms to confirm `validateUrl` adoption — did not read all 35 line-by-line); `promptInjection.test.ts` scope (read the pattern list, not the middleware internals).
**Did NOT examine:** server/ai/ context-assembly paths for *indirect* injection reaching side-effectful tools (that is slice 08's exhaustive charge — I did not enumerate every tool executor in `solene/chat/toolExecutor.ts`); the DNS-rebinding TOCTOU exploitability under undici; a live `npm audit` (offline); WebSocket auth (slice T4); field-level encryption middleware. No CVE claim is made without a runnable audit.

## Constitution Collisions
None. All findings are gate/hardening proposals within existing surfaces; none add a nav entry, persona, AI destination, marketplace/API surface, or money-custody path, and none relitigate a DO-NOT-DO decision. The proposed `lint:sql-raw` and `lint:ssrf-adoption` gates are net-additive enforcement of existing invariants (the constitution *encourages* reclassifying prose-only hard-stops into enforced ones).
