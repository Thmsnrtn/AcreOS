# ADR 004: Multi-Tenancy via Row-Level organizationId Isolation

**Status**: Accepted
**Date**: 2025-01-06
**Deciders**: Engineering team

## Context

AcreOS serves multiple independent land investing organizations on a shared database. We evaluated three multi-tenancy models:
1. **Database-per-tenant** — separate database for each org
2. **Schema-per-tenant** — separate PostgreSQL schema per org
3. **Row-level isolation** — all tenants in shared tables, filtered by `organizationId`

## Decision

We use **row-level isolation** with `organizationId` on every table.

## Rationale

| Concern | DB-per-tenant | Schema-per-tenant | Row isolation |
|---|---|---|---|
| **Operational complexity** | High (thousands of DBs) | Medium | Low |
| **Migration complexity** | Run migrations on each DB | Run on each schema | Run once |
| **Cost** | High | Medium | Low |
| **IDOR risk** | None | None | Must be enforced in code |
| **Query performance** | Excellent | Good | Good (with composite indexes) |
| **Regulatory isolation** | Strong | Good | Sufficient for SaaS |

At our current scale (hundreds of orgs), row isolation with composite indexes `(organizationId, status)` and `(organizationId, createdAt)` provides acceptable performance and minimal operational burden.

## Consequences

- **Every** DB query MUST include `where(eq(table.organizationId, org.id))`
- `getOrCreateOrg` middleware attaches `req.organization` — used by all protected routes
- IDOR tests in `tests/unit/securityTests.test.ts` validate cross-tenant isolation
- Composite indexes on all tenant-scoped tables required (see `migrations/0007_composite_indexes.sql`)
- Queries without `organizationId` filter must be explicitly reviewed and documented
