# Founder decisions — 2026-11-05 (B1 slice 1 inbox; Notes V2 delinquency ladder and ATR gate)

All three entries below were made by Muse (COO) on 2026-11-05 under the
founder's standing decision rule. Each answers a contradiction an agent's
Step 0 found between a package spec and the code on main, and reported instead
of building through.

## 1. B1 slice 1: the decision inbox keeps its existing approval controls (Option A)

**Decision (Muse, 2026-11-05, under the founder's standing decision rule):**
correct the B1 slice-1 spec so it matches the founder approval write path that
already exists, instead of assuming that path does not exist. Option A was the
session's recommendation and is the one chosen.

**Why it came up.** The spec described the Decisions door as read-only and
treated the approval write path as future work (P2b). Step 0 on main found:
- `POST /api/founder/autopilot/pending-actions/:id/{approve,reject}` is live, and
  approving executes the held autopilot action;
- `founder-decisions.tsx` is the only UI for that path and for six other founder
  write paths.

A read-only rebuild in place would have removed the founder's only approval UI.
The evidence is in `docs/evidence/2026-11-03/b1-slice1-step0-inventory.md`
(PR #453).

**What this means.**
- The decision-card semantics (evidence, consequence, deadline) are built
  additively inside the existing page.
- The existing write controls stay.
- The read-only constraint becomes: the package adds zero non-GET routes and
  zero new mutating client calls.

PR #453's stop report is the deliverable for that package.

## 2. Notes V2 Leg 1: default review is an operator act, never derived from aging

**Decision (Muse, 2026-11-05, under the founder's standing decision rule):**
the ladder's `default_review` state is entered only when an operator records
it. It is never derived from aging. This is option (a).

**Why it came up.** The Notes V2 spec (§3.1) entered `default_review` on the
`default_candidate` aging band and placed it after `stage_90_plus`. On main,
`NOTE_DELINQUENCY_THRESHOLDS` (`server/services/notes/acquiredNoteSchedule.ts`)
starts `default_candidate` at 31 days. Built as written, a note at day 31 would
have entered both `stage_30` and `default_review`, and every 60- and 90-day
note would already have been in default review.

**What this means.**
- **The derived ladder stays factual.** It holds only the day-band stages,
  `stage_30`, `stage_60` and `stage_90_plus`, derived from the aging chain.
- **Default review is recorded on the `note_events` spine** with its actor and
  timestamp, like the other operator-recorded entries.
- **It sits outside the derived sequence.** An aging run never creates it, at
  any age. One operator recording creates it exactly once.
- **The amendment to §3.1's stage table and the §7.1 tests ships with Leg 1.**

**Rejected.**
- (b) Deriving default review at 90+ days. An aging fact must not silently
  become a servicing determination.
- (c) Re-banding the shared delinquency vocabulary. The aging chain and its
  `financeAgent.ts` mirror stay untouched.

## 3. Notes V2 Leg 3: the existing ATR determination record is reused, and the activation bypass is closed

**Decision (Muse, 2026-11-05, under the founder's standing decision rule):**
cancel the new determination record in Notes V2 §5.4 and reuse the existing
`notes.atr_determination` record.

**Why it came up.** §5.4 said nothing records what an ATR determination was,
and that Leg 3 would add that record. On main it already exists:
- `notes.atr_determination` is a structured jsonb holding the eight
  §1026.43(c)(2) factors, verification-document pointers, the QM class and an
  attestation;
- `persistAtrDetermination` (`server/services/atrSafeHarbor.ts`) writes it;
- the gated `POST /api/notes/:id/originate` route requires it.

Step 0 also found that `POST /api/notes` still honours `status: "active"` with a
bare `atrDeterminationCompleted: true` that has no record behind it.

**What this means.**
1. **No second determination record and no change to the factor set.** Whether
   the eight-factor shape is the right standard stays fenced for counsel under
   Notes V2 §9 blockers 1 and 4.
2. **The bypass closes.** Activation requires the record to exist, on every
   path. `POST /api/notes` no longer activates on a bare flag.
3. **The full creation-path census (§2.8) runs under the corrected premise.**
   Every path it finds is gated the same way.
4. **The overwrite-in-place concern.** An append-only audit entry is added on
   the `note_events` spine only if it rides the existing
   `persistAtrDetermination` path cleanly: one event per determination write,
   no change to the column. If it does not, the column stays as it is, the
   concern is reported as a named follow-up, and the persist path is not forked.
5. **The seller-finance counter (§5.2) and the exemption-element gates proceed
   as specced.**
