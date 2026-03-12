# ADR 002: Drizzle ORM over Prisma

**Status**: Accepted
**Date**: 2025-01-06
**Deciders**: Engineering team

## Context

AcreOS requires a database ORM for PostgreSQL. The primary candidates were Prisma and Drizzle ORM.

## Decision

We chose **Drizzle ORM**.

## Rationale

| Concern | Prisma | Drizzle |
|---|---|---|
| **Type safety** | Schema-first, generates types | Schema-first, fully TypeScript |
| **Query control** | Good, but abstracts SQL | Excellent — SQL-like syntax |
| **Bundle size** | Large (Prisma client) | Small (~7kb) |
| **Migration system** | Prisma Migrate | drizzle-kit (push/generate/migrate) |
| **Connection pooling** | Prisma Data Proxy or PgBouncer | Native `pg` or PgBouncer |
| **Edge / serverless** | Requires Prisma Accelerate | Works with `pg` directly |

Drizzle's SQL-like query builder makes complex land-data queries (parcel spatial joins, cross-tenant analytics) more transparent and optimizable. Its small bundle size benefits the monorepo build and cold-start times on Fly.io.

## Consequences

- Schema defined in `shared/schema.ts` — single source of truth for client and server types
- Migrations managed via `drizzle-kit generate` + `drizzle-kit migrate`
- All queries must include `where organizationId = $orgId` clauses — enforced by code review and IDOR tests
- Raw SQL available via `db.execute(sql\`...\`)` for complex aggregations
