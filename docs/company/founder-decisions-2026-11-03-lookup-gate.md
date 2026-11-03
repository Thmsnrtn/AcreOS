# Founder decisions — 2026-11-03 (statewide point lookup is gated behind the license dossiers)

Made by Tom on 2026-11-03 after the LQ-12–16 legal audit found the live
point-lookup licensing contradiction (finding "live point-lookup licensing
posture contradiction (LQ-13/LQ-14)"; LQ-12/14 dossier register §8).

## 1. A seeded statewide source serves point lookups only when cleared

**Decision:** a seeded statewide parcel source may serve point-lookup results
ONLY when its register state is cleared for lookup. Until then it is gated.

- **What "gated" means:** the source behaves exactly as if it were not
  seeded. A coordinate lookup falls through to the next source or to Regrid,
  unchanged. Cleared sources and Regrid are unaffected.
- **Where clearance lives:** `LOOKUP_CLEARANCE` in
  `server/services/openData/statewideSourceRegistry.ts`. It mirrors dossier
  register §8.4, one explicit entry per seeded state.
- **State today:** none of the nine seeded states (FL, MT, NC, WA, NJ, AR,
  NY, WI, MD) is cleared. TN is not seeded (excluded 2026-10-11).
- **How a state is cleared:** a reviewed code change. Its entry becomes
  `status: "cleared"` with a determination, the deciding words quoted, a URL
  and a date. The state is then added to `CLEARED_FOR_LOOKUP` in
  `tests/unit/statewideLookupClearance.test.ts`.
- **Context:** this is the register's Option A (gate lookup like bulk),
  adopted as the interim posture. Option B (per-state lookup determinations)
  remains the route by which states can re-open one at a time.

**Unchanged by this decision:** the bulk-ingest posture, the dossiers
themselves, and the server-side non-persistence of lookup results.
