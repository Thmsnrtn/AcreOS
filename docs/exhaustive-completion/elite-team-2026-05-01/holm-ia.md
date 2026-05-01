# Holm Nakagawa — Information Architecture Audit
**AcreOS, 2026-05-01.** IA lens: route vs concept, naming, settings vs surface, tab-host smell, search canonicality.

I have walked the full sidebar tree, the 166-route table, and the three big tab-host pages. Most of what's wrong is not visual — it's that the product holds *more concepts than the user does*. Twenty-eight sidebar destinations, 166 routes, and three pages that try to be five pages each. The cure is subtraction.

---

## 1 · The mental model AcreOS imposes vs. the model a Land Investor uses

A Land Investor — even a sophisticated one running mail at scale — holds **roughly seven concepts** in their head about their own business:

| What the investor thinks about | Frequency |
|---|---|
| "Who do I need to talk to today?" (people / leads / sellers) | daily |
| "What land do I own or am I buying?" (properties / parcels) | daily |
| "Which deals are moving?" (active opportunities, stage) | daily |
| "What's the money doing?" (cash in, cash out, notes, payments) | weekly |
| "Where's the next batch of mail going?" (outreach / campaigns) | weekly |
| "What's the assistant noticing?" (Pax — surfaces, not a destination) | continuous |
| "Settings I rarely touch." | rarely |

Seven. Possibly eight if you count Map as a primary surface for hunters. The product, in contrast, exposes **28 sidebar destinations across 8 modules**, **166 routes**, and a top-level navigation that asks the user to distinguish "CRM" from "Pipeline" from "Money" from "Finance" from "Portfolio" from "Capital Markets" — five separate financial words for what is, to the investor, **one ledger**.

The divergence:

| Investor concept | AcreOS surface(s) | Mental-model cost |
|---|---|---|
| People | `/leads`, `/skip-tracing`, `/leads/dedupe`, contacts inside CRM | Three nouns for the same row of a table |
| Land | `/properties`, `/parcels/:id`, `/maps`, `/listings`, `/marketplace` (sometimes), `/portfolio` (the same parcels, later in life) | The same parcel has a different name depending on what stage you found it in |
| Deals | `/deals`, `/pipeline`, `/offers`, `/offers/batches`, `/blind-offer-wizard`, `/negotiation`, `/deal-underwriting`, `/deal-feed`, `/deal-hunter`, `/deal-patterns` | Ten "deal" routes. The investor has one funnel. |
| Money | `/money` (tab host), `/finance`, `/portfolio`, `/cash-flow`, `/capital-markets`, `/portfolio-pnl`, `/portfolio-health`, `/bookkeeping`, `/depreciation`, `/closing-costs`, `/property-tax`, `/commissions`, `/dunning`, `/exchange-1031`, `/tax-optimizer`, `/tax-delinquent` | Sixteen money routes. The investor has one P&L. |
| Outreach | `/campaigns`, `/direct-mail`, `/sequences`, `/ab-tests`, `/syndication`, `/syndication-status` | Six outreach routes for "did I send the mail?" |
| Pax | `/ai`, `/pax`, `/agents`, `/ai-team`, plus the rail, plus ⌘K, plus the sidebar bell, plus inline observation cards | Pax is everywhere and a destination. Pick one. |
| Settings | `/settings` (17 tabs), `/settings/email`, `/settings/mail`, `/settings/privacy`, `/founder/settings`, `/tools` | Settings is a destination *and* a hub *and* leaks specialty pages |

**One sentence:** the investor wants a desk; AcreOS gives them a directory tree. Every concept they care about has been atomized into 3–10 surfaces, and each surface was named by a different person on a different day.

---

## 2 · Naming collisions inventory

Same thing, different word. These are not synonyms — they're failures of canonicality.

| Concept | Words currently used | Where | Canonical proposal | Why |
|---|---|---|---|---|
| A piece of land | **Property**, **Parcel**, **Listing**, **Inventory** (implied) | sidebar "Properties", route `/parcels/:id`, `/listings`, "Inventory" in onboarding copy | **Parcel** everywhere. Singular and plural. | Land Investors say "parcel." `useTerm()` already exists; honor it as the source of truth. |
| Active opportunity | **Deal**, **Pipeline**, **Board**, **Acquisition**, **Offer** | `/deals`, `/pipeline`, `/pipeline` tab "Board", "Acquisition Radar", `/offers` | **Deal** for the row, **Pipeline** for the view. Kill "Board" as a tab name. | "Pipeline" is the noun for the collection; "deal" is the noun for one. "Board" is a UI shape, not a concept. |
| Person of interest | **Lead**, **Seller**, **Contact**, **Owner** | `/leads`, "skip-tracing" copy, ContactRound icon, parcel detail "Owner" | **Lead** until under contract → **Seller** post-LOI. Single transition, named in code. | The investor's mental model already shifts at LOI — match it. |
| The financial surface | **Money**, **Finance**, **Portfolio**, **Capital** | `/money`, `/finance`, `/portfolio`, `/capital-markets` | **Finance** as the parent; everything else is a tab inside. Kill `/money`. | Five words for one ledger is the worst smell in the app. |
| The notes business | **Notes**, **Loans**, **Seller Financing**, **Borrower** | `/finance` Notes tab, "/portal" borrower portal, `/dunning` | **Notes** (this is what note investors call them). | Already mostly consistent; just fix copy-leakage. |
| The assistant | **Pax**, **AI**, **Atlas**, **Sophie**, **Forge**, **Agents**, **AI Team** | `/pax`, `/ai`, `/agents`, `/ai-team`, customer-facing copy mentions Atlas/Sophie (persona-leak P0) | **Pax** in customer surface. *Always.* Founder codenames never leak. | Persona architecture is already canonical; the IA just hasn't enforced it. |
| Today / Now | **Today**, **Dashboard**, **Home**, **Founder home**, **Command Center**, **Executive Dashboard** | `/today`, `/dashboard`, `/`, `/founder`, `/command-center`, `/executive-dashboard` | **Home** = `/`. **Today** = a section inside it. Kill `/dashboard` and `/command-center` as routes. | "Dashboard" is a feature category, not a place. |
| Insights | **Insights**, **Analytics**, **Intelligence**, **Observations**, **Markets** | sidebar "Insights" → `/analytics`, "Market Intelligence", Pax "observations" | **Insights** as the surface; "Markets," "Valuations," "Radar" as tabs inside. | The sidebar already tries this; reduce to one verb. |
| Map | **Map**, **Maps**, **Maps & Land** | `/maps` (plural), sidebar "Map" (singular) | **Map** singular. | Trivial but it bleeds trust. |
| Help / Support | **Help**, **Support**, `/admin/support`, `/help` | three places | **Help** for customers, **Admin / Support** for staff. | `/admin/support` is a different concept than `/help`; keep the prefix. |

**Cross-cutting:** the persona vocabulary primitives (commit `b444513`) ship `useTerm()` but only 3 of 12 daily-use surfaces wire it. Naming will *never* feel canonical until E1–E9 (synthesis Wave E) lands.

---

## 3 · Tab-host pages that should split — ranked

Tabs are how a page apologizes for not being five pages. When the tabs are *full sub-products* (pipeline.tsx mounting `<DealsPage>`, `<LeadsPage>`, `<PropertiesPage>` — entire route components — inside tabs), the tabs are not navigation, they're a regret.

### Rank 1 — `/pipeline` (5 tabs, kill the route)
- Tabs: Board, Leads, Properties, Deals, Outreach.
- Each tab mounts the *same component* the standalone route mounts (`DealsPage`, `LeadsPage`, `PropertiesPage`, `CampaignsPage`).
- `Board` and `Deals` mount **the same component** — `<DealsPage />` twice (pipeline.tsx:317, 335).
- The synthesis already flags this as `B8` (double-stacked PageShell).
- **Verdict: delete `/pipeline`**. The sidebar should point "Pipeline" to `/deals` directly. There is no reason this route exists except that someone wanted a "container" — but the sidebar group already plays that role.

### Rank 2 — `/money` (5 tabs)
- Tabs: Notes, Finance, Portfolio, Forecast, Capital.
- Tabs **mount swapped components** (synthesis A4 — Finance tab mounts `<PortfolioPage>` and vice versa; this is a launch blocker, not just IA).
- Each tab corresponds to an existing standalone route (`/finance`, `/portfolio`, `/cash-flow`, `/capital-markets`).
- **Verdict: delete `/money`**. Promote `/finance` to be the parent surface and let the existing routes be its sub-routes (`/finance/portfolio`, `/finance/cash-flow`, `/finance/capital`, `/finance/notes`). One word. One mental model.

### Rank 3 — `/pax` (5 tabs)
- Tabs: Insights, Chat, Activity, Agents, Automation.
- This one has *some* defense — Pax is the assistant and its surface naturally has modes — but Chat and Insights conflict with the sidebar Pax bell, the Pax rail, ⌘K, and the inline observation feed. **Pax is asked to be a destination AND an ambient layer.**
- **Verdict: keep `/pax` as a route, but reduce to 2 tabs**: "Conversations" (chat + activity merged) and "Watching" (insights + agents). Move "Automation" out — automation is a *concept that lives next to the thing being automated*, not a tab. Each automation should appear inside the surface it acts on (campaigns, leads, etc.), with `/pax` showing only a global list-view of *what's running*.

### Rank 4 — `/settings` (17 tabs)
- Recently regrouped (commit `05bd418`). Better than before but still too many.
- 17 tabs cannot be scanned. The user falls back to ⌘K, which means the IA failed.
- **Verdict: cut to 7 tabs at most**. See §5.

### Rank 5 — `/analytics` (implied tab host)
- Sidebar "Insights" parent → `/analytics`, with Valuations / Markets / Radar / Land Credit / Counties / Compliance as children.
- Each child is its own route. Today the parent `/analytics` page is a tab host duplicating the children.
- **Verdict: make `/analytics` a true index page** (cards linking to children) rather than a tab host. The sidebar already provides the tab function.

---

## 4 · Routes that should die / merge / move — ranked

The 166 routes break into roughly: ~30 customer daily-use, ~25 founder, ~40 specialty / deep-link, ~40 admin / observability, ~30 dead or aspirational. The goal is not "delete half" — it's "delete the ones the customer must mentally hold but doesn't need to."

### Top deletions (kill outright — replace with a tab or fold in)
| Route | Action | Why |
|---|---|---|
| `/pipeline` | **DIE** | See §3 rank 1. Duplicates `/deals` + sidebar grouping. |
| `/money` | **DIE** | See §3 rank 2. Folds into `/finance`. |
| `/dashboard` | **DIE → redirect to `/`** | "Dashboard" is not a place; `/` is. |
| `/command-center` | **DIE → redirect to `/`** | Founder mode duplication; CommandCenterPage is 2,264 LOC pulled by `/pax` per synthesis. |
| `/executive-dashboard` | **DIE** | Third synonym for the same surface. |
| `/founder-dashboard` | **DIE → redirect to `/founder`** | Two routes, identical intent (commit `8aa9a4d` already moved canonical to `/founder`). Redirect is one-line. |
| `/founder-home` | **DIE → redirect to `/founder`** | Same. |
| `/agents`, `/ai-team`, `/ai` | **MERGE into `/pax`** | Three routes, one assistant. |
| `/parcels/:id` vs property detail | **MERGE** | One detail page, parcel-noun by `useTerm()`. |
| `/leads/dedupe` | **MOVE to `/leads?view=dedupe`** | This is a filter, not a destination. |
| `/offers/batches` | **MOVE to `/offers?view=batches`** | Same. |

### Merges (combine related routes under a parent)
| Cluster | Becomes |
|---|---|
| `/finance`, `/portfolio`, `/cash-flow`, `/capital-markets`, `/portfolio-pnl`, `/portfolio-health`, `/bookkeeping`, `/depreciation`, `/closing-costs`, `/property-tax`, `/commissions`, `/dunning`, `/exchange-1031`, `/tax-optimizer` | `/finance` with deep tabs OR sub-routes `/finance/{notes,portfolio,cash,capital,tax,close,…}` — flat URL, one mental home. **15 → 1.** |
| `/campaigns`, `/direct-mail`, `/sequences`, `/ab-tests`, `/syndication`, `/syndication-status` | `/campaigns` with sub-routes. **6 → 1.** |
| `/deals`, `/offers`, `/offers/batches`, `/blind-offer-wizard`, `/negotiation`, `/deal-underwriting`, `/deal-feed`, `/deal-hunter`, `/deal-patterns` | `/deals` with deep links. **9 → 1.** |
| `/avm`, `/avm-bulk`, `/price-optimizer`, `/seller-intent`, `/document-intelligence`, `/vision-ai`, `/tax-researcher`, `/zoning`, `/title-search`, `/property-enrichment`, `/market-intelligence`, `/market-watchlist`, `/market-data`, `/counties`, `/regulatory-intel` | All are **research tools that act on a parcel or a market**. They belong as actions *inside* `/parcels/:id` or `/markets/:area`, not as nav destinations. **15 → 0 in nav** (still reachable via ⌘K). |

### Moves (right concept, wrong place)
| Route | Move to |
|---|---|
| `/tools` | Make it `/settings/tools` — calculators are not a destination. |
| `/data-export` | `/settings/data` — already a settings concern. |
| `/usage` | `/settings/billing-usage` — usage = billing context. |
| `/goals` | `/settings/goals` (founder-mode hides this for now) |
| `/webhooks` | `/settings/integrations/webhooks` |
| `/audit-log` | `/settings/security/audit` |
| `/changelog`, `/status` | Public marketing, fine, but link from `/help` not the sidebar |
| `/freedom-meter`, `/night-cap`, `/evening-review`, `/board-of-directors`, `/sovereign`, `/conscious-organization`, `/anticipatory-enterprise` | Founder ritual surfaces; group under `/founder/rituals` (single index) |

**Net effect:** ~166 routes → ~80. About 60 routes still exist for engineering/deep-link reasons (admin, observability, founder); but the *user-facing nav surface* drops from ~28 sidebar destinations to ~10. That's the number a Land Investor can hold.

---

## 5 · Settings hygiene

**Doesn't belong in `/settings` (currently is or shows up as a tab):**
- `Tools` (calculators) — these are surfaces. Move to `/finance/tools` or kill them.
- `AI Tasks` — this is automation, not configuration. Belongs in `/pax` or inline.
- `Goals` — operational, visited weekly. Surface as a card on `/`.
- `Referral` — visited rarely but it's a *promotional surface*, not a setting. Promote to `/refer`.
- `Developer` — should be feature-flagged for founder only; it's currently promoted to a top-level tab for everyone.

**Doesn't live in `/settings` but should:**
- `/tools` — see above.
- `/data-export` — clearly settings.
- `/usage` — billing/usage.
- `/webhooks` — integrations setting.
- `/dodd-frank`, `/state-documents`, `/compliance` — these are configuration of legal posture, not surfaces. Settings sub-area.
- `/audit-log` — settings/security.
- `/founder/settings` — fine to keep separate (founder-mode), but the cross-link from `/settings` should be visible to founders so they don't lose it.
- White-label / brand name config (currently surfaced via `useBrandName` but no obvious `/settings` tab for it) — settings/brand.

**The 17-tab problem.** Even after the regrouping, 17 is too many. Target seven:
1. **Account** (general + security + privacy)
2. **Workspace** (team + roles + brand)
3. **Notifications** (notifications + communications)
4. **Billing** (payments + usage + referral)
5. **Integrations** (integrations + automations + webhooks + AI config)
6. **Data** (export + audit + compliance + dodd-frank)
7. **Appearance** (theme + persona + density)

Ten things merge into seven. Each tab gets sub-sections, not sub-tabs.

---

## 6 · Recommended IA refactor sequence (5 steps, 2 weeks)

**Constraint:** every step must ship as a redirect-preserving change. Old URLs from emails/help-articles must not 404.

### Week 1

**Step 1 — Naming canonicalization (1.5 days).** Wire `useTerm()` across the 9 surfaces from synthesis Wave E. Pick canonical for every collision in §2. Add a lint rule: any new "Property" / "Pipeline" / "Money" string in customer-facing TSX fails CI.

**Step 2 — Kill the duplicate routes (1 day).** Add 7 redirects: `/pipeline → /deals`, `/money → /finance`, `/dashboard → /`, `/command-center → /`, `/executive-dashboard → /`, `/founder-dashboard → /founder`, `/founder-home → /founder`. Remove from sidebar. Keep route-level redirects for 60 days then delete.

**Step 3 — Settings cut to 7 tabs (1.5 days).** Apply §5 grouping. Move `/tools`, `/data-export`, `/usage`, `/webhooks`, `/audit-log`, `/goals` into `/settings/*`. Old routes redirect.

### Week 2

**Step 4 — Finance unification (3 days).** Make `/finance` the canonical money surface with sub-routes for portfolio, cash, capital, tax, close, dunning. Delete `/money`. Each `/finance/*` route is just a tab anchor. The sidebar shows "Finance" as one parent with four children (Portfolio, Cash Flow, Notes, Capital) — all the deep tax stuff lives in overflow.

**Step 5 — Research tools off the sidebar (1 day).** AVM / Markets / Vision / Document Intel / Title / Zoning / Enrichment all stop being nav items. They surface as **actions on a parcel** (button on `/parcels/:id`: "Run AVM," "Pull Title," "Check Zoning") and as ⌘K commands. Sidebar "Insights" reduces to **3 children: Markets, Radar, Land Credit**. Six routes leave the sidebar; zero leave the app.

**Net result after 2 weeks:**
- Sidebar destinations: 28 → 10
- Tab-host pages: 5 → 2 (settings, pax)
- Route count visible to customer: ~95 → ~40
- Nouns the customer must learn: ~24 → ~9
- ⌘K remains the safety net for everything else

The structure becomes: **Home, Leads, Parcels, Pipeline, Campaigns, Inbox, Pax, Insights, Finance, Settings.** Ten doors. Each door opens to one concept the investor already holds.

---

## 7 · The one IA mistake AcreOS would deeply regret in 6 months

**`/pax` is being designed as both a destination and an ambient layer, and the ambiguity will calcify.**

Right now Pax is reachable from: a sidebar item (`Pax`), a sidebar bell (`PaxNotificationBadge`), the floating PaxCopilotRail, ⌘K, the ConversationTray FAB, inline observation cards, and the `/pax` page with its own 5 tabs. **Seven entry points, none canonical.** The customer cannot form a stable model of "where Pax lives."

If left alone, in six months you will have:
- A `/pax` page with 8+ tabs that nobody opens because the rail does the same thing.
- A rail that started as helpful and is now permanently dismissed because users can't find the off-switch.
- Three different "Pax conversation history" surfaces with three different scrollback states.
- Customers asking support: *"Where do I go to talk to Pax?"* — a question that should be impossible to ask.

**The fix while the cost is still cheap (now):**
1. **Decide what Pax is structurally.** Spotlight or sidebar? It cannot be both. My recommendation: **Pax is Spotlight.** Pax is `⌘K + observations + rail`. Pax is not a *page*. Delete `/pax` and `/ai`. Replace with the rail (one canonical location) and ⌘K (one canonical search).
2. **Pax notifications are inbox items**, not a separate bell. Fold the PaxNotificationBadge into the existing notification center.
3. **One conversation history.** Reachable from one place (the rail's "history" tab). Not from `/pax`, not from `/agents`, not from `/ai-team`.

If you do this in May, it costs a week. If you do it in November, you'll have shipped Pax-related features in six places and the migration costs a quarter.

The deeper principle: **Pax is the answer to "where is everything?" — therefore Pax is not a where.** It's the verb that gets you to the where. Apple did not build a Spotlight tab. They built Spotlight. AcreOS should do the same.

---

*— Holm Nakagawa*
