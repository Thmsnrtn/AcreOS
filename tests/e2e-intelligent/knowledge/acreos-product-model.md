# AcreOS Product Model — What the Product Claims to Do

## Positioning
"The AI-Powered Platform for Land Investors" — find motivated sellers, analyze parcels, send direct mail, close deals in one platform.

## Core Capabilities (verified as built per reality check)
- **CRM**: Leads (39-column table), Properties, Deals pipeline, seller-financed Notes
- **AI Analysis**: Atlas agent evaluates parcels via OpenRouter LLM (comps, valuation, risk flags)
- **Direct Mail**: Lob integration for campaign creation and sending (requires Lob API key)
- **Skip Tracing**: BatchData integration for owner contact lookup (requires key)
- **Data Enrichment**: 6 free sources (FEMA, Census, USGS, USDA, EPA, BLM) + 3 paid (ATTOM, Regrid, BatchData)
- **AI Assistants**: Pax (operations copilot), Sophie (support), Atlas (analysis)
- **Autonomous Executor**: 30-min cycle, scans decisions inbox, auto-executes at 75%+ confidence, hard stops at $500+
- **Seller Finance**: Note tracking, amortization, borrower portal at /portal
- **Billing**: Stripe tiers — Free ($0), Starter ($20/mo), Pro ($49/mo), Scale ($79/mo)

## Navigation Structure (sidebar)
- Dashboard (/)
- CRM: Leads, Skip Tracing, Properties, Portfolio Map, Deal Pipeline, Marketplace, Listings, Documents, Blind Offer Wizard
- Campaigns: Campaigns, Direct Mail, Sequences
- Inbox
- AI Hub
- Intelligence: Insights, AI Valuations, Land Credit, Markets, Counties, Acq. Radar, Document Intel, Compliance
- Finance: Finance, Cash Flow, Portfolio, Capital Markets
- Settings: Settings, Tools, Data Export, Help

## Key UI Patterns
- Property detail dialog with Quick Verdict card (traffic-light investment score + Pursue/Pass)
- Tabbed property views: Overview, Intelligence, Due Diligence, Comparables, AI Offer
- Data provenance tags on financial values (source + date + confidence)
- Structured AI analysis via "Run Quick Analysis" button (5-section card output)
- Getting Started Checklist on /today for new users with 0 data
- Welcome Back card for returning users (7+ day absence)
- Floating feedback button + early-access banner
- Sophie available in floating assistant

## Known Limitations (honest)
- AI features require valid OpenRouter API key
- Direct mail requires Lob API key
- Skip tracing requires BatchData key
- No list building / external property search (AcreOS manages leads, doesn't find them)
- No mobile app (responsive web)
- No public API documentation
- First-run onboarding can overwhelm beginners (30+ sidebar items)
