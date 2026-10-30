# Founder decisions — 2026-10-28 (V-Tax-1 storage and the national defaults)

Both made by Tom in session on 2026-10-28, after the read-only map of the tax code
that already existed on main `45ed282`.

## 1. Tax V1 storage: swap the dead tables for purpose-built ones

**Decision:** add four purpose-built tax tables and retire the four dead ones, so
the table-count ratchet stays at **748**.

- **New tables, landing with the workstream that needs each:**
  - county watch lists (T1);
  - per-field observations on imported tax lots, with provenance and recorded
    absences (T1/T4, the Notes N1/N4 pattern applied to tax);
  - sourced per-state/county procedure objects (T2);
  - tax calendar events (T2). `note_events` cannot hold them: it requires an
    acquired note.
- **Retired:** `tax_sale_alerts`, `county_redemption_rates`,
  `auction_readiness_checklists`, `lien_search_records`. Nothing in the
  repository reads or writes any of them.
  - Each is removed with a guarded drop that **refuses if the table holds any
    row**, so no data can be lost. A table that turns out to hold rows stops the
    migration and escalates. It is never dropped.

**Options that were offered.**
- Add the 4 new tables and keep the dead 4 (748 → 752): rejected.
- Repurpose the dead tables and widen `note_field_observations`, with no new
  tables: rejected. `tax_jurisdiction_rules` is keyed by state and cannot hold
  county rules without a key change.

**Why it was the founder's call.** The table-count ratchet is down-only and strict
(founder, 2026-07-16).

## 2. The national tax defaults on main: fix first, in their own PR

The tax package makes any hard-coded national tax workflow a stop condition. Main
had four:

- **12% simple interest** for any state with no encoded rule (`computeRedemptionAmount`).
- **The same quiet-title step dates in every state:** fixed day offsets (14 … 210)
  from deed recordation.
- **Owned deeds that weren't.** A hand-entered certificate in any of the 41 states
  with no encoded rule was recorded as `deed_obtained`, with the sale date as its
  redemption deadline.
- **An unknown county redemption period read as 12 months** in the county
  opportunity score.

**Decision:** fix them first, in a PR of their own (T0), before T1, so the V1
workstreams build on honest ground. Each now refuses rather than inventing:
- no rule means no computed amount, and the reason is stated;
- a certificate with no computable deadline is refused, unless the county's own
  deadline is entered with its source;
- quiet-title steps open undated;
- an unknown redemption period scores nothing.

**Options that were offered.**
- Fix inside T2: rejected, because the defaults would stay live on main until then.
- Leave them and build beside them: rejected, because the old surfaces would keep
  showing invented numbers next to the new ones.

## 3. T3a — an over-max bid: override with a stated reason (2026-10-29)

Recorded from the founder's message on 2026-10-29, after the audit of #422:

- **Accept the override as built.** A bid over the derived max bid is refused
  unless a reason is stated. With a stated reason it is recorded beside the max
  it exceeded, with the reason (`auction_bid_log.max_bid_cents_at_action` and
  `over_max_reason`).
- **Rejected: absolute refusal** of any bid over the max.
- The override path is not to be reworked. T3a's audit verdict stands as
  mergeable on spec once the T2b fix list lands and is re-audited.
