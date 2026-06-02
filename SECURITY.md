# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AcreOS, please report it responsibly:

1. **Email:** security@acreos.io
2. **Do NOT** open a public GitHub issue for security vulnerabilities
3. Include a detailed description and steps to reproduce

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |

## Security Measures

- All data encrypted in transit (TLS 1.3) and at rest (AES-256-GCM)
- Field-level encryption for PII (SSN, tax ID, bank accounts)
- CSRF protection via double-submit cookie pattern
- Rate limiting on all API endpoints
- Content Security Policy with nonce-based script loading
- Regular dependency audits via GitHub Security scanning
- Sentry error tracking with PII stripping
