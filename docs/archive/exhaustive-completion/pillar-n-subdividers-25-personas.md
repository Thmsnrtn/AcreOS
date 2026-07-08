# Pillar N — Subdividers as 25 personas

Twenty-five composite subdivider personas across spectrum: minor lot
splits to full plat developments, infill to greenfield, rural to
suburban, residential to mixed-use.

The `subdivider` persona has minimal vertical-specific plumbing today
(vocabulary entries only). Subdividing is process-heavy and timeline-
heavy — multiple agency approvals, surveys, engineering, recording,
each on its own clock.

---

## The 25 personas

### Beginner tier

1. **Aaro · First-split novice** — Bought 10ac, wants 2 lots. Doesn't
   know what permits he needs. **Gap:** per-county subdivision-
   approval checklist.
2. **Bria · Minor-subdivision specialist** — 2–4-lot splits only;
   avoids full plat. **Gap:** "minor sub" vs "major sub" decision-
   helper.
3. **Cara · Owner-financed lot seller** — Subdivides + sells with
   seller-financing. **Gap:** Pillar K crossover — note origination
   per lot.
4. **Dem · First-plat applicant** — Submitting a 12-lot plat. Doesn't
   know the agency-review sequence. **Gap:** plat-approval timeline
   tracker.
5. **Esme · Family-lot-split operator** — Splits to family members
   under family-transfer exemptions. **Gap:** none specific.

### Intermediate tier

6. **Fitz · Rural land splitter** — Splits 80–160ac into 5–10ac
   parcels. **Gap:** road / utility easement tracking per lot.
7. **Gita · Suburban infill** — Tear-down + duplex/triplex split.
   **Gap:** zoning-overlay tracker.
8. **Hark · Mid-stage developer** — Engineering ordered, surveyor on
   site, county at second review. **Gap:** vendor-status dashboard
   (where is each task).
9. **Ila · Lot-pricing tactician** — Adjusts lot pricing as approval
   timeline burns. **Gap:** dynamic-pricing helper tied to
   holding-cost timeline.
10. **Jules · Conservation-easement-aware** — Sells off lots,
    retains common space with conservation easements. **Gap:**
    easement-tracking schema.
11. **Karim · ADU + lot split** — Splits + adds ADUs simultaneously.
    **Gap:** ADU permit-status tracker.
12. **Lev · Tax-delinquent-acquisition-then-subdivide** — Pillar L
    crossover. **Gap:** clean transition from tax cert → subdivision
    pipeline.

### Veteran tier

13. **Marek · 50-lot plat developer** — Major sub with full
    engineering. Long timeline. **Gap:** Gantt-style timeline view.
14. **Niki · Affordable-housing partnership** — Subsidized lot
    development with city/county partnerships. **Gap:** grant-
    tracking schema.
15. **Oz · Recreational-lot subdivider** — Rural recreational tracts
    sold with mountain views, lake access. **Gap:** marketing-asset
    library per lot (vista photos, drone, terrain).
16. **Pelle · Industrial-park subdivider** — Industrial sites split
    into smaller commercial lots. **Gap:** none specific (commercial
    is its own future pillar).
17. **Quill · Veteran-of-100 subdivisions** — Pure timeline operator.
    **Gap:** historical comparison ("this plat looks like 2018-Q3,
    expect 14 months").
18. **Rune · Wholesaler-to-subdivider hybrid** — Buys with intent to
    split; wholesales if subdivision proves uneconomic. **Gap:**
    persona-blend (also Pillar M).

### Niche tier

19. **Sky · Solar-array land sub** — Splits raw land for solar
    leases. **Gap:** lease-vs-sale calc per lot.
20. **Tor · HOA-formation operator** — Creates HOAs as part of
    subdivision package. **Gap:** HOA-formation document templates.
21. **Una · Cluster-housing operator** — Cluster-zoning subdivisions
    with shared open space. **Gap:** cluster-vs-conventional
    decision helper.
22. **Vox · Performance-bond required** — Some jurisdictions require
    performance bonds before recording. **Gap:** bond-status tracker.
23. **Wynn · Phased-recording operator** — Records subdivision in
    phases (Phase 1 → 2 → 3) over years. **Gap:** phase-tracking
    schema.
24. **Xara · Surveyor-coordinator** — Owns surveying capacity; runs
    multiple subs in parallel. **Gap:** survey-status across deals.
25. **Yon · Right-of-way dedication** — Donates ROW to county for
    road access. **Gap:** ROW-dedication tracking + tax-benefit
    documentation.

---

## Synthesized insights

| # | Insight | Personas |
|---|---|---|
| 1 | **Per-county subdivision-approval checklist** | Aaro, Dem, Marek |
| 2 | **Minor vs major sub decision helper** | Bria |
| 3 | **Vendor-status dashboard (survey, engineering, county)** | Hark, Xara |
| 4 | **Plat-approval timeline tracker (Gantt)** | Dem, Marek |
| 5 | **Lot-pricing dynamic helper tied to holding cost** | Ila |
| 6 | **Conservation-easement tracking** | Jules |
| 7 | **HOA-formation document templates** | Tor |
| 8 | **Phase-tracking schema** | Wynn |
| 9 | **Bond-status tracker** | Vox |
| 10 | **Solar-lease-vs-sale calc** | Sky |
| 11 | **ADU permit-status tracker** | Karim |
| 12 | **Note crossover (sold lots with seller financing)** | Cara |

---

## Action queue

### A. Three new workflow templates

1. **`tpl_subdivision_plat_submitted`** — `plat.submitted` trigger.
   Auto-generate the approval-timeline tracker with all expected
   review stages + estimated timeline.

2. **`tpl_subdivision_vendor_milestone`** — `subdivision.vendor_milestone`
   trigger. When survey/engineering/county milestone hits, notify
   operator + create downstream task.

3. **`tpl_subdivision_phase_recorded`** — `subdivision.phase_recorded`
   trigger. When a phase records, auto-create lot rows in property
   table + queue marketing tasks per lot.

### B. New workflow trigger events

- `plat.submitted`
- `subdivision.vendor_milestone`
- `subdivision.phase_recorded`

### C. Documented follow-ups

`docs/exhaustive-completion/subdivider-followups.md` for the rest.
