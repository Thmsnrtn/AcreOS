# ADR 005: Fly.io for Production Deployment

**Status**: Accepted
**Date**: 2025-01-06
**Deciders**: Engineering team

## Context

AcreOS needs a production deployment platform. Candidates evaluated:
1. **AWS ECS / Fargate** — managed container hosting
2. **Heroku** — PaaS, simple deployment
3. **Fly.io** — edge-native container platform
4. **Render** — PaaS with PostgreSQL

## Decision

We deploy on **Fly.io** using Docker containers.

## Rationale

| Concern | AWS | Heroku | Fly.io | Render |
|---|---|---|---|---|
| **Setup complexity** | High (IAM, VPCs, ALB) | Low | Low | Low |
| **Cost at startup** | High | High | Low-medium | Medium |
| **Global edge** | Requires CloudFront | No | Yes (anycast) | Limited |
| **Postgres integration** | RDS (separate) | Heroku Postgres | Fly Postgres (co-located) | Render Postgres |
| **WebSockets** | Requires ALB config | No | Yes (native) | Yes |
| **Docker native** | Yes | No (buildpacks) | Yes | Yes |

Fly.io's co-location of Node and Postgres in the same region (ewr — Newark) minimizes DB latency. Anycast routing reduces P95 response times for US land investors. Native WebSocket support enables real-time deal alerts.

## Consequences

- Configuration in `fly.toml` — `min_machines_running = 2` for HA
- `auto_stop_machines = 'off'` keeps processes warm (no cold starts)
- `USER node` in Dockerfile for non-root container security
- Health checks at `/api/health` used by Fly.io for machine readiness
- Secrets stored in Fly.io vault — never in environment config files
- Scale via `fly scale count 3` or autoscale based on concurrency
