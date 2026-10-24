# Historical-use screening fixtures (D2f)

Every file here is **SYNTHETIC**. None was recorded from a live source: EPA and
Indiana state hosts could not be reached from the build container (DNS failure,
2026-10-24). Each file is `{ "synthetic": true, "description", "shapeBasis",
"payload" }`, and the test serves `payload` as the upstream HTTP body. The payload
shapes follow the fields the broker's parsers read in
`server/services/data-source-broker.ts` (`queryEpaFrs`, `queryEpaData`). They
were not recorded from a real response. Record ids are `SYNTHETIC-*`. The parcel
is a synthetic parcel reference at an Indiana coordinate, not a real parcel
record.

When a run with network access records real responses, replace these files with
those responses and put the URL and retrieval date in each file. That recording
also serves as each adapter's positive control (see
docs/land-data/INTEGRATION-D2f.md).
