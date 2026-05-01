# Tomás Reyes — AcreOS Empty-State Audit
**2026-05-01 · Wave 2 elite-team deep audit · Apple Mail / Things 3 lineage**

---

## 1. One-line verdict

AcreOS already has a great empty-state *component* and a small library of well-thought-out branded variants — but at least 35 surfaces still ship the `<p className="text-muted-foreground">No X yet.</p>` shrug, the same hero-shaped `EmptyState` is reused for filters and brand-new-user onboarding (those are different occasions), and the customer Tasks empty state still leaks the founder codename `Atlas`. Fixing this isn't a redesign — it's a microcopy pass plus three archetype templates.

---

## 2. Inventory — every empty state, by file:line

Format: file:line · current title / description · icon? · action? · occasion (N=new-user · C=cleared/done · F=filtered · E=error-fallback)

### A. Tier-1 (uses `EmptyState` component, branded library — protect)

| # | File:line | Title (verbatim) | Description (verbatim) | Icon | Action | Occasion |
|---|---|---|---|---|---|---|
| A1 | `client/src/components/empty-states.tsx:21-22` | `"No leads yet"` | `"Import your first leads to start building your pipeline. ${brandName} scores and prioritizes every lead automatically."` | Users | "Add a Lead" + tips × 3 + CSV import link | **N** |
| A2 | `client/src/components/empty-states.tsx:64-65` | `"No properties yet"` | `"Add properties to track your inventory — from prospect parcels to owned land and active listings."` | Map | "Add a Property" + tips × 3 + CSV link | **N** |
| A3 | `client/src/components/empty-states.tsx:99-100` | `"No deals yet"` | `"Create your first deal to start tracking acquisitions and dispositions through your pipeline."` | Handshake | "Create a Deal" + tips × 3 | **N** |
| A4 | `client/src/components/empty-states.tsx:121-122` | `"No tasks yet"` | `"Create tasks to track your to-dos, follow-ups, and deadlines across all your deals."` | CheckSquare | "Add a Task" + tips × 3 (**leaks "Atlas AI"**) | **N** |
| A5 | `client/src/components/empty-states.tsx:143-144` | `"No campaigns yet"` | `"Launch your first outreach campaign to connect with motivated sellers via mail, email, or SMS."` | Megaphone | "Create a Campaign" + tips × 3 | **N** |
| A6 | `client/src/components/empty-states.tsx:165-166` | `"No promissory notes yet"` | `"Create your first seller-financed note to start tracking payments, amortization, and portfolio value."` | Banknote | "Create a Note" + tips × 3 | **N** |
| A7 | `client/src/components/empty-states.tsx:187-188` | `"Your pipeline is empty"` | `"Add leads and deals to see them flow through your pipeline stages."` | Target | (no action) + tips × 2 | **N** |

### B. Tier-2 (uses `EmptyState` component, ad-hoc per page)

| # | File:line | Title | Description | Icon | Action | Occasion |
|---|---|---|---|---|---|---|
| B1 | `client/src/pages/parcel-detail.tsx:118-127` | `"Parcel not found"` | `"The URL is missing a valid parcel ID."` | MapPin | "Back to properties" | **E** |
| B2 | `client/src/pages/properties.tsx:703-715` | `"No properties match these filters"` | `"${properties.length} ${...} hidden by your current filters. Reset to see them again."` | FilterIcon | "Reset filters" | **F** |
| B3 | `client/src/pages/inbox.tsx:1146-1149` (via `getEmptyMessage`) | varies (see below) | varies | Mail/Phone | none | mixed |
| B3a | `inbox.tsx:1005` | `"No SMS conversations"` | `"SMS conversations will appear here."` | Phone | none | **N** |
| B3b | `inbox.tsx:1009` | `"No unread messages"` | `"You're all caught up!"` | Mail | none | **C** |
| B3c | `inbox.tsx:1011` | `"No starred messages"` | `"Star messages to find them quickly."` | Mail | none | **N/C** |
| B3d | `inbox.tsx:1013` | `"No archived messages"` | `"Archived messages will appear here."` | Mail | none | **N** |
| B3e | `inbox.tsx:1015` | `"No messages"` | `"Your inbox is empty."` | Mail | none | **N** |
| B4 | `inbox.tsx:1200-1204` | `"Select a message"` | `"Choose a conversation from the list to read it here."` | MessageSquare | none | (split-pane resting state, not empty data) |
| B5 | `client/src/pages/finance.tsx:361-367` | `"No promissory notes yet"` | `"Create a note to track financing. Manage seller financing, track payments, and generate amortization schedules."` | FileText | "Create Your First Note" | **N** (duplicates A6 with worse copy) |
| B6 | `client/src/pages/documents.tsx:482-488` | `"No templates yet"` | `"Create your first document template to get started."` | FileText | "Create template" | **N** |
| B7 | `documents.tsx:632-637` | `"No custom templates"` / `"No templates found"` | `"Create your own custom template…"` / `"No templates match the current filter."` | FileText | conditional | **N** + **F** in same component (good!) |
| B8 | `documents.tsx:667-672` | `"No documents generated"` | `"Generate your first document from a template."` | FileCheck | "View templates" | **N** |
| B9 | `documents.tsx:785-790` | `"No document packages"` | `"Bundle multiple documents together — like a closing packet — to save time on every deal."` | Package | "Create package" | **N** |
| B10 | `client/src/pages/listings.tsx:536-541` | `"No listings yet"` | `"Create your first property listing to start marketing."` | Building | "Create listing" | **N** |
| B11 | `client/src/pages/counties.tsx:627-636` | `"No target counties yet"` / `"No counties match filters"` | conditional | MapPin | conditional | **N** + **F** in one component |
| B12 | `client/src/pages/offers.tsx:403-409` | `"No offer letters"` | `"Generate batch offers using the calculator or create individual offers."` | Mail | "Open calculator" | **N** |
| B13 | `offers.tsx:828-836` | `"No templates yet"` | `"Create your first offer letter template to get started."` | FileText | "Create template" | **N** |
| B14 | `client/src/pages/offer-batches.tsx:84-88` | `"No offer batches yet"` | `"Create batches via POST /api/offers/batch with a pricing matrix and a parcel list. A guided create-batch dialog is on the roadmap — for now, the server-side flow is the quickest path."` | Layers | none | **N** (this description leaks dev-talk; see §5) |
| B15 | `client/src/pages/leads-dedupe.tsx:160-164` | `"No duplicates found"` | `"Your lead list is clean — no matching phone, email, or name+address clusters detected."` | CheckCircle2 | none | **C** (good copy — preserve voice) |
| B16 | `client/src/pages/my-letter.tsx:177-184` | `"No letter yet"` | `"Your first monthly letter will be generated on the 1st of next month. You can also generate one now from your current business state."` | FileText | "Generate now" | **N** |
| B17 | `client/src/pages/founder-letter.tsx:184-190` | `"Couldn't load the letter"` | `"Your previous letter (if any) is still saved. Try generating a fresh one or come back in a moment."` | FileText | "Retry" | **E** |
| B18 | `founder-letter.tsx:192-198` | `"No letter yet"` | `"The first letter will be generated on the 1st of next month. You can also generate one on demand from the current data."` | FileText | "Generate now" | **N** |
| B19 | `client/src/pages/founder-todo.tsx:232-236` | `"Inbox zero"` | `"Nothing is waiting on you right now. The system is running itself. Check System trends in the sidebar to see how quality is trending."` | CheckCircle2 | none | **C** (best in app — keep) |
| B20 | `client/src/pages/founder-home.tsx:434` | `"No agents configured"` | `"Autonomous agents will appear here once set up."` | Bot | none | **N** |
| B21 | `client/src/pages/founder-strategy.tsx:199-203` | `"No weekly proposals"` | `"Weekly proposals fire Sundays at 00:00 UTC. Run one now from the button above to seed the queue."` | Lightbulb | none | **N** |
| B22 | `client/src/pages/founder-trends.tsx:143-147` | `"No trust-evolution data yet"` | `"Per-agent trust scores evolve on the monthly cadence. Come back after the first trust-evolution cron run."` | Activity | none | **N** |
| B23 | `client/src/pages/founder-tools.tsx:135-139` | `"No proposals yet"` | `"The strategic synthesis will surface capability gaps automatically when it detects recurring 'I couldn't act because I lack X' signals. You can also manually seed proposals from the agent chat."` | Wrench | none | **N** |
| B24 | `client/src/pages/founder-preview.tsx:153-157` | `"No recent autonomous actions"` | `"Actions will appear here once the executor processes its first decisions."` | Eye | none | **N** |
| B25 | `client/src/pages/founder-experiments.tsx:165-169` | `"No experiments yet"` | `"Create your first experiment to split a decision playbook across variants. Example: half of past-due customers get 7-day dunning, half get 10-day — which recovers more?"` | FlaskConical | none | **N** |
| B26 | `client/src/pages/founder-onboarding.tsx:172-176` | `"No journeys in progress"` | `"Journeys start automatically when a new Land Investor org signs up."` | Rocket | none | **N** |
| B27 | `client/src/pages/founder-providers.tsx:75-79` | `"No provider lookups yet"` | `"Once customers start enriching parcels and properties, provider telemetry will populate here."` | Database | none | **N** |
| B28 | `client/src/pages/founder-prompt-evolutions.tsx:145-149` | `"No pending proposals"` | `"The meta-agent runs on the 1st of each month. You can also run it on demand from the button above."` | Brain | none | **N** |
| B29 | `client/src/pages/founder-prompt-history.tsx:138-142` | `"No agents with history yet"` | `"Once the meta-agent ships its first prompt change, versions will start accumulating here."` | GitBranch | none | **N** |
| B30 | `founder-prompt-history.tsx:144-148` | `"No versions recorded for ${selectedAgent}"` | `"Either this agent hasn't had a prompt change yet, or its history predates version control."` | History | none | **N** |
| B31 | `client/src/pages/founder-traces.tsx:119-127` | `"No traces yet"` | conditional by `agentFilter` | FileCode | none | **N** + **F** mixed |
| B32 | `client/src/pages/founder-expansion.tsx:142-146` | `"No candidates this week"` | `"The radar runs Mondays 08:00 UTC. Run now to scan immediately."` | TrendingUp | none | **C** |
| B33 | `client/src/pages/leads-dedupe.tsx:160` | (covered above B15) | | | | |
| B34 | `client/src/pages/executive-dashboard.tsx:185-189` | `"No metrics available"` | `"Metrics will appear once the platform has active organizations."` | BarChart3 | none | **N** |
| B35 | `client/src/components/cohort-retention-dashboard.tsx:139-143` | `"No cohort data yet"` | `"Cohort retention data will appear here once you have leads created over multiple weeks."` | BarChart3 | none | **N** |
| B36 | `client/src/components/activity-timeline.tsx:291-295` | `"No activity yet"` | `"Phone calls, emails, status changes, and notes will appear here as interactions are logged."` | Clock | none | **N** |
| B37 | `client/src/components/entity-portfolio-view.tsx:293-297` | `"No entity portfolio data"` | `"Properties with status 'owned' will appear here, grouped by their owning entity."` | Building2 | none | **N** |

### C. Tier-3 (ad-hoc inline `<p>No X yet</p>` — punishment-grade)

These are the offenders. No icon, no action, no warmth — just a paragraph that tells the user the absence of their data.

| # | File:line | Verbatim | Notes |
|---|---|---|---|
| C1 | `client/src/pages/portfolio.tsx:420-421` | `"No active alerts"` / `"Your portfolio is looking healthy. Run a scan to check for new issues."` | Has icon (CheckCircle), warm copy — acceptable C-tier; could be promoted to EmptyState |
| C2 | `portfolio.tsx:584` | `"No compliance rules configured yet."` | Bare `<p>` |
| C3 | `portfolio.tsx:637` | `"No notes to display."` | Bare `<p>`, **dead** |
| C4 | `client/src/pages/inbox.tsx:791-792` | `"No messages yet"` / `"Send a message to start the conversation."` | Has icon, OK; SMS detail pane |
| C5 | `client/src/pages/properties.tsx:467-470` | `"No parcels yet."` / `"Add one to start tracking."` | In greeting hero — OK shape |
| C6 | `client/src/pages/today.tsx:1229` | `"You're all caught up! No AI-suggested actions right now."` | Has CheckCircle, **C-occasion** — good |
| C7 | `client/src/pages/goals.tsx:224-225` | `"No goals yet."` / `"Set revenue targets, deal counts, and other KPIs to track your progress."` | Has icon + CTA — could be EmptyState |
| C8 | `client/src/pages/workflows.tsx:347` | `"No workflows yet"` | Has icon + CTA |
| C9 | `client/src/pages/settings.tsx:1502` | `"No team members found."` | Bare `<p>` |
| C10 | `settings.tsx:2356` | `"No goals yet"` | Bare `<p>` |
| C11 | `settings.tsx:2649` | `"No API keys yet. Create one above to get started."` | Bare `<p>` |
| C12 | `settings.tsx:2789` | `"No activity recorded yet."` | Bare `<p>` |
| C13 | `client/src/pages/team-inbox.tsx:435` | `"No messages yet. Start the conversation!"` | Anti-pattern: **theatrics in copy** ("!"). §13 violation |
| C14 | `client/src/pages/voice-analytics.tsx:480` | `"No results found for "${searchQuery}"."` | **F-occasion** — bare `<p>`, no clear-filter affordance |
| C15 | `client/src/pages/buyer-network.tsx:26` | `"No property matches yet. Add listings to see matched buyers."` | Bare `<p>` |
| C16 | `buyer-network.tsx:437` | `"No buyers found."` | Bare `<p>` |
| C17 | `client/src/pages/board-of-directors.tsx:329` | `"No trust enforcement events recorded yet."` | Bare `<p>` |
| C18 | `client/src/pages/buyer-qualification.tsx:275` | `"No qualified buyers yet."` | Bare `<p>` |
| C19 | `client/src/pages/marketplace.tsx:378` | `"No bids yet on this listing."` | Bare `<p>` |
| C20 | `marketplace.tsx:988` | `"No listings yet"` | Bare `<p>` |
| C21 | `marketplace.tsx:1072` | `"No bids placed yet"` | Bare `<p>` |
| C22 | `client/src/pages/cash-flow.tsx:317` | `"No forecast data yet."` | Bare `<p>` |
| C23 | `client/src/pages/portfolio-optimizer.tsx:440` | `"No portfolio holdings found"` | Bare `<p>` |
| C24 | `client/src/pages/land-credit.tsx:666` | `"No portfolio data yet"` | Bare `<p>` |
| C25 | `client/src/pages/freedom-meter.tsx:556` | `"No active notes yet."` | Bare `<p>` |
| C26 | `client/src/pages/syndication.tsx:135` | `"No properties found."` | Bare `<p>` |
| C27 | `client/src/pages/conscious-organization.tsx:608` | `"No events yet. Start the nervous-system heartbeat to see activity."` | "Nervous-system heartbeat" reads as internal jargon |
| C28 | `client/src/pages/voice-analytics.tsx:348,386` | `"No outcome data yet. Tag calls with outcomes."` / `"No completed calls yet."` | Bare `<p>` |
| C29 | `client/src/pages/seller-intent.tsx:288` | `"No seller intent data yet. Run an analysis on individual leads above."` | Bare `<p>` |
| C30 | `client/src/pages/agent-performance.tsx:125,195,239` | three flavours of `"No X yet"` | Bare `<p>` ×3 |
| C31 | `client/src/pages/cash-flow.tsx:670` | `"No historical comparison data available yet."` | Bare `<p>` |
| C32 | `client/src/pages/founder-dashboard.tsx:747,982,2866,3308,3554,3684,3782,4172,5889` | nine `"No X yet"` strings | Bare `<p>` ×9. Founder surface, but still |
| C33 | `client/src/pages/sovereign-dashboard.tsx:230,355` | `"No agent runtime data available yet…"` / `"No job health logs available yet."` | Bare `<p>` |
| C34 | `client/src/pages/marketplace.tsx:378` (dup) | | |
| C35 | `client/src/pages/data-moat-dashboard.tsx:341` | `"No API keys issued yet."` | Bare `<p>` |
| C36 | `client/src/pages/vision-ai.tsx:360` | `"No analyzed photos yet. Click "Analyze photos" to start."` | Bare `<p>` (and uses straight quotes inside copy) |
| C37 | `client/src/pages/command-center.tsx:820,1911` | `"No activity recorded yet."` / `"No conversations yet"` | Bare `<p>` |
| C38 | `client/src/pages/leads.tsx:1505-1507, 1661-1663` | `"No leads found matching your search or filter."` | **F-occasion** — bare `<p>`, no Reset-Filters CTA (compare B2 properties.tsx, which gets this right) |

---

## 3. Severity ranking — punishment vs invitation

### Actively punishing (rewrite immediately)
1. **Persona leak in customer-facing TasksEmptyState** (A4 / `empty-states.tsx:128`) — `"Atlas AI suggests follow-up tasks automatically"`. Atlas is the founder-mode codename per memory. Customer must never see it. Vesna flagged this; I escalate it to **P0**.
2. **inbox.tsx:1015** `"No messages"` / `"Your inbox is empty."` — restating the title is the canonical anti-pattern. Apple Mail has shipped better empty copy since Mavericks.
3. **leads.tsx:1505-1507 + 1661-1663** — filter-empty has no Reset-Filters CTA, so user is stranded. Properties got this right; Leads is inconsistent within the same product.
4. **offer-batches.tsx:84-88** — `"Create batches via POST /api/offers/batch with a pricing matrix and a parcel list. A guided create-batch dialog is on the roadmap — for now, the server-side flow is the quickest path."` This is Slack-channel apology, not product copy. Customer should never see "POST /api/...".
5. **team-inbox.tsx:435** `"No messages yet. Start the conversation!"` — exclamation point violates §13 anti-theatrics.
6. **conscious-organization.tsx:608** `"No events yet. Start the nervous-system heartbeat to see activity."` — internal jargon ("nervous-system heartbeat") leaked to UI.
7. **vision-ai.tsx:360** uses straight quotes inside the string (`Click "Analyze photos"`), breaking typography in a long-tail surface that also lacks an actual CTA.
8. **The 30+ `<p>No X yet.</p>` instances** (C2, C3, C9–C12, C14–C38) — these are the punishment-grade. No icon, no action, no warmth. Treat as a microcopy debt sweep.

### Gently inviting (keep, codify, expand)
- **B19 `founder-todo.tsx:232` "Inbox zero"** — best empty state in the app. "Inbox zero" is itself a punchline that earns the smile without confetti.
- **B15 `leads-dedupe.tsx:160` "No duplicates found"** — `"Your lead list is clean — no matching phone, email, or name+address clusters detected."` That's a *cleared* state told as a small win, not a void.
- **inbox.tsx:1046** greeting hero `"All caught up. Nothing waiting."` — calm, declarative. Apple Mail-tier.
- **A1–A7 (the seven branded variants in `empty-states.tsx`)** — icon + title + description + 3 tips + CTA is the right shape. The pattern is correct; only A4 has a copy bug.

### Acceptable but inconsistent
- B5 `finance.tsx:361` is a duplicate of A6 with strictly worse copy — should call `<FinanceEmptyState />` instead.
- The C-tier ad-hoc inline strings on `founder-dashboard.tsx` (C32, nine of them) are founder-surface and lower-priority but still drag the average.

---

## 4. The three empty-state archetypes AcreOS needs

The component supports all three already — what's missing is the *naming* and *occasion-awareness*. AcreOS conflates them.

### Archetype 1: **The First Hello** (occasion: brand-new user, never had data)

**Voice:** invitational. Promise the next step. Never apologetic. The user just signed up — this is the moment they decide if AcreOS is for them.

**Shape:** branded icon + warm title + 1-sentence "what fills this when you do X" + tips (3) + primary CTA.

**Copy pattern:**
- Title: `"<Noun-plural> live here"` or `"Your first <noun>"` (avoid "No X yet" framing — that's negation; the First Hello is positive)
- Description: `"<verb-imperative> your first <noun> to <outcome>. <Tool> <does its part>."`
- Tips: 3 different ways in (CSV, manual, AI) — multiple paths reduces choice paralysis
- CTA: explicit verb + noun (`"Add a Lead"`, never `"Get started"`)

**Examples to ship:**
> "Your leads live here." / "Import a CSV, add one by hand, or let the Deal Hunter find them. We score and prioritize every lead automatically — your first one is the only manual step."
>
> "No deals yet — let's change that." / "Deals are where leads become money. Connect a lead to a property, set the price, and watch it move through your pipeline."

### Archetype 2: **The Cleared Decks** (occasion: user did the work, list is now empty *because* they archived/completed/dismissed)

**Voice:** quiet acknowledgement. The user *earned* this empty state. Don't push them back to work.

**Shape:** softer icon (CheckCircle2 not Plus), title that names the achievement, description that orients without instructing, **no primary CTA** (or, at most, a navigational link to where the work went).

**Copy pattern:**
- Title: `"<Achievement-noun>"` (`"Inbox zero"`, `"All caught up"`, `"Nothing flagged today"`)
- Description: `"<Statement of next time something might appear>. <Optional: where the old items went>."`
- No CTA, or: secondary link `"View archived"` / `"View completed"`

**Examples to ship:**
> "All caught up." / "New emails and SMS will show up here as they arrive. Archived messages are saved in <link>Archived</link>."
>
> "Nothing flagged today." / "We'll surface deals here when they need attention — usually 1–2 a week."

This is what AcreOS does best in `founder-todo.tsx:232` "Inbox zero" — replicate that voice everywhere.

### Archetype 3: **The Empty Filter** (occasion: there *is* data, but the current filter / search / tab view returns nothing)

**Voice:** corrective. The user has data — they just can't see it right now. The single most important affordance is **getting them back to data**.

**Shape:** different icon (FilterIcon, Search, Funnel — *not* the same Users/Map noun-icons used by Archetype 1), title that names the *filter*, description that quantifies what's hidden, primary CTA = **Reset / Clear / Show all**.

**Copy pattern:**
- Title: `"No <noun> match these filters"` or `"No results for "${query}""`
- Description: `"<N> <noun> hidden by your current filters. <Reset prompt>."`
- CTA: `"Reset filters"` / `"Clear search"` / `"Show all <noun>"`

**Example to ship (already done — `properties.tsx:703`):**
> "No properties match these filters." / "237 properties are hidden by your current filters. Reset to see them again." / [Reset filters]

This is the **most-broken occasion across AcreOS**. Of the 35 ad-hoc empty states, ~10 are filter occasions handled with the new-user copy. `leads.tsx:1505-1507` is the canonical bug — should be a Filter archetype, ships as a generic line.

---

## 5. Fifteen rewrites — before → after

Each is a single-pass rewrite. No new components needed. Voice rules: contractions, "yet" implies future, name the noun, never restate the title.

| # | File:line | Before | After |
|---|---|---|---|
| R1 | `empty-states.tsx:128` (A4 tip) | `"Atlas AI suggests follow-up tasks automatically"` | `"AcreOS suggests follow-up tasks automatically as deals progress"` |
| R2 | `inbox.tsx:1015` | `"No messages"` / `"Your inbox is empty."` | `"You're all caught up"` / `"New emails and SMS will appear here as they arrive."` |
| R3 | `inbox.tsx:1011` | `"No starred messages"` / `"Star messages to find them quickly."` | `"Nothing starred yet"` / `"Tap the star on a message to keep it close. Starred items stay across email and SMS."` |
| R4 | `inbox.tsx:1005` | `"No SMS conversations"` / `"SMS conversations will appear here."` | `"No SMS yet"` / `"Reply to a lead by text and the conversation will land here."` |
| R5 | `inbox.tsx:1013` | `"No archived messages"` / `"Archived messages will appear here."` | `"Nothing archived"` / `"Messages you archive show up here. Nothing is ever deleted."` |
| R6 | `leads.tsx:1505-1507` (and `:1661-1663`) | `"No leads found matching your search or filter."` (bare `<p>`) | Replace with `<EmptyState icon={FilterIcon} title="No leads match these filters" description="${leads.length} leads are hidden by your current view. Reset to see them again." actionLabel="Reset filters" actionIcon={null} onAction={resetFilters} />` |
| R7 | `offer-batches.tsx:84-88` | `"Create batches via POST /api/offers/batch with a pricing matrix and a parcel list. A guided create-batch dialog is on the roadmap…"` | `"Your first batch starts here"` / `"Batch offers send the same pricing template to every parcel in a list — perfect for testing a county. We're finishing the dialog now; for the next release you'll create batches in one click."` (and gate with feature flag, don't reference HTTP) |
| R8 | `team-inbox.tsx:435` | `"No messages yet. Start the conversation!"` | `"No team messages yet"` / `"Notes you tag for a teammate show up here. Start one with `@name` in any deal note."` |
| R9 | `conscious-organization.tsx:608` | `"No events yet. Start the nervous-system heartbeat to see activity."` | `"No events recorded yet"` / `"Events appear here once the system is running. Start with the controls above."` (drop "nervous-system heartbeat" — internal codename) |
| R10 | `voice-analytics.tsx:480` | `"No results found for "${searchQuery}"."` | `<EmptyState icon={Search} title={`No calls match "${searchQuery}"`} description="Try a different keyword, or clear the search to see all calls." actionLabel="Clear search" actionIcon={null} onAction={() => setSearchQuery("")} />` |
| R11 | `goals.tsx:224-225` | `"No goals yet."` / `"Set revenue targets, deal counts, and other KPIs to track your progress."` | Convert to `<EmptyState icon={Target} title="Set your first goal" description="Goals turn the dashboard from numbers into progress. Try a 90-day deal count or a quarterly revenue target — you can change them later." actionLabel="Create your first goal" onAction={openCreate} />` |
| R12 | `today.tsx:606-636` getting-started block | `"Ready to find your first deal?"` / `"Your AcreOS workspace is set up. Follow these steps to start evaluating parcels and closing deals."` | Keep title, swap description: `"Two ways in. Add a parcel you're already tracking, or import a county lead list — most users start with the import. We'll guide you from there."` (better: name the easier path first) |
| R13 | `properties.tsx:467-470` (greeting empty) | `"No parcels yet."` / `"Add one to start tracking."` | `"Your first parcel"` / `"Drop a CSV, add an address, or paste a parcel ID. We auto-value every parcel with comps."` |
| R14 | `inbox.tsx:791-792` (SMS detail pane) | `"No messages yet"` / `"Send a message to start the conversation."` | `"No messages with this lead yet"` / `"Send the first SMS — the lead's reply will land back here."` |
| R15 | `vision-ai.tsx:360` | `"No analyzed photos yet. Click "Analyze photos" to start."` | `"No photos analyzed yet"` / `"Pick a property and run a photo analysis — Pax extracts road access, terrain, and structures from satellite and street view."` (use Pax noun per persona memory; fix straight quotes) |

---

## 6. Per-page recommended empty state — 12 daily customer surfaces

Each row is the *primary* empty state a customer sees on their first visit, plus the cleared-decks state when they later get to zero.

| # | Surface | First Hello (N) | Cleared (C) | Filtered (F) |
|---|---|---|---|---|
| 1 | `/today` | Hero greeting + "Ready to find your first deal?" card (`today.tsx:606-636`); rewrite per R12 | `"Quiet today. Use ⌘K to add a lead."` (currently the page silently restructures — Vesna P1-6) | n/a |
| 2 | `/pipeline` board | `<PipelineEmptyState />` (A7); also surface board-stage empty per stage | `"All deals closed this week."` (new — currently nothing) | per-stage filter: standard Filter archetype |
| 3 | `/properties` | `<PropertiesEmptyState />` (A2) | n/a (properties don't generally hit zero after first non-zero) | `properties.tsx:703-715` — already correct (B2) |
| 4 | `/deals` | `<DealsEmptyState />` (A3) — keep | `"No deals in flight. Move a lead to Negotiation to start one."` | needed: tab-based deal-stage filter empty |
| 5 | `/leads` | `<LeadsEmptyState />` (A1) — keep | `"All leads contacted. Add more to keep the pipeline full."` | **R6** — currently wrong |
| 6 | `/money` (finance) | `<FinanceEmptyState />` — finance.tsx:361 should call this, not duplicate it | `"All notes paid current."` | need filter-empty for delinquent/active toggle |
| 7 | `/finance` | (same as `/money`) | | |
| 8 | `/portfolio` | Promote portfolio.tsx:420-421 to full `EmptyState`; add a *new-user* state when summary is zero (Vesna P1 §5) | C1 already correct as cleared-alerts state | need filter on alert severity |
| 9 | `/pax` | New: `"Pax is ready"` / `"Ask anything about your business — Pax learns as you go."` (currently page hides resting state, per Vesna §5) | n/a — Pax is a chat surface | n/a |
| 10 | `/inbox` | R2/R3/R4/R5 above; treat each tab as a different occasion | Tab "All" with zero = cleared archetype; current copy `inbox.tsx:1009` is correct | need search-empty (currently no handling) |
| 11 | `/today` Getting-Started | `today.tsx:606-636` — keep card shape, rewrite R12 | n/a | n/a |
| 12 | `/parcel-detail/:id` | `parcel-detail.tsx:118-127` — already correct as not-found state | n/a — detail surface | n/a |

The single biggest gap across these 12: **occasion-awareness**. `/inbox`, `/leads`, `/deals`, and `/money` all present the same component to a brand-new user and a user-just-cleared-everything user. Different humans, different copy.

---

## 7. The one empty state worth investing extra design love

**`/today` for the user who just signed up — the literal first 30 seconds.**

This is the only empty state where the brand identity is at stake. Everything else is a tab in a workflow; `/today` is the first surface a Land Investor sees post-onboarding. Today it shows:

1. The "Ready to find your first deal?" gradient card (`today.tsx:606-636`)
2. The editorial greeting `"Good morning, ${firstName}. Here's what's on the horizon."` (`today.tsx:646-657`)
3. Three blank metric cards (Active Leads, Properties, Deals — all zero)
4. The `GettingStartedChecklist` component
5. The "You're all caught up! No AI-suggested actions right now." card (`today.tsx:1229`) — which is *wrong* for a brand-new user: they aren't caught up, they haven't started

This composition tells four different stories simultaneously: "let's begin," "good morning," "you have nothing," and "you're caught up." A first-time user reading top-to-bottom gets vertigo.

**The "I get it" moment design:**

For a user with zero leads, zero properties, zero deals, zero decisions:
- **Hide the metric cards entirely** (or show them with explanatory placeholders, not `0`)
- **Hide the "all caught up" line** (line 1229 should gate on `hasEverHadData`, not just current count)
- **Replace the greeting suffix** `"Here's what's on the horizon"` with `"Let's start with one parcel — most Land Investors begin with their home county."`
- **Promote the Getting-Started card** to full hero treatment with the wordmark and a single primary CTA: "Import county tax-delinquent list" (the highest-conversion first action per Mark's land-investor playbook)
- **Add a one-line founder note** beneath: `"You can ignore everything else on this page until you've added 100 leads. — Thomas"` — first-impression personality, signed.

That last touch is what Things 3 does on first launch ("Welcome to Things") and what Apple Mail does on a fresh inbox ("No mail. Mail will appear here when it arrives."). The tone says: *we know this moment matters, we wrote you a sentence on purpose, this isn't a placeholder a junior dev banged out.*

Investment: ~6 hours of design + copy + one new `<FirstDayHero />` component. Returns: every customer's first impression of AcreOS — the most expensive screen in the product.

---

## §13 anti-pattern check

I found **one** §13 violation in copy: `team-inbox.tsx:435` `"Start the conversation!"` — exclamation point. R8 rewrites it. No 🎉 emojis, no confetti animation hooks, no "Most Intelligent" claims surfaced in the audit. The brand's restraint is intact in copy; the gap is in *coverage* (35 surfaces still ad-hoc), not in tone (zero theatrics found). Protect this; it's rare.

---

*Tomás Reyes · 2026-05-01 · 6 years on Apple Mail empty states + 4 on Things 3 first-launch · the empty state is where the brand shows up first*
