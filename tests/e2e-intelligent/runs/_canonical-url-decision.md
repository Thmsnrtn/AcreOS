# Canonical URL Decision

## Investigation

- **fly.toml**: app `acreos`, no explicit primary hostname configured. Fly assigns `acreos.fly.dev` automatically.
- **Clerk env config (server/routes.ts:236)**: `Clerk-Proxy-Url` sent upstream is hardcoded `https://acreos.io/__clerk`. x-forwarded-host = `acreos.io`. Upstream FAPI: `possible-emu-83.clerk.accounts.dev`.
- **Clerk redirect (accounts.acreos.io)**: server/routes.ts:260 rewrites any upstream `accounts.acreos.io` Location to `https://acreos.io/` — confirms acreos.io is the authoritative customer-facing domain.
- **Cookie domain (client/src/hooks/use-auth.ts:59-61)**: `__session` and `__client_uat` cookies cleared on `.acreos.io` — confirms canonical cookie origin.
- **DNS**:
  - `dig +short acreos.io` → `66.241.125.36`
  - `dig +short acreos.fly.dev` → `66.241.125.36`
  - Both resolve to the same Fly edge IP. acreos.io is Cloudflare-proxied → Fly.
- **Hardcoded refs**:
  - **Production / user-facing code uses acreos.io**: cookies, Clerk proxy config, settings app URL, email links, listing syndication, status page support mailto.
  - **Test configs still point at fly.dev** (stale): `playwright.smoke.config.ts`, `tests/production-smoke.spec.ts`, `tests/e2e-intelligent/src/harness/runner.ts`, `tests/e2e-intelligent/prompts/session-persona-run.md`.
  - **Non-user observability uses fly.dev**: OpenRouter HTTP-Referer header, security.txt canonical — fine, not user-facing.
- **Redirect behavior (verified via curl, 2026-04-19)**:
  - `GET https://acreos.fly.dev/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js` → **307** to `https://acreos.io/__clerk/npm/@clerk/clerk-js@6.7.4/dist/clerk.browser.js`.
  - Same request on acreos.io → also **307** to the versioned path on acreos.io (same-origin — browsers handle fine).
  - The 307 comes from Clerk upstream (version pinning `6` → `6.7.4`) with an absolute URL rewritten to the configured `Clerk-Proxy-Url`. That URL is `acreos.io`. From acreos.io it's same-origin, from fly.dev it's cross-origin → CORB blocks the script.
- **Cloudflare posture**: server/routes.ts:217 comment: "Cloudflare blocks clerk.acreos.io (Error 1000)" — explains why Clerk is proxied same-origin under `/__clerk` instead of a subdomain.

## Classification

**CASE A** — acreos.io is the intended canonical URL. All user-facing configuration already targets acreos.io. acreos.fly.dev should not be a user-accessible surface; the cycle-1/2 use of fly.dev in the E2E suite was incidental.

## Decision

- **Canonical production URL: `https://acreos.io`**
- All E2E test configuration will target `https://acreos.io`.
- `acreos.fly.dev` will 301-redirect to `https://acreos.io` at the Express layer, so any user who hits fly.dev lands on a properly configured origin before Clerk bootstraps (fixes STR-026).

## Implications for E2E

- Cycle 3 runs target: `https://acreos.io`.
- Personas experience auth via the canonical Clerk same-origin proxy.
- Test-config stale fly.dev references updated (`playwright.smoke.config.ts`, `production-smoke.spec.ts`, `harness/runner.ts`, `session-persona-run.md`).
