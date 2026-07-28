# Founder decisions — 2026-07-28

Recorded verbatim from the founder's answers (decision picker, this date).
These are the rulings for the four decision cards seeded in `/founder/decisions`
(`railSunsetDecisionCards.ts`, `evaluationHorizonCards.ts`). The in-app cards
remain until tapped or reconciled; **this file is the authoritative record**.
Only the founder can rescind a ruling, explicitly.

## 1. Rail sunset order — ALL FOUR RAILS AT ONCE

Ruling: bring-your-own is the standard for all four rails (property data,
letter mail, email, SMS) from day one, rather than a phased migration.

Founder's reasoning (paraphrased from their own words): with **zero customers
signed up yet**, there is nobody to migrate gently — phasing existed to soften
friction for existing users. Launching directly into the BYO model is the
simpler, cleaner story. (Confirmed sound on review: this is not a cutover, it
is launching with the right model. SMS additionally requires A2P carrier
registration before it can send at all, so it is BYO-by-necessity regardless.)

## 2. Free-taste allowance shape — MONTHLY INCLUDED ALLOWANCE

Ruling: every plan includes a monthly allowance of platform sends/lookups per
rail; past it (or on higher tiers) the customer connects their own account.
Mirrors the proven AI-key threshold model. The exact per-rail numbers remain
the founder's to set in the cost panel — no number is decided here.

## 3. Mail-program evaluation horizon — BOTH, WHICHEVER FIRST

Ruling: the mail program is judged at **6 months of sending OR when total
mail+data spend crosses a dollar line the founder will set — whichever comes
first**. Pre-committed now, while calm, so that normal early variance (zero
closed deals early is normal in land) is never adjudicated emotionally
mid-drawdown. Until that horizon, drawdown alone is not grounds to revoke
autonomy; at the horizon, the program is judged on the pre-agreed frame.

## 4. Outreach stop-loss shape — MONTHLY SPEND LINE PAUSES

Ruling: a **monthly** mail+data spend line (dollar amount to be set by the
founder in the cost panel); crossing it pauses outreach until the founder
looks. Resets monthly so a bad month can never compound silently.

Implementation status (honest): no spend-threshold auto-pause is wired for
mail/data outreach today — only the AI-dispatch monthly cap self-pauses.
Wiring this pause to the founder's chosen shape is an approved follow-up
change that ships as a PR the founder sees before it is live. The dollar
number is set by the founder, never the machine (money hard-stop).
