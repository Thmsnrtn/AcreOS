# Pillar P — Buy-and-hold landlords as 25 personas

Twenty-five composite buy-and-hold landlord personas across spectrum:
accidental landlord to scaled portfolio operator, SFR to small-multi
to small-commercial, self-managed to fully-managed, in-state to
out-of-state.

The `landlord` persona has vocabulary entries (Property → Rental,
Deal → Acquisition, Closed → Leased) but minimal vertical workflows
beyond the existing land/notes plumbing.

---

## The 25 personas

### Beginner tier

1. **Adair · Accidental landlord** — Inherited a house, decided to
   rent instead of sell. **Gap:** owner-handoff workflow from
   acquisition to first lease.
2. **Bevin · House hacker** — Lives in one unit of a duplex, rents
   the other. **Gap:** none specific.
3. **Cira · First rental purchase** — Bought first SFR. Researching
   tenant-screening. **Gap:** tenant-screening checklist + provider
   integration.
4. **Devi · DIY-everything beginner** — Self-manages, self-fixes.
   **Gap:** maintenance-request → DIY-vs-call-contractor decision.
5. **Eko · Cash-flow-focused starter** — Optimizes for monthly
   cash-flow specifically. **Gap:** cash-flow tracker per property
   (vs. equity-build).

### Intermediate tier

6. **Fey · Multi-state owner** — 5 SFRs across 3 states.
   **Gap:** per-state landlord-tenant law reference.
7. **Gita · Section 8 specialist** — All units Section-8.
   **Gap:** voucher-payment tracker + HQS inspection schedule.
8. **Hari · Small-multi operator** — 2-4 unit buildings, 10 units
   total. **Gap:** common-area maintenance tracking.
9. **Iri · Out-of-state operator** — Texas rentals; lives in CA.
   **Gap:** local-rep / property-manager coordination workflow.
10. **Jay · 1031-into-rentals** — Sells appreciated properties; 1031
    into new rentals. **Gap:** Pillar K crossover (1031 timing
    + identification).
11. **Kim · Note + rental dual** — Notes are cash-flow; rentals are
    appreciation. **Gap:** cross-vertical yield rollup.
12. **Lev · LLC-per-property operator** — Each property in its own
    LLC for liability. **Gap:** per-entity accounting + filings
    calendar.

### Veteran tier

13. **Marek · 100-unit portfolio** — Self-managed via VA team.
    **Gap:** maintenance request triage + vendor pipeline.
14. **Niko · BRRRR-veteran** — Refis out cash; recycles capital.
    **Gap:** cash-out-refi timing + LTV monitoring.
15. **Oz · Mid-term-rental operator** — Furnished, 30-90 day stays
    (traveling nurses, insurance temps). **Gap:** MTR-specific
    listing platforms + booking calendar.
16. **Pia · Vacation-rental operator** — Short-term-rental (Airbnb,
    Vrbo). **Gap:** cleaning-turnover schedule + per-state STR
    regulation reference.
17. **Quill · Build-to-rent operator** — Builds SFR portfolios with
    builders. **Gap:** Pillar N crossover.
18. **Reyna · Affordable-housing operator** — Mission-aligned;
    accepts below-market rents. **Gap:** grant-tracking + LIHTC
    compliance.

### Niche tier

19. **Sven · Mobile-home park operator** — MHP-specific (pads,
    park-owned vs tenant-owned homes). **Gap:** lot-rent tracking.
20. **Tova · Self-storage operator** — Different asset class but
    same operator psychology. **Gap:** unit-rental tracker.
21. **Una · Senior-living operator** — Assisted-living facilities.
    **Gap:** out of scope — substantial regulatory load.
22. **Vela · Co-living operator** — Per-room rentals with shared
    common space. **Gap:** per-room lease tracking.
23. **Wren · Distressed-rental acquirer** — Buys occupied properties
    with delinquent tenants. **Gap:** cash-for-keys + eviction
    workflow.
24. **Xan · Tax-strategy-focused** — Optimizes around depreciation,
    cost-segregation, real-estate-professional status. **Gap:**
    Schedule-E + cost-segregation workflow.
25. **Yara · Syndication operator** — Raises from LPs; runs the
    deal. **Gap:** investor-cap-table (out of scope).

---

## Synthesized insights

| # | Insight | Personas |
|---|---|---|
| 1 | **Tenant-screening checklist + provider integration** | Cira, all SFR |
| 2 | **Per-state landlord-tenant law reference** | Fey, Iri |
| 3 | **Section-8 voucher payment + HQS schedule** | Gita, Reyna |
| 4 | **Maintenance-request triage + vendor pipeline** | Devi, Marek |
| 5 | **Lease renewal countdown + rent-review workflow** | All landlords |
| 6 | **Per-property cash-flow tracker** | Eko, Niko |
| 7 | **STR/MTR cleaning-turnover + per-state regulation** | Pia, Oz |
| 8 | **Per-entity LLC accounting + state filing calendar** | Lev |
| 9 | **Lot-rent tracking (MHP)** | Sven |
| 10 | **Cash-for-keys + eviction workflow** | Wren |
| 11 | **Depreciation + Schedule-E + cost-seg workflow** | Xan |
| 12 | **Cross-vertical yield rollup** | Kim |

---

## Action queue

### A. Three new workflow templates

1. **`tpl_landlord_lease_renewal_countdown`** —
   `lease.renewal_countdown_60d` trigger. 60 days before lease end,
   surface renewal-or-vacate decision + rent-review math + drafted
   renewal/vacate letters.
2. **`tpl_landlord_maintenance_request_triage`** —
   `maintenance.request_received` trigger. Auto-categorize urgency,
   route to appropriate vendor or DIY-decision based on type.
3. **`tpl_landlord_rent_received_receipt`** — `rent.received`
   trigger. Send receipt; update YTD income; flag if late-fee
   should have applied.

### B. New workflow trigger events

- `lease.renewal_countdown_60d`
- `maintenance.request_received`
- `rent.received`

### C. Documented follow-ups

`docs/exhaustive-completion/landlord-followups.md` for the rest.
