# ARCHIVED — SCP agent stubs (kernel restructure step 4, 2026-07-14)

These 12 codename directories are Day-1 scaffolding from the SCP era:
persona.md files, zeroed evolution logs, empty golden suites. Nothing in
any loop or cron reads them; the only consumer is the on-demand
`/api/scp/v2/*` read-facade (`server/routes-scp-v2.ts` via
`scpEvolutionEngine.ts`), which itself bridges back into the legacy
`companyAgents` roster.

Status: **archived in place**. The directories stay where they are (the
SCP API still resolves paths here) but are frozen — no new personas, no
evolution writes, no new consumers. The canonical persona source is the
13-member roster in `shared/schema/agent-codenames.ts` +
`docs/internal/team-roster-overview.md`, dispatched via
`DISPATCH_AGENT_ROLES`.

Removal happens when `/api/scp/v2` is retired (tracked with the
companyAgents fork retirement — the staged data-and-UI migration in the
step-4 audit).
