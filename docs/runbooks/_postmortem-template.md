# Postmortem Template (Blameless)

> **Use:** copy this file to `docs/incidents/YYYY-MM-DD-slug.md` and fill it
> in within 72h of resolving any Sev-0 / Sev-1 incident. Panel-300 G5
> requirement: every incident gets a written postmortem. No exceptions.

## Incident summary

- **Date:** YYYY-MM-DD
- **Severity:** Sev-0 / Sev-1 / Sev-2
- **Duration:** start UTC → end UTC (X minutes / hours)
- **MTTR:** detect → mitigate (target: ≤ 15 min for Sev-1)
- **Customers affected:** N (or "all" / "subset: <criteria>")
- **Data loss:** none / partial / total — describe scope

## TL;DR (3 sentences max)

What broke. Who noticed. How we fixed it.

## Timeline (UTC)

| Time | Event | Source |
|---|---|---|
| HH:MM | Incident started (root cause occurred) | (often retroactive) |
| HH:MM | First symptom visible | Sentry / customer report / synthetic-check fail |
| HH:MM | First responder paged | PagerDuty / Slack / email |
| HH:MM | Mitigation deployed | git SHA / runbook step |
| HH:MM | Incident resolved | smoke-test green |

## Root cause

Five-whys, in narrative form. Be specific. "The webhook handler did X
because Y assumed Z, which became false when …"

## What went well

- …
- …

## What went poorly

- …
- …

## Action items

| # | Item | Owner | Due | Severity |
|---|---|---|---|---|
| 1 | … | @founder | YYYY-MM-DD | P0 / P1 / P2 |
| 2 | … | … | … | … |

Each action item should fit one of: prevent recurrence, detect faster,
mitigate faster, reduce blast radius. Anything else is a "nice to have" —
file it as a regular ticket, not as a postmortem action item.

## Customer-facing message (if any)

If we sent a status-page update or customer email, paste it here verbatim.
If we *didn't* send one, explicitly note "no customer comms — incident
contained internally."

## Blameless reminder

This postmortem is blameless. The system failed; the people did their
best with the information they had. The action items above are about
making the next person's job easier, not about assigning fault.

---

*Template version 2026-05-08 (panel-300 G5). Iterate on this template
itself if a real incident reveals it's missing fields.*
