# ADR 006: AES-256-GCM for Sensitive Field Encryption

**Status**: Accepted
**Date**: 2025-01-10
**Deciders**: Engineering team, Security

## Context

AcreOS stores sensitive personal and financial data including SSNs, credit scores, bank account numbers, and financial projections. This data must be protected at the application layer (beyond database-level encryption at rest) to prevent exposure if database credentials are compromised.

## Decision

We use **AES-256-GCM** (Authenticated Encryption with Associated Data) for field-level encryption of sensitive database columns.

**Implementation:**
- Key source: `FIELD_ENCRYPTION_KEY` environment variable (32-byte hex, stored in Fly.io secrets vault)
- IV: 12 random bytes (96-bit GCM nonce) generated fresh per encryption operation
- Auth tag: 16 bytes (128-bit GCM tag) — provides tamper detection
- Wire format: `enc:v1:` prefix + Base64(JSON({v, iv, tag, ct}))
- Key rotation supported via `rotateEncryption()` helper

**Fields encrypted:**
- `creditScore`, `landCreditScore`, `financialProjections` on property/lead records
- `ssn`, `taxId`, `bankAccountNumber`, `routingNumber` on contact records

## Rationale

| Concern | AES-256-CBC | AES-256-GCM |
|---|---|---|
| **Authentication** | None (IV manipulation attacks) | Built-in auth tag (tamper-evident) |
| **Performance** | Similar | Similar |
| **IV reuse risk** | Catastrophic | Still serious — mitigated by random IV |
| **Standard** | NIST approved | NIST approved (preferred for new systems) |
| **Node.js support** | Native | Native |

GCM was chosen because the authentication tag prevents malicious modification of ciphertext, which is critical for financial data.

## Consequences

- Each encrypted value is ~50-100 bytes larger than plaintext (Base64 overhead)
- Index-based queries on encrypted columns are not possible — design schema accordingly
- Key rotation requires re-encrypting all affected rows — script provided at `server/scripts/rotateEncryptionKey.ts`
- FIELD_ENCRYPTION_KEY must be rotated from default before production launch
