# Pillar M — Wholesalers as 25 personas

Twenty-five composite wholesaler personas across spectrum: virtual vs
boots-on-the-ground, single-state vs multi-state, residential vs land,
contract-assign vs double-close, novice vs scaled.

The `wholesaler` persona has vocabulary entries (Lead → Motivated seller,
Deal → Assignment) but limited workflow plumbing distinct from land
flips. The 25-persona mine surfaced where the workflows differ.

---

## The 25 personas

### Beginner tier

1. **Ari · First-deal wholesaler** — Single deal under contract. Doesn't
   know how to find an end-buyer. **Gap:** no end-buyer list-building
   workflow + no per-deal "marketing-to-buyers" tracker.
2. **Bly · Online-course graduate** — Sent 500 yellow letters; no
   responses yet. **Gap:** need response-rate analytics + drip
   sequences with multi-touch follow-up.
3. **Cami · MLS-driven wholesaler** — Targets expired/withdrawn
   listings only. **Gap:** no MLS-status-change trigger on a lead.
4. **Dax · Driving-for-dollars novice** — Drives neighborhoods, photos
   distressed houses. **Gap:** mobile field-add flow with photo-first
   capture (Field Scout already exists; needs persona-aware mode).
5. **Eli · Probate-list wholesaler** — Buys probate lists and mails.
   **Gap:** no probate-stage tracker per lead.

### Intermediate tier

6. **Fern · Multi-list direct-mail operator** — 20K letters/month
   across absentee, tax-delinquent, probate. **Gap:** unified
   per-list ROI dashboard (which list converts best).
7. **Gus · Single-state assignment specialist** — Only assigns
   contracts; never closes. **Gap:** assignment-of-contract templates
   per state + transparent fee disclosure UI.
8. **Hana · Double-close operator** — Operates in states that require
   double-close (transactional funding). **Gap:** no double-close
   workflow (back-to-back closings with transactional lender).
9. **Iyer · Virtual wholesaler** — Operates in 4 states never visited.
   **Gap:** per-state contract validity + per-state assignability
   reference.
10. **Jen · Cash-buyer-list operator** — Owns a 2K buyer-list;
    wholesales to them. **Gap:** buyer-side CRM + match-on-criteria
    workflow.
11. **Kev · Sub-to wholesaler** — Sells "subject-to existing financing"
    deals; specific disclosures. **Gap:** sub-to-specific contract
    template + due-on-sale-clause warning.
12. **Lin · Land wholesaler** — Wholesales vacant land specifically.
    **Gap:** none (land is the default vertical).

### Veteran tier

13. **Maud · Scaled team operator** — 12-person team, 30 deals/month.
    **Gap:** team workflow + role-based assignment + commission split
    tracking.
14. **Nico · Wholetail operator** — Wholesales when margin is high;
    rehabs and retails when margin is low. **Gap:** decision-helper
    that compares wholetail vs assignment math per deal.
15. **Oz · Coaching-business wholesaler** — Wholesales AND sells
    coaching to other wholesalers. **Gap:** none specific.
16. **Pia · Hedge-fund supplier** — Wholesales bulk to institutional
    buyers (Opendoor, Offerpad). **Gap:** institutional-buyer
    integration / submission portal.
17. **Quill · 5-year veteran** — Has watched the market cycle. Adjusts
    buy-box dynamically. **Gap:** historical-comp dashboards.
18. **Ros · Reverse-wholesaler** — Builds buyer-criteria first, then
    finds sellers matching it. **Gap:** explicit "buyer-criteria-
    driven" sourcing mode.

### Niche tier

19. **Sven · Note-creator wholesaler** — Sells with seller-financing;
    immediately wholesales the note. Note + wholesaler dual.
    **Gap:** Pillar K cross-pollination — see note vertical.
20. **Tova · Pre-foreclosure wholesaler** — Buys at trustee sales,
    sells fast. **Gap:** trustee-sale calendar + funding-line tracker.
21. **Ufo · Hoarder-house specialist** — Specific psychology + service
    referrals (cleanout, mental-health). **Gap:** none specific.
22. **Vela · Mobile-home park wholesaler** — Bulk MH park deals.
    **Gap:** lot-level due-diligence pattern.
23. **Wren · Squatter / occupied-property wholesaler** — Sells
    occupied properties to investor-buyers comfortable with cash-
    for-keys negotiations. **Gap:** occupancy-status field +
    cash-for-keys task template.
24. **Xan · ADU-potential wholesaler** — Targets properties with
    accessory-dwelling-unit potential. **Gap:** zoning-flag overlay.
25. **Yael · Vacant-land + houses dual** — Wholesales both. **Gap:**
    persona-blend UX (today we pick one persona; Yael needs both).

---

## Synthesized insights

| # | Insight | Personas | In repo? |
|---|---|---|---|
| 1 | **End-buyer list / cash-buyer CRM** | Ari, Jen, Pia | Partial — `buyer-blasts` exists; no CRM |
| 2 | **Assignment-of-contract templates per state** | Gus, Iyer | No |
| 3 | **Double-close (transactional-funding) workflow** | Hana | No |
| 4 | **MLS-status-change trigger** | Cami | No |
| 5 | **Per-list ROI dashboard** | Fern | No |
| 6 | **Team role + commission split tracking** | Maud | Partial — team_members exists; no split tracking |
| 7 | **Wholetail vs assignment decision helper** | Nico | No |
| 8 | **Pre-foreclosure / trustee-sale calendar** | Tova | No |
| 9 | **Cash-for-keys task template** | Wren | No |
| 10 | **Sub-to disclosure / due-on-sale warning** | Kev | No |
| 11 | **Persona-blend** (multi-persona on one org) | Sven, Yael | No |
| 12 | **Multi-touch drip sequences** | Bly | Partial — campaigns exist |

---

## Action queue

### A. Three new workflow templates

1. **`tpl_wholesaler_contract_signed_to_buyer_list`** —
   `deal.contract_signed` trigger. Auto-broadcast deal to the
   wholesaler's buyer list with criteria match.

2. **`tpl_wholesaler_assignment_fee_due`** —
   `deal.assignment_pending` trigger. 7-day countdown before
   assignment-fee collection; reminders + draft assignment doc.

3. **`tpl_wholesaler_cash_for_keys`** — `deal.occupied` trigger.
   Generate cash-for-keys offer letter; create timeline task for
   negotiation; remind about local relocation-assistance laws.

### B. New workflow trigger events

- `deal.contract_signed`
- `deal.assignment_pending`
- `deal.occupied`

### C. Documented follow-ups

`docs/exhaustive-completion/wholesaler-followups.md` — for all queued
items (end-buyer CRM, per-state assignment templates, double-close
workflow, MLS-status trigger, per-list ROI dashboard, team commission
split tracking, wholetail decision helper, pre-foreclosure calendar,
sub-to disclosure plumbing, persona-blend support).
