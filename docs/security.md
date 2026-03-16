# AcreOS Security Hardening Guide

---

## CVE Patch SLA (F-A06-1)

Automated vulnerability scanning runs on every PR and weekly via GitHub Actions (`.github/workflows/security.yml`). The following SLA applies to any vulnerability found:

| Severity | Patch Deadline | Owner |
|----------|---------------|-------|
| **Critical** | Within 24 hours | On-call engineer |
| **High** | Within 7 days | Assigned engineer |
| **Moderate** | Within 30 days | Sprint planning |
| **Low / Info** | Best effort | Tracked in backlog |

Criteria for declaring a CVE exception (skip/defer):
- Vulnerable code path is unreachable in production (must be documented)
- Upstream fix does not yet exist (set a re-review date in 30 days)

The CI pipeline **fails the merge** on critical/high findings and emits a **warning** on moderate findings.

Security on-call rotation: assign a rotating weekly owner in your team calendar. On-call is responsible for reviewing CI security alerts within 4 hours.

---

## Log Retention Policy (F-A09-3)

| Log Type | Retention | Storage |
|----------|-----------|---------|
| Application logs (Fly.io) | 7 days (Fly.io default) | Fly.io log drain |
| Sentry error events | 90 days (Sentry free tier) | Sentry |
| Audit trail (DB `activityLog` table) | 2 years | PostgreSQL |
| Auth session records | 7 days (session TTL) | PostgreSQL `sessions` |
| Prometheus metrics (in-process) | In-memory, last 1000 requests | Ephemeral |

**Setting up a persistent log drain (recommended for production):**
```bash
# Example: send Fly.io logs to Papertrail
flyctl logs --app acreos | papertrail

# Or configure Fly.io log drain to Datadog / Logtail / Axiom:
flyctl secrets set LOG_DRAIN_URL="https://in.logtail.com/?source_token=YOUR_TOKEN"
```

For SIEM export: enable log drain to your SIEM endpoint. Minimum recommended retention for security logs is 90 days.

---

## Field Encryption Key Rotation Procedure (F-A02-1)

### Annual Key Rotation (Required)

```bash
# Step 1: Generate a new 32-byte key
NEW_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "New key: $NEW_KEY"

# Step 2: Run the rotation script (re-encrypts all encrypted DB fields)
OLD_KEY="<current_FIELD_ENCRYPTION_KEY>" \
NEW_KEY="$NEW_KEY" \
DATABASE_URL="<production_db_url>" \
npx tsx server/scripts/rotateEncryptionKey.ts

# Step 3: Verify 0 errors in output, then update the secret
flyctl secrets set FIELD_ENCRYPTION_KEY="$NEW_KEY"

# Step 4: Deploy
flyctl deploy --strategy=rolling

# Step 5: Record rotation in this document (date + engineer)
```

**Key rotation log:**
| Date | Engineer | Notes |
|------|----------|-------|
| (first rotation due) | — | — |

---

## Key Rotation Procedures

### Database Credentials
```bash
# 1. Generate new password
NEW_PASS=$(openssl rand -base64 32)
# 2. Update in PostgreSQL
psql $DATABASE_URL -c "ALTER USER acreos PASSWORD '$NEW_PASS';"
# 3. Update Fly secret
flyctl secrets set DATABASE_URL="postgresql://acreos:$NEW_PASS@host/acreos"
# 4. Deploy with zero-downtime
flyctl deploy --strategy=rolling
```

### Session Secret
```bash
NEW_SECRET=$(openssl rand -base64 64)
flyctl secrets set SESSION_SECRET="$NEW_SECRET"
# Note: This invalidates all active sessions
```

### API Keys (Stripe, OpenAI, Twilio)
1. Generate new key in provider dashboard
2. Update via `flyctl secrets set KEY=VALUE`
3. Deploy app: `flyctl deploy`
4. Revoke old key in provider dashboard

## Access Review Checklist (Quarterly)
- [ ] Review team member roles in Fly.io (`flyctl auth org members`)
- [ ] Audit admin users in `teamMembers` table
- [ ] Review API key access in `systemApiKeys` table
- [ ] Check OAuth app permissions
- [ ] Review Stripe dashboard access
- [ ] Remove access for departed team members
- [ ] Verify MFA enabled for all admin accounts

## Secret Management

### Current Implementation
Secrets stored in Fly.io vault, accessed as environment variables.

### Best Practices
- Never commit secrets to git (`.gitignore` enforced)
- Rotate secrets every 90 days
- Use separate secrets for staging vs production
- Monitor secret access logs in Fly.io

### Future: HashiCorp Vault / AWS Secrets Manager
```bash
# AWS Secrets Manager integration example
aws secretsmanager get-secret-value --secret-id acreos/prod/database
```

## Rate Limiting Configuration
Configured in `/server/middleware/rateLimiting.ts`:

| Endpoint Group | Limit | Window |
|---|---|---|
| Voice calls | 10 requests | 1 minute |
| AVM valuation | 50 requests | 1 minute |
| Marketplace | 100 requests | 1 minute |
| AI routes | 30 requests | 1 minute |
| General API | 200 requests | 1 minute |
| Auth endpoints | 5 requests | 15 minutes |

## OWASP Top 10 Mitigation Status

| Risk | Status | Implementation |
|---|---|---|
| A01 Broken Access Control | ✅ Mitigated | Role-based middleware, org isolation |
| A02 Cryptographic Failures | ✅ Mitigated | TLS in transit, AES-256 at rest for sensitive fields |
| A03 Injection | ✅ Mitigated | Drizzle ORM parameterized queries |
| A04 Insecure Design | 🟡 Partial | Threat modeling in progress |
| A05 Security Misconfiguration | ✅ Mitigated | CSP headers, security middleware |
| A06 Vulnerable Components | 🟡 Partial | npm audit in CI, Snyk scanning |
| A07 Auth Failures | ✅ Mitigated | Session-based auth, MFA available |
| A08 Software Integrity | 🟡 Partial | Subresource Integrity for CDN assets |
| A09 Logging Failures | ✅ Mitigated | Structured audit logging, PII masking |
| A10 SSRF | ✅ Mitigated | URL allowlisting for external requests |

## Penetration Testing Schedule
- **Quarterly**: Automated SAST (CodeQL in CI)
- **Semi-annually**: External pentest by third-party firm
- **Annually**: Full red team exercise

## PII Data Handling
- Phone numbers masked in logs: `555-***-****`
- SSNs never logged
- Email addresses masked: `***@domain.com`
- Credit scores encrypted at rest (AES-256-GCM)
- GDPR data deletion pipeline in `gdprService.ts`
