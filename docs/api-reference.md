# AcreOS API Reference

## Overview

The AcreOS API provides RESTful endpoints for managing real estate operations including leads, properties, deals, and finances. All endpoints require authentication unless otherwise noted.

## Authentication

AcreOS uses Replit OAuth (OpenID Connect) for authentication. All authenticated endpoints require a valid session cookie.

### Headers
- `Content-Type: application/json` for all requests with a body
- Session cookie is automatically managed by the browser

## Rate Limits

| Endpoint Type | Limit | Window |
|--------------|-------|--------|
| Default | 100 requests | 1 minute |
| AI/Stripe | 50 requests | 1 minute |
| Authentication | 10 requests | 1 minute |
| Public | 50 requests | 1 minute |

Rate limit headers are included in responses:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Unix timestamp when the limit resets

## Common Response Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Authentication required |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 408 | Request Timeout - Request took too long |
| 415 | Unsupported Media Type |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |
| 503 | Service Unavailable - External service not configured |

## API Endpoints

### Health Check

#### GET /api/health
Check the health status of all external services.

**Response:**
```json
{
  "overall": "healthy",
  "services": [
    { "name": "database", "status": "healthy", "latency": 5 },
    { "name": "stripe", "status": "unconfigured" },
    { "name": "openai", "status": "healthy", "latency": 120 }
  ],
  "timestamp": "2026-01-10T12:00:00.000Z"
}
```

### Leads

#### GET /api/leads
Retrieve all leads for the organization.

**Response:** Array of Lead objects

#### GET /api/leads/:id
Retrieve a specific lead.

#### POST /api/leads
Create a new lead.

**Body:**
```json
{
  "firstName": "string",
  "lastName": "string",
  "email": "string",
  "phone": "string",
  "status": "new|contacted|qualified|negotiating|closed|lost"
}
```

#### PATCH /api/leads/:id
Update a lead.

#### DELETE /api/leads/:id
Delete a lead.

### Properties

#### GET /api/properties
Retrieve all properties for the organization.

#### GET /api/properties/:id
Retrieve a specific property.

#### POST /api/properties
Create a new property.

#### PATCH /api/properties/:id
Update a property.

### Deals

#### GET /api/deals
Retrieve all deals for the organization.

#### GET /api/deals/:id
Retrieve a specific deal.

#### POST /api/deals
Create a new deal.

#### PATCH /api/deals/:id
Update a deal.

### Finance (Notes & Payments)

#### GET /api/notes
Retrieve all promissory notes for the organization.

#### GET /api/notes/:id
Retrieve a specific note.

#### POST /api/notes
Create a new promissory note.

#### GET /api/payments
Retrieve all payments. Optionally filter by noteId.

**Query Parameters:**
- `noteId` (optional): Filter payments by note ID

#### POST /api/payments
Record a new payment.

**Body:**
```json
{
  "noteId": "number",
  "amount": "number",
  "principalAmount": "number",
  "interestAmount": "number",
  "paymentMethod": "string",
  "status": "pending|completed|failed"
}
```

### Stripe Connect

#### GET /api/stripe/connect/status
Get the Stripe Connect status for the organization.

**Response:**
```json
{
  "isConnected": false,
  "chargesEnabled": false,
  "payoutsEnabled": false,
  "detailsSubmitted": false
}
```

#### POST /api/stripe/connect/link
Create or get Stripe Connect onboarding link.

**Response:**
```json
{
  "accountId": "acct_xxx",
  "onboardingUrl": "https://connect.stripe.com/...",
  "isExisting": false
}
```

### Borrower Portal (Public)

These endpoints allow borrowers to access their payment portal.

#### POST /api/borrower/verify
Verify borrower access.

**Body:**
```json
{
  "accessToken": "string",
  "email": "string"
}
```

#### GET /api/borrower/session
Get borrower session information (requires borrower session cookie).

#### POST /api/borrower/payment
Submit a payment (requires borrower session cookie).

## Security

### Organization Isolation
All data is isolated by organization. Users can only access data belonging to their organization.

### Security Headers
The API includes the following security headers:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=()`
- `Strict-Transport-Security: max-age=31536000` (production only)

### Content Security Policy
The API enforces a Content Security Policy (CSP) that:
- Restricts scripts to 'self' and trusted domains (Stripe, Mapbox)
- Prevents clickjacking via `frame-ancestors 'none'`
- Blocks object embeds via `object-src 'none'`
- Restricts form submissions to 'self'
- Upgrades insecure requests in production

### Input Validation
All inputs are validated using Zod schemas. Invalid inputs return a 400 error with field-level error messages.

## Webhooks

### Stripe Connect Webhook
`POST /api/stripe/connect/webhook`

Handles Stripe Connect events for payment processing.

### Campaigns

#### GET /api/campaigns
Retrieve all campaigns for the organization.

#### POST /api/campaigns
Create a new campaign.

**Body:**
```json
{
  "name": "string",
  "type": "email|sms|direct_mail",
  "subject": "string",
  "message": "string",
  "targetCounties": ["string"],
  "filters": { "status": "string", "minScore": "number" }
}
```

#### GET /api/campaigns/:id/analytics
Campaign performance metrics (sent, delivered, opened, clicked, responded, CPA, ROI).

#### GET /api/campaigns/:id/responses
Campaign responses attributed to leads.

### Intelligence Endpoints

#### GET /api/deal-feed
Generate the daily deal feed for the organization's target counties.

**Query Parameters:**
- `counties` (optional): Override target counties
- `limit` (optional): Max opportunities (default: 20)

**Response:**
```json
{
  "opportunities": [
    {
      "id": "string",
      "apn": "string",
      "county": "string",
      "state": "string",
      "sizeAcres": 10.5,
      "compositeScore": 84,
      "radarScore": 78,
      "motivationScore": 92,
      "countyScore": 71,
      "lcsScore": 720,
      "estimatedValue": 15000,
      "highlights": ["Tax delinquent 3+ years", "Out-of-state owner"]
    }
  ],
  "generatedAt": "2026-03-25T08:00:00.000Z"
}
```

#### GET /api/land-credit/:propertyId
Get the Land Credit Score for a property.

**Response:**
```json
{
  "score": 720,
  "tier": "good",
  "confidence": 85,
  "dimensions": {
    "flood": { "score": 95, "label": "Minimal risk", "source": "FEMA NFHL" },
    "soil": { "score": 72, "label": "Good drainage", "source": "USDA SSURGO" },
    "access": { "score": 80, "label": "Paved road 0.2mi", "source": "OpenStreetMap" },
    "utilities": { "score": 45, "label": "No utilities", "source": "Infrastructure DB" },
    "topography": { "score": 88, "label": "Gentle slope", "source": "USGS 3DEP" },
    "environmental": { "score": 90, "label": "No issues", "source": "EPA/USFWS" }
  },
  "calculatedAt": "2026-03-25T08:00:00.000Z"
}
```

#### POST /api/properties/:id/dd-report
Generate a due diligence report for a property.

**Response:** Full DD report with data from all 18 government sources, organized by category.

#### GET /api/market-intelligence/:state/:county
Market predictions and price trends for a county.

### Email Thread (Inbound Email)

#### GET /api/leads/:leadId/emails
Retrieve the email thread for a lead (inbound + outbound).

#### POST /api/leads/:leadId/emails/reply
Send a reply email in the lead's thread.

**Body:**
```json
{
  "to": "seller@example.com",
  "subject": "Re: Your property",
  "body": "string"
}
```

#### POST /api/leads/:leadId/emails/mark-read
Mark emails as read.

**Body:**
```json
{ "emailIds": [1, 2, 3] }
```

#### GET /api/emails/unread-count
Count of unread inbound emails for the organization.

### Webhook Events

AcreOS can deliver webhooks for 30+ event types. Configure webhook endpoints via Settings → Integrations → Webhooks.

**Event payload format:**
```json
{
  "event": "event.type",
  "organizationId": 1,
  "timestamp": "2026-03-25T08:00:00.000Z",
  "data": { }
}
```

**Available event types:**

| Event | Description |
|-------|-------------|
| `lead.created` | New lead created |
| `lead.updated` | Lead fields changed |
| `lead.status_changed` | Lead status transition |
| `lead.responded` | Inbound email/SMS received from lead |
| `lead.scored` | Lead score recalculated |
| `deal.created` | New deal created |
| `deal.stage_changed` | Deal moved to new pipeline stage |
| `deal.closed` | Deal marked as closed |
| `property.created` | New property added |
| `property.enriched` | DD report completed |
| `property.lcs_calculated` | Land Credit Score generated |
| `note.created` | Seller-financed note created |
| `note.payment_received` | Payment recorded on a note |
| `note.payment_late` | Payment past grace period |
| `note.paid_off` | Note fully paid |
| `campaign.sent` | Campaign batch sent |
| `campaign.response` | Campaign response received |
| `offer.sent` | Offer letter sent |
| `offer.accepted` | Offer accepted by seller |
| `compliance.flag` | Dodd-Frank or TCPA flag raised |
| `agent.action` | AI agent took an autonomous action |
| `agent.recommendation` | AI agent generated a recommendation |
| `team.message` | Team message sent |
| `team.comment` | Comment on entity |
| `subscription.created` | New subscription |
| `subscription.cancelled` | Subscription cancelled |
| `subscription.upgraded` | Plan upgrade |
| `export.completed` | Data export ready |
| `feed.generated` | Deal feed generated |

### Embeddable Widgets

Embeddable widgets are available for external sites via iframe or JavaScript SDK.

#### Deal Analyzer Widget
```html
<iframe src="https://app.acreos.com/embed/deal-analyzer?key=YOUR_API_KEY"
  width="600" height="400" frameborder="0"></iframe>
```

#### Market Heatmap Widget
```html
<iframe src="https://app.acreos.com/embed/market-heatmap?state=TX&key=YOUR_API_KEY"
  width="800" height="500" frameborder="0"></iframe>
```

#### Property Valuation Widget
```html
<iframe src="https://app.acreos.com/embed/valuation?key=YOUR_API_KEY"
  width="500" height="350" frameborder="0"></iframe>
```

#### County Score Widget
```html
<iframe src="https://app.acreos.com/embed/county-score?state=TX&county=Hudspeth&key=YOUR_API_KEY"
  width="400" height="300" frameborder="0"></iframe>
```

### Error Response Format

All errors follow a consistent format:

```json
{
  "error": "NOT_FOUND",
  "message": "Lead not found",
  "statusCode": 404,
  "details": null
}
```

Error codes: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `LIMIT_EXCEEDED`, `INTERNAL_ERROR`.

## Support

For API support, contact your AcreOS administrator or visit the documentation at `/docs`.
