# Runbook 01 — Customer can't sign in

**Severity:** P1 — Customer blocked
**Owner:** Founder / on-call
**Time to first response:** 15 min

---

## Symptom
Customer reports "I can't log in." Common variants:
- Magic link email never arrives
- Password reset email never arrives
- "Invalid credentials" loop even with correct password
- After clicking magic link, lands on `/auth` with no session
- 403 / "Organization not found" after sign-in

---

## Diagnose
1. Get the customer's email. In **Clerk dashboard → Users**, search by email.
2. Check the user row for: `last sign-in`, `email verified`, `banned`, `locked`.
3. In Clerk **Logs** tab on that user, look for the most recent sign-in attempt — note any error code (e.g. `form_password_incorrect`, `verification_expired`, `account_transfer_invalid`).
4. In our DB: `SELECT id, email, organization_id, role FROM users WHERE email='X';` — confirm the user exists locally and has an `organization_id`.
5. If magic-link / reset email is missing: check **SendGrid → Activity** for that recipient. Filter on the last hour. Look for `bounced`, `dropped`, `blocked`, `spam_report`.
6. If user-agent / IP looks unusual, check Clerk's **Security → Sign-in attempts** for bot-protection blocks.

---

## Fix
- **Email not arriving** → Remove from SendGrid suppression list (Settings → Suppressions → Bounces / Blocks). Resend the magic link from Clerk (Users → … → Send magic link).
- **Account locked / banned** → Unlock or unban from Clerk. Confirm with the customer it was them, not a takeover attempt.
- **Email-verified false but user insists they verified** → Re-trigger verification email; if blocked, walk them through a different inbox or manually verify in Clerk.
- **Local org missing** → User exists in Clerk but not in our `users` table. Run the org-bootstrap repair: `POST /api/admin/recovery/bootstrap-user` with the Clerk user ID. (Founder-only route.)
- **Password incorrect after reset** → Trigger a fresh reset link from Clerk and walk them through it on a screenshare.

---

## Verify
- Customer signs in successfully, sees `/today` (or their persona-specific home).
- `users.last_login_at` updates in DB.
- No 4xx in `fly logs -a acreos | grep -i auth` for that user's email in the next 5 min.

---

## Escalate if
- Multiple unrelated customers report sign-in failure in the same window → suspect Clerk outage. Check `https://status.clerk.com` and the **External safety net** section on the Controls door (`/founder/autopilot/control`).
- SendGrid Activity shows mass bouncing → see runbook 05 (mass-email-bounces-spike).
- User row missing in our DB and recovery bootstrap fails → escalate to engineering, do not delete + recreate (loses billing / consent history).
