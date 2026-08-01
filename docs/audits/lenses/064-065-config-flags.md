# Lenses 064 + 065 -- Feature Flag Safety & Config/Secret Management

Auditor: Claude Opus 4.6 (Tier 2)
Date: 2026-04-18
Codebase snapshot: commit 62626ff

---

## Distinct-Value Declarations

**Lens 064 (Feature Flag Safety):** This audit examines the _runtime behavioral integrity_ of the feature flag system -- whether toggling a flag mid-operation can break in-flight requests, whether flag names are consistent across the server gate and the client query, and whether the two completely separate flag subsystems (platform flags vs. agent flags) create a split-brain governance problem.

**Lens 065 (Config/Secret Management):** This audit examines the _lifecycle completeness_ of credential and environment variable management -- from documentation in `.env.example`, through startup validation, into the encrypted DB-backed configManager, and finally to whether undocumented env vars with hardcoded fallback secrets create exploitable weaknesses in production.

---

## Lens 064 -- Feature Flag Safety

### Architecture Overview

AcreOS has **two independent feature flag subsystems** that share no storage, no UI, and no naming convention:

| Subsystem | Storage | UI | Scope |
|-----------|---------|-----|-------|
| Platform Feature Flags | `platform_feature_flags` DB table | Founder Dashboard + `/founder/feature-flags` page | Route-level gating for entire modules (marketplace, academy, etc.) |
| Agent Feature Flags | In-memory `AGENT_FEATURE_FLAGS` object in `server/agents/index.ts` | Founder Dashboard agent toggles | Individual background agent on/off |

**Platform flags** are checked via:
- Server: `featureGate()` middleware (`server/middleware/featureGate.ts`) -- per-request DB query
- Client: `useFeatureFlags()` hook (`client/src/hooks/use-feature-flags.ts`) -- polls `GET /api/config/features` with 5-min stale time

**Agent flags** are checked at agent startup and toggled via `setAgentEnabled()` in the registry. They are hardcoded defaults (all `true`) in `server/agents/index.ts:15-21` and never read from the database.

### Findings

#### F064-01: Four competing API surfaces for feature flags
**Severity: P2**

There are four different endpoints that manage feature flags, with two of them being duplicates:

| Endpoint | File | Auth | Method |
|----------|------|------|--------|
| `GET /api/config/features` | `server/routes.ts:291` | **None** (public) | Returns enabled keys + routes |
| `GET /api/config/features` | `server/routes-admin.ts:2859` | **None** (public) | Same -- **duplicate registration** |
| `GET /api/admin/feature-flags` | `server/routes.ts:1261` | `isAuthenticated` + founder check | Returns all flags with state |
| `PATCH /api/admin/feature-flags/:key` | `server/routes.ts:1275` | `isAuthenticated` + founder check | Toggle flag |
| `GET /api/founder/feature-flags` | `server/routes-admin.ts:2870` | `isFounderAdmin` | Returns all flags |
| `PUT /api/founder/feature-flags/:key` | `server/routes-admin.ts:2879` | `isFounderAdmin` | Toggle flag |

The duplicate `GET /api/config/features` registration means Express serves whichever was registered first. The `routes-admin.ts` version returns a 500 on error, while the `routes.ts` version returns `{ enabledKeys: [], enabledRoutes: [] }` (fail-open). Depending on registration order, error behavior is unpredictable.

The admin and founder toggle endpoints use different HTTP methods (`PATCH` vs `PUT`) and different URL paths for the same operation.

**Remediation:** Consolidate to a single `GET /api/config/features` and a single `PUT /api/founder/feature-flags/:key`. Remove the duplicate in `routes-admin.ts`.

---

#### F064-02: featureGate queries DB on every request -- no caching
**Severity: P2**

`server/middleware/featureGate.ts` executes a database query on every single HTTP request to a gated route:

```typescript
const [flag] = await db
  .select()
  .from(platformFeatureFlags)
  .where(eq(platformFeatureFlags.key, flagKey))
  .limit(1);
```

Nine routes use `featureGate()` (`routes.ts:987-1463`), so every request to marketplace, academy, voice, white-label, vision-ai, capital-markets, certification, territories, or deal-rooms fires a DB query before the handler even begins. Under load, this adds unnecessary database pressure.

**Remediation:** Cache the full flag set in memory with a 30-60 second TTL. Invalidate on write via the toggle endpoint.

---

#### F064-03: Four flag keys referenced in routes.ts have no seed data
**Severity: P2**

The migration `0008_feature_flags_pricing_growth.sql` seeds 14 flags. But `routes.ts` uses `featureGate()` with four flag keys that do not appear in any migration seed:

- `feature_white_label` (line 1007)
- `feature_voice_ai` (line 1014)
- `feature_territories` (line 1048)
- `feature_deal_rooms` (line 1463)

Since `featureGate()` returns 404 when a flag is missing from the DB (line 34: "Flag missing or disabled -- treat route as unavailable"), these four modules are **permanently inaccessible** unless a founder manually inserts the rows.

**Remediation:** Add the four missing keys to the seed migration or an idempotent seed script.

---

#### F064-04: Client defaults to "show everything" during loading -- flash of gated content
**Severity: P2**

`use-feature-flags.ts:19-29` returns `true` from `isRouteEnabled()` and `isFlagEnabled()` while the flag data is loading or when no flags exist at all. The `FlaggedRoute` component in `App.tsx:276` does show a spinner during `flagsLoading`, but the sidebar (`layout-sidebar.tsx:468-488`) calls `isRouteEnabled()` during loading, which returns `true`, briefly exposing all nav items before the flag response arrives.

**Remediation:** Have `isRouteEnabled` return `false` while `isLoading` is true. The sidebar already reads `flagsLoading` but does not block rendering on it.

---

#### F064-05: Agent flags are in-memory only -- lost on redeploy
**Severity: P2**

`server/agents/index.ts:15-21` stores agent flags as a plain JavaScript object:

```typescript
const AGENT_FEATURE_FLAGS: Record<string, boolean> = {
  agent_customer_success: true,
  agent_growth: true,
  agent_revenue: true,
  agent_operations: true,
  agent_digest: true,
};
```

If a founder disables an agent via the dashboard, the change persists only until the next deploy. After restart, all agents re-enable to their hardcoded defaults (all `true`). This creates a false sense of control.

**Remediation:** Persist agent flag state to the `platform_feature_flags` table or a dedicated `agent_config` table. Read from DB at startup.

---

#### F064-06: Toggling a flag mid-request is safe but produces inconsistent UX
**Severity: P3**

The `featureGate` middleware is applied at route registration time, so toggling a flag does not crash an in-flight request -- the flag is checked only on new requests. However, the client caches flags for 5 minutes (`staleTime: 5 * 60 * 1000`), so a flag toggled off on the server will still show as enabled in the client UI for up to 5 minutes. Users can navigate to the route, see the page, but get 404s from the API.

**Remediation:** After a flag toggle, the founder dashboard already invalidates the query cache (`queryClient.invalidateQueries`), but other users' browsers won't know. Consider WebSocket broadcast on flag change, or reduce stale time to 30 seconds.

---

#### F064-07: featureGate fail-open on DB error
**Severity: P3**

`featureGate.ts:35-38`: if the DB query throws, the middleware calls `next()` (allows the request through). This is intentional for initial setup, but in production a database outage would effectively disable all feature gates, exposing features that the founder explicitly turned off.

**Remediation:** Add a `strictMode` option for production that returns 503 on DB errors instead of fail-open.

---

## Lens 065 -- Config/Secret Management

### Architecture Overview

Credentials flow through three layers:

1. **`.env` file / Fly.io secrets** -- Traditional `process.env` vars. Documented in `.env.example` (274 lines, ~90 variables).
2. **`configManager.ts`** -- Encrypted DB-backed credential store (`platform_config` table). At startup, `loadConfigToEnv()` decrypts stored values and patches them into `process.env`, but only for keys not already set in the environment (env takes precedence).
3. **Startup validation** -- Two overlapping validators: `validateEnv.ts` and `secretsValidation.ts`.

The founder has a **Setup Wizard UI** (`/founder/setup`) that lets them enter, validate, and store credentials through the `configManager`. The wizard manages 24 credential definitions across 13 service groups.

### Findings

#### F065-01: 15+ env vars used in server code but not documented in .env.example
**Severity: P2**

The following environment variables are referenced in server code via `process.env.*` but have no entry in `.env.example`:

| Variable | Usage Location | Risk |
|----------|---------------|------|
| `CLERK_JWT_KEY` | `server/auth/clerkAuth.ts` -- JWT fallback verification | **High** -- auth depends on it |
| `CERT_SECRET` | `server/jobs/courseCompletionCheck.ts` -- HMAC for certificates | Medium -- falls back to `"acreos-cert"` |
| `DOCUMENT_SIGNING_SECRET` | `server/routes-deal-rooms.ts` -- HMAC for doc signing URLs | **High** -- falls back to `"dev-secret"` |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `server/routes-billing.ts` -- Connect webhook verification | **High** -- falls back to STRIPE_WEBHOOK_SECRET |
| `INBOUND_EMAIL_HMAC_SECRET` | `server/services/inboundEmailService.ts` | Medium -- falls back to SESSION_SECRET then `"acreos-inbound-default"` |
| `INBOUND_EMAIL_DOMAIN` | `server/services/inboundEmailService.ts` | Low |
| `DISABLE_BACKGROUND_JOBS` | `server/index.ts` -- gates all background jobs | Medium -- operational |
| `SENDGRID_API_KEY` | Mentioned but not in .env.example properly | Low |
| `ALERT_EMAIL` | Alert routing | Low |
| `FOUNDER_PHONE` | Founder notifications | Low |
| `SOPHIE_CONFIDENCE_MODE` | AI safety tuning | Low |
| `GRADUATED_FINANCIAL_AUTHORITY` | Autonomy engine | Low |

**Remediation:** Add all referenced env vars to `.env.example` with descriptions. Prioritize the security-sensitive ones (`CLERK_JWT_KEY`, `DOCUMENT_SIGNING_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`).

---

#### F065-02: Hardcoded fallback secrets in production-facing code
**Severity: P1**

Several services use hardcoded string fallbacks for cryptographic secrets:

| File | Line | Fallback Value | Impact |
|------|------|----------------|--------|
| `routes-deal-rooms.ts` | 266 | `"dev-secret"` | Document signing URLs can be forged |
| `jobs/courseCompletionCheck.ts` | 41 | `"acreos-cert"` | Certificate hashes are predictable |
| `services/inboundEmailService.ts` | 8 | `"acreos-inbound-default"` | Inbound email HMAC can be spoofed |
| `services/configManager.ts` | 28 | `"acreos-dev-config-key-insecure"` | Encrypted credentials decryptable with known key |
| `services/solarPotentialService.ts` | 42 | `"DEMO_KEY"` for NREL API | Throttled to demo tier |

The `configManager.ts` fallback is especially concerning: if neither `FIELD_ENCRYPTION_KEY` nor `ENCRYPTION_KEY` nor `SESSION_SECRET` is set, the encryption key derives from a publicly-visible string in the source code.

**Remediation:** Refuse to start in production if any cryptographic secret is missing. The `validateSecrets` middleware already validates some keys; extend it to cover `DOCUMENT_SIGNING_SECRET` and `CERT_SECRET`.

---

#### F065-03: Two overlapping startup validators with different behavior
**Severity: P2**

Two files validate env vars at startup:

- `server/utils/validateEnv.ts` -- Checks `DATABASE_URL`, `CLERK_SECRET_KEY`, `ENCRYPTION_KEY`. Hard-exits on the first two missing; warns on `ENCRYPTION_KEY`.
- `server/middleware/secretsValidation.ts` -- Checks 18 secrets with `required`/`productionOnly` flags, length minimums, and placeholder detection. Hard-exits in production; warns in development.

The two validators disagree on what is required:
- `validateEnv.ts` requires `ENCRYPTION_KEY`; `secretsValidation.ts` does not list it.
- `secretsValidation.ts` checks `SESSION_SECRET` length >= 32; `validateEnv.ts` does not check it at all.
- `secretsValidation.ts` marks `FIELD_ENCRYPTION_KEY` as `productionOnly`; `validateEnv.ts` does not mention it.

It is unclear which one runs (or whether both run), and conflicting exit behavior means the startup experience is unpredictable.

**Remediation:** Consolidate into a single validation module. Use the richer `secretsValidation.ts` structure as the base and remove `validateEnv.ts`.

---

#### F065-04: configManager encryption key falls back through three levels
**Severity: P2**

`configManager.ts:22-29` derives the AES-256-GCM encryption key through a fallback chain:

1. `FIELD_ENCRYPTION_KEY` or `ENCRYPTION_KEY` (if >= 64 chars)
2. SHA-256 of `SESSION_SECRET`
3. SHA-256 of `"acreos-dev-config-key-insecure"`

If a deployment starts with fallback #3, credentials are encrypted. If the deployer later sets `FIELD_ENCRYPTION_KEY`, all previously encrypted values become undecryptable (wrong key). There is a key rotation script (`server/scripts/rotateEncryptionKey.ts`), but nothing warns the founder about this cliff.

**Remediation:** Log a prominent warning at startup when using a fallback key. Block credential storage (not just warn) when using the insecure fallback in production.

---

#### F065-05: Setup wizard credentials UI is well-designed
**Severity: Positive**

The founder setup wizard (`server/routes-setup.ts`) with the `configManager` and `CREDENTIAL_DEFINITIONS` array is a strong design:
- 24 credentials across 13 service groups, each with `isSecret`, `isRequired`, hints, and doc URLs.
- AES-256-GCM encryption at rest in the `platform_config` table.
- Env vars take precedence over DB values (line 78: `if (process.env[row.key]) continue`).
- Validation endpoints per service (`POST /api/founder/setup/validate/:service`).
- Auto-wire for Stripe webhooks.
- Masked display (last 4 chars only for secrets).

This is a mature credential management UI that few SaaS platforms at this stage implement.

---

#### F065-06: .env.example is comprehensive and well-documented
**Severity: Positive**

The `.env.example` file covers ~90 variables with clear section headers, inline comments, placeholder formats, and generation commands. Optional variables are commented out with `#`. The `.gitignore` correctly excludes `.env` and `.env.*` (but allows `.env.example`). No real `.env` file is tracked in git.

---

#### F065-07: APP_URL fallback inconsistency
**Severity: P3**

Throughout server code, `process.env.APP_URL` falls back to different defaults:

| Fallback | Files |
|----------|-------|
| `"http://localhost:5000"` | `oauth.ts`, `stripeConnect.ts` |
| `"https://app.acreos.io"` | `webhookHandlers.ts`, `growthAdService.ts`, `alertPolicy.ts`, `dunning.ts`, ~8 more (`dailyBriefing.ts` was also listed here — deleted 2026-08-01) |
| `"https://app.acreos.io"` | `listingSyndication.ts` |

The `.io` vs `.com` inconsistency means links in syndicated listings point to the wrong domain. The localhost fallback in production could leak internal URLs in OAuth callbacks.

**Remediation:** Define `APP_URL` once in a shared config module with a single fallback. Mark it required in production via `secretsValidation.ts`.

---

#### F065-08: Public /api/config/features endpoint leaks feature topology
**Severity: P3**

`GET /api/config/features` is unauthenticated and returns the full list of enabled feature flag keys and their controlled routes. This lets anyone enumerate which modules are active, potentially revealing business strategy (e.g., whether capital markets, white-labeling, or voice AI are enabled).

**Remediation:** Consider requiring authentication, or return only the information needed for the current user's session.

---

## Summary Matrix

| ID | Lens | Severity | Finding |
|----|------|----------|---------|
| F064-01 | 064 | P2 | Four competing API surfaces for flags, with duplicate route registration |
| F064-02 | 064 | P2 | featureGate queries DB on every request, no caching |
| F064-03 | 064 | P2 | Four flag keys used in routes.ts have no seed data -- modules permanently 404 |
| F064-04 | 064 | P2 | Client defaults to show-all during loading -- sidebar flash |
| F064-05 | 064 | P2 | Agent flags in-memory only -- lost on redeploy |
| F064-06 | 064 | P3 | 5-minute client cache means stale flag state after toggle |
| F064-07 | 064 | P3 | featureGate fail-open on DB error exposes disabled features |
| F065-01 | 065 | P2 | 15+ env vars used in code but undocumented in .env.example |
| F065-02 | 065 | P1 | Hardcoded fallback secrets in production-facing cryptographic code |
| F065-03 | 065 | P2 | Two overlapping startup validators with conflicting requirements |
| F065-04 | 065 | P2 | Encryption key fallback chain risks data loss on key upgrade |
| F065-05 | 065 | -- | (Positive) Setup wizard credential management is well-designed |
| F065-06 | 065 | -- | (Positive) .env.example is comprehensive |
| F065-07 | 065 | P3 | APP_URL fallback inconsistency (.com vs .io vs localhost) |
| F065-08 | 065 | P3 | Unauthenticated /api/config/features leaks feature topology |
