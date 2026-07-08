# Wholesaler vertical — follow-up work

Companion to `pillar-m-wholesalers-25-personas.md`. The persona doc
ships three workflow templates; the items below are queued.

### 1. Cash-buyer CRM (~1.5w build)

Jen, Pia, Ari all need a buyer-side CRM with criteria-based
matching. Schema: `buyers` table with criteria_json (counties,
price-band, max-rehab, deal-type), `buyer_matches` linking
deals → buyers. Existing `buyer-blasts` route does broadcast; this is
the persistent CRM half.

### 2. Per-state assignment-of-contract templates (~1w build)

Gus, Iyer. Need 50 state-specific templates + the fee-disclosure
language each state requires. Plug into native e-sign stack.

### 3. Double-close (transactional-funding) workflow (~1w build)

Hana. Back-to-back closings with transactional lender. Needs:
funding-line tracker, both-side HUD coordination, day-of timing
calendar.

### 4. MLS-status-change trigger (~3d build)

Cami targets expired/withdrawn MLS listings. Wire to MLS API (or
poller) and create a workflow trigger when a lead's MLS status
changes.

### 5. Per-list ROI dashboard (~3d build)

Fern. Schema: `outreach_lists` with cost + response + closed-deal
attribution; dashboard surfaces $/deal per list.

### 6. Team commission split tracking (~5d build)

Maud. Schema: `deal_splits` (deal_id → team_member_id, pct,
finalized_at). Existing team_members + permissions plumbing.

### 7. Wholetail vs assignment decision helper (~2d build)

Nico. Pure-calc surface comparing assignment-fee vs wholetail margin
after rehab + holding cost. UI on deal detail page.

### 8. Pre-foreclosure / trustee-sale calendar (~5d build)

Tova. Per-county trustee-sale schedule poller + a calendar surface
on /pre-foreclosure.

### 9. Sub-to disclosure + due-on-sale warning (~2d build)

Kev. Specific disclosures + per-state "subject-to" template;
risk-acknowledgement step in the deal-signing flow.

### 10. Persona-blend (multi-persona per org) (~1w build)

Yael, Sven. Many wholesalers ALSO do other verticals. Schema:
`organizations.active_personas` jsonb array (vs. current single
`investorType`). UI: persona switcher in the top nav.
