# ADR-003: Data Provider Registry Pattern

## Context

AcreOS integrates 18 free government data sources and 3 premium data providers. Each source has different APIs, rate limits, reliability characteristics, and cost structures. The platform needs to: gate access by subscription tier, handle provider outages gracefully, cache responses, and support BYOK (bring your own key) for premium providers.

## Decision

A provider registry pattern where each data source is registered by category (flood, soil, elevation, environmental, etc.) and priority. The registry handles: tier-based filtering (free sources available to all tiers, premium requires credits or BYOK), credit deduction on paid lookups, circuit breaking (3 failures in 5 minutes = skip provider), and response caching via the `provider_cache` table with configurable TTL.

## Consequences

**Positive:** Adding a new data source requires only implementing the provider interface and registering it — no changes to consuming code. Circuit breaking prevents cascading failures when a government API goes down (which happens frequently). BYOK support at the Pro tier means users can bring their own Regrid/ATTOM keys and bypass per-lookup credit charges. Caching reduces API calls by ~60% and makes the DD report feel instant for previously-queried parcels.

**Negative:** The abstraction adds indirection — debugging a specific provider query requires tracing through the registry. Cache invalidation for sources that update infrequently (FEMA updates flood maps annually) is set conservatively, meaning some stale data is served. Circuit breaker state is in-memory, so it resets on server restart.
