# AcreOS - Land Investment Management Platform

## Overview

AcreOS is a full-stack SaaS platform for land investors, offering tools for managing leads, properties, deals, and finances. It includes CRM, property tracking, financial management, and AI-powered automation. The platform supports multi-tenancy, integrates Stripe for billing, and aims to be the leading solution for land investment professionals by enhancing efficiency and decision-making through advanced technology.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Frameworks**: React 18 with TypeScript, Wouter, TanStack React Query.
- **Styling**: Tailwind CSS with shadcn/ui (New York style), Recharts, Framer Motion.
- **Build**: Vite.
- **UI/UX**: macOS Tahoe-inspired design with glassmorphism, rounded corners, and Sedona Desert color schemes (light/dark modes).
- **Multi-Platform**: Progressive Web App (PWA), Capacitor for iOS/Android, Tauri for desktop (macOS, Windows, Linux).

### Backend
- **Framework**: Express.js with TypeScript.
- **Database**: PostgreSQL with Drizzle ORM.
- **API**: RESTful endpoints with Zod validation.
- **Architecture**: Three-layer (Routes, Storage, Schema) with esbuild.
- **Multi-Tenancy**: Organization-based data isolation.
- **Authentication**: Replit OAuth (OpenID Connect) with PostgreSQL-backed sessions.
- **Data Models**: Comprehensive models for Organizations, Team Members, Leads, Properties, Notes, Payments, Deals, Campaigns, Agent Tasks, and Conversations.

### Key Features
- **Finance Module**: Amortization, payment recording, borrower portal.
- **Marketing Module**: Campaign management (direct mail, email, SMS) with metrics.
- **Deal Pipeline**: Kanban-style board for acquisition and disposition.
- **Document Generation**: Automated promissory notes, warranty deeds, offer letters.
- **Usage Limits & Credits**: Tier-based feature limits and prepaid credit system.
- **Hybrid Per-Seat Pricing**: Subscription tiers with optional per-seat add-ons.
- **Custom Fields**: User-defined fields for leads, properties, deals.
- **Saved Views**: Reusable filtered views with sorting and column visibility.
- **AI Agents**: Four core agents (Research & Intelligence, Deals & Acquisition, Communications, Operations) using DataSourceBroker and OpenAI (gpt-4o).
- **AI Section**: Conversational AI interface (`/command-center` or `/ai`) with task management and real-time status.
- **AI Context Aggregator**: Real-time system snapshot service providing full awareness across all modules (leads, properties, deals, tasks, campaigns) with 60-second caching and automatic invalidation on writes.
- **Cross-Module AI Operations**: Executive assistant (Atlas) can create/update properties, deals, and tasks from any page, with background job execution support.
- **Founder Dashboard**: Analytics for revenue, system health, agent status, user analytics, bulk alerts, and data endpoint health.
- **Team Performance Dashboard**: Aggregated metrics for leads, deals, tasks, and activity.
- **Navigation**: Consolidated sidebar and tabbed hub pages with URL hash.
- **Legal Compliance**: Public Terms of Service and Privacy Policy pages.
- **Bulk Operations**: Multi-select and bulk actions for Leads and Properties.
- **API Cost Tracking**: Logging and display of estimated external API costs.
- **VA Replacement Engine**: Marketing lists, batch offer generation, seller communications, ad posting, buyer prequalification, collection sequences, county research.
- **Advanced GIS/Mapping**: Map layer toggles, measurement tools, map export, nearby parcel discovery, comparables.
- **Enhanced AI Agents**: Agent memory, feedback loop, skill registry, property analysis chat.
- **Advanced Automation**: Workflow triggers, visual workflow builder, scheduled tasks.
- **Document Management**: Template management, version history, document packages.
- **Unified Communications**: Twilio SMS integration (BYOK) with a multi-channel inbox UI.
- **Browser Automation Engine**: Puppeteer-core for backend web automation (county research, document download, property listing screenshots) with job queue and AI integration.
- **Autonomous AI Operations**: Capabilities across acquisition research, due diligence, negotiation, portfolio management, compliance, and disposition, leveraging multi-agent orchestration and event subscription.

## External Dependencies

- **Database**: PostgreSQL, Drizzle Kit.
- **Authentication**: Replit Auth (OAuth/OpenID Connect).
- **Payment Processing**: Stripe (subscription billing, credit purchases), Stripe Connect.
- **AI Services**: OpenAI (via Replit AI Integrations).
- **Mapping/Comps**: County GIS Endpoints, Regrid API.
- **Data Source Broker**: Tiered data lookup system with 6,797+ sources across 48 categories (Regional GIS, County GIS Portals, State GIS, City GIS, Real Estate Market, Infrastructure, Environmental, Natural Hazards, Public Lands, Advanced Analytics, Census/Demographics, Transportation, Water Resources, Basemaps/Topographic, Federal agencies, Address Validation, Zoning, Utilities, Agricultural, Mineral/Subsurface data).
- **Direct Mail**: Lob API.
- **Development Tools**: Vite, Replit Plugins.
- **SMS/Communications**: Twilio SMS.
- **Browser Automation**: Puppeteer-core.
- **Future Integrations**: SendGrid (Email).
- **BYOK (Bring Your Own Key)**: Support for Lob, Regrid, SendGrid, Twilio API keys.