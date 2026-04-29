# Tier 3 Audit — Closing Surfaces

Phase E.4 commit `0049637`.

## Surfaces

| Surface | Status | Drift before | Drift after |
|---|---|---|---|
| `/offers` | Ported | 10 hardcodes (offerStatuses map: 7 statuses × bg+text) | Semantic tones |
| `/documents` | Ported | 14 hardcodes (STATUS_BADGES + secondary status map) | Semantic tones |
| `/finance` | Ported | 40 hardcodes (status + loan health + 28 inline text colors) | 5 status + 3 health switched; remaining 32 inline color uses (revenue/income callouts using text-emerald-600) deferred — they're per-location status hints, not centralized maps |
| `/dispositions` | Skipped | n/a | No prototype analog |

## Voice (§1)

Status labels across all three surfaces are plain ("Draft / Sent /
Delivered / Accepted / Rejected" on offers; "Pending signature /
Partially signed / Signed / Cancelled" on documents; "Active / Paid
off / Defaulted / Pending" on finance). No hype. ✅

Loan-health labels: "Current", "Due in N days", "N days late". Specific
over vague. ✅

## Visual baseline (§2)

`offerStatuses[].color` map uses the same `bg-acr-X-soft text-acr-X
border-transparent` shape as listings/direct-mail-campaigns/audit-log —
the platform-wide status pill grammar. ✅

`finance.tsx` getStatusColor + getLoanHealth functions return
semantically-toned strings. Loan health text colors flip per theme
correctly (text-acr-pos vs text-acr-neg). ✅

## Density (§2.1)

- /offers: rows ✅
- /documents: rows + folder hierarchy ✅
- /finance: rows + tabular content (`tabular-nums` throughout for
  monetary values) ✅

## Component grammar (§5)

Status pills uniform across Tier 3 with Tier 1-2 semantics. Card primitive
used throughout. Lucide icons. ✅

## Agent presence (§1.3)

No agent attribution at Tier 3. Atlas / Pax / Sophie don't surface on
closing screens — they show on /today (Pax noticed), /inbox (Pax draft),
/parcels (Atlas Run). Tier 3 surfaces are operator-action-oriented.

## State coverage (§11)

| Surface | Loading | Empty-zero | Empty-filtered | Error |
|---|---|---|---|---|
| /offers | ✅ | ✅ | ⚠️ | Generic |
| /documents | ✅ | ✅ | ⚠️ | Generic |
| /finance | ✅ | ✅ | ⚠️ | Generic |

State coverage thinness tracked for Phase G.

## Carryforward

`finance.tsx` has 32 remaining inline color uses (text-emerald-600 on
revenue figures, text-amber-600 on interest rate callouts). These aren't
status badges — they're per-location semantic hints (income = positive
green, interest = warning amber). They could be uplifted to text-acr-pos
/ text-acr-warn but the visual difference is subtle and the risk of
changing the existing finance dashboard read is non-zero.

Documenting as Phase G polish item: revisit finance.tsx revenue/interest
callouts with the founder's eye on whether semantic-token uplift improves
or harms the dashboard read.

## Verdict

Tier 3 passes. Status maps clean. finance.tsx revenue callouts flagged
for Phase G review.
