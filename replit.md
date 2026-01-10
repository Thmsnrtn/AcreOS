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
- **Usage Limits & Credits**: Tier-based feature usage limits and a prepaid credit system for billable actions.
- **Hybrid Per-Seat Pricing**: Subscription tiers with optional per-seat add-ons for team growth.
- **Custom Fields System**: User-defined custom fields for leads, properties, and deals.
- **Saved Views**: Reusable filtered views with sorting and column visibility.
- **AI Agents (Autonomous Operations)**: Consolidated into 4 core super-agents: Research & Intelligence, Deals & Acquisition, Communications, and Operations. All agents use DataSourceBroker for data lookups and OpenAI (gpt-4o).
- **AI Section**: Conversational AI interface (`/command-center` or `/ai`) with specialized agents, task management, and real-time agent status monitoring.
- **Founder Dashboard**: Analytics for revenue, system health, agent status, and user analytics. Includes bulk alert operations and data endpoint health checks.
- **Team Performance Dashboard**: Aggregated metrics for leads, deals, tasks, and activity trends.
- **Navigation & UX Organization**: Consolidated sidebar navigation and tabbed hub pages with URL hash navigation.
- **Legal Compliance**: Public Terms of Service and Privacy Policy pages, and dismissible disclaimer banners.
- **Bulk Operations**: Multi-select and bulk actions for Leads and Properties.
- **API Cost Tracking**: Logging and display of estimated costs for external API usage on the Founder Dashboard.
- **VA Replacement Engine (Dirt Rich 2 Methodology)**: Marketing lists, batch offer generation, seller communications, ad posting management, buyer prequalification, collection sequences, county research cache.
- **Advanced GIS/Mapping**: Map layer toggles, measurement tools, map export, nearby parcels discovery, comparables visualization.
- **Enhanced AI Agents**: Agent memory system, feedback loop, skill registry, property analysis chat.
- **Advanced Automation**: Workflow triggers (event-driven), visual workflow builder, scheduled task runner.
- **Document Management**: Template management, version history, document packages.

## External Dependencies

- **Database**: PostgreSQL (primary data store), Drizzle Kit (migrations).
- **Authentication**: Replit Auth (OAuth/OpenID Connect).
- **Payment Processing**: Stripe (subscription billing, one-time credit purchases via Replit Stripe connector).
- **AI Services**: OpenAI (via Replit AI Integrations for chat completions and image generation).
- **Mapping/Comps**: Tiered parcel lookup system using County GIS Endpoints (free) and Regrid API (paid fallback).
- **Data Source Broker**: Intelligent tiered data lookup system with **6,797+ sources** across 48 categories:
  - **Regional GIS (2,616)**: Multi-county, water district, utility, and regional organization endpoints
  - **County GIS Portals (2,104)**: Parcel data for land investing across all 50 states + 40 major metro counties
  - **State GIS (1,227)**: State-level GIS endpoints for all 50 states
  - **City GIS (432)**: Municipal GIS servers for major cities
  - **Real Estate Market (61)**: Comparative market analysis endpoints
  - **Real Estate (61)**: Property data and ownership information
  - **Infrastructure (34)**: HIFLD hospitals, fire stations, utilities, communications
  - **Environmental (33)**: EPA Superfund, brownfields, air quality, toxics, EJScreen
  - **Natural Hazards (32)**: FEMA flood zones, earthquakes, wildfires, weather alerts
  - **Public Lands (27)**: BLM, USFS, NPS protected areas, wilderness, minerals
  - **Advanced Analytics (20)**: AI-powered property analysis
  - **Census/Demographics (22)**: ACS, Decennial, TIGERweb boundaries, tracts, blocks
  - **Transportation (17)**: DOT highways, FAA aviation, rail networks
  - **Water Resources (9)**: USGS streamflow, groundwater, NOAA tides
  - **Basemaps/Topographic (8)**: USGS National Map services
  - Federal agencies: USDA, USGS, NOAA, HUD, DOT, NPS, USFWS, EPA, FAA, FCC, CDC
  - Address Validation, Zoning, Utilities, Agricultural, Mineral/Subsurface data
  - **Import Scripts**: 5 reusable TypeScript scripts with MD5 deduplication for database updates
- **Direct Mail**: Lob API (for sending physical mail).
- **Development Tools**: Vite, Replit Plugins.
- **SMS/Communications**: Twilio SMS integration (BYOK via organizationIntegrations) with unified multi-channel inbox.
- **Browser Automation**: Puppeteer-core with Chromium for backend web automation (county research, document download, property listing screenshots).
- **Future Integrations (configured but not fully connected)**: SendGrid (Email).
- **BYOK (Bring Your Own Key)**: Support for users to configure their own API keys for Lob, Regrid, SendGrid, and Twilio.

## Recent Updates (January 2026)

### Writing Style & AI Communication
- **Writing Style Profiles**: User-specific tone analysis, phrase patterns, and sample message collection for AI to communicate in user's voice
- **Style-Aware Response Generator**: Generates messages matching user's communication style with confidence scoring and alternatives

### Unified Communications
- **Twilio SMS Integration**: BYOK approach via organizationIntegrations table, supports outbound/inbound SMS
- **Unified Inbox UI**: Multi-channel inbox at `/inbox` showing emails and SMS with channel filter tabs (All/Email/SMS), conversation threads, and send capability

### Lead Intelligence
- **Lead Qualification Scoring**: Analyzes conversations for buyer readiness signals (urgency, budget mentions, timeline, decision authority)
- **Escalation Alerts**: Automatic notifications when leads show hot signals (high buyer intent score)

### Browser Automation Engine
- **Puppeteer Foundation**: Headless browser automation with comprehensive step execution (navigate, click, type, extract, screenshot, scroll, wait)
- **Job Queue System**: browserAutomationJobs table with status tracking, createJob/executeJob/processJobQueue functions
- **System Templates**: County Assessor Lookup, Document Download, Property Listing Screenshot templates
- **AI Integration**: browserResearchSkill added to SkillRegistry enabling Research agent to execute ad-hoc automation or use templates, returns full screenshot data URLs and extracted data

### Autonomous AI Operations (19 Capabilities - 6 Phases)

**Phase 1: Agent Foundation** (Complete)
- **Multi-Agent Orchestration Bus**: Shared context/state for agent collaboration with approval gates and event triggers
- **Event Subscription Framework**: Agents subscribe to GIS updates, market feeds, deadlines with condition matching
- **Outcome Telemetry System**: recordOutcome/analyzeOutcomes for AI feedback loops and learning

**Phase 2: Acquisition Research** (Complete)
- **Acquisition Radar** (`server/services/acquisitionRadar.ts`): Auto-surface undervalued parcels with 7-factor opportunity scoring
- **Market Intelligence Engine** (`server/services/marketIntelligence.ts`): Predict value trends from permits, population, infrastructure
- **Tax Lien/Deed Researcher** (`server/services/taxResearcher.ts`): Scan auction calendars, assess redemption risk, calculate ROI

**Phase 3: Due Diligence & Pricing** (Complete)
- **Due Diligence Pods** (`server/services/dueDiligencePods.ts`): Multi-agent teams generating investor-ready dossiers with 7 research dimensions
- **Seller Intent Predictor** (`server/services/sellerIntentPredictor.ts`): 6-signal scoring for offer acceptance likelihood
- **Price Optimizer** (`server/services/priceOptimizer.ts`): Comps-based pricing with market/motivation adjustments
- **Deal Pattern Cloning** (`server/services/dealPatternCloning.ts`): Similarity matching with embeddings for deal replication

**Phase 4: Negotiation & Communication** (Complete)
- **Negotiation Copilot** (`server/services/negotiationCopilot.ts`): Objection handling with AI response generation, counter-offers
- **Smart Sequence Optimizer** (`server/services/sequenceOptimizer.ts`): Message performance tracking with A/B testing variants
- **Voice/Call AI** (`server/services/voiceCallAI.ts`): Whisper transcription with action item extraction and coaching insights

**Phase 5: Portfolio & Compliance** (Complete)
- **Portfolio Sentinel** (`server/services/portfolioSentinel.ts`): Proactive monitoring with 5 alert types (tax, market, competitor, document, compliance)
- **Document Intelligence** (`server/services/documentIntelligence.ts`): AI parsing of deeds/contracts/notes with key term extraction
- **Cash Flow Forecaster** (`server/services/cashFlowForecaster.ts`): 12-month projections with payment risk scoring and pattern analysis
- **Compliance Guardian** (`server/services/complianceGuardian.ts`): County-specific rules engine with automated checks

**Phase 6: Disposition** (Complete)
- **Buyer Matching AI** (`server/services/buyerMatchingAI.ts`): Match inventory to ideal buyer profiles with 6-factor scoring
- **Buyer Qualification Bot** (`server/services/buyerQualificationBot.ts`): Pre-screen leads, assess financing readiness, risk levels
- **Disposition Optimizer** (`server/services/dispositionOptimizer.ts`): Best channel/price/timing recommendations with ROI analysis

### AI Services Schema (Phase 3-6)
- **Phase 5 Tables**: portfolioAlerts, documentAnalysis, cashFlowForecasts, complianceRules, complianceChecks
- **Phase 6 Tables**: buyerProfiles, buyerPropertyMatches, buyerQualifications, dispositionRecommendations
- All services follow singleton pattern with lazy OpenAI initialization (Replit AI Integrations)
- Event telemetry via agentEvents table for orchestration bus visibility