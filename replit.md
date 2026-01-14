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
- **AI Tools (Atlas)**: 
  - **Offer Generation**: `generate_offer` (AI-powered suggestions with market analysis), `generate_offer_letter` (professional, friendly, or urgent tone letters)
  - **Communications**: `send_email` (TCPA-compliant with AWS SES), `send_sms` (TCPA-compliant via Twilio/Telnyx)
  - **Financial Analysis**: `run_comps_analysis` (comparable sales lookup), `calculate_roi` (investment metrics), `calculate_payment_schedule` (amortization)
  - **Research**: `research_property` (DataSourceBroker integration for tax, environmental, zoning data)
  - **Task Management**: `schedule_followup` (create linked reminder tasks)
- **Founder Dashboard**: Analytics for revenue, system health, agent status, user analytics, bulk alerts, and data endpoint health.
- **Team Performance Dashboard**: Aggregated metrics for leads, deals, tasks, and activity.
- **Navigation**: Consolidated sidebar and tabbed hub pages with URL hash.
- **Legal Compliance**: Public Terms of Service and Privacy Policy pages.
- **Bulk Operations**: Multi-select and bulk actions for Leads and Properties.
- **API Cost Tracking**: Logging and display of estimated external API costs.
- **VA Replacement Engine**: Marketing lists, batch offer generation, seller communications, ad posting, buyer prequalification, collection sequences, county research.
- **Advanced GIS/Mapping**: Map layer toggles, measurement tools, map export, nearby parcel discovery, comparables, **auto-parcel boundary enrichment** on property creation.
- **Parcel Boundary Auto-Fetch**: Properties created via AI tools or manually get parcel boundaries automatically fetched using tiered lookup (Cache → County GIS free → Regrid API paid fallback). Bulk fetch available via "Fetch Boundaries" button on Properties page.
- **Enhanced AI Agents**: Agent memory, feedback loop, skill registry, property analysis chat.
- **Advanced Automation**: Workflow triggers, visual workflow builder, scheduled tasks.
- **Document Management**: Template management, version history, document packages.
- **Unified Communications**: Twilio SMS integration (BYOK) with a multi-channel inbox UI.
- **Browser Automation Engine**: Puppeteer-core for backend web automation (county research, document download, property listing screenshots) with job queue and AI integration.
- **Autonomous AI Operations**: Capabilities across acquisition research, due diligence, negotiation, portfolio management, compliance, and disposition, leveraging multi-agent orchestration and event subscription.
- **Sophie Support Agent (95-99% Autonomous Resolution Target)**: AI-powered customer support with advanced investigation, self-learning, and self-healing capabilities:
  - **Investigation Tools**: `query_user_data` (database inspection), `search_logs` (error/event search), `get_user_activity` (action history), `estimate_resolution_confidence` (confidence scoring)
  - **Decision Trees**: Structured troubleshooting paths for 10 common issue types (login, sync, billing, data, AI, map, performance, export, notifications, permissions)
  - **Browser Context Capture**: Auto-captures console errors, failed network requests, user actions when help panel opens
  - **Proactive Anomaly Detection**: Activity drop detection (70%+ baseline deviation), error pattern detection, usage spike detection
  - **Automated Fix Actions**: `clear_user_cache`, `reset_user_session`, `retry_failed_jobs`, `refresh_auth_tokens`, `resync_user_data`
  - **Multi-Session Memory**: sophieMemory table with memory types (issue_history, preference, solution_tried, escalation, context), importance scoring (1-10), expiry support, `recall_user_memory` and `save_user_memory` tools for personalized support
  - **Resolution Tracking**: supportResolutionHistory with variantName, customerEffortScore (1-5), success/failure tracking for continuous improvement
  - **Knowledge Base Search**: `search_past_resolutions` to find matching solutions from previously resolved tickets
  - **A/B Testing for Resolutions**: `get_resolution_ab_recommendations` tracks resolution variants, success rates, customer effort scores, and recommends winning approaches
  - **Predictive Prevention**: `check_predictive_issues` analyzes activity drops, error patterns, quota usage, data integrity to warn users before issues escalate
  - **Stripe Integration**: `get_customer_billing_status`, `get_payment_history`, `fix_billing_issue` for subscription and payment management
  - **Smart Escalation**: `escalate_to_human` auto-generates diagnostic bundle (org data, counts, limits, alerts, health, activity, API errors, memory)
  - **Proactive Health Checks**: healthCheck service with periodic checks (60s), health scoring (0-100, A-F grades), proactive outreach scheduling
  - **Auto-Generated Tutorials**: `generate_tutorial` for 10 common workflows (add_lead, create_property, manage_deals, send_campaign, track_payments, use_ai_agents, import_data, export_reports, configure_settings, manage_team) with skill-level customization
  - **Feature Walkthroughs**: `get_feature_walkthrough` for interactive guidance on map, ai_chat, deal_pipeline, bulk_actions, saved_views
  - **Contextual Next Steps**: `suggest_next_steps` based on user's current progress and goals
  - **Self-Learning from Escalations**: `learn_from_human_resolution` uses GPT-4o to extract patterns, approaches, and lessons from human-resolved tickets, auto-updates knowledge base
  - **Automated Root Cause Analysis**: `trace_root_cause` traces issues through frontend → API → database → external services with confidence scoring per layer
  - **Bulk Issue Resolution**: `detect_bulk_issue` identifies systemic issues affecting multiple orgs, `apply_bulk_fix` applies fixes once for all affected
  - **External Service Status Monitoring**: Real-time health checks (Stripe, Twilio, Lob, Regrid, OpenAI) every 5 minutes with automatic outage notifications via externalStatusMonitor service
  - **Screenshot Analysis**: `analyze_screenshot` uses GPT-4o vision to identify UI issues from user-submitted screenshots
  - **Sentiment Detection**: `analyze_user_sentiment` detects frustration levels (low/medium/high/critical) from message patterns
  - **Contextual Auto-Suggestions**: `get_contextual_suggestions` provides relevant help based on recent user activity
  - **User Behavior Prediction**: `predict_user_issues` anticipates issues based on past patterns and current activity
  - **Self-Healing Data Integrity**: `detect_data_integrity_issues` finds orphaned deals, duplicate leads, broken references; `fix_data_integrity_issue` auto-repairs
  - **Integration Health Monitoring**: `check_integration_health` verifies Stripe, Twilio, Lob, OpenAI connections
  - **Proactive Onboarding Nudges**: `detect_onboarding_stuck` identifies stalled users and suggests next steps
  - **Proactive Self-Healing**: `apply_self_healing_fix` applies known fixes (cache clear, job retry, data resync) based on learned patterns with 70%+ success rate
- **Interactive Self-Help Wizards**: Guided step-by-step troubleshooting flows with 8 categories, self-check questions, and Sophie escalation path
- **Sophie Learning Service**: sophieLearning.ts with 9 methods for autonomous learning and healing:
  - `learnFromHumanResolution(ticketId)` - Extract patterns from human resolutions
  - `traceRootCause(orgId, issueDescription)` - Multi-layer root cause analysis
  - `detectBulkIssue(issuePattern)` - Detect systemic issues across orgs
  - `applyBulkFix(issueType, fixAction, affectedOrgIds)` - Apply fixes to multiple orgs
  - `getKnownFixPatterns()` - Retrieve successful fix patterns
  - `applySelfHealingFix(orgId, issuePattern)` - Auto-apply known fixes
  - `detectDataIntegrityIssues(orgId)` - Find data integrity problems
  - `fixDataIntegrityIssue(orgId, issueType)` - Auto-repair data issues
  - `predictUserIssues(orgId, userId)` - Predict upcoming issues

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