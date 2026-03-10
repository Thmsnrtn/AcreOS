# Runbook: Customer Reports Data Breach

**Severity:** P1 — Critical Security Incident
**Task Reference:** #326

---

## This Is a Security Incident — Act Fast

GDPR Article 33 requires notification to supervisory authority **within 72 hours** of becoming aware of a breach.
CCPA requires notification to California residents **within 45 days**.

---

## Phase 1: Detection & Containment (0–30 minutes)

### Immediate Steps

1. **Do not panic. Do not delete logs.** Logs are evidence.

2. **Assemble incident response team:**
   - Engineering lead (on-call)
   - Founder/CEO
   - Legal counsel (if available)
   - Customer success lead

3. **Create incident channel** in Slack: `#incident-YYYYMMDD-breach`

4. **Document initial report:**
   - Who reported it? When? How?
   - What data may be affected?
   - What is the suspected vector?

### Containment Actions

```bash
# 1. Identify the suspected attack vector from logs
fly logs -a acreos | grep -E "(auth|error|403|401|suspicious)" | tail -100

# 2. If active intrusion — block attacker IP immediately
# Via Fly.io firewall or Cloudflare WAF

# 3. If session compromise — invalidate all active sessions
# Run in production DB:
# DELETE FROM sessions WHERE expire > NOW();
# This forces all users to re-authenticate

# 4. If API key compromised — rotate immediately
fly secrets unset OPENAI_API_KEY STRIPE_SECRET_KEY FIELD_ENCRYPTION_KEY -a acreos
fly secrets set OPENAI_API_KEY=sk-new-key STRIPE_SECRET_KEY=sk_live_new... -a acreos

# 5. If source code compromised — rotate ALL secrets
# See: "Rotate All Secrets" section
```

---

## Phase 2: Assessment (30 min – 4 hours)

### Scope Investigation

```bash
# What data was accessed?
# Check audit logs for unusual access patterns:
# SELECT user_id, action, resource_type, resource_id, created_at
# FROM audit_logs
# WHERE created_at > NOW() - INTERVAL '7 days'
# ORDER BY created_at DESC LIMIT 500;

# Check for bulk data exports:
# SELECT * FROM import_export_logs
# WHERE action = 'export' AND created_at > NOW() - INTERVAL '7 days';
```

### Data Classification
Determine what category of data was exposed:
- [ ] PII (names, emails, phones) → GDPR/CCPA applies
- [ ] Financial data (SSNs, bank accounts, credit scores) → State breach laws apply
- [ ] Health data → HIPAA may apply
- [ ] Business data only → Notify affected organizations
- [ ] No personal data → Document and close

---

## Phase 3: Notification (4–72 hours)

### GDPR Notification (EU users)
Required within 72 hours if breach is likely to result in high risk to individuals.

1. **Supervisory authority notification:** File with the relevant EU DPA
2. **Required information:**
   - Nature of breach and data categories
   - Approximate number of affected individuals
   - Likely consequences
   - Measures taken to address breach

### Customer Notification Template
```
Subject: Important Security Notice — AcreOS

We are writing to inform you of a security incident that may have affected your account.

What happened: [Brief description]
What data was involved: [List data categories]
What we are doing: [Actions taken]
What you should do: [Reset password, enable 2FA, monitor accounts]

We sincerely apologize for this incident. Please contact security@acreos.com
if you have questions.
```

---

## Phase 4: Recovery & Post-Mortem

### Recovery Steps
1. Patch the vulnerability
2. Rotate all potentially-compromised credentials
3. Re-enable affected services
4. Verify data integrity
5. Implement additional monitoring

### Post-Mortem (within 5 days)
Document:
- Root cause
- Timeline of events
- Impact assessment
- Remediation steps taken
- Preventive measures going forward

---

## Rotate All Secrets (Emergency)
```bash
# Generate new secrets
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
FIELD_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Set in Fly.io
fly secrets set \
  SESSION_SECRET="$SESSION_SECRET" \
  FIELD_ENCRYPTION_KEY="$FIELD_KEY" \
  -a acreos

# Invalidate all sessions
# psql $DATABASE_URL -c "DELETE FROM sessions;"
```

---

## Contacts
- GDPR DPA: [Supervisory authority contact]
- Security email: security@acreos.com
- Legal counsel: [Contact]
- Cyber insurance: [Policy number and hotline]
