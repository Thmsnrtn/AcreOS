---
title: "Day 1 post-signup — Your buy-box is saved. Here's what runs overnight."
slug: day-1-buy-box-overnight
template-id: outreach_day_1_buy_box_overnight
persona: land_investor (default; Note Investor variant in §Variants)
audience: signed-up trial users on Day 1 with buy-box defined
cadence: triggered — fires 18-24 hours after `signup_completed` + `buy_box_saved` events, gated on `users.email_marketing_opt_in = true`
publish-status: draft (Phase 1 gated — see Beatrice check)
beatrice-reviewed: NEEDS-FOUNDER-REVIEW — CAN-SPAM postal address blocks live send until LLC at Phase 1
truth-engine:
  - sources:
      - { name: "client/src/pages/landing/copy.ts (Pax: pulls comps, scores leads, drafts replies, books follow-ups, services notes)", ref: "/Users/user/AcreOS/AcreOS/client/src/pages/landing/copy.ts#L112" }
      - { name: "client/src/pages/landing/copy.ts (Pricing: Pro $41/mo billed annually; unlimited counties; BYOK)", ref: "/Users/user/AcreOS/AcreOS/client/src/pages/landing/copy.ts#L133" }
      - { name: "shared/business-types.ts (Land Investor + Note Investor = core tier)", ref: "/Users/user/AcreOS/AcreOS/shared/business-types.ts" }
      - { name: "server/services/cmo/brandProfiles.ts (three-step mechanic)", ref: "/Users/user/AcreOS/AcreOS/server/services/cmo/brandProfiles.ts#L142" }
ai-disclosure: "Drafted by Pax under Soren's direction. (AcreOS Constitution §7.)"
compliance-gate-notes: |
  FTC: no investment-return claim; describes what the platform automates, not what the operator will earn.
  CAN-SPAM: subject is non-deceptive; identifies AcreOS clearly; unsubscribe link in every send; **physical postal address placeholder — required by 15 U.S.C. § 7704(a)(5). MUST be replaced with the registered LLC's physical address before any send goes live (Phase 1 gate).**
  Colorado SB 24-205 (effective 2026-02-01): AI disclosure present in the footer.
  Constitution §6 (no auto-charge without consent), §11 (no get-rich content): nothing in body promises returns or speed.
  Voice: third-person mechanics; no founder voice; no "leverage," "vertical," "synergy."
---

# Day 1 post-signup — Your buy-box is saved. Here's what runs overnight.

## Subject

> Your buy-box is saved. Here's what ran overnight.

(7 words. Non-deceptive. No curiosity-gap manipulation. Reflects exactly what the body describes.)

## Opening (specific trigger — variable per send)

> The buy-box you saved yesterday — `{{county_count}}` counties, `{{acreage_band}}` acres, `{{price_band}}` — is now active. Pax ran the first list pass overnight.

**Per-send variables:**

- `{{county_count}}` — integer from `buy_box.counties.length`
- `{{acreage_band}}` — "5 to 20" formatted from `buy_box.acreage_min`–`buy_box.acreage_max`
- `{{price_band}}` — "$1,500 to $25,000" formatted from `buy_box.price_min`–`buy_box.price_max`

If any variable is null at send time, the row is held — no generic fallbacks. The opener is specific or it doesn't fire.

## Body

> Here is what happened while you slept.
>
> Lists pulled: `{{lists_pulled_count}}` county exports refreshed against your buy-box.
> Parcels that passed the six filters: `{{candidate_count}}`.
> Parcels that failed (with the filter that killed each): `{{rejected_count}}`. Pax shows the rejection reason on every one — no parcel disappears silently.
> Comps run: `{{comps_run_count}}` parcels priced against recent county sale records.
> Mail drafts prepared: `{{mail_drafts_count}}` (each draft cites the comp set it used; nothing sends until you approve it).
> Reply drafts queued: `{{reply_drafts_count}}` (zero on Day 1 unless your prior outreach already brought a seller in).
>
> Every action Pax took is in the audit log on the parcel thread. Nothing happened behind your back.
>
> One thing the system cannot do: decide which parcels are worth mail money. That's the work you do this morning — open the candidate list, scan the rejection reasons, edit anything off, and approve the mail batch. That batch goes out on the schedule you set.
>
> The Constitution AcreOS operates under says Pax does not give investment advice. Pax surfaces data and offers suggestions; you make every decision about your money. Day 1 is when that line starts mattering in practice.

## Single CTA

> Want to see how AcreOS handles this in 30 seconds? Open the overnight queue → `{{app_url}}/today`

(One CTA. No "click here." No urgency.)

## Footer (mandatory)

> ---
>
> AcreOS · `{{LLC_POSTAL_ADDRESS_PLACEHOLDER}}` *(replaced with the registered LLC's physical address before live send — Phase 1 CAN-SPAM gate)*
>
> You're receiving this because you started a trial at acreos.io and opted into product emails. [Unsubscribe in one click]({{unsubscribe_url}}) · [Manage email preferences]({{prefs_url}})
>
> Drafted by Pax, AcreOS's AI assistant. (AcreOS Constitution §7.)

## Plain-text alternative (multipart/alternative — Resend / SES sends both)

```
Your buy-box is saved. Here's what ran overnight.

The buy-box you saved yesterday — {{county_count}} counties,
{{acreage_band}} acres, {{price_band}} — is now active.
Pax ran the first list pass overnight.

Here is what happened while you slept:

  Lists pulled: {{lists_pulled_count}} county exports refreshed.
  Parcels that passed the six filters: {{candidate_count}}.
  Parcels that failed: {{rejected_count}} (rejection reason on each).
  Comps run: {{comps_run_count}}.
  Mail drafts prepared: {{mail_drafts_count}} (cites comp set; nothing
  sends until you approve).
  Reply drafts queued: {{reply_drafts_count}}.

Every action Pax took is in the audit log on the parcel thread.
Nothing happened behind your back.

One thing the system cannot do: decide which parcels are worth mail
money. That is the work you do this morning — open the candidate list,
scan the rejection reasons, edit anything off, and approve the batch.

Pax does not give investment advice. Pax surfaces data and offers
suggestions; you make every decision about your money.

Want to see how AcreOS handles this in 30 seconds?
Open the overnight queue:
{{app_url}}/today

---
AcreOS · {{LLC_POSTAL_ADDRESS_PLACEHOLDER}}

You're receiving this because you started a trial at acreos.io
and opted into product emails.
Unsubscribe: {{unsubscribe_url}}
Manage email preferences: {{prefs_url}}

Drafted by Pax. (AcreOS Constitution §7.)
```

## Variants

**Note Investor variant** (sent when `user.business_type IN ('note_investor', 'hybrid')`):

- Subject: "Your note book is loaded. Here's the morning queue."
- Opener: "The note positions you imported yesterday — `{{note_count}}` active notes, `{{total_principal}}` outstanding — are now serviced by AcreOS."
- Body adjusts to: payments due today, missed-payment flags, dunning drafts queued, payoff requests received.
- Same CAN-SPAM footer; same single CTA pattern; same AI disclosure.

## Publish-readiness

**BLOCKED until Phase 1 LLC formation.** The CAN-SPAM postal-address requirement (15 U.S.C. § 7704(a)(5)) cannot be satisfied with a placeholder in a live send. The body, voice, CTA, and AI disclosure are READY; the legal-entity gate is the only remaining blocker.

When the LLC is registered, swap `{{LLC_POSTAL_ADDRESS_PLACEHOLDER}}` → the registered address, Beatrice signs off, and the template ships through Resend on the `outreach_day_1_buy_box_overnight` trigger.
