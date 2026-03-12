# AcreOS Developer Guide

## Local Setup

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- npm 9+

### Installation
```bash
git clone https://github.com/Thmsnrtn/AcreOS.git
cd AcreOS
npm install
cp .env.example .env
# Edit .env with your local credentials
```

### Database Setup
```bash
# Start local PostgreSQL
createdb acreos_dev
DATABASE_URL=postgresql://localhost/acreos_dev npm run db:push
```

### Start Development Server
```bash
npm run dev
# App runs at http://localhost:5000
```

### Run Tests
```bash
npm test              # All tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

## Architecture Overview

### Tech Stack
- **Backend**: Node.js + Express + TypeScript
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **Database**: PostgreSQL with Drizzle ORM
- **Cache/Queue**: Redis + BullMQ
- **Auth**: Express sessions (postgres-backed)
- **AI**: OpenAI/Anthropic via LiteLLM-compatible routing
- **Payments**: Stripe
- **Voice**: Twilio
- **Deployment**: Fly.io

### Key Service Map

| Service | File | Purpose |
|---|---|---|
| Market Prediction | `server/services/marketPrediction.ts` | 30/90/365-day price forecasting |
| Deal Hunter | `server/services/dealHunter.ts` | Auto-scraping distressed deal sources |
| Negotiation | `server/services/negotiationOrchestrator.ts` | AI negotiation strategy engine |
| AVM | `server/services/acreOSValuation.ts` | Automated property valuation |
| Portfolio Optimizer | `server/services/portfolioOptimizer.ts` | Monte Carlo portfolio analysis |
| Voice AI | `server/services/voiceAI.ts` | Call transcription and sentiment |
| Land Credit | `server/services/landCredit.ts` | Property credit scoring |
| Marketplace | `server/services/marketplace.ts` | Listing/bidding/transaction engine |
| Capital Markets | `server/services/capitalMarkets.ts` | Note securitization and lender matching |

### Database Schema
Schema is in `shared/schema.ts` (~220 tables). Key table groups:
- **Org/Users**: `organizations`, `teamMembers`, `userProfiles`
- **CRM**: `leads`, `properties`, `deals`, `offers`
- **Marketplace**: `marketplaceListings`, `marketplaceBids`, `marketplaceTransactions`
- **AI**: `voiceCalls`, `callTranscripts`, `negotiationThreads`
- **Academy**: `courses`, `courseModules`, `courseEnrollments`, `certifications`
- **Finance**: `capitalMarkets`, `noteSecurities`, `landCreditScores`

## API Patterns

### Authentication
All API routes require session cookie. Auth routes are in `server/routes.ts`.

```typescript
// Middleware pattern
router.get('/resource', requireAuth, requireOrg, async (req, res) => {
  const org = (req as any).organization;
  // ... handler
});
```

### Route File Pattern
```typescript
// server/routes-example.ts
import { Router } from 'express';
const router = Router();

router.get('/items', async (req, res) => {
  try {
    const items = await myService.getItems();
    res.json({ items });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

### Service Pattern
```typescript
// server/services/example.ts
// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from "../db";
import { myTable } from "@shared/schema";

export class ExampleService {
  async doThing(orgId: number) {
    return db.select().from(myTable).where(eq(myTable.orgId, orgId));
  }
}

export const exampleService = new ExampleService();
```

## Frontend Patterns

### Page Template
```tsx
// client/src/pages/my-page.tsx
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MyPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/my-endpoint"],
  });

  if (isLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Page Title</h1>
      <Card>
        <CardHeader><CardTitle>Section</CardTitle></CardHeader>
        <CardContent>{/* Content */}</CardContent>
      </Card>
    </div>
  );
}
```

### Data Fetching
- `useQuery` for GET requests (auto-caches, refetches)
- `useMutation` for POST/PUT/DELETE
- API base path: `/api/...`
- Auth cookies sent automatically

## Testing Guide

### Unit Tests
Located in `tests/unit/`. Use Vitest with `describe/it/expect`.
- Mock DB: `vi.mock("../../server/db", () => ({ db: mockDbObject }))`
- Mock services: `vi.mock("../../server/services/email")`

### Integration Tests
Located in `tests/integration/`. Test multi-step business flows using pure logic helpers (no DB required).

### Load Tests
Located in `tests/load/`. Use k6: `k6 run tests/load/k6-baseline.js`

## PR Workflow
1. Create feature branch from `main`
2. Write code + tests
3. Ensure `npm test` and `npm run check` pass
4. Open PR → CI runs automatically
5. Code review required (1 approver minimum)
6. Merge to `main` → auto-deploys to staging
7. Manual promote to production via `flyctl deploy`

## Common Issues

### "Cannot find module @shared/schema"
Path alias configured in `tsconfig.json`. Ensure imports use `@shared/schema` not relative paths.

### "Organization not found" error
Middleware adds org to `req.organization`. Ensure routes are registered after auth middleware in `server/index.ts`.

### DB connection errors locally
Check `DATABASE_URL` in `.env`. Format: `postgresql://user:pass@localhost/dbname`

### Redis connection errors
Check `REDIS_URL` in `.env`. Format: `redis://localhost:6379`
