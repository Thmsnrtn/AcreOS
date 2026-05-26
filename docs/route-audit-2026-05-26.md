# Customer Route Audit — 2026-05-26

Snapshot of every customer-facing route in `client/src/App.tsx`,
classified for ongoing IA hygiene. Founder/admin routes are excluded
(they live under `/founder/*` and `/admin/*`).

## Counts at a glance

| Class | Count | Meaning |
|---|---|---|
| **DAY-1** | 9 | Reachable from sidebar / mobile nav / onboarding by a brand-new user |
| **LATER** | 155 | Reachable via deep links, secondary CTAs, feature flags, or vertical-specific surfaces |
| **DEPRECATE** | 40 | Legacy aliases, redirects, or orphaned duplicates flagged for removal |

## DAY-1 routes

These are the surfaces a new user encounters in their first session.

| Path | Component | Why DAY-1 |
|---|---|---|
| `/` | HomeRoute | Landing or auth redirect |
| `/today` | TodayPage | Canonical primary surface; sidebar item #1 |
| `/leads` | LeadsPage | Sidebar nav |
| `/properties` | PropertiesPage | Sidebar nav |
| `/deals` | DealsPage | Sidebar nav |
| `/campaigns` | CampaignsPage | Sidebar nav (label: Outreach) |
| `/money` | MoneyPage | Sidebar nav |
| `/settings` | SettingsPage | Sidebar nav |
| `/ai` | PaxPage | Mobile bottom nav |
| `/help` | HelpPage | Reachable from nav |

## DEPRECATE — the high-confidence cuts

**Already redirected, files can be deleted:**

| Path | Redirect target | Why |
|---|---|---|
| `/dashboard` | `/today` | Sunset 2026-07-02 |
| `/pax` | `/ai` | Legacy naming |
| `/team-inbox` | `/team` | Legacy naming |
| `/pipeline` | `/deals` | Legacy IA |
| `/radar` | `/deals/discover` | Marked DEPRECATED in file comments |
| `/acquisition-radar` | `/deals/discover` | Marked DEPRECATED |
| `/deal-hunter` | `/deals/discover` | Marked DEPRECATED |
| `/deal-feed` | `/deals/discover` | Marked DEPRECATED |
| `/deal-patterns` | `/deals/discover` | Marked DEPRECATED |
| `/deal-underwriting` | `/deals/discover` | Marked DEPRECATED |
| `/sequences` | `/campaigns?channel=sequences` | Consolidated |
| `/direct-mail` | `/campaigns?channel=direct-mail` | Consolidated |
| `/direct-mail-campaigns` | `/campaigns?channel=direct-mail` | Consolidated |
| `/command-center` | `/ai#chat` | Legacy naming |
| `/agent-command-center` | `/ai#agents` | Legacy naming |
| `/agents` | `/ai#agents` | Legacy alias |
| `/ai-team` | `/ai#agents` | Legacy naming |
| `/support` | `/help#support` | Consolidated |

**Orphaned duplicates — verify before deletion:**

| Path | Likely successor | Note |
|---|---|---|
| `/offers` | `/deals` | Component exists but appears unused |
| `/listings` | `/properties` or `/marketplace` | Component appears shadowed |
| `/documents` | (verify) | Unclear if active |
| `/counties` | `/state-rules` or `/counties/:id` | Unclear use case |
| `/offers/batches` | `/deals` | Unclear if used |

## LATER — the long tail

155 routes that are valid but only reachable after specific actions or
via deep links. **Most are healthy** — they're feature-specific surfaces
(notes, tax-delinquent, wholesaler verticals, finance tools, AI tools).

Highlights worth periodic review:
- **Vertical-specific clusters** (notes/*, redemption-clock, wholesaler-state-rules, quiet-title) — gated by investor type; keep.
- **Settings sub-routes** (`/settings/*`) — first-class settings IA; keep.
- **Feature-flagged AI tools** (`/avm`, `/avm-bulk`, `/negotiation`, `/vision-ai`, `/seller-intent`, `/market-intelligence`) — guarded by FlaggedRoute wrapper; keep but monitor adoption.
- **Money sub-routes** (`/cash-flow`, `/forecasting`, `/portfolio-health`, `/portfolio-pnl`, `/tax-optimizer`, etc.) — accessible from Money module; keep.

## Recommended cleanup plan

**Wave 1 (low-risk, redirect-only paths):**
Delete the deal-discovery cluster files (`/radar` through `/deal-underwriting`)
and the consolidated channel aliases (`/sequences`, `/direct-mail*`).
These are already redirects; the page files can go.

**Wave 2 (verify usage):**
Grep server logs for hits to `/offers`, `/listings`, `/documents`,
`/counties`, `/offers/batches`. If <10 hits over 30 days, delete the
component files + route entries.

**Wave 3 (legacy renames, 60-day window):**
Keep `/dashboard → /today`, `/pax → /ai`, `/team-inbox → /team` etc.
in place for ~60 days from the 2026-05-11 consolidation pass. Then
remove the routes entirely.

## Status

This file is a snapshot. Re-run the audit periodically (quarterly) as new
routes land. Maintain the DAY-1 count at ≤10 — anything more and IA
clarity starts to erode.
