# Phase 4: Production Deploy Log

Date: 2026-04-18
Deploy SHA: 9bca216

---

## Pre-Deploy Fix

**Issue discovered**: Docker build failed with `Rollup failed to resolve import "react-is" from "recharts"`. The `react-is` package was available locally as a transitive dependency but not resolved in Docker's clean `npm ci` environment.

**Fix**: Added `react-is` as an explicit dependency (commit 9bca216).

## Deploy

- **Command**: `fly deploy`
- **Time**: 2026-04-18T21:47:00Z
- **Build**: Succeeded (Depot remote builder)
- **Machines**: 2/2 updated and healthy
  - 7813202b50e6e8: started, health passing
  - e827514ae34de8: started, health passing
- **Version**: 129 (was 128)
- **DNS**: acreos.fly.dev verified

## Smoke Tests

| Endpoint | Expected | Actual | Status |
|----------|----------|--------|--------|
| GET /api/health | 200 | 200 | PASS |
| GET / | 200 | 200 | PASS |
| GET /auth | 200 | 200 | PASS |
| GET /api/stripe/products | 401 (unauthed) | 401 | PASS |
| GET /api/trial/status | 401 (unauthed) | 401 | PASS |

## Health Check Response

```json
{
  "overall": "degraded",
  "services": {
    "database": "healthy (10ms)",
    "redis": "healthy (91ms)",
    "stripe": "healthy (239ms)",
    "openai": "unavailable (invalid API key)",
    "twilio": "unconfigured",
    "email": "healthy (AWS SES)",
    "lob": "unconfigured"
  }
}
```

**Notes**:
- "degraded" status due to OpenAI API key being invalid and Twilio/Lob unconfigured. These are configuration items, not code issues.
- Database, Redis, Stripe, and Email are all healthy.

## Logs

- No 500 errors in post-deploy logs
- Transient health check failure during machine restart (expected during deploy)
- Both machines serving traffic within 30 seconds of deploy

## Migration Status

- Production database is running (health check confirms connectivity)
- Migration state not independently verified (would require DB access)
- Prior deploy (v128) was operational, suggesting migrations 0023-0025 already applied

## Issues

1. **OpenAI API key**: Shows "Invalid API key" in health check. The founder needs to verify the `AI_INTEGRATIONS_OPENAI_API_KEY` secret in Fly.io.
2. **Twilio**: Unconfigured — SMS features won't work until configured.
3. **Lob**: Unconfigured — direct mail features won't work until configured.

These are configuration items documented in `.env.example`, not code defects.
