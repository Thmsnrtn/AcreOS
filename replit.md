# AcreOS - Land Investment Management Platform

## Overview

AcreOS is a full-stack SaaS application designed for land investors to manage their operations. It provides CRM functionality for leads, property inventory tracking, financial note management, and AI-powered task automation. The platform is built as a multi-tenant system with organization-based data isolation and Stripe-powered subscription billing.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with shadcn/ui component library (New York style)
- **Charts**: Recharts for dashboard analytics
- **Animations**: Framer Motion for page transitions
- **Build Tool**: Vite with custom path aliases (@/, @shared/, @assets/)

The frontend follows a pages-based structure with protected routes requiring authentication. Components are organized into reusable UI primitives (shadcn/ui) and custom business components.

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database ORM**: Drizzle ORM with PostgreSQL
- **API Pattern**: RESTful endpoints with Zod validation
- **Session Management**: express-session with PostgreSQL-backed store (connect-pg-simple)
- **Build**: esbuild for production bundling with selective dependency bundling

The server implements a three-layer architecture:
1. Routes layer (server/routes.ts) - HTTP endpoint definitions
2. Storage layer (server/storage.ts) - Database operations abstraction
3. Schema layer (shared/schema.ts) - Drizzle table definitions and Zod validation schemas

### Multi-Tenancy Model
- Organizations serve as the primary tenant boundary
- Each authenticated user gets an organization created automatically
- Team members can be added to organizations with role-based permissions
- All data queries are scoped by organizationId

### Authentication System
- Replit OAuth integration via OpenID Connect
- Sessions stored in PostgreSQL with automatic expiration
- User data synced from Replit profile on each login
- Protected routes use isAuthenticated middleware

### Data Models
- **Organizations**: Tenant containers with subscription info
- **Team Members**: Users within organizations with roles
- **Leads**: CRM records for potential buyers/sellers
- **Properties**: Land inventory with status tracking
- **Notes**: Promissory notes with amortization schedules
- **Deals**: Transaction records linking leads and properties
- **Agent Tasks**: AI automation task queue
- **Conversations/Messages**: Chat history for AI interactions

## External Dependencies

### Database
- **PostgreSQL**: Primary data store (requires DATABASE_URL environment variable)
- **Drizzle Kit**: Database migrations via `db:push` command

### Authentication
- **Replit Auth**: OAuth provider using OpenID Connect
- Requires ISSUER_URL, REPL_ID, and SESSION_SECRET environment variables

### Payment Processing
- **Stripe**: Subscription billing via Replit Stripe connector
- Uses stripe-replit-sync for schema management
- Products seeded with three tiers: Starter ($49/mo), Professional ($149/mo), Enterprise ($499/mo)
- Webhook handling for subscription lifecycle events

### AI Services
- **OpenAI**: Via Replit AI Integrations (AI_INTEGRATIONS_OPENAI_API_KEY, AI_INTEGRATIONS_OPENAI_BASE_URL)
- Chat completions for AI command center
- Image generation using gpt-image-1 model
- Batch processing utilities with rate limiting and retries

### Development Tools
- **Vite**: Development server with HMR
- **Replit Plugins**: Runtime error overlay, cartographer, dev banner (dev only)