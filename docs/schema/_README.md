# Schema docs per vertical

**Why:** Panel-300 T12 (eng-leadership convergence) — bus-factor
mitigation. The full `shared/schema.ts` is 17,468 LOC and growing
linearly with each vertical. A new engineer onboarding to AcreOS
needs to be productive on Land in week-1 without holding the entire
schema in their head.

These docs are per-vertical 1-page references. Each doc covers:
- The 5-10 tables the vertical owns
- Foreign-key relationships within and across verticals
- Cross-vertical join points (where Land + NI + BH compose)
- Known cliffs (where the schema breaks down or compromises)
- Migration history references

The docs are descriptive, not prescriptive — they describe what
exists, not what should exist. Refactoring opinions live in
`docs/exhaustive-completion/panel-300/_PLAN.md`, not here.

## Index

- [land.md](./land.md) — Land (leads, properties, deals, comps, mailers)
- [note-investor.md](./note-investor.md) — Note Investor (notes, payments, amortization)
- [buy-and-hold.md](./buy-and-hold.md) — Property management (tenants, leases, rent ledger, screening)
- [fix-and-flip.md](./fix-and-flip.md) — FF (rehab budgets, draws, contractor 1099s)
- [wholesale.md](./wholesale.md) — W (assignment contracts, double-close, buyer-match)
- [subdivision.md](./subdivision.md) — SD (parcel splits, CC&Rs, permits)
- [cross-cutting.md](./cross-cutting.md) — billing, audit, AI, communications, e-signatures
