# Subdivider vertical — follow-up work

Companion to `pillar-n-subdividers-25-personas.md`. The persona doc
ships three workflow templates; queued items below.

### 1. Per-county subdivision-approval checklist module (~1.5w build)

Aaro, Dem, Marek. Reference module similar in shape to
`shared/regulatory/taxLienStateRules.ts` but county-scoped. ~100
counties pre-seeded with typical stages + durations; community can
contribute the rest. Wire to the plat-submitted workflow.

### 2. Vendor-status dashboard (~1w build)

Hark, Xara. UI surface per subdivision deal showing each vendor
(surveyor, engineer, county) and their current status / last update /
ETA. Schema: `subdivision_vendor_status` with vendor_type, status,
status_at, eta. Pillar M's wholeteam-coordination plumbing partially
overlaps.

### 3. Minor vs major sub decision helper (~3d build)

Bria. A 1-page calc: enter lot count + zoning + improvement plans →
output "minor sub allowed, X stages, est Y months" vs "major sub
required, A stages, est B months." Pure calc, no schema.

### 4. Lot-pricing dynamic helper (~1w build)

Ila. Holding-cost-aware pricing model: as approval timeline burns,
suggest pricing adjustments. Plug into existing `lot-pricing.tsx`
surface.

### 5. Conservation-easement tracking schema (~3d build)

Jules. `properties.conservation_easement_json` field capturing
holder, acreage, monitoring schedule, tax-benefit history.

### 6. HOA-formation document templates (~1w build)

Tor. Per-state HOA-formation document library (Articles, Bylaws,
Declaration of CCRs); plug into e-sign + recording pipeline.

### 7. Phase-tracking schema (~5d build)

Wynn. `subdivision_phases` table linking parent property → phase
metadata (phase_number, recorded_date, lot_count, status). Plug into
lot generation workflow.

### 8. Bond-status tracker (~3d build)

Vox. Schema: `subdivision_bonds` with bond_type, amount, expiry,
release_status. Workflow: alerts before bond expiry.

### 9. Solar-lease-vs-sale calc (~2d build)

Sky. Calculator that compares per-lot sale price vs solar-lease
annual income NPV.

### 10. ADU permit-status tracker (~3d build)

Karim. Per-property `adu_permit_status` field + workflow templates
for ADU permit lifecycle.

### 11. Note crossover (lot-sold-with-financing) (~3d build)

Cara. When a subdivision lot sells with seller financing, auto-
create the originated-note record. Pillar K plumbing exists; needs
a hook on the lot-sale workflow.
