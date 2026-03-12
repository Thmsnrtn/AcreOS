# ADR 003: BullMQ for Background Job Processing

**Status**: Accepted
**Date**: 2025-01-06
**Deciders**: Engineering team

## Context

AcreOS runs numerous background jobs: AI enrichment, campaign scheduling, lead nurturing, deal machine, market intelligence syncs, digest emails. These require:
- Reliable execution (no dropped jobs on crash)
- Distributed locking (no duplicate execution on multi-instance Fly.io)
- Visibility into job status and failures
- Dead-letter queue for failed jobs

## Decision

We use **BullMQ** backed by Redis for job queue management, supplemented with in-process distributed locks stored in PostgreSQL.

## Rationale

| Concern | Cron (in-process) | BullMQ + Redis |
|---|---|---|
| **Durability** | Jobs lost on crash | Jobs survive restarts |
| **Multi-instance** | Race conditions | Redis-backed atomic ops |
| **Visibility** | None | Bull Board UI available |
| **Retry / DLQ** | Manual | Built-in with backoff |
| **Scheduling** | setInterval | Cron-style or delayed |

For jobs that cannot use Redis (startup), we use `withJobLock()` — a PostgreSQL advisory lock pattern ensuring exactly-one-execution across Fly.io instances.

## Consequences

- `REDIS_URL` is a required environment variable
- Job health logged to `job_health_logs` table for observability
- Dead-letter jobs visible in `job_health_logs` with `status: 'failed'`
- Redis must be provisioned as a Fly.io Redis instance or external Redis Cloud
