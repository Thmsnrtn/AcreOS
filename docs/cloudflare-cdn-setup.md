# T50 — Multi-Region CDN + Edge Caching (Cloudflare)

## Overview

Cloudflare acts as a CDN and security layer in front of Fly.io.
Benefits:
- JS bundle (2–5MB) served from edge globally — 60-80% load time reduction for non-US users
- Bot protection and DDoS mitigation (built-in, no config needed)
- TLS termination at edge
- Cache static assets at edge indefinitely (until deploy invalidates cache)

## Setup Steps

### 1. Add Domain to Cloudflare

1. Log in to Cloudflare Dashboard → Add Site → enter your domain
2. Change nameservers at your registrar to Cloudflare's nameservers
3. Wait for DNS propagation (usually < 1 hour)

### 2. Configure Fly.io Custom Domain

```bash
# Add your custom domain to Fly.io
flyctl certs create app.yourdomain.com

# Verify the certificate
flyctl certs check app.yourdomain.com
```

In Cloudflare DNS, add a CNAME record:
- Type: `CNAME`
- Name: `app`
- Target: `acreos.fly.dev` (your Fly.io hostname)
- Proxy status: **Proxied** (orange cloud ON — this routes through Cloudflare CDN)

### 3. SSL/TLS Settings

In Cloudflare Dashboard → SSL/TLS → Overview:
- Set mode to **Full (Strict)** — Fly.io has a valid certificate, so use strict mode
- Enable **Always Use HTTPS**
- Enable **HTTP/2 and HTTP/3**

### 4. Cache Rules (Cloudflare Cache Rules)

In Cloudflare → Caching → Cache Rules, create these rules in order:

**Rule 1 — Never cache API endpoints**
```
Expression: (http.request.uri.path starts_with "/api/")
Cache status: Bypass
```

**Rule 2 — Never cache WebSocket endpoint**
```
Expression: (http.request.uri.path eq "/ws")
Cache status: Bypass
```

**Rule 3 — Long-term cache for static assets**
```
Expression: (http.request.uri.path matches "\.(js|css|woff2|woff|ttf|png|jpg|webp|svg|ico)$")
Cache status: Cache Everything
Edge TTL: 1 year (respects cache-control headers from Vite build)
Browser TTL: 1 year
```

**Rule 4 — HTML pages — cache short-term**
```
Expression: (http.request.uri.path eq "/")
Cache status: Cache Everything
Edge TTL: 5 minutes
Browser TTL: 0 (revalidate)
```

### 5. Vite Build — Ensure Cache-Busting Headers

Vite already produces content-hashed filenames (e.g., `index-Abc123.js`).
In `server/index.ts` or the static file serving config, ensure:

```typescript
// Serve built assets with long-lived cache headers
app.use('/assets', express.static(path.join(__dirname, '../dist/assets'), {
  maxAge: '1 year',
  immutable: true,  // tells browser the file never changes (content-hash guarantees it)
}));
```

### 6. Cache Invalidation on Deploy

Add to `.github/workflows/deploy.yml` after successful deploy:

```yaml
- name: Purge Cloudflare cache
  run: |
    curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
      -H "Authorization: Bearer $CF_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data '{"purge_everything":true}'
  env:
    CF_ZONE_ID: ${{ secrets.CLOUDFLARE_ZONE_ID }}
    CF_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

### 7. Security — Rate Limiting at Edge (optional)

In Cloudflare → Security → WAF → Rate Limiting:
- Rule: Requests to `/api/auth/` > 10 per minute per IP → Block for 10 minutes
- Rule: Requests to `/api/ai/` > 60 per minute per IP → Challenge
- Rule: Requests from known bot ASNs → Challenge

### 8. Environment Variables to Add

```bash
# Add to Fly.io secrets
flyctl secrets set CLOUDFLARE_ZONE_ID=your-zone-id
flyctl secrets set CLOUDFLARE_API_TOKEN=your-api-token
```

Add to `.env.example`:
```
CLOUDFLARE_ZONE_ID=       # Cloudflare zone ID for cache purge on deploy
CLOUDFLARE_API_TOKEN=     # Cloudflare API token with Cache Purge permission
```

## Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| JS bundle load time (US) | ~800ms | ~200ms |
| JS bundle load time (EU) | ~2,000ms | ~200ms |
| JS bundle load time (Asia) | ~3,500ms | ~200ms |
| DDoS protection | None | Automatic |
| Bot filtering | None | Automatic |
| TLS handshake overhead | ~100ms | ~10ms (edge closer to user) |

## Notes

- WebSocket connections (`/ws`) bypass Cloudflare — they connect directly to Fly.io
  (Cloudflare proxied WebSockets require Enterprise plan)
- If using Cloudflare Enterprise, enable Cloudflare WebSocket proxying and set appropriate timeout
- Monitor Cloudflare Analytics for cache hit rate — target > 80% for static assets
