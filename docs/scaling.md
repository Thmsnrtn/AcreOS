# AcreOS Scaling Strategy

## Architecture Overview
AcreOS is deployed as a stateless Node.js application on Fly.io, with PostgreSQL (via Fly Postgres) and Redis for caching/queues.

## Horizontal Scaling (App Servers)

### Current Setup
```bash
flyctl scale count 2 --app acreos  # 2 instances
flyctl scale vm shared-cpu-2x      # 2 shared vCPUs, 512MB RAM
```

### Scale Up Procedure
```bash
# Add more instances (zero-downtime)
flyctl scale count 4 --app acreos

# Upgrade VM size for heavier workloads
flyctl scale vm performance-2x  # 2 dedicated vCPUs, 4GB RAM
```

### Auto-Scaling Triggers
Configure in `fly.toml`:
- Scale up: CPU > 70% for 3 minutes
- Scale down: CPU < 20% for 10 minutes
- Minimum 2 instances (for HA)
- Maximum 8 instances

## Database Read Replicas

### When to Add Replicas
- Read traffic > 80% of total queries
- P95 query latency > 100ms
- Analytics queries impacting write performance

### Setup Fly.io Postgres Replica
```bash
flyctl postgres create --name acreos-db-replica --region dfw
flyctl postgres attach --app acreos acreos-db-replica
```

### Route Reads to Replica
In Drizzle config, use read/write splitting:
```typescript
// db.ts
const writeDb = drizzle(writePool, { schema });
const readDb = drizzle(readPool, { schema });
```

## Redis Cluster Setup

### Current: Single Redis Instance
```bash
flyctl redis create --name acreos-redis
```

### Scale to Redis Cluster (when needed)
- Enable when: >10,000 ops/second or >80% memory utilization
- Use Upstash Redis for serverless-compatible cluster
- Partition by key prefix (cache:, session:, queue:)

### Cache Tuning
```bash
# Monitor Redis memory
redis-cli INFO memory
# Current cache hit rate
redis-cli INFO stats | grep keyspace_hits
```

## CDN Configuration

### Cloudflare / CloudFront Setup
- Static assets (JS, CSS, images): Cache for 1 year
- API responses: No cache by default
- Property photos: Cache 30 days with Cache-Control headers
- AVM responses: Cache 1 hour (cost-saving for identical requests)

### Image Optimization Pipeline
- On upload: Convert to WebP, generate 3 thumbnails (200px, 400px, 800px)
- Serve from CDN with responsive image srcset
- Property satellite images: CDN edge cache with 7-day TTL

## Connection Pooling

### PgBouncer / Drizzle Pool
```typescript
// drizzle.config.ts
export default {
  pool: {
    min: 2,
    max: 20,         // Max 20 concurrent DB connections per instance
    idleTimeoutMs: 30000,
    connectionTimeoutMs: 5000,
  }
};
```

### Why This Matters
- Fly.io Postgres allows max 100 connections
- With 4 app instances × 20 pool max = 80 connections (safe)
- PgBouncer can multiplex 1000s of connections → 100 DB connections

## Background Job Queue Tuning

### BullMQ Priority Configuration
```
Priority 1 (Highest): Voice transcription, payment processing
Priority 2: Marketplace notifications, bid alerts
Priority 3: Deal hunter scraping, valuation requests
Priority 4: Analytics computation, report generation
Priority 5 (Lowest): Email digests, data export
```

### Queue Workers Scaling
```bash
# Scale workers independently from web servers
flyctl scale count 2 --app acreos-workers
```

## Load Testing Benchmarks

### Baseline Performance (2 instances, performance-2x)
- API requests: 500 req/sec sustained
- AVM valuations: 50 req/sec
- Concurrent users: 200

### Target Performance (4 instances, performance-4x)
- API requests: 2,000 req/sec sustained
- AVM valuations: 200 req/sec
- Concurrent users: 1,000

### Run Load Tests
```bash
# Install k6
brew install k6

# Run baseline test
k6 run tests/load/k6-baseline.js

# Run valuation load test
k6 run tests/load/k6-valuation.js
```

## Pagination (Cursor-Based)
All list endpoints use cursor-based pagination to handle large datasets:
```typescript
// Instead of OFFSET/LIMIT (slow on large tables):
where(gt(leads.id, cursor)).limit(50)

// Provides consistent performance even at record 1,000,000
```
