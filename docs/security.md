# AcreOS Security Hardening Guide

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
