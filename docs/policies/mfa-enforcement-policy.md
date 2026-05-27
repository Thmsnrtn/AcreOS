# MFA Enforcement Policy

**Policy owner:** Founder / Security lead
**Last reviewed:** 2026-05-27
**Review cadence:** Annual, plus any time MFA controls change
**Audience:** Cyber + Tech-E&O underwriting (Coalition, Beazley), enterprise customers

---

## 1. Statement of intent

AcreOS requires multi-factor authentication (MFA) for all privileged
operator accounts (`owner`, `admin`) and for any access to high-trust
administrative surfaces (impersonation, password resets, autopay freeze,
ownership transfer, founder-console). MFA is enforced **at the identity
provider** (Clerk), not by our application layer, which gives us
provable, audit-logged factor verification independent of session state
in the app database.

This policy is the canonical statement of what AcreOS enforces, where it
is enforced in code, and how an underwriter or auditor can verify the
control.

---

## 2. Roles and scope

| Role | MFA requirement | Where enforced |
|---|---|---|
| `owner` | **Required for any high-trust action** | Clerk enrollment + `requireClerkMFA` middleware |
| `admin` | **Required for any high-trust action** | Clerk enrollment + `requireClerkMFA` middleware |
| `member` | Recommended; required when `MFA_REQUIRED_FOR_ALL_USERS=true` | Clerk enrollment + middleware |
| `viewer` | Recommended; required when `MFA_REQUIRED_FOR_ALL_USERS=true` | Clerk enrollment + middleware |
| `va` (virtual assistant) | Required (handles operator data on behalf of owner) | Clerk enrollment + middleware |

"High-trust action" = any request whose path matches the `HIGH_TRUST_PATH_PREFIXES`
list in `server/middleware/requireClerkMFA.ts`. Current list:

- `/api/admin/recovery/*` — impersonation, account recovery
- `/api/admin/users/*` — 2FA reset, sessions, password-reset links
- `/api/admin/orgs/*` — freeze-autopay, transfer-ownership

Adding a path here forces every `owner`/`admin` without an enrolled
second factor to enroll before they can use that area.

---

## 3. Supported second factors

Configured at the Clerk instance level:

- **TOTP** (Google Authenticator, 1Password, Authy) — primary recommended factor
- **SMS** — supported, but treated as a fallback (subject to SIM-swap risk)
- **Backup codes** — one-time codes for recovery

Hardware keys (WebAuthn / passkeys) are on the roadmap pending Clerk
plan upgrade; SMS will be downgraded to fallback-only once WebAuthn is
available.

---

## 4. How enforcement works in code

### 4.1 The JWT carries the MFA claim

Clerk's session JWT exposes a `factor_verification_age` (FVA) claim, a
two-element tuple `[firstFactorAge, secondFactorAge]` where:

- `firstFactorAge` = seconds since password / magic-link verification in the current session
- `secondFactorAge` = seconds since second-factor verification in the current session
- A value of `-1` means "never verified in this session"
- A `null` FVA means the Clerk instance hasn't opted into the claim — **we treat this as not verified** (fail closed)

### 4.2 The middleware (single source of truth)

`server/middleware/requireClerkMFA.ts` is the single enforcement point.
The decision matrix is:

| Condition | Decision |
|---|---|
| No `req.auth.userId` | 401 `Unauthorized` |
| Clerk `twoFactorEnabled = true` AND second factor verified | pass |
| Clerk `twoFactorEnabled = true` AND second factor NOT verified | 403 `mfa_required` |
| Clerk `twoFactorEnabled = false` AND path is high-trust | 403 `mfa_setup_required` |
| Clerk `twoFactorEnabled = false` AND `MFA_REQUIRED_FOR_ALL_USERS=true` | 403 `mfa_setup_required` |
| Clerk SDK lookup fails | 403 `mfa_required` (fail closed) |
| Otherwise | pass |

Every decision is written to `audit_events` with action `mfa.pass`,
`mfa.blocked_mfa_required`, `mfa.blocked_setup_required`, or
`mfa.blocked_no_session`. Audit write failures **never** block
enforcement — the middleware is fail-closed on enforcement and
best-effort on audit logging.

### 4.3 Where it's applied

`server/routes.ts:2108` mounts `requireClerkMFA` on `/api/admin/*`:

```ts
app.use("/api/admin", isAuthenticated, requireClerkMFA);
```

That single mount covers every administrative surface in the
application. No admin route bypasses this middleware — the mount is
above the individual `app.<verb>(...)` registrations for `/api/admin/*`.

---

## 5. Privilege escalation defense

A user cannot escalate privilege (e.g., add themselves to `owner`, or
trigger admin recovery flows) without an MFA-verified Clerk session.
The flow is:

1. The user signs in with username + password → first factor verified
2. The user enters their TOTP / SMS / backup code → second factor verified
3. The Clerk session JWT now carries `factor_verification_age = [N, M]` with both `>= 0`
4. `requireClerkMFA` reads the JWT, confirms `secondFactorVerified === true`, and allows the request

If step 2 is skipped (the user has not enrolled in MFA), the middleware
returns 403 `mfa_setup_required` on any high-trust route. The user is
directed to Clerk's MFA enrollment surface before they can continue.

There is no application-level setting that disables this check. The
fallback path (`process.env.MFA_REQUIRED_FOR_ALL_USERS=true`) only
**tightens** enforcement to the entire surface.

---

## 6. Recovery procedure

If an MFA-enrolled user loses access to their second factor:

1. The user contacts support via the in-app help surface.
2. Support escalates to an `owner` of the same organization, who can issue a Clerk-side 2FA reset via `/api/admin/users/:id/2fa/reset`.
3. The `owner` performing the reset must themselves pass `requireClerkMFA` to invoke the reset.
4. The reset is recorded in `audit_events` with the `actorUserId` of the resetter and the `targetId` of the user being reset.
5. The user re-enrolls in MFA on their next sign-in.

Backup codes (generated at enrollment) allow self-service recovery
without contacting support.

---

## 7. Verification (for an underwriter / auditor)

To verify this control as a third party:

| Step | Command / location | Expected result |
|---|---|---|
| 1. Check the middleware exists | `cat server/middleware/requireClerkMFA.ts` | Contains the decision matrix from §4.2 |
| 2. Check the middleware is mounted on `/api/admin` | `grep -n "requireClerkMFA" server/routes.ts` | Mount at `app.use("/api/admin", isAuthenticated, requireClerkMFA)` |
| 3. Confirm Clerk instance has MFA enabled | Clerk dashboard → User & Authentication → Multi-factor | TOTP enabled; SMS enabled; backup codes enabled |
| 4. Confirm enforcement on a real request | `curl -X POST https://app.acreos.com/api/admin/users/<id>/2fa/reset` with a non-MFA session | 403 `mfa_required` or `mfa_setup_required` |
| 5. Confirm audit trail | `SELECT action, count(*) FROM audit_events WHERE action LIKE 'mfa.%' GROUP BY action` | Non-zero counts for `mfa.pass` and at least one `mfa.blocked_*` |

---

## 8. Carrier-application answer (canonical)

> **Q: Do you require MFA for privileged accounts?**
> **A:** Yes. MFA is enforced at the identity provider (Clerk) and verified
> on every administrative request via the `requireClerkMFA` middleware
> mounted on `/api/admin/*`. The middleware reads the `factor_verification_age`
> claim from the verified Clerk session JWT and fails closed if MFA is not
> verified. All MFA decisions are written to the `audit_events` table.

---

## 9. Change history

| Date | Change |
|---|---|
| 2026-05-03 | R4 cutover: deleted in-house TOTP middleware, moved to Clerk-native MFA |
| 2026-05-27 | This policy document codified for underwriting submission |
