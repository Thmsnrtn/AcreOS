# Findings Report

- **Run ID**: 2026-04-19-r4-wyatt-mail
- **Persona**: 09-land-academy-style
- **Journey**: 02-mail-campaign-to-county
- **Total Findings**: 4 (1 CRITICAL, 3 HIGH)

## CRITICAL

### STR-015: Lob API key not configured — direct mail cannot ship

- **Severity**: CRITICAL
- **Step**: 5
- **URL**: /api/health
- **Description**: `/api/health` reports `lob: unconfigured — LOB_LIVE_API_KEY or LOB_TEST_API_KEY not configured`. Direct mail is a primary product capability (per acreos-product-model.md) and is the core journey for 4 of the 12 personas. Without a Lob key the entire flow produces at best a "draft" campaign that silently fails to send.
- **Persona Impact**: Wyatt's primary workflow. Hard abandon.
- **Recommended Action**: `flyctl secrets set LOB_TEST_API_KEY=...` for a test key (~$0 cost, free sandbox) until a live key is justified. Alternately: gate the direct-mail UI behind a feature flag that's OFF when the key is missing, with a clear message pointing to Settings.

## HIGH

### STR-013: /api/counties 404

- **Severity**: HIGH
- **Step**: 3
- **URL**: GET /api/counties?state=AZ
- **Description**: Sidebar nav includes a "Counties" link under Intelligence. The corresponding API endpoint is 404. Land-investor workflows are county-scoped; a county index endpoint is table-stakes.
- **Recommended Action**: Ship the `/api/counties` endpoint or remove the navigation item until it exists.

### STR-014: /api/direct-mail/templates 404

- **Severity**: HIGH
- **Step**: 4
- **URL**: GET /api/direct-mail/templates
- **Description**: Mail campaign journey requires template selection. The templates endpoint is 404.
- **Recommended Action**: Ship the endpoint. A minimal viable version can return a hardcoded array of 2-3 templates (postcard, yellow letter, blind offer letter) matching the taxonomy in typical-workflows.md §4.

### STR-016 (REGRESSION): /api/ai/chat returns 500

- **Severity**: HIGH
- **Step**: 6
- **URL**: POST /api/ai/chat
- **Description**: `/api/ai/chat` now returns 500 in ~450ms (too fast for OpenRouter latency — this is a server-side crash). r3 used this endpoint successfully 10 minutes earlier with response time 15s. The `STR-012` timeout-per-path deploy is the only intervening change.
- **Recommended Action**: Check Fly logs for the stack trace at `/api/ai/chat`. The most likely suspect: `timeoutForPath` uses `req.originalUrl || req.path` at call time but the `requestTimeout` middleware is mounted before Express resolves `originalUrl`, so the path check may fall through to default 30s without error — but something else in the same change likely triggered the regression. Rollback-friendly since the STR-012 change is isolated.
