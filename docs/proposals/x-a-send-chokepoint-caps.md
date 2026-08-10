# X-A proposal — trust-tier caps at the send chokepoints (founder ruling required)

**Status: PROPOSED — nothing in this document is enforced.**
Slice 1 (shipped 2026-08-10) built the *spine only*: the org trust tier
(`organizations.trust_tier`, migration 0229), the caps CONFIG
(`server/services/orgTrust.ts`, unit-tested in `tests/unit/orgTrust.test.ts`),
portal-link expiry + rebind, and the portal "Report this page" → decisions-door
inflow (`abuse_report`). Every item below is a **send-lane or policy change on
the founder-approval list** and ships only after an explicit founder ruling.
`tests/unit/orgTrust.test.ts` pins the boundary: today the only importer of
`orgTrust` is `routes-borrower.ts` (portal-link TTL + abuse-report context);
if a send chokepoint starts importing it before this proposal is ruled on,
that suite goes red.

## Why

The abuse review (handoff §E, Addendum A) concluded the cheapest way to be
hurt at small scale is a *bad customer*, not a hacker: a spammer org using the
wedge/platform lanes to blast recipients, a scammer putting borrower-portal
pages in front of victims, a scraper draining exports. The spine now exists to
gate those rails by earned trust — but gating a send rail changes what
customers' mail does, which is founder territory (same reasoning as the
2026-07-17 BYO ruling and the 0.8 mail-lanes proposal, which this interacts
with).

## The tier ladder (shipped, config only)

| Tier | Seeded by (migration 0229 — deterministic, real columns only) |
|---|---|
| `new` | default for every org at signup; any org failing the rules below |
| `established` | ≥90 days old AND active inside the CLOSED window [2026-07-11, 2026-08-10] AND `subscription_status='active'` AND `dunning_stage='none'` — the closed window freezes the cohort, so deploy re-runs of the seed can never promote an org that became active later; post-seed promotions are founder-carded only |
| `trusted` | **never auto-seeded** except the founder's own org (`is_founder`); otherwise earned/founder-granted per the ladder below (unbuilt) |

Proposed caps per tier live in `ORG_TRUST_CAPS` (`server/services/orgTrust.ts`)
— wedge sends/day, wedge recipients/day, per-recipient cooldown days,
portal-link counts/TTL, export jobs/hour and rows/day. **The numbers are a
starting proposal for the founder to adjust, not a shipped policy.** The only
caps consumed today are `portalLinkTtlDays` / rebind context on the
portal-link lifecycle — which moves no mail. Expired links rotate
automatically when a reminder that embeds them goes out
(`services/portalLink.ts`), so the legacy 90-day sunset never strands a
borrower whose lender is actively servicing the note.

**One TTL asymmetry needs a ruling with the caps:** the notes-table column
default stamps every freshly minted link with 365 days regardless of tier,
while a REBIND stamps the org's tier TTL (90 days for `new`). So a brand-new
org's minted links outlive its own tier cap 4×, and refreshing a link as a
`new` org shortens it. Harmless while caps are config-only; when
`portalLinkTtlDays` is ratified, either the mint path stamps tier TTL too
(move the stamp from the column default into `createNote`) or the `new`
tier's TTL rises to match the mint default. Founder's call, alongside the
numbers.

## Deferred enforcement set (each item needs its own founder go/no-go)

1. **Per-recipient frequency ceilings at the send chokepoints.** At the
   mail/SMS chokepoints, refuse (with an honest reason) a send to a recipient
   who has already received ≥N messages from the same org inside the window;
   N by trust tier. Touches every outbound lane → founder-only.
2. **Wedge velocity caps + per-recipient dedupe on the platform mail lane.**
   `wedgeSendsPerDay` / `wedgeRecipientsPerDay` / `wedgeSameRecipientCooldownDays`
   enforced where wedge sends are dispatched. **Interacts with the pending 0.8
   mail-lanes proposal** — if 0.8 lands first, the enforcement point is the
   lane router; rule on ordering explicitly.
3. **Payment-method-to-exceed-wedge.** An org with no payment method on file
   stays hard-capped at `new`-tier wedge volume regardless of tier — spam is
   cheap only while anonymous. Pricing-adjacent → founder-only.
4. **Signup friction ladder.** Verified contact (confirmed email at minimum)
   before any outbound send; disposable-domain screen at signup (refuse-or-
   flag list, never a silent drop). Changes onboarding → founder ruling on
   how much friction is acceptable pre-PMF.
5. **Trust-tier demotion on complaint events.** Spam complaints / bounce
   spikes / `abuse_report` items ruled against the org demote the tier
   (trusted→established→new) automatically, with the demotion filed as a
   decisions-door item. Automated demotion changes customer capability
   without a human in the loop → founder must set the thresholds and the
   appeal path.
6. **Suspension ladder (founder-approved suspensions).** Beyond demotion:
   pause outbound rails for an org pending review. Every suspension is a
   founder decision (never automatic); the ladder defines what "paused"
   means per rail. Customer-impacting hard-stop → founder-only, forever.

## What slice 1 already gives the founder

- Every abuse report lands as a native `abuse_report` card (riskLevel high,
  Class B) carrying page context, the reporter's verbatim reason, and the
  reported org's current trust tier — so rulings can start accumulating
  evidence *now*, before any enforcement exists.
- Portal links now expire and rebind (crypto-strong rotation, old sessions
  revoked), killing the forever-valid Math.random token class without any
  founder-gated policy involved.

## Decision requested

Approve, amend, or reject each numbered item above; confirm the cap numbers
in `ORG_TRUST_CAPS` (or supply replacements); rule on ordering vs the 0.8
mail-lanes proposal. On approval of any item, its enforcement lands at the
chokepoint with its own ratchet test, and `tests/unit/orgTrust.test.ts`'s
importer baseline is updated *in the same change*, citing the ruling.
