# AcreOS Comprehensive Simulation Test Spec

## Deal Feed Pipeline Tests

### DF-01: Standard Feed Generation
**Given:** Org with 3 target counties (Hudspeth TX, Cochise AZ, Otero NM)
**When:** Generate deal feed
**Then:** 10+ opportunities returned, sorted by composite score descending
**Verify:** Each opportunity has: apn, county, state, sizeAcres, compositeScore (0-100), radarScore, motivationScore, countyScore, lcsScore

### DF-02: No Target Counties Fallback
**Given:** Org with 0 target counties
**When:** Generate deal feed
**Then:** Graceful fallback to national top 10 opportunities (not an error)
**Verify:** Results come from diverse counties, not all from one state

### DF-03: Composite Score Formula
**Given:** Feed results with known sub-scores
**Then:** Verify: compositeScore = (radarScore * 0.30) + (motivationScore * 0.30) + (countyScore * 0.20) + (lcsScore * 0.20) within ±1 tolerance

### DF-04: Pattern Boost — Closed Deal in County
**Given:** Org has a closed deal in Hudspeth County
**When:** Generate feed with Hudspeth as target
**Then:** Hudspeth parcels receive a boost in ranking compared to a feed generated without the closed deal

### DF-05: Feedback Loop — Repeated Passes
**Given:** Org passes on 5 parcels > 10 acres (marks as "not interested")
**When:** Generate next feed
**Then:** Subsequent composite scores for > 10 acre parcels decrease (system learns the preference)

---

## Negotiation Pipeline Tests

### NEG-01: Full Offer Flow
**Given:** Lead with property data
**When:** Initiate offer → select tier (market) → generate letter → simulate seller response → analyze → suggest counter
**Then:** Each step produces valid output; letter includes property address, offer amount, and buyer name

### NEG-02: Motivation-Driven Strategy
**Given:** Lead with motivation signal "found_money" (inherited land, no attachment)
**When:** Generate offer suggestions
**Then:** Strategy selection includes "anchor low" or equivalent aggressive strategy

### NEG-03: Voice Learning in Offer Letters
**Given:** Two orgs with different voice profiles (Org A: formal, Org B: casual)
**When:** Generate offer letter for the same property for each org
**Then:** Letters differ in tone, vocabulary, and sentence structure while conveying the same terms

---

## Compliance Gate Tests

### COMP-01: Dodd-Frank Interest Rate
**Given:** Create note in California (usury limit ~10%)
**When:** Set interest rate to 15%
**Then:** Dodd-Frank badge shows "Non-compliant", note creation is blocked with explanation

### COMP-02: TCPA DNC Filtering
**Given:** Campaign with 50 leads, 3 of which are on the DNC list (doNotContact = true)
**When:** Campaign pre-send validation runs
**Then:** 3 leads excluded from send list with TCPA reason, 47 proceed

### COMP-03: AML Cash Transaction Advisory
**Given:** Record a $15,000 cash purchase (above $10K threshold)
**When:** Transaction is saved
**Then:** AML advisory flag created on the deal (informational, not blocking), visible in compliance panel

---

## Land Credit Score Tests

### LCS-01: Full 6-Dimension Score
**Given:** Property with data for all 6 dimensions (flood, soil, access, utilities, topography, environmental)
**When:** Calculate LCS
**Then:** Score is 300-850, confidence is within ±20 of 100

### LCS-02: Partial Data Score
**Given:** Property with data for only 3 of 6 dimensions
**When:** Calculate LCS
**Then:** Score is 300-850, confidence is within ±75 (lower due to missing data)

### LCS-03: Calibration Weight Shift
**Given:** 20+ closed deal outcomes recorded with LCS scores
**When:** Run calibration loop
**Then:** Weights have shifted from defaults (verify via model_calibration_log table: adjustments array is non-empty)

---

## Communication Tests

### COMM-01: Inbound Email Processing
**Given:** Inbound email arrives at inbox+{leadId}-{hash}@replies.acreos.com
**When:** processInboundEmail() is called
**Then:** Email stored in lead_emails table, lead status updated to "responded", activity log entry created, unread count incremented

### COMM-02: SMS Conversation
**Given:** Lead with phone number, TCPA consent = true
**When:** Send SMS from lead detail
**Then:** Message stored, appears in conversation view with outbound direction, timestamp, and "delivered" status

### COMM-03: Email Compose from Deal
**Given:** Deal with associated lead email
**When:** Open email compose, select "Closing coordination" template, send
**Then:** Email sent via SES, stored in lead_emails as outbound, appears in activity timeline

---

## Offline Cache Tests

### OFF-01: Deal Feed Caching
**Given:** Today's deal feed has been loaded
**When:** Network disconnected
**Then:** Cached feed displays with offline banner. Feed data matches the last fetched version. Timestamp shows "Cached: [time]"

### OFF-02: Queued Actions During Offline
**Given:** Network is disconnected
**When:** User queues a note update
**Then:** Action stored in pending queue. When network reconnects: sync completes, toast shows "1 action synced", data matches the queued update

---

## Edge Case Matrix

### EDGE-01: Null Address Property
**Given:** Property with address = null, apn = "123-456-789"
**Then:** All surfaces display "Unaddressed Parcel — 123-456-789" (not empty string, not "null")

### EDGE-02: Null Acreage Property
**Given:** Property with sizeAcres = null
**Then:** Displays "Acreage unknown" (not "0 acres", not "null acres")

### EDGE-03: Zero Freedom Target
**Given:** User freedom target = $0/month
**Then:** Freedom Meter shows "Set your freedom target" prompt (not Infinity%, not NaN%, not division by zero error)

### EDGE-04: Zero Purchase Price ROI
**Given:** Deal with purchasePrice = 0, salePrice = 50000
**Then:** ROI displays "N/A" (not Infinity%, not division by zero error)

### EDGE-05: Empty Deal Feed
**Given:** Target counties have no matching opportunities
**Then:** Deal Feed shows coaching empty state: "No opportunities found today. Try expanding your target counties or adjusting your criteria." (not an error page, not a blank screen)

### EDGE-06: LCS with No Enrichment
**Given:** Property with no enrichment data (all 18 sources unqueried)
**When:** Request LCS
**Then:** All 6 dimensions default to 50, total score is ~575, confidence displays as "Low" with explanation "Limited data available"

### EDGE-07: County Name Normalization
**Given:** Queries for "St. Johns" and "Saint Johns" (same county)
**Then:** Both resolve to the same county record. No duplicate counties created. Market intelligence data is shared between both spellings.

### EDGE-08: Concurrent Payment Recording
**Given:** Two simultaneous payment requests for the same note
**Then:** Only one payment is recorded (second receives a conflict error). Note balance is correct after both requests complete. No double-deduction.

### EDGE-09: Large CSV Import
**Given:** CSV with 10,000 leads
**Then:** Import completes within 60 seconds. All 10,000 leads are searchable. No duplicate creation. Progress indicator shows percentage.

### EDGE-10: XSS in Lead Name
**Given:** Lead created with firstName = `<script>alert('xss')</script>`
**Then:** Name stored in database as-is. On display, script tags are escaped (not executed). No alert dialog appears.
