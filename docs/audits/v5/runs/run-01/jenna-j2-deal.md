# Jenna Okafor - Journey 2: First Deal Analysis

**Persona:** Jenna Okafor, 29, senior product designer at a fintech startup in Seattle. Zero real estate experience but high design literacy and professional evaluation lens. MacBook Pro 14" (laptop). Chrome. Expects polished, guided experiences. Evaluates products by how they feel, not just what they do.
**Journey:** First Deal Analysis -- evaluate a specific parcel using AI analysis and make a go/no-go decision.
**Starting State:** Logged in, has one parcel (a 2-acre lot in rural Oregon she found interesting, priced at $5,800). She wants to evaluate whether this is a good first purchase.
**Conditions:** Laptop (1440x900 retina) | Chrome | WiFi | Solo
**Date:** 2026-04-18

---

## Step 1: Navigate to Properties

**What I tried to do:** "It's Saturday morning. I've got two hours and coffee. Let me look at that Oregon property I added and figure out if it's actually worth buying."

**What I expected to see:** A clear entry point to my property with a prominent "Evaluate" or "Analyze" action. Something that communicates: "Here's what you need to decide."

**What I actually saw:** The sidebar navigation is visible on my laptop. I click "Properties" under the Properties section. The page loads with my single property card in a grid layout. On my 1440px screen, I see a 3-column grid (`lg:grid-cols-3`) with my one card in the first position and empty space for the remaining two columns.

The property card looks good:
- Satellite map thumbnail showing the parcel boundary (green outline on terrain) -- this is a nice design touch
- Status badge ("available") and LandCreditBadge in the top-right corner
- County, State as the title
- APN in monospace (looks technical and credible)
- Acreage and dollar value in a compact grid
- Price per acre with a green TrendingUp icon

At the bottom of the card, two actions:
- "Due Diligence" button (outline variant, full-width with a ClipboardCheck icon)
- Calculator icon button (outline, square)

**My reaction:** positive

The card design is clean. The satellite map with parcel boundary overlay feels premium -- like a real tool, not a toy. The typography is good (monospace for the APN conveys technical precision). The green TrendingUp for price-per-acre is a nice visual cue.

However, "Due Diligence" as the primary CTA is opaque to me. I vaguely associate it with corporate M&A ("due diligence period"). I'd expect something like "View Property" or "Evaluate Deal." But the design is nice enough that I'll click it.

**Friction Event F1 -- LOW:** "Due Diligence" as the CTA label is unfamiliar. I'd Google it in a new tab: "what is due diligence in real estate?" -- adding one more context switch. The label is technically correct but not beginner-friendly.

**Would I continue in real life?** yes -- The visual quality signals a legitimate product.

---

## Step 2: Open property detail and orient myself

**What I tried to do:** "Let me click into this property and see everything AcreOS knows about it."

**What I expected to see:** A well-organized property profile page with clear sections, visual hierarchy, and ideally some kind of progress indicator ("you've researched 3 of 8 areas").

**What I actually saw:** The property detail opens as a centered modal dialog (900px max-width on my 1440px screen). The dialog has:

**Header area:**
- Property name with MapPin icon (clean, not cramped)
- "Analyze with AI" button -- primary blue with a Bot icon. This is the most visually prominent action on the page. Nicely designed.
- APN, acreage, and status badge in a subtitle row

**Tab bar (5 tabs, grid layout on desktop):**
- Overview | Intel (with Brain icon) | Comps (with BarChart2 icon) | AI Offer (with Calculator icon) | DD

The tab icons appear on desktop (`hidden sm:inline`) so I can see them. The tab bar is well-proportioned in a 5-column grid.

**Overview tab content (default):**

1. **ResearchSummaryPanel** -- This is genuinely impressive UX:
   - A "Research Summary" card with a "15% Complete (F)" badge showing data completeness
   - A progress bar (visual reinforcement of the score)
   - A checklist showing what I have and don't have:
     - [x] Coordinates
     - [ ] Parcel Boundary
     - [ ] Intelligence Data
     - [ ] Comps Data
     - [ ] Market Value
     - [ ] Zoning
     - [ ] Road Access
     - [ ] Due Diligence
   - "Comps Quick View" section (loading or empty depending on data)
   - "Research Notes" textarea (auto-save)
   - "Quick Research Links" buttons: Google Maps, Zillow, County Assessor, APN Lookup

2. **Map** (if parcel data fetched) -- Interactive Mapbox map with 3D terrain, parcel boundary overlay, and nearby parcels
3. **Location Details** -- County, State, City, ZIP, Coordinates
4. **Property Characteristics** -- Size, Zoning, Terrain, Road Access, Utilities
5. **Financial Information** -- Assessed Value, Market Value, Purchase Price, Annual Taxes

**My reaction:** impressed

As a product designer, I'm noticing several things done well:

1. **The ResearchSummaryPanel is excellent design.** It shows me exactly where I am in the research process (15% complete), what I've done, and what I haven't done. This is the "progress and momentum" pattern I love in products. The checklist with green checks and gray circles creates a natural "collect them all" motivation.

2. **The "Analyze with AI" button is correctly positioned** -- it's the most prominent action, right where my eye goes after reading the property name. The Bot icon communicates "AI assistant" clearly.

3. **The tab structure creates a clear mental model.** Five tabs, each covering a different aspect of analysis. I can see the full scope of what's available without being overwhelmed.

4. **The map with 3D terrain** is a premium touch that signals technical capability.

However, I also notice:
- The Research Summary says "15% Complete (F)" -- an **F grade** on my first visit feels discouraging. I know it's measuring data completeness, but seeing "F" triggers anxiety. "Getting Started" or "Initial Research" would feel less like a failure state.
- The tab labels "Intel" and "DD" are unclear. I can guess "Intel" means intelligence, but "DD" is cryptic. The tab has no icon on mobile and only text on desktop.

**Friction Event F2 -- MEDIUM:** The Research Summary grade starts at "F" for a new property. While technically accurate (little data has been gathered), showing a letter grade of F creates a negative emotional frame. This is a design pattern issue -- the grade should either start at a neutral state or use encouraging progressive language ("Just Getting Started" instead of "F").

---

## Step 3: Click "Analyze with AI"

**What I tried to do:** "That blue AI button is calling to me. Let me see what the AI thinks about this property."

**What I expected to see:** A guided analysis experience -- maybe a multi-step wizard that walks me through: "First, let's check the value. Next, let's look at risks. Finally, here's my recommendation." Something designed.

**What I actually saw:** The AI chat panel slides in from the right as a Sheet component. Full-height, 32rem wide on desktop. The header shows:

- "Analyze Property with AI" title with Bot icon
- Property context: name, APN, acreage, market value, status badge

Below the header, an empty state:
- "Ask questions about this property or use the quick actions below to get started."
- Four quick action buttons stacked vertically:
  1. "What's the flood risk?" (Droplets icon)
  2. "Find similar properties" (Search icon)
  3. "Generate an offer" (FileText icon)
  4. "Calculate financing" (Calculator icon)

Bottom: Input field with "Ask about this property..." placeholder and a Send icon button.

**My reaction:** design critique mode activated

As a product designer, I see both strengths and weaknesses:

**Strengths:**
- The quick action buttons are well-sized touch targets with clear labels and icons
- The property context in the header provides grounding ("I'm analyzing the right property")
- The chat pattern is familiar from tools like ChatGPT, Notion AI, Copilot

**Weaknesses:**
- **This is a blank canvas, not a guided experience.** The product is asking ME what I want to know. I'm the beginner here -- the product should tell me what's important, then let me drill deeper. The ideal flow would be: "Here's an overview of this property's strengths and risks" (delivered automatically), then "What would you like to explore further?" (with smart follow-ups).
- **The quick actions don't build toward a decision.** Flood risk, comps, offer, financing -- these are individual data points. None of them say "Is this a good first purchase?" or "Here's my overall assessment." The product has decomposed the decision into fragments but hasn't composed a recommendation.
- **There's no "recommended path."** If I'm a beginner, which quick action should I start with? Flood risk? Comps? There's no suggested order, no "Start here" indicator, no numbered sequence.

**Friction Event F3 -- HIGH:** The AI analysis is a chat interface rather than a guided evaluation flow. A product designer (or any beginner) expects the AI to proactively deliver analysis, not passively wait for questions. The pattern should be: auto-generate overview first, then offer drill-down options.

---

## Step 4: Click "Find similar properties" and read the response

**What I tried to do:** "I'll start with comps since that seems most relevant to knowing if the price is right."

**What I expected to see:** A visually formatted response with a data table, key insights highlighted, and a clear takeaway.

**What I actually saw:** After clicking the quick action, my message appears in a blue bubble: "Can you find comparable properties similar to this one for valuation purposes?" The AI processes for a few seconds (Bot avatar + "Analyzing..." spinner), then a gray response bubble appears.

The AI response is **plain text** -- paragraphs of analysis rendered in a chat bubble with `whitespace-pre-wrap`. No markdown rendering, no tables, no bold, no bullet points (unless the LLM response happens to include bullet characters). The response discusses:
- General market conditions in the area
- Estimated price ranges per acre
- Factors affecting valuation
- Caveats about data limitations
- A text-based conclusion

At the bottom of the response bubble, follow-up suggestions appear as small secondary buttons: "What's the price per acre for this area?" and "How long do similar properties take to sell?"

**My reaction:** professionally disappointed

This is where the product breaks its own design language. Every other part of AcreOS uses cards, badges, color coding, progress bars, and structured layouts. The property detail dialog is well-organized with tabs and data grids. But the AI output -- the single most important feature for a beginner making a decision -- is a wall of unformatted text in a chat bubble.

As a designer, I know exactly what this should look like:
- A structured response card with sections: "Value Estimate", "Market Context", "Key Risks", "Recommendation"
- Bold key numbers ($X,XXX estimated value)
- Color-coded risk indicators (green/yellow/red)
- A confidence meter (how reliable is this analysis?)
- Source badges (where did this data come from?)

Instead, I'm reading a paragraph that says something like "based on my analysis, the property appears to be priced at approximately $2,500-$3,500 per acre, which would put the estimated value in the range of $5,000-$7,000..." -- buried in prose, not highlighted.

The follow-up suggestion buttons at the bottom are a nice touch (they reduce the blank-canvas problem), but they can't compensate for the unstructured primary response.

**Friction Event F4 -- HIGH:** AI responses are plain text in chat bubbles with no visual formatting. The entire product uses structured components (cards, badges, progress bars, tables) except the AI output, which is the feature a beginner relies on most. This creates a jarring inconsistency in design language and makes AI insights harder to parse.

**Friction Event F5 -- MEDIUM:** AI responses don't include confidence indicators. The AI says "the property appears to be priced at approximately $X" but doesn't say "I'm 85% confident in this estimate" or "this estimate is based on limited data." A beginner has no way to gauge reliability.

---

## Step 5: Explore the Comps tab for structured data

**What I tried to do:** "Let me check the Comps tab instead -- maybe the structured view is better."

**What I expected to see:** A designed data view that visually communicates whether this property is fairly priced.

**What I actually saw:** I close the AI panel and click the Comps tab. The `CompsAnalysis` component loads and displays (assuming coordinates exist):

On my 1440px laptop screen, I see:

1. **Market Analysis summary cards** in a 4-column grid:
   - Avg $/Acre, Median $/Acre, High $/Acre, Low $/Acre
   - Each with a clean card layout, icon, and bold number
   - Good use of green for High (opportunity) and red for Low (floor)

2. **Estimated Market Value** highlight card:
   - Primary border color, subtle background tint
   - Large bold number: "$6,200" (hypothetical)
   - Subtext: "Based on 6 comparable sales for 2.00 acres"
   - This is exactly the kind of design I respect -- clear hierarchy, one key number, supporting context

3. **Offer Suggestions** in a 3-column grid:
   - Conservative (green): $2,480 - $3,100
   - Standard (blue): $3,100 - $4,030
   - Aggressive (orange): $4,030 - $4,960
   - Each with a label, price range, and "% of market value" context

4. **Property Desirability Score:**
   - Score badge: "62/100 (C)" with conditional color
   - Clickable to expand factor breakdown with progress bars per factor (Road Access, Distance to Services, etc.)

5. **Comparable Properties table:**
   - 6 columns: Address, Acreage, Sale Date, Sale Price, $/Acre, Distance
   - Clean table design with individual comp rows
   - Each showing APN and full location

**My reaction:** this is well designed

The Comps tab is strong product design:
- Visual hierarchy is clear (estimated value is the hero number)
- Color coding on offer tiers creates an intuitive spectrum
- The desirability score with expandable breakdown is a pattern I'd design
- The comps table provides transparency (I can see the underlying data)

Issues I notice:
1. **No explanation of offer percentages.** "Conservative: 40-50% of market value" -- why would I offer so far below market? Is this normal? As a beginner, I'd think offering $2,500 for a $6,200 property is an insult to the seller. The product doesn't explain that deep discount offers are standard in land investing.
2. **The "$0.10 per query" label under Refresh** is small but anxiety-inducing. Am I being charged right now? Was I charged when the tab loaded? This tiny text creates uncertainty about cost.
3. **No "what to do with this information" guidance.** The tab shows me data but doesn't connect it to action. I see that the estimated value is $6,200 -- great. What do I do with that? There's no "Next Step" prompt, no "If you want to pursue this, here's what to do" CTA.

**Friction Event F6 -- MEDIUM:** Offer percentages (40-50% of market value) are presented without educational context. A beginner doesn't know that deeply discounted offers are standard practice in land investing and may interpret the suggestions as predatory or insulting.

**Friction Event F7 -- LOW:** "$0.10 per query" label appears under the Refresh button but it's unclear whether the initial load also costs $0.10 or only manual refreshes. Cost transparency should be explicit.

---

## Step 6: Look at the Intel tab for risk information

**What I tried to do:** "Now I need to check if there's anything wrong with this property -- flood risk, environmental issues, things that could make it worthless."

**What I expected to see:** A risk dashboard with clear red/yellow/green indicators and explanations of what each risk means for my investment.

**What I actually saw:** The Intel tab shows the `PropertyIntelligenceTab`. If enrichment data hasn't been fetched yet, I see a clean empty state:
- Brain icon (centered, muted)
- "No Intelligence Data" headline
- "Click 'Refresh Intelligence' to fetch environmental, hazard, and demographic data for this property."
- "Fetch Intelligence" button

I click "Fetch Intelligence." The button shows a loading spinner. After a few seconds, the data populates.

Now I see a grid of data cards (2 columns on desktop, `md:grid-cols-2`):

- **Investment Scores** -- Overall, Investment, Development, Risk as numbers
- **Flood & Water Risk** -- Flood Zone code, risk level badge, wetlands
- **Natural Hazards** -- Earthquake, Wildfire, Overall Risk
- **Environmental Factors** -- EPA Sites, Soil Type, Capability Class, Prime Farmland
- **Infrastructure** -- Nearest Hospital/Fire/School distances, Access Score
- **Demographics** -- Population, Income, Home Values, etc.
- And 8-10 more cards: Transportation, Public Lands, Water, Elevation, Climate, Agriculture, Land Cover, EPA, Storm History, PLSS, Watershed, FEMA NRI, USDA CLU...

**My reaction:** information overload, but well-structured

The card-based layout is clean. Each card has a header with an icon and a consistent internal structure (label: value pairs with good spacing). The risk badges use green/yellow/red color coding, which is intuitively readable.

But the sheer volume is overwhelming. Scrolling through 15+ data cards feels like reading a technical report, not evaluating an investment. The information I actually need to make a decision (flood risk? environmental contamination? road access?) is mixed in with information I don't need right now (PLSS section/township/range? USDA CLU farm number? Watershed HUC codes?).

As a designer, I'd restructure this as:
1. **Risk Summary** (top-level card): One hero card showing "3 risks detected" with color-coded badges
2. **Key Metrics** (second level): The 4-5 data points most relevant to a purchase decision
3. **Detailed Data** (expandable): All the deep data in an accordion, collapsed by default

Currently, all data is presented at equal visual weight. The Investment Score card looks the same as the USDA CLU card, even though one is critical for my decision and the other is niche agricultural data I'll never use.

**Friction Event F8 -- HIGH:** All intelligence data cards are presented at equal visual weight with no prioritization. Critical risk data (flood, environmental contamination, road access) is mixed with niche specialist data (PLSS, USDA CLU, Watershed HUC codes). A beginner cannot distinguish what matters from what doesn't.

**Friction Event F9 -- MEDIUM:** No explanatory context on data fields. "Flood Zone: X" -- is X good or bad? "Capability Class: III" -- what does that mean? "Prime Farmland: No" -- does that matter for my purchase? The data is presented but not interpreted.

---

## Step 7: Try to reach a decision

**What I tried to do:** "OK, I've looked at the comps, the AI chat, and the intelligence data. I'm trying to decide: should I buy this property?"

**What I expected to see:** Some kind of synthesis or decision support. A summary that pulls together: value estimate + risks + market context = recommendation. Maybe a "Decision Dashboard" or "Go/No-Go Checklist."

**What I actually saw:** There is no synthesis view. The closest thing is:

1. **ResearchSummaryPanel** (Overview tab) -- Shows completeness percentage and a checklist, but no interpretation of the data
2. **AI Chat** -- I could ask "should I buy this?" but I'd get another text wall
3. **Comps tab** -- Shows estimated value and offer ranges, but no risk integration
4. **Intel tab** -- Shows risks, but no value integration
5. **AI Offer tab** -- Assumes I've already decided to buy

The product has all the data needed for a decision. It's spread across 4 tabs. But nobody brought it together.

I can try the "AI Offer" tab as a last resort:

The `AIOfferGenerator` component has a "Generate AI Offer" button. When clicked, it calls the server and returns:
- Estimated market value
- Three offer strategies (Conservative, Standard, Aggressive) with confidence scores
- Market analysis summary
- Property desirability score with factor breakdown
- AI reasoning paragraph
- Generate Offer Letter button
- Acceptance Prediction (probability seller will accept)

The AI Offer tab is actually the richest synthesis in the product. It combines market data, property scoring, and AI reasoning into a single view. But it's framed as an "offer generator" rather than a "decision tool." The framing assumes I've already decided to buy -- the question it answers is "how much to offer" not "should I offer at all."

If I could see this data with a different frame -- "Deal Evaluation" instead of "AI Offer" -- it would serve my decision-making needs much better.

**My reaction:** so close yet so far

The product has genuinely good data. The comps analysis is well-designed. The intelligence breadth is impressive. The AI offer generator combines multiple data sources into a coherent view. But the product never says: "Based on everything we know, here's our assessment of this deal."

I'm left to synthesize across tabs myself:
- Comps say the property is worth ~$6,200 (I paid $5,800 -- good)
- Intel says flood risk is low (good), no EPA sites (good), access score 70/100 (decent)
- AI Offer suggests offering $2,500-$3,800 (so the seller is asking market price)

I can piece together a tentative conclusion: "This property is at market value, has low risk, and decent access. It might be worth buying as a hold or resale, but the margin is thin since the asking price is near market value."

But I did that work myself. The product didn't help me do it.

**Friction Event F10 -- CRITICAL:** No decision synthesis view. Data exists across 4 tabs but is never unified into a recommendation. The product has all the inputs for a go/no-go recommendation but never produces one. For a beginner who relies on the product for guidance, this is a failure to deliver on the implicit promise of "AI deal analysis."

**Friction Event F11 -- MEDIUM:** The AI Offer tab is framed as an action tool ("generate an offer") rather than an evaluation tool ("should I pursue this?"). Reframing it as "Deal Evaluation" with an optional "Generate Offer" sub-action would better serve the decision workflow.

---

## Step 8: Try to record my decision

**What I tried to do:** "I think I'd cautiously pursue this. The numbers look reasonable. Let me mark it somehow."

**What I expected to see:** A "Pursue" or "Pass" button. Maybe a star/bookmark. Maybe a "Move to Pipeline" action that creates a deal.

**What I actually saw:** The property detail dialog has no decision-recording mechanism. I can:

1. **Write in Research Notes** (ResearchSummaryPanel) -- Free-text auto-saving textarea. I could type "PURSUE - seems fair at market value, low risk. Consider offering $4,000." This persists but isn't structured data.

2. **Change property status** -- But I'd need to go to an edit form, and the status values are "available", "under_contract", "sold" -- none of which represent "I've evaluated this and want to pursue it."

3. **Create a Deal** -- I could navigate to the Deals page and create a new deal linked to this property. But that requires:
   - Closing the property detail dialog
   - Navigating to /deals
   - Clicking "Add Deal"
   - Selecting the property from a dropdown
   - Entering offer amount
   - Setting deal stage

   That's a 5-step process to record a simple "yes, pursue this" decision.

There is no "Convert to Deal" or "Start Deal" shortcut in the property detail view.

**My reaction:** frustrated

This is a classic "missing bridge to action" problem -- exactly the failure mode described in my persona. I found a property I like. Now what? The product showed me data and analysis but doesn't help me take the next step. There's no clear path from "I like this property" to "I'm pursuing this property."

The Research Notes textarea is my only option for recording a decision. It works but it doesn't feel intentional -- it feels like a workaround. As a product designer, I know this gap exists because the product was designed as separate modules (Properties, Deals, AI) that don't have a connecting workflow.

**Friction Event F12 -- HIGH:** No "Convert to Deal" or "Start Pursuing" action in the property detail view. Moving from evaluation to action requires navigating to a different page and manually creating a deal -- a multi-step workflow that breaks the flow of a decision moment.

---

## Final Verdict: CONDITIONAL PASS

Jenna completed the evaluation journey but with significant friction in three areas: (1) the AI analysis is unstructured, (2) there is no decision synthesis view, and (3) recording a decision requires leaving the property context.

She did not abandon because the visual quality kept her engaged and the Comps tab provided genuinely useful structured data. She was able to form a tentative decision ("cautiously pursue") but she had to synthesize the data herself across tabs rather than being guided to a conclusion.

Her confidence in the decision is **moderate** -- she has price data and risk data, but she's unsure whether she's interpreting the offer percentages correctly, and no element of the product confirmed "this is a reasonable first purchase."

**Acceptance criteria results:**

| # | Condition | Result |
|---|-----------|--------|
| A1 | Analysis completes in under 2 minutes | PASS -- Comps load in seconds. Intelligence fetch takes ~5-10 seconds. AI chat responds in 3-5 seconds. |
| A2 | Results are comprehensible to someone with basic RE knowledge | PARTIAL -- Comps are clear. Intelligence data is dense but color-coded. AI responses lack visual structure. Many technical terms unexplained. |
| A3 | Key data points are present | PASS -- Estimated value, comparable sales, risk factors (flood/wildfire/earthquake), and offer suggestions are all present. |
| A4 | Data does not contradict obvious reality | PASS -- No contradictions observed. Data sources are real federal APIs. |
| A5 | User reaches a decision with stated confidence | PARTIAL -- Jenna formed a tentative decision but had to synthesize data herself. Confidence is moderate, not high. The product did not guide her to a conclusion. |
| A6 | Decision is recorded and persisted | FAIL -- No structured decision field. She could use Research Notes (free text) but there is no "pursue" or "pass" action. |

---

## Friction Events

| # | Event | Severity | Description |
|---|-------|----------|-------------|
| F1 | "Due Diligence" CTA label is jargon | LOW | The primary button on property cards uses industry terminology. "View Details" or "Evaluate" would be more accessible. |
| F2 | Research Summary starts at grade F | MEDIUM | A letter grade of "F" on first visit creates negative framing. Should use neutral progressive language ("Getting Started") instead of a failing grade metaphor. |
| F3 | AI analysis is chat-based, not guided | HIGH | The "Analyze with AI" feature opens a freeform chat rather than delivering a proactive, structured analysis. A beginner expects the AI to lead the conversation, not wait for questions. |
| F4 | AI responses are unformatted text | HIGH | AI output is plain text in chat bubbles -- no cards, no bold numbers, no color coding, no visual structure. This is inconsistent with the designed quality of every other component. |
| F5 | AI responses lack confidence indicators | MEDIUM | No reliability or confidence scoring on AI outputs. A beginner cannot gauge how much to trust an estimate or recommendation. |
| F6 | Offer percentages lack educational context | MEDIUM | "Conservative: 40-50% of market value" is presented without explaining why deep-discount offers are standard in land investing. A beginner may interpret this as predatory. |
| F7 | Comps cost transparency is ambiguous | LOW | "$0.10 per query" under the Refresh button doesn't clarify whether the initial auto-load also costs money. |
| F8 | Intelligence data has no visual prioritization | HIGH | 15+ data cards presented at equal weight. Critical risk data (flood, EPA) is mixed with niche data (PLSS, USDA CLU). A beginner cannot distinguish what matters. |
| F9 | Technical terms lack explanatory context | MEDIUM | "Flood Zone: X", "Capability Class: III", "Prime Farmland: No" -- values are shown without interpretation. No tooltips explain what these mean for a purchase decision. |
| F10 | No decision synthesis view | CRITICAL | Data exists across 4 tabs but is never unified into a single recommendation or go/no-go assessment. The product has all the inputs but never produces the output a beginner needs. |
| F11 | AI Offer tab is framed as action, not evaluation | MEDIUM | The tab presumes the user has decided to buy and focuses on offer generation. Reframing as "Deal Evaluation" with an optional "Generate Offer" action would better serve the decision workflow. |
| F12 | No "Convert to Deal" action | HIGH | Moving from property evaluation to deal pursuit requires leaving the property context, navigating to /deals, and creating a deal manually. The bridge from research to action is missing. |

---

## Recommendations

1. **Auto-generate a Deal Scorecard when the property detail opens** -- Before the user asks any questions, proactively display a synthesis card at the top of the Overview tab: "Based on 6 comps, estimated value is $6,200. Risk level: Low. Desirability: C (62/100). Margin at asking price: 7%." This card should use the visual language of the rest of the product (color-coded badges, clear hierarchy).

2. **Upgrade AI responses with structured formatting** -- Render AI responses using the same card/badge/table components as the rest of the product. When the AI discusses comparable sales, show a mini-table. When it discusses risks, show color-coded badges. The AI output should feel like a natural extension of the product's design system, not a raw text dump.

3. **Add a "Pursue / Pass / Watch" tri-state action** -- In the property detail header, add a simple 3-button group: "Pursue" (creates a deal), "Pass" (records decision with notes), "Watch" (adds to watchlist). This bridges the gap between research and action.

4. **Prioritize intelligence data with a tiered layout** -- Top level: Investment Score summary + Risk alerts (if any). Second level: Key metrics (flood, access, environmental). Third level: Expanded data in collapsible sections. Not all data is equally important -- the UI should reflect that.

5. **Replace "F" grade with progressive framing** -- Instead of "15% Complete (F)", show "Getting Started -- 15% researched" or "Early Research" with a softer visual treatment. Reserve letter grades for after meaningful data has been gathered.

6. **Add educational tooltips on offer percentages** -- When showing "Conservative: 40-50% of market value", include an info icon that explains: "In land investing, owners are often willing to sell at significant discounts for a quick cash sale. A conservative offer maximizes your profit margin while remaining competitive."

7. **Add an "Analyze This Deal" auto-prompt in the AI chat** -- When the AI chat opens, automatically send a first message: "Give me a quick assessment of this property as a potential first purchase, including estimated value, key risks, and whether the asking price is fair." The user sees the AI proactively working, not waiting.

---

## Verbatim Quotes (Jenna would say)

1. "The Research Summary panel is actually really good UX -- I can see exactly what research I've done and what's missing. But starting at an F grade? Come on. I just got here. Don't grade me before I've started."

2. "I clicked 'Analyze with AI' expecting a polished analysis dashboard and got... a chat window. Every other part of this product uses cards and badges and progress bars, but the AI -- the headline feature -- gives me a gray text bubble? This feels like they ran out of design budget on the most important page."

3. "The Comps tab is genuinely well-designed. The estimated value card with the big number, the three offer tiers in color-coded cards, the desirability score with factor breakdown -- this is professional-grade UX. If the AI chat looked like this, I'd be sold."

4. "I spent 45 minutes across four tabs and pieced together that this property is probably worth the asking price with low risk. But the app never told me that. I had to be my own analyst. The data was all there, scattered across tabs -- someone just needs to bring it together into one 'Here's the deal' summary."

5. "The product is 80% of the way there. It has beautiful cards, real data from federal APIs, a solid comp engine, and an AI chat. But it's missing the connective tissue: a synthesis view that brings it all together, and a 'pursue this deal' button that turns research into action. As a designer, I'd ship those two features before anything else."
