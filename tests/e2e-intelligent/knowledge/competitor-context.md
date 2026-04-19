# Competitor Context: What Switching Users Expect

This knowledge file equips the intelligent E2E test harness with awareness of the
products that AcreOS users are migrating from. Tests must account for the mental
models, vocabulary, and feature expectations these users carry. When a test
simulates a user workflow, it should reflect realistic expectations -- including
features the user will look for that AcreOS may or may not have.

---

## Pebble

### What It Is

Pebble is a land-specific CRM and deal-management platform. It emerged as one of
the first tools purpose-built for the land investing niche, as opposed to adapted
from general-purpose real estate investor CRMs.

### What Users Expect

- **Clean, modern UI**: Pebble users are accustomed to a polished, well-designed
  interface with card-based deal views, drag-and-drop pipeline boards, and
  tasteful use of whitespace. They will immediately judge AcreOS on visual quality.
- **Campaign management**: Pebble organizes work around "campaigns" -- a campaign
  is a batch of mailers sent to a specific county list. Users expect to see
  campaign-level metrics: total mailed, response rate, cost per lead, cost per
  acquisition.
- **Land-specific fields out of the box**: APN, acreage, county, assessed value,
  legal description, GPS coordinates -- all present as first-class fields, not
  custom fields the user has to create.
- **Pipeline stages**: Pebble's pipeline closely mirrors the land investing
  lifecycle: lead -> contacted -> offer sent -> under contract -> due diligence ->
  closing -> inventory -> listed -> sold. Users expect exactly this flow.
- **Map view**: Pebble provides a map view of properties with parcel boundaries.
  Users expect to see their parcels on a map, not just in a table.

### Where AcreOS Will Delight

- Deeper data provider integrations (automated comps, skip tracing without
  leaving the platform).
- Seller finance management (Pebble does not natively handle note servicing).
- More granular permission controls for teams with VAs and acquisition managers.
- AI-powered features (automated offer calculations, intelligent follow-up
  suggestions).

### Where AcreOS May Disappoint

- If the UI is less polished or feels "busy" compared to Pebble's minimalism.
- If campaign setup requires more clicks than Pebble's streamlined flow.
- If the map view is missing or rudimentary.

---

## REsimpli

### What It Is

REsimpli is a broader real estate investor CRM that serves house flippers,
wholesalers, and land investors. It is feature-dense, positioning itself as an
all-in-one platform with built-in phone systems, driving-for-dollars, and
AI voice agents.

### What Users Expect

- **Integrated phone/SMS**: REsimpli includes a built-in phone system with call
  tracking, call recording, SMS campaigns, and ringless voicemail drops. Users
  expect AcreOS to have phone integration (even if via Twilio/OpenPhone rather
  than built-in).
- **AI voice agents**: REsimpli's recent AI agent feature handles inbound calls
  and qualifies leads automatically. Users from REsimpli may expect AcreOS to
  have comparable AI capabilities.
- **KPI dashboards**: REsimpli provides detailed KPI dashboards: cost per lead,
  cost per deal, average profit per deal, response rates by campaign, pipeline
  velocity. Users will look for this immediately.
- **Feature density**: REsimpli users are accustomed to a platform that does
  everything -- sometimes at the cost of UX clarity. They may tolerate a busier
  interface if it means fewer tool switches.
- **Pricing expectations**: REsimpli charges $149-599/month depending on tier.
  Users switching to AcreOS will benchmark value against this range.
- **List stacking**: REsimpli supports "list stacking" -- combining multiple
  motivated-seller lists and scoring leads by how many lists they appear on.
  Users expect this capability.

### Where AcreOS Will Delight

- Land-specific workflows that REsimpli handles generically (mineral rights,
  water rights, parcel-specific due diligence checklists).
- Cleaner UX for the land-specific use case (REsimpli's breadth means land
  features are buried among house-flipping features).
- Better seller-finance tools (REsimpli's note management is minimal).

### Where AcreOS May Disappoint

- If AcreOS lacks a built-in phone system or requires a separate phone tool.
- If KPI dashboards are less comprehensive than REsimpli's.
- If AI voice/SMS capabilities are missing.
- If the feature set feels narrow compared to REsimpli's everything-included model.

---

## DealMachine

### What It Is

DealMachine started as a mobile-first "driving for dollars" app -- the investor
drives around, photographs distressed properties, and the app pulls owner data
and sends direct mail automatically. It has since expanded into a broader CRM
with an AI assistant called Alma.

### What Users Expect

- **Mobile-first experience**: DealMachine users expect a strong mobile experience.
  They may try to use AcreOS from their phone while visiting properties or driving
  for deals.
- **Alma AI**: DealMachine's AI assistant helps with property research, comp
  analysis, and generating marketing copy. Users expect some form of AI assistant
  in any modern platform.
- **Property data at a tap**: DealMachine users are used to tapping a property on
  a map and instantly seeing owner info, assessed value, tax status, and comparable
  sales. They expect instant property lookup.
- **Instant mail triggers**: The ability to send a mailer to a property owner with
  two taps from the mobile app. Speed of action is a core expectation.
- **Photo capture**: DealMachine lets users photograph properties from the street
  and attach those photos to the lead record. Users may expect similar photo-to-lead
  functionality.

### Where AcreOS Will Delight

- Superior list management and bulk operations (DealMachine is optimized for
  one-at-a-time property capture, not batch list processing).
- Full pipeline management from acquisition through disposition and note servicing.
- More sophisticated due diligence workflows.
- Team management features for scaling operations.

### Where AcreOS May Disappoint

- If AcreOS lacks a polished mobile experience or native app.
- If there is no map-based property lookup with tap-to-research.
- If the time from "find a property" to "send a mailer" requires more than a
  few clicks.

---

## PropStream

### What It Is

PropStream is the dominant property data platform in the REI space. It aggregates
data on 160+ million properties nationwide, offering advanced filtering, comp
analysis, skip tracing, and list building. It is a data tool, not a CRM -- most
users export from PropStream and import into their CRM.

### What Users Expect

- **Data depth**: PropStream users are accustomed to extremely rich property data:
  assessed value, market value estimate, tax history, mortgage info, owner
  demographics, transaction history, pre-foreclosure status, and more. They
  expect AcreOS's property data to be comparably rich.
- **Advanced filtering**: PropStream's filter system allows combining dozens of
  criteria: property type, acreage range, assessed value range, owner type
  (absentee, out-of-state, corporate, individual), equity percentage, years owned,
  tax delinquency status, and more. Users expect powerful filtering in AcreOS.
- **Skip tracing within the platform**: PropStream offers built-in skip tracing
  at $0.12-0.15/record. Users expect AcreOS to offer comparable in-platform
  skip tracing.
- **Comp analysis**: PropStream provides automated comparable-sale analysis with
  adjustable radius, time frame, and property-type matching. Users expect AcreOS
  to pull comps with similar precision.
- **List export**: PropStream users export CSVs constantly. They expect clean,
  well-formatted exports from AcreOS as well.
- **Heat maps**: PropStream offers heat maps showing property density, price
  trends, and investor activity. Power users expect similar analytics.

### Where AcreOS Will Delight

- Integrated workflow from data pull to mailer to CRM to closing -- no export/
  import dance between PropStream and a separate CRM.
- Land-specific intelligence (PropStream treats vacant land as a secondary use
  case behind houses).
- Seller-finance tools that PropStream does not offer at all.
- Campaign tracking tied directly to the source list.

### Where AcreOS May Disappoint

- If property data coverage or depth is noticeably thinner than PropStream's
  160M+ property database.
- If filtering capabilities are less granular.
- If skip-trace pricing is not competitive.
- If comp analysis is less accurate or adjustable.

---

## Land Academy Community (Jack Butala / Offers2Owners)

### What It Is

Land Academy is an educational community founded by Jack Butala (Steven Jack
Butala) and Jill DeWit. It teaches a systematic approach to land investing built
around blind offer mailers. The community has produced thousands of active land
investors, many of whom are now scaling their operations and looking for better
tooling.

### Methodology and Vocabulary

- **Blind offers**: The core Land Academy strategy is to send unsolicited written
  purchase offers (not marketing mailers) to landowners. The offer includes a
  specific dollar amount. This is distinct from "I'm interested in buying your
  land" letters.
- **Offers2Owners (O2O)**: The Land Academy's in-house mailing platform. Users
  upload a list, set an offer-price formula, and O2O generates and mails the
  offer letters. Users switching from O2O expect AcreOS to replicate this exact
  workflow.
- **Pricing formula**: Land Academy teaches pricing as a percentage of assessed
  value (commonly 25-30% for cash offers). Users expect AcreOS to support
  formula-based offer pricing, not just manual entry.
- **"Mailer"**: In Land Academy vocabulary, a "mailer" almost always refers to
  an offer letter with a specific price, not a marketing postcard.
- **"Data"**: When a Land Academy member says "I need to pull data," they mean
  downloading the county tax roll and scrubbing it. They expect AcreOS to
  streamline this process.
- **"Dispo" or "disposition"**: Selling the property. Land Academy members
  frequently use this shorthand.
- **"Terms deal"**: A seller-financed sale. Distinct from a "cash deal."
- **Scaling through systems**: Land Academy explicitly teaches that the path to
  scaling is through systematizing every step: data, mail, phones, due diligence,
  closing, and dispo. Users expect AcreOS to be that system.
- **County-by-county approach**: Land Academy teaches investors to work one county
  at a time, mastering the local market before moving to the next. Users expect
  AcreOS to support county-level campaign organization and analytics.

### Where AcreOS Will Delight

- Automating the entire Offers2Owners workflow inside the CRM -- list pull, scrub,
  price calculation, offer letter generation, mail, and inbound response handling
  in a single platform.
- County-level analytics and performance tracking aligned with the county-by-county
  methodology.
- Built-in seller-finance note management (many Land Academy members do terms deals
  and currently use spreadsheets or GeekPay).
- Team features for members who have grown beyond solo operation and now employ
  VAs, acquisition managers, and dispo managers.

### Where AcreOS May Disappoint

- If the blind-offer workflow requires too many steps or manual configuration
  compared to O2O's relatively straightforward upload-and-mail process.
- If pricing formulas cannot be configured at the county level (Land Academy
  members use different percentages for different counties).
- If the platform does not support the specific vocabulary ("mailer," "terms deal,"
  "dispo") in its UI labels and pipeline stage names.
- If data import from county assessor CSVs is not seamless -- Land Academy members
  pull raw county data with wildly varying column formats, and they expect the
  tool to handle it gracefully.

---

## Cross-Competitor Patterns

Regardless of which product a user is switching from, the test harness should
account for these universal expectations:

1. **Fast onboarding**: Users expect to upload their existing data (leads,
   properties, notes) and be operational within an hour, not a day.
2. **Import from CSV**: Every competitor exports CSV. AcreOS must handle CSV
   import with flexible column mapping flawlessly.
3. **No data loss on migration**: Users will compare record counts. If they had
   4,200 leads in their old system and only 4,100 import into AcreOS, they will
   file a support ticket.
4. **Familiar terminology**: Pipeline stages, field names, and menu labels should
   match industry vocabulary. "Disposition" not "sales," "APN" not "parcel
   identifier," "comps" not "comparable market analysis."
5. **Mobile access**: Every competitor except PropStream has reasonable mobile
   experiences. Users will try AcreOS on their phone.
6. **Speed**: PropStream and DealMachine have set expectations for sub-second
   property lookups. Slow searches will feel broken.
