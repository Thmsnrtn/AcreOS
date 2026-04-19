# E2E Intelligent Test Transcript

- **Run ID**: 2026-04-19-r4-wyatt-mail
- **Persona**: 09-land-academy-style (Wyatt Kessler, 29, Provo UT, 2yr LA-style wholesaler, 25-30% offer formula)
- **Journey**: 02-mail-campaign-to-county
- **Date**: 2026-04-19T22:00:00Z
- **Target**: https://acreos.io
- **Protocol**: API-first
- **Steps**: 5

## Persona Summary

Wyatt Kessler — 2yr Land Academy disciple. Buys at 25-30% of assessor-implied market value, flips in 60 days, reinvests. Wants to replicate his LA+Offers2Owners workflow in AcreOS. Abandons if pricing is a black box, batch ops are capped, or he can't export raw data.

## Journey Objective

Select a target county → assemble a mailing list → configure mail template → preview → launch campaign.

---

## Steps

### Step 1 — List existing campaigns

- **Action**: `GET /api/campaigns?limit=10` with session + csrf
- **Result**: `[]` — fresh org has no campaigns. Normal baseline.

### Step 2 — Create a draft campaign

- **Action**: `POST /api/campaigns` `{"name":"Cochise Blind Offer Test 2026-04","type":"direct_mail","county":"Cochise","state":"AZ"}`
- **Result**: **201 Created**. Campaign `id: 1`, `status: "draft"`, `trackingCode: "CAMP-4PMOO9"`. CSRF fix (#11) working correctly on mutation.
- **In-character thought**: _"Draft's made. Not bad. Tracking code auto-generated — that's fine. Now where's the list builder?"_

### Step 3 — Check county browse endpoint

- **Action**: `GET /api/counties?state=AZ`
- **Result**: **404 Not Found**
- **In-character thought**: _"Sidebar has 'Counties' but the API endpoint is missing? That's going to make it painful to scope by county."_
- **Finding**: STR-013 (HIGH).

### Step 4 — Check direct-mail template endpoint

- **Action**: `GET /api/direct-mail/templates`
- **Result**: **404 Not Found**
- **In-character thought**: _"Templates is 404 too. How am I supposed to pick a template if the endpoint doesn't exist?"_
- **Finding**: STR-014 (HIGH).

### Step 5 — Verify mail provider configured

- **Action**: `GET /api/health` → check `lob` service state
- **Result**: `lob: unconfigured — LOB_LIVE_API_KEY or LOB_TEST_API_KEY not configured`
- **In-character thought**: _"Mail provider isn't even configured on the backend. Even if the UI flow worked, nothing would actually ship. Hard abandon."_
- **Finding**: STR-015 (CRITICAL).

### Step 6 — Ask Pax about LA-style offer math (secondary test)

- **Action**: `POST /api/ai/chat` with Wyatt's specific question — $8,400 assessed value, 40 acres, AZ 16% assessment ratio, target 25-30% of market
- **Result**: **500 Internal Server Error** after 450ms (too fast for OpenRouter — server-side crash)
- **Finding**: STR-016 (HIGH — regression, see below).

---

## AI Output Evaluations

Not reached — journey blocked before any Pax/Atlas output produced.

---

## Journey Verdict

- **Outcome**: **BLOCKED**
- **Satisfaction**: 1/5
- **Would Recommend**: **no**
- **Reasoning**: Three separate blockers compound here:
  (a) No Lob API key configured → even a perfect UI flow wouldn't send real mail (STR-015, launch blocker).
  (b) Two endpoints the mail-campaign journey depends on return 404 (`/api/counties`, `/api/direct-mail/templates`) — STR-013, STR-014.
  (c) `/api/ai/chat` regressed to 500 after the STR-012 timeout deploy — STR-016.
  Wyatt would create the campaign shell (step 2 works), fail to populate a county-scoped list, fail to pick a template, and discover Lob isn't configured. That's a 2-minute journey to a hard abandon.

### Top Issues

- **STR-015** (CRITICAL): `LOB_LIVE_API_KEY` / `LOB_TEST_API_KEY` are not configured in prod. The entire direct-mail feature category can't ship real mail. Configure one or the other via `flyctl secrets set LOB_TEST_API_KEY=<key>` or remove the direct-mail surface until a key is available.
- **STR-013/014** (HIGH): `/api/counties` and `/api/direct-mail/templates` return 404 despite being referenced by navigation and journey. Either route these endpoints or remove the client surface that expects them.
- **STR-016** (HIGH, regression): `/api/ai/chat` returns 500 after the STR-012 timeout change deployed. r3 had this endpoint working (CREDIBLE response in 15s). Root-cause and fix before the 90s-timeout change can ship safely.

### Persona quotes

> "Campaign create worked. Tracking code's auto-generated. OK."

> "Counties endpoint's 404. Templates endpoint's 404. How is the mail flow supposed to work if its supporting endpoints aren't there?"

> "Mail provider isn't configured. No Lob key. This whole category of features is non-functional. Hard pass."
