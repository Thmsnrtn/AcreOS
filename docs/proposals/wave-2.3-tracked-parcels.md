# Proposal — Wave 2.3 (click-to-identify) and the `table-count` baseline

**Status: APPROVED and SHIPPED** — founder approved Option A in-session on
2026-08-11. `scripts/ratchets/table-count.json` moved 756 → 757 in the same
commit as the code, with the reasoning recorded in its `lastBumpNote` per the
ratchet's own procedure. The patch artifact this document originally carried
has been removed: the implementation is now the commit itself, so keeping a
second copy would be a duplicate that drifts.

**Raised:** 2026-08-11, during slice 12. Kept as the record of *why* the
schema grew by one, which is the question the ratchet exists to force.

---

## What you are being asked

Wave 2.3 is built, audited, and its three blocking defects are fixed. It cannot
ship because it adds one database table, and `table-count` is a **strict
down-only ratchet**:

```
[ratchet] table-count: FAIL — 757 > baseline 756 (+1 new occurrence of /pgTable\(/)
  Raising scripts/ratchets/table-count.json requires Iris-CTO sign-off.
```

That ratchet was your call ("strict", 2026-07-16) with a stated north star of
**≤450 tables**. It is the one gate a slice cannot turn green on its own, by
design — adding a table is supposed to cost a deliberate "yes, we need this."
So this is your decision, not mine, and slice 12 shipped without Wave 2.3
rather than bypass it.

**Option A — approve the raise (756 → 757).** Apply the patch, lower nothing,
ship click-to-identify with "Track this parcel" intact. One table, one feature,
one deliberate yes.

**Option B — ship identify-only, defer tracking.** Identify + inspector +
provenance + quick actions need no new table; only the watch-list does. The
count stays 756. This is a real scope reduction of the brief's exit line, which
is why I am not making it for you.

**Option C — pair the raise with a consolidation.** Approve 757 only if the
slice also retires a table, keeping the count flat and the north star moving.
The two orphans already in your queue (`agent_improvement_plans`,
`agent_synergy_map`) are the obvious candidates — but they are a **customer-data
deletion**, which is its own hard-stop and needs its own explicit yes.

My recommendation is **A**. The feature is real, the table is the honest shape
for it, and I checked for a reusable home before concluding that (below).

---

## Why a new table, and what was checked first

The builder searched for an existing table that could carry "this org is
watching this parcel" and rejected two candidates for cause:

- **`parcel_alerts`** is a change-EVENT log — `NOT NULL` on `alertType`,
  `field`, `dedupeKey`. Representing a watch there would require inventing an
  event that never occurred, which is fabrication in the exact sense the
  constitution forbids.
- **`saved_views`** is filter/view configuration. A watched parcel is not a
  view.

`tracked_parcels` is 7 columns with a unique index on
`(organization_id, state, county, apn)` — that index is what makes the
idempotency real rather than asserted: a second tap returns
`alreadyTracked: true` instead of a duplicate row. Both migration artifacts
ship (`migrations/0230_tracked_parcels.sql` **and** the `scripts/migrate.mjs`
mirror that production's release command actually runs), which is this repo's
canonical deploy-time defect and is covered by test.

---

## What the audit found, and what was fixed

The lane's independent verifier returned `DEFECTS_FOUND` with three blocking
items. All three shared one root cause — **the client dropped the geographic
context and the server never reconstructed it** — and all three are fixed in
the attached patch.

| # | Defect | Fix |
|---|---|---|
| 1 | The uncovered-county copy, the prefilled CTA and the "We checked…" auditability sentence were **unreachable in production**. A map tap sends `{lat, lng, apn}` and no county, so the resolver short-circuited to `location-unidentified` before the coverage question was asked. Worse, it inverted: a customer tapping inside a county **we already cover** was shown a "request coverage" CTA for it. | The resolver now establishes the county **server-side** from the nearest parcel we actually hold, so the coverage branches are reachable from a bare tap — and the answer still comes from our own data, never from a client hint. |
| 2 | The APN fast path returned **another county's parcel as a confident exact match**. APNs are unique only within a county and the matcher folds hyphens/case, so with no geographic predicate it took an arbitrary row and stamped `by: "apn", approximate: false` — the strongest confidence the API has, on the wrong parcel's owner, acres and value, which the quick actions would then carry onward. | An APN match must now be corroborated against the tapped point (boundary containment, or centroid within the same radius the centroid path uses). Ambiguity that survives is reported as a miss with its own sentence — two rows we cannot tell apart is not a fact about one of them. |
| 3 | The point path was **predicates AND truncation**: `.limit(200)` with no `ORDER BY` over a ~27 km box. Any county with real coverage holds far more than 200 parcels there, so a parcel we genuinely hold could render as "we could not identify a parcel" — a fabricated negative about our own coverage that only appears once coverage gets good. | The candidate read is now ordered nearest-first, which makes the limit a bound on **work** instead of a bound on **correctness**. The module header's "predicates, not truncation" claim is now true, with the one residual case (containment for a very large parcel in a dense cache) stated honestly rather than papered over. |

Also fixed from the same audit: a toast promising "your tracked list" — a
surface that does not exist; an unwired `GET /api/tracked-parcels` + its reader,
**removed** rather than shipped as a reader nothing reads; a schema/DDL FK
mismatch (`NO ACTION` in Drizzle vs `SET NULL` in both migration artifacts,
which no ratchet compares); a test mock more permissive than the SQL it stood
in for; a "one indexed read" latency promise the implementation does not make;
and a schema comment justifying a design choice with a sweep that does not
exist.

Three exit-test cases the audit proved were missing were added: a UI-shaped
request with no county, colliding normalized APNs across states, and more
candidate rows than the read limit with the true match last. The suite's
`orderBy` interpreter — previously a no-op, which made it blind to the property
that matters most — now evaluates the ordering and throws on any shape it does
not understand.

**Suite: 41 passing.** `tsc --noEmit` clean. Every gate green except
`table-count`.

---

## If you approve

```
git apply docs/proposals/wave-2.3-tracked-parcels.patch
# then, in the SAME commit, the deliberate yes:
#   scripts/ratchets/table-count.json: 756 -> 757
npm run check && npm test && npm run build
```

The patch is the whole lane: 12 files, 5 of them new. It was captured after the
audit fixes, not before.

## If you decline

Say so and I will produce the identify-only variant (Option B) as its own
slice — the resolver, inspector, provenance and quick actions are independent
of the table; only `trackParcel`/`untrackParcel`, the toggle, and the schema
block come out.
