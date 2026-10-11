# Land-data fixtures

## `tn-accuracy-sample.json`

Twenty DeKalb County, Tennessee parcels, the context layers clipped around each
(TIGER roads and places, NWI wetlands, FEMA NFHL flood, PAD-US, 3DEP elevation
tiles) and labels taken independently from the publishing servers. It is the
committed sample behind the W2 accuracy gate
(`tests/unit/landDataAccuracyGate.test.ts`, `shared/landData/factAccuracyGate.ts`).

**2026-10-11 — privacy trim (W3 part 0).** The parcel geometry and ids in this
file came from the Tennessee statewide public service, which is marked not for
commercial use and which AcreOS no longer calls (founder decision 2026-10-11).
The file never held owner names or mailing addresses. On this date every field
the accuracy test does not need was removed: the engine snapshot taken at
extraction (which carried an owner-derived field), and the subdivision and lot
names. Each parcel now keeps only `parcelKey`, `sourceParcelId`, `gisLink`,
`county`, `deededAcres`, `geometry`, `context` and `labels`. Git history was not
rewritten; older commits still hold the earlier copy.

**To do: replace this sample from a Comptroller download** once the founder runs
one (`scripts/land-data/build-tn-showcase.ts --comptroller`). The Comptroller's
terms allow commercial use, so the replacement will not depend on the retired
service. Re-extract the same strata (public-land, flood and no-road parcels),
re-label them from the publishing servers, and update the counts in
`FACT_ACCURACY`.

## The rule for every file here

`tests/unit/landDataFixturesCarryNoPersonalFields.test.ts` scans every JSON file
in this directory. It fails on a key that names an owner or contact detail, on a
value that looks like a street address, PO box, phone number or e-mail, and on
any parcel field the accuracy test does not need.
