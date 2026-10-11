# Founder decisions — 2026-10-11

**Date:** 2026-10-11

**Source:** the founder's answer to a decision picker in the coordinating
session of 2026-10-11. The coordinating session relayed the answer to the W2
audit session, which built it on `claude/w2-land-data`. This record was written
by the implementing session from that relay; it did not see the picker itself.
Only the founder can rescind it.

## Stop using the Tennessee statewide non-commercial parcel service — now

The TNMap "Tennessee Property Boundaries Public Use" feature service says in
its item description: "This service is not intended for commercial use."
Until this decision AcreOS used it for every Tennessee coordinate lookup (the
seeded statewide `county_gis_endpoints` row), for the W2 accuracy-sample
extraction and for the county census's per-county counts.

**Decision:** AcreOS does not use it on any path — no live lookup, no stored
copy, no new sample, no census count.

What a Tennessee coordinate lookup does instead (parcels lookup by lat/lng,
field scout, drive mode, the deals tax lookup, the provider registry's
coordinate lookups and the Regrid provider's fallback):

1. AcreOS's own kept parcels for the county answer, when the county has been
   loaded from the Comptroller's per-county download (its terms allow
   commercial use; the founder downloads each county and runs
   `scripts/land-data/build-tn-showcase.ts --comptroller <dir>`, which now
   stores the parcels and records the upload receipts).
2. Otherwise the org's **own** Regrid key, when it has one.
3. Otherwise a refusal in plain words: "Tennessee parcel details aren't
   available yet — they arrive as county data loads…". The platform Regrid key
   is not used for Tennessee points.

Lookups by APN are unchanged (they never used the statewide service).

How it is enforced — on the URL, so it cannot come back through a row, a
registry entry, a script or a pasted link:

- `server/services/providers/blockedOutboundSources.ts` names the service (by
  its service path and its ArcGIS item and map ids);
- `fetchGeo` refuses it, and `server/outboundGuard.ts` — the first import of
  both `server/index.ts` and `server/worker.ts` — refuses it for every `fetch`
  in the process; scripts that fetch URLs from data import the same guard;
- migration 0271 deactivates any `county_gis_endpoints` row that points at it,
  and the statewide seed no longer carries it;
- `tests/unit/tnPublicServiceNeverFetched.test.ts` holds the population (every
  outbound HTTP primitive in `server/`, `scripts/`, `script/`), with canaries,
  and forbids any copy of the URL outside the registry;
- `tests/unit/tnCoordinateLookupRouting.test.ts` drives every coordinate entry
  point; `tests/db/countyPipelineOnBuiltSchema.ts` (CI build-schema step 8b)
  proves the routing and the loader against a real database.

Recorded in `server/services/providers/data-licenses.ts` (the
"TN Property Boundaries Public Use service" entry).

**Open for the founder:** `tests/fixtures/land-data/tn-accuracy-sample.json`
(the W2 accuracy gate's 20 labelled DeKalb parcels) was extracted from this
service before the decision and is committed in a public repository. Its
labels come from federal servers, but the parcel shapes and ids came from the
service. Re-extracting it from a Comptroller download once one is loaded would
remove the last trace; the extraction script was deleted with this decision.
