# Tax-delinquent vertical — follow-up work

Companion to `pillar-l-tax-delinquent-25-personas.md`. The persona doc
ships three workflow templates + a 51-jurisdiction state-rules
reference module. Everything below is queued for later passes.

## Out of scope for the Pillar L PR

### 1. Tax-deed acquisition flow distinct from certificate (~1.5w build)

Today `tax_delinquent` is one persona; tax-lien certificate and
tax-deed are two distinct sub-flows (Fern, Noor, Quoc personas). The
schema needs a `salesType` distinction on the acquisition record;
the UI needs deed-vs-cert variants of the detail page.

### 2. Quiet-title workflow (~1w build)

Tax-deed buyers (Fern, Noor, Quoc) often inherit cloudy titles. The
quiet-title legal process is a state-specific filing + notice
sequence. Build: a per-state checklist module + a generic task
template tied to a property's title-status field.

### 3. Redemption-likelihood score (~3d build)

Jonas, Olin, Una price secondary-market certificates partly on
"will the owner redeem before expiry." A simple scoring model:
owner-occupancy + property-value + months-since-last-payment +
homestead-flag. Surface on the certificate detail page.

### 4. Pool-bidding strategy + bid-down ladder (~1w build)

Olin (hedge fund), Xio (FL bid-down specialist) need a tool that
helps target a yield-after-bid-down on an auction batch. Pure
calculator + auction-batch UI.

### 5. Probate-status overlay (~3d build)

Kira, Wren operate at the intersection of probate + tax-delinquent.
Schema: `tax_delinquent_acquisitions.probate_status` (in_probate /
closed / unknown). Surface on the detail page with a flag.

### 6. Payment-plan modifier workflow (~3d build)

Rae's persona — wants to cure rather than foreclose. The Pillar L
PR ships a one-shot outreach letter; the full modifier workflow
(generate amortized payment plan, track cure ladder, auto-credit
payments toward redemption) is a separate build.

### 7. Mobile-home tax-deed flag (~1d build)

Sage's persona — DMV-titled MHs. Same flag as Pillar K's Iris
(`acquired_notes.mh_dmv_titled`). Add to tax-delinquent acquisitions
schema.

### 8. Commercial tax-deed variant (~1w build)

Tariq's persona — commercial collateral. Different recovery model
(no owner-occupant; income-property valuation). Separate detail-
page variant.
