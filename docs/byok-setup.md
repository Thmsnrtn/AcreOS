# Bring Your Own Key (BYOK) Setup Guide

BYOK allows Pro-tier users to connect their own data provider API keys for enhanced property enrichment. This unlocks premium data sources without AcreOS incurring per-lookup costs.

## Supported Providers

| Provider | Key Name | What It Provides |
|----------|----------|-----------------|
| **Regrid** | `regrid` | Parcel boundaries, ownership, assessor data |
| **ATTOM** | `attom` | Property details, valuations, foreclosure data |
| **BatchData** | `batchdata` | Skip tracing, property appending, owner info |

## How It Works

1. User obtains an API key from the provider's website
2. Key is stored encrypted in AcreOS (AES-256 via `server/services/encryption.ts`)
3. When enrichment runs, the data source broker checks for BYOK keys before falling back to free sources
4. BYOK lookups are metered but do not consume AcreOS credits — the user pays the provider directly

## Setup Steps

### 1. Navigate to Settings

Go to **Settings > Integrations > Data Providers** in the AcreOS UI.

### 2. Enter Your API Key

Click "Connect" next to the provider name and paste your API key. The key is encrypted at rest and never displayed after saving.

### 3. Test the Connection

Click "Test" to verify the key works. AcreOS will make a single test request to the provider's API.

### 4. Enable for Enrichment

Once connected, the provider will automatically be used during property enrichment. The data source broker prioritizes sources in this order:

1. **Free** — Open government APIs (always checked first)
2. **Cached** — Previously fetched results
3. **BYOK** — Your own API keys
4. **Paid** — AcreOS credit-based lookups (if available)

## API Endpoints

### Save BYOK Key
```
POST /api/integrations/byok
Body: { "provider": "regrid", "apiKey": "your-key-here" }
```

### Test BYOK Key
```
POST /api/integrations/byok/test
Body: { "provider": "regrid" }
```

### Remove BYOK Key
```
DELETE /api/integrations/byok/:provider
```

### List Connected Providers
```
GET /api/integrations/byok
Response: [{ "provider": "regrid", "connected": true, "lastUsed": "..." }]
```

## Security

- Keys are encrypted with AES-256-GCM before storage
- Encryption key is derived from `SESSION_SECRET` environment variable
- Keys are never logged, never included in API responses, and never sent to third parties other than the intended provider
- BYOK keys are scoped to the organization — team members share the same keys

## Tier Requirements

- **Free / Starter**: BYOK is not available. Upgrade to Pro to connect your own keys.
- **Pro**: Full BYOK support for all three providers.
- **Scale / Enterprise**: (Coming soon) BYOK plus negotiated bulk rates.

## Troubleshooting

### "Invalid API Key"
- Verify the key is correct by testing it directly with the provider's API
- Some providers require account activation before API access works
- Check that your provider account has sufficient credits/quota

### "Provider Timeout"
- BYOK requests timeout after 10 seconds
- The system falls back to free sources if BYOK fails
- Check the provider's status page for outages

### "BYOK Not Available"
- BYOK requires Pro tier or higher
- Check your subscription status at Settings > Billing
