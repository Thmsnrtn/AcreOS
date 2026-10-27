# Establishing a golden county

A golden county is the ground truth for one state's statewide parcel layer:
five parcels whose values a human read from the county assessor's own record.
It has two uses:

- **CI harness.** `tests/unit/flGoldenCounty.test.ts` runs every verified
  parcel's recorded layer attributes through the real normalizer. If a mapping
  change moves a real parcel off its ground truth, the test goes red.
- **Self-healing adapter (D2d).** `server/services/openData/adapterRemap.ts`
  may promote a proposed field remap only if the live layer, read through the
  proposed mapping, reproduces every verified value of all five parcels.

A state without one has **no ground truth**. Its adapter can never
auto-promote a remap, however clean the proposal looks. Every schema drift
stays a refusal until a human fixes the field map
(`tests/unit/adapterRemapNoGroundTruth.test.ts`).

Today only **FL** (Nassau County) is established. NC, WI, AR and MT have
seeded statewide layers but no golden county. IN and OH have no seeded layer
yet.

## Who does it

A human (the founder or COO) does it, from a live read of two public sources.
An agent never fills a slot from memory, from a search snippet, or by
inference. A slot with no human read stays empty. The container's network
proxy blocks the state GIS hosts and the assessor sites, so this cannot be
done from an agent session anyway.

## The five-parcel rule

`verifiedParcels()` in `shared/landData/goldenCounty.ts` returns ground truth
only when all of these hold:

1. The file's `status` is `"established"`.
2. **Exactly five** slots are fully verified. A verified slot has every one of
   `sourceParcelId`, `sourceAttributes`, a non-empty `assessorVerified`,
   `verifiedBy`, a `YYYY-MM-DD` `verifiedOn`, and an `https://`
   `assessorRecordUrl`.
3. The five are **five different parcels**. No two slots may share a
   `sourceParcelId`.

Four verified slots is not ground truth, and neither is five slots with a
repeated parcel. In either case nothing can be verified against the set. A
slot is either fully verified or fully empty (all six fields `null`). The
harness rejects a half-filled slot.

Each remapped field has its own proof minimum, in `adapterRemap.ts`. The
golden set must verify that field on **at least 3 parcels**, with **at least
2 distinct values**. Otherwise the remap of that field is *unprovable* and is
not promoted. Two reasons:

- A constant column (every parcel `100`) certifies any other column that
  also reads `100`.
- If a field is verified only on parcels where the right column and a wrong
  column happen to agree, the wrong column passes too. FL slots 1 and 3 are
  $100 common-area tracts where assessed value equals just value. On those two
  slots, a remap of `JV` onto an assessed-value column reproduces "truth".
  Only slots 4 and 5 tell the two columns apart
  (`tests/fixtures/remap/20-semantic-wrong-jv-to-av.json`).

## Choosing the five parcels

Pick parcels that can tell a right column from a wrong one:

- At least two parcels where **assessed value is different from market
  value**. Without them, an assessed-for-market swap cannot be detected.
- **Distinct owners and distinct situs addresses.**
- A **non-zero last sale price** on at least three parcels, with at least two
  distinct prices, if the state maps `lastSalePrice`. FL's five all read
  `SALE_PRC1 = 0` and do not verify it, so an FL sale-price remap can never
  auto-promote. That outcome is deliberate.
- Avoid using only HOA, common-area or $100 tracts. One or two are fine, as
  FL shows, but they prove little about values.
- Use parcels in **one county**, the same county the first live dry run
  streamed, and record it in `county` and `countyNote`.

## What to read, per parcel

**From the statewide layer**, the same endpoint the build uses, from
`server/services/statewideParcelEndpoints.ts`: query the parcel by its id and
copy the response's attributes **verbatim** into `sourceAttributes`. Copy
every mapped field, plus any field the layer uses to tell features apart, such
as the county code. Do not retype or reformat anything. Numbers stay numbers
and strings stay strings, exactly as served.

**From the county assessor's public record** for the same parcel, fill
`assessorVerified` using these keys:

| `assessorVerified` key | Canonical field   | What to read on the assessor record                                                                           |
|------------------------|-------------------|---------------------------------------------------------------------------------------------------------------|
| `ownerName`            | `owner`           | Owner of record, as the normalizer outputs it                                                                  |
| `situsAddress`         | `address`         | Situs / physical address                                                                                       |
| `assessedValueUsd`     | `assessedValue`   | The assessed value of the **same definition** the statewide field carries (FL `AV_NSD` = assessed, non-school) |
| `marketValueUsd`       | `marketValue`     | Market / just / full value, same roll year                                                                    |
| `lastSalePriceUsd`     | `lastSalePrice`   | Most recent qualified sale price                                                                               |

`legalDescription` has no verified key. A legal-description remap is never
provable and never auto-promotes.

Record **only the fields where the assessor's record equals the normalizer's
output exactly.** If the statewide compilation and the assessor genuinely
differ, for example a truncated owner name or one owner listed instead of two,
**omit the field** and explain it in `assessorNote`. Never round, trim or
reconcile a value to make it match. FL slots 1 and 2 omit `ownerName` for
this reason.

Then fill:

- `verifiedBy`: the name of the human who read both records.
- `verifiedOn`: the date of the read, `YYYY-MM-DD`.
- `assessorRecordUrl`: the assessor's public record page for the parcel
  (`https://`).

## Per-state field maps, from the seeded layers

These are the fields the golden set has to verify, so that a remap of each
one is provable. They come from each seed's `fieldMappings`.

| State | apn          | owner       | address        | assessedValue  | marketValue   | lastSalePrice | Notes |
|-------|--------------|-------------|----------------|----------------|---------------|---------------|-------|
| FL    | `PARCEL_ID`  | `OWN_NAME`  | `PHY_ADDR1`    | `AV_NSD`       | `JV`          | `SALE_PRC1`   | Established (Nassau) |
| NC    | `parno`      | `ownname`   | `siteadd`      | `parval`       | —             | —             | No golden county |
| WI    | `PARCELID`   | `OWNERNME1` | `SITEADRESS`   | `CNTASSDVALUE` | `ESTFMKVALUE` | —             | No golden county |
| AR    | `parcelid`   | `ownername` | `adrlabel`     | `assessvalue`  | `totalvalue`  | —             | No golden county |
| MT    | `PARCELID`   | `OwnerName` | `AddressLine1` | `TotalValue`   | —             | —             | No golden county |
| IN    | —            | —           | —              | —              | —             | —             | No seeded layer: seed and verify the layer first |
| OH    | —            | —           | —              | —              | —             | —             | No seeded layer: seed and verify the layer first |

Before you fill a slot, check the seed file's current map. It wins over this
table.

## Wiring it in

1. Add `shared/landData/golden/<st>-golden-county.json` in the FL file's
   shape (`state`, `county`, `countyNote`, `status`, five `parcels`). Start
   with `status: "pending_verification"` and empty slots.
2. Fill the slots as above. Set `status: "established"` only once all five
   are verified. The harness asserts that the status matches the slots.
3. Register the file in `GOLDEN_COUNTIES` in `shared/landData/goldenCounty.ts`.
4. Add a harness for the state, modeled on `tests/unit/flGoldenCounty.test.ts`.
5. In `tests/unit/adapterRemapNoGroundTruth.test.ts`, move the state from
   `NO_GROUND_TRUTH` to `HAS_GROUND_TRUTH` in the same commit. The registry
   test goes red until you do.

## Keeping it true

Assessed and market values are **certified-roll** values for a stated roll
year. When the county certifies a new roll, the live layer's values for the
golden parcels change. From then on, every remap verification for that state
fails. This is fail-closed and nothing wrong is promoted, but self-healing is
effectively off until someone re-verifies. So:

- Re-verify the five parcels after each certified roll. FL certifies roughly
  every October.
- Update both `sourceAttributes` and `assessorVerified`, plus `verifiedOn`.
- If a parcel was split, merged or retired, replace the whole slot. Never
  edit one half of it.
