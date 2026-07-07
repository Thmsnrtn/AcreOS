# Note Investor vertical — follow-up work

Phase 5 §5 (Q4 2026). The foundation PR (`feat(notes): note-investor
vertical foundation …`) ships data model + onboarding fork + 1099-INT
extension. Everything below is explicitly **out of scope** for that PR
and tracked here so the next contributor knows what's left.

## Out of scope for the foundation PR

### 1. Full BPO + tape diligence workflow (~3w build)

A note-investor's diligence flow doesn't look like a land flip's — it's
tape-driven (a CSV of dozens to hundreds of notes from a seller),
borrower-locate, BPO ordering on each underlying parcel, payment-history
verification, and lien-position confirmation. None of those are wired up.

What we have today:
- `acquired_notes` table can store the note metadata.
- `note_payments` table can store payment history once entered manually.

What's missing:
- Tape import wizard (CSV → mapped diligence queue).
- BPO ordering integration (no provider wired in `server/services/providers/`).
- Lien-position lookup (county-level title search beyond what
  `routes-title-search.ts` currently does for land flips).
- Borrower-locate provider (separate from existing skip-trace —
  borrower-locate looks for the *current* address of a known borrower,
  vs. skip-trace which finds an unknown owner from a parcel).
- Diligence checklist + per-tape decision queue (buy / pass / counter
  per row of the tape).

### 2. Sophie agent expansion (note-specific intelligence)

`server/agents/sophie/` has the land-deal intelligence playbook. For
notes, Sophie needs:
- Note-yield-vs-purchase-price scoring (replaces deal-margin on land).
- Borrower-default-risk score (uses payment-history regularity,
  property-tax-delinquency on collateral, FICO if available).
- Re-default predictor for re-performing notes.
- Servicer-handoff guidance (which notes warrant outsourced servicing).

These are non-trivial — each is its own scoring pipeline. Track as
separate work items.

### 3. Note assignment paperwork (e-sign templates)

When we acquire a note we get assignment paperwork from the seller; when
we sell a note we issue assignment paperwork to the buyer. AcreOS ships
its own native e-sign stack (per
`/Users/user/.claude/projects/-Users-user-AcreOS-AcreOS/memory/project_native_esign.md`)
and we already have the building blocks in
`server/routes-esign.ts` + the document signing pages. We need to add:
- Allonge + Assignment-of-Mortgage templates per state (50 templates).
- Notary-block layout for jurisdictions that require it.
- Recording-package generation (assignment + previous chain-of-title +
  cover sheet for the county recorder).

The PDF rendering plumbing exists in `server/services/form1099Batch.ts` —
similar pattern, different content.

### 4. /notes/:id detail surface

The foundation PR ships the list view at `/notes` and the API for
detail (`GET /api/notes/:id`). The detail-page UI component is not yet
built. The list rows currently navigate to `/notes/:id` but that route
is not registered — clicking a row will fall through to the catch-all.

Build order for the next PR:
1. `client/src/pages/note-detail.tsx` — payer card, balance + amort
   schedule, payment ledger, status pill + transition controls.
2. Register at `/notes/:id` in `App.tsx`.
3. CSV import wizard at `/notes?action=import` (the existing button on
   the list page navigates to this URL but the wizard isn't built).
4. Add-note modal at `/notes?action=new`.

### 5. Sidebar — fully hide land-only outreach for pure notes

The foundation PR hides `/campaigns`, `/direct-mail`, `/sequences`,
`/blind-offer-wizard`, and `/offers/batches` for orgs with
`investorType = 'notes'`. There are still references to these features
inside other surfaces (the dashboard widgets, the founder-todo feed,
the AI command palette suggestions). A pass over those for note-investor
visibility is tracked as a separate UX-cleanup work item.

### 6. Pax persona vocabulary surfaces

`personaVocabulary.ts` now carries the note-investor terms (per spec —
Lead → Note opportunity, Property → Collateral, etc.). Pages opt into
persona-aware copy via the vocabulary registry; only a handful do today.
A second-pass migration of land-flip pages to use `getTerm()` so they
auto-translate is tracked separately.

Specifically not yet routed through the registry:
- `/leads`, `/leads/:id` — still hardcode "Lead"/"Property".
- `/deals`, `/deals/:id` — still hardcode "Deal".
- Most dashboard widgets.

### 7. /notes 1099-INT pre-flight check

The 1099-INT batch generator now unions originated + acquired interest
sources. There's no UI surface yet for note investors to validate which
of their acquired notes are blocked from 1099 issuance (missing W-9,
sub-$600 interest, etc.). Add a `/notes/tax-readiness` panel that
mirrors `/finance/tax-readiness` for originated notes.

---

## Pillar K (25-persona insight mine) — additional follow-ups

Added 2026-05-14 after working through 25 composite note-investor
personas (see `pillar-k-note-investors-25-personas.md`). The five
items in the action queue (workflow templates, persona vocabulary,
RMLO advisor, reperforming progress, this doc) shipped in PR
`pillar-k:`. The items below didn't make the cut but are real.

### 8. Note "pool" entity (~1.5w build)

NPL funds (Nico), discount-fund operators (Reyna), institutional buyers
(Sully) and prolific flippers (Octavia) all acquire notes in *pools*
and need per-pool P&L + analyst attribution.

Schema sketch:
- `note_pools` table — id, org_id, name, acquisition_date,
  acquisition_price_cents, expected_recovery_cents.
- `acquired_notes.pool_id` — nullable FK.
- `note_pool_diligence_decisions` — per-row analyst decisions
  (buy / pass / counter) with reasoning + analyst_user_id.

Then surface per-pool P&L on `/notes/pools/:id`. ~1.5 week build.

### 9. IRA-custodian routing + templates (~3d build)

Brendan (self-directed IRA), Yuna (Roth back-door + IRA) need every
note transaction routed through their custodian for signature +
recording. Schema sketch: `acquired_notes.ira_custodian` enum +
`ira_custodian_pending` status; one templatable letter per common
custodian (Quest Trust, Equity Trust, IRA Services).

### 10. Manufactured-home title flag (~1d build)

Iris's notes are secured by MH titled at the DMV not the county.
Single boolean: `acquired_notes.mh_dmv_titled`. Surface on the
note detail page with a "where to record" hint per state.

### 11. Servicer mode (Ursa — large standalone effort)

Ursa is a licensed sub-servicer. AcreOS currently assumes the operator
owns every note in their book. Servicer mode would invert that —
segregated per-owner accounting + remittance. Substantial effort:
new ownership-of-record table, P&L per owner, monthly remittance
generator. Track as a future Pillar K-2.

### 12. Broker mode (Talia — large standalone effort)

Talia brokers between sellers and buyers without holding paper. The
platform assumes operator-as-buyer; broker mode is a different mental
model. Track alongside servicer mode for a future pillar pass.

### 13. Partial-note (carved-interest) accounting (~1w build)

Xander buys partial interests (e.g. first 60 months of P&I). Needs:
`acquired_notes.parent_note_id` FK (self-reference); split
amortization schedule renderer; per-partial yield calc.

### 14. Commercial-land note variant (~1w build)

Vasco buys notes secured by commercial land — yield comes from the
underlying lease, not borrower paycheck. Different underwriting model.
Likely needs a new collateral type + a leased-asset yield calculator.

### 15. Cross-vertical portfolio yield rollup (~3d build)

Park (family office) needs combined yield across notes + rentals +
land. Probably belongs in Pillar P (landlord-and-cross-vertical
personas) rather than K.

### 16. PII-classified borrower-narrative field + redacted export (~3d build)

Willa (foreclosure-rescue) captures borrower hardship narratives in
free text. She needs the field PII-classified so it auto-redacts on
exports she shares with co-investors or LPs. Wire into the existing
DSAR/redaction plumbing.

### 17. Exception-based alerts digest (~3d build)

Maris (100+ notes self-serviced) doesn't want to see every payment-
received notification — only the exceptions (delinquencies, escrow
shortfalls, insurance lapses, balloons due). The workflow engine
already fires all the right events; this is an aggregation surface +
preference settings.

