# GAPS — what the prototype didn't cover

> Companion to HANDOFF.md. The prototype designed ~30 surfaces. The real codebase has 200+ routes covering whole product areas the prototype never touched. This document inventories what's missing, what to design before porting, and what to defer.

Scope test: anything not in `/acreos/app.jsx`'s switch statement is in this document.

---

## Tier 0 — High-value gaps to design BEFORE the port

These are real product surfaces that the prototype skipped but that customers will hit on day 1. Design these before development begins, or you'll ship developer-default UIs.

### 1. Online notarization & e-signing
**Routes already in codebase:** `/sign/:docId` (public, HMAC-token), `SignDocumentPage`.
**Gap:** the prototype's Documents page implies signing exists but never designs the flow. Notary integration (RON — Remote Online Notarization) is also implied by Deeds/Seller Finance but unmocked.

What needs design:
- **Document signing surface** for sellers/borrowers arriving at `/sign/:docId?s=&t=`. No login. Clean, mobile-first. Branded but not marketing-y.
- **Notary scheduling** flow inside Deal: pick provider (Notarize, Proof, Notary.io, BlueNotary), schedule session, attach to document, track status (scheduled → in session → notarized → returned).
- **Notary session shell**: when the user joins, what does the page look like? Most providers embed via iframe — design the wrapper, breadcrumbs, and "what to expect" panel.
- **Audit trail of the notarized doc** — provider session ID, timestamp, notary identity, KBA pass — visible on document detail.

### 2. MCP / integration ecosystem
**Routes already in codebase:** `/founder/integrations`, `IntegrationsHealthPage`, `WebhooksPage`.
**Gap:** the prototype has a stub Integrations page. The real product needs a marketplace + per-integration config + connection lifecycle.

What needs design:
- **Integration directory** — browseable, categorized (Notarization, Title, MLS, Email, SMS, CRM, Banking, Tax, Maps, Docs, Payments). Cards with logo, status, install count.
- **Per-integration detail page** — what it does, what data it accesses, scopes/permissions, install/uninstall, config fields.
- **Connection state UI** — connected, disconnected, expired, broken. Last-sync time. "Reauthorize" affordance.
- **Per-user vs. per-org** distinction (some integrations are team-wide, some are per-user like personal Gmail).
- **MCP-specific surface** — adding a custom MCP server: URL, auth method, tool list discovered, enable/disable individual tools. This is power-user territory and deserves its own subpage in Settings.
- **Webhooks panel** — outbound webhooks, signing secret rotation, delivery log, retry.

### 3. Maps & geographic surfaces
**Routes:** `/maps`, `/counties`, `/territory-manager`, `/zoning`, `/title-search`, `/property-enrichment`, `/skip-tracing`.
**Gap:** prototype represented parcels with placeholder cards. Real product is map-heavy.

What needs design:
- Full-screen map with parcel overlays, buy-box heatmap, deal pins, comp clustering.
- County/territory editor — pick polygon regions, name them, assign to team members.
- Zoning lookup — input parcel, output zoning + use restrictions.
- Title search results page — chain of title, liens, encumbrances visualization.
- Skip-tracing results — owner contact attempts, response rates.

### 4. Money / finance suite
**Routes:** `/money`, `/finance`, `/cash-flow`, `/forecasting`, `/portfolio-pnl`, `/portfolio-health`, `/exchange-1031`, `/tax-optimizer`, `/tax-delinquent`, `/bookkeeping`, `/depreciation`, `/closing-costs`, `/property-tax`, `/commissions`, `/dunning`.
**Gap:** prototype has one Seller Finance page. Real product has 14 finance surfaces.

What needs design (group by user job):
- **Cash flow / forecasting** — monthly outlook, scenarios, what-ifs.
- **1031 exchange** — track 45/180-day deadlines, identify like-kind properties.
- **Tax** — optimizer, delinquent prospecting, property-tax tracker, depreciation calculator.
- **Bookkeeping** — chart of accounts, transactions, P&L per property/per portfolio.
- **Commissions** — agent splits, payment status.
- **Dunning** — past-due seller-finance accounts, automated workflow.

### 5. Today / Tasks / Goals (the actual hub)
**Routes:** `/today` (the real homepage — auth users redirect here), `/tasks`, `/goals`, `/freedom-meter`, `/night-cap` (evening review), `/blind-offer-wizard`.
**Gap:** prototype's "Command Center" is conceptually closer to `/today`, but the real `/today` page has goals tracking, nightly review, and a "freedom meter" the prototype never showed.

What needs design:
- The real Today hub composition (vs prototype Command Center). Probably merge the two designs.
- Goals page — set, track, celebrate. North-star deal carries through from onboarding.
- Evening review / "Night cap" — end-of-day reflection, tomorrow setup.
- Freedom meter — hours-saved-by-AI counter. Visual, motivational.
- Blind offer wizard — bulk offer generation flow.

### 6. AI / Intelligence pages (each is its own product)
**Routes:** `/avm`, `/avm-bulk`, `/radar` (AcquisitionRadar), `/negotiation`, `/deal-hunter`, `/vision-ai`, `/market-intelligence`, `/market-watchlist`, `/price-optimizer`, `/seller-intent`, `/deal-patterns`, `/deal-feed`, `/market-data`, `/document-intelligence`, `/tax-researcher`, `/land-credit`.
**Gap:** prototype showed Atlas Run as a panel inside Parcel detail. Real product has 16 standalone AI pages.

These can largely follow the Atlas Run prototype's pattern (input → analysis → confidence + sources + recommendation), so the design system is set. But each needs IA — what's the input, what's the output, what's the next action? Don't let developers improvise these one at a time; do them as a batch design pass.

### 7. Onboarding V2 + onboarding-wizard
**Routes:** `/onboarding-v2`, `OnboardingWizardPage`, `OnboardingWizard` (component, mounted globally).
**Gap:** prototype designed one onboarding (`acreos-onboarding.html`). Codebase has two — V2 wizard and an in-app overlay wizard. Confirm with PM which is canonical, then port that one and delete the other.

---

## Tier 1 — Important, but can mock-ship and iterate

### 8. Help, Support, Status, Changelog
Routes: `/help`, `/support`, `/status`, `/changelog`. Customer-facing.
- Help: searchable docs index. Probably pulls from a docs CMS.
- Support: contact form, ticket list, SLA banner.
- Status: incident history, current uptime — usually a third-party (StatusPage, Atlas) embedded.
- Changelog: marketing/PM owns content; design only the chrome.

### 9. Marketing / public surfaces
Routes: `/`, `/auth`, `/pricing`, `/terms`, `/privacy`, `/portal/:accessToken`, `/forgot-password`, `/reset-password`.
- Prototype designed landing (`acreos-landing.html`) — port that.
- Auth, forgot-password, reset-password — design as a connected set; identical chrome.
- Borrower portal — public, token-gated; needs separate visual treatment from main app (less app-y, more document-y).
- Terms, privacy — content from legal; design typography only.

### 10. Mobile-specific surfaces
Routes: bottom nav (`MobileBottomNav` component), `PWAInstallPrompt`, swipe nav.
- Decide: which 5 destinations live in mobile bottom nav. (Recommendation: Today, Pipeline, Inbox, AI, More.)
- Design the "More" sheet that contains everything else.
- PWA install prompt content + timing.
- Tablet breakpoint behavior (sidebar collapsed by default? rail mode?).

### 11. Floating UI
Components: `FloatingActionButton`, `ConversationTray`, `FloatingHelpButton`, `DynamicIsland`, `PaxCopilotRail`, `EarlyAccessBanner`, `TrialBanner`, `NotificationBanner`, `OfflineIndicator`, `CookieConsentBanner`, `KeyboardShortcutsModal`, `NewItemMenu`, `NpsDialog`.
- Prototype has command palette + toasts. Real app has ~13 floating elements competing for screen real estate.
- **Hierarchy + layering rules** must be designed: what beats what, what dismisses what, what stacks vs. replaces. The codebase has `lib/floating-slots.ts` already — read it, codify the rules visually.
- Notably **Pax Copilot Rail** is omnipresent and the prototype's Pax page is different. Reconcile.
- **Dynamic Island** (Apple-borrowed pattern for status notifications) — design language and what it surfaces.

### 12. Team / collaboration
Routes: `/team`, `/team-inbox`, `/team-dashboard`, `/team-leaderboard`, `/team-kpi`, `/commissions`, `/va-dashboard`.
- Team inbox vs. personal inbox differentiation.
- Leaderboard — gamification design (or anti-design — depends on brand).
- VA dashboard — virtual assistant workflow; lower-tier user permissions.

### 13. Compliance / regulatory
Routes: `/compliance`, `/dodd-frank`, `/state-documents`, `/regulatory-intel`, `/audit-log`.
- Compliance dashboard — green/yellow/red on each requirement.
- Dodd-Frank checker — input transaction → pass/fail with reasoning.
- State documents — per-state form library.
- Regulatory intel — feed of changes that affect this user.

### 14. Settings — full inventory
The real Settings is many subpages: `/settings`, `/settings/email`, `/settings/mail`, `/settings/privacy`, `/usage`, `/goals`, `/webhooks`, `/my-letter`, plus `/founder/settings`.

**Settings IA needs designing as a system:**
- Account (profile, password, 2FA, sessions)
- Preferences (theme, sound, density, keybinds)
- Notifications (per-channel, per-event matrix)
- Integrations (see Tier 0 #2)
- Webhooks
- Email/Mail (sending domain, signature, footer)
- Privacy (data retention, export, delete)
- Usage & quotas (visible, with upgrade CTAs)
- Goals (north-star, targets)
- "My letter" (founder-facing personalized welcome — confirm with PM)
- Team & roles (per-org)
- Billing (per-org)
- White-label (`useWhiteLabel` exists — reseller customization)

Design the **left rail IA** as one system, not page-by-page.

### 15. Pricing / billing / trial / quota
Routes: `/pricing`, `TrialBanner`, `UsageQuotaPage`, `EarlyAccessBanner`.
- Pricing — landing-tier marketing page.
- Trial banner — counts down, persistent until upgraded.
- Usage & quota — bars per limit, upgrade CTA.
- Early-access banner — for beta users.
- Reseller (`/reseller`) — white-label customer admin view.

### 16. Marketplace / investor network
Routes: `/marketplace`, `/marketplace-analytics`, `/investor-directory`, `/investor-network`, `/buyer-qualification`, `/matching-engine`.
- Internal-or-external marketplace (clarify) — list, filter, contact.
- Investor directory + qualification — contact buyer pool, qualify them.
- Matching engine — algorithmic deal↔investor pairing UI.

---

## Tier 2 — Founder-only surfaces (port last)

These are admin surfaces for the AcreOS team itself, not customers.

Already prototyped: founder-home, atlas-run, revenue, cost, ops, tenants.

**Not yet designed (but exist in codebase):**
- `/founder/ai-observatory` — model performance dashboards
- `/founder/feature-flags` — flag matrix per tenant
- `/founder/integrations` — integration health per tenant
- `/founder/agents` + `/founder/agents/:codename` + `AgentDetailPage`
- `/founder/daily-digest` + `/founder/letter` + `/founder/strategy` + `/founder/trends`
- `/founder/preview` + `/founder/tools`
- `/founder/prompt-evolutions` + `/founder/prompt-history` + `/founder/traces`
- `/founder/onboarding` + `/founder/expansion` + `/founder/experiments`
- `/founder/providers` (vendor management) + `/founder/todo`
- `/founder/v13` (Sovereign V13 dashboard)
- `/founder/decisions`
- `/board-of-directors` + `/agent-performance` + `/memory-browser` + `/event-log` + `/job-health` + `/agent-collaboration`
- `/sovereign` (Sovereign Protocol Phase A)
- `/admin/safety-gates` + `/admin/decisions` + `/admin/ops` + `/admin/queues` + `/admin/integrations-health` + `/admin/monitor`
- `/data-moat` + `/executive-dashboard`
- `/anticipatory-enterprise` + `/conscious-organization` + `/real-runtime`

**Recommendation:** treat all of these as founder dashboards with one shared layout. Don't design them individually unless one becomes daily-driver — design **the founder-page chassis** and let developers fit each one in. The prototype's founder pages are the chassis spec; each new dashboard slots in.

---

## Tier 3 — Components / patterns the prototype skipped

These aren't pages but reusable patterns. Design once, used everywhere.

- **`AnticipatoryEnterprise` agent codenames** — internal agent names (forge_revenue, sophie_support, shield_compliance) leak in some founder surfaces. The prototype only showed three (Atlas, Pax, Sophie). Reconcile: customers see Pax brand, founders see codenames. Design the disclosure model.
- **Hints system** (`HintsProvider`, `feature-hints` component) — beyond the guided tour, there's a contextual-hint system. Design the visual language.
- **Cookie consent banner** — GDPR-grade. Design (or use stock).
- **Error boundary** — what does a crashed page look like in this brand?
- **Cursor glass effect** (`useCursorGlass`) — cursor-following UI treatment. Designer should call: keep, polish, or remove.
- **Theme system** beyond light/dark — `useWhiteLabel` implies tenant-customizable theming. Design the customization surface (logo, primary, accent) and how it flows through.
- **Voice features** (deprecated per code comments — `VoiceAnalyticsPage` removed, "AI Voice feature deprecated"). Confirm voice is dead before porting any voice UI.
- **Sequences vs. Drip Sequences vs. Campaigns vs. Direct Mail** — four overlapping concepts in routes. Resolve IA before designing.
- **A/B tests** (`/ab-tests`) — testing framework UI. Design the test-creation flow + results page.
- **Field scout** (`FieldScoutPage`) — mobile-first field-research tool. Probably its own visual world.
- **Data export** (`/data-export`) — CSV/JSON dump UI. Job-style (queue, progress, download link).
- **Model training** (`/model-training`) — customer-facing model tuning? Confirm with PM whether this ships to customers.

---

## Recommended next steps

1. **One-hour PM review** of this document. For each section, decide: design now / mock-ship / defer / cut.
2. **Three design sprints** (in this order):
   - **Sprint 1 — Notarization + Integrations + MCP** (Tier 0 #1, #2). Highest user-visible gap.
   - **Sprint 2 — Money suite consolidation** (Tier 0 #4). 14 routes; needs IA before pixels.
   - **Sprint 3 — Settings IA + Mobile nav + Floating-UI hierarchy** (Tier 1 #10, #11, #14). System-level decisions that affect every page.
3. **Per-page design** for AI Intelligence pages (Tier 0 #6) can happen in parallel as a batch — they all follow the Atlas Run template.
4. **Founder pages** get a single "founder chassis" design. New founder dashboards are developer-implemented from there.
5. **Maps + geographic** surfaces (Tier 0 #3) need a separate research pass — pick a maps library, decide the data layer, then design.

---

## Final note on scope

The prototype was right to focus on the daily-driver loop (Pipeline, Parcel, Inbox, Atlas Run). That's where users live and that's where good design returns the most. The gaps above are real but **most of them tolerate developer-default styling** at v1. Don't try to design 200 pages. Design the 20 that customers see daily, build the chassis for the long tail, and ship.
