-- Brigid §3 (Lens 19) — subdividers burn $7-12k/month while the plat sits
-- in the planning queue. Surfaces a to-date carrying-cost tile on the
-- Subdivision tab. Columns are nullable: existing plans keep zero burn
-- projection until the operator fills in their actual surveyor /
-- engineer / road-bond numbers. Stored as bigint cents to match the rest
-- of the subdivider schema (lot_basis_allocations, etc.).

ALTER TABLE subdivision_plans
  ADD COLUMN IF NOT EXISTS engineering_cost_cents bigint,
  ADD COLUMN IF NOT EXISTS survey_cost_cents bigint,
  ADD COLUMN IF NOT EXISTS road_construction_cost_bond_cents bigint;
