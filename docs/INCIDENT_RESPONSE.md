# AcreOS Incident Response Plan

**Last Updated:** 2026-03-18
**Owner:** Founder / CTO
**Review Cadence:** Quarterly

---

## 1. Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| **SEV-1** | Service down, data breach, financial loss | 15 minutes | Database corruption, unauthorized access, payment processing failure |
| **SEV-2** | Major feature degraded, compliance violation | 1 hour | AI agent malfunction, Stripe webhook failure, TCPA violation |
| **SEV-3** | Minor degradation, non-critical bug | 4 hours | Slow queries, UI rendering issues, non-blocking errors |
| **SEV-4** | Cosmetic issue, enhancement needed | Next business day | Typos, minor UI glitches |

---

## 2. Breach Notification Timeline

Per CCPA/state breach notification laws:
- **Internal detection → Founder notification:** Within 1 hour
- **Founder → Legal counsel notification:** Within 4 hours
- **Legal → Affected users notification:** Within 72 hours (GDPR) / "without unreasonable delay" (CCPA)
- **Regulatory notification (if required):** Within 72 hours

---

## 3. Incident Response Steps

### Step 1: Detect & Triage
- Monitor Sentry alerts, Prometheus dashboards, health check endpoints
- Classify severity level
- Assign incident commander (founder for SEV-1/2)

### Step 2: Contain
- If data breach: Rotate all API keys and secrets immediately
- If service degradation: Scale up or rollback via `flyctl releases rollback`
- If AI malfunction: Disable autonomous mode (`AUTONOMOUS_MAX_FINANCIAL_IMPACT=0`)
- If compliance violation: Enable strict mode (`COMPLIANCE_STRICT_MODE=true`)

### Step 3: Investigate
- Review audit logs (`/api/founder/audit-log`)
- Review Sentry error traces
- Check recent deployments (`flyctl releases list`)
- Review autonomous decision log

### Step 4: Remediate
- Deploy fix or rollback
- Verify via health checks and monitoring
- Document root cause

### Step 5: Communicate
- Update status page (if applicable)
- Notify affected users via email (SEV-1/2)
- File regulatory reports if required

### Step 6: Post-Mortem
- Document timeline, root cause, impact
- Identify preventive measures
- Update this runbook if needed

---

## 4. Emergency Contacts

| Role | Contact | When |
|------|---------|------|
| Founder | (configured in FOUNDER_EMAILS) | All SEV-1/2 |
| Legal Counsel | TBD | Data breaches, compliance violations |
| Stripe Support | support@stripe.com | Payment processing issues |
| Fly.io Support | support@fly.io | Infrastructure issues |

---

## 5. Key Commands

```bash
# Rollback deployment
flyctl releases rollback -a acreos

# Scale up
flyctl scale count 4 -a acreos

# Check health
curl https://acreos.fly.dev/api/health/cached

# Disable autonomous operations
flyctl secrets set AUTONOMOUS_MAX_FINANCIAL_IMPACT=0 -a acreos

# Enable compliance strict mode
flyctl secrets set COMPLIANCE_STRICT_MODE=true -a acreos

# Rotate session secret
flyctl secrets set SESSION_SECRET=$(openssl rand -hex 32) -a acreos
```

---

## 6. Data Breach Checklist

- [ ] Identify scope of breach (what data, how many users)
- [ ] Rotate all secrets and API keys
- [ ] Notify founder within 1 hour
- [ ] Engage legal counsel within 4 hours
- [ ] Preserve evidence (do NOT delete logs)
- [ ] Notify affected users within 72 hours
- [ ] File regulatory reports if required
- [ ] Conduct post-mortem within 7 days
- [ ] Update security measures based on findings

---

*This document should be reviewed quarterly and updated after every SEV-1/2 incident.*
