# AcreOS API Reference

## Overview

The AcreOS API provides RESTful endpoints for managing land investment operations including leads, properties, deals, and finances. All endpoints require authentication unless otherwise noted.

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

## Support

For API support, contact your AcreOS administrator or visit the documentation at `/docs`.
