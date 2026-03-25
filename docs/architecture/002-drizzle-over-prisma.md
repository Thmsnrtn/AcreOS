# ADR-002: Drizzle ORM Over Prisma

## Context

The database layer needed an ORM that provides type safety, supports complex queries (joins, subqueries, aggregations), and allows incremental schema migration without downtime. Prisma and Drizzle were the two TypeScript-first candidates.

## Decision

Drizzle ORM with PostgreSQL. Schema defined in TypeScript (`shared/schema.ts`), migrations generated via `drizzle-kit`, queries built with the Drizzle query builder.

Drizzle was chosen because: (1) the query builder produces SQL you can read and predict — no hidden N+1 queries or query planning surprises; (2) schema-as-code in the same TypeScript file used by the application means types are always in sync; (3) migration control is explicit — `drizzle-kit generate` shows you the exact SQL before it runs; (4) no binary engine (Prisma requires a Rust binary that adds deployment complexity and cold start latency).

## Consequences

**Positive:** Type-safe queries that map directly to SQL. Zero runtime binary dependencies. Full control over migration timing and content. Schema file serves as both ORM definition and documentation. Insert/select schemas derived automatically via `createInsertSchema`.

**Negative:** Less automatic relation handling than Prisma (must write explicit joins). Smaller ecosystem and fewer community plugins. Documentation is improving but less mature than Prisma's.
