# Journey 06: Scale Operation

## Goal

Import a large dataset of 10,000 parcels via CSV, apply filters to narrow results, and export the filtered dataset — validating that AcreOS handles scale without degradation.

## Starting State

- Logged in to AcreOS with an active account.
- Has a well-formatted CSV file with 10,000 parcel records ready (columns: APN, county, state, acreage, owner name, mailing address).
- Account may already have some parcels; this tests additive bulk import.

## Steps

1. Navigate to the import feature.
2. Upload the 10,000-row CSV file.
3. Map CSV columns to AcreOS fields (if required).
4. Initiate the import.
5. Monitor import progress (progress bar, count, estimated time).
6. Verify import completion — confirm record count matches expected.
7. Navigate to the parcel list.
8. Apply filters (e.g., state = "TX", acreage > 5, acreage < 40).
9. Verify filter results load within 5 seconds.
10. Verify filter count is plausible given the dataset.
11. Select filtered results and initiate export.
12. Download the export file.
13. Open the export file and verify it contains the correct filtered records.

## Acceptance Criteria

| # | Condition | Measurement |
|---|-----------|-------------|
| A1 | Import feature is discoverable | User finds the import entry point within 1 minute |
| A2 | 10,000 rows import successfully | Final count in system matches CSV row count (minus any documented rejections) |
| A3 | Import provides progress feedback | User sees progress indicator, not just a spinner with no context |
| A4 | Import completes in reasonable time | Under 5 minutes for 10,000 rows; user is informed if it will be processed asynchronously |
| A5 | Rejected rows are reported | If any rows fail validation, the count and reasons are displayed — not silently dropped |
| A6 | Filtering responds within 5 seconds | From applying a filter to seeing updated results: under 5 seconds |
| A7 | Filter results are correct | Filtered parcels match the criteria applied; spot-check 5 records manually |
| A8 | Export contains correct data | Exported file includes all filtered records with correct field values; row count matches filter count |
| A9 | UI remains responsive throughout | No frozen tabs, no "page unresponsive" warnings, no degraded interaction speed |

## Abandonment Criteria

The persona should realistically give up if any of the following occur:

- **Import hangs with no feedback:** The upload appears to start but provides no progress indication for over 1 minute.
- **Filter is unusably slow:** Applying or changing a filter takes more than 10 seconds with no loading state.
- **Export is incomplete:** The exported file has fewer rows than the filter count, or fields are missing/corrupted.
- **Browser becomes unresponsive:** The tab freezes, memory spikes cause crashes, or scrolling the parcel list stutters badly.
- **Cannot find import or export features:** After 2 minutes of looking, the user cannot locate either capability.

## Failure Conditions

These are unrecoverable errors that terminate the journey immediately:

- **Import crashes:** The upload endpoint returns a 500, times out, or drops the connection mid-upload.
- **Silent data loss:** Import reports success but the actual count is significantly lower than expected with no error report.
- **Data corruption:** Imported parcels have fields in wrong columns, garbled characters, or truncated values.
- **Export produces empty or wrong file:** The download is a 0-byte file, contains headers only, or includes unfiltered records.
- **System-wide degradation:** The import causes other features (navigation, search, dashboard) to become unusable for other users or the current session.
- **Out of memory crash:** The browser tab crashes during import, filtering, or export of the large dataset.
