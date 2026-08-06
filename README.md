# AcreOS

The AI-powered platform for land investors. Find motivated sellers, analyze parcels, send direct mail, and close deals — all in one platform.

## What It Does

- **CRM** — Leads, properties, deal pipeline, and seller-financed note management
- **AI Analysis** — Parcel evaluation, comps, and investment scoring via Atlas (powered by OpenRouter)
- **Direct Mail** — Campaign creation and sending via Lob
- **Skip Tracing** — Owner contact lookup via BatchData
- **Data Enrichment** — Property data from ATTOM, Regrid, and 6 free government sources (FEMA, Census, USGS, USDA, EPA, BLM)
- **AI Assistants** — Pax (operations copilot), Sophie (support), Atlas (analysis)
- **Autonomous Executor** — 30-minute decision cycle for routine operations with founder override
- **Seller Finance** — Note tracking, amortization, borrower portal
- **Billing** — Stripe-powered tiers: Free, Starter ($20/mo), Pro ($49/mo), Scale ($79/mo)

## What It Does NOT Yet Do

- Broader REI verticals (wholesaling, fix & flip, etc.) — waitlisted on landing page
- Mobile app (responsive web only)
- Public API (internal REST API exists but is undocumented)
- List building / external property database search

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy env template
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL and CLERK keys

# 3. Push database schema
npm run db:push

# 4. Start dev server
npm run dev
```

Runs at `http://localhost:5000`.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Vite, TailwindCSS, shadcn/ui |
| Backend | Express, TypeScript, esbuild |
| Database | PostgreSQL via Drizzle ORM |
| Auth | Clerk (SSO, OAuth, session management) |
| Email | AWS SES |
| AI | OpenRouter (primary), OpenAI (optional fallback) |
| Direct Mail | Lob |
| SMS | Twilio (optional) |
| Payments | Stripe |
| Hosting | Fly.io (2 machines, IAD region) |

## Required Environment Variables

See `.env.example` for the full list. Critical variables:

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection |
| `CLERK_SECRET_KEY` | Yes | Authentication |
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Frontend auth |
| `AI_INTEGRATIONS_OPENROUTER_API_KEY` | Yes* | AI features |
| `STRIPE_SECRET_KEY` | Yes* | Billing |
| `STRIPE_WEBHOOK_SECRET` | Yes* | Subscription lifecycle |

*Features degrade gracefully without these but core functionality requires them.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server with HMR |
| `npm run build` | Production build (Vite + esbuild) |
| `npm start` | Run production build |
| `npm test` | Unit tests (vitest) |
| `npm run check` | TypeScript type-check |
| `npm run db:push` | Push Drizzle schema to database |

## Deployment (Fly.io)

```bash
# Deploy
fly deploy

# Set secrets
fly secrets set AI_INTEGRATIONS_OPENROUTER_API_KEY=sk-or-...
fly secrets set STRIPE_SECRET_KEY=sk_live_...

# Check status
fly status
fly logs
```

The app runs 2 machines in IAD with auto-restart, health checks on `/api/health`, and rolling deploys.

## Health Check

```
GET /api/health        — Full check (DB, Redis, Stripe, AI, Email, Twilio, Lob)
GET /api/health/cached — Last cached result (fast, no external calls)
```

## Architecture

```
client/src/          React SPA
  pages/             ~258 page components
  components/        Shared UI (shadcn/ui based)

server/              Express API
  auth/              Clerk authentication
  ai/                AI agents (Atlas, Pax, Sophie)
  services/          ~991 service files
  middleware/        Rate limiting, CSRF, org resolution, security
  routes.ts          Route registrations

shared/
  schema.ts          Drizzle tables + Zod schemas (500 tables)
  schema/            Domain schema modules (248 more tables; 748 total —
                     source of truth: scripts/ratchets/table-count.json)

tests/               Vitest + Playwright test suites
```

## License

MIT
