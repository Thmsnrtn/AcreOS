# marisol-vega — Series-A Financial Readiness

**Reading list:**
- MASTER-FINDINGS-RECONCILIATION.md (P0-1: tier-pricing consolidated)
- post-may1-resweep.md (RS-1..RS-7 shipped)
- Original: elite-team-2026-05-01/marisol-cfo.md

**State read:**

May 1 I found six conflicting tier-price tables destroying MRR visibility. P0-1 shipped (`shared/billing/tier-pricing.ts`); consolidation verified in commits `b1150fa7` + `0c8ba989`. Routes consume one table now. **That single fix made MRR defensible.** But three gaps surfaced: (1) annual revenue recognized at cash, not ratably, (2) no customer-concentration alert (one customer = 30% of MRR is an unmonitored risk), and (3) COGS-per-customer is invisible—you don't know if high-volume Pro customers are margin-negative. Series-A diligence will expose these immediately.

**Push forward — my 5 moves (ranked):**

1. **Ship subscription-event ledger + monthly recognition worker.** Every Stripe webhook writes immutable `subscription_history`. Monthly cron writes `recognized_revenue` for annual subscriptions and credit packs. GAAP ASC 606 compliant. This is the gate—without it, you cannot answer "what's our accrual ARR?" Effort: 3d.

2. **Add customer-concentration alert to `/founder-home`.** Hard stop >20% MRR, soft alert >15%. Investors require this—"our revenue is not one-customer-away from catastrophe." Wire a cron and a view on `groupBy(organizationId)`. Effort: 1.5d.

3. **Implement COGS-per-customer rollup.** Wire `usage_records` → cost ledger → per-org gross-margin. Today "Pro at $49" looks good; reality "Pro pulling 30k AI calls/day" could be margin-negative. First question in Series-A model review. Effort: 2d.

4. **Enable Stripe Tax + tax_id_collection.** One line: `automatic_tax: { enabled: true }`. Solves Canada + multi-state sales-tax exposure. You've collected revenue across TX/WA/TN without tax handling—fine-risk once revenue scales. Effort: 1d.

5. **Defer cap-table conversations 60 days; write `SERIES-A-FINANCIAL-READINESS.md` checklist.** (✓) tier-pricing single source, (☐) subscription ledger, (☐) concentration alert, (☐) COGS rollup, (☐) tax handling, (☐) documented close process. Don't schedule investor meetings until all are green.

**What I'd defer:**

- Full CFO close-the-month ritual (coupon reports, comp metadata, refund contra-revenue). Get the foundation right; automate later.
- Stripe Connect revenue dashboard. You're not using Connect yet; ship when first white-label tenant launches.

**What scares me most:**

*You're at 50 customers—the inflection where unit economics become visible and broken. If the COGS rollup reveals high-volume customers are margin-negative, that's a pricing problem. But worse: you raise Series A before you know the real margin structure. I'd rather you raise later with good numbers than fast with garbage numbers.* Mitigation: the ledger is the gate. One 3-day sprint separates "term sheet" from "let us re-audit."

**Contrarian to Asher:** He pushes narrative-first. I'd reverse: execution-first (ship GAAP infrastructure, then narrate the number). A beautiful story about five verticals means nothing if unit economics are broken and you don't know it.

— Marisol
