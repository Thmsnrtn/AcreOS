# AcreOS

Land investment management platform — CRM, deal pipeline, seller-financed notes, AI assistants, marketing automation, and portfolio analytics in one app.

## Quick Start (Development)

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in your values
cp .env.example .env

# 3. Push database schema
npm run db:push

# 4. Start dev server (Vite HMR + Express)
npm run dev
```

The app runs at `http://localhost:5000` by default.

## Quick Start (Docker)

```bash
# 1. Copy env template
cp .env.example .env
# Edit .env with your API keys

# 2. Start everything (Postgres + app)
docker compose up -d

# 3. Push schema into the Dockerized DB
DATABASE_URL=postgresql://acreos:acreos@localhost:5432/acreos npm run db:push
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with Vite HMR |
| `npm run build` | Build client (Vite) + server (esbuild) into `dist/` |
| `npm start` | Run production build |
| `npm test` | Run unit tests (vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run check` | TypeScript type-check |
| `npm run db:push` | Push Drizzle schema to database |

## Environment Variables

See [`.env.example`](.env.example) for the full list. Required variables:

- `DATABASE_URL` — PostgreSQL connection string
- `SESSION_SECRET` — Random string for session encryption
- `FOUNDER_EMAILS` — Comma-separated list of founder email addresses

Optional (features degrade gracefully without these):
- `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET`
- `OPENAI_API_KEY`
- `SENDGRID_API_KEY`

## Architecture

```
client/src/          React SPA (Vite, TailwindCSS, shadcn/ui)
  pages/             Route-level page components
  components/        Shared UI components
  hooks/             React Query hooks, auth, utilities
  lib/               Query client, utilities, animations

server/              Express API server
  auth/              Passport-local auth (bcrypt + sessions)
  middleware/        Rate limiting, CSRF, org resolution, security
  services/          Business logic (AI agents, campaigns, finance, etc.)
  routes.ts          Main route registrations (~20K lines)
  storage.ts         Drizzle ORM data access layer

shared/
  schema.ts          Drizzle table definitions + Zod schemas
  models/            Auth & chat table models

tests/               Vitest test suites
```

### Key Patterns

- **Auth**: Passport-local with bcrypt password hashing and `express-session` (PostgreSQL-backed via `connect-pg-simple`).
- **Multi-tenancy**: Every API route resolves the user's organization via `getOrCreateOrg` middleware. All data is scoped to `organizationId`.
- **Rate limiting**: Sliding-window in-memory rate limiter (`server/middleware/rateLimit.ts`). IP-based for public endpoints, user-ID-based for authenticated.
- **CSRF**: Double-submit cookie pattern (`server/middleware/csrf.ts`).
- **Subscriptions**: Stripe integration with tiered plans (free → starter → pro → scale → enterprise). Founders bypass all limits.
- **AI**: OpenAI-powered agents for lead scoring, deal analysis, campaign optimization, and a conversational assistant (Sophie).

## Health Check

```
GET /api/health          — Full health check (DB, Stripe, OpenAI, SendGrid, etc.)
GET /api/health/cached   — Last cached result (fast, no external calls)
GET /api/health/:service — Check a specific service
```

## Deployment

### Docker (recommended)

```bash
docker compose up -d --build
```

The Dockerfile uses a multi-stage build:
1. **Builder stage**: installs all deps, runs `npm run build`
2. **Runner stage**: installs only production deps, copies `dist/`

The container includes a `HEALTHCHECK` that polls `/api/health/cached`.

### Manual

```bash
npm ci
npm run build
npm run db:push
NODE_ENV=production node dist/index.cjs
```

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set a strong, random `SESSION_SECRET`
- [ ] Configure `APP_URL` to your public domain (used for CORS and Stripe webhooks)
- [ ] Set up Stripe webhook pointing to `{APP_URL}/api/stripe/webhook`
- [ ] Enable HTTPS via a reverse proxy (nginx, Caddy, or cloud LB)
- [ ] Run `npm run db:push` against your production database

## License

MIT
