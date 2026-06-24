# Ignition Checklist — the one-time founder seed

**Purpose:** the irreducible ~1-2hr, one-time founder actions that light the autonomous acquisition engine. The machine prepares everything around these; these specific acts need a credential or human identity the machine can't forge. **Not recurring — fire once.**

## What only you can do (tonight)

> NOTE: you are launching the PLATFORM, not running a personal land business. The
> engine self-targets which counties to write about from real demand (which
> counties visitors actually parcel-check) — so it needs NOTHING from you on
> geography. Items 2 & 3 below (domain ownership) are the only true requirements.

### 1. Target markets — OPTIONAL accelerant, not required
The engine works with zero input: it writes evergreen land content and then
follows real parcel-check demand to the counties that matter. If (and only if)
you want to bias the first weeks toward specific markets, POST a county list to
`/api/founder/autopilot/growth/seed-counties` (`ST/County` per line). Skip it and
nothing breaks — demand-ranking takes over as traffic arrives.

### 2. INDEXNOW_KEY — set the Fly secret *(2 min; lights up Bing/Yandex pinging)*
Generate a throwaway public key and set it (it's public by design — served at `/indexnow-key.txt`, not a secret):
```
openssl rand -hex 16            # copy the output
fly secrets set INDEXNOW_KEY=<that-value> -a acreos
```
Once set, every autopilot publish + new `/p/` page pings Bing/Yandex for near-immediate crawl. (Already built + shipped-ready.)

### 3. Search Console verification *(~30 min; the single highest-leverage act)*
- Verify the AcreOS domain in **Google Search Console** + **Bing Webmaster Tools** (DNS TXT record via Cloudflare — you own DNS, the machine can't).
- Submit `/sitemap-notes.xml` and `/sitemap-reports.xml` in both.
- This is what tells crawlers the domain exists and turns on the `firstIndexedAt` signal.

### 4. GSC API access *(for the GSC sense — can be tonight or follow-up)*
Create a Google Cloud service account (or OAuth client), grant it read access to the GSC property, and drop the credential in as a Fly secret (I'll name it when I build the sense module). This lights the impressions/clicks/position/coverage sense that the whole feedback loop + reputation governor read.

## What the machine prepares for your one-tap approval *(coming — I'm building these)*
- **Seed-mint:** a script that pre-mints `/p/` report pages for your buy-box counties (so crawlers arrive at a populated site, not an empty one). You trigger it once; it can re-run as a cron without you.
- **Launch + directory drafts:** the agent drafts a single free-TOOL launch post (Show HN / Product Hunt / a relevant forum) + ~5-15 tool-directory submissions, in your voice, in a one-tap approval queue. You review/edit/post-as-yourself. (These platforms gate on human identity — an agent posting links is the spam pattern, so this stays your click.)

## The honest expectation
After ignition: Bing/Yandex index within hours; Google takes 2-8 weeks to index and **4-9 months** to rank a new domain (rank is conferred by external links — exogenous, can't be self-conferred). The engine works long before it *visibly* works; the daily letter will tell you "demand captured vs work done" honestly the whole way. Budget ~$5-50/mo. The match is the only thing autonomy can't strike — everything after compounds on its own.
