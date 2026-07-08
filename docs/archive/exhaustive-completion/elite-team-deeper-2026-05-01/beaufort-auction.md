# Beaufort Venables — AcreOS audit (auction-platform lens)

I'm Beaufort Venables, 49, BD lead at Bid4Assets. We've run county tax-deed auctions for 25 years — California strikeoffs, Florida tax deeds in Marion/Citrus/Hernando, Virginia non-judicial, sheriff sales in PA and NY. Roughly 200 county clients, ~$1.2B in property gavelled per year through our platform. AcreOS users bid through us today; about 40 of them based on the referrer logs my engineering team pulled last Tuesday. Volume of those 40 is meaningful — top decile is $250K-$2M of capital each through B4A annually.

I'm here because Marcus and Rina both flagged AcreOS's auction layer as the weakest part of the product. They're right, but they wrote it from the *bidder's* seat. I'm writing it from the *platform's* seat — what it would take for B4A and AcreOS to integrate cleanly, where AcreOS today is a pleasant download partner versus a real systems counterparty, and what we'd want to see before a federation deal moves past my BD pipeline into a contract.

---

## 1. Thirty-second verdict

**AcreOS is one engineering quarter away from being a meaningful B4A integration partner. Today they're not.** The schema bones are right (`taxSaleAuctions`, `taxSaleListings`, `autoBidRules`, `dealAlerts` — Marcus correctly noted this is unusual for "real estate CRMs"). The plumbing — calendar federation, results-import, max-bid syncing, post-sale title delivery — is either stubbed (`generateMockAuctionData` with `Math.random()` parcel counts) or absent. From my seat: a partner I can't pipe a JSON results-feed to is a partner I can't sell my counties on jointly.

If they ship the four things in §5 by Q3, I bring this to my partnerships VP and we cut a federation deal. If they ship one or two, we stay at "B4A is a `auctionUrl` string in `COUNTY_AUCTION_SOURCES`" — which is to say, nothing.

---

## 2. The integration walkthrough — what AcreOS↔B4A *should* look like

**Tuesday 6 AM, sale day at Riverside County CA (B4A-hosted).** An AcreOS user with an active `autoBidRule` for "CA, max $40K, distress > 70" should already have:

- The full Riverside lot list pre-loaded into AcreOS via our **Calendar Federation API** (we publish per-county JSON: parcels, opening bid, deposit %, deposit deadline, format, registration cutoff). AcreOS's `taxSaleAuctions` table maps 1:1 — I can already see it in `shared/schema.ts:6802`. The fields they're missing for a clean federation: `platformId` ("bid4assets" / "realauction" / "miami_dade"), `platformAuctionId` (our internal sale ID), `platformParcelId` per listing, `feeSchedule` (premiums, buyer's premium, recording-fee passthrough). All four fit on the existing tables. One migration.
- A pre-deposit reconciliation. Riverside requires 10% deposit, wired by Friday close. AcreOS's `depositRequired: "500"` literal in `taxResearcher.ts:220` is wrong on every CA sale we run — every Riverside sale is **$5,000 minimum, 10% of bid budget, whichever is greater**. The bidder shows up underfunded and we lock them out at registration. **One under-deposited bidder per quarter is one customer we both lose.**

**8 AM, sale opens.** Bidding goes live on B4A. Today AcreOS has no live tap — Rina noted she keeps two browser tabs open. The right architecture:

- AcreOS user authorizes their B4A account via OAuth (we have an OAuth provider; nobody has asked us to expose it for partner integration before, but we'd build it for a real partner).
- AcreOS pushes their `autoBidRule.maxBidAmount` to B4A as a **proxy bid** via our existing `POST /api/v2/proxy-bids` endpoint (this is what live in-person bidders' agents use). We already support proxy-bid placement via API for our enterprise broker clients. AcreOS would be the first SaaS partner to use it.
- B4A holds the proxy bid, increments per minimum-increment rules per parcel, fires a webhook on each event: `bid.placed`, `bid.outbid`, `bid.won`, `bid.lost`, `auction.closed`.

**11 AM, sale ends.** This is where AcreOS's gap is widest. Marcus's "I write it on a clipboard" maps directly to: **no results-ingestion endpoint.** My engineers ship a `results.csv` per sale and a `POST /api/auction-results` webhook to subscribed partners. AcreOS subscribes to the webhook → ingests → writes rows into `taxSaleListings` with `winningBid`, `winningBidder`, `winningRate` (FL only), `status: "sold" | "unsold" | "redeemed"`. The schema row at `taxSaleListings` line 6858 has `auctionId` and `certificateNumber` but doesn't have `winningRate` or `winningBid` as first-class fields — Rina correctly flagged this for FL.

**Wednesday, the day after.** Title delivery. B4A sends the deed packet (clerk-recorded deed image + sale-confirmation receipt) via S3-presigned URL or SFTP to the winner. AcreOS today has a documents module — perfect target. **No partner-document-ingestion API.** Should be `POST /api/documents/inbound` with HMAC signature + organization scoping. We'd push every winner's deed packet straight into their AcreOS document tree under `/Auctions/Riverside-2026-05/$parcelId/`. No download-and-upload. That's the kind of integration that makes the platform sticky.

---

## 3. Per-surface friction (auction-platform-integration lens)

**`COUNTY_AUCTION_SOURCES` (`taxResearcher.ts:108`)** — Three counties hardcoded: Maricopa, Clark, Harris. None of B4A's ~200 counties. None of RealAuction's ~50 FL counties. None of Miami-Dade's in-house portal. **This dictionary should be a database table seeded from a federation-partner API**, not a 3-row TypeScript constant. We'd happily provide ours; RealAuction would too if asked.

**`generateMockAuctionData` (`taxResearcher.ts:203`)** — Same critique Marcus and Rina made: `Math.random() * 200 + 50` parcels, `depositRequired: "500"` constant, `minimumBid: "100"` constant. From my seat: every AcreOS user who scans a county and trusts these numbers is showing up to *my* sale under-prepared and bouncing off our registration desk. **AcreOS is currently a slight liability to my customer-experience metric.** A real federation feed displaces this entirely.

**`autoBidRules` schema (`schema.ts:8805`)** — This is where I got optimistic. The shape is right — geographic filters, max bid, strategy, monthly budget, approval threshold. The gap: **no `platformId` or `platformAccountId` field**. If AcreOS wants auto-bid to actually place bids on B4A (today `placeAutoBid` writes a row and a comment that says "In production, would integrate with auction platforms" — `dealHunter.ts:441`), each rule needs to know *where* to bid. Add `platformId` (enum), `platformCredentialId` (FK to a stored OAuth/API-key vault row), and `platformParcelMatchKey` (how to map AcreOS's `scrapedDealId` → our `lotId`). One sprint.

**`bidStrategy` enum** — Today: `percentage_of_value | fixed_amount | incremental`. This covers high-bid auctions only. Florida certificate sales are reverse — bidders bid the *interest rate down* from 18%. Rina nailed this. From my seat the integration impact: **B4A runs both formats in different counties** (high-bid in CA/NV/PA, bid-down in some FL certificate sales we host). AcreOS's auto-bid rule can only express one of them. Add `auctionDirection: "high_bid" | "low_bid"` and `minAcceptableRate` (companion to `maxBidAmount`).

**Webhook outbound capability (`server/services/webhookDispatcher.ts`)** — Confirmed exists. AcreOS dispatches outbound webhooks to org-configured endpoints, with HMAC signing (`signPayload` import at `routes-integrations.ts:1711`). **But there's no inbound auction-event consumer.** I want the inverse: B4A pushes `bid.won` to AcreOS, AcreOS verifies our HMAC signature, ingests. The dispatcher's signing is org-scoped (good for outbound) but for inbound from a known partner like B4A, AcreOS needs a per-partner shared secret + a partner-event registry. New module, ~400 LOC.

**Deposit handling** — Single literal `"500"` in the entire codebase. Real deposits are: percentage of bid budget (CA, most B4A counties), flat per-county dollar amount (some FL counties, $200-$2,000), proof-of-funds letter (some VA non-judicial). The `taxSaleAuctions.depositRequired` column is a single numeric — should be `depositRule` JSONB: `{type: "percentage" | "flat" | "letter", value, minimum, deadline_offset_days}`. Without this, every AcreOS user is one bad assumption away from a forfeit-or-locked-out moment.

**Results CSV import** — Rina asked for this generically; from my side, B4A publishes results in three formats (CSV, JSON, XML) via our `/results/{sale_id}` endpoint. AcreOS today has CSV import for tax-delinquent leads (the `APN_ALIASES`/`OWNER_ALIASES` mapper Marcus noted). **Adapt the same import primitive to ingest auction results.** The unique-key fix Marcus flagged — `(state, county, apn)` not just `apn` — applies double here. B4A reuses parcel IDs across counties more often than people think.

**Surplus-funds tracking** — Rina flagged this for FL specifically. From my platform-seat: **B4A reports surplus-funds amounts per parcel back to the county clerk; the clerk holds the money pending claims.** We have a `surplus.declared` event in our webhook taxonomy that fires post-sale-confirmation. AcreOS subscribes → writes to a new `parcelSurplusFunds` table → surfaces a claim deadline. This is a $40M/year sub-industry that AcreOS could index and broker. We'd partner on it.

**Title delivery / deed packet** — Today AcreOS has a documents module with HMAC public-link signing (per Marcus's reference to Wendell loving it). What's missing for auction integration: a partner-ingestion endpoint that lets B4A *push* deeds into the user's account. Spec: `POST /api/integrations/partner/{partnerId}/documents` with HMAC signature, multipart upload, JSON metadata `{parcelId, saleId, documentType: "tax_deed" | "certificate_of_sale" | "redemption_receipt"}`. Routes to the right org by `partnerAccountMapping.organizationId`. Two-week build.

**Calendar federation** — `taxSaleAuctions` table is a fine destination but there's no scheduled refresh job tied to a partner feed. The browser-automation job at `taxResearcher.ts:141` is a placeholder. Production needs a cron that hits `b4a.calendar.upcoming({state, days:90})` and upserts. We expose a public calendar JSON; the keyed-API version with per-county detail is partner-tier. **AcreOS gets the keyed-API version free if they're the federation partner — that's a $25K/year value to them at retail; we'd give it for the integration.**

**Auction-rule federation** — Each county has rules that change per sale: bid increments, premium %, recording-fee passthrough, payment deadline (24-72h post-sale typically), redemption process per state. B4A maintains this per-county-per-sale internally; we publish a `rules.json` per sale. AcreOS today has nothing for this beyond the 8-state cheat sheet in `taxResearcher.ts` that Marcus flagged. **A federated rules-feed beats a hand-curated state-rules database for time-to-accuracy.** I'd rather ship them ours and have it be right today than wait for their paralegal-driven 50-state research project (which Rina specced and which I agree with).

**Reassigned-numbers / state DNC** — Tangential to auction integration but Marcus flagged it. From my seat: B4A users often call winning bidders post-sale to coordinate payment; if AcreOS is the dialer, the same TCPA gates apply. The `tcpaCompliance.ts` module at quiet-hours is good. I'd want AcreOS to extend it for *post-sale-confirmation* outbound calls — different consent posture than cold prospecting. Probably out-of-scope for this audit.

**Multi-platform user reality** — Rina's most important sentence: 67 FL counties on at least three platforms. From my BD seat the right architecture is **AcreOS as the bidder's neutral abstraction layer over all platforms**, not AcreOS-as-B4A-frontend. We'd lose some lock-in but gain the user — and the user is a multi-platform bidder anyway. So the federation should be **per-platform adapters**, with B4A, RealAuction, and Miami-Dade as the first three. Schema shape: `auctionPlatforms` table (id, name, apiBase, oauth_url, supports_proxy_bid: bool, supports_results_webhook: bool); `taxSaleAuctions.platformId` FKs into it. Other platforms plug in over time.

**Bid-increment math** — AcreOS's `calculateBidAmount` (`dealHunter.ts:392`) returns naive numbers. B4A's bid increments are non-uniform: $100 increments under $10K, $250 under $50K, $1,000 under $250K, custom over. **A bid quoted at "$4,200" by AcreOS may not be a legal bid increment on our platform** — closest legal is $4,200 if minimum is $4,100, otherwise rounded up. Either AcreOS asks our increment table per-parcel or our proxy-bid endpoint silently rounds. We round; AcreOS users see "their bid was $4,300 not $4,200." Better to expose increments and let AcreOS show the user the right number on their worksheet.

**Pre-sale registration timing** — B4A registration cutoffs vary, typically 48-72h before sale. `taxSaleAuctions.registrationDeadline` field exists (good). But AcreOS doesn't surface it as a deadline. **Day-of-deadline reminder push notifications would meaningfully reduce no-shows on our platform.** Direct measurable benefit to B4A from the integration.

**Proxy-bid security** — If AcreOS places bids on B4A on behalf of users, that's a fiduciary moment. Our compliance team will require: explicit per-sale user authorization (not blanket), bid receipt with signature, reversal/cancellation window before sale starts, audit trail. AcreOS's `requiresApproval` flag and `approvalThreshold` on `autoBidRules` (`schema.ts:8832-8833`) is the right shape. Wire it to a per-sale confirmation webhook from us and we're aligned.

---

## 4. The integration-readiness test

Twelve criteria for B4A to enter a federation deal with a SaaS partner. AcreOS today:

- **Stable schema for federated auction data** — *Pass.* `taxSaleAuctions` + `taxSaleListings` are the right shape. Needs platform identifier columns added; otherwise federation-ready.
- **Webhook inbound with HMAC verification** — *Fail.* Outbound exists. Inbound from named partners doesn't.
- **Per-platform credential vault** — *Fail.* No `platformCredentials` or `partnerAccount` table. Users can't link their B4A account today.
- **Auction-direction modeling (high/low bid)** — *Fail.* Single direction assumed in `autoBidRules`.
- **Bid-increment awareness** — *Fail.* Naive arithmetic in `calculateBidAmount`.
- **Deposit-rule modeling** — *Fail.* Single numeric column; no rule type, no deadline offset.
- **Results-ingestion endpoint** — *Fail.* No CSV-import path for results, no JSON webhook consumer.
- **Document-ingestion endpoint for partner-pushed deeds** — *Fail.* Documents module accepts user uploads, not partner pushes.
- **Surplus-funds tracking** — *Fail.* No table, no surface.
- **Per-partner audit log of bid placement** — *Partial.* `dealAlerts` rows are the right shape but no platform-execution receipt.
- **TCPA-compliant post-sale messaging** — *Pass-ish.* `tcpaCompliance.ts` covers the call layer; no auction-specific tuning.
- **Two-witness/recording compliance for delivered deeds** — *Pass.* `stateDocumentConfig.ts` correctly encodes FL two-witness rule per Rina's note.

**Net: AcreOS passes 2.5 of 12.** A federation deal needs at least 9 of 12. The good news is the failures are well-scoped — none of them require a research project, all of them are 1-3 sprint items.

---

## 5. The four things that would close a federation deal

1. **Inbound partner-event webhook consumer.** Per-partner shared secret, HMAC verification, event taxonomy: `auction.scheduled`, `auction.opened`, `auction.closed`, `bid.placed`, `bid.won`, `bid.lost`, `surplus.declared`, `deed.recorded`. Routes to `taxSaleAuctions` / `taxSaleListings` / a new `parcelSurplusFunds` table / the documents module. Three weeks.

2. **Platform-credential vault + OAuth-link UI.** `platformAccounts` table (orgId, platformId, oauthRefreshToken, accountIdentifier, linkedAt, status). Settings page to link B4A / RealAuction / Bid4Assets. Once linked, user's `autoBidRules` reference `platformAccountId` and AcreOS becomes able to actually place bids. Two weeks plus the OAuth dance per platform.

3. **Auction-direction + bid-increment + deposit-rule schema.** Migration adds `auctionDirection`, `bidIncrementRule` (JSONB), `depositRule` (JSONB), `winningBid`, `winningRate`, `winningBidder` columns. Updates `calculateBidAmount` to consult the increment rule. One week.

4. **Federated calendar feed consumer with cron-driven upserts.** Replaces `generateMockAuctionData`. Pulls from B4A first (we'd give them the keyed-API), RealAuction second, Miami-Dade third. Schema upserts on `(platformId, platformAuctionId)`. Marcus's `(state, county, apn)` dedup applies. Two weeks for the first platform, one each for subsequent.

Total: ~10 engineering weeks. One engineer. By Q3, AcreOS is a real federation partner and B4A is recommending them to the 5,000+ FL-only operators Rina mentioned plus our broader ~80,000 active bidders.

---

## 6. Three things that surprised me positively

1. **`autoBidRules` schema.** The fact that AcreOS modeled auto-bidding as a first-class entity — with monthly-budget controls, approval thresholds, geographic filters — tells me somebody on this team has seen a real auction operation. Most "real estate CRMs" I've evaluated as integration partners model bidding as a free-text note on a deal. AcreOS modeled it correctly. The bones are there.

2. **`auctionFormat: "in_person" | "online" | "sealed_bid"`** at `schema.ts:6814`. The fact that *sealed bid* is in the enum means somebody knew that some sheriff sales (PA, parts of NY) and some federal IRS sales run sealed. Most tax-sale schemas I've seen omit it. Tells me the schema designer did the homework on auction-format taxonomy.

3. **HMAC-signed outbound webhook dispatcher.** Already exists, already signs, already org-scoped. Inverting it for inbound partner events is straightforward. The team that built the outbound dispatcher will recognize the inbound pattern immediately. **Half my federation work is already done; they don't know it yet.**

4. **(Bonus.)** `dealAlerts.alertType` enum includes `bid_placed`, `bid_won`, `bid_lost`, `auction_soon`. That taxonomy maps 1:1 to our webhook event names. **Whoever picked these strings was thinking like a platform integrator.** I'd bet money there's a former auction-platform engineer on the AcreOS team.

---

## 7. Pricing and partnership shape

We don't bill AcreOS users directly today — they pay us through B4A's bidder-deposit model and platform fees per sale (1.5-2.5% buyer's premium typical). For a federation deal, the structure I'd take to my partnerships VP:

- **No revenue share at the platform fee layer.** That's our county-contract money; we don't share it. Bidders are the customers there.
- **Referral fee both directions.** AcreOS pays us $25 per AcreOS-Pro user who completes their first B4A registration (we'd attribute via UTM + OAuth-link). We pay AcreOS $50 per B4A bidder who upgrades to AcreOS Pro from a federated landing page. Both sides get distribution.
- **Co-marketing.** Joint webinar series on tax-deed mechanics. We bring our 80K bidder list; AcreOS brings their persona content. One per quarter, four counties highlighted per webinar.
- **Data-share at the calendar layer free both directions.** AcreOS gets our keyed calendar API. We get their lead-density heatmaps for territory-planning when we pitch new counties. Net-neutral commercial value, big strategic value.
- **Premium tier later.** If AcreOS ever wants white-label B4A bidding embedded in their UI (not just OAuth-handoff), that's a separate enterprise SKU at $50K/yr. Not for v1.

The 5K Florida-only operators Rina mentioned and the 200-300 multistate tax-deed pros on the platform represent ~$2-4M of AcreOS-side ARR if the integration is done right. From B4A's seat that's ~$80M-120M of incremental gavelled volume per year, of which we clip 1.5-2%. **Both sides win at six-figure annual ROI on the engineering investment.** That's why I'd pitch this internally.

---

## 8. The deal-killer if not fixed

**Bid-placement reliability.** If AcreOS's auto-bid says "bid placed at $4,200 on Riverside parcel 12345" and B4A's audit log shows no bid received — or shows a bid at $4,300 because of increment rounding, or shows the bid placed 47 seconds after sale close because of clock drift — **the user loses the parcel and blames us.** Our brand takes the hit, our county client takes the call, our compliance team opens a ticket. One incident is survivable; a pattern kills the partnership.

That means three things have to be bulletproof before we go live:

1. **Synchronous bid-placement confirmation.** AcreOS calls our `POST /proxy-bids`, blocks for our 200ms response, only writes "placed" after we ack. Today `placeAutoBid` (`dealHunter.ts:437`) writes a row optimistically with no platform call. That's an integration contract violation waiting to happen.
2. **Clock sync to NTP.** Auction sites run on server time, not client time. AcreOS users on stale timezone configs will think a sale is open when it's closed. Probably already fine; needs verification.
3. **Bid-increment validation before submission.** AcreOS quotes the user a legal increment, not whatever number the user typed. Reject unbidable amounts at the worksheet, not at our gate.

A second-tier deal-killer: **deposit-pre-flight.** If AcreOS shows a user "you're cleared to bid up to $40K on Riverside" and the user only deposited $2,500, we lock them out at registration and the user blames AcreOS for the false greenlight. Pre-flight check: AcreOS reads our `GET /bidder/{accountId}/clearance` endpoint before showing a max-bid number. We have that endpoint; nobody's asked us to expose it for partners. We'd expose it for AcreOS.

A third-tier deal-killer: **post-sale-deed routing.** When B4A pushes a recorded deed packet to AcreOS via the partner-document API I described in §3, the routing has to land in the right org's document tree. Wrong-org document delivery is a privacy incident — a tax deed contains owner names, addresses, sale prices. One mis-routed deed = one breach notification. The `partnerAccountMapping` table that links AcreOS-orgId to platform-accountId has to be tight. Not hard, but has to be right.

---

If I had to give the team a 90-day plan from where I sit:

- **Day 1-30:** Inbound partner-webhook consumer with HMAC verification + per-partner secret vault. Schema migration adding `platformId`, `platformAuctionId`, `platformParcelId`, `auctionDirection`, `winningBid`, `winningRate`, `winningBidder`, `bidIncrementRule`, `depositRule`. Replace `generateMockAuctionData` with a calendar-feed consumer pointed at our keyed API (we'd give them sandbox credentials in week one).
- **Day 31-60:** Platform-credential vault + B4A OAuth-link flow. Wire `placeAutoBid` to actually call our `POST /proxy-bids` endpoint with synchronous confirmation. Bid-increment validation in the worksheet UI. Surface deposit-rules and `registrationDeadline` as countdown reminders.
- **Day 61-90:** Partner-document ingestion endpoint for post-sale deed packets. Surplus-funds tracker tied to our `surplus.declared` webhook. Co-marketing soft-launch: joint blog post, joint webinar booked for Q4. Add RealAuction as the second platform adapter using the same primitives.

That's a single engineer on AcreOS's side, our integrations-engineer on ours, ~30 hours of partnerships-counsel time per side for the agreement. Real product by August. We'd announce at our county-clerks-association conference in October and have AcreOS as a launch case study.

A final note on positioning. Rina called Florida tax-deed investors a sub-sub-vertical of 5,000 active operators. From my BD seat that's the wedge: **AcreOS becomes the bidder's neutral abstraction layer over auction platforms**, starting with B4A as the most-integrated partner, and sells the integrated bidding-experience as the differentiator. That's a defensible product. A CRM that sometimes points at our platform isn't.

— Beaufort
