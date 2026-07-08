# Free Distribution Playbook — zero ad spend

*2026-07-03. Companion to roadmap-2026-07.md. Everything the PLATFORM can do
for free visibility is built and listed under "Machine side" (done). This
doc is the founder half: accounts and posts only a human can make, ordered
by expected return per hour of your time.*

## Machine side (DONE — ships with the branch merge)

- **Per-route server heads** for /field-notes, /field-notes/:slug,
  /compare/*, /learn/* — every share link now unfurls with the page's own
  title/description/OG card instead of the homepage's, and crawlers get
  correct titles + canonicals + full Article JSON-LD (including the article
  text) on first pass, no JS required.
- **IndexNow auto-armed.** The key self-mints on first use and serves at
  /indexnow-key.txt — every published field note and parcel report pings
  Bing/Yandex for crawl-within-hours. Zero configuration; visible under
  Controls → Connections → IndexNow (Verify does a live key-file check).
- **Sitemaps**: generated core sitemap (marketing + learn + county + tools)
  plus dynamic sitemap-notes.xml and sitemap-reports.xml, all now declared
  in robots.txt.
- **The content engine** (county guides → /field-notes, autopilot grow
  loop) is built and waiting on the publish switch (Controls →
  Auto-publish). Every published page auto-pings IndexNow.

## Founder side — ordered by ROI per hour

### 1. Search Console + Bing Webmaster (30 min, do first)
Free, and they compound everything else.
- Google Search Console: add acreos.io (DNS TXT verification), submit all
  three sitemaps. This is also where you SEE what queries you rank for.
- Bing Webmaster Tools: "Import from GSC" makes this a 2-minute add.

### 2. Flip Auto-publish on (5 min)
The county-guide engine drafts grounded content daily but publishes nothing
until you flip the switch (it stays gated + witnessed). At zero users, the
compounding asset is indexed pages. Turn it on, watch the first week's
output on /field-notes, tune voice via Your Voice if needed.

### 3. Directory listings (2-3 hours total, one-time, free forever)
High-authority backlinks + real referral traffic from people literally
searching "land investing software":
- AlternativeTo (list as alternative to PropStream, DealMachine)
- Product Hunt (see launch below), BetaList (pre-launch friendly)
- G2 + Capterra (free vendor listings)
- SaaSHub, There's An AI For That (the Pax/autopilot angle qualifies)

### 4. Communities where land investors already are (ongoing, ~2h/week)
The rule: be the most useful person in the thread; the product mention is
your flair/profile, not the post.
- Reddit: r/landinvesting, r/realestateinvesting — answer county-data and
  direct-mail questions; link a relevant /learn page when it genuinely
  answers the question (those pages now unfurl properly).
- Facebook groups: "Land Investors" groups (several 10-50k-member groups);
  same posture.
- BiggerPockets forums: land + direct-mail threads; profile link.
- The free tools are the shareable artifact: /tools/parcel-check and
  /p/ parcel reports are built to be dropped into threads as answers.

### 5. Product Hunt launch (half a day, once — do it AFTER 1-3)
Launch when the free tools + a dozen field notes are live so visitors have
something to touch without signing up. Assets to prepare: tagline ("The
operating system for land investors — with an autopilot"), 4-6 screenshots
(Today, Map + blind offer, the Letter, Step-Away card), a 60-second
walkthrough. First-day comments matter more than upvotes — stay online.

### 6. YouTube/Shorts (optional, highest ceiling, most effort)
Screen-record real workflows: "Pulling every out-of-state owner in X county
in 4 minutes", "What a $0.62 letter looks like when the seller texts back".
Land-investing search on YouTube is underserved; these rank for years.

## What we deliberately do NOT do
- No cold DMs/spam in communities (burns the domain and the name).
- No AI-spun mass content — the guide engine publishes grounded,
  county-data-backed pages only; thin pages get sites demoted.
- No paid ads until you say so (Meta connect flow is prewired for that day).

## Measurement
Attribution already lands in the funnel (utm → signups on the Customers
page; content attribution feeds the autopilot's conversion sense). GSC
(item 1) covers rankings. Check weekly, not daily.
