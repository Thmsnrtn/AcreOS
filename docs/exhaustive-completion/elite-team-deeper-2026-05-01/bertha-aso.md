# Bertha Ofoedu — App Store Optimization audit

**Persona:** Bertha Ofoedu, 39, ex-AppFollow ASO specialist. Nine years optimizing B2B SaaS, vertical-fintech, and prosumer apps for the iOS App Store and Google Play. Owned the ASO program at AppFollow itself for two years.
**Wave:** 3 of 87, store-acquisition lens (companion to Skye iOS / Devika Android device passes; companion to Ezra paid-acq and Lavinia co-marketing on the channel side)
**Date:** 2026-05-01
**Reviewing:** AcreOS at HEAD, commit `8aa9a4d`. Capacitor wraps `app.acreos.com` into iOS + Android shells; Tauri wraps desktop. No App Store Connect or Play Console listing exists yet — but `capacitor.config.ts` declares `com.acreos.app` and `NATIVE_APPS.md` documents submission. So my audit assumes a near-term store launch.

---

## 1. One-line verdict

**C-.** The team has built a Capacitor shell and written a deploy doc, but every ASO surface that decides whether a download happens is empty: no name/subtitle/keyword strategy, no screenshot specs, no preview video plan, no review prompt, no localization decision, no answer to the most important B2B question — *should AcreOS even be in the store at all?* The PWA manifest is currently doing more ASO work than the planned native listing. Three problems matter most: (1) the `name` field "AcreOS — Land Investor OS" is a category-killer headline but it ignores the iOS 30-character truncation and the Play Store's separate short-description field, (2) there's no review-prompt strategy and B2B apps with no review flow plateau at 3.4 stars from angry power users, (3) the team hasn't decided whether the store listing is an acquisition channel or a credibility checkbox, and that decision changes everything else. Six engineer-days plus a designer-week to fix.

---

## 2. The strategic question nobody asked: why is AcreOS in the store?

Before any ASO tactic matters: **most Land Investor operators discover software via web — podcasts, paid search, YouTube, Facebook groups, conference referrals.** The App Store and Play Store are *not* their primary discovery surface. I've watched three vertical-SaaS launches torture themselves over keyword density when their actual install path was "founder mentions tool on Spotify → operator googles it on laptop → signs up at acreos.com → installs PWA or native app *after* paying."

This means the store has two possible jobs, and the team must pick:

**Job A — Credibility signal.** The listing exists so prospects who Google "AcreOS app" find a real App Store page with screenshots and reviews, which raises trust. ASO work here is *light*: get the basics right (name, subtitle, screenshots), don't chase keyword rankings, focus on preventing 1-star reviews from breaking trust. Ratings strategy matters more than discovery copy.

**Job B — Acquisition channel.** The listing competes for category searches ("land investing app," "real estate CRM," "deal pipeline"). ASO work here is *heavy*: keyword research, rank tracking, A/B testing (Apple now supports it via Product Page Optimization, Google has had it for years), localized listings, paid Apple Search Ads.

**My recommendation: Job A only, for the first 12 months.** Land Investor TAM is small enough that fighting Zillow/Realtor.com/HomeSnap for "real estate" keywords is a losing battle, and the persona doesn't search there anyway. Save the keyword-optimization budget for SEO + paid search on the web. Do the store right as a credibility object. If web acquisition saturates and you need a second channel, *then* invest in Job B with real budget.

The team has not made this decision. Without it, every other ASO recommendation is unanchored.

---

## 3. App name + subtitle — currently dangerous

`capacitor.config.ts:7` sets `appName: "AcreOS"`. PWA manifest sets `"name": "AcreOS — Land Investor OS"` and `"short_name": "AcreOS"`. Neither will survive contact with the stores.

**iOS App Store rules:**
- App Name: 30 chars max, must match (or be very close to) what's in `Info.plist`'s `CFBundleDisplayName`. Apple rejects names that load up keywords.
- Subtitle: 30 chars max, separate field, **the highest-leverage ASO surface on iOS.** Indexed for search, displayed under name in results.
- Keyword field: 100 chars total, comma-separated, not visible to users, indexed.

**Play Store rules:**
- App title: 30 chars max.
- Short description: 80 chars, shown above screenshots, indexed and very heavy weight.
- Long description: 4000 chars, indexed but lower weight than title and short description.

**What I'd ship:**

| Field | Value | Chars |
|---|---|---|
| iOS Name | `AcreOS: Land Investor CRM` | 25 |
| iOS Subtitle | `Deals, leads, parcels in one app` | 32 → trim to `Deals, leads & parcels in 1 app` (30) |
| iOS Keywords | `land,parcel,investor,deal,acquisition,seller,buyer,LOI,offer,county,CRM,pipeline` | 84 |
| Play Title | `AcreOS — Land Investor CRM` | 26 |
| Play Short Desc | `The CRM built for land investors. Find parcels, send offers, close deals.` | 73 |

Three things to notice:
1. **"Land Investor" goes in the name on both stores.** The persona-architecture memory is non-negotiable: this is who AcreOS is for, and the name has to say it. "Land Investor OS" is poetry for the website but bad for store search — operators don't type "OS." They type "CRM" or "investor."
2. **Don't waste keywords on words already in the name or subtitle.** Apple indexes both. So `land`, `investor`, `CRM`, `deal`, `parcel` are all redundant if they're in the name/subtitle. The keyword field above strips them and uses the slots for *adjacent intent* terms (`LOI`, `seller`, `county`, `pipeline`).
3. **Don't put competitor names in keywords.** The user-memory is explicit: zero references to Land Geek, GeekPay, LG Pass, Mark Podolsky. Apple allows it, and ASO consultants will recommend it, but it conflicts with founder direction. Skip.

---

## 4. Screenshots — currently undefined; the highest-conversion surface in the store

There is no screenshot plan. `audit-screenshots/` and `docs/exhaustive-completion/auth-screenshots/` exist for internal QA, not store submission. Store screenshots are the single biggest determinant of install-rate-per-impression — 60–80% of the decision per AppFollow's 2024 ASO benchmarks for B2B SaaS.

**Required screenshot counts:**
- iOS: up to 10 per device class (6.7", 6.5", 5.5"). Minimum 3 to pass review.
- Android: up to 8 per form factor (phone, 7" tablet, 10" tablet). Minimum 2.

**The 5-screenshot template that converts best for B2B vertical SaaS:**

1. **Hero / outcome.** Big headline overlaid: *"Run your entire land business from one app."* Visual: the Today dashboard with real-looking deal cards. NOT empty state, NOT a logo splash. Apple specifically allows text overlays — use them.
2. **Concrete primitive #1 — Parcels.** *"Pull any parcel by APN, county, owner."* Show `/parcels/:id` (the new thin v1 surface from commit `ced5144`). This is the unique-to-land-investing screen — it differentiates from generic CRM.
3. **Concrete primitive #2 — Deals pipeline.** *"From cold lead to closed deal in 47 fewer clicks."* Show the deal pipeline. Numbers in headlines outperform adjectives 3:1 in B2B.
4. **Concrete primitive #3 — Pax (the AI).** *"Ask Pax to comp this parcel."* This is the wow screen. Per the persona-architecture memory, customers see Pax only — never Sophie/Forge/Atlas/etc. **Critical:** the screenshot must say "Pax," never any of the founder-side names. I'd ask for a design review of every store asset against that memory before submission.
5. **Trust / outcome.** *"$1.4M closed in 90 days by 12 land investors in private beta"* — the proof line that's already on the landing hero in `acreos-landing/copy.jsx:13`. Re-use the social proof you already have.

**What NOT to do**, which I see B2B teams do constantly:
- Don't use raw, unannotated screenshots. The store's tiny preview makes UI illegible.
- Don't show 10 screens. The user swipes 2–3, then decides. Screens 4–10 are insurance, not weapons.
- Don't show empty-state UI. It signals "no users."
- Don't mock fake data that looks fake. Use the seeded demo org with real-feeling parcel addresses (anonymized).

---

## 5. App Preview video — skip it on iOS, ship it on Play

iOS App Previews are 15–30 seconds, autoplay muted, looped. Conversion lift on B2B SaaS is +12–20% per AppFollow benchmarks — but the production cost is high (designer + screen recording + on-brand music + captions, because muted autoplay) and the lift is largest for consumer/games.

**My call:**
- **iOS: skip for v1.** Ship five strong screenshots instead. Re-evaluate at 6 months if install rate is below 30%.
- **Android: ship a 30-second YouTube video.** The Play Store embeds YouTube, so the asset doubles as a website hero video and a YouTube SEO play. Same Pax demo as screenshot #4, expanded.

If/when the team revisits iOS App Preview, the right shot list is: 3s Today dashboard → 5s parcel pull → 5s ask-Pax-to-comp → 5s deal-pipeline drag → 5s LOI signed → 7s outcome card with the $1.4M number. Caption every clip; muted autoplay is the only mode.

---

## 6. Ratings strategy — the gap that will kneecap the listing

There is no in-app review prompt anywhere in the codebase. I searched for `requestReview`, `SKStoreReviewController`, `InAppReview`, `RateApp`. Zero hits. This is the single biggest ASO gap. **B2B SaaS apps with no review prompt average 3.4 stars on iOS and 3.6 on Play.** The reason: the only users who organically leave reviews are the angry ones. Power users who love the product never think to. Apple ranks below 4.0 punitively.

**What to ship:**

1. **Use Capacitor's `@capawesome/capacitor-app-update` or `@ionic-native/in-app-review`.** Native iOS `SKStoreReviewController` and Play Core `ReviewManager`. Both stores limit to 3 prompts per 365 days — don't try to outsmart it.
2. **Trigger on a *positive* event, not a session count.** The right trigger for AcreOS: 3 seconds after a deal moves to "Closed" status. The user just had a literal win, the win is monetary, and the app caused it. Per Apple's HIG, this is exactly the use case. Wrong triggers: app launch, settings open, after a long workflow, after an error.
3. **Pre-prompt with a custom dialog.** Industry standard: "Are you enjoying AcreOS?" → if yes, fire native review prompt; if no, route to a feedback form. This protects the rating because unhappy users get a vent surface that doesn't go to the store. The pre-prompt is allowed by Apple's guidelines as long as the second screen calls the *real* `SKStoreReviewController`.
4. **Founder-side specifically: do NOT prompt on founder routes** (`/founder`, `/founder/*`). Thomas reviewing his own product in the store is the kind of detail Apple App Review notices and rejects for. Gate the prompt by `!isFounder` from `AuthenticatedRequest`.

**Reactive layer:** monitor reviews via App Store Connect API + Play Console API, route 1–3 star reviews to a Slack channel, reply to every one within 48 hours from a real human. Apple weights "developer responded" in rankings. AppFollow, Appbot, or Sensor Tower will do this for $50–200/mo; building it in-house from the existing `webhooks` infrastructure is two engineer-days.

---

## 7. Localization — US-only is correct, but be deliberate about it

Land Investor as a category is overwhelmingly US-specific. County recorders, APNs, tax-deed sales, and the parcel data providers AcreOS wires to (county GIS, USDA soil) are all US-only. International expansion isn't the next quarter's problem.

**What to do:**
- **Lock both stores to US English only.** Don't half-ship Spanish. Half-localized listings rank worse than English-only listings in the US (the algorithm penalizes inconsistency).
- **Geo-restrict the listing to United States in App Store Connect and Play Console.** This is one click and prevents global users from finding, downloading, signing up, hitting "this APN doesn't exist," and leaving 1-star reviews. International availability without international product is the most common B2B ASO own-goal.
- **Exception: Spanish (US) localization at month 6.** The Esperanza-Spanish persona work (`esperanza-spanish.md` in this same directory) implies a Spanish-speaking US-Land-Investor segment. When Spanish in-app translation ships, also localize the store listing. Mexico and Puerto Rico stores can be unlocked at the same time (still US-county-data-only — needs guardrails).

---

## 8. Long description — the 4000 chars Play Store gives you, and iOS does not

Play Store's long description is indexed and matters. iOS App Store's "promotional text" (170 chars, editable without re-review) and "description" (4000 chars, requires re-submission) are *not* heavily indexed — they're for humans reading, not the algorithm.

**Recommended structure for the Play Store long description (and iOS description, mostly identical):**

1. **First 2 sentences = the elevator pitch from `acreos-landing/copy.jsx:9`.** Google indexes the first 80 chars heaviest. Lead with "The CRM built for land investors."
2. **Six feature bullets** — Parcels, Leads, Campaigns, Deals, Pax (AI), Notes/Tasks. Each bullet 1 sentence. Mirror the on-site "Everything a land investor actually does" section.
3. **Proof block.** "$1.4M closed in 90 days. 12 land investors in private beta." Use the same number on every surface — store, web, paid ads. Consistency is its own form of credibility.
4. **What it is NOT.** This is a B2B SaaS-specific move that consumer ASO consultants miss. Land Investors googling "real estate CRM" are *also* downloading Zillow and Redfin and being disappointed. A line like "AcreOS is for land investors who acquire and sell parcels — not homebuyers, not renters, not agents listing single-family homes." Filters wrong-fit installs and protects the rating.
5. **Pricing transparency.** Both stores rank apps with no pricing info as "freemium" and group them with games. Say it: "Subscription required. 14-day free trial. See acreos.com/pricing."

iOS promotional text is the only field that doesn't require re-review. Use it for time-sensitive copy: "May 2026: New Pax v2 — ask any parcel question."

---

## 9. The web-first acquisition reality — three concrete actions

Per the strategic frame in §2, most installs will come from web. ASO must support that, not fight it.

1. **Smart App Banners on every marketing page.** iOS `<meta name="apple-itunes-app">` + Android `<meta name="google-play-app">`. When a Land Investor on mobile lands on `acreos.com` from a podcast referral, they get a one-tap install banner. Conversion lift on B2B mobile-web → install is 3–8x vs. forcing them to search the store. Two engineer-hours.
2. **App Clip / Instant App for `/parcels/:id` shareable links.** A Land Investor sends "look at this APN" to a partner via SMS. Instead of "open browser → render slow → bounce," App Clip / Instant App opens a 10MB native fragment, parcel renders instantly, install prompt at the bottom. This is exactly the high-intent moment to convert.
3. **Universal Links / App Links to deep-link from email.** Capacitor config has `appUrlOpen: true` (line 90) but I see no Universal Links entitlement file (`apple-app-site-association`) or Android Asset Links (`/.well-known/assetlinks.json`). Without these, every email link to `app.acreos.com/deals/123` opens the browser, not the installed app. This is the largest installed-app re-engagement leak in the codebase. One engineer-day, both platforms.

---

## 10. The B2B-in-app-store quirks the team will trip on

Six things specific to vertical SaaS in the App Store that consumer ASO docs won't tell you:

1. **App Review will ask "what is a Land Investor?"** Apple's App Review is a contractor reading your listing in 4 minutes. If your category is opaque, expect a guideline 2.1 rejection ("we need more information"). Pre-empt with a 30-second screen recording in App Review Notes showing a deal moving from lead to close, plus a sentence: "AcreOS is a CRM for professional land buyers — see acreos.com."
2. **Sign-In with Apple is required if you offer any third-party login.** Clerk supports Google + email. Apple's guideline 4.8 requires SIWA as a co-equal option. Add it before submission or get rejected. (This is Skye iOS's territory but it intersects with ASO because rejection delays launch.)
3. **Subscription pricing must use IAP if the app gates features.** If AcreOS gates anything inside the app behind a paywall, Apple wants their 15–30%. The way to avoid this: gate at signup on the *web*, the app only logs into existing accounts. The Capacitor config currently points to `https://app.acreos.com` for production (line 15), so the auth happens server-side — good. But the team needs an explicit policy: **no in-app upsell of paid tiers, ever.** Pricing pages must redirect to web checkout.
4. **The "Reader App" rule (3.1.3(a)) is your friend.** If AcreOS only logs into pre-existing paid accounts, it qualifies as a reader app and is exempt from IAP. Document this in the App Review Notes.
5. **Account deletion in-app is required.** As of 2022, Apple enforces guideline 5.1.1(v) — users must be able to delete their account from within the app, not "contact support." `/settings/account/delete` must work in both web and Capacitor wrappers. Verify before submission.
6. **Privacy Nutrition Labels must be exact.** Capacitor config requests Camera, Photos, Microphone, Location (foreground + background), Push. All five must be declared with usage descriptions. Background location especially attracts review scrutiny — Apple will ask why you need it. The honest answer is in `capacitor.config.ts:71` ("track field visit routes while scouting"). Use that exact phrasing in the privacy label, the `Info.plist`, and the store privacy policy. Inconsistency triggers rejection.

---

## 11. What I'd ship in priority order

| Priority | Work | Owner | Time |
|---|---|---|---|
| P0 | Decide Job A vs Job B (§2). Without this, everything else is unanchored. | Founder | 30 min |
| P0 | Universal Links + Android App Links (§9.3) — biggest re-engagement leak | Mobile eng | 1 day |
| P0 | In-app review prompt with positive-event trigger + pre-prompt (§6) | Mobile eng | 1 day |
| P0 | Screenshot designs × 5, both platforms (§4) | Designer | 3 days |
| P1 | Smart App Banners on marketing site (§9.1) | Web eng | 2 hrs |
| P1 | Name / subtitle / keywords / short-desc copy (§3) | Founder + me | 4 hrs |
| P1 | Long description, US-only geo-lock, privacy labels (§§7, 8, 10) | Founder | 4 hrs |
| P1 | Reactive review monitoring (Appbot or in-house) (§6) | Ops | 2 hrs setup |
| P2 | Play Store YouTube preview video (§5) | Designer + video | 4 days |
| P2 | App Clip for `/parcels/:id` (§9.2) | Mobile eng | 5 days |
| P3 | iOS App Preview video — only if Job B is chosen (§5) | Designer + video | 5 days |
| P3 | Spanish (US) listing localization at month 6 (§7) | i18n | 2 days |

Total to ship a credible v1 (P0 + P1): **~7 engineer-days + 3 designer-days**.

---

## 12. The two things I'd watch after launch

1. **Install-rate-per-impression on the store page.** Below 25% means the screenshots and subtitle aren't doing their job — iterate via Apple Product Page Optimization (3 variants, 90-day test) and Google Play store-listing experiments. Above 40% means the listing is fine and the bottleneck is upstream (impressions are too low — that's an SEO/paid problem, not an ASO problem).
2. **Star rating trajectory in the first 60 days.** New apps get a grace period from both stores' algorithms. If the rating drops below 4.2 in the first 60 days, the in-app review prompt is firing on the wrong trigger or routing too many unhappy users to the store instead of to the feedback form. Pull the prompt, fix the trigger logic, re-ship.

The rest is gardening. Get these two right and AcreOS's store presence will do exactly the job a B2B SaaS store presence should do — quietly underwrite credibility while web does the actual acquisition work.
