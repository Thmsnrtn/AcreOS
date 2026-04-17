# Lens 33 -- Auth Specialist Audit

**Auditor:** Auth Specialist (Lens 33)
**Date:** 2026-04-15
**Scope:** Complete authentication and authorization chain from sign-in to session management to route protection
**Severity Scale:** P0 = auth bypass or user cannot sign in, P1 = session management gap, P2 = UX improvement

---

## 1. Architecture Overview

### Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Client auth provider | `@clerk/react` | 6.1.3 |
| Server auth middleware | `@clerk/express` | 2.0.7 |
| Session transport | Cookie (`__session` JWT, `__client_uat`) |
| Proxy | Custom `/__clerk` Express handler (Cloudflare workaround) |
| JWT fallback | Manual RSA-SHA256 verification via `CLERK_JWT_KEY` |
| OAuth (legacy) | Custom Passport-less code exchange in `server/auth/oauth.ts` |

### Key Files

| File | Role |
|------|------|
| `client/src/main.tsx` | ClerkProvider configuration |
| `client/src/pages/auth-page.tsx` | Sign-in / sign-up page with Clerk components |
| `client/src/hooks/use-auth.ts` | Client-side auth state hook |
| `client/src/App.tsx` | ProtectedRoute, FounderProtectedRoute, HomeRoute wrappers |
| `server/auth/clerkAuth.ts` | isAuthenticated, hydrateUser, requireFounder middleware |
| `server/auth/routes.ts` | `/api/auth/user` endpoint |
| `server/auth/oauth.ts` | Legacy Google/Microsoft OAuth code exchange |
| `server/routes.ts` (lines 214-283) | `/__clerk` proxy handler |
| `server/routes.ts` (lines 370-378) | clerkMiddleware global registration |
| `server/middleware/security.ts` | CSP headers affecting Clerk JS loading |
| `server/middleware/getOrCreateOrg.ts` | Organization auto-provisioning |
| `server/index.ts` | Middleware ordering |

---

## 2. Complete Auth Flow Diagram

### Happy Path: New User Signs In via Google OAuth

```
User clicks "Continue with Google" in <SignIn routing="hash" />
  |
  v
Clerk JS (loaded via /__clerk proxy) opens Google OAuth popup/redirect
  |
  v
Google consent screen -> user approves -> Google returns auth code to Clerk FAPI
  |
  v
Clerk FAPI exchanges code, creates/links External Account, issues session JWT
  |
  v
Clerk JS receives session, sets __session cookie (domain rewritten to acreos.io
by /__clerk proxy's set-cookie rewrite)
  |
  v
Clerk React's useUser() updates: isSignedIn=true, isLoaded=true
  |
  v
auth-page.tsx detects isSignedIn + checks for `user` from useAuth()
  |
  v
useAuth() hook: isSignedIn=true triggers react-query for GET /api/auth/user
  |
  v
GET /api/auth/user hits server middleware chain:
  1. securityHeaders (generates CSP nonce)
  2. corsMiddleware
  3. requestTimeout
  4. sanitizeQueryParams
  5. express.json / express.urlencoded / cookieParser
  6. authLimiter (rate limit: 20 req / 15 min)
  7. /__clerk proxy (skipped -- path doesn't match)
  8. whiteLabelDomainMiddleware
  9. clerkMiddleware (parses __session JWT -> sets req.auth.userId)
  10. isAuthenticated middleware (on this specific route)
  11. hydrateUser (looks up/creates DB user, sets req.user)
  |
  v
/api/auth/user returns user JSON (with isFounder flag if applicable)
  |
  v
auth-page.tsx: isLoaded=true, isSignedIn=true, user!=null -> <Redirect to="/today" />
  |
  v
/today -> ProtectedRoute -> user exists -> render TodayPage
```

### Failure Paths (numbered, see Section 3)

```
                              [F1] afterSignInUrl is IGNORED
                                   in Clerk v6
Clerk <SignIn> component -------> OAuth popup/redirect opens
         |                                    |
         |                          [F2] /__clerk proxy rewrites
         |                               location header incorrectly
         |                               for OAuth callback URLs
         |                                    |
         |                          [F3] No AuthenticateWithRedirectCallback
         |                               component mounted anywhere
         v                                    |
  OAuth returns to                   [F4] "External Account not found"
  /auth#/sso-callback                     error from Clerk -- no route
         |                                handles this hash fragment
         |
         v
  <SignIn routing="hash" />
  tries to process #/sso-callback
         |
         |--- [F5] SignIn can handle this IF it's still mounted, but
         |         if user was redirected elsewhere, component unmounts
         |
         v
  Session established (if lucky)
         |
         v
  useAuth() fires GET /api/auth/user
         |
         |--- [F6] clerkMiddleware can't verify JWT if CLERK_JWT_KEY
         |         or proxy URL is misconfigured
         |
         |--- [F7] JWT fallback has 5-min grace period on expired
         |         tokens -- security concern
         |
         v
  hydrateUser creates/finds DB user
         |
         |--- [F8] Race condition: Clerk user not yet propagated
         |         when hydrateUser calls clerkClient.users.getUser()
         |
         v
  ProtectedRoute checks user
         |
         |--- [F9] authFailCount retry loop with stale __session cookie
         |         keeps user stuck on loader indefinitely
         |
         v
  Dashboard renders (or infinite spinner)
```

---

## 3. Failure Points -- Detailed Analysis

### F1 [P0]: `afterSignInUrl` and `afterSignUpUrl` Props Are Deprecated/Ignored in Clerk v6

**Location:** `client/src/main.tsx:34-35`, `client/src/pages/auth-page.tsx:34,39`

**Evidence:** The installed Clerk version is `@clerk/react@6.1.3`. Examining the type definitions in `node_modules/@clerk/shared/dist/types/index.d.mts`:

- `ClerkOptions` (which feeds `IsomorphicClerkOptions` which feeds `ClerkProviderProps`) composes from `SignInForceRedirectUrl`, `SignInFallbackRedirectUrl`, `SignUpForceRedirectUrl`, `SignUpFallbackRedirectUrl`. These types define props: `signInForceRedirectUrl`, `signInFallbackRedirectUrl`, `signUpForceRedirectUrl`, `signUpFallbackRedirectUrl`.
- `SignInProps` defines `forceRedirectUrl` and `fallbackRedirectUrl`.
- `afterSignInUrl` exists only on `DisplayConfigResource` (the Clerk dashboard config), NOT on component props.

The code passes `afterSignInUrl="/today"` and `afterSignUpUrl="/today"` to both `<ClerkProvider>` and `<SignIn>`/`<SignUp>`. These are **not recognized props** in Clerk v6. Clerk JS silently ignores unknown props, which means:

1. After Google OAuth completes, Clerk has no configured redirect destination.
2. Clerk falls back to its dashboard-configured `afterSignInUrl` (which may be `/` or unset).
3. User ends up at `/` (which is `HomeRoute` -> if authed, redirects to `/today`, but timing issues cause flicker).

**Impact:** After successful OAuth, user is not reliably redirected to `/today`. Depending on timing, they may land on `/`, `/auth`, or see a flash of the landing page before being redirected. This is the primary cause of the "redirect loop" reports.

**Fix:**
```tsx
// main.tsx -- ClerkProvider
<ClerkProvider
  publishableKey={publishableKey}
  proxyUrl="/__clerk"
  signInFallbackRedirectUrl="/today"
  signUpFallbackRedirectUrl="/today"
>

// auth-page.tsx -- SignIn/SignUp components
<SignIn
  routing="hash"
  fallbackRedirectUrl="/today"
/>
<SignUp
  routing="hash"
  fallbackRedirectUrl="/today"
/>
```

---

### F2 [P0]: Cookie Domain Rewrite Strips the Leading Dot

**Location:** `server/routes.ts:261`

**Code:**
```ts
res.appendHeader(key, value.replace(/domain=[^;]+/gi, "domain=acreos.io"));
```

**Problem:** The replacement sets `domain=acreos.io` instead of `domain=.acreos.io`. Per RFC 6265, when the domain attribute is present, it must be dot-prefixed to match subdomains. Without the leading dot:
- Cookies set on `acreos.io` will be sent to `acreos.io` only.
- If any Clerk flows redirect through `www.acreos.io` or other subdomains, the `__session` cookie is not sent, causing auth to break.

The client-side logout code (`use-auth.ts:67`) clears `__client_uat` with `domain=.acreos.io` but clears `__session` with `domain=acreos.io` (line 65). This inconsistency means `__client_uat` might persist on subdomains after logout.

**Impact:** Authentication cookies may not be scoped correctly, causing intermittent session loss when the domain varies.

**Fix:**
```ts
res.appendHeader(key, value.replace(/domain=[^;]+/gi, "domain=.acreos.io"));
```
Also align the client-side cookie clearing in `use-auth.ts` to use `domain=.acreos.io` consistently for both cookies.

---

### F3 [P1]: No SSO Callback Handler Component

**Location:** `client/src/App.tsx` -- no route for SSO callback

**Evidence:** Searched the entire `client/src` directory for `AuthenticateWithRedirectCallback`, `HandleSSOCallback`, `sso-callback`, and `handleRedirectCallback`. Zero results.

**Problem:** When Clerk uses redirect-based OAuth (not popup), the browser navigates to `https://acreos.io/auth#/sso-callback?...` after the OAuth provider returns. The `<SignIn routing="hash">` component can process this hash fragment **only if it is mounted at that time**. If anything causes the auth page to unmount (e.g., the `isSignedIn` check in `auth-page.tsx:15` triggering a redirect before the SSO callback finishes), the callback is lost and the user sees "External Account not found" or gets stuck.

With Clerk's `routing="hash"` mode, the `<SignIn>` component handles the `#/sso-callback` internally. However, the auth page has this logic:

```tsx
if (isLoaded && isSignedIn && user) {
  return <Redirect to="/today" />;
}
```

There is a timing window where `isSignedIn` becomes true (Clerk received the session) but the SSO callback hash fragment has not been fully processed. The premature redirect unmounts `<SignIn>`, and if the callback flow needed further processing (e.g., linking the external account), it fails silently.

**Impact:** Intermittent "External Account not found" errors and failed OAuth flows, especially on first sign-up via Google.

**Fix:** Add an explicit check for the SSO callback hash before redirecting:

```tsx
// auth-page.tsx
const isHandlingCallback = window.location.hash.includes("sso-callback") ||
                           window.location.hash.includes("verify");

if (isLoaded && isSignedIn && user && !isHandlingCallback) {
  return <Redirect to="/today" />;
}
```

Alternatively, mount `AuthenticateWithRedirectCallback` on a dedicated route as a safety net, though with `routing="hash"` the above fix is more appropriate.

---

### F4 [P0]: Legacy OAuth Routes Create Users Outside Clerk

**Location:** `server/auth/oauth.ts`

**Problem:** The legacy OAuth routes (`/api/auth/google`, `/api/auth/microsoft`) perform a manual OAuth code exchange, create a user directly in the database, and then redirect to `/auth`. This user record has no `clerkUserId` set because the Clerk session was never established.

```ts
// oauth.ts line 83-92
const [newUser] = await db
  .insert(users)
  .values({
    id: userId,  // crypto.randomUUID()
    email,
    firstName: profile.firstName,
    ...
  })
  .returning();
```

Note that `clerkUserId` is never set. When this user later goes through Clerk's auth flow, `hydrateUser` searches by `clerkUserId`:

```ts
// clerkAuth.ts line 53-57
let [user] = await db
  .select()
  .from(users)
  .where(eq(users.clerkUserId, userId))  // userId here is the CLERK user ID
  .limit(1);
```

This means:
1. The legacy OAuth creates a user record with a random UUID as id but null clerkUserId.
2. When the same user signs in via Clerk, `hydrateUser` doesn't find them (different lookup column).
3. `hydrateUser` creates a SECOND user record with the clerkUserId set.
4. The user now has two database records, and the org/data from the legacy record is orphaned.

**Impact:** Duplicate user records, lost organization data, confused state. If the legacy OAuth routes are still reachable (they are -- registered on line 388-389 of `server/routes.ts`), users who hit them will have broken experiences.

**Fix:** Either:
1. Remove the legacy OAuth routes entirely (Clerk handles OAuth natively).
2. Or modify `hydrateUser` to also look up by email as a fallback, and link the clerkUserId to the existing record.

Recommended: Remove the legacy routes. They serve no purpose since Clerk handles OAuth. The comment in the code even says "redirect to Clerk sign-in so Clerk can establish a proper session."

---

### F5 [P1]: JWT Fallback Accepts Tokens 5 Minutes Past Expiry

**Location:** `server/auth/clerkAuth.ts:38-39`

**Code:**
```ts
const GRACE_PERIOD_MS = 5 * 60 * 1000;
if (isValid && payload.sub && payload.exp * 1000 > Date.now() - GRACE_PERIOD_MS) {
```

**Problem:** This accepts JWTs that expired up to 5 minutes ago. Clerk session JWTs typically have a 60-second lifetime and are refreshed continuously. A 5-minute grace period means:
- A stolen session JWT remains valid for 5 minutes after the user signs out.
- If a user revokes their session in Clerk, the JWT fallback still honors it for 5 minutes.

**Impact:** Session revocation is not immediate when the JWT fallback is in use. This is a security concern, especially for compromised accounts.

**Fix:** Reduce grace period to 60 seconds (matching Clerk's JWT lifetime) or eliminate it:
```ts
const GRACE_PERIOD_MS = 60 * 1000; // 1 minute max
```

---

### F6 [P1]: `useAuth` Hook Has Overly Permissive `isAuthed` Check

**Location:** `client/src/hooks/use-auth.ts:58`

**Code:**
```ts
const isAuthed = !!(isSignedIn || user);
```

**Problem:** This considers the user authenticated if EITHER Clerk says `isSignedIn` OR the `user` object exists from the API. This means:
1. If Clerk's session expires but the stale `user` object is still in react-query cache (up to 10 minutes per `gcTime`), `isAuthed` is true even though the session is invalid.
2. The user can access protected routes with stale cached data while their actual session is dead.

**Impact:** Users see protected content with a dead session. Any API call will fail with 401, but the UI won't redirect to login until the cached user data expires.

**Fix:**
```ts
const isAuthed = !!(isSignedIn && user);
```

Changing `||` to `&&` ensures both Clerk and the app agree the user is authenticated. The `hasSessionCookie` fallback in the `enabled` check already handles the Cloudflare edge case.

---

### F7 [P1]: ProtectedRoute Infinite Spinner When Session Cookie Is Stale

**Location:** `client/src/App.tsx:238-246`

**Code:**
```tsx
const hasSessionCookie = typeof document !== "undefined" && document.cookie.includes("__session=");

if (!user) {
  if (hasSessionCookie && authFailCount < 3) {
    return <PageLoader />;  // Infinite spinner if cookie persists
  }
  return <Redirect to="/auth" />;
}
```

**Problem:** The `authFailCount` is a module-level variable that increments on 401 responses. However:
1. The counter is only incremented in `fetchAppUser()` (the react-query function), which has `retry: (failureCount) => failureCount < 2` and `retryDelay: 5000`.
2. With 2 retries at 5-second delays, it takes 10+ seconds before `authFailCount` reaches 3.
3. During this time, the user sees an infinite spinner.
4. If the `__session` cookie is stuck (e.g., due to the domain mismatch from F2), the cookie check passes indefinitely, and the user is stuck on the spinner until they manually clear cookies.

**Impact:** Users with stale session cookies see an infinite loading spinner for 10+ seconds before being redirected to login. If cookies are stuck, they may never be redirected.

**Fix:** Reduce the spinner timeout and add a time-based fallback:
```tsx
if (!user) {
  if (hasSessionCookie && authFailCount < 2) {
    return <PageLoader />;
  }
  return <Redirect to="/auth" />;
}
```
Also consider setting `authFailCount` to 3 on explicit 401 (no retry needed).

---

### F8 [P1]: Clerk Proxy Caches May Serve Stale Session State

**Location:** `server/routes.ts:219-227`

**Code:**
```ts
if (req.method === "GET" && (clerkPath === "/v1/environment" || clerkPath.startsWith("/v1/client"))) {
  const cacheKey = `clerk:${clerkPath}:${req.headers.cookie?.match(/__client=([^;]{0,20})/)?.[1] || "anon"}`;
  if ((globalThis as any).__clerkCache?.[cacheKey] && Date.now() - (globalThis as any).__clerkCache[cacheKey].ts < 60000) {
    // ... serve cached response
  }
}
```

**Problem:** The proxy caches `/v1/client` responses (which include session state) for 60 seconds. The cache key includes only the first 20 characters of the `__client` cookie. This means:
1. After signing out, the cached client response may still report an active session for up to 60 seconds.
2. After signing in, the cached response may not reflect the new session for up to 60 seconds.
3. If two users share a browser (unlikely but possible), the truncated cookie key could collide.

**Impact:** Auth state inconsistency for up to 60 seconds after login/logout. Users may see "phantom" sessions or fail to see their new session.

**Fix:** Either:
1. Do not cache `/v1/client` responses (only cache `/v1/environment`).
2. Or invalidate the client cache on POST requests to Clerk endpoints (which signal state changes).

---

### F9 [P2]: Auth Route Uses Raw Response Instead of Errors Helper

**Location:** `server/auth/clerkAuth.ts:49,110,120,125`

**Evidence:** The CLAUDE.md engineering standards require using `Errors.*` helpers from `server/utils/errors.ts`. The auth middleware uses raw `res.status(401).json(...)` and `res.status(404).json(...)` instead.

**Impact:** Inconsistent error response format. The `Errors.*` helpers produce `{ error, message, details?, statusCode }` while the auth middleware produces `{ error, message }` or just `{ message }`. Frontend error handling may not parse these correctly.

**Fix:** Use `Errors.unauthorized(res)` and `Errors.notFound(res, "Route")` instead of raw status calls.

---

### F10 [P2]: `console.warn` and `console.error` Used in Auth Code

**Location:** `server/auth/clerkAuth.ts:44`, `server/routes.ts:280`

**Evidence:** The CLAUDE.md standards require using the structured `logger` from `server/utils/logger.ts`. The JWT fallback error handler uses `console.warn` and the Clerk proxy error handler uses `console.error`.

**Impact:** These log messages bypass structured logging, PII masking, and correlation ID tracking.

**Fix:** Replace with `logger.warn(...)` and `logger.error(...)`.

---

### F11 [P0]: Dual OAuth Systems Create Conflicting Identity Flows

**Location:** `server/auth/oauth.ts` (registered at `server/routes.ts:388-389`)

**Problem:** The system has TWO completely separate OAuth implementations:

1. **Clerk-managed OAuth:** Handled entirely by the Clerk JS SDK. User clicks "Continue with Google" in the `<SignIn>` component, Clerk manages the entire OAuth flow, creates/links the external account, and issues a session.

2. **Legacy custom OAuth:** Registered at `/api/auth/google` and `/api/auth/microsoft`. Performs a manual code exchange, creates a user in the DB (without clerkUserId), and redirects to `/auth`.

These two systems are completely unaware of each other. The `.env.example` still documents `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for the legacy routes, but the actual Google OAuth for sign-in is handled by Clerk's dashboard configuration.

If someone configures `GOOGLE_CLIENT_ID` in the environment, the legacy routes activate and provide a second, broken OAuth path that creates orphaned user records.

**Impact:** Confused identity management. If any part of the UI links to `/api/auth/google`, the user gets a broken experience.

**Fix:** Remove or disable the legacy OAuth routes. Add a deprecation notice if they must remain for backwards compatibility.

---

### F12 [P2]: No Clerk Webhook for User Sync

**Evidence:** Searched the entire `server/` directory for "clerk webhook", "user.created", "user.updated", "svix". Zero results.

**Problem:** User profile changes made in Clerk (email change, name update, account deletion) are never synced back to the AcreOS database. The `hydrateUser` middleware only runs when the user makes an API request. If a user changes their email in Clerk's user management, the AcreOS `users` table retains the old email until their next request.

**Impact:** Stale user data. The `isFounderEmail` check uses the DB email, so a founder who changes their email in Clerk loses founder access until their next API call.

**Fix:** Implement a Clerk webhook endpoint that handles `user.created`, `user.updated`, and `user.deleted` events to keep the DB in sync.

---

### F13 [P2]: Rate Limiter on Auth Routes May Block Legitimate Retry Flows

**Location:** `server/index.ts:257-264`

**Code:**
```ts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  ...
});
app.use("/api/auth", authLimiter);
```

**Problem:** The rate limiter allows 20 requests per 15 minutes per IP to `/api/auth/*`. The `useAuth` hook's react-query config polls `/api/auth/user` with a `staleTime` of 30 seconds (normal) or 5 minutes (recently authed). Combined with retries on failure, a single user can easily hit 20 requests in 15 minutes during:
- Page refreshes
- Tab switching (react-query refetch on window focus)
- Auth failures triggering retries
- Multiple browser tabs open

Once rate-limited, the user gets 429 on `/api/auth/user`, which the hook treats as a non-401 error (throws), causing the UI to show an error state rather than redirecting to login.

**Impact:** Legitimate users locked out of auth for 15 minutes. Since the rate limit is per-IP, this especially affects shared office networks.

**Fix:** Either:
1. Exclude `/api/auth/user` from the auth rate limiter (it's a session check, not a login attempt).
2. Or increase the limit for GET requests to `/api/auth/user`.

---

### F14 [P1]: `hydrateUser` Uses `(req as any)` Typing

**Location:** `server/auth/clerkAuth.ts:19`

**Code:**
```ts
async function hydrateUser(req: any, res: any, next: any) {
```

**Evidence:** CLAUDE.md explicitly states: "Never use `(req as any)` -- the Express request is augmented with `organization`, `organizationId`, `permissionContext`, and `isFounder`."

**Impact:** Type safety bypass. Any misspelling or incorrect property access on `req` will not be caught at compile time.

**Fix:** Use `AuthenticatedRequest` type or at minimum the Express `Request` type.

---

## 4. Why Users Keep Getting Stuck

The reported symptoms are:

1. **"External Account not found"** -- Caused primarily by F3. The auth page's premature redirect (checking `isSignedIn` before the SSO callback completes) unmounts the `<SignIn>` component mid-flow. The Clerk SDK cannot finish linking the external account.

2. **Redirect loops** -- Caused by F1 + F6 combined:
   - F1: `afterSignInUrl` is silently ignored, so Clerk redirects to `/` instead of `/today`.
   - F6: `isAuthed` is true (from stale cache) but `user` is null (API returned 401). The `||` logic in `useAuth` means `isAuthed` stays truthy from Clerk's `isSignedIn`, but `user` is null. `ProtectedRoute` shows spinner, waits for retry, eventually redirects to `/auth`, which sees `isSignedIn=true` and redirects to `/today` (via HomeRoute or the auth page redirect), creating a loop.

3. **Infinite spinner** -- Caused by F7. Stale `__session` cookie (possibly from domain mismatch in F2) keeps the `hasSessionCookie` check true. The `authFailCount < 3` gate keeps showing the spinner through multiple retry cycles.

4. **Clerk modal overlay injecting over app** -- This is a symptom of Clerk's UI loading from CDN and rendering its default modal behavior. When `routing="hash"` is used but the redirect props are misconfigured (F1), Clerk may fall back to its modal/popup UI for SSO callbacks.

### Root Cause Chain

```
afterSignInUrl ignored (F1)
        |
        v
Clerk redirects to / or no redirect at all
        |
        +---> User lands on HomeRoute, which checks auth
        |     isSignedIn=true but user query hasn't resolved yet
        |     HomeRoute redirects to /today
        |
        +---> /today ProtectedRoute checks user
              user is null (query pending), shows spinner
              GET /api/auth/user fires
                |
                +---> Success: user loads, page renders (happy path, 1-3 second delay)
                |
                +---> Failure: 401 (proxy issue, JWT issue)
                      authFailCount increments
                      Spinner continues (F7)
                      Retry after 5s
                      Eventually authFailCount >= 3
                      Redirect to /auth
                      /auth sees isSignedIn=true
                      Tries to redirect to /today (via stale check)
                      LOOP
```

---

## 5. Specific Code Fixes Needed

### Fix 1: Update Clerk Redirect Props (P0)

**File:** `client/src/main.tsx`
```tsx
// BEFORE (lines 34-35):
afterSignInUrl="/today"
afterSignUpUrl="/today"

// AFTER:
signInFallbackRedirectUrl="/today"
signUpFallbackRedirectUrl="/today"
```

**File:** `client/src/pages/auth-page.tsx`
```tsx
// BEFORE (line 34):
afterSignInUrl="/today"
// AFTER:
fallbackRedirectUrl="/today"

// BEFORE (line 39):
afterSignUpUrl="/today"
// AFTER:
fallbackRedirectUrl="/today"
```

### Fix 2: Fix Cookie Domain (P0)

**File:** `server/routes.ts:261`
```ts
// BEFORE:
res.appendHeader(key, value.replace(/domain=[^;]+/gi, "domain=acreos.io"));
// AFTER:
res.appendHeader(key, value.replace(/domain=[^;]+/gi, "domain=.acreos.io"));
```

**File:** `client/src/hooks/use-auth.ts:65`
```ts
// BEFORE:
document.cookie = "__session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=acreos.io";
// AFTER:
document.cookie = "__session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.acreos.io";
```

### Fix 3: Prevent Premature Redirect on Auth Page (P0)

**File:** `client/src/pages/auth-page.tsx`
```tsx
// BEFORE (line 15):
if (isLoaded && isSignedIn && user) {
  return <Redirect to="/today" />;
}

// AFTER:
const isHandlingCallback = typeof window !== "undefined" &&
  (window.location.hash.includes("sso-callback") ||
   window.location.hash.includes("verify"));

if (isLoaded && isSignedIn && user && !isHandlingCallback) {
  return <Redirect to="/today" />;
}
```

### Fix 4: Fix `isAuthed` Logic (P1)

**File:** `client/src/hooks/use-auth.ts:58`
```ts
// BEFORE:
const isAuthed = !!(isSignedIn || user);
// AFTER:
const isAuthed = !!(isSignedIn && user) || !!(isSignedIn && userLoading);
```

This ensures: authenticated only when both Clerk AND the app agree, but also allows the loading state when Clerk says signed in and we're fetching the user.

### Fix 5: Reduce JWT Grace Period (P1)

**File:** `server/auth/clerkAuth.ts:38`
```ts
// BEFORE:
const GRACE_PERIOD_MS = 5 * 60 * 1000;
// AFTER:
const GRACE_PERIOD_MS = 60 * 1000;
```

### Fix 6: Remove or Disable Legacy OAuth Routes (P0)

**File:** `server/routes.ts:388-389`
```ts
// BEFORE:
const { registerOAuthRoutes } = await import("./auth/oauth");
registerOAuthRoutes(app);

// AFTER:
// Legacy OAuth routes removed -- Clerk handles OAuth natively.
// Keeping the file for reference but not registering the routes.
```

### Fix 7: Don't Cache /v1/client Responses (P1)

**File:** `server/routes.ts:219-227,270-275`

Remove `/v1/client` from the cache check, only cache `/v1/environment`:
```ts
// BEFORE:
if (req.method === "GET" && (clerkPath === "/v1/environment" || clerkPath.startsWith("/v1/client"))) {
// AFTER:
if (req.method === "GET" && clerkPath === "/v1/environment") {
```

### Fix 8: Exclude /api/auth/user from Auth Rate Limiter (P2)

**File:** `server/index.ts`
```ts
// Add before the authLimiter middleware:
app.use("/api/auth/user", (req, res, next) => {
  if (req.method === "GET") return next(); // Skip rate limiter for session checks
  next();
});
app.use("/api/auth", authLimiter);
```

### Fix 9: Use Structured Logger and Errors Helpers (P2)

**File:** `server/auth/clerkAuth.ts`
- Replace `console.warn` with `logger.warn`
- Replace `res.status(401).json(...)` with `Errors.unauthorized(res)`
- Replace `res.status(404).json(...)` with `Errors.notFound(res, "Route")`

**File:** `server/routes.ts:280`
- Replace `console.error` with `logger.error`

### Fix 10: Type hydrateUser Properly (P2)

**File:** `server/auth/clerkAuth.ts:19`
```ts
// BEFORE:
async function hydrateUser(req: any, res: any, next: any) {
// AFTER:
async function hydrateUser(req: Request, res: Response, next: NextFunction) {
```

---

## 6. Priority Summary

| ID | Severity | Issue | Fix Effort |
|----|----------|-------|------------|
| F1 | P0 | `afterSignInUrl`/`afterSignUpUrl` props silently ignored in Clerk v6 | 5 min |
| F2 | P0 | Cookie domain missing leading dot; inconsistent clearing | 5 min |
| F3 | P0 | Premature redirect on auth page kills SSO callback | 10 min |
| F4 | P0 | Legacy OAuth creates users without clerkUserId | 5 min (remove) |
| F11 | P0 | Dual OAuth systems with conflicting identity flows | 5 min (remove legacy) |
| F5 | P1 | JWT fallback accepts 5-min expired tokens | 2 min |
| F6 | P1 | `isAuthed` uses `||` instead of `&&` causing stale auth | 5 min |
| F7 | P1 | ProtectedRoute infinite spinner with stale cookies | 10 min |
| F8 | P1 | Clerk proxy caches session state for 60s | 10 min |
| F14 | P1 | hydrateUser uses `any` types | 5 min |
| F9 | P2 | Auth middleware uses raw res.status instead of Errors.* | 10 min |
| F10 | P2 | console.warn/error instead of structured logger | 5 min |
| F12 | P2 | No Clerk webhook for user profile sync | 2 hours |
| F13 | P2 | Rate limiter blocks legitimate session checks | 10 min |

**Total P0 fixes:** ~30 minutes
**Total P1 fixes:** ~37 minutes
**Total P2 fixes:** ~2.5 hours

The P0 fixes (F1, F2, F3, F4/F11) should resolve all three reported symptoms: "External Account not found", redirect loops, and infinite spinners. They are small, targeted changes that can be deployed together.
