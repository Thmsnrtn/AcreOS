# ARCHIVED — Oz external agent config (kernel restructure step 4, 2026-07-14)

`agent.acreos.yaml` configures one external cloud agent for the Oz
platform CLI. Zero application consumers — nothing in server/ or
client/ imports or reads it. It shares no codenames with either the
legacy companyAgents roster or the canonical 13-member roster.

Status: **archived in place, subordinated**. The file stays for anyone
still using the Oz CLI externally, but it is not part of the Solene
kernel, is not consulted by any persona system, and receives no updates
as the roster evolves. The canonical persona source is
`shared/schema/agent-codenames.ts` + `docs/internal/team-roster-overview.md`.
