# DNC / TCPA Litigator Scrub Vendor Comparison

_Prepared 2026-07-11 for roadmap Founder decision #1 (Wave 1.5). Web research
against vendor public sites; every claim cited; "not published" means exactly
that — no guessed numbers._

**Key finding:** DNC.com and dncscrub.com are the **same company** — both are
Contact Center Compliance properties (DNC.com footer: "© Contact Center
Compliance"; dncscrub.com is the DNCScrub® product site). Searchbug added as a
clearly relevant pay-per-use alternative.

| | **Contact Center Compliance (DNC.com / DNCScrub®)** | **TCPA Litigator List** | **Searchbug** |
|---|---|---|---|
| **Federal DNC** | Yes ([dnc.com](https://www.dnc.com/)) | Yes ([tcpalitigatorlist.com](https://tcpalitigatorlist.com/)) | Yes ([tcpa page](https://www.searchbug.com/info/solutions/tcpa/)) |
| **State DNC** | Yes — "Federal, State and Internal… in a single scrub" | Yes | Yes — all 13 state lists |
| **TCPA litigators** | Yes — "serial litigators and professional plaintiffs" | Core product — 600K+ litigators, "trolls" (demand-letter senders), DNC complainers, TCPA attorneys | Yes — litigators + known complainers |
| **Reassigned numbers** | Yes — TCPA Reassigned ID℠ | Partial — name-recognition heuristic, NOT the FCC RND | Yes — dedicated FCC RND API |
| **Real-time API** | REST; OAuth 2.0; single + batch endpoints ([docs.dncscrub.com](https://docs.dncscrub.com/introduction)) | REST; Basic Auth w/ dashboard keys; sync batches ≤3,000 numbers, larger queued; 50 calls/sec ([API docs](https://tcpalitigatorlist.com/api-documentation/)) | REST, JSON/XML, real-time; free API test account ([search-apis](https://www.searchbug.com/api/search-apis.aspx)) |
| **Pricing (published)** | **Not published** — volume-tiered, sales contact required | $199/mo (200K, no API) → API $299/mo (300K) up to $4,999/mo (50M); overage $0.0006–$0.002/number; optional dedicated API server $250/mo ([packages](https://tcpalitigatorlist.com/packages/)) | Pay-as-you-go prepaid ($10–$5,000 balance), no charge on no-hit, volume discounts; exact per-number DNC rate **not published** ([pricing-api](https://www.searchbug.com/pricing-api.aspx)) |
| **Safe harbor / indemnity** | Strongest posture: timestamped scrub receipts, audit reports marketed as safe-harbor evidence; **no formal indemnification found** | **None found** on site | RND API positioned for Safe Harbor; **no indemnification found** |
| **Notable** | 70B+ scrubs, 20+ dialer/CRM integrations; enterprise sales motion = setup friction | No contract minimums; cheapest API entry $299/mo; litigator DB is its specialty, popular in RE investor circles | No minimums/subscription/contract; optional annual plan $2,400 min |

## Recommendation (solo founder, low-thousands numbers/month, API-first)

Start with **Searchbug** — pay-as-you-go with no subscription, a free API test
account, and coverage of federal/state DNC + litigators + the actual FCC
Reassigned Numbers Database maps exactly to launch volume, where even TCPA
Litigator List's cheapest API tier ($299/mo for 300K scrubs) would be ~99%
unused capacity. If outbound proves litigator-risk-heavy (typical for RE cold
outreach), add **TCPA Litigator List** as a second data source later — its
600K-record litigator/troll database is deeper than generalist scrubs and its
sync ≤3,000-number batch API fits per-batch pre-send checks. Revisit **Contact
Center Compliance** once volume justifies a sales-quoted contract — it has the
most credible safe-harbor audit-trail tooling, which matters if AcreOS itself
could face vicarious TCPA exposure for customer sends. None of the three
publishes actual indemnification.

## Wiring status

The scrub seam (service + schema + gate wiring + tests) already exists and is
vendor-agnostic. Once the founder confirms a vendor and provides an API key,
wiring is a provider-adapter task; cold SMS stays OFF until then.
