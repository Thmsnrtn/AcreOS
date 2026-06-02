---
title: "Day 5 — The mail draft Pax wrote for the parcel you opened"
slug: day-5-parcel-viewed-no-mail
template-id: outreach_day_5_parcel_viewed_no_mail
persona: land_investor (default; honest fallback if business_type differs — see §Variants)
audience: trial users on Day 5–7 who have opened a parcel detail view but not approved a mail piece
cadence: triggered — fires 24–48 hours after the most recent `parcel.viewed` event when no `mail.approved` event has fired against any parcel; one send maximum per trial; gated on `users.email_marketing_opt_in = true`
publish-status: draft (Phase 1 gated — see Beatrice check)
beatrice-reviewed: NEEDS-FOUNDER-REVIEW — CAN-SPAM postal address blocks live send until LLC at Phase 1
truth-engine:
  - sources:
      - { name: "client/src/pages/landing/copy.ts (Pax drafts replies; every action shown with the data it used)", ref: "/Users/user/AcreOS/AcreOS/client/src/pages/landing/copy.ts#L108" }
      - { name: "server/services/directMailService.ts (Lob postcard + letter pipeline; per-piece audit; nothing sends without operator approval)", ref: "/Users/user/AcreOS/AcreOS/server/services/directMailService.ts" }
      - { name: "server/services/preMailDedupe.ts (dedupe report: owned parcels, recent mail, returned-to-sender, do-not-contact)", ref: "/Users/user/AcreOS/AcreOS/server/services/preMailDedupe.ts" }
      - { name: "docs/company/CONSTITUTION.md §2 (no dark patterns; no manipulative urgency) and §7 (AI disclosure)", ref: "/Users/user/AcreOS/AcreOS/docs/company/CONSTITUTION.md" }
ai-disclosure: "Drafted by Pax under Soren's direction. (AcreOS Constitution §7.)"
compliance-gate-notes: |
  FTC: no return promise; no "this draft converts at X%." Describes mechanics of the draft and what the operator can do with it.
  CAN-SPAM: subject is non-deceptive; opener cites a real trigger event (specific parcel APN); unsubscribe + data-deletion + preferences in footer; **physical postal address placeholder — required by 15 U.S.C. § 7704(a)(5). MUST be replaced with the registered LLC's physical address before live send (Phase 1 gate).**
  Colorado SB 24-205 (effective 2026-02-01): AI disclosure in footer.
  Constitution §2: no manufactured urgency ("Pax drafted a piece" is a literal mechanical fact, not a scarcity claim).
  Constitution §7: AI disclosure tag present.
  Constitution §12: operator decides — body explicitly says "nothing sends until you approve."
  Voice: third-person mechanics; no founder voice; no "leverage," "vertical," "synergy."
  Banned references: zero — Land Geek / GeekPay / LG Pass / Mark Podolsky absent.
---

# Day 5 — The mail draft Pax wrote for the parcel you opened

## Subject

> The mail draft Pax wrote for [APN]

(6 words. Cites the actual parcel APN from the user's most recent `parcel.viewed` event. Non-deceptive — there is in fact a drafted mail piece for that parcel. No curiosity gap; the operator already knows what APN was opened.)

## Opening (specific trigger — variable per send)

> You opened the parcel at `{{parcel_apn}}` in `{{county_name}}` `{{viewed_date_relative}}`. Pax drafted a mail piece against the comp set on that parcel. It is queued for your approval — it has not been sent.

**Per-send variables:**

- `{{parcel_apn}}` — the parcel's assessor parcel number, formatted with hyphens per county convention
- `{{county_name}}` — county the parcel is in, e.g., "Hamilton County, TX"
- `{{viewed_date_relative}}` — "three days ago" formatted from the `parcel.viewed` event timestamp

If any variable is null at send time, the row is held — no generic fallbacks. If multiple parcels were viewed in the trigger window, the most recently viewed parcel is selected. The opener references one specific parcel or it does not fire.

## Body

> Here is what is in the draft.
>
> **Comp set used:** `{{comp_count}}` recent sales within `{{comp_radius_miles}}` miles of the parcel, similar acreage band, similar road access. The data trace lists each comp and the platform's confidence band.
>
> **Offer level Pax drafted:** `{{offer_band_low}}` to `{{offer_band_high}}`. The band reflects the comp confidence; Pax does not pick a single number when the comp set spans a range. The operator picks the number inside the band.
>
> **Recipient resolution:** the owner of record on the parcel as of the most recent county refresh. The mailing address pulled from the recorder data; the dedupe scanner has already checked the address against your owned parcels, your recent-90-day mail history, your returned-to-sender list, and your do-not-contact flags. The dedupe report says the recipient is mailable.
>
> **What Pax cannot do:** decide whether the comp set is right, decide whether the offer level fits your buy-box on this parcel, decide whether the parcel is worth mail money this week. Those are decisions you make in twenty seconds in the draft view.
>
> Nothing sends until you approve. The platform does not auto-send mail; that is in the AcreOS Constitution and code-enforced in the send pipeline.
>
> If the parcel was an exploration — opened to look at the comp data, not to mail — that is a useful answer too. The platform tracks both decisions equally. Approving the draft sends the mail; declining the draft tells Pax this parcel was not a fit, and the rejection reason informs how Pax prioritizes the next parcels it surfaces.

## Single CTA

> Review the draft → `{{app_url}}/deals/{{parcel_id}}/mail-draft`

(One CTA. Direct link to the draft. No urgency. No "act fast." No "limited time.")

## Footer (mandatory)

> ---
>
> AcreOS · `{{LLC_POSTAL_ADDRESS_PLACEHOLDER}}` *(replaced with the registered LLC's physical address before live send — Phase 1 CAN-SPAM gate)*
>
> You're receiving this because you started a trial at acreos.io and opted into product emails. [Unsubscribe in one click]({{unsubscribe_url}}) · [Delete your account]({{app_url}}/settings/account/delete) · [Manage email preferences]({{prefs_url}})
>
> Drafted by Pax, AcreOS's AI assistant. (AcreOS Constitution §7.)

## Plain-text alternative (multipart/alternative — Resend / SES sends both)

```
The mail draft Pax wrote for {{parcel_apn}}

You opened the parcel at {{parcel_apn}} in {{county_name}}
{{viewed_date_relative}}. Pax drafted a mail piece against the
comp set on that parcel. It is queued for your approval — it
has not been sent.

Here is what is in the draft:

  Comp set used: {{comp_count}} recent sales within
  {{comp_radius_miles}} miles, similar acreage band, similar
  road access. Data trace lists each comp and confidence band.

  Offer level Pax drafted: {{offer_band_low}} to {{offer_band_high}}.
  The band reflects the comp confidence; Pax does not pick a
  single number when the comp set spans a range. The operator
  picks the number inside the band.

  Recipient resolution: owner of record per the most recent
  county refresh. Dedupe scanner has checked the address
  against your owned parcels, recent 90-day mail, returned
  mail, and do-not-contact flags. Recipient is mailable.

What Pax cannot do: decide whether the comp set is right,
whether the offer level fits your buy-box on this parcel,
whether the parcel is worth mail money this week. Those are
your decisions, twenty seconds in the draft view.

Nothing sends until you approve. The platform does not
auto-send mail; that is in the AcreOS Constitution and
code-enforced in the send pipeline.

If the parcel was an exploration, that is a useful answer too.
The platform tracks both decisions equally. Approving the
draft sends the mail; declining the draft tells Pax this
parcel was not a fit.

Review the draft:
{{app_url}}/deals/{{parcel_id}}/mail-draft

---
AcreOS · {{LLC_POSTAL_ADDRESS_PLACEHOLDER}}

You're receiving this because you started a trial at acreos.io
and opted into product emails.
Unsubscribe: {{unsubscribe_url}}
Delete your account: {{app_url}}/settings/account/delete
Manage email preferences: {{prefs_url}}

Drafted by Pax. (AcreOS Constitution §7.)
```

## Variants

**Note investor variant** (fires when `user.business_type IN ('note_investor', 'hybrid')` and the trigger was a `note.viewed` event on a note marketplace listing rather than a parcel view):

- Subject: "The diligence brief Pax drafted for Note #[note_id]"
- Opener: "You opened the note listing for `{{note_id}}` `{{viewed_date_relative}}`. Pax drafted a diligence brief against the payment history and the borrower profile on that note."
- Body adjusts to: yield calculation, payment-history summary, borrower contact-history summary, what Pax does not decide (whether to buy the note).
- Same single CTA pattern, same AI disclosure, same CAN-SPAM footer.

**Hold conditions (do not fire):**

- If the trigger parcel was already mail-approved → template suppressed (the next-step email already fired).
- If the trigger parcel has been deleted from the workspace since the view → template suppressed (the user has answered "no" already).
- If the trial has already passed Day 13 → suppressed (Day-13 template owns the late-trial window).
- If a previous send of this template fired in the last 14 days → suppressed (frequency cap).

## Publish-readiness

**BLOCKED until Phase 1 LLC formation.** The CAN-SPAM postal-address placeholder cannot satisfy 15 U.S.C. § 7704(a)(5) in a live send. Body, voice, single-CTA, per-send variable discipline, and AI disclosure are READY.

When the LLC is registered: swap `{{LLC_POSTAL_ADDRESS_PLACEHOLDER}}` → registered address, Beatrice signs off, the template ships through Resend on the `outreach_day_5_parcel_viewed_no_mail` trigger. Suppression rules wired through PostHog event suppression and `users.unsubscribed_at` check on every send.
