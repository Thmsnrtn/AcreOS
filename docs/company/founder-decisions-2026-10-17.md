# Founder decisions — 2026-10-17

**Date:** 2026-10-17

**Source:** the founder's instructions in the coordinating session of
2026-10-17 ("Make it official"; "I should never be in the red for offering
mailer service"), relayed to the implementing session, which built them on
`claude/house-mail-option`. This record was written by the implementing
session from that relay; it did not see the conversation itself. Only the
founder can rescind it.

## A. AcreOS house mail: a second lane for PHYSICAL mail

**Scope: physical mail only** — postcards and letters printed and posted to a
customer's counterparties (sellers, owners, borrowers). Counterparty **email
and SMS stay strictly BYO**: they go out only on the org's own connected
identity (the 2026-07-17 send-rail ruling, unchanged; `emailService` purpose
lanes, `smsService` `requireByoIdentity`).

A customer's printed mail goes out on exactly one of two lanes:

1. **Their own Lob (or PostGrid) key — no credits.** The provider bills the
   org directly. AcreOS charges nothing, never touches its own provider
   account for the piece (address verification included), and posts nothing
   to its opex ledger.
2. **AcreOS house mail — purchased credits.** The piece prints on AcreOS's own
   Lob account and is paid in credits under decision B.

**Identity requirement.** Every house piece carries the **org's own verified
sender identity** (its `mail_sender_identities` row, Lob-verified, active) as
its return address. A house piece with no verified identity is refused before
anything is charged or sent; the return address on a house piece is always
that identity, never AcreOS's and never free text.

**Neither lane available** (no own key, and no verified identity, no house
account, an unpriced spec, or not enough purchased credits) → an honest
refusal in plain words that names both ways forward (buy credits / connect
your own Lob key). Nothing prints and nothing is charged.

PostGrid is own-key only: house mail is Lob. The platform PostGrid key is not
used for customer mail.

## B. House mail is self-funding: purchased credits only, pre-paid, at a price that covers the cost

> "I should never be in the red for offering mailer service."

- **Funded ONLY from purchased credits** — credits bought as packs at
  `CREDIT_PRICE_CENTS` (1.5¢, `shared/billing/credit-packs.ts`), mail
  recharges and card top-ups, held in `organizations.credit_balance`. Never
  from the included monthly credit pool, a trial allowance, a sponsor pool or
  any grant. Granted credits that sit in the same balance (support courtesy
  credits, bonuses) are excluded: house mail may spend only
  `balance − every credit ever granted` (`mailLane.purchasedCreditsAvailable`),
  so the total of all house charges can never exceed what the org paid for.
  There is no founder or tier bypass.
- **Pre-paid.** Every piece is debited — atomically, in one transaction with
  its idempotent claim — before Lob is called. No send without a completed
  debit; the same charge key is never charged twice.
- **A price that covers AcreOS's real cost.** For every spec AcreOS prints:

  `credits charged × CREDIT_PRICE_CENTS ≥ provider cost × (1 + card-fee allowance) × (1 + margin floor)`

  - card-fee allowance **5.9%** — Stripe's worst case on the smallest pack
    ($10: 2.9% + 30¢ = 59¢);
  - margin floor **10%**, founder-adjustable
    (`HOUSE_MAIL_MARGIN_FLOOR` in `shared/billing/house-mail-pricing.ts`).
- **One cost table** (`HOUSE_MAIL_COST_TABLE`) is the single source of what a
  piece costs AcreOS; the COGS ledger posting reads it too. Each row takes the
  highest Lob cost the repo already recorded for that spec, and is
  founder-settable without a deploy (`founder_settings`
  `mail.house.cost_cents.{spec}`, the same mechanism as the credit weights):

  | Spec | Provider cost | Listed credits (weight) | Charged | Minimum that passes |
  |---|---|---|---|---|
  | 4×6 postcard | 75¢ | 75 (`postcard_lob`) | 75 | 59 |
  | 6×9 postcard | 95¢ | 75 (`postcard_lob`) | 75 | 74 |
  | 6×11 postcard | 110¢ | 75 (`postcard_lob`) | **86** | 86 |
  | Letter, 1 page, B&W | 120¢ | 120 (`letter_lob`) | 120 | 94 |
  | Letter, 1 page, colour | 120¢ | 120 (`letter_lob`) | 120 | 94 |

  The campaign send lists its own prices (`DIRECT_MAIL_COSTS`: 4×6 75, 6×9 95,
  6×11 115, 1-page letter 125); every one passes, so none changed.
- **The only price change:** a house **6×11 postcard sent outside the campaign
  send** (the per-piece lanes listed at the `postcard_lob` weight) fails the
  rule at 75 credits (112.5¢ against 128.1¢ required) and is raised to the
  minimum that passes, **86 credits**. This applies the founder's own rule; it
  is not a new price decision. The raise is computed, not hard-coded
  (`houseMailCreditsPerPiece`): if a cost or weight is recalibrated, the floor
  follows.
- **Unknown spec → refused, never guessed**: a mail class other than USPS
  First Class, any extra service (certified, registered), a letter of more
  than one page, or a postcard size outside 4×6 / 6×9 / 6×11.
- **Refunds only for pieces Lob did not bill.** A charge is returned only when
  Lob was never contacted or answered with a rejection status (4xx). A
  timeout, a network error or a 5xx may be a printed piece: its charge stands
  and it is logged for reconciliation.

## What this supersedes

- The 2026-07 / 2026-08 notes that the founder had **deferred** "removing the
  platform Lob fallback" (`lobService.ts` header,
  `tests/unit/lobCredentialAuthority.test.ts`,
  `docs/testing/verification-plans/04-messaging-sandboxes.md`). The platform
  Lob key is no longer a silent fallback: for an org's mail it is reachable
  only on the house lane, which is pre-paid from purchased credits and
  requires the verified identity.
- For house mail, D4 of 2026-07-11 (a free-tier org's first send rides a free
  allowance booked as acquisition COGS) and the outreach queue's draw on the
  monthly credit pool: both are grants, which decision B excludes. A free-tier
  org can still mail on its own Lob key, or on house mail with purchased
  credits; the free-tier piece cap is unchanged.

## How it is enforced

- **Pricing rule:** `shared/billing/house-mail-pricing.ts`
  (`HOUSE_MAIL_COST_TABLE`, `houseMailChargeIsSelfFunding`,
  `houseMailCreditsPerPiece`). `tests/unit/houseMailSelfFunding.test.ts`
  iterates the whole table against the inequality, with canary rows that must
  fail.
- **One lane authority:** `server/services/mail/mailLane.ts`
  (`resolveMailLane` / pure `decideMailLane`): own key first, else house
  (verified identity + priced spec + house account), else refused.
  `chargeHouseMail` is the purchased-only atomic debit;
  `refundUnbilledHouseMail` the only refund path.
- **One credential authority:** `directMailService.getOwnLobClient` (BYOK
  vault → legacy integration row; never the platform key) and
  `getLobClientForLane` (the platform key only for a house lane).
- **Every send site uses it:** `directMailService` (router-sent pieces:
  outreach queue, sequences), `directMail.ts` (campaign sends, API queue),
  `lobService` (communications), `mailProvider` (autopilot `send_letter`), the
  PostGrid adapter, the outreach queue route and the campaign send route.
  There is no Pax `send_direct_mail` executor (only a skill-permission entry).
  `tests/unit/physicalMailLanePopulation.test.ts` enumerates every Lob /
  PostGrid send and verification primitive in `server/` and fails when a file
  that sends does not resolve a lane.
- **Behaviour:** `tests/unit/houseMailLane.test.ts` (lanes, identity,
  own-key isolation, refunds) and `tests/unit/houseMailPurchasedOnly.test.ts`
  (against Postgres: grants and the pool never pay, the debit is atomic and
  idempotent). `tests/unit/emailPurposeEnforcement.test.ts` keeps email BYO.
- **Registry:** `shared/governance/constitution.ts`, entry
  `rails.byo-not-refront`; CLAUDE.md DO-NOT-DO list.
- **Surfaces (behind existing doors):** Settings → Your provider keys
  (Print & mail), the mail composer and the campaign send dialog show the
  lane, the per-spec credits and the purchased balance from
  `GET /api/outreach/mail/lane`, with "Buy credits" when the balance is short.

## Open for the founder

See the implementing session's report for the full list. In short: card
top-ups grant 1 credit per 1¢ paid (not 1.5¢), so a top-up-funded house piece
earns less than the rule assumes; letters of unknown page count are priced as
one page; Lob address verification on AcreOS's account is uncharged; and the
campaign send keeps its own price list.
