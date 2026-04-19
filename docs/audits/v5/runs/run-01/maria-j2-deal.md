# Maria Gutierrez - Journey 2: First Deal Analysis

**Persona:** Maria Gutierrez, 34, marketing manager in Austin. Never bought land. Mobile-first iPhone user (375x812). Zero real estate vocabulary. Judges by visual polish. Expects the product to teach her.
**Journey:** First Deal Analysis -- evaluate a specific parcel using AI analysis and make a go/no-go decision.
**Starting State:** Logged in, has at least one parcel in the system (assumed from Journey 1 success path).
**Conditions:** 3G throttled | iPhone (375x812) | Solo
**Date:** 2026-04-18

---

## Step 1: Navigate to the parcel list

**What I tried to do:** "I have a property in here somewhere. Let me find it and figure out if it's worth buying."

**What I expected to see:** A simple list or card view of my properties with a clear way to open one and "analyze" it -- whatever that means.

**What I actually saw:** On mobile (375px), the bottom navigation bar has 4 items plus a "More" overflow. "Properties" is not one of the default bottom nav items -- it is buried inside the "More" drawer. I tap "More", scan a list of navigation items, and find "Properties" under a section with a Map icon.

Once I land on `/properties`, I see:

- A page header with "Properties" title, a "+" Add Property button, and view mode toggles (List/Map)
- A toolbar row with: GIS Filters, Saved Views, Status filter, Distress filter, Export, Import, Bulk Fetch buttons
- Below that, property cards in a single-column grid (since mobile renders `grid-cols-1`)

Each property card shows:
- A map thumbnail (176px tall) or a "Fetch Map" button if no parcel data
- A badge overlay: status ("available") and a LandCreditBadge
- County, State as the card title
- APN in monospace font
- Acreage and dollar value
- A price-per-acre calculation
- A "Due Diligence" button and a calculator icon button

**My reaction:** mildly overwhelmed

The toolbar row is dense for mobile. "GIS Filters", "Saved Views", "Distress" -- I don't know what any of these mean. But the property cards themselves look clean. I can see my property card with its county, acreage, and value.

The card's primary CTA button says "Due Diligence" which means nothing to me. What does "due diligence" mean? It sounds legal and scary. There's also a tiny calculator icon next to it. Neither button says "Analyze" or "Evaluate this deal."

**Friction Event F1 -- MEDIUM:** "Due Diligence" button label is jargon. A beginner expects "View Details" or "Evaluate" or "Analyze." "Due Diligence" is insider terminology that signals "this product is not for you."

**Would I continue in real life?** yes -- I'll tap it and see what happens.

---

## Step 2: Open the property detail

**What I tried to do:** "Let me tap this card and see what's inside."

**What I expected to see:** A full property page with data laid out clearly and some kind of "Analyze" or "Is this a good deal?" button.

**What I actually saw:** Tapping the "Due Diligence" button (or the map area) opens a `PropertyDetailDialog` -- a modal dialog (`sm:max-w-[900px] max-h-[90vh]`) that overlays the page. On my 375px phone, this fills the entire screen.

The dialog header shows:
- Property name (county, state) with a MapPin icon
- An "Analyze with AI" button (primary variant, blue) with a Bot icon
- A subtitle line: APN, acreage, and status badge

Below the header, there's a tab bar with 5 tabs:
- **Overview** | **Intel** | **Comps** | **AI Offer** | **DD**

The tab bar uses `TabsList` with `inline-flex w-auto min-w-full sm:grid sm:w-full sm:grid-cols-5`. On mobile this renders as an inline horizontal scrolling strip. The tabs are relatively compact with `min-h-[40px] px-3` each. The icons ("Brain", "BarChart2", "Calculator") are `hidden sm:inline` so on mobile I only see text: "Overview", "Intel", "Comps", "AI Offer", "DD".

The default tab is "Overview" which shows a `ResearchSummaryPanel` at the top, followed by a map (if parcel data exists), then Location Details, Property Characteristics, and Financial Information sections.

**My reaction:** positively surprised

This is actually a lot of information, and the "Analyze with AI" button in the header is prominent and clear. The blue button with a robot icon is the most obvious thing on the page. The tab names are still jargon-heavy ("Intel", "Comps", "DD") but I can see a clear action I can take.

The ResearchSummaryPanel shows a completeness score ("15% Complete (F)" for a barely-populated property) with a checklist showing what data I have and don't have, plus quick research links (Google Maps, Zillow, County Assessor, APN Lookup). This is actually helpful -- it tells me what I'm missing.

**Friction Event F2 -- LOW:** Tab labels "Intel", "Comps", and "DD" are abbreviations that a beginner wouldn't understand. "Intel" = intelligence? Comps = comparisons? DD = due diligence? There are no tooltips explaining what each tab contains.

---

## Step 3: Tap "Analyze with AI"

**What I tried to do:** "OK, that blue robot button looks like it does something. Let me tap it."

**What I expected to see:** Some kind of analysis result -- maybe a report card saying "this is a good deal" or "this is risky" with clear reasons why.

**What I actually saw:** A Sheet (slide-in panel from the right) opens with the title "Analyze Property with AI" and a Bot icon. The panel shows:

- **Header:** Property name, APN, acreage, market value, and status badge
- **Empty state message:** "Ask questions about this property or use the quick actions below to get started."
- **Four quick action buttons** (stacked vertically, full-width):
  1. "What's the flood risk?" (Droplets icon)
  2. "Find similar properties" (Search icon)
  3. "Generate an offer" (FileText icon)
  4. "Calculate financing" (Calculator icon)
- **Input field at bottom:** "Ask about this property..." with a Send button

On mobile, the Sheet uses `w-full sm:max-w-lg` so it fills the entire screen width, which is correct behavior. The quick action buttons have `justify-start gap-2 h-auto py-3` so they're nicely sized for touch (48px+ effective height). Good.

**My reaction:** confused but curious

This is a chat interface, not an analysis dashboard. I expected the AI to just... tell me things. Instead, it's asking me what I want to know. The quick action buttons are helpful guesses, but:

1. **"What's the flood risk?"** -- Is flood risk important? I don't know. Should I care about this?
2. **"Find similar properties"** -- OK, I think "comps" are similar properties? This might help.
3. **"Generate an offer"** -- I'm not ready to make an offer. I don't even know if I want this land.
4. **"Calculate financing"** -- What financing? I was going to pay cash from savings.

None of the quick actions say the thing I actually want to know: **"Is this a good deal?"** or **"Should I buy this?"**

**Friction Event F3 -- HIGH:** The AI analysis is a freeform chat, not a structured analysis. A beginner who doesn't know what questions to ask is stuck staring at an open-ended prompt. The quick actions assume domain knowledge (why would I know flood risk matters?). There is no "Run full analysis" or "Give me the bottom line" button.

**Would I continue in real life?** maybe -- I'll try tapping a quick action to see what happens.

---

## Step 4: Tap "Find similar properties" quick action

**What I tried to do:** "This one seems most relevant. Let me see what similar properties look like."

**What I expected to see:** A response showing me comparable properties with prices, so I can understand if my property is priced fairly.

**What I actually saw:** The quick action sends the message "Can you find comparable properties similar to this one for valuation purposes?" -- a question I would never phrase this way myself. The message appears in a blue bubble on the right (user message), and a loading state appears on the left with a Bot avatar and "Analyzing..." text with a spinner.

After several seconds (the API call goes to `/api/properties/:id/analyze`, which calls OpenAI's GPT-4o with a system prompt containing the property context), the AI responds with a text bubble.

The AI response is a wall of text. It will include:
- A discussion of the property's location, acreage, and current data
- General guidance about comparable properties in the area
- Possible price-per-acre estimates based on the enrichment data or general knowledge
- Follow-up suggestion buttons at the bottom: "What's the price per acre for this area?" and "How long do similar properties take to sell?"

The response format is plain text (`whitespace-pre-wrap`), not structured data. There are no tables, no cards, no visual formatting within the AI response. Just paragraphs of text in a chat bubble with a maximum width of 80%.

**My reaction:** overwhelmed

The AI gave me a long text response. On my 375px phone, the chat bubble is 80% of ~375px = ~300px wide, and the text wraps heavily. I'm reading what amounts to a short essay about comparable property analysis. The information might be useful, but:

1. **No structured data.** I wanted to see a table: "Property A sold for $X, Property B sold for $Y, your property is estimated at $Z." Instead, I got paragraphs.
2. **No visual differentiation.** The AI response is just text in a gray bubble. No headers, no bold key numbers, no cards or visual hierarchy. Everything runs together.
3. **No confidence indicator.** The AI doesn't say "I'm 80% confident" or "this estimate has high/low certainty." I have no way to gauge how much to trust this.
4. **No source attribution.** The AI mentions price ranges but doesn't say where the data comes from. Is this from county records? From a model? From thin air?

The follow-up suggestions ("What's the price per acre for this area?" and "How long do similar properties take to sell?") are helpful contextual prompts. But I'm already 4-5 taps deep and I still don't have a clear go/no-go answer.

**Friction Event F4 -- HIGH:** AI responses are unstructured text walls with no visual formatting, no data tables, no source citations, and no confidence indicators. On a small mobile screen, this is especially hard to parse.

**Friction Event F5 -- MEDIUM:** The AI deducts 2 credits per message (`dealCreditService.deductCredits(org.id, 2, 'Deal AI analysis')`). On the free tier with 25 AI requests/day, each chat message costs credits. But there is no indication to the user that credits are being consumed. No "This will use 2 credits" warning, no credit balance shown in the chat panel.

---

## Step 5: Try the "Comps" tab instead

**What I tried to do:** "That AI chat wasn't super helpful. Let me try the other tabs. What does 'Comps' mean?"

**What I expected to see:** Some kind of comparison view. Maybe the product will explain what comps are.

**What I actually saw:** I close the AI chat panel (tap outside or hit the X), and tap the "Comps" tab in the property detail dialog. The `CompsAnalysis` component renders.

If the property has coordinates (parcel data was fetched), the comps tab auto-loads. It shows:

- A toolbar with "Filters" toggle and "Refresh" button. Under the Refresh button: "$0.10 per query" in 10px muted text.
- **Market analysis summary cards** in a 2-column grid (on mobile, `grid-cols-2`): Avg $/Acre, Median $/Acre, High $/Acre, Low $/Acre
- **Estimated Market Value** card (highlighted with primary border): Shows dollar amount and "Based on X comparable sales for Y acres"
- **Offer Suggestions** card: Three offer tiers -- Conservative (40-50% of market value), Standard (50-65%), Aggressive (65-80%) -- each in a colored card (green, blue, orange)
- **Property Desirability Score** card: A score out of 100 with a letter grade (A-F) and a clickable breakdown showing factors like Road Access, Distance to Town, etc. with progress bars
- **Comparable Properties table**: Address, Acreage, Sale Date, Sale Price, $/Acre, Distance -- each comp shows APN, location, and detailed data

On mobile, the table requires horizontal scrolling (6 columns in ~375px). The `overflow-x-auto` wrapper allows this, but the table is hard to read -- you have to scroll right to see Sale Price and Distance columns.

**My reaction:** much better

This is actually useful! The Comps tab gives me structured data I can understand:
- Average price per acre tells me what land costs around here
- Estimated market value gives me a concrete number
- Offer suggestions tell me what to offer (conservative/standard/aggressive)
- The desirability score gives me a quick grade

But I still have problems:
1. **"$0.10 per query" under the Refresh button** -- Wait, this costs money? Each time I view comps? Or only when I refresh? This is ambiguous and creates anxiety.
2. **No explanation of what "comps" means.** The word "comparable" appears in "Comparable Properties" but there's no tooltip or context explaining what a comp is or why it matters.
3. **The offer suggestion percentages (40-50%, 50-65%, 65-80%) are unexplained.** Why would I offer 40% of market value? Is that normal? Is that insulting? I have no framework for understanding these percentages.

**Friction Event F6 -- MEDIUM:** Offer suggestion percentages (40-50% of market value) are presented without context. A beginner doesn't know that deeply discounted offers are standard in land investing. She might think "offering 40% of value is lowballing and rude."

---

## Step 6: Look at the Intelligence tab

**What I tried to do:** "What about 'Intel'? Maybe that has more info."

**What I expected to see:** More details about the property. Hopefully something that helps me decide.

**What I actually saw:** The "Intel" tab (`PropertyIntelligenceTab`) shows either:

**(a) If intelligence data hasn't been fetched yet:**
An empty state card with a Brain icon, "No Intelligence Data" headline, and text: "Click 'Refresh Intelligence' to fetch environmental, hazard, and demographic data for this property." Plus a "Fetch Intelligence" button.

**(b) If data has been fetched:**
A grid of cards covering:
- **Investment Scores** (Overall /100, Investment, Development, Risk)
- **Flood & Water Risk** (Flood Zone code, Flood Risk level, Wetlands Present)
- **Natural Hazards** (Earthquake, Wildfire, Overall Risk /100)
- **Environmental Factors** (EPA Sites, Risk Level, Soil Type, Soil Suitability, Capability Class, Prime Farmland)
- **Infrastructure** (Nearest Hospital, Fire Station, School, Access Score)
- **Demographics** (Population, Median Income, Median Home Value, Poverty Rate, etc.)
- **Transportation** (Nearest Highway, Paved Road, Road Access Score)
- **Public Lands** (Near BLM, USFS, National Parks)
- **Water Resources** (Nearest Stream, Water Body, Water Availability Score)
- **Elevation & Terrain** (with Source badge)
- **Climate** (Avg High/Low Temp, Precipitation)
- And more: Agricultural Values, Land Cover, Cropland, EPA Facilities, Storm History, PLSS, Watershed, FEMA NRI, USDA CLU

**My reaction:** overwhelmed and lost

If the data is populated, this is an avalanche of information presented with no prioritization. On my 375px phone, the cards stack in a single column and I'm scrolling through what feels like 15+ cards of dense data. Flood zones, earthquake risk, soil type, capability class, PLSS, FEMA NRI, USDA CLU -- these are acronyms and concepts I have never encountered.

None of this is explained. There are no tooltips. There are no "what this means for you" annotations. A card that says "Flood Zone: X" tells me nothing -- is Zone X good or bad? The risk badges use colors (green/yellow/red) which helps slightly, but "Capability Class: III" is completely opaque.

The "Investment Scores" card at the top gives me numbers (Overall: 67/100) but with no explanation of what "67/100" means. Is 67 good? Bad? Average? For what purpose?

Most importantly: **nothing on this tab synthesizes the data into a recommendation.** It's raw data with no interpretation.

**Friction Event F7 -- HIGH:** The Intelligence tab dumps 15+ cards of raw data with technical terms (PLSS, FEMA NRI, Capability Class, Hydrologic Group) and no explanatory tooltips, no "what this means" annotations, and no synthesis. A beginner cannot extract actionable insight from this data.

**Friction Event F8 -- MEDIUM:** The "Investment Scores" card shows numbers without explaining the scale, methodology, or what a "good" score looks like. "Overall Score: 67/100" conveys no meaning to a user who doesn't know the scoring criteria.

---

## Step 7: Try to make a go/no-go decision

**What I tried to do:** "OK I've looked at all the tabs. Should I buy this land or not?"

**What I expected to see:** A summary screen or decision view that brings together the key data points and helps me decide. Something like: "Based on comps, this property is worth $X. Based on risks, there are no major red flags. Recommended offer: $Y. Confidence: High."

**What I actually saw:** There is no decision summary view. The data is spread across four tabs (Overview, Intel, Comps, AI Offer) with no integration between them. The "Overview" tab shows a ResearchSummaryPanel with a completeness grade, comps quick view, and research notes textarea. The "Comps" tab shows market data. The "Intel" tab shows environmental data. The "AI Offer" tab (which I haven't tried yet) generates offer letters.

There is no:
- "Go/No-Go Decision" button or panel
- Summary that synthesizes comps + risks + intelligence into a recommendation
- Decision recording feature on the property detail (no dropdown to set "pass" or "acquire")
- Confidence score combining all available data

The closest thing to a decision flow is the "AI Offer" tab, which lets me generate offer letters -- but that assumes I've already decided to buy. It skips the evaluation step entirely.

I could type "Should I buy this property?" into the AI chat, but the chat gives unstructured text responses and doesn't have access to the comps or intelligence data that the other tabs show. The AI chat's system prompt only includes the basic property fields (APN, location, size, zoning, value, price) -- not the enrichment data, comps analysis, or desirability scores.

**My reaction:** defeated

I've been in this property detail for maybe 4-5 minutes. I have scattered data across multiple tabs, an AI that gives me text essays, and no clear synthesis or recommendation. The product has shown me a lot of data but hasn't helped me understand what to do with it.

In my real life as a marketer, I would describe this as: "The product has great data infrastructure but no insight layer. It's like giving someone a spreadsheet instead of a dashboard."

**Friction Event F9 -- CRITICAL:** There is no go/no-go decision workflow. The property detail shows data across 4+ tabs but never synthesizes it into a recommendation or asks the user to make a decision. There is no way to record "I want to pursue this" or "I'm passing on this" within the property detail view. Journey acceptance criterion A5 ("user reaches a decision with stated confidence") and A6 ("decision is recorded and persisted") cannot be met.

---

## Step 8: One more try -- AI Offer tab

**What I tried to do:** "What's the 'AI Offer' tab? Maybe that helps."

**What I expected to see:** Guidance on whether to make an offer and how.

**What I actually saw:** The `AIOfferGenerator` component. It requires the property to have coordinates and comps data. If available, it shows:

- **"Generate AI Offer"** button that calls the server to get offer suggestions
- Once generated: Estimated Market Value, three offer strategy cards (Conservative, Standard, Aggressive) each with an offer amount, confidence percentage, reasoning text, and market value percentage
- Market analysis summary (avg/median $/acre, comparables count, market trend)
- Property desirability score with factor breakdown
- AI reasoning text explaining the recommendation
- **Generate Offer Letter** button that creates a formal letter text
- **Acceptance Prediction** that estimates the probability the seller will accept

**My reaction:** This is actually close to what I wanted

The AI Offer tab comes closest to a "decision helper." It gives me structured offer suggestions with confidence scores, market analysis, and even acceptance prediction. But:

1. **It assumes I've decided to buy.** The entire tab is about "what price to offer." It never asks "should you buy this at all?" There's no risk assessment integrated here.
2. **The acceptance prediction is a nice touch** but I don't know enough about land offers to evaluate whether a 60% acceptance probability is good or bad.
3. **The generate offer letter feature is premature** -- I haven't decided to buy yet, and the product is already helping me write offer letters.

**Friction Event F10 -- MEDIUM:** The AI Offer tab is an action-oriented tool (generate offers, write letters) that skips the evaluation step. It helps with "how much to offer" but not "should I offer at all."

---

## Final Verdict: ABANDONED (soft)

Maria explored extensively but could not reach a go/no-go decision. She spent approximately 6-8 minutes in the property detail across multiple tabs and the AI chat, absorbing fragments of data, but never found a synthesized view that brought it all together into an actionable recommendation.

She did not abandon in frustration (the UI is polished enough to keep her exploring), but she reached the end of what she could do without domain expertise. The product surfaced raw data but did not translate it into beginner-accessible insight.

**Acceptance criteria results:**

| # | Condition | Result |
|---|-----------|--------|
| A1 | Analysis completes in under 2 minutes | PARTIAL -- Comps load in seconds. AI chat responds in 5-10 seconds. Intel enrichment takes longer but shows loading state. No single "analysis" action exists to time. |
| A2 | Results are comprehensible to someone with basic RE knowledge | FAIL -- Results require domain knowledge Maria does not have. PLSS, FEMA NRI, Capability Class, "comps" itself are unexplained. |
| A3 | Key data points are present | PASS -- Estimated value, comparables, risk factors, and offer suggestions are all present across tabs. |
| A4 | Data does not contradict obvious reality | PASS -- No contradictions observed in the code structure. Data is pulled from real APIs. |
| A5 | User reaches a decision with stated confidence | FAIL -- No synthesis view exists. Maria cannot articulate "I would buy this because X" because the product never helped her connect the dots. |
| A6 | Decision is recorded and persisted | FAIL -- No decision recording mechanism exists in the property detail view. There is no "pass" or "pursue" action. |

---

## Friction Events

| # | Event | Severity | Description |
|---|-------|----------|-------------|
| F1 | "Due Diligence" button label is jargon | MEDIUM | The primary CTA on property cards says "Due Diligence" -- insider terminology unintelligible to beginners. Should say "View Details" or "Evaluate." |
| F2 | Tab labels are unexplained abbreviations | LOW | "Intel", "Comps", "DD" are abbreviations with no tooltips. A beginner must guess what each tab contains. |
| F3 | AI Analysis is freeform chat, not structured report | HIGH | The "Analyze with AI" feature opens a chat interface that requires the user to formulate questions. There is no "Run full analysis" button. Quick actions assume domain knowledge (why would a beginner ask about flood risk?). A beginner who doesn't know what to ask gets no value. |
| F4 | AI responses are unformatted text walls | HIGH | AI chat responses are plain text in chat bubbles with no visual formatting, tables, data cards, or source citations. On a 375px screen, long text responses are especially hard to parse. |
| F5 | Credits consumed silently | MEDIUM | Each AI chat message costs 2 credits. No warning before consumption, no credit balance shown in the chat panel. Users may exhaust credits without realizing it. |
| F6 | Offer percentages lack context | MEDIUM | "Conservative: 40-50% of market value" assumes the user knows that deep discounts are standard in land investing. A beginner may think this is predatory. |
| F7 | Intelligence tab is an unorganized data dump | HIGH | 15+ cards of technical data (PLSS, FEMA NRI, Capability Class, Hydrologic Group) with no tooltips, no "what this means" context, and no prioritization. A beginner cannot extract actionable insight. |
| F8 | Investment scores have no interpretive context | MEDIUM | "Overall Score: 67/100" with no explanation of the scale, methodology, or what constitutes a good score. The number conveys no meaning without a frame of reference. |
| F9 | No go/no-go decision workflow | CRITICAL | The product has no decision synthesis view, no "should I buy this?" summary, and no mechanism to record a go/no-go decision on a property. Data exists in fragments across tabs but is never unified into a recommendation. |
| F10 | AI Offer tab skips evaluation step | MEDIUM | The tab assumes the user has already decided to buy and jumps straight to offer pricing. The evaluation step ("is this a good investment?") is missing. |

---

## Recommendations

1. **Add a "Deal Scorecard" synthesis view** -- A single card at the top of the property detail that summarizes: estimated value, key risks (red/yellow/green), comp quality (how many, how close), and a plain-English recommendation. This replaces the need to visit 4 tabs to form a decision.

2. **Replace freeform AI chat with structured analysis** -- Instead of (or in addition to) a chat interface, provide a "Run Full Analysis" button that produces a formatted report with sections: Valuation, Risk Assessment, Market Position, and Recommendation. The report should use cards, color coding, and visual hierarchy -- not plain text.

3. **Add a "Quick Action" quick action** -- The most useful quick action for a beginner is "Should I buy this property?" / "Give me the bottom line." This should be the first and most prominent option.

4. **Add tooltips to every jargon term** -- Every tab label, every data field label, and every score should have an info icon with a plain-English explanation. "Flood Zone X" should expand to "Zone X means minimal flood risk -- this is good."

5. **Add a decision recording mechanism** -- A simple dropdown or button pair: "Pursue this deal" / "Pass on this deal" with an optional notes field. This lets the user record their decision and see it when they return.

6. **Rename beginner-hostile labels** -- "Due Diligence" to "Details", "Intel" to "Risk & Environment", "Comps" to "Market Value", "DD" to "Checklist", "AI Offer" to "Make an Offer."

---

## Verbatim Quotes (Maria would say)

1. "I tapped 'Analyze with AI' expecting it to, you know, analyze. Instead it opened a chat and asked ME what I want to know. I don't know what I want to know! That's why I'm using AI -- because I don't know the right questions to ask."

2. "There's a tab called 'Intel' and a tab called 'DD' and I have no idea what either of those means. Am I on a spy mission? What is DD?"

3. "The AI gave me a wall of text about comparable properties. I'm reading this tiny text on my phone and honestly I can't tell what the conclusion is. Just tell me: is this land worth the price or not?"

4. "I found the Comps tab and it says the property is worth $6,200 with a 'Conservative offer' of $2,480-$3,100. But... offering $2,500 for something worth $6,200? That feels wrong. Is that normal? The app doesn't explain why anyone would accept that."

5. "I scrolled through the Intelligence tab for like two minutes. FEMA NRI? PLSS? Capability Class III? I literally don't know what a single one of these things means and there's no help icon, no tooltip, nothing. It's like reading a foreign language."
