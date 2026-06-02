# Acquire.com Listing: AcreOS

## Title

AcreOS — AI-Powered Real Estate Investor Operating System (Pre-Revenue, Deploy-Ready)

## Summary

AcreOS is a fully built, deploy-ready SaaS platform that serves as the single operating system for real estate investors. It covers the entire investor lifecycle — deal discovery, property analysis, offer generation, transaction management, seller-financed note servicing, and portfolio tracking — with AI intelligence woven throughout. The platform supports 7 investor types (land flipper, buy-and-hold, wholesaler, developer, commercial, fix-and-flip, seller finance), integrates 18 free government data sources for automated due diligence, and includes a proprietary Land Credit Score (300-850) that rates parcels like FICO rates borrowers. Built as a modern TypeScript monolith with 400K+ lines of production code, 276 database tables, and 4,875+ passing tests, it's ready for immediate deployment with no additional engineering required.

## Key Metrics

| Metric | Value |
|--------|-------|
| Lines of Code | 400,000+ TypeScript |
| Services | 240+ |
| Pages/Views | 145+ |
| Database Tables | 276 |
| Test Suite | 4,875+ tests across 151 files |
| Investor Types | 7 fully supported |
| Intelligent Pipelines | 11 |
| Autonomous Founder Agents | 5 (customer success, growth, revenue, operations, digest) |
| Land Credit Score | Proprietary, 300-850, 6-dimension scoring |
| Pricing Tiers | 3 active ($0/$20/$49), 2 feature-flagged |
| Mobile App | Capacitor-ready (iOS + Android) |
| Billing | Full Stripe integration with 14-day free trials |
| Data Sources | 18 free government + 3 BYOK premium |

## Tech Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui, Framer Motion
- **Backend:** Express.js, TypeScript, Drizzle ORM
- **Database:** PostgreSQL (276 tables)
- **Real-time:** WebSocket with authenticated channels
- **AI:** OpenRouter (primary) → OpenAI (fallback), 24 agent skills
- **Payments:** Stripe (subscriptions, usage metering, Connect for note payments)
- **Email:** AWS SES with org-level credential override
- **SMS:** Twilio + Telnyx provider abstraction
- **Mobile:** Capacitor (iOS + Android shell ready)
- **Monitoring:** Sentry error tracking, structured logging

## What Makes This Special

1. **Land Credit Score (LCS):** A proprietary 300-850 scoring system that rates land parcels across 6 dimensions (flood risk, soil quality, access, utilities, topography, environmental). No competitor has anything comparable. The scoring improves with transaction outcomes via a calibration feedback loop.

2. **18 Free Government Data Sources:** Automated due diligence that queries FEMA, USGS, USDA, EPA, Census, NOAA, and 12 more sources. Replaces hours of manual research with a one-click report. Data is free — the value is in the aggregation and scoring.

3. **Full Note Lifecycle Management:** From amortization schedule generation to borrower portal to Dodd-Frank compliance checking to automated dunning. No other land investing platform handles seller-financed notes end-to-end.

4. **5 Autonomous Founder Agents:** AI agents that handle customer success (churn prevention, onboarding optimization), growth (campaign optimization, community engagement), revenue (pricing analysis, upgrade triggers), operations (system health, data source monitoring), and daily digest (executive summary of what happened overnight).

5. **Voice Learning:** All AI output (offer letters, campaign copy, negotiation suggestions, agent communications) is personalized to match each user's communication style. The system learns from the user's previous messages and adapts its tone, vocabulary, and structure.

## Revenue Model

- **SaaS Subscriptions:** Free ($0) / Starter ($20/mo) / Pro ($49/mo) — feature-gated tiers with 14-day free trial
- **Embedded Payment Processing:** Stripe Connect for note payments (potential transaction fee revenue)
- **Marketplace Fees (Future):** Property marketplace with listing fees and buyer/seller matching
- **API/Data Access (Future):** Land Credit Score API, market intelligence data, embeddable widgets for third-party sites

## Why Selling

*(To be completed by seller)*

## Asking Range

$250,000 — $500,000

## Additional Notes

- Platform is fully functional and deploy-ready on Fly.io
- Complete documentation: API reference, architecture decision records, security posture, deployment checklist
- Engineering standards document (CLAUDE.md) ensures code quality consistency
- 7-pass voice quality refinement removed 6,776 lines of mechanical code across 317 files
- No technical debt that would block immediate deployment
- Domain: acreos.io (if included in sale)
