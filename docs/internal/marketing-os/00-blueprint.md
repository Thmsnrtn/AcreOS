# Marketing-OS Blueprint

**Owner:** Soren Mikkelsen — Chief Growth Officer (operating at CMO equivalent)
**Status:** Foundational. Phase 0 → Phase 1 → 5-year Tahoe horizon.
**Date drafted:** 2026-06-05
**Supersedes:** ad-hoc landing-copy edits, prior horizon-audit memos
**Companion docs:** `01-content-engine.md`, `02-voice-linter.md`, `03-analytics.md`, `04-90-day-execution.md`, `05-current-state.md`

---

## 0. Why this exists

AcreOS is a category-creating product wearing category-following clothes. The product mechanic — *find-mail-reply-close-service in one thread* — has no horizontal equivalent. The marketing surface today (landing page + /letters + 10 SEO pages) is honest but tactical: it sells the product, it does not yet *defend a category*. A Series-A CMO walking in on day 1 would write the document you are reading before changing a single comma of copy.

This blueprint is the substrate. Everything downstream — editorial cadence, programmatic SEO, paid acquisition, partnerships, analytics, voice — derives from the five locks declared here.

---

## 1. Category positioning declaration

### 1.1 The canonical category

**Land Operating System.**

That is the noun-phrase. Not "CRM for land," not "land investor software," not "real-estate platform." A *Land Operating System* is to a land investor what a *CRM* is to a sales team and what a *PMS* (Property Management System) is to a long-term rental operator: the single system of record for the entire lifecycle of the asset class.

### 1.2 Why this category — defended

| Adjacent category | What it owns | Why it does not own land investors |
|---|---|---|
| CRM (Salesforce, HubSpot, Pipedrive) | Contact + opportunity pipeline | Stops at the deal; no parcel data, no comps, no mail send, no note servicing |
| PMS (AppFolio, Buildium) | Recurring rental management | Built for tenanted residential; no acquisition surface, no land-specific parcel features |
| ERP (NetSuite, Odoo) | Cross-function financial ledger | Generic; no real-estate domain primitives |
| "REI software" (factual reference only) | Lead lists + skip trace + dialer | Each is a tool, not a system; the operator stitches them together |

The *Land Operating System* slot is empty. AcreOS owns it by being the only product that owns the full five-verb lifecycle: **find → mail → reply → close → service.** Source: `client/src/pages/landing/copy.ts` hero.wedge, verified 2026-06-05.

### 1.3 The chip taxonomy (what we name, what we don't)

The landing page positioning band names verticals at three tiers. The blueprint rule:

- **CTA only the core.** The hero, primary CTA, and pricing surface speak to Land Investors (Land Flippers, Note Investors, Hybrid). Source: `shared/business-types.ts` — three `maturity: "core"` entries.
- **Honestly name the beta four** as beta, not as "shipping today." Fix-and-flip, Residential Wholesaler, Creative Finance, Tax Lien/Deed, Subdivider. (Five total in `shared/business-types.ts` with `maturity: "beta"`.)
- **Disclose the roadmap seven** in a single positioning sentence, no chips, no CTAs. Buy-and-hold, STR, Commercial, Developer, Multifamily, Mobile Home, Agent-Investor.
- **Do not bury, do not amplify.** Roadmap verticals exist for waitlist + research signals, not for acquisition.

### 1.4 The category-defending sentence (memorize)

> AcreOS is the Land Operating System. It finds parcels, sends the mail, drafts the replies, closes the deal, and tracks the note after — in one thread, for one operator.

Every public-facing piece of copy must be defensible against this sentence. If a piece of copy describes something that is not in those five verbs, it does not belong on a customer surface unless explicitly scoped as adjacent (compliance, pricing, trust).

---

## 2. Voice doctrine

### 2.1 The lock

**Mechanics-first, third-person, present tense.** The system is the subject. The operator is named in role, not in pronoun. No founder voice on customer surfaces. The legacy /letters carve-out was resolved on 2026-06-06 by rebranding the surface to `/field-notes` (Option B in `05-current-state.md` §1); the voice doctrine now applies uniformly to every customer surface.

### 2.2 Must-do

1. **System is the subject.** "AcreOS pulls lists." "AcreOS drafts the reply." "Pax monitors overnight."
2. **Five verbs.** Find, mail, reply, close, service. Use them. They map 1:1 to the lifecycle the product owns.
3. **Numbers have provenance.** "90 seconds" is a job-queue SLA — defensible. "10 minutes to first list" is a setup-time target — defensible. Numbers without a code or data source do not ship.
4. **Land Investors.** Not "real estate professional," not "real estate investor," not "REI." Per `feedback_terminology` v6 lock.
5. **Operator owns judgment, system owns busy work.** Every workflow sentence reinforces this division.

### 2.3 Must-not

1. **No founder voice on customer surfaces.** No "I built this," no "we believe," no first-person plural that implies a small team in a garage.
2. **No founder name on the public surface.** Tom Norton's name does not appear in any landing, learn, letter, ad, email, or social copy.
3. **No competitor names.** Land Geek, GeekPay, LG Pass, Mark Podolsky — zero references. Per `feedback_competitor_refs`.
4. **No persona leakage.** Sophie, Forge, Atlas, Solene, Iris, Soren, Maren, Beatrice, Krieger, Rafe, Andrei, Tess, Iyari, Quinn, Henrik, Lena — never on a customer surface. Pax is the only customer-visible AI persona. Per `project_persona_architecture`.
5. **No flattery hooks.** "You're a serious operator. You know that..." is banned. The product does the work; the prose does not stroke the reader.
6. **No dark patterns.** No countdown timers that aren't real, no "3 spots left," no fake testimonials, no urgency manufactured from nothing.
7. **No investment-return language that triggers FTC scrutiny.** No "make $X per deal," no "average investor sees Y%." Mechanics only.

### 2.4 Examples — paired

| Banned | Doctrine |
|---|---|
| "I built AcreOS because I was tired of stitching together five tools." | "AcreOS replaces the list-pull + comp + mail + reply + close + servicing stack with one thread." |
| "Land investors are some of the most resourceful operators in real estate." | "Land investors run a five-step lifecycle: find, mail, reply, close, service." |
| "Join 1,200 investors who trust AcreOS." | "Pricing is on the page; trial is 14 days, no card." |
| "Make $10K per deal with our proven system." | "AcreOS handles list-pull, comp-run, mail-send, reply-draft, close, and note servicing." |

### 2.5 The /letters carve-out — RESOLVED 2026-06-06

The `/letters` surface was rebranded to `/field-notes` per Option B in `05-current-state.md` §1. Server-side 301 from `/letters[/:slug]` preserves SEO equity. Posts published before the rebrand date render a grandfather banner explaining the older voice. The voice doctrine now applies uniformly to every customer surface — no carve-out remains.

---

## 3. Funnel architecture

### 3.1 The three bands

| Band | What lives here | Who owns it | Voice |
|---|---|---|---|
| **Top of funnel** (awareness) | Programmatic SEO (state × vertical), editorial blog, social posts, /field-notes, YouTube (Phase 2+) | Soren | Mechanics-first, education-led |
| **Middle of funnel** (consideration) | Landing pages, /pricing, /trust, /sub-processors, demo video, comparison pages | Soren + Maren (product) | Mechanics-first, capability-led |
| **Bottom of funnel** (conversion) | /auth, in-product onboarding, lifecycle email, trial nudges | Maren (product) + Soren (copy) | Operator-pragmatic, no-pressure |

### 3.2 What lives where, what does not

- **Content lives in TOFU.** Editorial + programmatic SEO. Never gated, never email-walled.
- **Product surface lives in MOFU.** Landing, pricing, trust, demo. Light persuasion; heavy proof.
- **In-product lives in BOFU.** Onboarding, first-list nudge, Pax preview. Soren owns the welcome email; product owns the rest.
- **Outreach (email, direct mail to operators)** is a hybrid: TOFU when cold, BOFU when warm. Each sequence declares its band on day-of-send.

---

## 4. Phase ladder

The constitution capital ladder governs marketing spend. Each phase has a ceiling derived from sustained MRR.

### 4.1 Phase 0 — now ($0–$200 MRR sustained)

**Ceiling:** $0/mo external marketing spend. Owned-channel only.
**Channels:** Landing page, /learn programmatic SEO (current 10 pages → 50), /field-notes (rebranded from /letters on 2026-06-06), X (organic), LinkedIn (founder org page — content authored by Soren, never first-person from Tom on customer surfaces).
**Goal:** Lock the substrate. Voice doctrine published. Category positioning declared. First 50 programmatic pages live. First 4 editorial pieces published. Analytics substrate wired.
**Metric:** Time-to-first-list ≤ 10 minutes for new signups (source: `client/src/pages/landing/copy.ts` hero.ctaSub). Trial → paid conversion rate baseline established.

### 4.2 Phase 1 — $200 MRR sustained 30 days

**Ceiling:** $200/mo external spend (per constitution capital ladder).
**Adds:** Lifecycle email infrastructure live, first paid SEO tool subscription (Ahrefs Lite or equivalent — $99/mo), one targeted LinkedIn ad experiment ($50/mo, capped). Owned-audience signup mechanic (newsletter) wired.
**Goal:** Programmatic SEO at 250 pages. Editorial cadence at 1 post/week locked. First outreach sequence shipping.
**Metric:** ≥3 paid signups attributable to organic search.

### 4.3 Phase 2 — $1k MRR sustained 30 days

**Ceiling:** $1,000/mo external spend.
**Adds:** YouTube channel launches (1 video/week — operator-walkthrough format, no founder face required), first partnership pilot (parcel data vendor co-marketing), first paid Google Search test ($300/mo cap). Voice linter shipped + CI-gated.
**Goal:** Programmatic SEO at 1,500 pages. Three editorial pieces/week. Owned audience ≥1,000 subscribers. First cohort analysis.
**Metric:** ≥30% of new signups from non-direct sources.

### 4.4 Phase 3+ — $5k MRR sustained 30 days

**Ceiling:** $5,000/mo external spend; revisit at $25k MRR.
**Adds:** Paid acquisition matrix (Search + Meta + LinkedIn at $1.5k each), YouTube acceleration, conference/event presence (one land-investing conference sponsorship per year), brand partnerships, podcast (interview format).
**Goal:** Programmatic SEO at the 35K-page horizon. Editorial daily. Owned audience ≥10,000.
**Metric:** CAC payback ≤6 months across blended channels.

---

## 5. Acquisition channel matrix

For each channel: **today's state → 1-year target → 5-year Tahoe target.**

### 5.1 SEO — programmatic

- **Today:** 10 pages live (`/learn/<vertical>/<state>` via Vite glob registry; source: `client/src/pages/learn/registry.ts`). 2 verticals × 5 states.
- **1 year:** 1,500 pages. Vertical × state × jobs-to-be-done axes activated. Migration off Vite glob onto a static-generation stack — see `01-content-engine.md` §4.
- **5-year Tahoe:** 35,000-page horizon. Vertical × state × county × JTBD × seasonal-update axes. Each page is grounded in real parcel/market data with a freshness rule.

### 5.2 SEO — editorial

- **Today:** 0 pieces. /field-notes archive (rebranded from /letters on 2026-06-06) holds legacy founder-voice posts grandfathered with a banner; new pieces ship doctrine-aligned but are not yet editorial in the blueprint sense.
- **1 year:** 52 editorial pieces (1/week). Mechanics-first, third-person, evergreen. Cross-linked to programmatic.
- **5-year Tahoe:** 1,000+ piece library; 1 daily editorial post; category-shaping quarterly pieces drive press/inbound conversations.

### 5.3 Email outreach (cold + warm)

- **Today:** 0 sequences live.
- **1 year:** 4 sequences (cold operator outreach, warm trial → paid, lifecycle for inactive trials, win-back). Deliverability baseline established (source: `docs/internal/email-deliverability-baseline.md`).
- **5-year Tahoe:** 20+ sequences segmented by vertical + lifecycle stage. Reply-rate benchmarks tracked weekly.

### 5.4 Social — LinkedIn (organization page)

- **Today:** Not active.
- **1 year:** 3 posts/week from AcreOS org page. Mechanics-first. No founder face required.
- **5-year Tahoe:** Category-defining presence. Daily posting cadence. Founder *can* post personally to their *own* profile referencing AcreOS — that is not a customer surface — but the AcreOS org page voice stays mechanics-first.

### 5.5 Social — X

- **Today:** Founder personal account used for AcreOS announcements (not a customer surface, voice doctrine does not apply).
- **1 year:** Dedicated AcreOS X account; 1 post/day from the org account in doctrine voice. Founder personal account links to but does not author AcreOS marketing copy.
- **5-year Tahoe:** Established voice. Threads, screencasts of Pax shipping mechanics, county-data drops. Stop talking about the company; show the work.

### 5.6 Direct mail (to operators, not to sellers)

- **Today:** Not active.
- **1 year:** Pilot send to 500 land investors sourced from public records + investor associations. Mechanics-first postcard.
- **5-year Tahoe:** Quarterly send to 10K+ qualified operators. Direct-mail-as-marketing-channel is meta-credible because the product itself sends direct mail.

### 5.7 Partnerships

- **Today:** Not active.
- **1 year:** 2 co-marketing partnerships (parcel data vendor + skip-trace provider). Joint webinar or case-study format.
- **5-year Tahoe:** Integration marketplace + revenue-share partners; embedded mentions across the data-vendor ecosystem.

### 5.8 Community

- **Today:** Not active. Per Tom's call, Reddit / BiggerPockets / REtipster engagement is **deferred** indefinitely (signal-to-noise too low for founder time at Phase 0).
- **1 year:** Owned community on Discord OR Circle (decision pending Phase 2). Operator-only, gated by trial signup. Mechanics-first culture.
- **5-year Tahoe:** Owned audience large enough that the community drives 20%+ of new signup intent.

### 5.9 YouTube

- **Today:** Not active.
- **1 year:** Deferred to Phase 2+.
- **5-year Tahoe:** Daily uploads of operator-walkthrough content. Pax-in-action screencasts. Category-defining channel.

### 5.10 Paid acquisition

- **Today:** $0.
- **1 year:** Phase 1 cap ($200/mo). Single LinkedIn ad experiment.
- **5-year Tahoe:** Phase 3+ matrix; CAC-payback governed.

---

## 6. The five locks (summary)

1. **Category:** Land Operating System.
2. **Voice:** Mechanics-first, third-person, present tense. No founder voice on customer surfaces.
3. **Verticals:** CTA only the three core. Beta named honestly. Roadmap disclosed but not amplified.
4. **Funnel bands:** TOFU = content. MOFU = product surface. BOFU = in-product + lifecycle.
5. **Capital ladder:** Phase 0 → 1 → 2 → 3 spend caps enforced.

Everything downstream — editorial, programmatic, analytics, paid — derives from these five.

---

## 7. What this blueprint does NOT do

- Does not ship the voice linter (see `02-voice-linter.md` — spec only).
- Does not generate any of the 35K programmatic pages (see `01-content-engine.md` — architecture only).
- Does not wire any analytics events (see `03-analytics.md` — schema only).
- Does not commit any code (planning round per Tom's directive).
- The `/letters` resolution is no longer open — rebranded to `/field-notes` on 2026-06-06 per `05-current-state.md` §1 Option B.
- Does not rename Pax or any other persona (locked per `project_persona_architecture`).
