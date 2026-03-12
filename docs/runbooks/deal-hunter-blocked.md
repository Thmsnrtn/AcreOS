# Runbook: Deal Hunter Scraper Blocked

**Severity:** P3 — Feature Degraded (non-revenue-critical)
**Task Reference:** #324

---

## Symptoms
- Deal Hunter job logs show `403 Forbidden`, `429 Too Many Requests`, or `Captcha required`
- `dealHunterSources` table has sources with `lastError` containing block indicators
- No new leads being imported from automated sources
- Grafana: Deal Hunter success rate drops to 0%

---

## Detection

```bash
# Check deal hunter job logs
fly logs -a acreos | grep -i "deal.hunter\|scrape\|blocked\|captcha" | tail -30

# Check source health in DB
# Run from admin panel or psql:
# SELECT name, lastError, lastScrapeAt, successRate FROM deal_hunter_sources
# WHERE lastError IS NOT NULL ORDER BY lastScrapeAt DESC;
```

---

## Immediate Actions

### 1. Identify which sources are blocked
Sources may include: Zillow, Realtor.com, county assessor sites, FSBO sites, Craigslist

### 2. Pause blocked sources temporarily
```bash
# Via admin panel: Admin → Deal Hunter → Sources → Pause Source
# Or via API:
curl -X PATCH /api/deal-hunter/sources/:id \
  -H "Content-Type: application/json" \
  -d '{"active": false}'
```

### 3. Rotate User-Agent string
Update the scraper config in `server/services/dealHunter.ts`:
- Rotate to a different browser User-Agent
- Add realistic request delays (2-5 seconds between requests)
- Reduce concurrent scrapers per source

### 4. Use residential proxy rotation (if configured)
```bash
fly secrets set SCRAPER_PROXY_URL=http://user:pass@proxy-provider.com:8080 -a acreos
```

---

## Proxy Rotation Strategy

### Signs you need proxy rotation:
- Multiple sources blocked within the same time window
- IP-level block (affects all sources, not just one)
- Error: `ERR_CONNECTION_REFUSED` or timeout from the scraper IP

### Recommended proxy providers:
- Bright Data (Luminati) — residential IPs
- Oxylabs — county gov sites
- SmartProxy — real estate listing sites

### Adding proxy support:
```typescript
// In server/services/dealHunter.ts
const proxyUrl = process.env.SCRAPER_PROXY_URL;
const fetchOptions = proxyUrl ? {
  agent: new HttpsProxyAgent(proxyUrl)
} : {};
```

---

## Alternative Data Sources

If major sources are blocked, pivot to:
1. **County assessor direct XML feeds** — more reliable, official
2. **ATTOM Data Solutions API** (if `ATTOM_API_KEY` is configured)
3. **Manual CSV import** — instruct users to export from sources directly
4. **Public records via county GIS endpoints** — already seeded in DB

---

## Recovery Verification

After unblocking:
```bash
# Trigger a manual scrape run
curl -X POST /api/deal-hunter/scrape \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Check results
fly logs -a acreos | grep "deal.hunter" | tail -20
```

---

## Prevention
- Implement minimum 2-second random delay between requests
- Rotate User-Agent strings from a pool of real browser UAs
- Use session cookies and respect `robots.txt`
- Monitor block rate per source and auto-pause at >20% failure rate
