# Fix-and-flipper vertical — follow-up work

Companion to `pillar-o-fix-and-flippers-25-personas.md`. The persona
doc ships two milestone-template additions; queued items below.

### 1. HML extension/refinance timeline tracker (~3d build)

Fala. Per-flip hard-money-loan tracker (origination date, maturity,
interest-only period, extension options). Workflow alert at 60d /
30d / 7d. Combines with the existing tpl_note_balloon_approaching
template architecture.

### 2. Per-state permit + inspection requirements (~1w build)

Han. Reference module like taxLienStateRules but for permit/
inspection requirements. Pre-seed 20 most-active states.

### 3. GC scorecard + crew scheduling (~1.5w build)

Quill, Marek. Schema: `contractors` (already exists) + `gc_scorecard`
(on-time-pct, on-budget-pct, defect-rate, last-job-date) +
`gc_assignments` (which GC is on which flip when).

### 4. JV / single-purpose LLC P&L (~1w build)

Noor. Per-deal P&L view with distribution waterfall (capital first,
then pref, then carry). Tag deals with `deal_jv_id` linking to a
JV entity registry.

### 5. BRRRR-vs-flip decision helper (~3d build)

Pia. Calculator: post-rehab cash-out refi proceeds + monthly rent
NPV vs sale-now proceeds. UI surface on deal detail page.

### 6. Section-8 readiness checklist (~3d build)

Reyna. Per-state HQS (Housing Quality Standards) inspection
checklist module. Plug into the property-detail page.

### 7. REO acquisition workflow (~1w build)

Sven. Bank-REO specific document set + earnest-money handling +
"as-is" disclosure plumbing.

### 8. Energy-efficiency cert tracking (~3d build)

Tova. `properties.energy_cert_json` (cert type, score, date). Plug
into listing-prep workflow for marketing copy.

### 9. HOA-doc-review checklist (~3d build)

Vela. Per-condo HOA-doc-review template (reserve study, special
assessments, owner-occupancy ratio, litigation).

### 10. Historic-rehab tax credit workflow (~1w build)

Xan. Federal + state HTC application templates and tracking.

### 11. Rehab-budget templates per scope (~3d build)

Jade. Pre-built budget templates: light cosmetic, mid-grade, gut
rehab, structural. Pre-seed line items at typical $/sqft.
