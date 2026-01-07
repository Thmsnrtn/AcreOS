# AcreOS - Land Investment Management Platform

## Overview

AcreOS is a full-stack SaaS platform designed for land investors, providing a comprehensive solution for managing leads, properties, deals, and finances. It includes CRM functionalities, property tracking, financial note management, and AI-powered automation to streamline operations. The platform supports multi-tenancy with organization-based data isolation and integrates Stripe for subscription billing. Its core ambition is to be the go-to platform for land investment professionals, enhancing efficiency and decision-making through advanced technology.

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
- **Theme System**: Full light/dark mode support
  - ThemeProvider context with localStorage persistence
  - Respects system preference as default
  - Toggle available in sidebar footer and auth page
- **Ambient Sound**: Video backgrounds with sound
  - SoundProvider context with localStorage persistence
  - Toggle available in sidebar footer and auth page
  - Auth page features Sora.ai generated video backgrounds (different for light/dark modes)

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript, Wouter for routing, TanStack React Query for state management.
- **Styling**: Tailwind CSS with shadcn/ui (New York style), Recharts for data visualization, Framer Motion for animations.
- **Build**: Vite.
- **UI/UX**: macOS Tahoe-inspired design featuring glassmorphism, rounded corners, and specific Sedona Desert color schemes for light/dark modes.
- **Multi-Platform Support**: Progressive Web App (PWA), Capacitor for iOS/Android, and Tauri for desktop applications (macOS, Windows, Linux).

### Backend
- **Framework**: Express.js with TypeScript.
- **Database**: PostgreSQL with Drizzle ORM.
- **API**: RESTful endpoints with Zod validation.
- **Architecture**: Three-layer (Routes, Storage, Schema) with esbuild for bundling.
- **Multi-Tenancy**: Organization-based data isolation with automatic organization creation per user.
- **Authentication**: Replit OAuth (OpenID Connect) with PostgreSQL-backed session management.
- **Data Models**: Comprehensive models for Organizations, Team Members, Leads, Properties, Notes, Payments, Deals, Campaigns, Agent Tasks, and Conversations.

### Key Features
- **Finance Module**: Amortization, payment recording, borrower portal for note/loan management.
- **Marketing Module**: Campaign management for direct mail, email, and SMS with metrics and budget tracking.
- **Deal Pipeline**: Kanban-style board for managing acquisition and disposition deals.
- **Document Generation**: Automated creation of promissory notes, warranty deeds, and offer letters.
- **Usage Limits & Credits**: Tier-based feature usage limits and a prepaid credit system for billable actions (email, SMS, AI, PDF, Comps, Direct Mail).
- **Hybrid Per-Seat Pricing**: Subscription tiers with optional per-seat add-ons for team growth.
- **Custom Fields System**: User-defined custom fields for leads, properties, and deals.
- **Saved Views**: Reusable filtered views with sorting and column visibility.
- **AI Agents (Autonomous Operations)**: Consolidated into 4 core super-agents:
  - **Research & Intelligence Agent**: Due diligence, environmental lookups, investment analysis, property enrichment
  - **Deals & Acquisition Agent**: Offer generation, deal analysis, comp research, financing calculations
  - **Communications Agent**: Email/SMS composition, lead nurturing, campaign content generation
  - **Operations Agent**: Delinquency checking, campaign optimization, alerts, digests, performance analysis
  - All agents use DataSourceBroker for data lookups and OpenAI (gpt-4o) for intelligent analysis
  - Unified execution endpoint: `/api/agents/execute`
- **AI Section**: Conversational AI interface (`/command-center` or `/ai`) with specialized agents, task management, and real-time agent status monitoring.
- **Founder Dashboard**: Analytics for revenue, system health, and agent status. Now includes:
  - Bulk alert operations (Acknowledge All, Resolve All)
  - Expandable metric tiles with detailed breakdowns
  - User analytics with All Users table and subscription lifecycle tracking (upgrades/downgrades/cancels)
  - Data endpoint health checks with Test, Test All, and Diagnose capabilities
- **Team Performance Dashboard**: Aggregated metrics for leads, deals, tasks, and activity trends.
- **Navigation & UX Organization**: Consolidated sidebar navigation and tabbed hub pages (Marketing, Insights, Settings, Help & Support) with URL hash navigation for deep linking.
- **Legal Compliance**: Public Terms of Service and Privacy Policy pages, and dismissible disclaimer banners for Finance, AI, and Deals sections.
- **Bulk Operations**: Multi-select and bulk actions (delete, status change, export) for Leads and Properties.
- **API Cost Tracking**: Logging and display of estimated costs for external API usage on the Founder Dashboard.

## External Dependencies

- **Database**: PostgreSQL (primary data store), Drizzle Kit (migrations).
- **Authentication**: Replit Auth (OAuth/OpenID Connect).
- **Payment Processing**: Stripe (subscription billing, one-time credit purchases via Replit Stripe connector).
- **AI Services**: OpenAI (via Replit AI Integrations for chat completions and image generation).
- **Mapping/Comps**: Tiered parcel lookup system:
  - **County GIS Endpoints** (FREE): Direct queries to county ArcGIS REST services for parcel data (296 counties across all 50 states)
  - **Regrid API** (paid fallback): Used only when county GIS endpoints aren't available
  - **Parcel Snapshots Cache**: Centralized parcel_snapshots table with 30-day freshness tracking
  - Admin interface in Founder Dashboard to manage county GIS endpoints
- **Data Source Broker**: Intelligent tiered data lookup system with 563+ sources:
  - **Tiered Routing**: Free sources > Cached (30-day) > BYOK (user keys) > Paid APIs
  - **Health Scoring**: Success rate, latency, consecutive failure tracking per source
  - **Cost Optimization**: Usage metrics, cache hit rates, and cost summaries
  - **Source Categories**:
    - Environmental: FEMA flood zones, National Wetlands Inventory, EPA Superfund
    - Natural Resources: USDA soil survey, forest data, conservation easements
    - Government Housing: HUD, Census, FHFA housing data
    - Real Estate Market: 61+ MLS systems, national portals, county assessors
    - County GIS Portals: 358+ state/county level endpoints across 48 states
    - Advanced Analytics: 20+ AI/ML predictions, satellite imagery, sentiment analysis
    - Address Validation: USPS, Census Geocoder, OpenAddresses
    - Natural Hazards: Earthquake, wildfire, hurricane risk data
  - Managed via `data_sources` table with category, access level, and verification tracking
  - Admin interface in Founder Dashboard to manage sources and view broker metrics
- **Due Diligence Reports**: Comprehensive property analysis with parcel data, ownership info, tax history, market analysis, risk assessment, and AI-powered summaries. Supports PDF export.
- **Direct Mail**: Lob API (for sending physical mail).
- **Development Tools**: Vite, Replit Plugins.
- **Future Integrations (configured but not fully connected)**: SendGrid (Email), Twilio (SMS).
- **BYOK (Bring Your Own Key)**: Support for users to configure their own API keys for Lob, Regrid, SendGrid, and Twilio, bypassing platform credit usage.