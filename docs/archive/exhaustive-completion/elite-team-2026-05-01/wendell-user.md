# Wendell Hart — AcreOS user review

I run a small land shop out of Texas. Twelve years buying tax-delinquent and rural junk parcels for $5K to $80K, flipping most, holding maybe a third on seller-financed paper. I have one VA in the Philippines and a CPA who hates me twice a year. I spend Tuesday and Thursday mornings in a spreadsheet I should've burned in 2019. So when somebody says they want me to look at their AI platform, I look at the screws first. The drawers second. The marketing copy never.

Here's what I think after a half day in AcreOS.

---

## 1. Thirty-second verdict

Would I sign up today? **Yes, on the $20 Starter, on a 14-day trial, before I commit to anything.** I would not move my live notes over until I've watched it process one full payment cycle and produced one CPA-acceptable export.

At **$49/mo Pro** I'd switch *if* the note ledger handles partial payments, escrow holdbacks, and produces a clean 1098-INT — and I see it once, end to end, without bouncing me to support. I don't see all of that yet.

At **$79/mo Scale** — no. Not for a one-man shop with a VA. The seat math doesn't work for me unless I'm running 200+ deals/year, which I'm not.

What stops me from going all-in today: I can't tell from the surface whether the note ledger is doing real amortization or whether it's a pretty calculator on top of a `notes` table. That's the whole game for me. If that breaks once, I'm back in Excel by Friday.

---

## 2. Daily-use walkthrough — my imagined first day

**8:02 AM.** I land on `/today`. Greeting says "Good morning." Fine. I see Pulse, AI actions, expiring offers, stale leads, a goal bar. It's pretty. It's also **a lot** for a guy who just wants to know "who do I call before lunch."

There's something called "new user mode" that hides the dense stuff if I have <3 leads. Smart — I appreciate that someone thought about the empty state. But I'm coming in with 340 leads imported, so I'm seeing the firehose immediately. I'd want a setting that says **"give me three things to do today"** and nothing else. I don't run on a Pulse score. I run on "did I call back the 78-year-old in Brewster County."

**8:15 AM.** I click `/pipeline` to see my list. I find `leads.tsx` with hot/warm/cold/dead icons. Useful. The phone number gets formatted. I drop in a CSV from REI Pro — does it map fields right? I don't know yet. I see an Import button. That import-flow dialog is where I'll either trust this thing or close the tab. **I want a column-mapper that shows me the first five rows of my CSV and lets me say "this is APN, this is owner phone."** If I have to clean my CSV first, I'm gone.

**9:00 AM.** I open `/parcels/:id` on a property I'm working. The composed view is good — overview, valuation, due-diligence checklist, neighbors. The DD checklist (title clear, no liens, no environmental, access verified, taxes current) is the right list. That's the list I keep on a Post-it. I'm impressed.

What's missing on the parcel view: **a one-click "send blind offer letter"** that pulls owner address from the record, drops it into a Pebble-equivalent, and tracks the response. I see `direct-mail-campaigns.tsx` exists separately. That's a bounce. On REI Pro I right-click the lead, pick a sequence, done.

**10:30 AM.** I go to `/money`. This is the room I live in. I see tabs: Notes, Portfolio, Optimizer, Forecast, Capital. **Five tabs is at least one too many.** Optimizer and Capital sound like SaaS-pitch words. I want Notes, Cash flow, and Tax pack. That's it. The fact that the labels in `money.tsx` got swapped against their content (the "Finance" tab actually mounts Portfolio) tells me the information architecture isn't settled. I noticed that immediately because I paged through them looking for amortization.

I add a new note in `/finance`. Form looks right — borrower, property, principal, rate, term, payment day. The loan-health badge ("3 days late," "Current") is exactly what I want at a glance. Stripe Connect status indicator at the top is a nice touch — I can tell immediately if my borrowers can pay through the system or if I'm still chasing checks.

**11:00 AM.** I check `/inbox`. Unified email + SMS, drafted replies. If the drafts are decent, this saves me two hours a week alone. If they're generic "Thanks for reaching out!" garbage, I turn the feature off in 20 minutes. **The quality of one drafted reply will decide whether I keep paying.**

**1:00 PM.** Field visit. I open the app on my phone and head to `/field-scout`. Photo capture, GPS, offline sync banner, inspection checklist. **Somebody who built this has actually been to a tax sale.** The offline-sync piece especially — half my drive-bys are in places where AT&T pretends it has coverage and doesn't. That's the first feature in this whole thing that surprised me in a good way.

**4:00 PM.** I try to generate a payoff letter for a borrower asking to settle early. I find `documents.tsx` and `sign-document.tsx`. The HMAC-link signing flow looks legit — no login, audit row with IP, signer order, expiry. I'd pay for that alone if it works. **The test is: can my 71-year-old buyer in Pecos County actually sign on her flip phone?** Don't know yet. That's where DocuSign earns its keep — every grandmother on earth has signed a DocuSign once.

**5:30 PM.** I open `/pax`. Five tabs: Insights, Chat, Activity, Agents, Automation. **Too many tabs again.** Insights is useful — stale leads, expiring offers, motivated callers. Chat is whatever. Agents and Automation start to feel like demoware to me. I don't need an "agent command center." I need Pax to tell me "Mrs. Henderson hasn't replied in 11 days, here's a draft follow-up." That's the whole product.

---

## 3. Per-surface friction

**`/today`** — Too dense for the daily landing. Pulse score is a number I will never look at twice. Pax observation cards, Pax suggestions, Pax stale leads, Pax expiring offers — **four Pax sections is three too many**. Collapse them into one "Pax thinks you should…" list with three items. Goals bar feels like a startup-team thing, not a one-person operator thing.

**`/pipeline` + `/leads`** — The hot/warm/cold/dead icons are good. The form validation is solid (real phone format, real email regex). What I can't tell from the page is whether **bulk actions** exist — select 40 leads, drop them in a sequence, that's a daily operation for me. If it's not there I'd walk in two days.

**`/properties`** — The lazy-loaded composed view is fine but I'd want **a map view as the default**, not a table. I think in counties, not in spreadsheets.

**`/deals`** — Didn't read in depth, but if it's a kanban board I want to drag a card from "offer sent" to "accepted" without a modal. Modals on every state change kill momentum.

**`/finance` (the Notes tab inside `/money`)** — One thousand eight hundred lines of file. That alarms me a little — that file is doing too much, which means breakage will cascade. The note table's loan-health logic is correct. The QuickBooks sync button is right there next to Export — I'd use both. **Where I worry: do partial payments show up correctly? What about an extra principal payment from a borrower trying to pay off early? What about an escrow deposit toward future taxes?** None of that is visible from skimming the page.

**`/portfolio`** — Aging buckets (current / 30 / 60 / 90+) is the right shape. Delinquency rate, at-risk amount, monthly cash flow chart — all the things my CPA asks me about. The compliance-rules section (state/county) is overbuilt for me; I operate in 4 Texas counties.

**`/money`** — Five tabs, with the "Finance" tab labeled as Portfolio and the "Portfolio" tab labeled as Optimizer, per the comment in the file itself. **Fix the IA. Three tabs maximum: Notes, Cash flow, Tax pack.** Capital Markets is venture-pitch territory — I don't need it.

**`/pax`** — The greeting banner with a localStorage dismiss key (`pax_greeting_dismissed`) is a nice human touch. The five tabs are too many. Collapse Activity + Agents + Automation into one "Behind the scenes" view that I can ignore until something breaks.

**`/inbox`** — Unified inbox is the right idea. I'd want a "needs reply" filter as the default view. Right now the channel filter and status filter are separate pills — I'd combine them into one default smart view.

**`/parcel-detail`** — Best surface in the app. Genuinely. The DD checklist is exactly what I need. **What's missing: a "drive-by photos" section linked to field-scout, a tax history timeline (years owed → years paid), and a one-click "send blind offer."**

**`/onboarding-v2`** — Three paths (beginner / active / enterprise) is one path too many. **I'm "active." I want to import REI Pro CSV, map fields, see my pipeline, done.** The "Instant Deal Hunt" step that promises to find real opportunities in my target county is either going to be brilliant or it's going to be the moment I walk. Show me three actual parcels with actual owner names from Loving County, TX, with motivation signals I can verify against the appraisal district. If it's stock data, I'm out.

**`/auth-page`** — Didn't audit but the existence of a Clerk proxy + Cloudflare setup tells me the auth layer is at least production-grade.

**`/pricing`** — Honest. Four tiers, transparent feature matrix, 14-day trial on every paid plan. The "BYOK data providers" line at Pro is the right move — I want to bring my own DataTree key and not pay AcreOS markup on lookups. **Concern: "AI requests / day" caps at 1,000 on Pro. I won't hit that, but the cap framing makes me nervous because I don't know what counts as a request.**

---

## 4. The CPA test — partial pass

My CPA needs five things every January. Here's how AcreOS does:

- **P&L by entity** — *Probable pass.* Notes export to CSV exists. QuickBooks sync exists. If the categorization is right out of the box, this works. If I have to reclassify every transaction in QBO, it doesn't.
- **Basis tracking on owned parcels** — *Unclear.* I see depreciation-calculator.tsx exists. I don't see a "basis schedule" view that shows me original purchase + improvements + closing costs - sales. That's table stakes for my CPA.
- **Depreciation schedule** — *Possible pass.* The page exists. Quality unknown.
- **1098-INT for note borrowers** — *Likely fail or hidden.* I searched, I didn't find a 1098-INT generator. For a platform pitching "seller financing," **this is the single most important tax doc of the year.** If I have to compute interest paid by each borrower and hand-fill 1098-INTs in February, this platform doesn't replace QuickBooks for me.
- **K-1-equivalent for syndicates** — *Not applicable to me yet,* but if I bring in a partner on a $200K parcel I'd need it. I'd ask before signing the annual deal.

**Net: this is a partial. The 1098-INT gap is the one I'd email support about before paying for year two.**

---

## 5. Five features that would make this a no-brainer switch

1. **One-click 1098-INT batch generation in January.** Pull every active note, compute interest paid by borrower for the calendar year, generate signed PDFs, mark them mailed. If you ship this I will personally tell every land investor I know.
2. **CSV column-mapper on import** that previews five rows, lets me drag-map fields, and remembers my mapping for next time. REI Pro and Pebble exports are the two CSVs I'll keep importing forever.
3. **Bulk actions in `/leads`** — select N rows, apply: assign to VA, drop into mailer sequence, mark dead, change status, export. Without bulk actions I bounce to Excel.
4. **Default map view on `/properties`** with my owned parcels in green, under-contract in yellow, tax-delinquent leads in red. I think geographically. So does every land investor I've ever met.
5. **Mailer integration that replaces Pebble end-to-end** — variable-data templates, address validation, return-mail tracking, response-rate analytics, **and** the ability to drop mail tomorrow without an account on a third platform. Right now `direct-mail-campaigns.tsx` exists; I haven't audited whether it actually drops mail or just queues it.

---

## 6. Three things that are surprisingly good

1. **The HMAC-link public signing flow.** No login for the signer, audit row with IP and user agent, signer-order enforcement, expiry. That's the right architecture. DocuSign costs me $480/year. If this works for grandmothers on flip phones, it's gone the day I confirm it.
2. **`/field-scout` with offline sync.** I did not expect a web app to handle the "I'm in a pasture with no signal" case. Whoever specced this has been to a tax sale. The inspection checklist + photo gallery + sync banner is exactly the field tool I'd build if I had time.
3. **The persona vocabulary registry (`personaVocabulary.ts`).** I don't normally care about platform internals, but the fact that the app calls things "Properties" for me and would call them "Notes" for a note investor or "Subject properties" for a wholesaler — without me having to set anything — that's thoughtful. It signals the team understands that one platform doesn't fit every land business.

---

## 7. The deal-killer if not fixed

**The note ledger has to be bulletproof.** That means: partial payments post correctly, extra principal reduces principal not future interest unless I say so, late fees apply per the note terms, escrow holdbacks for tax/insurance show as separate buckets, payoff calculation matches my amortization schedule to the penny, and **every payment from every note rolls up to a clean 1098-INT in January**.

If a single one of those breaks once on real money — even a rounding error on one borrower's payoff — I'm back in Excel and Google Sheets the same day. I'll eat the $400/mo on REI Pro + Pebble + DocuSign + QuickBooks before I'll trust a system that miscounted my money once.

That's the whole test. Everything else — the AI, the parcel view, the field tool, the inbox — is gravy. **The notes have to be right.** Show me one full quarter of real notes processed correctly and I'm signing for two years.

— Wendell
