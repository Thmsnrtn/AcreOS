# ADR 010: Single PostgreSQL Schema with Row-Level Organization Isolation

**Status**: Accepted
**Date**: 2025-01-10
**Deciders**: Engineering team

## Context

AcreOS is a multi-tenant SaaS where each organization (customer) must be fully isolated from other organizations' data. We evaluated three multi-tenancy strategies: separate databases per tenant, separate schemas per tenant, and single schema with organization_id columns.

## Decision

We use a **single PostgreSQL database with `organization_id` foreign key on every tenant-scoped table**.

**Enforcement layers:**
1. **Schema layer**: Every tenant table has `organization_id NOT NULL` with a FK to `organizations`
2. **Storage layer**: All queries in `server/storage.ts` filter by `organizationId` parameter
3. **Middleware layer**: `getOrCreateOrg` middleware resolves the org from the authenticated user and attaches it to `req.organization` before any route handler runs
4. **Rate limiting layer**: Redis rate limiter is org-scoped in addition to IP-scoped
5. **Audit layer**: All mutations log `organizationId` in audit trail

**Cascade rules:**
- `ON DELETE CASCADE` from organizations to all child tables
- GDPR deletion implemented in `gdprService.ts` for user-level deletion

## Rationale

| Concern | Separate DBs | Separate Schemas | Single Schema + org_id |
|---|---|---|---|
| **Isolation** | Perfect | Strong | Strong (with discipline) |
| **Query complexity** | Simple | Moderate | Requires WHERE clause |
| **Operational overhead** | Very high | High | Low |
| **Migrations** | Per-tenant complexity | Per-tenant complexity | Single migration |
| **Cross-org analytics** | Impossible | Complex | Possible (for founders) |
| **Cost** | Very high | Moderate | Efficient |

At 100s-1000s of customers, per-database tenancy is operationally prohibitive. The row-isolation pattern is proven at scale (used by Heroku, Basecamp, Intercom).

## Consequences

- **Every query must include `WHERE organization_id = $1`** — enforced by convention and code review
- Composite indexes on `(organization_id, status)` and `(organization_id, created_at)` are essential for performance (migration `0007_composite_indexes.sql`)
- SQL injection risk: Drizzle ORM is used exclusively (no raw SQL) to prevent organization_id bypass
- Founder/admin queries that span all orgs require explicit `isFounderAdmin` guard
- GDPR deletion tested to cover all 515+ tables
