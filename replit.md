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
- **Data Source Broker**: Intelligent tiered data lookup system with 563+ sources across various categories (Environmental, Natural Resources, Government Housing, Real Estate Market, County GIS Portals, Advanced Analytics, Address Validation, Natural Hazards).
- **Direct Mail**: Lob API (for sending physical mail).
- **Development Tools**: Vite, Replit Plugins.
- **Future Integrations (configured but not fully connected)**: SendGrid (Email), Twilio (SMS).
- **BYOK (Bring Your Own Key)**: Support for users to configure their own API keys for Lob, Regrid, SendGrid, and Twilio.