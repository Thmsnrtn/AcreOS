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

  *(As of 2026-10-18 the costs are Lob's published list prices — see item 6
  below; this table is the current state.)*

  | Spec | Provider cost | Listed credits (weight) | Charged | Minimum that passes |
  |---|---|---|---|---|
  | 4×6 postcard | 92¢ | 75 (`postcard_lob`) | 75 | 72 |
  | 6×9 postcard | 104¢ | 75 (`postcard_lob`) | **81** | 81 |
  | 6×11 postcard | 130¢ | 75 (`postcard_lob`) | **101** | 101 |
  | Letter, 1 page, B&W | 107¢ | 120 (`letter_lob`) | 120 | 84 |
  | Letter, 1 page, colour | 123¢ | 120 (`letter_lob`) | 120 | 96 |

  The campaign send lists its own prices (`DIRECT_MAIL_COSTS`: 4×6 75, 6×9 95,
  6×11 115, 1-page letter 125); every one passes, so none changed.
- **The price changes:** on the per-piece lanes (listed at the `postcard_lob`
  weight) the rule raises a house **6×11 postcard** to the minimum that
  passes — 86 credits at the 2026-10-17 estimate, **101 credits** at Lob's
  list price (2026-10-18) — and a **6×9 postcard** 75 → **81** (2026-10-18). This applies the founder's own rule; it
  is not a new price decision. The raise is computed, not hard-coded
  (`houseMailCreditsPerPiece`): if a cost or weight is recalibrated, the floor
  follows.
- **Unknown spec → refused, never guessed**: a mail class other than USPS
  First Class, any extra service (certified, registered), a letter whose page
  count cannot be confirmed or that exceeds the page cap (2026-10-18), or a
  postcard size outside 4×6 / 6×9 / 6×11.
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

## 2026-10-18 — the founder's answers to the open questions

Relayed by the coordinating session on 2026-10-18; recorded by the
implementing session.

1. **Card top-ups buy credits at the pack price.** `executeAutoTopUp` now
   grants `creditsForPackPrice(amount charged)` — 1.5¢ per credit, rounded
   down exactly as a pack is (a $25 top-up grants 1,666 credits, as the $25
   pack does; it used to grant 2,500). A charge too small to buy one whole
   credit is not made. Existing balances keep their value; only new top-ups
   change. Every card-paid grant path (credit pack, mail recharge, auto
   top-up) is enumerated in `tests/unit/cardPaidCreditsAreAtPackPrice.test.ts`.
   **No minimum top-up is recorded anywhere** (the settings schema accepts any
   amount ≥ 0; the default is $25), so none was added.
2. **House letters must be confirmed one page.** A letter's page count is
   confirmed only by counting the pages of a PDF served from an https URL
   (SSRF-guarded, no redirects, 10 MB / 10 s caps). HTML — whose length only
   Lob's renderer knows — and anything that cannot be fetched or parsed is
   UNKNOWN and refused on the house lane ("shorten it to a one-page PDF, or use
   your own Lob key"); a caller's declared page count is a claim, not a
   confirmation. A confirmed multi-page letter is refused ("shorten it to one
   page, or use your own Lob key") until the founder sets
   `mail.house.cost_cents.letter_extra_page` (founder_settings, UNSET by
   default); then it prices at one-page cost + (pages − 1) × extra page,
   through the same self-funding rule. The own-key lane is unchanged.
   Consequence: every house letter path in the product today sends HTML (the
   outreach queue's letter template, sequence letters, campaign letters,
   communications letters), so on AcreOS mail those are refused until the
   content is a one-page PDF; they still go out on an org's own Lob key.
   Postcards are unaffected.
3. **Address checks.** The one-off check of the org's own return address
   (sender identity) stays free on AcreOS's Lob account. Lead-address checks
   (`/api/direct-mail/verify-address` and `/bulk-verify-addresses`) run only
   on the org's own Lob key — refused on house with "connect your own Lob
   key" — until the founder sets `mail.house.cost_cents.address_check`
   (UNSET by default); then each check is pre-paid from purchased credits at
   the self-funding minimum, and a check Lob certainly did not run is
   refunded. The callerless env-key verifier in `directMail.ts` was deleted.

### 2026-10-18 (later the same day) — render, count, cap, Lob list prices

4. **Render to PDF, then count.** For house mail AcreOS renders each HTML
   letter to PDF itself, before anything is debited — with the repo's existing
   headless Chromium (`puppeteer-core`; the production image already installs
   `chromium` and sets `PUPPETEER_EXECUTABLE_PATH`, Dockerfile), at Lob's
   letter size (US Letter, 8.5 × 11 in, no added margins) —
   `server/services/mail/letterRender.ts`. It counts that PDF's pages, charges
   for exactly that page count through the self-funding rule, and sends Lob
   THAT PDF (a multipart upload), so the printed piece is the counted piece;
   a PDF URL is fetched once and those bytes are sent. JavaScript is off and
   sub-resource requests are limited to SSRF-guarded https while rendering.
   A render that fails refuses the house send honestly, with nothing debited;
   content that is neither HTML nor a readable PDF stays "unknown → refused".
   The own-key lane is unchanged (Lob renders the customer's own content).
   Outreach-queue letters (laid out per recipient only at send) are now
   charged per piece at send, after each is rendered and counted, instead of
   being refused; queued postcards are still pre-paid at queue time.
   Measured locally: ~1.3–1.5 s per render (a cold Chromium launch each time;
   identical HTML is cached, so a campaign renders once).
5. **Cap at 6 pages.** House letters over `mail.house.max_letter_pages`
   (founder_settings, default 6) are refused with "use your own Lob key".
6. **Cost table seeded from Lob's published list prices** (Lob help center
   "Pricing details", help.lob.com/print-and-mail/ready-to-get-started/
   pricing-details; rates effective 2026-07-12 and the 2026-11-01 update,
   read 2026-10-18), highest plan column (pay-as-you-go / Developer), the
   2026-11-01 rate where higher, rounded up to the whole cent:
   4×6 92¢ · 6×9 104¢ · 6×11 130¢ · B&W letter first page 107¢ · colour first
   page 123¢ · extra page B&W 11¢ / colour 21¢. The extra-page figures are now
   the DEFAULTS of `mail.house.cost_cents.letter_extra_page` /
   `…letter_extra_page_color` (still founder-overridable), so pages 2–6 go —
   this supersedes "pages 2–6 need the extra-page key set" above. Address
   verification has no published price and stays unset.
   **Charges the rule raised (no charge was lowered):** per-piece / queue lanes
   6×9 postcard 75 → 81 credits, 6×11 postcard 86 → 101 credits. Campaign-send
   prices (75 / 95 / 115 / 125) and every letter's 120 listing still pass and
   are unchanged; multi-page letters price from the rule (e.g. 6-page B&W
   126, 6-page colour 178).

Still open (unchanged, to be raised with the founder): the two house price
lists (campaign send vs per-piece lanes), and real current Lob prices for the
cost table.

## Open for the founder

- The two house price lists (campaign send `DIRECT_MAIL_COSTS` vs the
  credit-weight listing on the per-piece lanes) — both pass the rule.
- Which Lob plan AcreOS is on (the table assumes the highest-priced column).
