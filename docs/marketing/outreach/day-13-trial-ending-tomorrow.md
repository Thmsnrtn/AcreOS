---
title: "Day 13 trial — Tomorrow your trial ends. Two ways forward."
slug: day-13-trial-ending-tomorrow
template-id: outreach_day_13_trial_ending
persona: all 9 (Land Investor primary; one body, persona-aware preview block)
audience: trial users on Day 13 of a 14-day trial, no upgrade event yet, opted into product emails
cadence: triggered — fires 9:00 AM CT on the user's Day 13; one send maximum per trial; no fire after Day 13
publish-status: draft (Phase 1 gated — see Beatrice check)
beatrice-reviewed: NEEDS-FOUNDER-REVIEW — CAN-SPAM postal address blocks live send until LLC at Phase 1; in-app billing surface owns Day 14
truth-engine:
  - sources:
      - { name: "client/src/pages/landing/copy.ts (Pro $41/mo billed annually; full Pax; unlimited counties; BYOK)", ref: "/Users/user/AcreOS/AcreOS/client/src/pages/landing/copy.ts#L133" }
      - { name: "client/src/pages/landing/Pricing.tsx (Pro $41/mo billed annually)", ref: "/Users/user/AcreOS/AcreOS/client/src/pages/landing/Pricing.tsx#L56" }
      - { name: "phase-zero-two-content-runway.md (template #6 spec: Day 13; no data deletion on downgrade)", ref: "/Users/user/AcreOS/AcreOS/docs/marketing/phase-zero-two-content-runway.md" }
      - { name: "AcreOS Constitution §4 (cancellation as easy as signup) and §6 (no auto-charge without consent)", ref: "/Users/user/AcreOS/AcreOS/docs/company/CONSTITUTION.md" }
ai-disclosure: "Drafted by Pax under Soren's direction. (AcreOS Constitution §7.)"
compliance-gate-notes: |
  FTC: factual price + factual tier comparison; no return promise; no fake scarcity ("Tomorrow your trial ends" is a literal calendar fact, not manufactured urgency).
  CAN-SPAM: subject non-deceptive; sender clearly identified; unsubscribe + postal address; **placeholder blocks live send until LLC at Phase 1.**
  Colorado SB 24-205: AI disclosure present.
  Constitution §4 (cancellation easy as signup): the downgrade path is one CTA equal in weight to the upgrade path. The email does NOT favor upgrade visually or copy-wise.
  Constitution §6 (no auto-charge without consent): trial does not auto-convert. The email makes that explicit.
  Constitution §2 (no dark patterns): equal weight on both CTAs; no false scarcity language; no urgency that doesn't reflect the literal calendar.
  Voice: third-person mechanics; no founder voice; no SaaS jargon.
---

# Day 13 trial — Tomorrow your trial ends. Two ways forward.

## Subject

> Tomorrow your trial ends. Two ways forward.

(7 words. Factual — the trial does literally end tomorrow for every recipient. Non-deceptive. No curiosity gap, no fake scarcity.)

## Opening (specific trigger — variable per send)

> Your AcreOS trial ends `{{trial_end_date_pretty}}`. The data you've added since signup — `{{parcel_count}}` parcels, `{{lead_count}}` leads, `{{deal_count}}` deals in progress, the buy-box you tuned — stays with your account either way.

**Per-send variables:**

- `{{trial_end_date_pretty}}` — "tomorrow, June 3" (formatted from trial expiry timestamp)
- `{{parcel_count}}`, `{{lead_count}}`, `{{deal_count}}` — integers from the user's workspace at send time

If `parcel_count + lead_count + deal_count == 0`, this template does not fire; the user hasn't engaged enough for the data-retention message to land honestly.

## Body

> There are two ways forward. Both keep the data you've built.
>
> **Upgrade to Pro — $41/month billed annually.**
> Full Pax assistant. Unlimited counties on the buy-box. Bring-your-own-key for the parcel-data and skip-trace costs every operator already pays AcreOS does not mark up. Cancel any time; cancellation is one click — same number of clicks as signup. That is in the AcreOS Constitution.
>
> **Downgrade to Free — $0/month.**
> Free keeps your account, your buy-box, every parcel and lead and deal you've added, and read-only access to the audit log. Pax is paused. New county pulls are paused. The Pro features turn off. Nothing is deleted. If you upgrade later, the data is exactly where you left it.
>
> AcreOS does not auto-charge. Day 14 your trial ends, and no card is charged unless you explicitly upgrade. That is also in the Constitution.
>
> If neither option fits — if the platform isn't right for how you operate — the unsubscribe link below removes you from product emails immediately, and the data-deletion request page closes the account inside seven days. Both are one click.

## CTAs (equal weight — Constitution §4)

> **Upgrade to Pro →** `{{app_url}}/settings/billing?action=upgrade`
> **Downgrade to Free →** `{{app_url}}/settings/billing?action=downgrade`

(Two CTAs because the Constitution requires the downgrade path to be as easy as the upgrade path. Equal visual weight in the rendered email. Neither is bolder; neither is colored more strongly; neither comes first by manipulation — upgrade comes first only because it is the option more users select, and the order is consistent across every send.)

## Footer (mandatory)

> ---
>
> AcreOS · `{{LLC_POSTAL_ADDRESS_PLACEHOLDER}}` *(replaced with the registered LLC's physical address before live send — Phase 1 CAN-SPAM gate)*
>
> You're receiving this because you started a trial at acreos.io and opted into product emails. [Unsubscribe in one click]({{unsubscribe_url}}) · [Delete your account]({{app_url}}/settings/account/delete) · [Manage email preferences]({{prefs_url}})
>
> Drafted by Pax, AcreOS's AI assistant. (AcreOS Constitution §7.)

## Plain-text alternative (multipart/alternative)

```
Tomorrow your trial ends. Two ways forward.

Your AcreOS trial ends {{trial_end_date_pretty}}. The data you've
added since signup — {{parcel_count}} parcels, {{lead_count}} leads,
{{deal_count}} deals in progress, the buy-box you tuned — stays with
your account either way.

There are two ways forward. Both keep the data you've built.

UPGRADE TO PRO — $41/month billed annually.
Full Pax assistant. Unlimited counties on the buy-box.
Bring-your-own-key for the parcel-data and skip-trace costs every
operator already pays — AcreOS does not mark up. Cancel any time;
cancellation is one click — same number of clicks as signup.
That is in the AcreOS Constitution.

DOWNGRADE TO FREE — $0/month.
Free keeps your account, your buy-box, every parcel and lead and
deal you've added, and read-only access to the audit log. Pax is
paused. New county pulls are paused. The Pro features turn off.
Nothing is deleted. If you upgrade later, the data is exactly
where you left it.

AcreOS does not auto-charge. Day 14 your trial ends, and no card
is charged unless you explicitly upgrade. That is also in the
Constitution.

If neither option fits, the unsubscribe link below removes you
from product emails immediately, and the data-deletion request
page closes the account inside seven days. Both are one click.

Upgrade to Pro:
{{app_url}}/settings/billing?action=upgrade

Downgrade to Free:
{{app_url}}/settings/billing?action=downgrade

---
AcreOS · {{LLC_POSTAL_ADDRESS_PLACEHOLDER}}

You're receiving this because you started a trial at acreos.io
and opted into product emails.
Unsubscribe: {{unsubscribe_url}}
Delete your account: {{app_url}}/settings/account/delete
Manage email preferences: {{prefs_url}}

Drafted by Pax. (AcreOS Constitution §7.)
```

## Persona-aware preview block (rendered above the body)

Personalization adapts ONE preview line to the user's primary business type — the body itself stays identical. This is the only persona variation in the template; everything else is operator-neutral by design.

| Persona               | Preview line                                                              |
|-----------------------|---------------------------------------------------------------------------|
| land_investor         | "Buy-box, parcels, mail drafts — everything saved either way."            |
| note_investor         | "Notes, borrowers, payment history — everything saved either way."         |
| fix_and_flip          | "Properties, rehab tasks, deals in progress — everything saved either way."|
| residential_wholesaler| "Assignments, buyers list, deals in progress — everything saved either way."|
| tax_lien_deed         | "Redemption clocks, parcels, deals — everything saved either way."        |
| subdivider            | "Parcel edits, CC&R templates — everything saved either way."             |
| buy_and_hold          | "Properties and tenants — everything saved either way."                   |
| note_originator       | "Notes you've originated, payment streams — everything saved either way."  |
| note_servicer         | "Serviced notes, borrower contacts — everything saved either way."        |

If `user.business_type` is null at send time, the preview line falls back to the land_investor variant (default persona per the runway document).

## Publish-readiness

**BLOCKED until Phase 1 LLC formation** for the same CAN-SPAM postal-address reason as Day 1. Body, voice, dual-CTA equal-weight treatment, AI disclosure, and Constitutional commitments (no auto-charge, no dark patterns, easy cancellation) are READY.

When the LLC is registered: swap `{{LLC_POSTAL_ADDRESS_PLACEHOLDER}}` → registered address, Beatrice signs off, Solene confirms the equal-weight render in both Gmail and Apple Mail, the template ships through Resend on the `outreach_day_13_trial_ending` trigger. The in-app billing surface owns Day 14 and beyond.
