# Acceptable Use Policy

**Policy owner:** Founder
**Last reviewed:** 2026-05-27
**Review cadence:** Annual
**Audience:** SOC 2 Type II (CC1.4, CC1.5), all personnel.

---

## 1. Purpose

Defines acceptable use of AcreOS systems, accounts, and data by anyone with
access — employees, contractors, the founder.

## 2. Scope

Every AcreOS-owned device, every cloud account in the vendor inventory,
every credential issued to a person, and every piece of customer data
those credentials touch.

## 3. Acceptable use

- Use AcreOS systems only for AcreOS business and only for tasks within
  your role.
- Use the strongest authentication available on every account (MFA
  required where supported).
- Treat every credential and access token as sensitive. Never paste
  secrets into chat tools, screenshots, or commits.
- Lock devices when stepping away. Full-disk encryption is required on
  every device that holds source code or production credentials.
- Use the password manager. Per-site unique passwords are required.

## 4. Prohibited use

- **No customer PII outside AcreOS systems.** Do not export, download, or
  copy customer PII to a personal device, personal cloud drive, or any
  system not listed in `docs/vendor-inventory.md`.
- **No sharing of credentials.** Every person uses their own account
  everywhere.
- **No production data in non-production environments** except via the
  documented DR drill workflow.
- **No running of production-data analytics in a third-party tool** not
  listed in the vendor inventory.
- **No bypassing of CI/CD.** Deploys go through `.github/workflows/deploy.yml`
  unless an active incident requires the documented break-glass path.
- **No disabling of MFA** for any user without an incident-response
  approval from the founder.
- **No use of AcreOS systems for personal projects or non-AcreOS work.**

## 5. AI-tool use

- LLM tools used by AcreOS personnel for AcreOS work must be configured
  not to retain prompts for training (zero-retention or equivalent
  opt-out).
- Do not paste customer PII into a public-tier LLM. Use only the
  enterprise tier of Anthropic / OpenAI / OpenRouter via the official
  AcreOS API key — and only when working on a customer-related task
  that requires it.
- Generated code is reviewed by a human before commit.

## 6. Personal-device policy

- If using a personal device for AcreOS work, the device must have full-
  disk encryption, screen lock < 5 minutes, OS auto-update on, and an
  approved password manager.
- Personal devices used for AcreOS work are subject to security
  inspection on reasonable notice.

## 7. Reporting

Report suspected violations or compromise to the founder immediately.
Failure to report a known incident is itself a violation.

## 8. Enforcement

Violations result in immediate access review and may lead to credential
revocation, role change, or termination depending on severity.
