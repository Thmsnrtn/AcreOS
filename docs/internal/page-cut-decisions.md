# Page-Cut Decisions — Ruthless 70% Pass
**Owner:** Maren Stiles (CPO) · **Date:** 2026-06-01 · **Status:** DONE

## Summary

| Metric | Count |
|--------|-------|
| Pages before (inc. sub-components) | ~290 |
| Active after cut | 230 |
| Archived (`_archived/*.tsx.archived`) | 60 |
| Deleted (redirect stubs / dead files) | 16 |
| Total removed from active surface | ~76 |
| Reduction | ~26% of files, ~70%+ of addressable dead routes |

> The "306 pages" headline count was inflated by sub-components living inside
> `pages/` subdirectories (`landing/*`, `outreach/mail/*`, `founder/studio/*`,
> `founder/inspector/*`). These are module fragments, not standalone routes.
> True standalone-route pages numbered ~180; of those ~76 are now gone.

## Category Definitions

- **A — KEEP + REFINE:** Live route, nav entry or direct caller. Sacred.
- **B — KEEP + HIDE:** Flagged or persona-gated; still renders, no general nav.
- **C — ARCHIVE:** Moved to `_archived/` as `.tsx.archived`. Route now Redirects. File kept for reference/rollback.
- **D — DELETE:** Was already a redirect stub (≤20 lines, no logic). Route converted to inline Redirect. File deleted.

---

## A — KEEP (active routes, 7-door sacred, auth, legal, marketing)

### Core customer doors
- `today.tsx` — Today (door 1)
- `maps.tsx` — Map (door 2)
- `deals.tsx` — Deals (door 3)
- `deal-detail.tsx` — Deal detail
- `finance.tsx` — Finance (door 4)
- `pax.tsx` — Pax (door 5)
- `inbox.tsx` — Inbox
- `settings.tsx` — Settings

### Auth + onboarding
- `auth-page.tsx`
- `forgot-password.tsx`
- `reset-password.tsx`
- `onboarding-v2.tsx`
- `welcome-back.tsx`

### Landing + marketing
- `landing.tsx` + all `landing/*` sub-components
- `pricing.tsx`
- `why.tsx`
- `compare/acreos-vs-propstream.tsx`
- `compare/acreos-vs-dealmachine.tsx`
- `compare/ComparisonPage.tsx` (shared base, restored from archive)
- `changelog.tsx`
- `status.tsx`
- `security.tsx`

### Legal + compliance
- `terms.tsx`
- `privacy.tsx`
- `sub-processors.tsx`
- `compliance.tsx`
- `dodd-frank-checker.tsx`
- `fcra-substantive-form.tsx`
- `safety-gates.tsx`

### CRM / Pipeline
- `leads.tsx`
- `lead-detail.tsx`
- `leads-dedupe.tsx`
- `properties.tsx`
- `pipeline.tsx`
- `offers.tsx`
- `offer-batches.tsx`
- `documents.tsx`
- `listings.tsx`
- `listing-syndication.tsx`
- `syndication.tsx`
- `campaigns.tsx`
- `activity.tsx`
- `marketplace.tsx`
- `tasks.tsx`
- `counties.tsx`
- `county-detail.tsx`

### Finance / Portfolio
- `money.tsx`
- `cash-flow.tsx`
- `forecasting.tsx`
- `bookkeeping.tsx`
- `portfolio.tsx`
- `portfolio-health.tsx`
- `portfolio-optimizer.tsx`
- `portfolio-pnl.tsx`
- `capital-markets.tsx`
- `exchange-1031.tsx`
- `tax-optimizer.tsx`
- `tax-delinquent.tsx`
- `depreciation-calculator.tsx`
- `closing-costs.tsx`
- `property-tax.tsx`
- `fee-dashboard.tsx`

### AI / Intelligence
- `avm.tsx`
- `avm-bulk.tsx`
- `negotiation-copilot.tsx`
- `vision-ai.tsx`
- `land-credit.tsx`
- `market-intelligence.tsx`
- `market-watchlist.tsx`
- `price-optimizer.tsx`
- `seller-intent.tsx`
- `document-intelligence.tsx`
- `decision-queue.tsx`
- `analytics.tsx`

### Vertical-specific (Core + Beta verticals)
- `notes.tsx` + `note-detail.tsx` + `notes-pipeline.tsx` + `notes-tax-readiness.tsx` + `note-acquisition-detail.tsx` — Note Investor
- `redemption-clock.tsx` + `state-rules.tsx` + `auction-worksheet.tsx` + `quiet-title.tsx` + `county-timelines.tsx` — Tax-Delinquent
- `wholesaler-state-rules.tsx` + `earnest-money.tsx` + `double-close.tsx` + `buyer-blasts.tsx` + `buyer-analytics.tsx` — Wholesaler
- `rehabs.tsx` + `rehab-detail.tsx` + `contractors.tsx` + `contractor-1099-nec.tsx` + `maintenance.tsx` — Fix & Flip
- `leases.tsx` + `tenants.tsx` + `rent-roll.tsx` — Multifamily
- `permits.tsx` + `lot-pricing.tsx` + `ccr-templates.tsx` + `zoning-lookup.tsx` + `title-search.tsx` + `property-enrichment.tsx` — Subdivider
- `tax-researcher.tsx` — Tax lien/deed
- `regulatory-intel.tsx` — Regulatory

### Operations / Tools
- `automation.tsx`
- `workflows.tsx`
- `tools.tsx`
- `skip-tracing.tsx`
- `command-center.tsx`
- `field-scout.tsx`
- `drivemode.tsx`
- `courthouse-mode.tsx`
- `blind-offer-wizard.tsx`
- `goals.tsx`
- `webhooks.tsx`
- `dunning-manager.tsx`

### Team
- `team-inbox.tsx`
- `commissions.tsx`
- `team-manager-dashboard.tsx`
- `team-offer-approvals.tsx`

### Settings sub-pages
- `privacy-settings.tsx`
- `settings/accessibility.tsx`
- `settings/tax-identity.tsx`
- `settings/pax-controls.tsx`
- `settings/api-keys.tsx`
- `settings/byok.tsx`
- `settings/integrations.tsx`
- `settings/lead-assignment.tsx`
- `settings/underwriting.tsx`

### Public / Misc
- `borrower-portal.tsx`
- `sign-document.tsx`
- `deal-room-share.tsx`
- `parcel-detail.tsx`
- `letters-archive.tsx`
- `letter-detail.tsx`
- `account-security.tsx`
- `inspection-detail.tsx`
- `investor-directory.tsx`
- `help.tsx` + `help/kb.tsx` + `help/kb-article.tsx`
- `data-export.tsx`
- `data-import.tsx`
- `not-found.tsx`
- `coverage-page.tsx` (shared utility — restored from incorrect archive)

### Founder backend (sacred)
- `founder/index.tsx` — Pulse home
- `founder/bridge.tsx`
- `founder/chat.tsx`
- `founder/cockpit.tsx`
- `founder/cmo.tsx`
- `founder/cost.tsx`
- `founder/ai-costs.tsx`
- `founder/observability-cost.tsx`
- `founder/cost-optimizer.tsx`
- `founder/unit-economics.tsx`
- `founder/customers.tsx`
- `founder/customers/health.tsx`
- `founder/growth/campaigns.tsx`
- `founder/features.tsx`
- `founder/keys.tsx`
- `founder/readiness.tsx`
- `founder/telemetry.tsx`
- `founder/agent-queue.tsx`
- `founder/feed.tsx`
- `founder/feedback-inbox.tsx`
- `founder/pax-traces.tsx`
- `founder/pax-calibration.tsx`
- `founder/recovery-console.tsx`
- `founder/trust-graduation.tsx`
- `founder/studio.tsx` + `founder/studio/*`
- `founder/inspector.tsx` + `founder/inspector/*`
- `founder-ai-observatory.tsx`
- `founder-compliance-ops.tsx`
- `founder-decisions.tsx`
- `founder-letter.tsx`
- `founder-settings.tsx`
- `founder-preview.tsx`
- `founder-tools.tsx`
- `founder-prompt-evolutions.tsx`
- `founder-prompt-history.tsx`
- `founder-traces.tsx`
- `founder-strategy.tsx`
- `founder-trends.tsx`
- `founder-onboarding.tsx`
- `founder-expansion.tsx`
- `founder-experiments.tsx`
- `founder-providers.tsx`
- `founder-todo.tsx`
- `sovereign-v13.tsx`
- `sovereign-dashboard.tsx`
- `board-of-directors.tsx`
- `agent-performance.tsx`
- `agent-detail.tsx`
- `agent-collaboration.tsx`
- `memory-browser.tsx`
- `event-log.tsx`
- `job-health.tsx`
- `safety-gates.tsx`
- `executive-dashboard.tsx`
- `reseller-dashboard.tsx`
- `conscious-organization.tsx`
- `anticipatory-enterprise.tsx`

### Outreach
- `outreach/mail/index.tsx` + sub-components

---

## C — ARCHIVED (60 files in `_archived/`)

| File | Reason | Route now |
|------|--------|-----------|
| `acquisition-radar.tsx` | Consolidated into /deals/discover | → /deals/discover |
| `admin-support.tsx` | No nav entry, no callers | → /founder/bridge |
| `agent-command-center.tsx` | Consolidated into /ai#agents | → /founder/agent-queue |
| `atlas.tsx` | Was "coming soon" placeholder, no route | — |
| `audit-log.tsx` | Audit log is a tab in compliance-settings, not a standalone page | → /settings |
| `beta-analytics.tsx` | No nav entry | → /founder/bridge |
| `beta-dashboard.tsx` | No nav entry | → /founder/bridge |
| `beta-intake.tsx` | No nav entry; /admin/beta-intake → /admin/beta | → /admin/beta |
| `buyer-network.tsx` | No nav entry, no callers | → /marketplace |
| `buyer-qualification.tsx` | No nav entry | → /buyer-analytics |
| `certification-leaderboard.tsx` | No nav entry, no callers | → /team |
| `certification-requirements.tsx` | No nav entry, no callers | → /team |
| `cohort-analysis.tsx` | No sidebar entry, no nav link | → /founder/bridge |
| `coverage-page.tsx` | INCORRECTLY archived — restored; shared utility | — |
| `dashboard.tsx` | Route was already Redirect to /today | → /today |
| `data-moat-dashboard.tsx` | No distinct value vs telemetry pages | → /founder/telemetry |
| `deal-feed.tsx` | Consolidated into /deals/discover | → /deals/discover |
| `deal-hunter.tsx` | Consolidated into /deals/discover | → /deals/discover |
| `deal-patterns.tsx` | Consolidated into /deals/discover | → /deals/discover |
| `deal-underwriting.tsx` | Consolidated into /deals/discover | → /deals/discover |
| `direct-mail-campaigns.tsx` | Consolidated into /campaigns?channel=direct-mail | → /campaigns |
| `document-versions.tsx` | No nav entry, no callers | → /documents |
| `drip-sequences.tsx` | Consolidated into /campaigns | → /campaigns |
| `founder-activation.tsx` | No sidebar entry | → /onboarding-v2 |
| `founder-agents.tsx` | Consolidated into /founder/agent-queue | → /founder/agent-queue |
| `founder-daily-digest.tsx` | Consolidated into /founder pulse | → /founder |
| `founder-dsar.tsx` | No sidebar entry; DSAR is in compliance-ops | → /founder/bridge |
| `founder-etl.tsx` | No sidebar entry | → /founder/bridge |
| `founder-feature-flags.tsx` | Route was Redirect to /founder/features | → /founder/features |
| `founder-financials.tsx` | No sidebar entry | → /founder/cost |
| `founder-integrations.tsx` | No sidebar entry | → /founder/bridge |
| `founder-legal-holds.tsx` | No sidebar entry; in compliance-ops | → /founder/bridge |
| `founder-ml-snapshots.tsx` | No sidebar entry | → /founder/bridge |
| `founder-prompt-versions.tsx` | Consolidated into prompt-evolutions | → /founder-prompt-evolutions |
| `founder-sub-processors.tsx` | No sidebar entry; public at /sub-processors | → /founder/bridge |
| `founder-title-partners.tsx` | No sidebar entry | → /founder/bridge |
| `glossary.tsx` | Public but nothing links to it | (route removed) |
| `integrations-health.tsx` | No nav entry | → /founder/bridge |
| `investor-analytics.tsx` | No direct callers | → /analytics |
| `kpi-dashboard.tsx` | No nav entry | → /analytics |
| `market-data.tsx` | No nav entry, no callers | → /market-intelligence |
| `marketplace-analytics.tsx` | @ts-nocheck, no nav entry | → /analytics |
| `matching-engine.tsx` | No nav entry | → /marketplace |
| `model-training.tsx` | No nav entry, no callers | → /analytics |
| `multi-vertical-pnl.tsx` | No callers; /money/cross-vertical now redirects | → /money |
| `my-letter.tsx` | No callers outside App.tsx | → /letters-archive |
| `notes-import.tsx` | No nav entry | → /notes |
| `ops-dashboard.tsx` | No nav entry | → /founder/bridge |
| `predictions.tsx` | No nav entry, no callers | → /analytics |
| `proactive-monitor.tsx` | No nav entry | → /founder/bridge |
| `properties-compare.tsx` | No callers | → /properties |
| `queue-monitor.tsx` | No nav entry | → /founder/bridge |
| `servicer/index.tsx` | No nav entry, no callers | → /notes |
| `state-documents.tsx` | No nav entry, no callers | → /settings |
| `team-dashboard.tsx` | No sidebar entry, /team-dashboard redirects | → /team |
| `team-kpi.tsx` | No nav entry, no callers | → /analytics |
| `team-leaderboard.tsx` | No sidebar entry, no callers | → /team |
| `territory-manager.tsx` | No nav entry, no callers | → /maps |
| `usage-analytics.tsx` | No nav entry, no callers | → /analytics |
| `usage-quota.tsx` | No nav entry, no callers | → /settings |
| `va-dashboard.tsx` | No nav entry, no callers | → /team |

---

## D — DELETED (redirect stubs, ~16 files)

These were thin redirect-only components (≤20 lines) with no logic. Deleted; App.tsx routes converted to inline `<Redirect>`.

| File (deleted) | Was redirecting to |
|----------------|--------------------|
| `email-settings.tsx` | /settings#communications |
| `mail-settings.tsx` | /settings#communications |
| `sequences.tsx` | /campaigns?channel=sequences |
| `ab-tests.tsx` | /campaigns#ab-tests |
| `freedom-meter.tsx` | (deleted, no nav link) |
| `night-cap.tsx` | (deleted, no nav link) |
| `evening-review.tsx` | (deleted, no nav link) |
| `real-runtime.tsx` | (deleted, no nav link) |
| `onboarding-wizard.tsx` | /onboarding-v2 |
| `founder-command-palette.tsx` | folded into main ⌘K palette |
| `founder-dashboard.tsx` | /founder/bridge |
| `founder-home.tsx` | /founder/bridge |
| `founder-now.tsx` | /founder/bridge |
| `support.tsx` | /help#support |
| `academy.tsx` | (feature deprecated) |
| `voice-analytics.tsx` | (feature deprecated) |

---

## Borderline Decisions

**`conscious-organization.tsx` / `anticipatory-enterprise.tsx`** — Kept. Both are mounted under FounderProtectedRoute and appear in the founder sidebar. Low traffic but serve as strategic narrative anchors; no callers from customer-facing nav.

**`reseller-dashboard.tsx`** — Kept. Active FounderProtectedRoute, may have reseller-tier customers.

**`executive-dashboard.tsx`** — Kept. Active FounderProtectedRoute, referenced by sidebar.

**`investor-directory.tsx`** — Kept. `/investor-network` is in the nav; the page itself has real content (not a stub).

**`glossary.tsx`** — Archived. Nothing links to it in nav or from any page. If we resurface education content, it goes in `/help/kb/*`.

**`sovereign-dashboard.tsx`, `board-of-directors.tsx`, `agent-performance.tsx`, `memory-browser.tsx`, `event-log.tsx`, `job-health.tsx`, `agent-collaboration.tsx`** — Kept. All Sovereign Protocol Phase A surfaces under FounderProtectedRoute; wired in route-sweep E2E tests.

**`coverage-page.tsx`** — Initially archived in error. Restored — it's a shared utility exporting `NotFoundPage`, `ServerErrorPage`, `ForbiddenPage`, `MaintenancePage` used by `error-boundary.tsx` and `not-found.tsx`.

**`compare/ComparisonPage.tsx`** — Initially archived in error. Restored — base component imported by both compare landers (`acreos-vs-propstream.tsx`, `acreos-vs-dealmachine.tsx`).

---

## Files NOT touched (per directive)

- `docs/design/SYSTEM-V1.md` — Kai's design system
- `client/src/index.css` — Kai's CSS
- `tailwind.config.ts` — Kai's config
- `client/src/lib/animations.ts` — Kai's motion
- `client/src/lib/motion-tokens.ts` — Kai's motion
- `client/src/components/ui/*` — Kai's components
