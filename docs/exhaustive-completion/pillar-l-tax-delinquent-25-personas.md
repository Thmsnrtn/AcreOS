# Pillar L — Tax-delinquent specialists as 25 personas

Twenty-five composite personas across the tax-delinquent investing
market — tax-lien certificate buyers, tax-deed buyers, redemption
flippers, foreclosure-rescue operators, and hybrid tax+note investors.
Mined for insights that aren't already covered by Pillar K or the
general land-investor flow.

The tax-delinquent vertical is one of AcreOS's seven canonical personas
(`tax_delinquent` in `personaVocabulary.ts`). Today the persona has
vocabulary entries but minimal vertical-specific workflow plumbing.

---

## The 25 personas

### Beginner tier (years 0–3)

1. **Anders · First-year lien certificate buyer**
   Bought 3 certificates at a county auction. Doesn't know what
   redemption looks like or when to file foreclosure. **Gap:** no
   per-certificate redemption-countdown timer or state-specific
   foreclosure-trigger workflow.

2. **Bea · Online auction newcomer**
   Buys via county online-auction portals (Bid4Assets, GovEase). 6
   certificates across 3 states. **Gap:** no per-state redemption-period
   reference; no auction-platform integration.

3. **Cyrus · IRA tax-lien investor**
   Self-directed IRA. ~10 certificates/year. **Gap:** same custodian
   routing issue as Pillar K's Brendan; no IRA flag on a certificate.

4. **Doris · Bidder consortium member**
   Pools capital with 4 other investors at auctions; later splits
   proceeds. **Gap:** no shared-ownership / split-distribution model
   on a certificate.

5. **Egan · Pure-yield strategist**
   Treats tax liens as fixed-income. Targets 12–18% statutory rates.
   Hopes redemption happens. **Gap:** no per-state statutory-yield
   reference + projected vs. actual yield tracking.

### Intermediate tier (years 3–7)

6. **Fern · Tax-deed flipper**
   Buys deeds (not certificates) at deed-sale states. Cleans titles,
   resells. **Gap:** no tax-deed acquisition flow distinct from a
   tax-lien certificate; no quiet-title workflow.

7. **Garrett · Foreclosure operator**
   Buys liens that don't redeem; pushes through foreclosure to take
   the deed. 20+ active foreclosures. **Gap:** no foreclosure timeline
   tracker per state (judicial vs. non-judicial; days-required).

8. **Hana · Notice-of-default mailing operator**
   Mails NODs and pre-foreclosure offers to delinquent owners.
   Workflow: pull list → mail → offers in. **Gap:** state-by-state
   pre-foreclosure cure period reference; auto-generate NODs.

9. **Iliana · Multi-state portfolio operator**
   Liens across 8 states. Each with different rules. **Gap:** unified
   state-rule reference + per-state redemption-due dashboard.

10. **Jonas · Redemption-flip specialist**
    Buys liens at discount on secondary market; sells back at premium
    if redemption looks imminent. **Gap:** no secondary-market
    pricing model; no redemption-likelihood score.

11. **Kira · Probate + tax-delinquent dual operator**
    Buys deeds on tax-delinquent properties that are also in probate.
    Compounded complexity. **Gap:** no probate-status overlay on a
    tax-delinquent record.

12. **Lev · Note + tax-delinquent dual operator**
    (Pillar K crossover.) Treats them as one funnel. **Gap:** no
    shared distressed-asset pipeline (raised in Pillar K too).

### Veteran tier (years 7+)

13. **Maria · Veteran lien buyer**
    20+ years. 500+ liens across 12 states. Self-services. **Gap:**
    exception-based digest (the Maris pattern from Pillar K — only
    fire alerts on anomalies).

14. **Noor · Tax-deed wholesaler**
    Buys deeds, cleans title, flips within 60 days to retail buyers
    or rehabbers. **Gap:** end-to-end "tax-deed-to-retail-sale"
    workflow with title-curative tasks built in.

15. **Olin · Hedge-fund certificate bidder**
    Buys $1M+ pool of certificates at premium auctions where rates
    bid down. **Gap:** no pool-bidding strategy tracker (target-yield-
    per-pool, bid-down ladder).

16. **Pia · Family-office allocator**
    Tax liens are 5% of book. Cash-flow leg. **Gap:** cross-vertical
    rollup (also a Pillar K item).

17. **Quoc · Quiet-title + flip operator**
    Specializes in tax-deeds where the title is cloudy. Quiet-title
    legal process is his moat. **Gap:** no legal-process tracker;
    no per-state quiet-title checklist.

18. **Rae · Tax-cert-to-loan modifier**
    Buys liens with the goal of working out a payment plan rather
    than foreclosing. Social-impact angle. **Gap:** no payment-plan
    modifier workflow; no owner-outreach templates for cure.

### Niche tier (any years)

19. **Sage · Mobile-home tax-deed**
    DMV-titled MHs with delinquent taxes. **Gap:** same MH title flag
    as Pillar K's Iris.

20. **Tariq · Commercial tax-deed**
    Commercial properties with delinquent taxes. Different
    underwriting model. **Gap:** commercial-collateral variant.

21. **Una · Non-redemption pivot**
    Buys liens hoping for non-redemption; pivots to deed take. Books
    yield as deferred. **Gap:** projected-outcome scenarios per cert.

22. **Vex · Liens-on-vacant-land specialist**
    Only buys liens on vacant land. Lower-risk recovery (no occupant
    eviction). **Gap:** none specific — existing land plumbing covers.

23. **Wren · Probate + tax-delinquent + note triple-play**
    Combines all three. Most complex persona. **Gap:** unified
    distressed-asset pipeline (Pillar O candidate).

24. **Xio · Bid-down-to-zero specialist**
    Florida-style auctions where rate bids down to 0.25%. Volume game.
    **Gap:** bid-down-tracking auction model.

25. **Yara · Cross-state portfolio rebalancer**
    Rebalances which states she focuses on based on rate environment
    + redemption rates. **Gap:** per-state historical-redemption-rate
    reference.

---

## Synthesized insights

| # | Insight | Personas | In repo? |
|---|---|---|---|
| 1 | Per-state redemption-period + foreclosure-trigger reference | Anders, Bea, Garrett, Iliana | No |
| 2 | Per-certificate redemption-countdown timer workflow | Anders, all veterans | No |
| 3 | Tax-deed acquisition flow distinct from certificate | Fern, Noor, Quoc | No — `tax_delinquent` is one persona; deed vs. cert is a sub-distinction |
| 4 | Quiet-title workflow (per state) | Fern, Noor, Quoc | No |
| 5 | NOD / pre-foreclosure mail templates | Hana | No |
| 6 | Foreclosure-timeline tracker per state | Garrett, Iliana | No |
| 7 | Per-state statutory-yield reference + projected vs. actual | Egan, Maria | No |
| 8 | Redemption-likelihood score | Jonas, Olin, Una | No |
| 9 | Pool-bidding strategy + bid-down ladder | Olin, Xio | No |
| 10 | Probate-status overlay | Kira, Wren | No |
| 11 | Payment-plan modifier workflow (cure path) | Rae | No |
| 12 | Shared distressed-asset pipeline (tax + notes + probate) | Lev, Wren | Pillar O candidate |
| 13 | Cross-vertical yield rollup | Pia | Pillar P candidate |
| 14 | Exception-based alerts digest | Maria | Pillar K shared |

---

## Action queue — what ships in this pillar

### A. Three new workflow templates (high-leverage)

In `server/services/workflow-engine.ts`:

1. **`tpl_tax_redemption_approaching`** — `cert.redemption_period_60d`
   trigger. Owner has 60 days left to redeem; create task to confirm
   posture (file foreclosure / extend if state allows / accept redemption).

2. **`tpl_tax_foreclosure_eligible`** — `cert.foreclosure_eligible`
   trigger. Redemption period closed; create high-priority task with
   state-specific foreclosure-filing requirements.

3. **`tpl_tax_owner_cure_outreach`** — `cert.acquired` trigger.
   On certificate acquisition, draft a payment-plan offer to the
   delinquent owner (Rae's persona — gives the operator the "cure
   rather than foreclose" path on day one).

### B. Per-state regulatory reference module

`shared/regulatory/taxLienStateRules.ts` — pure data module:

```typescript
{ AL: { redemptionPeriodMonths: 36, statutoryRateBps: 1200, ... }, ... }
```

State-by-state: redemption period, statutory yield, foreclosure
trigger, pre-foreclosure cure window. Surfaced from a `useStateRules()`
helper on the certificate detail page. Closes insights 1, 5, 6, 7.

### C. Workflow trigger event additions

`shared/schema.ts` WORKFLOW_TRIGGER_EVENTS — add:
- `cert.acquired`
- `cert.redemption_period_60d`
- `cert.foreclosure_eligible`
- `cert.redeemed`

### D. Documented out-of-scope items

Append a "Pillar L follow-ups" section to a new doc
`docs/exhaustive-completion/tax-delinquent-followups.md` with the
remaining 8 insights (tax-deed flow, quiet-title workflow,
redemption-likelihood score, pool-bidding strategy, probate overlay,
modifier workflow, distressed-asset shared pipeline, cross-vertical
rollup).
