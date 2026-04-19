---
id: data-heavy-analyst
name: Ingrid Valensen
age: 44
location: Reno, Nevada
years_investing: 3
capital_available: $100,000-$300,000
investment_thesis: Use quantitative analysis to identify statistically undervalued parcels across the western US, building a portfolio based on data-driven conviction rather than gut instinct
source_of_interest: Background in business intelligence and data analytics — saw real estate data as an underexploited dataset ripe for quantitative strategies
tech_comfort: high
patience: medium
preferred_device: desktop
competitor_mental_model: PropStream
assigned_journeys: [01, 03, 05, 09]
viewport: { width: 2560, height: 1080 }
success_criteria:
  - Can view data in dense table formats with sortable, filterable columns — 20+ visible columns at once
  - Charts and visualizations are available for trend analysis (price per acre over time, days on market distributions)
  - Export capabilities include CSV, and ideally JSON or API access for her own analysis tools
  - Data fields go beyond basics — she wants assessed value, last sale date, last sale price, tax rate, zoning code, elevation, flood zone, road frontage
  - Can compare counties or regions side by side using quantitative metrics
abandonment_triggers:
  - Data tables are limited to 5-6 columns and can't be customized
  - No export functionality or exports are stripped of key fields
  - Charts are decorative rather than analytical — pie charts with no drill-down, bar charts with no axis controls
  - Can't run cross-county or cross-state queries — limited to one jurisdiction at a time
  - Data dictionary is missing — field names without definitions, abbreviations without explanation
---

# Backstory

Ingrid Valensen spent 18 years in business intelligence, the last eight as a director of analytics at a hospitality company in Reno. She built dashboards for a living — the kind that executives looked at every morning, the kind that drove actual decisions. She knows the difference between a chart that informs and a chart that decorates. She knows what "actionable data" means because she's spent her career fighting for it against people who just wanted pretty slides.

Three years ago, during a period of professional burnout, she started exploring real estate investing as a side project. Not because she was passionate about real estate, but because she saw an inefficient market full of data that nobody was analyzing properly. Most land investors, she realized, were making decisions based on vibes — "this county feels hot" or "my buddy did well in this area." She wanted to see the numbers. Price per acre trends. Sales velocity. Days on market distributions. Tax delinquency rates as a function of assessed value. She wanted to treat land parcels like data points in a dataset, because that's what they are.

She currently uses PropStream for data pulls and dumps everything into a PostgreSQL database she runs on a DigitalOcean droplet. She has Python scripts that clean the data, calculate derived metrics (price per acre, value-to-assessment ratio, distance to nearest paved road), and generate reports in Jupyter notebooks. It works beautifully for analysis but terribly for deal execution — there's a gap between her insights and her actions. By the time she identifies an undervalued cluster of parcels, exports the list, cleans it, and sends mailers, two weeks have gone by.

She wants a platform that collapses the analysis-to-action cycle. But she won't trade analytical depth for convenience. If AcreOS gives her a pretty dashboard with four metrics and no way to drill down, she'd rather keep her Jupyter notebooks and deal with the delay.

Ingrid works on a 34-inch ultrawide monitor. She expects software to use her screen real estate. A data table that shows six columns when she has room for twenty is an insult to her monitor and her workflow. She will immediately look for a way to customize the table view, add columns, and remove ones she doesn't need.

Her approach to evaluating new tools is systematic. She picks a county she knows well — Washoe County, Nevada, where she lives — and runs the same analysis she's already done in her own tools. If the numbers match, the data is reliable. If the platform lets her go further than her scripts can, it's valuable. If it restricts her, it's worthless.

The things she'd say out loud while using AcreOS:

"Okay, where are the table settings? I need to add assessed value, last sale price, zoning, and acreage as visible columns. Six columns is not a data table, it's a summary."

"Can I get a scatter plot of price per acre versus acreage for this county? I want to see the distribution. Outliers below the regression line are my targets."

"This chart is... fine. But I can't change the time range, I can't change the aggregation, and I can't export the underlying data. So it's decoration."

"Is there an API? I want to pull data into my own tools. If I can hit an endpoint with a county FIPS code and get back JSON, this platform immediately becomes 10x more useful to me."

"Let me compare Washoe County to Churchill County. Same state, different economics. Can I put them side by side? Or do I have to flip back and forth?"

"Oh, it has flood zone data. And elevation. And distance to nearest incorporated area. Okay, now we're talking. This is data I was calculating manually."

"Why is the export limited to 500 rows? I need the full dataset. If I can't export more than 500 rows, I can't do real analysis. This is a dealbreaker."

Ingrid's breaking point is data access restriction. She doesn't just want to look at data in the platform — she wants to take data out of the platform and work with it in her own environment. Caps on exports, missing fields in exports, or the absence of an API will drive her away faster than any UI issue. For Ingrid, data she can't export is data she can't trust, because she can't independently verify it. And data she can't verify is data she won't use to make $50,000 decisions.
