# Pillar O — Fix-and-flippers as 25 personas

Twenty-five composite fix-and-flipper personas across newcomer-to-
veteran, single-flip to assembly-line, owner-occupy-and-flip vs full
rehab, hard-money vs cash, sub-$100k to luxury.

The `fix_flipper` persona has vocabulary entries (Lead → Distressed
owner, Deal → Flip, Property → Project) and one workflow template
(`tpl_fix_flip_rehab_kickoff` shipped in an earlier session). Plenty
of room to deepen.

---

## The 25 personas

### Beginner tier

1. **Andre · First-flip novice** — One project in hand. Has never run
   a contractor. **Gap:** general-contractor onboarding workflow.
2. **Brina · Owner-occupy-and-flip** — Lives in the flip during
   rehab to qualify for capital-gains exemption. **Gap:** none specific.
3. **Cole · House-hacking starter** — Lives in one unit, rents the
   others; eventually exits with a flip. **Gap:** Pillar P crossover.
4. **Deepa · DIY-heavy beginner** — Does her own work to keep costs
   low. **Gap:** time-budget tracker (DIY hours vs subcontracted).
5. **Eli · Family-financed first flip** — Personal loan from family;
   needs to document for tax purposes. **Gap:** family-loan
   documentation templates.

### Intermediate tier

6. **Fala · Hard-money operator** — Uses 12-month interest-only HML
   on every flip. **Gap:** HML extension/refinance timeline tracker.
7. **Gus · 5-flips-a-year operator** — Stable cadence, 2 in flight
   at any time. **Gap:** none specific (covered by existing template).
8. **Han · Multi-state flipper** — Operates in 3 states; permit rules
   differ. **Gap:** per-state permit + inspection requirements.
9. **Iyer · Burnout-recovering** — Burned out; now does 1-2 flips/yr
   to stay in market. **Gap:** none specific.
10. **Jade · Sub-$100k niche** — Buys cheap houses in working-class
    neighborhoods, light rehab, retail. **Gap:** rehab-budget templates
    for typical sub-$100k scope.
11. **Kev · Wholetailer hybrid** — Some deals are quick wholesale,
    some are full flip. **Gap:** Pillar M crossover (wholetail-vs-flip
    decision).
12. **Lin · Luxury-flip specialist** — $1M+ purchase price; high-end
    finishes; long timeline. **Gap:** vendor-management for premium
    trades.

### Veteran tier

13. **Marek · Assembly-line operator** — 20+ flips/year, dedicated
    crews. **Gap:** crew scheduling across multiple projects.
14. **Noor · Joint-venture operator** — Each flip is a separate
    single-purpose LLC with a JV partner. **Gap:** per-flip P&L for
    distribution waterfall.
15. **Oz · Pre-foreclosure / short-sale specialist** — Buys NOD
    properties before auction. **Gap:** Pillar M / L crossover.
16. **Pia · BRRRR convertor** — Sometimes flips, sometimes refis and
    holds (BRRRR). **Gap:** decision-helper post-rehab.
17. **Quill · Veteran with crew bench** — Bench of 4 GCs by trade
    specialty. **Gap:** GC marketplace + scorecard.
18. **Reyna · Section 8 ARV target** — Rehabs to Section-8 voucher
    eligibility, then flips to a landlord buyer. **Gap:**
    Section-8-readiness checklist.

### Niche tier

19. **Sven · Foreclosed-property specialist** — Bank REO only.
    Specific paperwork. **Gap:** REO acquisition workflow.
20. **Tova · Energy-efficient retrofitter** — Aims for ENERGY STAR
    or Net-Zero finish for marketability. **Gap:** energy-cert
    tracking + tax-credit application.
21. **Una · Mid-century-modern specialist** — Niche aesthetic; small
    buyer pool. **Gap:** marketing-audience tagging.
22. **Vela · Distressed-condo flipper** — Condo HOA reserves +
    special-assessment risk. **Gap:** HOA-doc-review checklist.
23. **Wren · ADU-add specialist** — Buys SFR, adds ADU, flips both
    units. **Gap:** Pillar N crossover (ADU permit tracker).
24. **Xan · Tax-credit-leveraged** — Historic-rehab tax credit. Long
    paper trail. **Gap:** tax-credit application workflow.
25. **Yara · Co-investor flipper** — Sells fractional ownership of a
    flip to retail investors via Reg-D. **Gap:** investor-cap-table
    tracking (probably out of scope).

---

## Synthesized insights

| # | Insight | Personas |
|---|---|---|
| 1 | **Rehab-stage milestones** (demo → frame → mechanicals → finishes → punch list → list) with auto-task chains | Andre, Marek, all |
| 2 | **HML/extension timeline tracker** | Fala |
| 3 | **Per-state permit + inspection requirements** | Han |
| 4 | **GC scorecard + crew scheduling** | Quill, Marek |
| 5 | **JV / single-purpose LLC P&L** | Noor |
| 6 | **BRRRR-vs-flip decision helper** | Pia |
| 7 | **Section-8 readiness checklist** | Reyna |
| 8 | **REO acquisition workflow** | Sven |
| 9 | **Energy-efficiency cert tracking** | Tova |
| 10 | **HOA-doc-review checklist** | Vela |
| 11 | **Historic-rehab tax credit application** | Xan |
| 12 | **Rehab-budget templates per scope** | Jade |

---

## Action queue

### A. Three new workflow templates

1. **`tpl_flip_milestone_demo_complete`** — `rehab.milestone` trigger
   with stage=demo. Auto-creates the framing kickoff task,
   subcontractor schedule confirmation, mid-project budget review.
2. **`tpl_flip_hml_extension_warning`** — `note.balloon_approaching`
   (reuse, with flip-specific filter) at 60d before HML maturity.
   Refi vs sell vs extend decision task.
3. **`tpl_flip_listing_ready`** — `rehab.punch_list_complete`
   trigger. Generate listing prep tasks: photography, staging,
   pricing-vs-comps decision, listing-agent selection.

### B. New workflow trigger events

- `rehab.milestone` (with `stage` parameter — replaces multiple per-
  stage events with one parameterized event)
- `rehab.punch_list_complete`

### C. Documented follow-ups

`docs/exhaustive-completion/fix-flipper-followups.md` for the rest.
