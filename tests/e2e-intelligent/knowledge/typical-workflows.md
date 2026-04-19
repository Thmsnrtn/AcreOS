# Typical Workflows: Land Investing Operations in AcreOS

This knowledge file describes the concrete, step-by-step workflows that a land
investor executes inside AcreOS. The intelligent E2E test harness uses this to
generate realistic user journeys, validate pipeline stage transitions, and ensure
that no step is skipped or misordered.

---

## 1. Finding a List (Lead Sourcing)

The investor begins every deal cycle by obtaining a list of parcels and their owners
from a target county. This is the top of the funnel.

### Sources and Methods

- **County assessor download**: Many counties publish their tax roll as a
  downloadable CSV or fixed-width file. The investor navigates to the county
  assessor or GIS website, applies filters (land use code = vacant, acreage range,
  assessed value range), and downloads. AcreOS should accept CSV, TSV, XLS, and
  XLSX uploads.
- **PropStream export**: The investor logs into PropStream, sets filters (property
  type = "Vacant Land," location = target county, acreage >= 1, owner type =
  "Absentee," equity >= 50%), and exports up to 10,000 records at a time as CSV.
- **ListSource / DataTree pull**: Similar to PropStream but with different filter
  nomenclature. ListSource uses "land use codes" and "site influence" filters.
- **Regrid (formerly Loveland)**: Parcel-level data with GIS boundaries. Used when
  the investor wants shape files or needs to identify parcels visually on a map.
  Export as CSV or GeoJSON.
- **Batch pull from AcreOS providers**: If AcreOS has data provider integrations
  (Regrid API, DataTree API), the investor enters filter criteria directly in the
  app and pulls a list without leaving the platform.

### What the Test Harness Validates

- CSV/XLSX upload parses correctly with varied column names (e.g., "APN" vs
  "Parcel ID" vs "Parcel Number" vs "PIN").
- Duplicate detection fires on re-upload of the same county list.
- List metadata is captured: source, date pulled, county, state, record count.
- Large list uploads (10,000+ rows) do not time out.
- Field mapping UI allows the user to map arbitrary column names to AcreOS's
  canonical fields: `apn`, `owner_name`, `owner_mailing_address`, `situs_address`,
  `acreage`, `assessed_value`, `legal_description`, `land_use_code`.

---

## 2. Scrubbing a List (Data Cleaning)

Raw lists are dirty. The investor cleans them before mailing.

### Steps

1. **Remove duplicates**: Match on APN or on owner name + mailing address.
   Duplicates arise from overlapping data sources or from the same county list
   being pulled in consecutive months.
2. **Remove small parcels**: Filter out parcels below a minimum acreage threshold
   (commonly 1 acre, sometimes 0.5 or 5 acres depending on market strategy).
3. **Remove already-mailed**: Cross-reference against the CRM's mailing history.
   If this owner/APN received a mailer within the last 90-180 days, suppress it.
4. **Remove properties the investor already owns**: Match APNs against the
   investor's inventory.
5. **Remove corporate/government owners**: Filter out owners whose name contains
   "LLC," "Corp," "Inc," "County," "State of," "United States," "Trust" (optional --
   some investors mail trusts).
6. **Remove deceased owners**: If skip-trace data includes a deceased flag, remove
   those records (or route them to a specialized probate workflow).
7. **Normalize addresses**: Standardize mailing addresses to USPS format so
   direct-mail pieces are deliverable. AcreOS may integrate USPS address
   validation (SmartyStreets/Smarty, Lob verification).
8. **Tag and segment**: Apply tags like "5-10 acres," "desert," "timber,"
   "infill lot" based on acreage, land use code, and location.

### What the Test Harness Validates

- Duplicate detection works across multiple uploaded lists, not just within a
  single list.
- Filtering by acreage, assessed value, owner type, and mailing history produces
  correct counts.
- Suppression rules are applied in the correct order (e.g., dedup before mailing
  history check).
- The scrubbed list count is always <= the raw list count.
- Tags are applied correctly based on segmentation rules.

---

## 3. Skip Tracing

Many county records have outdated or incomplete mailing addresses. Skip tracing
fills in current contact information for absentee owners.

### Steps

1. **Select records needing skip trace**: Filter the scrubbed list for records
   with missing or likely-outdated mailing addresses.
2. **Submit batch to provider**: AcreOS sends the batch to a skip-trace API
   (BatchSkipTracing, BatchData, or REISkip). Payload includes owner name,
   last known address, and APN.
3. **Receive results**: Provider returns current mailing address, phone numbers
   (mobile, landline), email addresses, and confidence scores.
4. **Merge results**: AcreOS merges the returned data into the lead records,
   preferring high-confidence results.
5. **Handle failures**: Records that could not be matched are flagged for manual
   review or a second-pass skip trace with a different provider.

### What the Test Harness Validates

- Batch submission does not exceed provider API limits (typically 5,000-10,000
  records per batch).
- Credit deduction occurs correctly (skip traces cost $0.05-0.20 per record).
- Merge logic does not overwrite existing high-quality data with lower-confidence
  provider data.
- Phone numbers are stored in E.164 format.
- Provider circuit breaker trips after repeated failures and falls back to the
  next provider in priority order.

---

## 4. Direct Mail Campaign

The investor sends physical mail to property owners with an offer to buy their land.
This is the primary outbound marketing channel.

### Steps

1. **Design the mail piece**: Choose a format -- yellow letter, postcard (6x9 or
   6x11), professional letter, or blind offer letter. Templates are stored in
   AcreOS with merge fields: `{{owner_first_name}}`, `{{property_address}}`,
   `{{county}}`, `{{offer_amount}}`, `{{acreage}}`.
2. **Upload or select the mailing list**: The scrubbed, skip-traced list becomes
   the recipient list for the campaign.
3. **Configure the mail provider**: AcreOS integrates with Lob, PostGrid, or
   ClickSend for automated printing and mailing. The user enters API credentials
   (or AcreOS provides its own account).
4. **Set budget and schedule**: The investor sets a daily or total send limit
   (e.g., 500 letters/day for 10 days). This throttles inbound call volume to
   a manageable level.
5. **Launch campaign**: AcreOS submits the mail jobs to the provider in batches.
   Each mail piece gets a tracking ID.
6. **Track delivery**: AcreOS polls the mail provider for delivery status updates
   (processed, in transit, delivered, returned to sender).

### What the Test Harness Validates

- Merge fields render correctly in preview mode.
- Mailing list size matches the scrubbed list minus any suppressions.
- Budget caps are enforced (daily send limits, total budget).
- Campaign status transitions: `draft` -> `scheduled` -> `sending` -> `complete`.
- Returned-to-sender mail pieces are flagged in the CRM and the lead's
  `mailing_status` is updated.

---

## 5. Inbound Seller Response Handling

After mailers land, sellers call or text back. This is where the CRM earns its keep.

### Steps

1. **Inbound call routing**: Calls to the AcreOS tracking number are routed to
   the investor's phone or voicemail system. The system logs the call with
   caller ID and records a voicemail if unanswered.
2. **Voicemail screening**: The investor reviews voicemails and triages:
   interested, not interested, wrong number, angry/do-not-contact.
3. **Lead capture**: The investor (or a VA) creates or updates the lead record in
   the CRM with the seller's asking price, motivation level, timeline, and notes.
4. **Lead status update**: The lead moves from `new` -> `contacted` -> `qualified`
   or `dead`.
5. **Phone script execution**: The investor follows a structured phone script:
   verify ownership, ask about the property condition, ask about motivation for
   selling, discuss price expectations, and set a follow-up.
6. **Follow-up scheduling**: If the seller is interested but not ready, the
   investor schedules a follow-up call (7, 14, or 30 days) and AcreOS creates a
   task/reminder.

### What the Test Harness Validates

- Inbound calls are matched to the correct lead record by phone number.
- Lead status transitions follow the allowed state machine (no jumping from `new`
  directly to `closed`).
- Follow-up tasks are created with the correct due date.
- Do-not-contact flags prevent future mailers and calls to that record.
- Call logs are associated with the correct lead and campaign.

---

## 6. Blind Offer Generation

The investor generates a written purchase offer and mails it to the property owner.
This is distinct from a marketing mailer -- it is a legally binding offer.

### Steps

1. **Pull comparable sales**: AcreOS queries comps from the data providers --
   recent sales of similar parcels in the same county, same acreage range, same
   zoning. The system calculates a median sold price per acre.
2. **Calculate offer price**: The investor applies a percentage of the assessed
   value or a percentage of the comp-derived fair market value. Common formulas:
   - 25-35% of market value for cash offers.
   - 50-60% of market value for seller-finance offers.
   - Some investors use a flat $/acre by county derived from their own sales data.
3. **Generate offer letter PDF**: AcreOS merges the calculated offer amount into
   a letter template that includes: offer amount, property legal description, APN,
   terms (cash or seller finance), expiration date (typically 14-30 days), and
   instructions to accept.
4. **Attach purchase agreement**: Some investors include a one-page purchase
   agreement (land contract) for the seller to sign and return.
5. **Mail the offer**: The offer letter is sent via the direct-mail provider or
   printed and mailed manually.

### What the Test Harness Validates

- Comp queries return parcels within a reasonable geographic and temporal window
  (same county, sold within 24 months, acreage within 50% of subject).
- Offer price is within the configured percentage range of the comp-derived value.
- PDF generation includes all required fields and is not blank/corrupted.
- Offer expiration date is in the future.
- The offer amount is stored on the lead record and the lead status transitions
  to `offer_sent`.

---

## 7. Due Diligence

Once a seller accepts an offer, the investor performs due diligence before closing.
This is a checklist-driven process.

### Steps

1. **Title search**: Order a title search (or perform one via the county recorder's
   online portal). Verify the chain of title, identify liens, mortgages, judgments,
   easements, and mineral reservations. Flag anything that clouds the title.
2. **Tax status verification**: Confirm current-year and delinquent taxes. Calculate
   the total payoff including penalties and interest.
3. **Access verification (legal)**: Confirm the parcel has legal access -- a
   recorded easement or road frontage on a public road. Landlocked parcels with no
   recorded access easement are problematic.
4. **Access verification (physical)**: Use Google Earth, satellite imagery, or a
   site visit to confirm the property is physically reachable. A legal easement
   means nothing if the road is impassable.
5. **Zoning check**: Verify the zoning designation and what uses are permitted.
   Key question: can a single-family residence be built? Are mobile homes allowed?
6. **Flood zone check**: Query FEMA flood maps. Parcels in Zone A or AE require
   flood insurance, reducing the buyer pool.
7. **Wetlands check**: Check the National Wetlands Inventory (NWI) map. If more
   than a small percentage of the parcel is wetland-designated, buildability is
   compromised.
8. **Environmental review**: Check for proximity to Superfund sites, known
   contamination, or environmental restrictions (endangered species habitat,
   historical preservation).
9. **Utilities availability**: Determine proximity to electric, water, sewer, and
   natural gas. Off-grid parcels sell to a different buyer profile at a different
   price point.
10. **HOA/POA check**: If in a subdivision, verify HOA status, fees, and any
    delinquent assessments the investor must clear.
11. **Survey/boundary verification**: For larger or irregularly shaped parcels,
    a survey may be necessary. At minimum, verify the GIS boundaries match the
    legal description.

### What the Test Harness Validates

- Due-diligence checklist items are all present and in the correct state
  (`pending`, `passed`, `failed`, `waived`).
- A due-diligence item in `failed` state blocks the pipeline from advancing to
  closing (unless explicitly overridden with a reason).
- Tax payoff amount is calculated correctly (principal + penalty + interest).
- All external data lookups (FEMA, NWI, county records) are logged with provider
  name, date, and cache status.
- Due-diligence completion percentage is calculated correctly.

---

## 8. Closing

The deal moves from due diligence to closing, where the transfer of ownership
is executed.

### Steps

1. **Select closing method**: Self-close (investor prepares docs) or title-company
   close (title company handles escrow and recording).
2. **Title company coordination**: If using a title company, send the purchase
   agreement, preliminary title report, and any curative documents. The title
   company prepares the closing statement (HUD-1 or settlement statement).
3. **Earnest money**: If earnest money was part of the agreement, verify it has
   been deposited into escrow.
4. **Closing document preparation**: Warranty deed (or special warranty deed, or
   quitclaim deed depending on the situation), seller's affidavit, closing
   statement, 1099-S (if applicable).
5. **Notarization and signing**: Seller signs the deed and affidavit before a
   notary. Remote online notarization (RON) is increasingly accepted.
6. **Funding**: Buyer wires or sends a cashier's check for the purchase price
   (minus earnest money).
7. **Recording**: The signed deed is recorded with the county recorder's office.
   AcreOS should capture the recording date, instrument number, and book/page.
8. **Post-closing**: Update the inventory -- the parcel moves from the
   "acquisitions" pipeline to the "inventory" or "dispositions" pipeline.

### What the Test Harness Validates

- Pipeline transition: `due_diligence_complete` -> `closing_in_progress` ->
  `closed_acquired`.
- Closing cost fields are populated: purchase price, closing costs, recording fees,
  prorated taxes.
- Deed type is appropriate for the transaction.
- Recording metadata (instrument number, date) is stored on the property record.
- Total acquisition cost is calculated correctly (purchase price + closing costs +
  back taxes + recording fees).

---

## 9. Disposition (Selling the Property)

After acquisition, the investor lists the property for sale.

### Steps

1. **Determine pricing**: Pull comps again (now from the buyer's perspective).
   Target a 2-5x markup for cash sales, or a higher total return for seller-
   financed sales.
2. **Create listing**: Prepare a listing with photos (satellite or drone), a
   property description, acreage, GPS coordinates, county, zoning, access info,
   and utilities info.
3. **Distribute listing**: Post to multiple channels simultaneously:
   - Facebook Marketplace and land-investing groups
   - LandWatch / Land.com
   - Zillow / Realtor.com (if the investor is licensed or uses a flat-fee MLS
     service)
   - Lands of America
   - Investor's own website
   - Craigslist (regional)
4. **Buyer inquiries**: Inbound buyer leads are captured in the CRM on the
   dispositions side. Buyer qualification: cash or finance? Timeline? Intended use?
5. **Buyer qualification**: For seller-financed deals, the investor may run a
   soft credit check or simply verify income and employment.
6. **Offer negotiation**: Counter-offers, terms negotiation (down payment amount,
   monthly payment, interest rate, loan term).

### What the Test Harness Validates

- Listing creation requires minimum fields: price, acreage, county, state, at
  least one photo or map image.
- Listing distribution tracks which channels received the listing and their
  status (`active`, `pending`, `sold`, `expired`).
- Buyer leads are associated with the correct listing/property.
- Asking price is greater than the total acquisition cost (the system should warn
  if margin is negative).
- Time-on-market is tracked from listing date.

---

## 10. Seller Finance Setup

Many land investors sell on terms (installment payments), which provides recurring
monthly income. This is the most operationally complex workflow.

### Steps

1. **Calculate terms**: The investor determines:
   - Cash price (usually a discount from the listing price, e.g., $15,000)
   - Finance price (higher, e.g., $19,900)
   - Down payment (10-30% of finance price)
   - Interest rate (typically 8-14% for land notes)
   - Term length (24-120 months)
   - Monthly payment (calculated via standard amortization)
2. **Generate promissory note**: AcreOS generates a promissory note document
   containing: principal amount, interest rate, payment schedule, late-fee terms,
   default/forfeiture clause, and prepayment terms.
3. **Generate land contract or deed of trust**: Depending on the state, the
   security instrument is either:
   - A contract for deed / land contract (common in TX, FL, NM) -- the investor
     retains the deed until the note is paid in full.
   - A deed of trust / mortgage (common in states requiring formal foreclosure) --
     the deed is transferred to the buyer, with a lien recorded.
4. **Set up loan servicing**: The investor uses a servicing platform (GeekPay,
   LoanCare, in-house AcreOS) to:
   - Schedule automatic payment collection (ACH)
   - Track payment history
   - Send payment reminders
   - Process late fees
   - Generate year-end statements (1098 for interest paid, if applicable)
5. **Borrower portal**: The buyer receives access to a portal where they can:
   - View their balance and payment schedule
   - Make payments
   - Download statements
   - Request payoff amount
6. **Ongoing servicing**: Monthly tasks include:
   - Reconcile received payments
   - Follow up on late payments (grace period typically 10-15 days)
   - Issue default notices if payment is 30-60 days late
   - Process prepayments and recalculate amortization
   - Handle property tax monitoring (ensure buyer pays taxes)

### What the Test Harness Validates

- Amortization schedule is mathematically correct (total of all payments equals
  principal + total interest).
- Monthly payment calculation matches standard amortization formula.
- Down payment is deducted from the principal before amortization begins.
- Late fees are calculated correctly (typically $25-50 flat fee or 5% of payment).
- Default triggers fire at the correct delinquency threshold (e.g., 60 days).
- Payoff amount is calculated correctly at any point in time (remaining principal
  + accrued interest + any fees).
- Payment history is immutable (no editing or deleting past payment records).
- Year-end interest-paid totals are accurate for tax reporting.
- Note maturity date is calculated correctly from origination date + term length.
