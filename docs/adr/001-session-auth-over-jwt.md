# ADR 001: Server-Side Session Authentication over JWT

**Status**: Accepted
**Date**: 2025-01-06
**Deciders**: Engineering team

## Context

AcreOS requires user authentication for a multi-tenant SaaS platform. We evaluated two primary approaches:
1. **JWT (JSON Web Tokens)** — stateless bearer tokens
2. **Server-Side Sessions** — session ID stored in a cookie, session data in PostgreSQL

## Decision

We chose **server-side sessions** using `express-session` with a PostgreSQL session store (`connect-pg-simple`).

## Rationale

| Concern | JWT | Server-Side Session |
|---|---|---|
| **Immediate revocation** | Hard — requires token blacklist | Native — delete session row |
| **Token theft impact** | High — valid until expiry | Low — session can be invalidated server-side |
| **Session fixation** | N/A | Mitigated via `req.session.regenerate()` on login |
| **Storage** | Client-only | PostgreSQL (auditable, durable) |
| **Complexity** | Higher (refresh tokens, rotation) | Lower for stateful use case |

Land investing deals involve sensitive financial data. The ability to instantly revoke sessions (on logout, password change, or suspicious activity) outweighs the scalability benefits of JWTs for this use case.

## Consequences

- Sessions stored in `sessions` table — add index on `sess`, `expire` columns
- `SESSION_SECRET` must be ≥ 64 characters and rotated annually
- Horizontal scaling requires sticky sessions OR shared session store (PostgreSQL satisfies this)
- Cookie settings: `httpOnly: true`, `secure: true` (prod), `sameSite: "strict"` (prod)
