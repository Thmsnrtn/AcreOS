---
id: portfolio-import-and-review
name: Portfolio Import and Review
title: Portfolio Import and Review
goal: Import a CSV of 50+ parcels into the CRM, verify field mapping and deduplication, and review the imported portfolio.
description: Bulk CSV import of parcels with field mapping, dedup, and portfolio review.
start_url: /
max_steps: 130
timeout_minutes: 25
estimated_duration_minutes: 20
starting_state: Authenticated user with a CSV file ready to upload containing 50-100 parcel records.
success_criteria:
  - CSV upload completes without timeout or error for a 50+ row file
  - Field mapping UI allows mapping arbitrary column names to AcreOS canonical fields
  - Duplicate detection identifies and flags records that already exist in the CRM
  - Import summary displays total records, new records added, duplicates skipped, and errors
  - Imported records appear in the leads or properties list with correct data
  - Portfolio Map shows the imported parcels plotted at correct geographic locations
success_conditions:
  - Import completes with a summary showing record counts
  - Field mapping step is completed successfully
  - At least 80% of records import without errors
  - Imported records are browseable in the leads list
abandonment_criteria:
  - CSV upload silently fails with no error message or progress indicator
  - Field mapping UI does not recognize common column names like APN, Parcel ID, or Owner Name
  - Import takes more than 60 seconds for a 50-row file with no progress feedback
  - All records are rejected as duplicates when this is a first-time import
  - Imported data is visibly corrupted (wrong values in wrong columns)
common_failure_modes:
  - CSV with non-UTF8 encoding (Windows-1252, ISO-8859-1) causes garbled characters in names
  - Column headers with spaces or special characters fail to map automatically
  - Large imports (500+ rows) time out the HTTP request without background processing
  - Duplicate detection matches on partial APN due to leading-zero stripping
  - Import succeeds but geocoding fails for all records, leaving the Portfolio Map empty
---

# Journey Context

Most real estate professionals do not start with an empty CRM. They come to AcreOS with an existing portfolio — a spreadsheet of parcels they own, leads they have been tracking, or lists they have pulled from county assessors and data providers. The import experience is often their very first interaction with the product beyond the dashboard, and it sets the tone for whether they trust the system with their data.

This journey tests the full import-to-review cycle. The persona has a CSV file — typically exported from Excel, Google Sheets, PropStream, or a county assessor website — containing 50 to 100 parcel records. The columns might be labeled anything: "Parcel Number" instead of "APN," "Assessed Val" instead of "assessed_value," "Prop Address" instead of "situs_address." The import flow must handle this variability gracefully.

The persona navigates to the import function, which might be accessible from the Leads page, the Properties page, or a dedicated Import section. They select their CSV file and upload it. The system parses the file and presents a field-mapping interface: on the left, the CSV column headers; on the right, AcreOS's canonical fields (APN, owner_name, owner_mailing_address, situs_address, acreage, assessed_value, legal_description, land_use_code). The persona maps each column, skipping any that do not have a corresponding AcreOS field.

Auto-detection is important here. If the CSV has a column called "APN" or "Parcel ID" or "PIN," the system should auto-map it to the APN field. If it has "Owner" or "Owner Name," auto-map it to owner_name. The persona should only need to manually map the ambiguous or unusual columns. If every column requires manual mapping, the experience feels tedious and error-prone.

After mapping, the persona clicks "Import" and waits for processing. For a 50-row file, this should take no more than 10-15 seconds. A progress indicator — even a simple percentage or "Processing row 35 of 52" — prevents the persona from wondering if the system froze. For larger files (500+), background processing with a notification on completion is essential.

The import summary is the payoff moment. The persona sees: 52 records processed, 48 imported successfully, 3 duplicates skipped, 1 error (row 17: missing required field "APN"). They can click into the error detail to see exactly which row failed and why. This transparency builds confidence.

Post-import, the persona navigates to the leads list and verifies that the imported records appear with correct data. They spot-check a few records — does the acreage match? Is the owner name correct? Is the address properly formatted? They then switch to the Portfolio Map to see the parcels plotted geographically. Parcels that failed geocoding appear in a "needs review" list rather than silently disappearing.

What "good" looks like: the persona imports their spreadsheet in under 5 minutes, trusts that the data landed correctly, and feels confident adding more data over time. The import experience tells them "this tool was built by people who understand my workflow" — a crucial signal for retention.
