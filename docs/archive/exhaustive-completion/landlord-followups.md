# Buy-and-hold landlord vertical — follow-up work

Companion to `pillar-p-landlords-25-personas.md`. The persona doc
ships three workflow templates (lease renewal countdown, maintenance
request triage, rent receipt). Queued items below.

### 1. Tenant-screening checklist + provider integration (~1w build)

Cira. Standard screening checklist (credit, criminal, eviction,
employment) + provider integration (TransUnion SmartMove, Experian
Rent Bureau). Add `tenant_screening_reports` table.

### 2. Per-state landlord-tenant law reference module (~1w build)

Fey, Iri. Reference module like taxLienStateRules.ts: per-state
deposit limits, notice periods, eviction-process duration, late-
fee statutory caps. ~50 jurisdictions.

### 3. Section-8 voucher tracker + HQS schedule (~1w build)

Gita, Reyna. Track voucher payment per unit, HQS inspection
schedule, recertification deadlines. Plug into rent.received and
HUD-payment workflows.

### 4. Maintenance vendor pipeline + scorecard (~5d build)

Marek, Devi. Vendor schema (already exists) + scorecard
(on-time-pct, on-budget-pct, defect-rate, last-job-date) + auto-
selection by request category.

### 5. Per-property cash-flow tracker (~5d build)

Eko, Niko. Per-property aggregated rent / mortgage / tax / insurance
/ maintenance with monthly cash-flow chart. Distinct from per-org
P&L; this is per-asset.

### 6. STR/MTR-specific workflow templates (~1w build)

Pia (STR), Oz (MTR). Cleaning-turnover schedule, per-state STR
regulation reference (taxes, permits), Airbnb/Vrbo listing-sync.

### 7. Per-entity LLC accounting + state filing calendar (~1w build)

Lev. Each property's LLC has its own annual filing, registered-
agent renewal, franchise tax. Schema: `entities` table linked to
properties; workflow: filing-deadline alerts.

### 8. Lot-rent tracking (MHP) (~5d build)

Sven. Mobile-home-park-specific: per-pad rent (park-owned vs
tenant-owned), pad-vs-home payment distinction.

### 9. Cash-for-keys + eviction workflow (~1w build)

Wren. Pillar M crossover (cash-for-keys template exists for
wholesalers) + eviction-specific: per-state notice templates,
court-filing tracker, post-judgment writ-of-possession schedule.

### 10. Depreciation + Schedule-E + cost-seg workflow (~1.5w build)

Xan. Per-property depreciation schedule (residential 27.5y vs
commercial 39y, cost-seg-accelerated), auto-generate Schedule-E
data export for tax prep.

### 11. STR-specific cleaning-turnover schedule (~3d build)

Pia. Per-booking cleaning task with turnover-time tracking; auto-
schedule cleaner; flag clean-overruns that affect next check-in.
