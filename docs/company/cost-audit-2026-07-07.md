# Cost Audit — 2026-07-07

*Full-platform cost audit: founder overhead at varying load, optimization
levers, and self-funding posture. Numbers are code-sourced (costModel.ts,
aiCostRates.ts, tier-limits.ts, the studio revenue ladder) unless marked
estimate. Companion fixes shipped the same day — see the execution ledger
in `roadmap-2026-07.md`.*

## The founder's bill

| State | Monthly cost | Notes |
|---|---|---|
| Today (0–5 customers) | **~$55–175** | Infra ~$25 (costModel), autopilot AI $30–150 (alert at $5/day) |
| Worst case, bounded | **~$500** | $15/day fail-closed AI backstop + per-dispatch $5 kill caps + $50/mo Solene envelope make exceeding this structurally impossible |
| Breakeven | **≈ 3 Pro subscriptions** | One yearly Pro ($490 upfront) covers the floor for 3–6 months |

## Cost at scale (customer mix ~20/60/10/10 starter/pro/scale/free)

| Customers | ~MRR | Total cost | Gross margin |
|---|---|---|---|
| 10 | ~$450 | ~$120–170 | ~65–75% |
| 25 (G1) | ~$1,100 | ~$300–400 | ~70% |
| 100 (G2) | ~$4,500 | ~$1,100–1,400 | ~72–76% |
| 500 (G3) | ~$22,500 | ~$4,200–5,500 | ~76–81% |

Margins improve with scale because the fixed floor amortizes and the BYOK
thresholds push the heaviest users onto their own keys (worst customers
converge toward ~$0.30/mo marginal cost). The G1 ≥70% gross-margin gate is
achievable. The ladder's $25K-MRR hire rung (~$8K/mo) conflicts with the
solo+agents doctrine — declining it is itself the largest single margin
decision on the board.

## Self-funding mechanics (already built)

1. Revenue-gated costs: paid data locked below $200 MRR; vendor commits
   ≤2% of trailing MRR; infra upgrades wait for their MRR trigger.
2. Customers pre-fund COGS: prepaid credits at p90 cost weights; SMS ~3×
   markup; BYOK lanes with the W1 honest-payer guarantee.
3. Free tier ≈ free to us: gov data only, $2/day AI ceiling, ~$5 lifetime
   mail exposure per free org.
4. Cash timing: yearly = 10 months upfront + ACH ($0.80 vs ~$20 card fees).
5. Ad spend proof-gated: budget ramp needs CAC ≤ $50 over ≥5 attributed
   signups; margin-negative customers suppress ramps.

## Fixes shipped with this audit

- **Scale margin guard** — Scale's worst-case platform-key AI COGS was ~$90
  on a $79 plan. Two-stage downgrade (Opus→Sonnet at 200 msgs, →Haiku at
  3,000) re-bounds it at ~$54 (paxModelTier.ts; tier-limits.ts notes).
- **Idle pacing** (jobs/idlePace.ts) — below 5 paying customers, the
  decision executor (30 min) and embedding refresher (~6 min) run 1-in-8
  slots; full cadence resumes automatically with customers. Stateless slot
  math; fails toward full speed.
- **Real forecaster** (financialForecaster.ts) — MRR from tier-pricing per
  org (was flat $49) preferring fresh mrr_snapshots; burn from the shared
  costModel.ts (was a flat $200 guess ≈ 2× the real floor); runway now
  requires the founder-set `finance.cash_reserve_usd` setting instead of a
  fabricated formula.
- **Marketing-spend ledger** (migration 0197; services/marketingSpend.ts) —
  the CAC numerator. Actuals only, never budgets. Unit-economics endpoint
  now computes CAC/payback (fully sourced) and LTV:CAC (24-month lifetime
  assumption, stated) the moment spend is recorded; budget-ramp CAC proof
  now includes real ad dollars. Founder surface:
  POST/GET `/api/founder/money/marketing-spend`.

## Remaining levers (not yet taken)

- Staging pgvector Fly machine: destroy when idle (~$3–5/mo) — founder
  console action, not code.
- Credit packs sell at exactly 1¢/credit; a 1.2¢ price is an H2 lever
  (~20 pts margin on the credit stream). Deliberately untouched pre-launch.
- Telnyx SMS cutover already laddered at $3K MRR (~30–40% off SMS COGS).
- DeepSeek cheap-tier expansion is eval-gated — pursue only with green
  evals per routing policy.
- Sentry live-billing wiring (cost summary hardcodes $0 on free-tier
  assumption) — revisit at the $500-MRR Sentry rung.

*Record follow-ups against these numbers at each gate crossing.*
