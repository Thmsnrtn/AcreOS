# npm Vulnerability Watch — Discipline

**Owner**: Iris (CTO)
**Activated**: 2026-06-02
**Cadence**: Daily `npm audit --json --audit-level=high` (04:00 UTC); tiered ack SLAs

## Purpose

The `external_watch_events` table (rows where `source = 'npm_vuln'`) is
the AcreOS wire for npm dependency vulnerabilities. Every advisory at
or above the configured severity floor (default `high`) lands there
daily.

The wire is detection-only — turning an advisory into an upgrade, a
patch, or an accepted-risk note is Iris's job. *This document is the
operating discipline for that conversion.*

## Severity floor

The ingest filter defaults to `NPM_WATCH_MIN_SEVERITY=high`, which
drops `low` + `moderate` at parse time. The discipline floor is *high
+ critical only* because:

- `low` and `moderate` advisories are typically dev-dep noise that
  doesn't reach the runtime. Iris can opt-in for a one-off scan via
  `npm audit` directly without polluting the wire.
- `high` and `critical` advisories *can* reach production runtime
  through transitive deps. The signal/cost ratio justifies daily review.

To temporarily lower the floor (e.g., quarterly dep audit):
```sh
NPM_WATCH_MIN_SEVERITY=moderate \
  npx tsx -e "import('./server/services/external-watch/npmWatch').then(m => m.fetchNpmVulnerabilities())"
```
Reset the env when the audit pass is done — leaving it lowered
permanently floods the wire.

## Tiered acknowledgement SLAs

- **`critical` advisories**: 24-hour ack window. Beyond 24h with
  `ack_status = 'pending'` is an SLA breach. Critical advisories
  automatically fire to Solene's page channel as `severity='urgent'`
  at the next morning brief if still pending.
- **`high` advisories**: 7-day ack window. Beyond 7d is an SLA breach.
  Iris's weekly retro reports the count.

For each pending advisory, Iris:

1. **Reads the upstream advisory.** Open `source_url` (the GitHub
   advisory link, or `npm:` synthesised URL for indirect deps) and
   read the CVE detail.
2. **Decides one of three outcomes**, recorded by transitioning
   `ack_status` and writing `action_taken`:
   - **Upgraded** (`ack_status='actioned'`) — bumped the affected
     package (direct: `npm install pkg@^x.y.z`; indirect: bumped the
     direct parent that owns the dep). `action_taken` cites the commit
     SHA.
   - **Patched** (`ack_status='actioned'`) — applied a `npm overrides`
     entry in `package.json` to force a non-vulnerable version below
     the natural resolver result. `action_taken` cites the overrides
     entry + reasoning.
   - **Accepted-risk** (`ack_status='dismissed'`) — the advisory
     doesn't reach the AcreOS runtime (dev-only dep, test-only code
     path, exploit requires attacker control of a surface AcreOS
     doesn't expose). `action_taken` documents *why* the risk is
     accepted + the reassessment date (typically next quarter).

## The "accepted-risk" discipline floor

Accepted-risk dismissals require:
1. A one-paragraph justification in `action_taken` explaining why the
   advisory doesn't reach AcreOS's threat model.
2. A reassessment date — accepted-risk is **not** permanent. If the
   dep is still present at the reassessment date, re-evaluate.
3. Beatrice (CRO) sign-off when the dep touches any regulated surface
   (notes/payments/customer PII). The sign-off ID goes into
   `action_taken`.

The dismissal-without-justification pattern (just acking to clear the
queue) is the single failure mode this discipline exists to prevent.
Iris's weekly retro samples three dismissals and verifies the
justification holds.

## Critical-vuln paging

A `critical` advisory persisted to `external_watch_events` with
`source='npm_vuln'` triggers Solene's page channel at the next
morning-brief tick (or immediately, if the cron fires outside the
morning-brief window). The page payload:

```
External-watch: CRITICAL npm vulnerability
  Package: <pkg>
  Advisory: <title>
  Fix available: <yes|no|upgrade x@y>
  See: <source_url>
  Ack endpoint: POST /api/founder/external-watch/<id>/ack
```

Tom can ack the page (which updates `ack_status='acknowledged'` +
`ack_by='tom'`) and Iris handles the actual upgrade in the next
session.

## Out-of-scope (today)

- **npm registry tamper detection** (provenance, signing). Deferred —
  npm provenance is still rolling out; partial coverage isn't worth
  the implementation cost yet.
- **Lockfile drift detection** (advisories that appear because a
  `package-lock.json` was rebuilt). Phase-2 follow-on.
- **Non-npm ecosystems** (Python deps in /scripts, system packages on
  Fly). Deferred — current AcreOS surface is npm-monoculture.

## Changelog

| Date | Change | Trigger |
|------|--------|---------|
| 2026-06-02 | Initial `npm audit --json --audit-level=high` ingest | Layer 1 cap #4 dispatch |
