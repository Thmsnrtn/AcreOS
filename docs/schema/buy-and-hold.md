# Buy-and-Hold (Property Management) vertical schema

Tenant screening + lease + rent ledger. FCRA-bounded (panel-300 D6 may
geofence to TX/OK only at launch).

## Core tables

| Table | Purpose |
|---|---|
| `tenants` | Tenant records. PII-heavy — encrypted at-rest fields. |
| `tenant_screenings` | Screening run per tenant. Permissible-purpose row. |
| `rental_leases` | Lease instruments. |
| `rent_charges` | Scheduled rent obligations. |
| `rent_payments` | Received payments. |
| `late_fee_rules` | State-specific late-fee policies (RS-1 era). |
| `move_inspections` | Move-in/out inspections + photos. |
| `maintenance_tickets` | Repair workflow. |
| `security_deposits` | Deposit ledger. |
| `lease_addendums` | Addendum versioning. |
| `lease_tenants` | M2M between leases and tenants. |
| `fcra_attestations` | Per-org annual + per-lookup attestations. Includes substantive_form jsonb (panel-300 G4). |

## FK relationships within BH

```
tenants ←─ lease_tenants ─→ rental_leases
                                  ↓
                           rent_charges
                                  ↓
                           rent_payments
                                  ↓
                           late_fee_rules
```

Tenant screening operates BEFORE a lease exists — screenings can
attach to a tenant who never converts to a lease.

## Cross-vertical join points

- `rental_leases.property_id` → `properties.id` (Land)
- `tenant_screenings.attestation_id` → `fcra_attestations.id`
- `tenants.organization_id` → `organizations.id`

## Known cliffs

- **`tenant_pii_*` scope (panel-300 #8 role-scoped permissions)**
  must guard every read. The middleware exists; routes are wired
  incrementally.
- **State-specific disclosure templates** live in
  `statutory_forms` (panel-300 #10). Cron-driven dispatch in
  `disclosure_timing_scheduled` ensures TILA timing by construction.
- **Skip-trace integration** lives one vertical over (Land/leads)
  but feeds tenant background checks. Permissible-purpose gate
  (FW-WYNNE-1) applies.
- **Fair-lending audit** (panel-300 #34) reads tenant_screenings
  outcomes for monthly disparate-impact analysis.

## Migration history pointers

- BH-1, BH-2 (tenant + lease schema).
- RS-1, RS-2, RS-3 (FCRA permissible-purpose, adverse-action,
  audit trail).
- FW-WYNNE-1, FW-WYNNE-2 (skip-trace gate, substantive form).
- panel-300 G4 (substantive 3-screen attestation UI).
- panel-300 #34 (fair-lending audit cron).
