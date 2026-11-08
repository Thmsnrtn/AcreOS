# Founder decisions — 2026-11-05 (wholesale Leg 2: the buy-box table)

Recorded 2026-11-05 by the implementing session. The ruling was relayed by the
coordinator at 22:21 ET in reply to the Step 0 report. It falls under the
founder's full-readiness directive of 2026-11-05 ("finish building ALL
verticals").

## 1. One append-only table for the wholesaler's buy box

**Decision:** build `wholesale_buy_boxes`, the one table the wholesale package
pre-named, under the same fence as the Subdivision screen-runs precedent.

- **Migration:** `migrations/0305_wholesale_buy_boxes.sql`, mirrored in `scripts/migrate.mjs`. It was renumbered from 0301 on 2026-11-08, because 0301 is assigned to Notes V2 (#461).
- **What the table is:**
  - it holds the buy box and its versions;
  - it is append-only (UPDATE and TRUNCATE are refused by trigger);
  - it is tenant-scoped (`organization_id NOT NULL`, org-leading unique key);
  - a row leaves only with its organization (ON DELETE CASCADE).
- **What rides along:** nothing. No other schema change is part of this.
  `scripts/ratchets/table-count.json` goes 748 → 749 with this file cited.
- **Why Step 0 stopped:** no existing home could hold a buy box together with
  its versions. `organizations.underwritingDefaults` is jsonb overwritten in
  place, so earlier versions would be lost.

**Not decided here:** any sourcing, skip-trace or list building. These stay
out. Triage reads only the org's own candidates.
