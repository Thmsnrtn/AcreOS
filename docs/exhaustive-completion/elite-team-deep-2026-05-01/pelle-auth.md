# Pelle Lindqvist — Clerk + Auth Deep-Dive

**Author:** Pelle Lindqvist (ex-Auth0 6y → Clerk auth-flows team)
**Date:** 2026-05-01 — Wave 2 of the 87-persona AcreOS audit
**Inputs:** sam-security.md (R4 — 2FA non-functional), ines-reliability.md §4 (auth/session edge cases). My job: drill into Clerk integration depth.
**Files reviewed:** `server/auth/clerkAuth.ts`, `server/auth/routes.ts`, `server/middleware/getOrCreateOrg.ts`, `server/middleware/require2FA.ts`, `server/routes-2fa.ts`, `server/routes-organization.ts` (invitations + accept), `server/routes.ts` (Clerk proxy), `client/src/main.tsx`, `client/src/hooks/use-auth.ts`, `client/src/lib/clerk-session-recovery.ts`, `client/src/lib/queryClient.ts`, `shared/schema.ts` (organizationInvitations + users.passwordResetToken).

---

## 1. Verdict

The Clerk integration is **structurally sound but operationally fragile**: a single proxy URL hardcoded to one Clerk Frontend API instance, a JWKS fallback that fails silently, a 30s clock-skew window with zero telemetry, and a 2FA stack that — exactly as Sam called out — is wired against a session store that doesn't exist. Net: auth works, until it doesn't; when it doesn't, the failure mode is a wedged login state across every tab with no operator visibility.

---

## 2. Auth flow audit — flow-by-flow, file:line, edge case

### 2.1 Sign-in (Clerk-hosted widget → ticket → cookie)

- `client/src/main.tsx:39-56` — `<ClerkProvider proxyUrl="/__clerk">`. Single instance, no failover.
- `server/routes.ts:224-313` — Express route proxying every `/__clerk/*` to `https://possible-emu-83.clerk.accounts.dev`. **Hardcoded host (`routes.ts:248`)** — no env var. Rotating Clerk instances or migrating prod off the dev FAPI host requires a code change + redeploy, not a config flip. **Bug class: configuration-as-code.**
- `client/src/hooks/use-auth.ts:75-126` — `useAuth()` ignores Clerk's in-memory `Clerk.session` entirely (Cycle 3 / Option B comment) and trusts the server's `/api/auth/user` 200/401 result. This is the right call given the 6.7.4 hydration bug but: **if Clerk's hosted FAPI returns 5xx during sign-in, the client has no fallback path** — `installClerkSessionRecovery` keeps retrying `__internal_reloadInitialResources()` for 10s then gives up silently (`clerk-session-recovery.ts:104-116`).
- **Edge case A:** sign-in completes server-side (cookie stamped) but Clerk's `/v1/client` returns empty sessions (the documented hydration bug). `clerk-session-recovery.ts:73-90` promotes the first cookie-implied session by calling `Clerk.setActive(...)`. If `Clerk.setActive` throws (e.g. session was just revoked from a different device), the `catch {}` swallows and we're wedged. **Add a retry counter + observable failure path.**

### 2.2 First-request hydration (`hydrateUser`)

`server/auth/clerkAuth.ts:20-109`

- The race comment at `:65-67` is honest: 9+ parallel queries hit on first dashboard load. `ON CONFLICT DO NOTHING + reSELECT` is correct. ✓
- **Bug B (latent):** if the Clerk admin API call `clerkClient.users.getUser(userId)` at `:68` fails (rate-limited at scale, transient 5xx), the entire request 500s. The user lives in Clerk but not in our DB; subsequent requests will keep hitting this slow path until it succeeds. **Fix: insert a minimal row from JWT claims (`sub`, `email` if `email_verified`) when Clerk Admin API is unavailable, then opportunistically backfill `firstName/lastName/imageUrl` on next success.**
- **Bug C:** `req.auth?.userId` is read at `:21` but the JWT-fallback path at `:25-44` parses `payload.sub` directly. It does **not** verify `payload.iss` matches our Clerk instance. A token signed with the same `CLERK_JWT_KEY` for any other Clerk app on the same `possible-emu-83.clerk.accounts.dev` instance would be accepted. Low practical risk (one app per instance), but it's a missing belt-and-suspenders check. **Add `payload.iss === expectedIssuer` and `payload.azp` allowlist.**
- **Bug D:** the JWT fallback verifies signature with `CLERK_JWT_KEY` but never checks `payload.nbf`. If a wall-clock-skewed instance issues a token with `nbf` 30s ahead of our wall clock, we accept it. Not a security bug (Clerk owns issuance) but a correctness bug if Clerk ever introduces nbf-based replay protection.

### 2.3 Session keep-alive

`client/src/lib/clerk-session-recovery.ts:139-161`

- Touch every 30s. JWT TTL is 60s. Server grace is 30s (`clerkAuth.ts:40`). Effective max age on the wire = ~60s. **Headroom = 0** if a touch ever drops.
- **Bug E (medium):** `setInterval` in a backgrounded tab gets throttled by browsers to ≥1Hz minimum, but Chrome/Firefox aggressively throttle to ≥1/min after 5 min hidden. A backgrounded tab returning after 10 min has an expired cookie + no session in memory. The `visibilitychange` listener at `:188-190` calls `fireRecovery()` → `promoteActiveIfNeeded()` → `reloadClientIfCookieAlive()`. But the cookie itself may have expired (Clerk's `__session` cookie is `Max-Age=60` per JWT TTL? — verify; if so, returning to a backgrounded tab will see no cookie at all and `useAuth` will treat the user as logged out). **Fix: on `visibilitychange === 'visible'`, force `touchSession()` synchronously before the recovery sweep.**

### 2.4 Logout

`client/src/hooks/use-auth.ts:98-117` + `server/auth/routes.ts:40-64`

- Belt-and-suspenders: server clears every Clerk-prefixed cookie it can see in the request, client clears canonical names by overwriting with `expires=1970`, then `signOut({ redirectUrl: '/auth' })`.
- **Bug F (high):** **No `BroadcastChannel` for cross-tab logout.** Tab A logs out — server cookies cleared, Clerk SDK in tab A signs out. Tab B has its own in-memory `Clerk.session`, its own React Query cache hydrated with PII. Tab B will keep working **until its next 401**, at which point `refreshSessionCookie` will fire, succeed against the no-longer-existent session (the touch endpoint will 401 since cookie is gone), and the user sees "Session expired." Worst case window: 30s of authenticated tab-B activity after tab-A logout. For most apps this is fine; **for an app holding skip-trace dossiers and signed deeds, "30 seconds of stale-session PII" is unacceptable.**
- **Fix:** subscribe to `BroadcastChannel('acreos-auth')` in `useAuth`; on receiving `{type:'logout'}` clear React Query, redirect to `/auth`. Post the message in `logout()` before `signOut`. ~15 lines of code.

### 2.5 Account recovery (password reset)

- `shared/models/auth.ts:128-129` defines `passwordResetToken` + `passwordResetExpiresAt` columns.
- `grep -rn "passwordResetToken" server/` — **zero hits in route handlers.** The columns are dead schema. Clerk owns the password-reset flow today (the hosted widget at `clerk.acreos.io` proxy).
- **Risk:** the columns exist, so a future engineer wires a "forgot password" page through them, races against Clerk's flow, and we end up with two parallel reset stacks. **Fix: drop the columns in a follow-up migration, or add a comment marking them deprecated.** If we ever leave Clerk we'll need them, but right now they're a footgun.
- **Single-use / rotation / TTL:** N/A — Clerk owns this. Confirm Clerk dashboard policy: tokens single-use ✓, TTL 1h is Clerk default ✓ (verify in dashboard), rate-limit on resend ≤5/hr (verify).

### 2.6 Invite flow

`server/routes-organization.ts:1133-1338` (token generation, create, accept)

- **Token:** 24 random bytes via `globalThis.crypto.getRandomValues` → base64url. ✓ 192 bits of entropy.
- **TTL:** 14 days hardcoded at `:1177`. Reasonable, but **not configurable per-org and not surfaced to the inviter**. ("The link expires in 14 days" should appear in the email + the invite-management UI.)
- **Single-use:** enforced by `status` check at `:1265` (`status !== "pending"`). ✓
- **Email-binding:** `:1270-1272` rejects accept if signed-in user's email doesn't match the invite email. Good.
- **Bug G (medium):** **No rate-limit on invite creation.** A compromised admin account could enqueue 200 invites/request × thousands of requests = mass spam from your domain → SendGrid suspension. Add per-org `maxInvitesPerDay` (e.g. 100) gate.
- **Bug H (low):** `:1262-1263` looks up by `eq(token)` only — no constant-time compare. Token is opaque random and stored hashed-or-not? **It's stored plaintext (`token: text("token").notNull().unique()`).** A read-only DB leak = every outstanding invite link compromised. **Fix: store SHA-256 of token; `accept` re-hashes the supplied param and queries by hash.** Same pattern Sam recommends for skip-trace results (R3) — same threat model.
- **Bug I (medium):** the response at `:1213-1223` echoes the raw token + link back to the inviter's UI. That's fine for the operator UI (they're the inviter), but the audit log entry at `:1205` writes `metadata: { token: row.token }` — **the audit log now contains an unhashed live invite token for 14 days.** Anyone with audit-log read access can hijack pending invites. **Fix: redact `token` from audit metadata.**
- **Bug J:** the shadow-org cleanup at `:1298-1327` deletes the user's auto-created org if it has zero leads/properties/deals/notes. **It does not check for: `campaigns`, `documents`, `signatures`, `payments`, `audit_log` rows.** A user who joined the platform, created a draft campaign, then got invited to a real org will have the draft silently destroyed. **Fix: extend the empty-check to all org-scoped tables, or just skip cleanup and let the user explicitly archive their shadow.**
- **Bug K (high):** `accept` is `isAuthenticated`-gated but **not `getOrCreateOrg`-gated**. That's intentional — the user may not have an org yet. But it means a malicious authenticated user can repeatedly POST stolen tokens; there's no rate-limit. **Add per-user rate limit on accept (10/hr).**

### 2.7 2FA — confirms Sam's R4 in detail

`server/routes-2fa.ts:51-52, 72-73, 126, 139` + `server/middleware/require2FA.ts:31`

- All 6 endpoints write/read `(req as any).session.X`. Express has **no session middleware mounted** (Clerk replaced Passport; nobody re-added `express-session`).
- Net behavior:
  - `POST /api/auth/2fa/setup` — line 51 sets `session.pendingTwoFactorSecret`; runtime throws TypeError reading property of undefined, caught by the outer try/catch, returned as a 500.
  - `POST /api/auth/2fa/verify-setup` — same. Cannot complete activation.
  - `POST /api/auth/2fa/verify` — same.
- **Bug L:** even if session middleware *were* mounted, `require2FA.ts:50-53` `catch` block calls `next()` (fail-open) on DB error. That's a deliberate availability choice but it means a Postgres outage = silent 2FA bypass. **At least log a structured `auth.2fa_failopen_total` counter so this is visible.**
- **Recommendation: rip 2FA out and use Clerk's native MFA.** Clerk supports TOTP + SMS + backup codes out of the box. The session-store mismatch isn't a fixable bug, it's a wrong-architecture bug. ~1 day to migrate, drops 184 lines of `routes-2fa.ts` + 55 lines of `require2FA.ts`.

---

## 3. Clerk integration risks — what to harden

| # | Risk | File:line | Fix | Effort |
|---|---|---|---|---|
| 1 | Clerk FAPI host hardcoded | `server/routes.ts:248` | `CLERK_FAPI_HOST` env var | 15 min |
| 2 | JWKS desync silently 401s entire app | `server/auth/clerkAuth.ts:36` | Boot probe: sign + verify a known JWT, fail-fast on mismatch | 1 hr |
| 3 | No `iss`/`azp` check in JWT fallback | `server/auth/clerkAuth.ts:31` | Add issuer/azp allowlist | 30 min |
| 4 | Clerk Admin API outage = 500 storm | `server/auth/clerkAuth.ts:68` | Insert minimal row from JWT claims, backfill async | 2 hr |
| 5 | Single proxy upstream, no circuit-breaker | `server/routes.ts:266` | Track 5xx ratio, return cached `/v1/environment` for 60s on breaker open | 4 hr |
| 6 | `/v1/environment` cache stored on `globalThis` | `server/routes.ts:239,303` | Migrate to Redis or per-instance LRU; the global is fine for one box but breaks under multi-instance Fly | 1 hr |
| 7 | 30s grace + 30s touch interval = 0 headroom | `client/src/lib/clerk-session-recovery.ts:161` | Touch every 20s, server grace at 60s, instrument `auth.jwt_grace_used_total` | 2 hr |
| 8 | No telemetry on Clerk proxy 5xx, latency | `server/routes.ts:266` | Wrap fetch in metrics middleware, alert on p95 > 500ms | 2 hr |
| 9 | `Clerk.setActive` errors swallowed | `client/src/lib/clerk-session-recovery.ts:87` | Surface to Sentry; if persistent, force `signOut` | 30 min |
| 10 | `installClerkSessionRecovery` polls for 10s then gives up | `clerk-session-recovery.ts:112` | Continue indefinitely behind exponential backoff; show a "Reconnecting…" banner | 2 hr |

---

## 4. Cross-tab + session lifecycle behaviors

### 4.1 What works today
- Cookies are domain-scoped to `.acreos.io` (`server/routes.ts:279`) so tabs share the `__session` cookie. ✓
- Each tab independently runs `setInterval(touchSession, 30_000)` at `clerk-session-recovery.ts:161` — over-provisioned but harmless. **5 tabs = 5 touches/30s = 10 touches/min** against Clerk's FAPI per user. At 1000 users this is 10k touches/min — within Clerk's published limits but worth instrumenting before we hit 10k users.
- 401-on-fetch triggers `refreshSessionCookie` (`queryClient.ts:187-207`) — same touch path, racey across tabs but idempotent at the cookie level.

### 4.2 What's broken
- **Cross-tab logout** — Bug F above. **Highest priority fix.**
- **Cross-tab login** — if user logs in on tab A while tab B is open and sitting on `/auth`, tab B doesn't notice. `BroadcastChannel('acreos-auth')` `{type:'login'}` should redirect tab B to `/today` (or at least invalidate `["/api/auth/user"]`).
- **Cross-tab refresh storm** — if all 5 tabs hit a 401 at the same time (post-resume from sleep), all 5 fire `refreshSessionCookie` in parallel. Clerk's idempotent on the touch endpoint, but the wasted load is real. Coordinate via `BroadcastChannel` + a `localStorage` "refresh leader election" pattern: first tab to grab the lock touches, others wait 200ms then re-check the cookie.
- **Cross-tab org switch (future)** — once we add Clerk org switching (or our own internal one): a switch in tab A invalidates org-scoped data in tab B silently. Hook into the same broadcast channel.

### 4.3 Idle timeout vs absolute timeout — undocumented

- **Absolute lifetime:** Clerk-managed. Default 7d. **Not documented in repo.**
- **Idle timeout:** Clerk's `inactivity_timeout` is dashboard-config. **Not set.** Today an unattended laptop in a coffee shop = indefinite session.
- **Server-side check:** none. Once `__session` is in the cookie jar, it's accepted until JWT expiry (Clerk auto-refreshes silently).
- **Recommendation:** set Clerk dashboard `session.lifetime = 7d`, `inactivity_timeout = 24h` (founder/admin: 4h). Document in `docs/auth-policy.md`. Add a server-side `last_activity_at` audit on every `/api/*` request and force re-auth if > inactivity threshold even if Clerk's still happy. Belt-and-suspenders.

---

## 5. Multi-tenant org-switching UX gaps

### 5.1 What exists
- Server: `getOrCreateOrg` at `server/middleware/getOrCreateOrg.ts:31` resolves to: (1) org user owns, (2) first active team membership, (3) auto-created shadow org. **No selection — first match wins.**
- Client: `useOrganization()` hook + `<OrgSwitcher />` ... I searched: there is **no org switcher component in client/src**. `useOrganization` returns the single resolved org from the server.

### 5.2 What's missing (this is the surprising one)
- **A user belonging to two orgs cannot choose which one to enter.** They get whichever the server resolves first. The `teamMembers` `.find((m) => m.isActive)` at `getOrCreateOrg.ts:60` is non-deterministic — Postgres `SELECT` without `ORDER BY` is implementation-defined.
- **Clerk supports `setActive({ organization: orgId })`.** We don't use it. The active org claim in the JWT (`org_id`) is never read by the server (`hydrateUser` only reads `sub`).
- **Server-side org resolution ignores client-side intent.** Even if a user changes their active Clerk org via `setActive`, our `getOrCreateOrg` doesn't honor it.

### 5.3 Required UX
1. **Org switcher in the sidebar/header** for users with ≥2 memberships. Clerk's `<OrganizationSwitcher />` is plug-and-play; or build our own backed by `GET /api/organizations/memberships`.
2. **Server reads `req.auth.orgId`** in `getOrCreateOrg` — if present and the user is a member of that org, scope to it. Falls back to first-active otherwise.
3. **Persistence:** active-org choice survives logout/login. Store on `users.lastActiveOrgId` (we don't have this column — add it).
4. **Cross-tab consistency:** broadcast org-switch over `BroadcastChannel('acreos-auth')` so tab B doesn't keep showing tab A's prior org's data.

Today this is a **dormant problem** because most customers have 1 org. As soon as a partner has two LLCs (a near-100% pattern in Land Investing) we ship the wrong data to the wrong screen and the trust story collapses.

---

## 6. Specific bugs found (severity-ordered)

| ID | Severity | Title | File:line | Notes |
|---|---|---|---|---|
| **AUTH-1** | **HIGH** | 2FA non-functional (no session store) | `routes-2fa.ts:51,72,126,139`; `require2FA.ts:31` | Sam's R4. Confirmed. Fix: migrate to Clerk native MFA. |
| **AUTH-2** | **HIGH** | No cross-tab logout — stale PII window up to 30s | `client/src/hooks/use-auth.ts:98` | Add `BroadcastChannel('acreos-auth')`. |
| **AUTH-3** | **HIGH** | Multi-org users cannot pick org; server resolution non-deterministic | `getOrCreateOrg.ts:60-69` | Honor `req.auth.orgId`. Add switcher. Add `users.lastActiveOrgId`. |
| **AUTH-4** | **HIGH** | Invite tokens stored plaintext; audit_log echoes live tokens | `routes-organization.ts:1185, 1205` | Hash tokens at rest; redact from audit. |
| **AUTH-5** | **MED** | Clerk FAPI host hardcoded; rotation requires deploy | `server/routes.ts:248` | Env var. |
| **AUTH-6** | **MED** | JWKS desync silently 401s entire app | `server/auth/clerkAuth.ts:36` | Boot probe + fail-fast. |
| **AUTH-7** | **MED** | 30s grace + 30s touch = 0 headroom; no telemetry | `clerkAuth.ts:40`; `clerk-session-recovery.ts:161` | Touch 20s, grace 60s, counter. |
| **AUTH-8** | **MED** | Clerk Admin API outage on first-touch = 500 storm | `clerkAuth.ts:68` | Minimal-row insert from JWT claims. |
| **AUTH-9** | **MED** | Backgrounded tab returns after browser-throttled interval = wedged session | `clerk-session-recovery.ts:188` | Synchronous `touchSession()` on visibilitychange. |
| **AUTH-10** | **MED** | No idle timeout; documented session policy missing | Clerk dashboard | Set `inactivity_timeout`, document. |
| **AUTH-11** | **MED** | Invite accept has no rate limit | `routes-organization.ts:1251` | Per-user 10/hr. |
| **AUTH-12** | **MED** | Shadow-org cleanup misses campaigns/docs/signatures | `routes-organization.ts:1298-1327` | Extend empty-check or skip cleanup. |
| **AUTH-13** | **LOW** | JWT fallback missing `iss` / `azp` / `nbf` checks | `clerkAuth.ts:31` | Add allowlist. |
| **AUTH-14** | **LOW** | `Clerk.setActive` failures swallowed | `clerk-session-recovery.ts:87` | Sentry breadcrumb + counter. |
| **AUTH-15** | **LOW** | `passwordResetToken` / `passwordResetExpiresAt` orphan columns | `shared/models/auth.ts:128-129` | Drop or document deprecated. |
| **AUTH-16** | **LOW** | `installClerkSessionRecovery` gives up after 10s | `clerk-session-recovery.ts:112` | Exponential backoff + visible "Reconnecting…" banner. |
| **AUTH-17** | **LOW** | `globalThis.__clerkCache` doesn't survive multi-instance | `server/routes.ts:239,303` | Per-instance LRU is fine; just don't pretend it's shared. |
| **AUTH-18** | **LOW** | No invite creation rate limit | `routes-organization.ts:1159` | Per-org max/day. |

---

## 7. The 1-week auth-hardening sprint

**Days 1-2 — kill the data-exposure footguns:**
1. **AUTH-2 cross-tab logout** via `BroadcastChannel('acreos-auth')`. Subscribe in `useAuth`; broadcast in `logout()` and on 401 with no cookie. Clear React Query, hard-redirect. *(½ day, P0)*
2. **AUTH-4 invite token hashing** — migration to add `tokenHash`, dual-write for one release, backfill, swap reads, drop plaintext column. Redact tokens from audit_log writes at `routes-organization.ts:1205`. *(1 day, P0)*

**Days 3-4 — fix the broken control plane:**
3. **AUTH-1 migrate to Clerk native MFA.** Delete `routes-2fa.ts`, `require2FA.ts`, `users.twoFactorSecret/Enabled/BackupCodes`. Wire Clerk's `<UserProfile />` MFA section. Server admin guard becomes `req.auth.factor_verified === true`. *(1 day, P0; closes Sam's R4)*
4. **AUTH-3 multi-org switcher** — read `req.auth.orgId` in `getOrCreateOrg`; add `users.lastActiveOrgId`; ship `<OrgSwitcher />` (Clerk's component, gated on memberships > 1). *(1 day, P0)*

**Day 5 — operational hardening:**
5. **AUTH-6 JWKS boot probe** — sign + verify a synthetic JWT at startup; fail-fast on mismatch. *(1 hr, P1)*
6. **AUTH-7 telemetry** — `auth.jwt_grace_used_total{instance}`, `auth.touch_count_total`, `auth.401_after_refresh_total`. Grafana panel. *(2 hr, P1)*
7. **AUTH-5** Clerk FAPI host env var. *(15 min, P1)*
8. **AUTH-8** Minimal-row insert fallback when Clerk Admin API fails. *(2 hr, P1)*
9. **AUTH-9** Synchronous `touchSession()` on `visibilitychange === 'visible'`. *(30 min, P1)*
10. **AUTH-10** Set Clerk dashboard `inactivity_timeout = 24h` (4h for founder/admin). Document in `docs/auth-policy.md`. *(30 min, P1)*

**Stretch (week 2):**
- AUTH-11 invite-accept per-user rate limit
- AUTH-12 shadow-org cleanup extended check
- AUTH-13 iss/azp/nbf claim checks
- AUTH-14 Sentry breadcrumb on `Clerk.setActive` failure
- AUTH-15 drop or comment dead password-reset columns
- AUTH-16 indefinite recovery with banner
- AUTH-18 per-org invite rate limit

---

## Closing

The team did the hard part: convinced Clerk's broken-in-our-config SDK to work via cookie-cookie auth (`use-auth.ts:7-16`), proxied FAPI through our own domain to dodge Cloudflare's clerk.acreos.io block, and built the touch-keep-alive that papers over the hydration bug. That's the kind of work that doesn't show up in a feature changelog but separates "auth works in prod" from "auth works in the demo."

The remaining bugs cluster around two themes: **(1) cross-tab + multi-tab state isn't coordinated at all** — every tab is a solitary little auth state machine talking to the server, with no sibling awareness. Fix: one `BroadcastChannel`, three subscribers (logout, login, org-switch), done. **(2) Operator visibility into Clerk health is zero.** Fix: 4 metrics + 2 alerts (JWKS desync at boot, grace > 0.1% over 5 min). After those two fixes the foundation is genuinely production-grade.

The 2FA bug (Sam's R4) is the urgent thing. The cross-tab logout (mine, AUTH-2) is the *next* urgent thing — it's not exploitable through the front door, but it's the kind of bug that becomes a Twitter post the day after we close our Series A.

— Pelle Lindqvist
