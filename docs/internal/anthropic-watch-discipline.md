# Anthropic API Changelog Watch — Discipline

**Owner**: Iris (CTO)
**Activated**: 2026-06-02
**Cadence**: Daily ingest cron (03:00 UTC); 48h manual acknowledgement SLA

## Purpose

The `external_watch_events` table (rows where `source = 'anthropic_api'`)
is the AcreOS wire for Anthropic model + API news. Every matched item
from the public release-notes feed at
`https://docs.anthropic.com/en/release-notes/api.xml` that touches one
of our active surfaces (any model AcreOS uses, pricing changes, rate
limits, tool-use semantics, context-window changes, vision, extended
thinking) lands there.

The wire is detection-only — turning a matched event into a model
migration, a router change, a cost-model update, or a code-level change
is Iris's job. *This document is the operating discipline for that
conversion.*

## The 48-hour acknowledgement SLA

Every event with `ack_status = 'pending'` and `published_at` older than
48 hours is an SLA breach. Iris's weekly retro reports the count;
breaches > 0 trigger a discipline retro the following session.

For each pending event, Iris:

1. **Reads the underlying source.** RSS summary is not enough — open
   `source_url` and read the full release note.
2. **Decides one of four outcomes**, recorded by transitioning
   `ack_status` and writing `action_taken`:
   - **Dismiss** (`ack_status='dismissed'`) — matched keyword but does
     not touch any AcreOS surface (e.g., a Claude-Code-only feature when
     AcreOS doesn't use Claude Code; a model AcreOS doesn't route to).
   - **Acknowledge** (`ack_status='acknowledged'`) — applicable but
     informational; no AcreOS code change required. Note rationale in
     `action_taken`.
   - **Actioned** (`ack_status='actioned'`) — Iris has shipped (or
     queued) the corresponding AcreOS change. `action_taken` cites the
     commit SHA or queue ID.
   - **Urgent — escalate via Solene's page channel.** Reserved for:
     deprecation of any model AcreOS actively routes to, breaking
     pricing changes inside a 30-day window, breaking tool-use schema
     changes affecting Atlas tool registry. Trigger
     `POST /api/internal/solene/page` with `severity = 'urgent'`. Then
     ack with `ack_status='actioned'` and `action_taken` describing the
     mitigation path.

## Deprecation events — special handling

A deprecation event for any model AcreOS uses **always** fires to
Solene's page channel as `severity='urgent'`, even before Iris's
48h ack window. The rationale: model EOL deadlines are
non-negotiable — if Anthropic deprecates a model AcreOS routes to with
a 60-day window, AcreOS must migrate before EOL or break.

Iris's mitigation playbook:
1. Identify every code path routing to the deprecated model
   (`model-selector.ts`, `aiRouter.ts`, hard-coded model IDs in
   service files).
2. Identify the replacement model from the release note. Update the
   default selector and add a `claude-api` skill migration entry.
3. Run the full test suite + a representative sample of dispatches
   against the replacement.
4. Ship the migration commit referencing the `external_watch_events.id`
   in the commit message.

## New-model events — special handling

A new-model event (e.g., "Claude 4.8 released") queues an evaluation
task for the next session's planning, not an immediate migration. Iris
acks with `ack_status='acknowledged'` and `action_taken='evaluation
queued — see ai-evals-queue'`. The evaluation harness in
`server/services/aiEvalHarness.ts` is the entrypoint for the
adopt/don't-adopt decision (Layer 4 capability #18 in the 32-cap map —
"Model upgrade path").

## Keyword filter governance

`ANTHROPIC_RELEVANCE_KEYWORDS` in `shared/schema/external-watch.ts` is
the ingest filter. Adding a keyword requires:

1. A surfaced false negative — Iris found a relevant Anthropic change
   by other means (announcement email, dashboard banner) that the
   filter missed.
2. A test fixture added to
   `server/services/external-watch/anthropicWatch.test.ts`
   demonstrating the new keyword catches the false-negative item.
3. A note in this document's changelog naming the keyword and trigger.

**Removing** a keyword is harder than adding one — the discipline floor
is *false negatives cost more than false positives*. A noisy keyword is
rewritten to be more specific, not removed.

## Founder visibility

The endpoint `GET /api/founder/external-watch/recent?source=anthropic_api`
returns the rolling 30-day window grouped by ack_status. Solene reads
this on each session-start; pending-count > 5 warrants a mention in the
morning brief (`server/jobs/morningBrief.ts`).

The morning brief one-line already surfaces a single segment
`external-watch pending: N` that aggregates across all sources.

## Out-of-scope (today)

- **Anthropic dashboard banners** — only available via authenticated
  pull; deferred until OAuth token plumbing is in place.
- **Console-only feature flags** — no public feed; relies on Iris's
  weekly Anthropic-console review (separate from this discipline).
- **Pricing-API-only changes** — caught indirectly via the "pricing"
  keyword on release notes, but a dedicated pricing-API watcher is a
  later-dispatch follow-on.

## Changelog

| Date | Change | Trigger |
|------|--------|---------|
| 2026-06-02 | Initial 11-keyword filter + release-notes-feed ingest | Layer 1 cap #4 dispatch |
