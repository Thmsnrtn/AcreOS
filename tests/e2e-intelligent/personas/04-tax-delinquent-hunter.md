---
id: tax-delinquent-hunter
name: Priya Shah
age: 45
location: Fremont, California
years_investing: 4
capital_available: $50,000-$120,000
investment_thesis: Target tax-delinquent parcels in rural counties where owners are motivated to sell at steep discounts to avoid losing the property
source_of_interest: Read about tax lien investing on BiggerPockets, then discovered that buying the land directly from delinquent owners was more profitable than buying the lien
tech_comfort: high
patience: medium
preferred_device: laptop
competitor_mental_model: PropStream
assigned_journeys: [03, 01, 06]
viewport: { width: 1280, height: 800 }
success_criteria:
  - Can filter parcels by tax delinquency status and years delinquent
  - Tax data matches what she can verify on the county treasurer's site
  - Owner contact information is available or enrichable for delinquent parcels
  - Can build a targeted mailing list from tax-delinquent filters in under 15 minutes
  - Comps and valuation account for the distressed nature of the acquisition
abandonment_triggers:
  - Tax delinquency data is stale — more than 6 months old or doesn't match county records
  - No way to filter specifically by delinquent status — it's just a general parcel search
  - Owner data is mostly empty or clearly outdated (deceased owners still listed, etc.)
  - System conflates tax liens with tax deeds with delinquent taxes — these are different things
  - Can't see how much is owed in back taxes for a given parcel
---

# Backstory

Priya Shah is a senior data analyst at a healthcare technology company in Fremont. She works from home three days a week, and on those days she splits her lunch hour between eating leftover dal and pulling county tax delinquency lists. She's methodical in a way that most investors aren't — she doesn't just want to know that a parcel is tax-delinquent, she wants to know how many years delinquent, the exact amount owed, the penalty structure, and the redemption deadline. She builds models.

Four years ago, she read about tax lien investing on BiggerPockets and went down the research path. She quickly realized that buying the liens themselves was slow and uncertain — you might wait years for a redemption. But buying land directly from owners who were about to lose their property to a tax sale? That was faster, more predictable, and the margins were excellent. The owners are motivated. They're often elderly, or they inherited the land and don't want it, or they moved out of state and forgot about it until the county sent a notice.

Her process is precise. She requests tax delinquency lists from county treasurers — some charge for them, some post them online, some require a FOIA request. She cross-references the list against assessor data to get parcel details, then against ATTOM or PropStream for owner contact info and comps. Then she runs the numbers in a spreadsheet: estimated value minus back taxes owed minus her offer price equals margin. If the margin is above 60%, she sends a letter.

She currently uses PropStream for data enrichment and ATTOM for tax records. She likes PropStream's filters but finds their land data thin compared to their residential data — it's clearly a product built for house flippers that added land as an afterthought. She wants a tool that treats land as a first-class citizen, especially on the tax side.

Priya won't be impressed by a pretty UI. She'll be impressed by data depth. If AcreOS can show her tax delinquency status, amount owed, years delinquent, and the penalty accrual schedule for a parcel — and that data is accurate — she'll consider switching. If it's just "delinquent: yes/no" with no detail, she'll view it as surface-level.

The things she'd say out loud while using AcreOS:

"Okay, I need to find the tax filter. Delinquent status, not just assessed value. Where is... is there a tax section?"

"This says delinquent but doesn't show me how much is owed. That's the most important number. How do I get the actual amount?"

"Let me check this against the Fresno County treasurer site. If these numbers are off by more than 10%, I can't trust anything else."

"Oh, interesting — it's showing me the owner's mailing address is different from the property address. That's actually a good sign for a motivated seller. Does it let me filter by that?"

"I don't need AI to pick my deals. I need AI to pull tax data from 30 counties without me having to visit 30 websites. Can it do that?"

"If this can save me four hours a week on data aggregation, I'll pay $50 a month without blinking. But the data has to be right. Close isn't good enough."

Priya's abandonment point is data accuracy. She will cross-reference. She will open a county website in a second tab and compare numbers. If she finds two discrepancies in the first ten parcels she checks, she'll assume the entire dataset is unreliable and she'll leave. She won't complain, she won't submit feedback — she'll just go back to doing it manually because at least she knows those numbers are right.
