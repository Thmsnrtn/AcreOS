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
first**. Pre-committed now, while calm, so that normal early variance (few or
zero converted customers early is normal for cold acquisition) is never
adjudicated emotionally mid-drawdown. Until that horizon, drawdown alone is
not grounds to revoke autonomy; at the horizon, the program is judged on the
pre-agreed frame.

Vocabulary clarification (founder, this date): there is exactly ONE founder —
the platform owner running AcreOS as a business. Customers run their own land
operations inside the product and are never "founders" in this vocabulary.
The "mail program" here is AcreOS's own customer-acquisition + free-taste
spend, never customers' land deals.

## 4. Outreach stop-loss shape — MONTHLY SPEND LINE PAUSES

Ruling: a **monthly** mail+data spend line (dollar amount to be set by the
founder in the cost panel); crossing it pauses outreach until the founder
looks. Resets monthly so a bad month can never compound silently.

Implementation status: the pause is now wired (same-date follow-up PR, the
one carrying this edit) — a monthly mail+data spend line gates the mail
flusher and the direct-mail send paths; crossing it pauses outreach (skip,
never drop) and pages the founder once per pause event. The line defaults to
the founder's $500/month ruling (#5) and is founder-adjustable in the cost
panel; the machine never picks the number (money hard-stop).

---

# Addendum — second picker round, same date

## 5. Outreach stop-loss dollar line — $500/MONTH TO START

Ruling: the monthly mail+data spend line starts at **$500/month**, coherent
with the constitutional $500 autonomous-spend scale. Raisable by the founder
anytime from the cost panel. The pause wiring ships as a reviewed PR.

## 6. Free-taste allowance sizing — MARGIN-TIED RULE

Ruling: each plan's monthly included allowance is derived, not hand-set:
whatever quantity of platform sends/lookups costs the platform **≤ ~20% of
that plan's monthly price**, computed from live provider prices. Margin-safe
by construction; auto-adjusts with any future price change. Implementation
derives counts mechanically; no number is ever hand-invented.

## 7. Letter cadence — QUIET-DAY MODE NOW

Ruling: on green mornings (nothing needs the founder, vitals fine) The Letter
renders three lines — needed-line · money line · step-away line — with the
full letter one tap away. Weekly cadence remains a FUTURE decision, gated on
measured unattended runway existing first.

## 8. External watchdog + break-glass — SCAFFOLD NOW, FOUNDER PROVISIONS LATER

Ruling: build the break-glass card content ("if AcreOS is dark" one-pager),
a Controls section with exact copy-paste steps for the two GitHub secrets
that arm the dormant external watchdogs, and a quarterly email-the-card job.
The founder provisions the secrets when ready. NOTHING is presented as armed
until it actually is (no-fabrication).

Implementation status: rulings 5–8 shipped as one same-date implementation
PR (the one carrying this edit): stop-loss pause wiring at $500/month
default (5), margin-tied allowance engine deriving counts from live provider
unit costs (6), quiet-day Letter mode (7), and the break-glass card +
dormant-watchdog Controls section + email-the-card route (8) — the watchdog
secrets remain unprovisioned and NOTHING is shown as armed until they are.
