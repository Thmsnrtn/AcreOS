---
title: "Day 30 — Here's what changed since you signed up"
slug: day-30-trial-ended-no-conversion
template-id: outreach_day_30_trial_ended_no_conversion
persona: all 9 (persona-aware preview block; body operator-neutral)
audience: trial users whose trial ended 14–16 days ago, did not upgrade, downgraded to Free OR fully lapsed; still opted into product emails; not unsubscribed; not flagged data-delete
cadence: triggered — fires 16 days after `trial.ended` when `subscription.tier == 'free' OR null`; one send maximum; no fire if user has unsubscribed, requested data deletion, or has any `support.ticket` open
publish-status: draft (Phase 1 gated — see Beatrice check)
beatrice-reviewed: NEEDS-FOUNDER-REVIEW — CAN-SPAM postal address blocks live send until LLC at Phase 1; Constitution §2 (no manipulative urgency) and §10 (no marketing to vulnerable populations — distress signal screen) audited
truth-engine:
  - sources:
      - { name: "client/src/pages/landing/copy.ts (Pricing: Pro $41/mo billed annually; unlimited counties; BYOK)", ref: "/Users/user/AcreOS/AcreOS/client/src/pages/landing/copy.ts#L133" }
      - { name: "client/src/pages/landing/copy.ts (Pax mechanics: pulls comps, scores leads, drafts replies, books follow-ups, services notes)", ref: "/Users/user/AcreOS/AcreOS/client/src/pages/landing/copy.ts#L108" }
      - { name: "shared/business-types.ts (9 personas; core/beta/roadmap tiers)", ref: "/Users/user/AcreOS/AcreOS/shared/business-types.ts" }
      - { name: "docs/company/CONSTITUTION.md §2 (no dark patterns), §4 (cancel as easy as signup), §6 (no auto-charge), §10 (no marketing to vulnerable populations)", ref: "/Users/user/AcreOS/AcreOS/docs/company/CONSTITUTION.md" }
      - { name: "AcreOS public changelog / shipped-since-trial timeline (operator-visible in /changelog)", ref: "client/src/pages/changelog.tsx (or equivalent — actual changelog source resolved at send time)" }
ai-disclosure: "Drafted by Pax under Soren's direction. (AcreOS Constitution §7.)"
compliance-gate-notes: |
  FTC: no return promise; "what changed" is factual product changes since signup, not income claims.
  CAN-SPAM: subject non-deceptive; sender clearly identified; functional unsubscribe + data-deletion + preferences in footer; **physical postal address placeholder blocks live send until LLC at Phase 1.**
  Colorado SB 24-205: AI disclosure present.
  Constitution §2 (no dark patterns): no fake scarcity, no "your data will be deleted" pressure (data is NOT deleted on trial end — Free tier keeps everything).
  Constitution §4 (cancel as easy as signup): unsubscribe is one click; data-deletion is one click; the email does not bury either.
  Constitution §6 (no auto-charge): trial did not auto-convert; the email reinforces this fact.
  Constitution §10 (no marketing to vulnerable populations): one-and-done frequency cap; no repeat re-engagement after this single send unless the user takes an explicit action; no "you might be missing out" language.
  Constitution §11 (no get-rich content): "what changed" is mechanics, not "what you could earn."
  Voice: third-person mechanics; no founder voice; no "leverage," "vertical," "synergy."
  Banned references: zero — Land Geek / GeekPay / LG Pass / Mark Podolsky absent.
---

# Day 30 — Here's what changed since you signed up

## Subject

> What changed in AcreOS since your trial

(7 words. Factual — the platform has, in fact, changed since the recipient's trial. Non-deceptive. No fake urgency. No "we miss you," no "come back," no manipulative warmth.)

## Opening (specific trigger — variable per send)

> Your AcreOS trial ended `{{trial_ended_relative}}` and your account moved to Free. Your buy-box, your `{{parcel_count}}` saved parcels, your `{{lead_count}}` leads, and your audit log are still on the account. Pax is paused on Free; new county pulls are paused.

**Per-send variables:**

- `{{trial_ended_relative}}` — "sixteen days ago" formatted from `trial.ended` timestamp
- `{{parcel_count}}`, `{{lead_count}}` — integers from the user's workspace at send time

If `parcel_count + lead_count == 0`, the row is held — the recipient did not engage enough during trial for the data-retention message to land honestly. They receive no Day 30 send; the trial-end sequence is complete for them.

## Body

> The platform has shipped a few things since your trial started. Here is what is different, in case any of it changes the math for you:
>
> **`{{shipped_item_1_title}}`** — `{{shipped_item_1_one_liner}}`
> **`{{shipped_item_2_title}}`** — `{{shipped_item_2_one_liner}}`
> **`{{shipped_item_3_title}}`** — `{{shipped_item_3_one_liner}}`
>
> The full changelog is at acreos.io/changelog — every change with the date it shipped and the source code commit it lives in. AcreOS publishes the changelog because the product the recipient evaluated thirty days ago is not the product running today.
>
> The pricing has not changed. Pro is $41/month billed annually — full Pax assistant, unlimited counties, bring-your-own-key for the parcel-data and skip-trace costs every operator already pays. The platform does not mark up those external costs.
>
> The trial did not auto-charge a card. It does not now. The Constitution AcreOS operates under says the platform does not auto-charge without explicit, recent consent, and the trial-end path is the literal expression of that line.
>
> If the platform was not a fit — wrong vertical, wrong workflow shape, wrong stage of the operator's business — that is a clean answer and a useful one. The unsubscribe link below removes the recipient from product emails immediately. The account-deletion link closes the account and removes the data inside seven days. Both are one click. No "are you sure" sequence. No "please tell us why" survey gating the deletion. Both are in the AcreOS Constitution.

## Single CTA (with equal-weight downgrade path)

> If anything that shipped changed the math:
>
> **Upgrade to Pro →** `{{app_url}}/settings/billing?action=upgrade`
>
> If not, the platform respects that. The links to unsubscribe, manage preferences, or delete the account are in the footer; all three are one click.

(Per Constitution §4: cancel as easy as signup. The upgrade CTA is the primary action because the recipient already chose to remain on Free; offering it once is the platform's job. The off-ramps are equal-weight in the footer — same font, same color, same one-click directness.)

## Footer (mandatory)

> ---
>
> AcreOS · `{{LLC_POSTAL_ADDRESS_PLACEHOLDER}}` *(replaced with the registered LLC's physical address before live send — Phase 1 CAN-SPAM gate)*
>
> You're receiving this because you started a trial at acreos.io and opted into product emails. This is a one-time post-trial update; no further re-engagement emails fire unless you take an action. [Unsubscribe in one click]({{unsubscribe_url}}) · [Delete your account]({{app_url}}/settings/account/delete) · [Manage email preferences]({{prefs_url}})
>
> Drafted by Pax, AcreOS's AI assistant. (AcreOS Constitution §7.)

## Plain-text alternative (multipart/alternative)

```
What changed in AcreOS since your trial

Your AcreOS trial ended {{trial_ended_relative}} and your account
moved to Free. Your buy-box, your {{parcel_count}} saved parcels,
your {{lead_count}} leads, and your audit log are still on the
account. Pax is paused on Free; new county pulls are paused.

The platform has shipped a few things since your trial started.
Here is what is different, in case any of it changes the math:

  {{shipped_item_1_title}}
    {{shipped_item_1_one_liner}}

  {{shipped_item_2_title}}
    {{shipped_item_2_one_liner}}

  {{shipped_item_3_title}}
    {{shipped_item_3_one_liner}}

The full changelog is at acreos.io/changelog — every change
with the date it shipped and the source code commit it lives in.
AcreOS publishes the changelog because the product the
recipient evaluated thirty days ago is not the product running
today.

The pricing has not changed. Pro is $41/month billed annually —
full Pax assistant, unlimited counties, bring-your-own-key for
the parcel-data and skip-trace costs every operator already pays.
The platform does not mark up those external costs.

The trial did not auto-charge a card. It does not now. The
Constitution AcreOS operates under says the platform does not
auto-charge without explicit, recent consent.

If the platform was not a fit, that is a clean answer. The
unsubscribe link below removes the recipient from product
emails immediately. The account-deletion link closes the
account and removes the data inside seven days. Both are one
click. No "are you sure" sequence. No "please tell us why"
survey gating the deletion.

If anything that shipped changed the math, upgrade to Pro:
{{app_url}}/settings/billing?action=upgrade

If not, the off-ramps are in the footer; all three are one click.

---
AcreOS · {{LLC_POSTAL_ADDRESS_PLACEHOLDER}}

You're receiving this because you started a trial at acreos.io
and opted into product emails. This is a one-time post-trial
update; no further re-engagement emails fire unless you take
an action.

Unsubscribe: {{unsubscribe_url}}
Delete your account: {{app_url}}/settings/account/delete
Manage email preferences: {{prefs_url}}

Drafted by Pax. (AcreOS Constitution §7.)
```

## Persona-aware preview block (rendered above the body)

The preview line adapts to the user's primary business type. The body itself stays identical — operator-neutral by design.

| Persona               | Preview line                                                                       |
|-----------------------|------------------------------------------------------------------------------------|
| land_investor         | "Three things shipped since your trial. Your buy-box and parcels are still here."  |
| note_investor         | "Three things shipped since your trial. Your notes and borrower history are saved."|
| fix_and_flip          | "Three things shipped since your trial. Your properties and rehab tasks are saved."|
| residential_wholesaler| "Three things shipped since your trial. Your assignments and buyers list are saved." |
| tax_lien_deed         | "Three things shipped since your trial. Your redemption clocks are still tracked." |
| subdivider            | "Three things shipped since your trial. Your parcel edits and CC&Rs are saved."    |
| buy_and_hold          | "Three things shipped since your trial. Your properties and tenants are saved."    |
| note_originator       | "Three things shipped since your trial. Your origination pipeline is saved."       |
| note_servicer         | "Three things shipped since your trial. Your serviced notes are still tracked."    |

If `user.business_type` is null at send time, the preview line falls back to the land_investor variant.

## Shipped-items variable resolution

The three `{{shipped_item_N}}` placeholders are resolved per-send from a Beatrice-curated weekly "ship list" of changes since the recipient's trial date. The selection rules:

1. Items must have shipped strictly after the recipient's `signup_date`.
2. Items are prioritized by relevance to the recipient's `business_type` (note-investor changes surface for note_investor recipients; land-investor changes surface for land_investor recipients; cross-cutting changes surface for everyone).
3. Items must be linkable to a public changelog entry with a source-code commit reference. No undocumented "improvements"; no marketing fluff.
4. If fewer than three relevant items shipped since the trial date, the template suppresses to two items (or one); if fewer than one, the template does not fire.

## Hold conditions (do not fire)

- Recipient has unsubscribed at any point after trial → suppressed permanently.
- Recipient has requested data deletion → suppressed; account-deletion workflow has already run or is queued.
- Recipient has any open `support.ticket` → suppressed (sales-y email during an unresolved support issue is hostile).
- Recipient flagged for vulnerable-population signal per Constitution §10 (financial-distress flag, under-18 flag, disclosed crisis flag) → suppressed permanently.
- Recipient already received this template once → suppressed permanently (one-and-done; no re-engagement after this single send).
- Recipient upgraded after trial ended but downgraded again → suppressed (in-app billing surface owns the win-back; an email feels chasing).
- Trial ended more than 60 days ago → suppressed (the template's relevance window has closed; sending it later reads as desperate).

## Publish-readiness

**BLOCKED until Phase 1 LLC formation** for the CAN-SPAM postal-address reason. Body, voice, single-CTA-with-equal-weight-off-ramps, AI disclosure, frequency cap, vulnerable-population screen, and Constitutional commitments (no auto-charge, no dark patterns, easy off-ramp) are READY.

Additional gate before live send: Beatrice's weekly ship-list must be in place so the `{{shipped_item_N}}` variables resolve to factual, linkable changes. The template suppresses rather than firing with placeholders or generic copy.

When the LLC is registered AND the ship-list pipeline is wired: swap `{{LLC_POSTAL_ADDRESS_PLACEHOLDER}}` → registered address, Beatrice signs off on the inaugural send's three items, Solene confirms the rendered equal-weight off-ramps in Gmail and Apple Mail, the template ships through Resend on the `outreach_day_30_trial_ended_no_conversion` trigger.
