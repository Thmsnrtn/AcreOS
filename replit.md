# AcreOS - Land Investment Management Platform

## Overview

AcreOS is a full-stack SaaS platform for land investors, offering CRM, property tracking, financial note management, and AI-powered automation. It supports multi-tenancy with organization-based data isolation and Stripe-powered subscription billing. The platform aims to streamline land investment operations, providing a comprehensive solution for managing leads, properties, deals, and finances with advanced AI capabilities.

## User Preferences

Preferred communication style: Simple, everyday language.

### Design Preferences
- **Color Scheme**: Sedona Desert theme
  - Light mode: Warm sandy creams, terracotta primary, desert sage green accents
  - Dark mode: Deep warm browns, rich terracotta, subtle sage greens
- **UI Style**: macOS Tahoe-inspired
  - Glassmorphism effects with backdrop blur
  - Floating window appearance with subtle shadows
  - Rounded corners (0.875rem radius)
  - Vibrancy effects on sidebars
  - System fonts (-apple-system, SF Pro)

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript, Wouter for routing, TanStack React Query for state.
- **Styling**: Tailwind CSS with shadcn/ui (New York style), Recharts for charts, Framer Motion for animations.
- **Build**: Vite with custom path aliases.
- **UI/UX**: macOS Tahoe-inspired design with specific color schemes (Sedona Desert for light/dark mode), glassmorphism effects, rounded corners, and system fonts.
- **Multi-Platform Support**: PWA, Capacitor for iOS/Android mobile apps, and Tauri for desktop apps (macOS, Windows, Linux).

### Backend
- **Framework**: Express.js with TypeScript.
- **Database**: PostgreSQL with Drizzle ORM.
- **API**: RESTful endpoints with Zod validation.
- **Architecture**: Three-layer (Routes, Storage, Schema) with esbuild for bundling.
- **Multi-Tenancy**: Organization-based data isolation with automatic organization creation per user.
- **Authentication**: Replit OAuth (OpenID Connect) with PostgreSQL-backed session management.
- **Data Models**: Organizations, Team Members, Leads, Properties, Notes, Payments, Deals, Campaigns, Agent Tasks, Conversations/Messages.

### Key Features
- **Finance Module**: Note/loan management with amortization, payment recording, borrower portal.
- **Marketing Module**: Direct mail, email, SMS campaign management with metrics and budget tracking.
- **Deal Pipeline**: Kanban-style board for tracking acquisition and disposition deals.
- **Document Generation**: Promissory notes, warranty deeds, offer letters.
- **Usage Limits & Credits**: Tier-based feature usage limits, prepaid credit system for billable actions (email, SMS, AI, PDF, Comps, Direct Mail) with a usage dashboard and alerts.
- **Hybrid Per-Seat Pricing**: Base tier subscription + optional per-seat add-ons for team growth.
  - Free: 1 seat (no add-ons)
  - Starter: 2 included seats, +$20/mo per additional seat
  - Pro: 5 included seats, +$30/mo per additional seat
  - Scale: 10 included seats, +$40/mo per additional seat
  - Enterprise: 25+ seats, negotiable pricing
  - Team messaging unlocks at 2+ total seats (included + additional)
  - Seat management UI in Settings page for purchasing additional seats via Stripe checkout
- **Data Import/Export**: CSV import/export for core data types.
- **Custom Fields System**: User-defined custom fields (text, number, date, select, checkbox) for leads, properties, and deals with field definitions and values stored separately.
- **Saved Views**: Reusable filtered views with sorting, column visibility, and default view support per entity type.
- **AI Agents (Autonomous Operations)**:
    - **Lead Nurturing**: Scores leads, generates AI-powered follow-ups, segmentation.
    - **Campaign Optimizer**: Analyzes campaign performance, provides AI-driven optimization suggestions.
    - **Finance Agent**: 4-tier delinquency escalation and automated payment reminders.
    - **API Queue System**: Manages rate-limited API calls with exponential backoff and retries.
    - **Alerting Service**: Rule-based triggers for system issues and financial alerts.
    - **Digest Service**: Weekly performance summaries for founders.
    - **Sequence Processor**: Processes automation sequences and workflows (every 60 seconds).
    - **Communications Service**: Unified wrapper for email, SMS, and direct mail.
    - **Onboarding Wizard**: AI-guided setup with business type templates.
- **AI Section** (`/command-center` or `/ai`):
    - **Chat Tab**: Conversational AI interface with specialized agents (Research, Marketing, etc.)
    - **Team Tab**: AI team management for coordinating agent activities
    - **Tasks Tab**: Create and track agent tasks across 6 types: Research, Marketing, Lead Nurturing, Campaign, Finance, Support
    - **Agents Tab**: View background agent services with status, run frequency, and activity (uses static status, no real-time API yet)
    - **AI Settings**: Response style, default agent, auto-suggestions toggle, context memory preferences (accessible from AI section header or Settings)
- **Founder Dashboard**: Analytics for revenue, system health, agent status, and alert management.
- **Team Performance Dashboard**: SQL-based aggregation for scalability (handles 10k+ records), includes lead metrics, deal metrics, task metrics, activity trends (from leadActivities table), and response times with 5-minute caching.

### Navigation & UX Organization (January 2026)
- **Sidebar Navigation**: Consolidated from 24+ items to 17 items for reduced cognitive load
- **Hub Pages with Tabbed Interfaces**: 
  - **Marketing Hub** (`/campaigns`): Campaigns, A/B Tests, Sequences tabs
  - **Insights Hub** (`/analytics`): Analytics, Team, Activity tabs
  - **Settings** (`/settings`): General, Team, Communications, Notifications, Data, Developer tabs
  - **Help & Support** (`/help`): Help, Support tabs
- **URL Hash Navigation**: Deep linking to specific tabs via hash (e.g., `/settings#communications`, `/campaigns#ab-tests`)
- **Redirect Pages**: Legacy routes (ab-tests, sequences, team-dashboard, activity, support, email-settings, mail-settings) redirect to new tabbed locations
- **Reusable Content Components**: Extracted page content into components (EmailSettingsContent, MailSettingsContent, CampaignsContent, etc.) for use in both standalone pages and tabbed interfaces

## External Dependencies

- **Database**: PostgreSQL (main data store), Drizzle Kit (migrations).
- **Authentication**: Replit Auth (OAuth/OpenID Connect).
- **Payment Processing**: Stripe (subscription billing via Replit Stripe connector, one-time credit purchases).
- **AI Services**: OpenAI (via Replit AI Integrations for chat completions and image generation).
- **Mapping/Comps**: Regrid API (parcel lookup for comps analysis).
- **Direct Mail**: Lob API (for sending direct mail pieces).
- **Development Tools**: Vite, Replit Plugins.
- **Future Integrations (configured but not fully connected)**: SendGrid (Email), Twilio (SMS).
- **BYOK (Bring Your Own Key)**: Users can configure their own API keys for Lob (direct mail), Regrid (parcel data/comps), SendGrid, and Twilio. When using organization credentials, platform credit usage is automatically bypassed.

## Subscription Tiers & Feature Gating

| Tier | Leads | Properties | Notes | AI Requests/Day | Included Seats | Add-on Seats |
|------|-------|------------|-------|-----------------|----------------|--------------|
| Free | 50 | 10 | 5 | 100 | 1 | N/A |
| Starter | 500 | 100 | 50 | 1,000 | 2 | +$20/mo (max 5) |
| Pro | 5,000 | 1,000 | 500 | 10,000 | 5 | +$30/mo (max 20) |
| Scale | Unlimited | Unlimited | Unlimited | Unlimited | 10 | +$40/mo (max 100) |
| Enterprise | Unlimited | Unlimited | Unlimited | Unlimited | 25+ | Negotiable |

**Additional Feature Gating:**
- Team Messaging: Unlocks at 2+ total seats
- 7-Day Free Trial: Available for Starter/Pro/Scale tiers with trial eligibility tracking
- AI Agents run on all tiers but respect AI request limits

## Recent Updates (January 2026)

### Legal Compliance & Public Pages
- **Terms of Service** (`/terms`): Public route with standard SaaS terms, BYOK provisions, and land investment disclaimers
- **Privacy Policy** (`/privacy`): Public route covering data handling, GDPR, CCPA compliance, no data selling policy, and BYOK privacy practices
- Both pages are accessible without authentication

### Disclaimers
- **DisclaimerBanner Component**: Dismissible legal disclaimers on Finance, AI, and Deals pages
- Informs users platform is not a substitute for professional legal, tax, or financial advice
- Uses localStorage for per-page dismiss persistence (keys: `disclaimer-dismissed-finance`, `disclaimer-dismissed-ai`, `disclaimer-dismissed-deals`)

### Feature Requests
- Users can submit feature/enhancement requests via Help > Support tab
- Stored in `featureRequests` table with title, description, category, status, priority
- Founder can review requests in database (admin UI pending)

### AI Section Improvements
- Renamed from "AI Command Center" to "AI" in navigation
- Added AI Settings panel accessible from both AI section header and Settings page
- Settings stored in organization.settings JSON field:
  - `responseStyle`: professional, friendly, concise, detailed
  - `defaultAgent`: research, marketing, lead_nurturing, campaign, finance, support
  - `autoSuggestions`: boolean
  - `rememberContext`: boolean

### Data Export Enhancements
- Export functionality now supports both CSV and JSON formats
- Available for leads, properties, deals, and notes
- Format selection dropdown in Settings > Data > Export tab

### API Cost Tracking
- **apiUsageLogs** table tracks external API usage
- Logs Lob (direct mail: $0.80-$1.50), Regrid (parcel data: $0.02), OpenAI (tokens: ~$0.002/10 tokens)
- Founder Dashboard displays API Usage & Costs section with:
  - Monthly totals by service
  - 7-day usage chart
  - Call counts and estimated costs

## Known Technical Notes

### Pre-existing LSP Warnings
- `finance.tsx` lines 1013, 1135: Nullable field type mismatches with organizationId
- `deals.tsx` lines 858, 896: Nullable value props
- These are type strictness issues, not runtime blockers

### Database Schema Notes
- Custom fields stored in separate tables (fieldDefinitions, customFieldValues)
- API usage logs track estimated costs in cents
- Feature requests use text enum for status ('pending', 'under_review', 'planned', 'completed', 'declined')

## Roadmap & Future Enhancements

### Near-Term (Next Session)
- [ ] Admin UI for reviewing feature requests
- [ ] Real-time AI agent status API (currently static)
- [ ] SendGrid email integration (configured but not connected)
- [ ] Twilio SMS integration (configured but not connected)

### Medium-Term
- [ ] Borrower portal authentication (currently uses shared links)
- [ ] Advanced document template system
- [ ] Bulk operations on leads/properties
- [ ] Mobile app testing (Capacitor config exists)

### Long-Term
- [ ] White-label support for enterprise clients
- [ ] Advanced reporting with custom dashboards
- [ ] Integration marketplace for third-party services
- [ ] AI agent marketplace for custom agent creation

## Publishing Notes

The application is ready for publishing to **acreage.pro** domain. Key considerations:
- All legal pages (Terms, Privacy) are in place
- Disclaimers protect against liability for financial/legal advice
- BYOK system allows users to bring their own API keys
- Stripe subscription billing is configured
- Replit Auth handles user authentication
- PostgreSQL database for production data