# Reyna Santos — AcreOS, the Manila VA lens

I'm Reyna. Thirty-four, Quezon City. I work for four US Land Investors — one in Dallas, one in Tampa, two in Phoenix metro. I do skip-trace QA, mailer list cleanup, lead intake, follow-up SMS drafts, and the occasional offer letter typing. I've been a real-estate VA since 2019. I learned REI Reply, Podio, Pebble, Launch Control, and now my Phoenix client wants me on AcreOS. My English is functional — I read it faster than I speak it — but I work in Tagalog in my head, and idioms still trip me. This is my honest first month.

---

## 1. Thirty-second verdict

AcreOS is built like the operator is sitting next to the seller in Texas. I am sitting in Quezon City at 11pm because Phoenix is 15 hours behind me. The product never asks me where I am, never adjusts what time it shows me, and assumes my English is American-English-with-real-estate-jargon — which is two languages I had to learn separately. I can do my job here. I cannot do my job *fast* here. Every screen costs me 10–30% more cognitive load than the same screen in REI Reply or Pebble would, because the language is denser, the idioms thicker, and the time stamps in a timezone I have to translate in my head every single time.

The biggest concrete failure: there is no **VA role**. The role list is `owner | admin | member | viewer` plus a few function tags (`acquisitions | marketing | finance`). There is no role that says "this person works for me but is not on my team, can see leads but not money, can run skip traces but not pay for them, can draft SMS but not send without approval." Every VA I've ever worked under has wanted that exact role. AcreOS makes my Phoenix client choose between giving me too much access (`member`) or too little (`viewer`, which can't do the work). He chose `member`. He's nervous about it. He should be — `member` can see his bank-linked finance pages, his investor cap-table notes, and his SMS A2P spend. I don't *want* to see those things. They make me liable.

---

## 2. Daily-use walkthrough — a Tuesday in Manila, 9pm to 1am

**9:00 PM Manila / 6:00 AM Phoenix.** I log in. My client wants the overnight callbacks cleaned and the morning mailer pulled. Clerk auth works fine — I had to do the email magic link twice because the first one expired before I switched browsers, but that's normal. I land on `/dashboard`. The Pax morning brief greets me with "Good morning" — at 9pm. Small thing. Real thing. Every VA tool I've used either reads my system clock or asks me a setup question. AcreOS does neither. I checked `shared/schema.ts` — `timezone` is on the *organization* (defaulting to `America/New_York` or `America/Chicago`), not on the user. So when my Phoenix client and I both look at the same screen, we both see Phoenix time. Which is fine for him and a 13-hour brain tax for me.

**9:20 PM.** I open `/leads` to clean overnight callbacks. The column headers are "Last Touch," "Next Action," "Decision Queue," "Pulse." *Pulse* I had to ask about — I thought it was a heart-rate metric. *Decision queue* I thought was something I clicked to make a decision; it's a list of things waiting for somebody else to decide. *Last touch* sounds physical. None of these are wrong English. They are all idioms my American clients use without thinking. A glossary in the help panel — even just 30 terms with one-line plain-English definitions — would save me 20 minutes a day for the first three weeks. After three weeks I'd be fluent. The first three weeks are when most VAs are fired.

**9:45 PM.** Skip trace. I open `/skip-tracing` (the page itself is `client/src/pages/skip-tracing.tsx`, 206 lines, decent). I upload a CSV of 412 records the client pulled from PropStream. I click run. Toast appears: *"Couldn't run skip trace."* No reason. No fix-it. No "your CSV is missing the `mailing_state` column" or "your client is out of credits." Just couldn't. I have to message my client at 7am his time to ask why. He's asleep. I lose 90 minutes. The error needs to tell me which credit pool, which provider failed, and which field is missing — in **plain English at a 6th-grade reading level**, not "validation_error: schema_mismatch on column[3]." I read American legal English better than I read American developer English.

**10:30 PM.** Drafting follow-up SMS in `/sequences`. The template variables are `{{first_name}}`, `{{property_county}}`, `{{offer_amount}}` — fine, those are universal. But the *suggested* templates are written in Texan and Floridian: "Howdy," "y'all," "fixin' to," "reckon." If I send those out under my client's number, they sound right to a Texas seller. They sound *wrong* to me when I'm picking which one to use, because I have to first decode the regional voice and then decide if it matches the client. I'd love a "voice profile" the client sets at org level — Texas friendly / Phoenix direct / Carolina warm — and then *all* templates render in that voice. Today I have to read every template like a translator.

**11:15 PM.** Mailer setup. `/campaigns`. I'm building a yellow-letter mailer to 1,800 absentee owners in Maricopa County. The interface uses the term "yellow letter" without defining it. I know what one is now (handwritten-style postcard, fake handwriting font). I didn't on day one. I asked another VA in our Discord. The product has no glossary. There's a `HelpPanel.tsx` with AI-driven answers — when I asked it "what is a yellow letter" it gave me a 4-paragraph answer with US case-law references I didn't need. A glossary tooltip on the term itself, hover or tap, with 1-2 sentences plus a tiny image, is what I needed. The AI panel is overbuilt for the job I had.

**12:00 AM.** Three of my four clients have me work in their AcreOS. To switch between them I have to log out, clear `active_organization_id`, log back in. That cookie-clearing dance is in the code (`client/src/hooks/use-auth.ts`, `client/src/lib/queryClient.ts`, `client/src/lib/clerk-session-recovery.ts` — three places set `active_organization_id=` to empty). There is no **org switcher** in the UI. Every modern multi-tenant SaaS has the org name in the top bar with a dropdown. AcreOS hides it. My nightly workflow has me logging in 3-4 times. That's 8-12 minutes of pure friction per shift, every shift.

**12:40 AM.** Audit log. My Phoenix client trusts me but verifies. I asked him to show me the audit trail he sees of my actions — I want to *prove* I'm not touching the finance tab. He showed me `audit_log` and `activity_log` exist server-side, but he can't find a UI surface that filters by user. He had to ask me to send him my action list manually. There needs to be a **per-member activity report** at `/settings/team/:id/activity` — "here's everything Reyna did last week, filterable, exportable" — that I can pull on myself and send him. Today I'm trusted on faith. I'd rather be trusted on receipts.

**1:00 AM.** Sign off. I've done about 70% of what I'd have done in REI Reply in the same hours.

---

## 3. ESL-hostile language inventory

Words and phrases I had to look up or guess in my first two weeks. Each one is a real friction point for a VA whose English is functional but not native:

- *Pulse* (a score, not a heartbeat)
- *Decision queue* (a wait list, not a click target)
- *Last touch* (last contact event, not physical contact)
- *Yellow letter* (handwritten-style postcard)
- *Cold call burndown* ("burndown" is dev-jargon, not sales-jargon in PH)
- *Pipeline velocity* (rate of leads moving, not actual speed)
- *Buy-box* (criteria, not a literal box)
- *Skip trace* (find owner contact info — "trace" is fine, "skip" is confusing because in Tagalog usage "skip" means avoid)
- *Drip campaign* ("drip" is plumbing in PH usage)
- *Acquisition radar* (a watchlist, not radar)
- *Deal flow* (incoming opportunities)
- *Earnest money* (good-faith deposit — every VA needs this defined the first time)
- *Subject-to* / *sub-to* (financing structure — this is a deal-killer to misunderstand)
- *Wholesale assignable* (resale of contract rights, not retail wholesale)
- *Opt-out* / *DNC* (legal terms — these I knew, but the screens don't explain WHY they matter under TCPA)
- *Founder mode*, *Pax*, *Sovereign* (product-internal jargon — see persona-architecture)
- *Burner number*, *spam-likely score*, *carrier filtering* (telecom jargon)
- *Comp*, *ARV*, *ARLV* (real-estate jargon — Land Investors use ARLV not ARV; this is right)

Fix: **a `<TermTip>` component** that wraps any in-text term and shows a 1-2 sentence definition on hover/tap, sourced from a single `glossary.json`. 80 terms covers 95% of friction. Three days of work for a transformative onboarding for every non-native English VA — and that's a real population, conservative estimate 15,000+ VAs working US REI right now.

---

## 4. Time-zone handling — the silent productivity tax

The schema has `organization.timezone` defaulting to `America/New_York` or `America/Chicago`. There is **no `user.timezone`**. Every timestamp on every page is rendered in the org's timezone. For a VA who works for four US clients across three US timezones from a fifth (Manila), that means:

- The "today" filter on `/leads` is *yesterday* for half my shift.
- The Pax greeting is wrong half the day.
- Mailer scheduled-send times are in client time, which is fine, but the *display* of "scheduled for 9:00 AM" doesn't tell me *whose* 9:00 AM. I've sent two mailers at the wrong time in my career because of this kind of ambiguity. (Not on AcreOS yet. I'm careful.)
- The activity-log timestamps that prove I worked are in the client's time, which means my "I worked 9pm-1am Manila" looks like "6am-10am Phoenix" in the log — fine for him, but if I ever need to defend hours billed against my Manila records, the timestamps don't match.

Concrete fix: add `users.timezone` (IANA name, default to org TZ on first login, prompt to confirm at first session). Render every timestamp twice when `user.timezone !== org.timezone` — primary in user TZ, secondary muted in org TZ on hover. Or at minimum, show one-line text at the top of `/dashboard`: *"Showing times in Phoenix (your client's timezone). You're in Manila (UTC+8)."* That alone would save me a daily error.

---

## 5. Client isolation — the part I am most afraid of

I work for four investors. They do not know each other. They do not want each other to know they use a VA in common. AcreOS is org-scoped, which is correct, and the project memory confirms onboarding is org-scoped too. The data layer is fine. The UX layer is where the leak risk lives:

- **Browser autofill** — when I'm typing a phone number into client A's mailer and Chrome offers me client B's seller list, that's a leak waiting to happen. Add `autocomplete="off"` on every PII field and never let the browser remember a search query that includes a parcel ID. I checked a few forms; coverage is inconsistent.
- **Recent items / search history** — `⌘K` (the new command palette per the topbar commit) needs to be **scoped to the active org**. If it shows me "recent: 12345 Apache Trail" from client A while I'm logged into client B, that's the leak. I haven't been able to test this thoroughly yet because of the org-switcher gap above (re-logging in clears the cache anyway, which is the unintentional safe path).
- **Clipboard** — when I copy a phone number from client A and paste it into client B, the clipboard doesn't know. This isn't AcreOS's fault, but a "you copied this from a different org 30 seconds ago, paste anyway?" warning in PII fields would be a remarkable trust signal.
- **Notification email subjects** — the digest emails (Pax morning brief, Pulse weekly) need to put **the org name first** in the subject line. *"[Client A] Morning Brief — May 1"* not *"Morning Brief — May 1 (Client A)"*. My inbox is sorted client-first; AcreOS's emails today force me to open them to know who they're for.

None of these are catastrophic. All of them are the difference between "the VA confidently works for four clients on one tool" and "the VA only uses AcreOS for one client and falls back to spreadsheets for the others." Today I'm in the second mode for two of my four clients.

---

## 6. The missing VA role

Roles available (`server/utils/permissions.ts`): `owner | admin | member | viewer`. Invite endpoint also accepts `acquisitions | marketing | finance`. None of these fit a VA. What a VA needs:

```
role: "external_assistant"
permissions:
  leads: read, update, comment, tag
  parcels: read, comment
  skip_trace: run (from a metered allowance the operator sets)
  campaigns: draft (cannot send)
  sequences: draft (cannot send)
  sms: draft (cannot send)
  finance: NONE
  billing: NONE
  team: read self only
  audit: read self only, export self
  org_switcher: visible (if member of >1 external_assistant org)
```

Ship that role and three things change: (1) operators trust their VAs faster, (2) VAs can show their work cleanly, (3) AcreOS gets a referral channel from VAs to operators because we recommend the tool when it doesn't make us feel like a liability. Today I'm a `member` who is told verbally "don't click the finance tab." That's not a control; that's a hope.

There's also a softer ask: a **VA-side onboarding**. The first-login experience assumes I'm the owner of a Land Investing business. I'm not. I work for one. A first-login branch — "are you the operator, or are you working on behalf of an operator?" — would let the product set me up correctly: hide the founder/persona surfaces, hide billing, surface the lead/skip/campaign workflows, and start me in `/leads` not `/dashboard`.

---

## 7. Help docs and in-app translation

`HelpPanel.tsx` is AI-first. That's a good bet for the operator. For me it's the wrong shape:

- AI answers in formal American English at a high reading level. I read American business email well; I read American AI casually less well — the AI panel uses contractions, idioms, and jokes ("Looks like you're trying to lasso a wholesale comp!") that make me work harder. Add a "**plain English mode**" toggle that strips contractions, idioms, and humor.
- No language selection. Tagalog is my first language; Spanish is the first language for a large fraction of US-domestic VAs in TX/CA/AZ. **Add `lang` selection** with at minimum: English, Spanish, Tagalog. The AI is already multilingual under the hood (Claude/GPT both handle these natively); it just needs the UI hook to set the system prompt.
- No glossary. As above, this is the single highest-leverage doc-side fix.
- No screenshots / no GIFs. I learn faster from a 4-second screen recording than from 200 words. Even one short clip per workflow (skip trace, mailer build, sequence send) would cut my onboarding from 3 weeks to 1.

There is no `i18n` infrastructure in `client/src/` (I searched — zero `i18n`/`locale`/`translation` imports outside of `Intl.NumberFormat("en-US")` calls and `formatDistanceToNow` from date-fns). The locale is hardcoded `en-US` in `client/src/lib/format.ts` (lines 4-5, plus several `.toLocaleString("en-US")` calls). Even adding one more locale means refactoring those constants. That's a one-week project to set up `react-i18next` or `lingui`, then a continuous translation effort. Not cheap. But the addressable user base (VAs + Hispanic-American operators + future LATAM expansion) is enormous.

---

## 8. Cultural fit — US business norms vs Filipino norms

This is the hardest section to write because it sounds like complaining. It is not. It is product feedback.

- **Directness.** US REI templates and the Pax suggestions are *direct*: "I'll pay you $X cash, close in 21 days, no inspection contingency." That tone reads as rude in PH culture and we have to override our instinct to soften it before we send. A "tone preview" — "this template will sound *direct* to the seller, which is normal in the US REI market" — would help new VAs trust the templates.
- **Names.** US first-name greeting is universal in the templates. PH culture greets with title + last name (Mr./Mrs./Sir/Ma'am) for first contact. The mailer templates default to first-name. That's correct for the US recipient. But when *I* read the template I feel impolite, and I have to consciously not "fix" it. An inline note — "first-name greeting is the US REI norm" — would help me trust the default.
- **Apologies.** PH business writing apologizes more. My drafts read as over-apologetic to my Phoenix client until I got feedback. A "tone check" AI pass on outgoing SMS that flags Filipino-English over-formality would have saved me embarrassment in week one.
- **Time of day.** I work nights to overlap with US morning. The product should know that and not greet me with "Good morning" at my 9pm. (See timezone above.)
- **Religious holidays.** Holy Week (Maundy Thursday + Good Friday) is a national PH holiday. April 9 is Araw ng Kagitingan. December 30 is Rizal Day. If AcreOS's *operator* sees a digest that says "your VA Reyna will be offline Apr 17-18 for Holy Week," it builds trust both ways. There's no calendar primitive for this. There could be — `users.observed_holidays: country_code` would auto-populate from a public source.

---

## 9. Bandwidth and device

Manila internet is fine until it isn't. Typhoon season (Jun-Nov) means rolling blackouts and LTE-only days. AcreOS is a heavy SPA. I checked: there is no "**low-bandwidth mode**." Property maps load tiles eagerly. The Pulse score and dashboards do real-time websocket updates I don't need at 2 Mbps. I'd kill for:

- a `?lite=1` query param that disables real-time, lazy-loads maps, and serves smaller skeletons
- offline drafting for SMS / email templates so I can write during a brownout and sync when power's back
- a "you're offline" toast that doesn't *delete* the in-progress draft (I lost a 15-line offer letter draft once)

These are quality-of-life for me, real reliability for VAs in Cebu, Davao, and Iloilo where bandwidth is rougher than Metro Manila.

---

## 10. The deal-killer

For me personally, day-to-day: the missing **VA role**. I can work around the timezone (mental math), the language (glossary I'm building in a Notion doc), the org switcher (logout-login dance). I cannot work around the role gap. Every week my Phoenix client has to manually verify I haven't touched a tab I shouldn't have. He won't keep doing that. He'll either give me my own toolset (Pebble) or rotate me out for a US-based assistant. AcreOS will lose him as a customer because of a permission model that didn't anticipate me.

For AcreOS as a business: the language layer. Land Investors increasingly use offshore VAs — call it 30-40% of operators with $1M+ portfolios, growing fast. The first REI tool that ships **proper Spanish + Tagalog support, a glossary, per-user timezone, and an external-assistant role** captures that channel. None of the incumbents (Pebble, REI Reply, Podio, Launch Control) have done it. The window is open for maybe 18 months.

Six fixes, in order of impact-per-effort:

1. **`external_assistant` role** with the permission grid in §6 (1 sprint)
2. **`users.timezone` + dual-time display** when user TZ ≠ org TZ (3 days)
3. **Glossary tooltips** via `<TermTip>` + `glossary.json` of 80 terms (3 days)
4. **Org switcher in topbar** — kill the logout-login dance (2 days)
5. **Per-member activity log UI** at `/settings/team/:id/activity` (4 days)
6. **Plain-English mode** toggle in `HelpPanel` + AI system-prompt branch (2 days)

Two weeks of focused work. The VA channel opens up. The Manila Discord I'm in has 4,200 active members. We talk. Word travels.

— Reyna
