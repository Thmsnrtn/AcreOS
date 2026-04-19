# Persona 05: Priya Chandrasekaran — International Investor

## Demographics

- **Age:** 41
- **Location:** Toronto, ON, Canada (Midtown, owns a condo)
- **Occupation:** Principal Software Architect at a Canadian fintech company (150 employees)
- **Income:** CAD $195K/year (~USD $143K at current exchange rates)
- **Savings:** CAD $320K across RRSP, TFSA, and non-registered accounts. Currently invested in Canadian index ETFs and a rental condo in Hamilton, ON.
- **Device:** MacBook Pro 16" (M3 Max), Pixel 8 Pro, external 32" 4K monitor
- **Browser:** Firefox (primary, privacy-focused config with uBlock Origin), Chrome (secondary for sites that break in Firefox)

## Background

Priya was born in Chennai, India, moved to Canada at age 14 with her family. She studied Computer Science at the University of Waterloo (co-op program), then did a master's at U of T in distributed systems. She's been building software for 18 years and is now a principal architect — she designs systems, reviews code, mentors senior engineers, and makes technology decisions for her company. She thinks in systems, edge cases, and failure modes.

She owns one rental property in Hamilton (a duplex she bought in 2019 for CAD $420K, now worth ~CAD $580K). She self-manages it. She's comfortable with real estate as an asset class but the Canadian market is overheated — she can't find deals that cash flow at current interest rates. She started researching US real estate as an alternative. A colleague at work (also Indian-Canadian) told her he'd been buying raw land in the US through tax deed auctions and making 200-300% returns. She was skeptical but intrigued.

She's spent the last two months researching US land investing. She's read extensively about:
- The differences between tax deed and tax lien states
- How county assessor systems work (she's visited 6 county assessor websites and found them all terrible from a UX perspective)
- The basics of US land transactions (warranty deed vs. quitclaim deed, title insurance, closing process)

What she hasn't fully figured out:
- The tax implications of a Canadian citizen owning US real estate (FIRPTA withholding, IRS filing requirements, Canada-US tax treaty provisions, whether she needs an ITIN or can use her existing Canadian SIN)
- Whether she can get a US bank account for transactions (she's heard of Mercury and Relay but hasn't opened one)
- How to actually send USD for a land purchase (wire transfer fees, exchange rate timing, whether to use Wise or her bank)
- Whether 1031 exchanges are available to non-US persons (she's read conflicting information)
- State-level restrictions on foreign ownership of agricultural land (she knows some states restrict this)

## How She Found AcreOS

Priya found AcreOS through a Google search for "land investing due diligence software." She evaluated the marketing page the way she evaluates any technology product: she read the entire feature list, checked the pricing page, looked for API documentation (there wasn't any, which disappointed her), checked the company's LinkedIn page to see who works there, and looked for the tech stack on BuiltWith. She signed up for a free trial to evaluate it as a potential tool in her research workflow.

## Technical Comfort Level

**Very high for technology, intermediate for US real estate, zero for US-specific land investing workflows.** Priya can navigate any software product, including complex ones. She reads documentation. She looks for keyboard shortcuts. She'll inspect the network tab in dev tools if something seems slow. She notices when an app makes unnecessary API calls or loads data inefficiently.

She understands real estate fundamentals from her Canadian rental experience, but US land investing has a completely different vocabulary and process:

- She doesn't know what "due diligence" looks like for raw land in the US (her due diligence for the Hamilton duplex involved a home inspection, an appraisal, and a title search — none of which map cleanly to raw land)
- She doesn't understand the role of title companies in land transactions (in Canada, her real estate lawyer handled closing)
- She finds the concept of "county-level" systems baffling — in Canada, land registration is provincial, standardized, and mostly online through Teranet/LTSA
- She doesn't know what FEMA flood zones are (Canada handles flood mapping differently)
- Terms like "metes and bounds," "section-township-range," and "lot and block" are unfamiliar (Canadian legal descriptions use a different system)

## Expectations Shaped by Other Products

Priya's expectations come from professional-grade tools:

- **Stripe Dashboard / AWS Console / Datadog.** She expects dense, information-rich interfaces with powerful filtering, search, and data export. She doesn't need hand-holding — she needs capability.
- **Notion / Linear.** For project management and note-taking, she expects clean organization, keyboard-navigable interfaces, and the ability to build her own workflows.
- **Wealthsimple (Canadian fintech).** For investing, she expects clear regulatory disclosures, proper currency handling, and transparent fee structures.

Specific expectations:
- **Currency handling.** She thinks in CAD. If AcreOS shows prices in USD (which it should, for US land), she wants to know the total cost in CAD including exchange rate spread and transfer fees. At minimum, she expects the app to acknowledge that prices are in USD.
- **Regulatory awareness.** She expects the platform to either support international investors or clearly state that it doesn't. The worst experience is one that silently assumes she's American and then breaks at a critical step (like requiring a US SSN to complete some process).
- **Data export.** She will want to export data to her own spreadsheets for cross-border tax modeling. CSV or API access is expected.
- **Performance.** She notices load times, unnecessary re-renders, and janky scrolling. She'll form opinions about the engineering team based on front-end performance.

## Goal for Using AcreOS

Priya has a systematic plan:

1. **Market research.** Identify 3-5 US counties where raw land investing makes sense for her risk profile and budget. She wants to understand pricing patterns, volume, and growth trends at the county level.

2. **Due diligence tooling.** Evaluate whether AcreOS can replace the 6-8 county websites she currently visits manually for each parcel she researches. She wants parcel data, tax history, comp sales, zoning, and environmental data in one place.

3. **Deal pipeline.** Track 10-15 parcels she's researching simultaneously, with notes, status, and key data points. She'll build this in Notion if AcreOS doesn't offer it.

4. **Cross-border workflow documentation.** Understand the full end-to-end process for a Canadian buying US land: entity structure, bank accounts, tax filings, closing process, and ongoing management. She needs AcreOS to either guide her through this or get out of the way while she figures it out herself.

Her budget for a first deal is USD $5K-15K. She wants to do 2-3 deals in the first year to learn the process before scaling up.

## Realistic Failure Modes

1. **The SSN wall.** AcreOS asks for a Social Security Number during account setup, or during some process like "verify your identity" or "set up your investor profile." Priya doesn't have an SSN — she has a Canadian SIN. There's no option for "non-US person" or "ITIN." She's blocked from proceeding.

2. **The US address requirement.** The platform requires a US mailing address for some feature — maybe for receiving documents, maybe for a profile field. Priya has a US address through a registered agent service, but the form validation rejects Canadian postal codes or non-US phone numbers in other fields.

3. **The hidden currency assumption.** AcreOS shows all values in USD without labeling them as USD. Priya initially doesn't notice and starts comparing numbers to her CAD budget, making every parcel seem cheaper than it actually is. When she realizes the disconnect, she's frustrated that the platform didn't make this explicit.

4. **The 1031 exchange trap.** AcreOS prominently features 1031 exchange capabilities or mentions tax deferral strategies in its marketing or UI. Priya clicks into this, spends 20 minutes exploring it, and then discovers (through her own research, not through AcreOS) that non-US persons are technically eligible for 1031 exchanges but face FIRPTA withholding that makes them impractical for small deals. She's annoyed that AcreOS didn't flag this.

5. **The county-system confusion.** AcreOS references "contact your county assessor" or "check the county recorder's office" in help text or guidance. Priya doesn't have an intuitive understanding of what a county assessor does, how counties are organized, or why land records are county-level rather than state-level. She understands the concept intellectually but the workflow feels foreign. Every "call the county" instruction is friction for someone who (a) is in a different time zone, (b) has a foreign phone number, and (c) doesn't know what to ask.

6. **The entity structure gap.** Priya knows she probably needs a US LLC to buy US land (for liability protection and potentially for tax efficiency). AcreOS's "add your organization" setup assumes she already has one. She doesn't. She doesn't know which state to form an LLC in, whether she needs a registered agent, or how to get an EIN. AcreOS doesn't help with this and doesn't acknowledge that this is a common blocker for international users.

7. **The payment method mismatch.** If AcreOS requires a US credit card or US bank account for its subscription, Priya's Canadian Visa card may work (it's Visa, it should) but she'll be charged foreign transaction fees plus an unfavorable exchange rate. If AcreOS uses Stripe, it probably handles this fine. If it uses a less sophisticated payment processor, it might reject her card.

## What Would Make Her Abandon

- **Assumed US residency.** If the product assumes she's American at any point — SSN requirement, US address requirement, US-centric tax advice without caveats — and offers no workaround or acknowledgment of international users, she'll conclude the product isn't for her.
- **Inability to export data.** If she can't get her data out in a structured format (CSV, at minimum), she can't build the cross-border tax models she needs. This is a hard requirement.
- **Poor engineering signals.** Slow load times, layout shifts, broken responsive design, unnecessary spinners, or stale cached data. She'll judge the reliability of the platform's data by the quality of its engineering.
- **No acknowledgment of complexity.** If AcreOS treats land investing as simple ("3 easy steps to your first deal!") without acknowledging the genuine complexity of cross-border investing, she'll conclude the team doesn't understand the problem space deeply enough to trust.
- **Vendor lock-in signals.** If AcreOS makes it hard to leave — no data export, proprietary formats, data that only exists in the platform — she'll be reluctant to build her workflow around it.

## What Would Make Her Stay

- A clear statement somewhere (even a help article) that addresses international investors: "AcreOS is used by investors in 12 countries. Here's what you need to know if you're investing from outside the US."
- Currency labels on all monetary values (USD explicitly stated).
- No SSN-gated features, or an ITIN option wherever SSN is requested.
- Strong parcel data that matches what she sees on county assessor websites — she will verify this, methodically, across multiple counties.
- CSV export for all data views and reports.
- A fast, well-engineered front end. She'll notice if it's a React app with good code splitting and lazy loading vs. one that ships 4MB of JavaScript on first load.
- API access or webhook support — even if she doesn't use it immediately, its existence signals engineering maturity.
- County-level guides or data that help her compare markets systematically, not just individual parcels.

## Signature Quote

"Does this work for non-US investors, or am I going to hit a wall at step 3?"

## Testing Priority

Priya tests **international user support, currency handling, US-centric assumptions, data export, engineering quality, and cross-border workflow gaps.** She represents a growing and underserved segment: technically sophisticated international investors who have capital and motivation but face systemic friction from US-centric platforms. Every assumption AcreOS makes about its users being American is a friction point for Priya. Surfacing and resolving these assumptions improves the product for everyone.
