# Founder decisions — 2026-10-27 (V-Notes-1 storage)

## Notes V1 gets two append-only, org-private tables

**Decision (Tom, 2026-10-27, in session):** approve **+2 tables** for V-Notes-1.
The table-count ratchet moves 746 → 748, one table per workstream as each lands.

- **`note_field_observations` (N1, migration 0292).** Every value any source
  states for an acquired note's field, with its provenance: source, the file row
  and cell it came from, as-of, confidence and decay. It also holds recorded
  absences (`searched_none`). It serves N1 provenance and both N4 items
  (disagreement capture and negative knowledge).
- **`note_events` (N3).** Outcome events and forward-calendar dates. This is the
  minimal registry the spec assumed existed. It did not.

Both tables are append-only by trigger and org-private (`organization_id NOT NULL`,
every reader filters on it). A row leaves only with its note, through the note's
cascade, so organization erasure still completes.

**Options that were offered.**
- +1 table, carrying both observations and events (rejected: it mixes two shapes,
  and the calendar becomes a filtered view, not a registry).
- No new tables, using jsonb on `acquired_notes` (rejected: append-only could not
  be enforced in the database, so a disagreement's losing value would survive only
  by convention).

**Why it was the founder's call.** The table-count ratchet is down-only and was set
"strict" by the founder (2026-07-16), so a bump is a conscious yes.
