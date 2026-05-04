# Hartwell Title-Partner API — v1

This is the partner-tier integration spec for title companies that receive
title-order requests from AcreOS, send back status webhooks, and exchange
ALTA-Pillar-2-compliant wire instructions.

Audit projection: $895/file × 28–32 closings/mo at scale.

## Authentication

All partner-tier endpoints use a per-partner API key passed as a Bearer
token:

```
Authorization: Bearer <api_key>
```

The key is hashed (SHA-256) before storage. Lose it → request a rotation.

Inbound webhooks AcreOS sends to your `webhook_url` are signed with the
partner's HMAC shared secret:

```
X-Acreos-Signature: sha256=<hex>
```

The signature is `HMAC_SHA256(hmac_secret, raw_request_body)`. AcreOS
**fails closed**: if the secret is missing or undecryptable, the webhook
is rejected with 403. Verify the signature on every request, in
constant-time.

## Surfaces

### 1. Order created → partner

AcreOS POSTs to your `webhook_url` whenever a new order is routed to you.

```json
POST <partner.webhook_url>
X-Acreos-Signature: sha256=<hex>
Content-Type: application/json

{
  "event": "title_order.created",
  "orderId": 1234,
  "organizationId": 42,
  "dealId": 91,
  "propertyAddress": {
    "line1": "123 Ranch Rd",
    "city": "Austin",
    "state": "TX",
    "county": "Travis",
    "zip": "78701"
  },
  "buyerInfo":  { "name": "Jane Smith", "email": "jane@…", "phone": "+1…" },
  "sellerInfo": { "name": "Bob Jones",  "email": "bob@…",  "phone": "+1…" },
  "salePrice": "125000.00",
  "expectedClosingDate": "2026-06-15",
  "estimatedDeliveryDate": "2026-06-10"
}
```

### 2. Status update → AcreOS

```
POST /api/webhooks/title-orders/:orderId/status
Authorization: Bearer <api_key>
X-Acreos-Signature: sha256=<hex of raw body, signed with hmac_secret>
Content-Type: application/json

{
  "status": "commitment_issued",
  "statusDetails": {
    "title_examiner": "K. Patel",
    "exceptions_count": 3,
    "estimated_close": "2026-06-14"
  },
  "commitmentS3Key": "title-orders/1234/commitment.json",
  "scheduleBS3Key":  "title-orders/1234/schedule_b.json",
  "policyS3Key":     "title-orders/1234/policy.json"
}
```

Allowed status values:

- `assigned`
- `in_progress`
- `commitment_issued`
- `schedule_b_issued`
- `policy_issued`
- `wire_instructions_issued`
- `closed`
- `cancelled`

## Document exchange — JSON schemas

Documents are uploaded to a **shared S3 exchange bucket**, partner-write,
AcreOS-read. The S3 key returned in the status webhook must point to a
JSON object that conforms to the schemas below. Keep image / PDF assets
referenced by S3 key, not embedded inline.

### 2.1. Title commitment

```jsonc
{
  "schemaVersion": "1.0.0",
  "documentType": "title_commitment",
  "orderId": 1234,
  "issuedAt": "2026-05-10T18:00:00Z",
  "issuingAgent": {
    "name": "Hartwell Title LLC",
    "licenseNumber": "TX-12345",
    "phone": "+1-512-555-0100"
  },
  "underwriter": {
    "name": "First American Title Insurance",
    "naic": "26743"
  },
  "effectiveDate": "2026-05-09",
  "proposedInsured": {
    "buyer": "Jane Smith",
    "policyAmount": "125000.00"
  },
  "estate": "Fee Simple",
  "vesting": "Bob Jones, a single man",
  "scheduleAS3Key":   "title-orders/1234/schedule_a.pdf",
  "scheduleB1S3Key":  "title-orders/1234/schedule_b1.pdf",
  "scheduleB2S3Key":  "title-orders/1234/schedule_b2.pdf",
  "exceptions": [
    {
      "id": "B-1",
      "type": "easement",
      "description": "Recorded easement to City of Austin water utility, Vol. 12345 Pg. 678.",
      "documentS3Key": "title-orders/1234/exceptions/B-1.pdf"
    }
  ]
}
```

### 2.2. Schedule B (exceptions)

```jsonc
{
  "schemaVersion": "1.0.0",
  "documentType": "schedule_b",
  "orderId": 1234,
  "issuedAt": "2026-05-10T18:00:00Z",
  "section1Requirements": [
    {
      "id": "S1-1",
      "description": "Pay 2025 property taxes due May 31, 2026.",
      "satisfied": false
    }
  ],
  "section2Exceptions": [
    {
      "id": "S2-1",
      "category": "rights_of_way",
      "description": "Easement of record per Vol. 12345 Pg. 678.",
      "documentS3Key": "title-orders/1234/exceptions/S2-1.pdf"
    }
  ]
}
```

### 2.3. Owner's / lender's policy

```jsonc
{
  "schemaVersion": "1.0.0",
  "documentType": "title_policy",
  "policyKind": "owners",          // owners | lenders
  "orderId": 1234,
  "policyNumber": "OPB-9999-2026",
  "issuedAt": "2026-06-15T20:30:00Z",
  "effectiveDate": "2026-06-15",
  "insured": "Jane Smith",
  "amountOfInsurance": "125000.00",
  "premium": "1250.00",
  "underwriter": {
    "name": "First American Title Insurance",
    "naic": "26743"
  },
  "policyPdfS3Key": "title-orders/1234/policy.pdf",
  "endorsements": [
    { "form": "T-19.1", "description": "Restrictions, Encroachments, Minerals (Owner)" }
  ]
}
```

## ALTA Pillar 2 — Wire-instruction surface

ALTA Pillar 2 (Wire Fraud Prevention) requires three controls on every
wire instruction issued to the customer:

1. **Out-of-band confirmation.** Customer must call the title agent at a
   verified phone number to confirm wire details before sending. The phone
   number is stored on `title_orders.wire_confirmation_phone` and shown
   prominently in the customer UI. The customer's confirmation timestamp
   is recorded on `wire_confirmed_at`.
2. **Encrypted PDF delivery.** Wire instructions are delivered as a
   password-protected PDF. The password is delivered out-of-band — by SMS
   to the customer's verified phone, separate from the email that carries
   the PDF. AcreOS stores **only a hint** (`Password sent by SMS to phone
   ending in NNNN`), never the password itself.
3. **HMAC-signed payload.** The encrypted PDF is HMAC-SHA256 signed by
   the partner using the per-partner shared secret. The signature is
   stored on `title_orders.wire_instructions_hmac` and can be verified
   downstream against the canonicalised wire-instruction JSON + the S3 key.

Issuing flow:

1. Partner provides the canonical wire payload (bank, routing, account,
   amount, reference, confirmation phone).
2. AcreOS server (`server/services/wireInstructions.issueWireInstructions`)
   computes the canonical JSON, generates a 12-char password from a
   restricted alphabet (no 0/O/1/I/l), and computes
   `HMAC_SHA256(secret, canonical_json + "\n" + s3_key)`.
3. The encrypted PDF is uploaded to
   `title-orders/<orderId>/wire-instructions-<ts>.pdf.enc`. AcreOS writes
   the S3 key, the password hint, the HMAC signature, the confirmation
   phone, and `wire_instructions_issued_at` onto the row, and advances
   status to `wire_instructions_issued`.
4. The password is returned **once** by the service call so the caller
   can deliver it out-of-band by SMS. It is never persisted.

Failing closed: if the partner has no `hmac_secret_encrypted` stored, or
if the secret cannot be decrypted, the issuing service throws and
**no PDF is issued.** Unsigned wire instructions are never produced.

## Volume pricing tiers

| Tier        | Per-file price (USD) | Notes                                |
| ----------- | -------------------- | ------------------------------------ |
| `pilot`     | $895                 | Default for new partners.            |
| `standard`  | $795                 | After 10 closed files.               |
| `volume`    | $695                 | After 50 closed files / 12-mo cohort.|
| `enterprise`| Negotiated           | Custom pricing per contract.         |

Tier is surfaced on the partner record and aggregated in the founder-only
billing report at `GET /api/founder/title-partners/billing-report`.

## Out of scope (engineering)

- Contractual relationships with title agents — operator workflow.
- Real-money disbursements — handled by the partner's escrow systems.
- E-recording integration — covered separately in Phase 7+.
