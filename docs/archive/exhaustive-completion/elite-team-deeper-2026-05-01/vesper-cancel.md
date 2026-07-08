# Vesper Allerton — three weeks gone, here's what the cancel button actually felt like

I'm Vesper. Thirty-eight. Marin County. I bought desert acreage in Lincoln County, Nevada and ranchettes outside of Santa Fe for about four years before I decided land investing wasn't the second income I wanted it to be. I was on AcreOS Scale at $79/mo from August through April. **I cancelled three weeks ago.** I'm coming back to leave a review of the door on the way out, because the front door of this product was the most polished thing I'd ever onboarded into and the back door felt like it was bolted shut from the inside with a Post-it that said "are you sure?" taped to it.

Let me be honest up front: I am not angry at AcreOS. I am mildly, specifically, unforgivingly annoyed. There's a difference. The product is good. The exit is bad in the small ways that people remember.

---

## 1. The 90-second version

I clicked **Cancel subscription** on April 8th at roughly 9:14 PM PT. I clicked **Reactivate, here's $40 off** zero times because that email never came. I have, as of writing this, been billed for nothing further and **I also have not received a confirmation email that my cancellation processed.** The only proof I cancelled is a URL parameter — `/settings?cancelled=true` — that flashed for a half-second when Stripe punted me back. I've been living on a screenshot of my browser window for three weeks.

What I did get from the exit experience:

- A two-step modal with five canned reasons and a 3-row textarea.
- A handoff to the Stripe customer portal, which is fine, except it's the **billing** portal, not a cancel-confirmation surface — and Stripe's portal styling does not match AcreOS's, so for a moment I thought I'd been phished.
- A vague promise that "Your data will be preserved" with **no timeline, no export prompt, no "want a copy of your stuff before you go?" button.**
- Zero retention offer. Zero downgrade-saver pricing. Zero "let's pause for 60 days." A `Downgrade instead` button that just *closed the modal* and dumped me back at the settings page to figure it out myself.
- No exit interview follow-up email. No win-back. No "we miss you." Nothing. Three weeks of total silence from a product that emailed me four times a day when I was paying.

I'm going to itemize because that's how I think.

---

## 2. The cancel modal itself

Found it under Settings → Billing → "Cancel subscription" link, small, gray-on-gray, below the fold, which is fine — I don't expect a glowing exit. But once I clicked, here's what `client/src/components/cancellation-dialog.tsx` actually does:

**Step 1 — Reason.** Five radio buttons:
- Too expensive for my needs
- I'm not using it enough
- Missing features I need
- Switching to another tool
- Other reason

I clicked "I'm not using it enough." That was the truest one. I had stopped pulling deals in February and was paying $79 for a CRM I opened twice a month to look at parcels I'd already closed.

**Then there's a usage panel.** Pulled from `/api/subscription/cancellation-context`. It showed me my usage this month: "leads: 3 / 1000," "skipTraces: 0 / 50," "campaigns: 0 / 10." That's a real punch in the face, and I respect it. **You showed me, in numbers, that I was paying $79 for almost nothing.** Honest move. I appreciated it. But — and this is the thing — *that data is the retention pitch you didn't make.* You showed me I wasn't using it. You did not then say *"would you like to pause for 90 days at $0?"* or *"would Sprout at $19/mo fit your usage?"* You just let the numbers sit there like a verdict and let me click **Continue to cancel**.

The "Downgrade instead" button. I'm staring at the code now and I see what it does — it calls `handleClose`. **It just closes the modal.** It doesn't take me to the plan picker. It doesn't pre-select a lower tier. It doesn't even set a query param. It exits the modal and leaves me on `/settings`, where I now have to find the upgrade/downgrade UI on my own. *I literally tried that button first.* I assumed it would surface a Sprout option. It surfaced nothing. So I closed the dialog, looked around for thirty seconds, gave up, opened the dialog again, and clicked the destructive red button. **Your "downgrade instead" CTA actively pushed me toward cancellation by being broken.** I'm not exaggerating. I had the intent to downgrade. The button extinguished it.

**The feedback textarea.** Three rows. Optional. Placeholder: "Any additional feedback? (optional)" I typed: *"I love the product but I'm not closing deals right now. Would have stayed on a smaller plan if it existed."* I have no idea if anybody ever read that. There was no acknowledgment, no auto-reply, no "thanks, we hear you." The string went into a `cancellationSurveys` table somewhere — `shared/schema.ts` confirms it does — and that's the last anyone has spoken of it. I would have stayed for $19/mo. **You had that information in a database row before I even confirmed the cancellation.** Nobody acted on it.

**Step 2 — Confirm.** A new modal screen with the line: *"Your subscription will remain active until the end of your current billing period. Your data will be preserved, and you can re-subscribe at any time."* Two buttons: "Go back" and "Confirm cancellation." I clicked confirm. Spinner for ~3 seconds. Redirect to Stripe.

---

## 3. The Stripe handoff

This is the moment I almost called my bank. The button posted to `/api/subscription/cancel`, which (per `server/routes-billing.ts:739`) inserted my reason into the survey table and returned `{ portalUrl }` — a Stripe customer portal URL. The browser yanked me to `billing.stripe.com/p/session/...` with a different favicon, different chrome, no AcreOS logo, no breadcrumb back, **and the Stripe page did not say "cancel."** It said "Manage your subscription." I had to click into the subscription, find a "Cancel plan" link in *Stripe's* UI, click it, get *Stripe's* "Are you sure?" modal with *Stripe's* own retention copy ("If you change your mind..."), confirm again, *and only then* did anything actually cancel.

**That's three confirmation screens across two domains for one cancel intent.** Friction is fine when it saves a customer. This was friction that just made me feel like AcreOS didn't trust me to mean it.

The redirect back was to `/settings?cancelled=true`. The `cancelled=true` query param does — as far as I can tell — *nothing visible.* No banner. No toast. No "we got it, here's your final bill date, here's how to download your data." It just dropped me back at the settings page. I refreshed. The plan badge said "Scale" still. I had to wait for a Stripe webhook to fire (`server/webhookHandlers.ts`, I'm guessing) before the badge changed to "Cancelled — active until May 8." That took **about four minutes.** During those four minutes I was convinced the cancellation hadn't worked.

---

## 4. The email that never came

I have a Gmail filter for `from:acreos.io`. While I was a paying customer it caught roughly 18 emails a week — daily deal feed, weekly digest, "Pax has a new lead for you," billing receipts, product update notes. After I clicked the final Stripe confirmation:

- **No cancellation confirmation email.** Not from AcreOS, not from Stripe directly to me. Stripe sent the *billing* receipt for my final period (which I'd already paid). It did not send a cancellation confirmation. AcreOS sent nothing.
- **No "your final access date is May 8" reminder.** I had to dig into the Stripe portal to learn this.
- **No data-export prompt.** I have 47 leads, 12 closed deals, 4 contracts-for-deed signed natively in your e-sign stack, and a folder of skip-trace results I paid for in credits. *None of those triggered an "export before you go" CTA.* I know `/api/privacy/export` exists (`server/routes-gdpr.ts`). I know `generateFullExport` exists in `server/services/dataPortability.ts`. **You never told me.** I had to click around in Settings → Privacy on Day 4 and find it myself.
- **No "your data will be retained for X days, then deleted" notice.** The cancel modal said "Your data will be preserved" with no expiration, which is somehow worse than a date — it implies "forever, trust us" which nobody in 2026 trusts. I want a number. *90 days. 12 months. 7 years.* Pick one. Tell me.

---

## 5. The final-month billing thing

I cancelled April 8. My billing date was the 8th of every month. **I was billed in full on April 8th** for the period April 8 – May 8. That is — fine? Industry-standard? But the cancel modal said "remain active until the end of your current billing period" and I read that as "you won't be billed again," which is what it means in context, but I had a moment of pure panic when I saw the $79 charge land on April 8 because I'd cancelled *the same day.* The charge was for the period I was about to stop using. I reread the Stripe email three times. I checked my account dashboard. The plan badge said "Cancelled — active until May 8." So it was the right charge, just the worst possible timing.

**A simple line in the cancel modal would have fixed this.** Something like: *"You'll keep access through May 8, 2026. You won't be billed again after today."* Instead I got vibes. Vibes are not what I want from a billing flow.

---

## 6. The retention attempt that wasn't

I keep coming back to this because it's the single biggest gap. AcreOS knows, programmatically, in the same React component, that:

- I was on Scale at $79/mo
- I had used **3 leads this month out of 1000**
- I had used **0 skip-traces, 0 campaigns**
- My reason was "not using it enough"
- A Sprout tier exists for less money

The math for a save offer is sitting *right there in the same modal*. The pre-cancellation context endpoint returns `currentTier`, `usage`, and `memberSince`. Three datapoints away from a personalized offer. **It made no offer.** It didn't say "based on your usage, you'd save $60/mo on Sprout." It didn't say "pause for 60 days, free." It didn't say "here's a promo code: COMEBACK40." It didn't even ask "would a different plan work?"

The closest thing was that broken "Downgrade instead" button that just closed the dialog. That is — and I'm being measured here — **absolutely not a retention strategy.** That is a retention *vestige*. Somebody intended to build retention there and shipped a closed-state shortcut instead, and now every cancel goes through a flow with the appearance of a save attempt and the reality of zero save attempts. I'd argue this is worse than no save flow at all, because it lets the team feel like they have one.

---

## 7. The post-cancel silence (3 weeks of it)

I don't know what I expected. Maybe I expected nothing. But I'd watched my inbox light up for eight months from this product, and the moment I cancelled, **complete silence.** Three weeks. No "we miss you, here's a thought" email at the 7-day mark. No "your data is here if you want to come back" at the 14-day mark. No "your account is scheduled for archival in 30 days" at the 21-day mark. *Nothing.*

This is the part that actually makes me sad rather than annoyed, because I genuinely liked AcreOS. The product is the best CRM I've used for parcel-centric work. The Pax assistant is good. The deal feed is good. If somebody had emailed me on Day 10 and said *"Hey Vesper, we noticed you cancelled because you weren't using it enough — would a free pause for 90 days help? Your data and pipeline stay intact, you don't pay anything, when you're ready to deal again you flip a switch,"* I would have said yes immediately. **You didn't even try.** A win-back loop costs you cents per email and I'd guess converts at 3-8% on cancellers in my exact reason bucket. You left that money on the table for me, and I assume for everyone else.

---

## 8. What was actually infuriating, ranked

In strict order of how much it stuck with me:

1. **The "Downgrade instead" button does nothing.** This is the single highest-conversion moment in the cancel funnel and it is silently broken. Every customer who clicks it and then gives up and clicks the destructive button is a save you literally fumbled in code. Fix this by Friday. `client/src/components/cancellation-dialog.tsx:136` — wire it to navigate to `/settings?upgrade=true&prefer=sprout` or open the plan picker inline.
2. **No cancellation confirmation email.** I should not be relying on a screenshot of a query parameter as proof I'm not on the hook for $79 next month. Send the email. Include the final access date. Include a one-click data export link.
3. **No retention offer based on the data you already have.** You showed me I wasn't using it. You then watched me leave. Run the numbers, surface a tier match or a pause, and ask.
4. **No data-export prompt at any point in the cancel flow.** I had to find `/api/privacy/export` myself. The flow should have a *"Download your data"* CTA on Step 2 of the modal, full stop.
5. **The Stripe portal handoff is jarring and untrusted-feeling.** Either keep cancel inside AcreOS UI and call `stripe.subscriptions.update({ cancel_at_period_end: true })` directly from `/api/subscription/cancel`, or at least co-brand the Stripe portal session with your logo and primary color (Stripe supports both via `customer_portal` configuration).
6. **"Your data will be preserved" with no number.** Tell me 90 days, 12 months, forever, whatever. Just say a number. The vagueness made me less likely to come back, not more, because I assume "preserved" means "in a backup somewhere I'll never see again."
7. **No win-back outreach in 21 days.** Industry-standard cadence is Day 3, Day 14, Day 30, Day 90. You sent zero. I'm not sure if you have an email list of cancellers you're not mailing or no list at all. Both are bad.
8. **Final-month billing language was unclear in the cancel modal.** One sentence, ten words, fixes this.
9. **The cancellation survey feedback textarea is fire-and-forget.** No acknowledgment. No "a real person reads this." I gave you the exact pricing intel that would have saved my account and it lives in a database row nobody has read.
10. **The destructive button is `variant="destructive"` red.** Fine, but combined with everything else it's the only button on the screen that looks decisive. Of course people click it. Of course they cancel. That's a UX outcome, not a customer choice.

---

## 9. The data-retention promise, examined

I want to spend a paragraph on this because it is the thing that will determine whether I come back, and I suspect I am not the only one. The cancel modal said: *"Your data will be preserved, and you can re-subscribe at any time."* That sentence is doing a lot of work and almost none of it is honest work.

What does "preserved" mean? Does it mean:

- My organization row stays in `organizations`, my `subscriptionStatus` flips to `cancelled`, and my `subscriptionTier` drops to `free`, and I lose access to the data via tier gating but the rows are still there? (I think this is what's actually happening, based on the refund handler I read in `routes-billing.ts:866-887`.)
- My data is moved to a cold-storage tier and I have to email support to thaw it?
- My data is purged after some retention window I'm not told?
- My data lives forever, billed to nobody, costing AcreOS some fraction of a cent per row per month indefinitely?

I read the nightly data-retention job in `server/index.ts:2276-2295`. It calls `processDataRetentionJob` and purges "expired rows." I have no idea if cancelled-org rows count as expired. I don't think they do? But I'm guessing. **A customer should not have to read your cron job to figure out what happens to their leads.** Tell me, in the cancel modal, in plain words: *"We keep your data for 12 months after cancellation, then delete it. You can export it anytime from Settings → Privacy. After 12 months, it's gone."* That sentence — those 30 words — would have done more for my long-term trust than the entire current cancel flow combined.

The other piece: **the lack of a delete-my-data-now option.** GDPR-style. There's a `/api/privacy/export` route. I assume there's a delete counterpart somewhere in `routes-gdpr.ts` but I didn't dig hard enough to confirm. It's not surfaced anywhere in the cancel flow. If I were a paranoid customer leaving for a privacy reason — I'm not, but somebody is — I'd have nowhere to click. The cancel and the privacy-delete are separate concepts and they should both be one click away from the cancel confirmation screen, side by side.

---

## 10. Things I noticed that are actually fine

To be fair, because this isn't a hit piece:

- **The radio reasons are well-chosen.** "Too expensive / not using / missing features / switching / other" — that's the right taxonomy. I picked the right one easily.
- **The two-step confirm is correct.** Cancel-then-confirm is the right shape; the issue is what happens *between* the steps, not the steps themselves.
- **The mutation handles error nicely.** `onError` shows a destructive toast that says "your reason and feedback are preserved," which is the right reassurance copy. I never hit it, but I read the code and it's well done.
- **The accessibility is real.** `aria-labelledby`, `aria-busy`, `sr-only` — somebody cared about screen readers in this dialog. That's rare in cancel flows. Credit where it's due.
- **Stripe handles the actual money correctly.** No double-charges. No prorated weirdness. Final billing is clean.
- **The cancellation didn't actually fail.** It worked. I am cancelled. I am not being billed. The mechanism works. Everything around the mechanism is what I'm complaining about.

---

## 11. What would have made me stay

A single email, eight days in: *"Vesper — we saw your usage drop off in February. Want to pause your account for 90 days at $0? Your data stays, your pipeline stays, you flip a switch when you're back to dealing. No questions, no upsell."* I would have clicked that button. I am the easiest save you have. Active, technical, knows the product, just temporarily out of the market.

Or, frankly — at the moment of cancellation — *"Based on your usage (3 leads / 1000 used), Sprout at $19/mo would cover everything you actually do. Switch instead?"* I would have switched. It is not a hard pitch. The data was on the same screen as the cancel button.

You'll hear from me again when I'm dealing again. Probably in the fall, after harvest and after the BLM auctions in Reno. I'll be back because the product is good. I won't be back because of the exit experience. I'll be back **in spite of it.** Worth knowing the difference.

— Vesper Allerton, ex-Scale, paid through May 8, 2026
