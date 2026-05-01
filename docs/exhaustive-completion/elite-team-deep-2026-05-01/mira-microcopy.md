# Mira Solberg — Microcopy Audit (Deep Wave 2)
**For:** Thomas Norton, founder, AcreOS
**Date:** 2026-05-01
**Lens:** Microcopy as product personality. Every toast, label, placeholder, empty state, dialog title, error.
**Builds on:** Asher (`elite-team-2026-05-01/asher-ceo.md` — voice strategy, "two voices", letter-tone) · Vesna (`elite-team-2026-05-01/vesna-polish.md` — "three error-toast sentence shapes coexist", P0 persona leaks).

---

## 1. One-line verdict

AcreOS already speaks two-thirds of a great voice — the toast pattern is genuinely Apple-grade and the editorial greetings are real design — but the verb labels, dialog titles, empty-state CTAs, and `error-utils.ts` fallbacks are written by a different person, and Title-Case CTAs in `finance.tsx` are blowing the cover. Ten pages of unification away from "every string sounds like Thomas wrote it."

---

## 2. The voice in 3 rules (extracted from your best examples)

### Rule 1 — Name the thing that didn't change.
This is your single most distinctive pattern. The good ones:

- `client/src/pages/finance.tsx:104` — *"Sync couldn't complete — no records were changed."*
- `client/src/pages/finance.tsx:485` — *"Check your connection and try again — no link was created or charged."*
- `client/src/pages/finance.tsx:1255` — *"Check your connection and try again — no card was charged."*
- `client/src/pages/settings.tsx:454` — *"...no card was charged and your seat count is unchanged."*
- `client/src/pages/settings.tsx:530` — *"...the existing schedule is unchanged."*
- `client/src/pages/settings.tsx:1775` — *"...2FA is still off."*
- `client/src/pages/properties.tsx:282` — *"...your inventory is unchanged."*
- `client/src/pages/leads.tsx:201` — *"The existing score is unchanged. Try again."*

This is the apology pattern Apple Mail and 1Password ship. **Codify it.**

### Rule 2 — Sentence case. Contractions. No exclamation marks.
Best evidence: `settings.tsx:1783` *"Two-factor authentication is on"*, `settings.tsx:1799` *"Two-factor authentication is off"*, `settings.tsx:1960` *"Password changed"*. Quiet, declarative, no fanfare.
Violators below in §4.

### Rule 3 — Pax/AcreOS speak in plain land-investor English. The product never says "AI."
Best evidence: `today.tsx:1126` — *"No proactive suggestions right now. Pax is monitoring your pipeline."* That sentence is the brand. It names the worker, gives the worker a job, and earns trust without an exclamation.
Violator: `today.tsx:1212` *"AI action queue"* / `today.tsx:1229` *"You're all caught up! No AI-suggested actions right now."* Same file. Two voices.

---

## 3. Microcopy inventory by category

### 3.1 Toasts — success (declarative, sentence-case, period)

| File:line | String |
|---|---|
| `pages/properties.tsx:278` | `Properties deleted` / `Removed N properties from your inventory.` |
| `pages/properties.tsx:340` | `Export ready` / `Downloaded {filename}.` |
| `pages/properties.tsx:1205` | `Property added` / `{county}, {state} saved to your inventory.` |
| `pages/properties.tsx:435` | `Property deleted` / `It has been removed from your inventory.` |
| `pages/leads.tsx:194` | `Lead rescored` / `The lead score has been updated.` |
| `pages/leads.tsx:521` | `Consent updated` / `TCPA consent status has been updated.` |
| `pages/deals.tsx:182` | `Stage updated` / `{location} moved to {stage}.` |
| `pages/deals.tsx:221` | `Export ready` / `Downloaded {filename}.` |
| `pages/deals.tsx:242` | `Deals deleted` / `Removed N deals from your pipeline.` |
| `pages/deals.tsx:1271` | `Offer amount updated` / `Set to {amount}` *(missing terminal period)* |
| `pages/deals.tsx:1327` | `Documents generated successfully` *(adverb leak — see §4)* |
| `pages/deals.tsx:1352` | `Analysis saved` / `ROI analysis has been saved to this deal.` |
| `pages/finance.tsx:481` | `Payment link generated` / `You can now share this link with the borrower.` |
| `pages/finance.tsx:549` | `Reminder sent` / `Your borrower has been notified.` |
| `pages/inbox.tsx:381` | `Message archived` / `The message has been moved to archive.` |
| `pages/inbox.tsx:408` | `Reply sent` / `Your reply has been sent successfully.` *(adverb leak)* |
| `pages/inbox.tsx:712` | `SMS sent` / `Your message has been sent successfully.` *(adverb leak)* |
| `pages/settings.tsx:172` | `Status refreshed` / `Your Stripe account status has been updated.` |
| `pages/settings.tsx:195` | `Stripe disconnected` / `Your Stripe account has been disconnected.` |
| `pages/settings.tsx:681` | `Demo data created` / `Added N leads, N properties...` |
| `pages/settings.tsx:704` | `Data cleared` / `All demo data has been removed from your organization.` |
| `pages/settings.tsx:729` | `Subscription activated!` / `Your subscription has been successfully activated.` *(double leak — exclamation + adverb)* |
| `pages/settings.tsx:1783` | `Two-factor authentication is on` *(no description — exemplar)* |
| `pages/settings.tsx:1960` | `Password changed` *(exemplar)* |
| `pages/settings.tsx:2220` | `Goal created` / `Your new goal has been saved.` |
| `pages/settings.tsx:2234` | `Goal deleted` *(exemplar — no description needed)* |
| `pages/settings.tsx:2481` | `API key revoked` *(exemplar)* |

### 3.2 Toasts — failure (the apology pattern; should always name what didn't change)

Strong:

| File:line | String |
|---|---|
| `pages/finance.tsx:103-104` | `Couldn't sync to QuickBooks` / `... — no records were changed.` |
| `pages/finance.tsx:484-485` | `Couldn't generate payment link` / `... — no link was created or charged.` |
| `pages/finance.tsx:529-530` | `Couldn't regenerate schedule` / `... — the existing schedule is unchanged.` |
| `pages/finance.tsx:552-553` | `Couldn't send reminder` / `... — no reminder was sent.` |
| `pages/finance.tsx:1254-1255` | `Couldn't set up payment` / `... — no card was charged.` |
| `pages/settings.tsx:156-157` | `Couldn't start Stripe onboarding` / `... — your Stripe connection is unchanged.` |
| `pages/settings.tsx:201-202` | `Couldn't disconnect Stripe` / `... — your Stripe account is still connected.` |
| `pages/settings.tsx:453-454` | `Couldn't start seat purchase` / `... — no card was charged and your seat count is unchanged.` |
| `pages/settings.tsx:1466-1467` | `Couldn't update role` / `... — the member's existing role is unchanged.` |
| `pages/settings.tsx:1774-1775` | `Couldn't start 2FA setup` / `... — 2FA is still off.` |
| `pages/settings.tsx:1806-1807` | `Couldn't disable 2FA` / `... 2FA is still on — try again with the current authenticator code.` |
| `pages/settings.tsx:1967-1968` | `Couldn't change password` / `... — your password hasn't changed.` |
| `pages/settings.tsx:2238-2239` | `Couldn't delete goal` / `... — the goal still exists.` |
| `pages/settings.tsx:2485-2486` | `Couldn't revoke API key` / `... — the key is still active.` |
| `pages/settings.tsx:2893-2894` | `Couldn't delete your data` / `... — your account is unchanged.` |
| `pages/properties.tsx:282` | `Couldn't delete properties` / `... — your inventory is unchanged.` |
| `pages/properties.tsx:300` | `Couldn't update properties` / `... — their statuses are unchanged.` |
| `pages/deals.tsx:1232` | `Couldn't generate negotiation script` / `... — your deal data is unchanged.` |
| `pages/deals.tsx:1330` | `Couldn't generate documents` / `... — the document package is unchanged.` |
| `pages/deals.tsx:249-250` | `Couldn't delete deals` / `Delete failed. Your deals are unchanged.` |

Weak (no reassurance, no escape hatch — just "try again"):

| File:line | String | Problem |
|---|---|---|
| `pages/today.tsx:303-304` | `Couldn't dismiss alert` / `The alert is still active. Try again, or check the system status.` | Different tail-shape ("Try again, or check…") than the canonical em-dash |
| `pages/leads.tsx:201` | `The existing score is unchanged. Try again.` | Period instead of em-dash; no founder-email escape hatch |
| `pages/leads.tsx:528` | `TCPA consent is unchanged. Try again.` | Same |
| `pages/leads.tsx:755` | `Check your connection and try again.` | Bare — names nothing |
| `pages/leads.tsx:834` | `Check your connection and try again.` | Same — exact dupe |
| `pages/leads.tsx:872` | `Check that the file is a valid CSV and try again.` | Bare |
| `pages/inbox.tsx:133, 331, 349, 366, 389, 990` | `Please try again in a moment.` | Six identical bare strings; "Please" appears nowhere else in the codebase — voice break |
| `pages/inbox.tsx:417` | `Your draft is preserved. Try again or check the email provider status.` | Period instead of em-dash; otherwise good |
| `pages/inbox.tsx:722` | `... — your message draft is preserved. Try again or check the SMS provider status.` | Almost-canonical (em-dash) but the second sentence is a bare retry |
| `pages/finance.tsx:510, 580` | `Check your connection and try again.` | Bare |
| `pages/settings.tsx:179, 711, 765` | `Check your connection and try again.` | Bare — three more dupes |
| `pages/deals.tsx:189, 436` | `Your change didn't save. Try again in a moment.` | Period, no name of what didn't change |
| `pages/deals.tsx:227, 294` | `CSV build failed. Try again — your deals weren't changed.` | "weren't changed" vs canonical "is unchanged" |
| `pages/deals.tsx:1359` | `Your previous analysis is unchanged. Try again.` | Period instead of em-dash |
| `pages/deals.tsx:1338` | `Complete N required checklist item(s) first.` | Doesn't follow apology pattern at all — clinical |

### 3.3 Empty states (`client/src/components/empty-states.tsx`)

| File:line | Title | Description | CTA |
|---|---|---|---|
| `:21-23` | `No leads yet` | `Import your first leads to start building your pipeline. {brand} scores and prioritizes every lead automatically.` | `Add a Lead` |
| `:64-65` | `No properties yet` | `Add properties to track your inventory — from prospect parcels to owned land and active listings.` | `Add a Property` |
| `:99-100` | `No deals yet` | `Create your first deal to start tracking acquisitions and dispositions through your pipeline.` | `Create a Deal` |
| `:121-122` | `No tasks yet` | `Create tasks to track your to-dos, follow-ups, and deadlines across all your deals.` | `Add a Task` |
| `:128` | tip: `Atlas AI suggests follow-up tasks automatically` | **Persona leak** — flagged by Vesna P0-1 | — |
| `:143-144` | `No campaigns yet` | `Launch your first outreach campaign to connect with motivated sellers via mail, email, or SMS.` | `Create a Campaign` |
| `:165-166` | `No promissory notes yet` | `Create your first seller-financed note to start tracking payments, amortization, and portfolio value.` | `Create a Note` |
| `:187-188` | `Your pipeline is empty` | `Add leads and deals to see them flow through your pipeline stages.` | — |
| `pages/finance.tsx:363-365` | `No promissory notes yet` | `Create a note to track financing. Manage seller financing, track payments, and generate amortization schedules.` | `Create Your First Note` *(Title Case — see §4)* |
| `pages/inbox.tsx:1005` | `No SMS conversations` | `SMS conversations will appear here.` | — |
| `pages/inbox.tsx:1009` | `No unread messages` | `You're all caught up!` *(exclamation)* | — |
| `pages/inbox.tsx:1011` | `No starred messages` | `Star messages to find them quickly.` | — |
| `pages/inbox.tsx:1013` | `No archived messages` | `Archived messages will appear here.` | — |
| `pages/inbox.tsx:1015` | `No messages` | `Your inbox is empty.` *(restates title — flagged by Vesna)* | — |
| `pages/today.tsx:1126` | (inline empty for Pax suggestions) | `No proactive suggestions right now. Pax is monitoring your pipeline.` | — |
| `pages/today.tsx:1229` | (inline empty for AI queue) | `You're all caught up! No AI-suggested actions right now.` *(persona regression + exclamation)* | — |

### 3.4 Greetings / page headlines

Editorial split (the good pattern):

| File:line | Headline | Soft suffix |
|---|---|---|
| `pages/today.tsx:646-656` | `{Good morning}, {Thomas}.` | `{N} deals need your attention today.` / `Here's what's on the horizon.` |
| `pages/pipeline.tsx:262-278` | `{N} active deals` / `Your deal machine.` | `across leads, properties, and outreach.` / `Bring in your first lead to get going.` |
| `pages/inbox.tsx:1037-1050` | `{N}` / `All caught up.` | `unread messages` / `Nothing waiting.` |

These three are nearly identical in shape. Make them a documented `<EditorialHeadline>` component.

### 3.5 Dialog titles — a five-way pattern collision

| File:line | Title | Pattern |
|---|---|---|
| `pages/properties.tsx:533` | `Add New Property` | Title Case + redundant "New" |
| `pages/properties.tsx:765` | `Import Properties from CSV` | Title Case |
| `pages/leads.tsx:1168` | `Create {leadLabel.toLowerCase()}` | Sentence case, dynamic noun |
| `pages/leads.tsx:1830` | `Edit Lead` | Title Case |
| `pages/leads.tsx:1862` | `Generate Offer Letter` | Title Case |
| `pages/leads.tsx:1927` | `Import leads from CSV` | Sentence case |
| `pages/deals.tsx:498` | `Create {dealLabel.toLowerCase()}` | Sentence case, dynamic |
| `pages/finance.tsx:242` | `Create Promissory Note` | Title Case |
| `pages/settings.tsx:1845` | `Disable two-factor authentication?` | Sentence case + question mark |

Three different shapes for the same job ("create the thing"). Pick one.

### 3.6 Form-field placeholders (sample — a textbook discipline drift)

| File:line | Placeholder | Note |
|---|---|---|
| `pages/leads.tsx:1260, 1325` | `Search leads…` | Good — sentence case, ellipsis |
| `pages/leads.tsx:1269, 1373` | `Filter by stage` | Good |
| `pages/leads.tsx:1879` | `Choose a property…` | Good |
| `pages/leads.tsx:1896` | `Enter offer amount…` | Good |
| `pages/leads.tsx:2151, 2173` | `John` / `Doe` | **Fictional name** — use `Jamie` (gender-neutral) or drop |
| `pages/leads.tsx:2195` | `john@example.com` | OK |
| `pages/leads.tsx:2219` | `(555) 123-4567` | OK |
| `pages/leads.tsx:2240` | `Select status` | Good |
| `pages/properties.tsx:1230, 1274` | `123-456-789` / `123-456-789 or N/A` | Inconsistent — same field, two formats |
| `pages/properties.tsx:1306` | `San Bernardino` | Specific county — slightly weird, but OK |
| `pages/properties.tsx:1342, 1355` | `5000` / `15000` | Bare numbers — should be `$5,000` style |
| `pages/properties.tsx:1370` | `Beautiful desert lot with road access…` | **Marketer voice** — doesn't match Thomas |
| `pages/finance.tsx:1678, 1705, 1731, 1775` | `10000` / `9` / `60` / `1000` | Bare numbers, no formatting hints |
| `pages/inbox.tsx:614, 832` | `Type your reply…` / `Type your message…` | Good |
| `pages/inbox.tsx:1061` | `Search messages…` | Good |
| `pages/settings.tsx:1854, 1908` | `6-digit code` | Good |
| `pages/settings.tsx:2278` | `e.g. Q2 deal target` | Good — uses "e.g." |
| `pages/settings.tsx:2303` | `e.g. 10` | Good |
| `pages/settings.tsx:2581` | `e.g. Zapier integration` | Good |
| `pages/settings.tsx:3003` | `Type DELETE here` | Good — destructive guard |

### 3.7 Loading strings (Vesna's P0-3, expanded)

| File:line | String | Issue |
|---|---|---|
| `pages/pax.tsx:474` | `Waking Pax…` | **Exemplar** — names what's loading, has voice |
| `pages/pax.tsx:478` | `Loading…` | Bare — same file, two voices |
| `pages/pax.tsx:184` | aria: `Loading Pax insights` | Good — aria gets it right |
| `pages/buyer-network.tsx:311` | `Loading demand data…` | Good |
| `pages/safety-gates.tsx:235` | `Loading deals…` | Good |
| `pages/deals.tsx:2101, 2113` | `Loading properties…` | Good |
| `pages/land-credit.tsx:391, 594` | `Loading score history…` / `Loading portfolio distribution…` | Good |
| `pages/founder-dashboard.tsx:6015` | `Loading briefing…` | Good (founder surface) |
| 30+ aria-labels | `Loading X` | Aria correct; visible string usually bare or missing |

### 3.8 Errors via `lib/error-utils.ts:1-55`

| Line | String | Voice |
|---|---|---|
| `:5` | `Connection issue. Please check your internet and try again.` | "Please" — voice break |
| `:8` | `Your session has expired. Please sign in again.` | "Please" |
| `:11` | `You don't have permission to do this.` | OK |
| `:14` | `The requested item could not be found.` | "could not" — formal, not contracted |
| `:17` | `We hit a snag on our end. Try again in a moment.` | **Best one in the file** — the only one in voice |
| `:20` | `Too many requests. Please wait a moment and try again.` | "Please" |
| `:23` | `Request timed out. Please check your connection and try again.` | "Please" |
| `:27` | `An unexpected error occurred. Please try again.` | "Please" + passive |
| `:33-51` | `Session Expired`, `Permission Denied`, `Not Found`, `Server Error`, `Rate Limited`, `Connection Error`, `Request Timeout`, `Error` | **Title Case**, two-word noun phrases — every one of these violates Rule 2 |

This is the single biggest concentrated voice debt in the customer surface.

---

## 4. Inconsistency report

### 4.1 Verb collisions — same action, three verbs

| Verb | Used at | Should be |
|---|---|---|
| `Add` | leads, properties, tasks empty-state CTAs | "Add" for nouns you collect (leads, properties) |
| `Create` | deals, campaigns, notes empty-state CTAs; `Create Your First Note` (`finance.tsx:365`) | "Create" for objects you compose (deals, campaigns, notes, goals) |
| `New` | `settings.tsx:2264` "New goal", `deals.tsx:1747` mobile-only | Reserve for inline mobile abbrev — never alongside "Create" |

The current intuition is roughly right (Add = collect, Create = compose) but isn't documented and slips. `Create Your First Note` (Title Case + "First") is the only string in the entire app with that shape — kill it.

### 4.2 Title Case vs sentence case

- **Sentence case** (canonical):
  - `pages/leads.tsx:1168` `Create lead`
  - `pages/leads.tsx:1927` `Import leads from CSV`
  - `pages/settings.tsx:1845` `Disable two-factor authentication?`
- **Title Case** (violators):
  - `pages/properties.tsx:533` `Add New Property`
  - `pages/properties.tsx:765` `Import Properties from CSV`
  - `pages/leads.tsx:1830` `Edit Lead`
  - `pages/leads.tsx:1862` `Generate Offer Letter`
  - `pages/finance.tsx:242` `Create Promissory Note`
  - `pages/finance.tsx:365` `Create Your First Note`
  - `lib/error-utils.ts:33-51` — all eight error titles

### 4.3 Apology-pattern shape drift (Vesna's "three sentence shapes")

Three coexisting tail-shapes for the apology-recovery sentence:

1. **Em-dash, name what's unchanged** (canonical, ~22 sites): `... — your inventory is unchanged.`
2. **Period, then "Try again."** (~11 sites in leads/deals): `... is unchanged. Try again.`
3. **Bare retry, no name** (~12 sites in inbox/leads/settings): `Check your connection and try again.` / `Please try again in a moment.`

**Effect:** the same broken-network condition produces three different tones depending on which engineer wrote the page.

### 4.4 "Please" leak

The word `Please` appears 11 times in `pages/inbox.tsx` (lines 133, 331, 349, 366, 389, 990) and 7 times in `lib/error-utils.ts`. It appears **zero** times in `client/src/pages/landing/copy.ts` or `pages/why.tsx`. The voice does not use "Please." Strip it.

### 4.5 Adverb leak ("successfully")

- `pages/inbox.tsx:409` *"Your reply has been sent successfully."*
- `pages/inbox.tsx:713` *"Your message has been sent successfully."*
- `pages/deals.tsx:1327` *"Documents generated successfully"*
- `pages/settings.tsx:730` *"Your subscription has been successfully activated."*

The success is implied by the toast's existence. Strip the adverb in all four.

### 4.6 Exclamation marks (the voice does not use them)

- `pages/inbox.tsx:1009` *"You're all caught up!"*
- `pages/today.tsx:1229` *"You're all caught up! No AI-suggested actions right now."*
- `pages/settings.tsx:729` *"Subscription activated!"*

Three sites. Convert to declarative.

### 4.7 Persona slips

- `components/empty-states.tsx:128` — `Atlas AI suggests follow-up tasks automatically` (Vesna P0-1) → should be `Pax suggests follow-ups automatically.`
- `pages/today.tsx:688` — `Sovereign dashboard →` link rendered to non-founders (Vesna P0-2) → kill on customer surface.
- `pages/today.tsx:1212` — `AI action queue` (Asher §3.1) → `What Pax queued for you` or `Suggested next moves`.
- `pages/today.tsx:1229` — `AI-suggested actions` → `Pax-suggested actions`.

### 4.8 Vocabulary leak (per Asher §9)

- `pages/privacy.tsx:42` — *"real estate CRM platform"*
- `pages/market-data.tsx` — *"real-time real estate market data"*
- `components/onboarding-wizard.tsx` — *"Note Investor: Seller-finance real estate sales"*
- `components/settings/persona-panel.tsx` — *"often secured by real estate"*

---

## 5. Top-25 specific rewrites

| # | File:line | Before | After | Why |
|---|---|---|---|---|
| 1 | `today.tsx:1212` | `AI action queue` | `What Pax queued for you` | Restores named worker; voice-survives auth wall |
| 2 | `today.tsx:1229` | `You're all caught up! No AI-suggested actions right now.` | `Nothing queued. Pax is watching the pipeline.` | Mirrors line 1126; matches voice; kills exclamation |
| 3 | `today.tsx:688` | `Sovereign dashboard →` | (remove for non-founders; for founders: `Sovereign →`) | Founder codename leak on customer surface |
| 4 | `empty-states.tsx:128` | tip: `Atlas AI suggests follow-up tasks automatically` | `Pax suggests follow-ups automatically.` | Persona architecture |
| 5 | `empty-states.tsx:21-23` | `No leads yet` / `Import your first leads to start building your pipeline.` | `No leads yet.` / `Drop a CSV or add one by hand. Pax scores and ranks every lead overnight.` | Names the worker; tells what'll happen |
| 6 | `empty-states.tsx:64-65` | `No properties yet` / `Add properties to track your inventory — from prospect parcels to owned land and active listings.` | `No parcels yet.` / `Drop an APN, a coordinate, or a CSV. Pax pulls comps tonight.` | "parcel" > "property"; specific |
| 7 | `empty-states.tsx:99-100` | `No deals yet` / `Create your first deal to start tracking acquisitions and dispositions through your pipeline.` | `No deals yet.` / `A deal connects a lead, a parcel, and the money. Add one to start.` | Plain English, names the moving parts |
| 8 | `empty-states.tsx:121-122` | `No tasks yet` / `Create tasks to track your to-dos, follow-ups, and deadlines across all your deals.` | `No tasks yet.` / `The things you said you'd do, with dates. Tasks can attach to a lead, a parcel, or a deal.` | Asher-recommended; founder-letter cadence |
| 9 | `inbox.tsx:1015` | `No messages` / `Your inbox is empty.` | `You're all caught up.` / `New email and SMS will show up here as it lands.` | Vesna M1; description ≠ title restated |
| 10 | `inbox.tsx:1011` | `No starred messages` / `Star messages to find them quickly.` | `Nothing starred yet.` / `Tap the star on any message to keep it close — across email and SMS.` | Vesna M2; "yet" implies future |
| 11 | `inbox.tsx:1009` | `You're all caught up!` | `You're all caught up.` | Kill exclamation |
| 12 | `inbox.tsx:133, 331, 349, 366, 389, 990` (×6) | `Please try again in a moment.` | `Try again — nothing was changed.` | Strip "Please"; name what didn't change |
| 13 | `inbox.tsx:409` | `Your reply has been sent successfully.` | `Your reply went out.` | Adverb + passive → active |
| 14 | `inbox.tsx:713` | `Your message has been sent successfully.` | `Your SMS went out.` | Same |
| 15 | `deals.tsx:1327` | `Documents generated successfully` | `Documents ready.` | Same; matches "Export ready." |
| 16 | `settings.tsx:729-730` | `Subscription activated!` / `Your subscription has been successfully activated.` | `Subscription active.` / `You're on the {plan} plan now.` | Kill exclamation + adverb; tell user the new state |
| 17 | `error-utils.ts:33` | `Session Expired` / `Your session has expired. Please sign in again.` | `Signed out.` / `Your session ran out — sign back in to pick up where you left off.` | Sentence case; voice |
| 18 | `error-utils.ts:35` | `Permission Denied` / `You don't have permission to do this.` | `Not your call.` / `This action needs an Admin or Owner — ask your team to grant access.` | Voice + actionable |
| 19 | `error-utils.ts:41` | `Server Error` / `We hit a snag on our end. Try again in a moment.` | `Something broke on our end.` / `We see it. Try again in a minute, or email thomas@acreos.io if it's blocking a deal.` | Asher §10; founder-email escape hatch |
| 20 | `error-utils.ts:5` | `Connection issue. Please check your internet and try again.` | `Couldn't reach AcreOS. Check your connection and try again — nothing was changed.` | Strip "Please"; canonical apology |
| 21 | `properties.tsx:533` | `Add New Property` | `Add a parcel` | Sentence case; kill "New"; "parcel" > "property" |
| 22 | `properties.tsx:765` | `Import Properties from CSV` | `Import parcels from CSV` | Sentence case; vocab |
| 23 | `leads.tsx:1830` | `Edit Lead` | `Edit lead` | Sentence case |
| 24 | `finance.tsx:242` | `Create Promissory Note` | `Create a note` | Sentence case; "promissory" is contract jargon |
| 25 | `finance.tsx:365` | `Create Your First Note` | `Create a note` | Kill Title Case + "Your First" — the only string with that shape |

Bonus (top-25-and-a-half): replace **every** `Check your connection and try again.` (`leads:755, 834`, `finance:510, 580`, `settings:179, 711, 765`, `deals:1315`) with the canonical *`Couldn't [verb] [noun]. Try again — [thing] is unchanged.`* Eight sites collapse to one shape.

---

## 6. The voice guide (drop into CONTRIBUTING.md)

```md
# AcreOS Voice — Microcopy Rules

Every customer-facing string in AcreOS sounds like a letter from
Thomas — plain, honest, calm, written by a person who closed 200
land deals before he wrote this code. Use these rules.

## The three rules

1. **Name what didn't change after a failure.**
   Canonical shape: `Couldn't [verb] [noun]. [Reassurance] —
   try again.` The em-dash and the noun are doing the work.
   Bad: "Please try again in a moment."
   Good: "Couldn't send the SMS. Your draft is saved — try again."

2. **Sentence case. Contractions. No exclamation marks.**
   - Title: "Add a parcel" — not "Add New Property"
   - Toast: "Goal saved." — not "Successfully Saved!"
   - Use "you're", "we'll", "didn't" — never "you are", "we will"
   - One exception: proper nouns (Pax, AcreOS, Stripe, QuickBooks)

3. **Pax does the work. The product never says "AI."**
   Customer surfaces name Pax. Founder surfaces (anything under
   `/founder*`, `/sovereign*`, `/data-moat*`) may name Atlas /
   Sophie / Forge / Shield. Never mix.

## Banned words on customer surfaces

- "Please" (clinical, not Thomas)
- "Successfully" / "successful" (the toast existing implies it)
- "Failed to X" → use "Couldn't X"
- "Error:" prefix → use a verb
- "AI" / "AI-suggested" / "AI-powered" → use Pax (or omit)
- "real estate" → use "land" (legal/disclaimer text excepted)
- "real estate professional" / "realtor" in product chrome →
  "Land Investor"
- Title Case in dialog titles, button labels, section headers

## Verb discipline (one verb per noun)

| Noun     | Verb     | Why |
|----------|----------|-----|
| Lead     | Add      | You collect leads |
| Parcel   | Add      | You collect parcels |
| Deal     | Create   | You compose a deal |
| Campaign | Create   | You compose a campaign |
| Note     | Create   | You compose a note |
| Task     | Add      | You drop tasks in |
| Goal     | Create   | You compose a goal |
| API key  | Create   | Compose |
| Member   | Invite   | Not "Add" — humans get invited |

Never use "New" as a verb. "New" is fine on a mobile-only
abbreviation alongside an icon when "Create" doesn't fit.

## Toast shapes

**Success:** sentence-case title, no exclamation. Description
is optional. If included, one declarative sentence ending in a
period. Do not say "successfully."

```
title: "Goal saved"
description: "Your Q2 deal target is live."
```

**Failure:** Title starts with "Couldn't [verb]". Description
ends with "— [thing] is unchanged" or names what didn't happen.
For payment / data-loss critical failures, add the founder
escape hatch: "or email thomas@acreos.io."

```
title: "Couldn't send the reminder"
description: "No reminder went out — try again, or email
              thomas@acreos.io if it's blocking a payment."
```

## Empty states — the "what'll happen" rule

Every empty state must tell the user what will happen when
they fill it. Not what they "can" do. Not what the feature is
"for." What Pax will do tonight.

```
title: "No parcels yet."
description: "Drop an APN, a coordinate, or a CSV. Pax pulls
              comps tonight."
```

## Loading strings — name the noun

Never `Loading…` alone. Always `Loading [what]…` or a verbed
form: `Pulling comps…` `Waking Pax…` `Importing leads…`

## CTA labels — no Title Case, no "Your First"

- "Add a parcel" (not "Add Your First Property")
- "Create a deal" (not "Create New Deal")
- "Create a note" (not "Create Your First Note")
```

---

## 7. Cross-references

- **Asher §3.6** flagged the toast pattern as 70% disciplined; I confirm 70/30 and inventory the 30% above (§3.2 weak rows).
- **Asher §3.1** rewrite of `AI action queue` → my Top-25 #1.
- **Asher §3.3** empty-state rewrite philosophy (name the agent that will work) → my §6 rule and Top-25 #5–#8.
- **Asher §10** apology + recovery + founder email → my Top-25 #19; codified in §6 toast shapes.
- **Asher §9** vocabulary leak (`real estate`) → my §4.8 + §6 banned words.
- **Vesna §3 P0-1** Atlas leak in TasksEmptyState → Top-25 #4.
- **Vesna §3 P0-2** Sovereign dashboard CTA → Top-25 #3.
- **Vesna §3 P1-10** "three error-toast sentence shapes coexist" → my §4.3 enumerates all three with site counts (22 / 11 / 12).
- **Vesna §4 M1, M2** inbox empty rewrites → Top-25 #9, #10.

---

## 8. Voice scorecard

| Dimension | Score | Note |
|---|---|---|
| Warmth | **4/5** | Toast pattern is genuinely warm; error-utils.ts is cold |
| Brevity | **3/5** | Empty-state descriptions average 16 words; should be 8-12 |
| Action-orientation | **3/5** | Many strings tell the user what they "can" do, not what'll happen |
| Persona adherence (Land Investor) | **3.5/5** | "land investor" 54 hits, "real estate" 10 hits — mostly clean, not airtight |
| No-jargon | **4/5** | Strong; "promissory note" / "TCPA" / "amortization" appear where appropriate |
| No-AI-handwaving | **2.5/5** | "AI action queue", "AI-suggested actions", "AI requests", `Atlas AI` leak — voice loses here |
| Apology pattern discipline | **3.5/5** | Canonical shape exists; 30% of sites violate it |
| Capitalization discipline | **2/5** | Sentence case is clearly the canon, ~30% Title Case violators |
| Punctuation discipline | **3.5/5** | Mostly periods; three `!`; missing terminal periods on a few descriptions |
| Founder-letter cadence | **3/5** | Lives on `/today` greeting and `/why`; doesn't survive into errors |
| **Composite** | **32 / 50** | Two-thirds of an Apple-Mail voice. Two weeks of cleanup away. |

---

## 9. Closing note

The voice is real. It's already on the page in `finance.tsx`'s toast block, in `today.tsx:1126`'s "Pax is monitoring your pipeline," in the editorial greetings on three pages. The job in front of you is not invention — it's a single janitorial pass that strips eleven `Please`s out of `inbox.tsx`, eight `Title Case` dialog titles, four adverbs, three exclamation marks, and the six identical `Check your connection and try again.` strings. After that, codify the pattern in `CONTRIBUTING.md` (§6) and lint it.

When `error-utils.ts` reads like the founder wrote it and the empty-state for tasks names Pax instead of Atlas, AcreOS will sound like one person across every surface. That is the bar Asher set. The work is small.

— Mira Solberg · 2026-05-01
