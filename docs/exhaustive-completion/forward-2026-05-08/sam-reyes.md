# sam-reyes — Security Maturity for Institutional Trust

**Reading list:**
- MASTER-FINDINGS-RECONCILIATION.md (RS-1..RS-7; P0-10 idempotency open)
- post-may1-resweep.md (RS-4..RS-7: account-security surfaces)
- Original: elite-team-2026-05-01/sam-security.md

**State read:**

May 1 I found 5 top risks: broken founder check, signed-doc mutability, unencrypted skip-trace, non-functional 2FA, token expiry gaps. RS-4..RS-7 shipped customer-facing incident response (sessions revoke, email alerts, export gates, location detection). These turn Asher's 6-hour-9-action attack into 30-minute-3-action event. But backstop risks remain: skip-trace JSONB plaintext, signed documents mutable post-signature, P0-10 idempotency open. These aren't "if compromised"—they're "when audited" risks. E&O insurance and SOC2 require fixes.

**Push forward — my 5 moves (ranked):**

1. **Ship the 3 critical fixes as bundled security release (2d).** (a) Enforce document immutability post-sign + add `documentContentHash` SHA-256. Prevents UETA/ESIGN tampering claims. (b) Encrypt `skip_traces.results` jsonb; backfill rows. (c) Fix broken founder check + test. These three are "do this or risk E&O claim exceeding annual revenue."

2. **Implement audit-log fan-out for security events (2d).** Login/logout, role changes, founder mutations, document-signed, mailer dispatch, permission denials. `REVOKE UPDATE, DELETE ON audit_log` + separate `acreos_dba` role. Tamper-evidence. SOC2 CC8.1 requires unified action log.

3. **Implement privacy endpoints + publish sub-processor list (2d).** `POST /api/privacy/data-export` (zip of org rows) and `POST /api/privacy/data-delete` (soft-delete + 30d hard-delete cron). Publish `/legal/sub-processors` DPA list (Clerk, Fly, Cloudflare, Stripe, Twilio, AWS SES, OpenAI). CCPA/GDPR Art. 30—non-negotiable for Series-A.

4. **Defer external pen-test 90 days; tier by risk.** Phase 1 (Months 1–2, 3k): public sign flow + admin surface. Phase 2 (Month 3, 5k): full API. Phase 3 (Month 4, 10k): infrastructure. You're not ready for Phase 3 (P0-10 open); get code-layer fixes first.

5. **Prepare SOC2 Type 1 package for investor diligence (2–3w).** Functional MFA (Clerk-native), full audit coverage, sub-processor list, data-classification matrix, incident-response runbook, 1 tabletop exercise. Not certification (Type 2 = 6 months), but "we've thought about this" package that unlocks term-sheet conversations.

**What I'd defer:**

- Bug-bounty program until Series-A closes. Finding skip-trace plaintext bugs pre-funding is bad economics.
- Advanced threat modeling (supply-chain, API token leakage). Ship foundational controls first.

**What scares me most:**

*Your biggest liability isn't hacking—it's compliance failure.* Unencrypted skip-trace is discoverable in litigation. Mutable signed documents lose ESIGN Act defense. Missing audit logs fail SOC2/GDPR audits. These are "when audited" risks, not "if careful." All May 1 fixes are <2 weeks. Cost of deferral: one E&O claim, one GDPR notice, one customer NDA rejection.

**Contrarian to Olu:** He wants ops discipline. I'd sequence: **security fundamentals first (moves 1–3), then ops scaling.** You can't scale trust from an insecure foundation.

— Sam
