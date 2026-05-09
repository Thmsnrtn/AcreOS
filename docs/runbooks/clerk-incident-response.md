# Runbook: Clerk Authentication Outage

**Severity:** P0 — All sign-ins blocked
**Owner:** Founder / on-call
**Time to first response:** 5 min

---

## Symptom
- Multiple customers report "can't sign in" across unrelated organizations
- Error messages vary: invalid credentials, email never arrives, magic link expires immediately
- `/auth` endpoint returns 5xx or times out
- Clerk dashboard inaccessible or shows degraded status

---

## Diagnose
1. Check **Clerk status page** (`https://status.clerk.com`) — note if there's an active incident.
2. Verify our proxy is operational:
   ```bash
   curl -I https://acreos.com/__clerk/v1/oauth/authorize
   ```
   Should return 200/301, not 502 or timeout.
3. Check Cloudflare WAF rules blocking `clerk.acreos.io`:
   ```bash
   curl -I https://clerk.acreos.io
   ```
   If returns 403, check **Cloudflare Dashboard → Security → WAF Rules** for IP blocks.
4. In our DB, verify Clerk credentials are valid:
   ```sql
   SELECT key, value FROM admin_config WHERE key LIKE '%clerk%';
   ```
   Confirm `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are not empty/expired.
5. Check our `/__clerk` proxy cache (Redis) for stale tokens:
   ```bash
   redis-cli -h <redis-host> KEYS '__clerk:*' | head -20
   ```

---

## Fix
- **Clerk status page shows outage** → No action on our end. Post customer comms: "Clerk (our auth provider) is experiencing an issue. We're monitoring and will resume normal sign-ins once their service recovers."
- **Proxy down (502)** → Restart the proxy service:
  ```bash
  fly deploy -a acreos --update-only
  ```
  Or manually via SSH:
  ```bash
  ssh root@<fly-machine-id> systemctl restart acreos-clerk-proxy
  ```
- **Cloudflare blocking `clerk.acreos.io`** → Go to **Cloudflare → Security → WAF Rules**, disable any rule matching "clerk" temporarily, verify traffic resumes.
- **Clerk credentials expired** → Regenerate API key in Clerk dashboard and update `CLERK_SECRET_KEY` in `fly secrets`:
  ```bash
  fly secrets set CLERK_SECRET_KEY=<new-key> -a acreos
  fly deploy -a acreos
  ```
- **Fallback to magic-link auth path** — If Clerk SDK is unreachable, redirect login attempts to `/auth/magic-link` (does not require Clerk OAuth, uses our email verification table). This is a degraded-mode signal; escalate after enabling.

---

## Verify
- Run synthetic auth check:
  ```bash
  npm run test:auth:synthetic
  ```
  Should complete sign-in → `/today` redirect in <2s.
- Test with a non-customer email (e.g., `test+auth-check@acreos.com`) and verify magic link arrives within 30s.
- Monitor `/api/healthz` — should return 200 with `auth_provider: ok`.
- Spot-check one real customer: ask them to sign in and confirm success in next 5 min.

---

## Escalate if
- Clerk status page shows ongoing incident >30 min — contact `support@clerk.com` and reference your account/project.
- Our proxy is returning 200 but Clerk endpoints are still unreachable — file a Clerk support ticket (provide recent logs from `fly logs -a acreos`).
- Fallback magic-link auth activated — notify founder immediately and plan communication to customers (SLA: resume normal auth within 2h or post status update every 30 min).

---

## Rollback
If you enabled fallback mode or disabled Cloudflare rules:
1. Re-enable Cloudflare WAF rules:
   ```bash
   # Via UI: Cloudflare → Security → WAF Rules → Re-enable disabled rules
   ```
2. If you changed `CLERK_SECRET_KEY`, revert to previous key in `fly secrets`.
3. If you redeployed, verify the previous deployment is stable before rolling back.

---

## Related
- Runbook 01 (Customer can't sign in) — for individual account issues
- Cloudflare admin docs: https://developers.cloudflare.com/waf/
- Clerk docs: https://clerk.com/docs
