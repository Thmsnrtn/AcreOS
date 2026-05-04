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
