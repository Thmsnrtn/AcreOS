# Anya Berenson — The ⌘K Spotlight Audit
**AcreOS, 2026-05-01.** Spotlight lens: keystroke distance, fuzzy retrieval, action verbs, scope filters, the "Pax is Spotlight" question. Wave 2 follow-on to Holm (IA) and Vesna (polish).

---

## 1 · One-line verdict

**⌘K is currently a launcher with three side-jobs (search, mutate, ask AI) and no boss; promote it to be the boss — Pax becomes a verb that lives inside ⌘K, not a destination next to it.**

---

## 2 · Current ⌘K inventory — what it actually does today

I read every line of `client/src/components/command-palette.tsx` (815 lines) plus the two siblings (`founder-command-palette.tsx`, `pax-command-palette.tsx`). Three palettes coexist under one keystroke convention. Here's the inventory.

### 2.1 The customer palette (`command-palette.tsx`, ⌘K)

Mounted lazily in `App.tsx:37,1030` for every authenticated user. Listens on `window` keydown for ⌘K / Ctrl+K (line 281), plus a custom `acreos:open-command-palette` event (line 318) so the topbar Search button (`page-topbar.tsx:142`) and sidebar collapsed-rail Search affordance (`layout-sidebar.tsx:779,816,1189`) can open it without the keystroke.

**What it contains, in render order:**

| Section | Source | Item count | Notes |
|---|---|---|---|
| AI-mode hint banner | line 471 | 1 | "Start with ? or ask a question for AI assistance" |
| AI response panel | line 478 | conditional | `POST /api/realtime/ask`, returns `{reply, actionPath, actionLabel}` |
| Lead status sub-menu | line 513 | 5 statuses | Drill-down: pick lead → pick new status → mutates `PUT /api/leads/:id` |
| Deal stage sub-menu | line 543 | 6 stages | Same shape for `PUT /api/deals/:id` |
| Search results (fallthrough) | line 577 | up to 8 | Matches across leads (name, email), properties (county, state, APN), deals (id only — weak) |
| Lead quick-actions | line 602 | up to 5 | Opens the status sub-menu |
| Deal quick-actions | line 628 | up to 5 | Opens the stage sub-menu |
| Founder/admin (founder-only) | line 655 | 3 | Founder dashboard, system health, credits |
| Pages | line 687 | **24** hardcoded | The big one |
| Quick actions | line 707 | 6 | new-lead / new-property / new-deal / new-task / send-email / generate-offer |
| "Ask your team" (founder-only) | line 731 | 4 | Forge / Sophie / Sentinel / "All agents" — codename leak that's gated correctly |
| Recent | line 771 | up to 5 | `GET /api/recent-items`, mixes leads/properties/deals |

**The 24 hardcoded pages** (line 147–172): Dashboard, Leads, Properties, Deals, Finance, Marketing, Acquisition Radar, Land Credit Score, Portfolio Optimizer, AVM, Negotiation Copilot, Cash Flow Forecaster, Deal Hunter, Vision AI, Capital Markets, Market Intelligence, Compliance AI, Tax Researcher, Document Intelligence, Property Map, Marketplace, Academy, AI Hub, Settings.

That is **24 routes out of 166**. Curated, but curated by accretion, not principle. Land Credit Score is in; Inbox is not. Vision AI is in; Pax is not (the "AI Hub" entry routes to `/ai`, which Holm flags for deletion). The ⌘1–⌘9 shortcut hint on the first nine items (line 698) implies a top-of-mind ranking that nobody validated.

### 2.2 The fuzziness story

`Command` from `cmdk` does the filtering when `shouldFilter={!showAIMode}` (line 435). cmdk's matcher is decent — it's substring + token, case-insensitive — but **it does not do typo tolerance**. Type "leds" instead of "leads" and the page entry vanishes. Spotlight matches "leds" → "Leads" because Apple's matcher is bigram + substring + acronym; cmdk is roughly substring only.

The record search (lines 581–589) is **literal `.includes()` over the in-memory list** of every lead, every property, every deal the org has loaded. For a workspace with 50k leads, this is O(n) on every keystroke and there is no debounce. Today nobody has 50k leads in AcreOS. By Q3 someone will. This is a latent perf bug, not a current one.

### 2.3 The other two palettes

**`FounderCommandPaletteProvider` (`founder-command-palette.tsx`).** Bound to ⌘⇧K (Cmd+Shift+K, line 98–100 of that file). Searches a different namespace via a single `GET /api/founder/search?q=…` endpoint that returns five groups: decisions, agents, organizations, founder letters, strategic proposals. Founder-only. **Two ⌘K's exist** — one for operators, one for the founder — distinguished by Shift. Acceptable; founder-mode is a separate world.

**`pax-command-palette.tsx`.** Despite the name, this is **not bound to ⌘K**. It's a slash-command catalog (`/briefing`, `/stale-leads`, `/pipeline`, `/roi`, `/comps`, `/email`, `/offer`, `/analyze`, `/cashflow`, …) consumed by the Pax conversation surface. The file is misnamed for IA — it's a *prompt picker*, not a palette. Worth renaming to avoid the confusion that this file produces in every grep.

### 2.4 Discoverability of ⌘K today

The user discovers ⌘K through:
1. **Topbar Search button** (`page-topbar.tsx:142–151`) — visible on every desktop page, shows the ⌘K kbd hint at `lg` breakpoint and up. Mobile users never see this.
2. **Sidebar collapsed-rail Search icon** (`layout-sidebar.tsx:779`) — only visible when sidebar is collapsed.
3. **Sidebar expanded "Search" item with ⌘K kbd** (`layout-sidebar.tsx:790`).
4. **First-run toast** (`App.tsx:991–998`) — fires once, but **only in `import.meta.env.DEV`**. Production users never see it.
5. **Mobile FAB** (`App.tsx:1019`) — but the FAB doesn't open ⌘K, it opens a different new-item menu.
6. **No keyboard cheatsheet trigger.** Vesna P2-14 already flagged this: a "?" keypress should open `KeyboardShortcutsModal` and currently doesn't.

**Net:** desktop users discover ⌘K incidentally via the topbar. Mobile users do not discover ⌘K at all (the kbd hint is hidden below `lg`, and there's no equivalent gesture). New customers receive zero hint in production. **The single most powerful surface in the app is the least discoverable for net-new users.**

---

## 3 · Spotlight-grade target — the recipe

What "Spotlight-grade" actually means, broken into checkpoints AcreOS can verify against:

### 3.1 Keystroke economics

- **Every reachable surface ≤ 4 keystrokes from anywhere.** ⌘K opens the palette (1); 2–3 letters narrow to one match (2–3); Enter (4). Spotlight's discipline is that the ranking lands you on the right answer in those 2–3 letters, not the lookup.
- **No "Open" verb required.** Type the noun, press Enter. AcreOS already does this for Pages; extend to records.
- **Shift+Enter opens in a side panel / new tab.** Today, Enter always navigates. Spotlight has "open" vs "open in" — AcreOS should have "navigate" vs "preview in drawer" so power users don't lose context.

### 3.2 Matcher quality

- **Bigram + acronym + substring**, not just substring. "lc" → "Land Credit Score" (acronym). "prtflo" → "Portfolio" (typo-tolerant bigram). Today neither works.
- **Recency-weighted scoring.** A Page used yesterday outranks a Page used six months ago. Today the order is hardcoded (line 147).
- **Frequency-weighted within a session.** If you've opened "Leads" three times today, it should be first.
- **Server-side fuzzy search for records when the org has > 500 of any type.** Currently `.filter(...).includes(...)` on the client (line 581). Move to `GET /api/search?q=…&scope=leads,deals,parcels&limit=8` with PG `pg_trgm` similarity behind it.

### 3.3 Scope filters (the `in:` and `is:` syntax)

- `in:leads bob` → only leads named bob.
- `in:parcels harris county` → only parcels in Harris.
- `is:overdue` → tasks past due. `is:hot` → hot leads. `is:stuck` → deals not moving.
- `from:bob.smith` → emails from this contact.
- `>$50k` → financial filter.
- These are **opt-in shortcuts for power users** — typing without them must Just Work. The IA principle: scope syntax is the escape hatch for ambiguity, not the primary path.

### 3.4 Verbs as first-class items

Today there are 6 quick actions (line 174). Spotlight-grade is closer to **30 verbs** that match on keyword:

- **"new lead"**, "add lead", "create lead" → all collapse to one verb.
- **"draft email to {contact}"** → typing the contact name directly inside the verb arms it; Enter sends it to the email composer with the recipient pre-filled.
- **"call {contact}"** → triggers the click-to-call surface with that lead loaded.
- **"send offer on {parcel}"** → opens blind offer wizard with the parcel pre-selected.
- **"run AVM on {parcel}"**, **"pull title on {parcel}"**, **"check zoning on {parcel}"** — these are Holm's research-tools-as-actions. They die from the sidebar (Holm §4) and are reborn here.
- **"mark {lead} hot"**, **"move {deal} to closed"** — already supported via the sub-menu drilldown (line 513), but the user must type the lead name first, click in, then pick. A Spotlight-grade version is one continuous string: typing "mark bob hot" matches the verb + arg in one go.

### 3.5 Recent items, properly

Today: 5 recent items (2 leads + 2 properties + 1 deal, hardcoded slice). Spotlight-grade:
- **15 recents**, ranked by recency × frequency × current-context.
- **"Current context" weighting** — if you're on `/parcels/12345` and you open ⌘K, that parcel's recent neighbors (the lead who owns it, the deal it's in, the campaign that touched it) rank above unrelated items.
- **Empty-state recents.** A new user has none. Default to "Suggested" — the org's hottest 5 leads, the 3 newest parcels, the 1 active deal. Never show an empty Recent group.

### 3.6 Keyboard-only navigability

This is mostly already correct:
- ↑ / ↓ navigate (line 803)
- Enter opens (line 804)
- Esc closes / pops up one level (line 290–301) — good handling of the sub-menu pop
- ⌘1–⌘9 jump to top 9 pages (line 698)

What's missing:
- **Tab to switch between groups.** Today, ↓ marches through every item including across sections. Spotlight's "tab to switch category" is faster on dense lists.
- **⌘ + letter for actions.** "⌘N" for new (anything), "⌘E" for email, "⌘D" for deal. Today there are zero per-verb chord shortcuts (the file's own header comment, line 32, acknowledges this gap).
- **Right-arrow to drill into a record's actions** (today this requires a click on the row to open the sub-menu). Right-arrow should work because cmdk supports it.

---

## 4 · Pax-in-⌘K design — the worked example

Holm's claim: "Pax is Spotlight." I agree, with one structural caveat. Here is the concrete worked example.

### 4.1 The user types: `draft a follow-up to Bob`

**What ⌘K shows, top to bottom, after the user finishes typing:**

```
> draft a follow-up to Bob

✦ Pax — Draft a follow-up email to Bob Henderson         [Enter]
  "Hi Bob, just circling back on the 40 acres in Harris..."
  └─ Recipient: Bob Henderson  ·  Last contact: 9 days ago
  └─ Tone: warm  ·  CTA: schedule call
  ✎ Edit before sending     ⏵ Send now      ⌘D Discard

  Did you mean…
  Lead: Bob Henderson (bob.h@…)               → open
  Lead: Bob Marquez (bob.m@…)                 → open
  Lead: Robert Henderson Jr.                  → open
```

**Key design decisions:**

1. **The first row is the action, not a route.** Typing "draft a follow-up" is a verb. Spotlight's gravity is verbs, not destinations.
2. **Pax executes inline, not by routing.** The draft renders *inside the palette*, not by navigating to `/pax`. The palette grows to accommodate ~6 lines of preview. Hitting Enter sends; ⌘E edits in a drawer; Esc discards.
3. **Disambiguation lives below**, not as a blocker. Pax picks the most-recently-touched Bob and shows the rest as "did you mean." If it's wrong, the user clicks the right Bob and the draft re-renders.
4. **The route to `/pax` is gone.** There is no need to "go to the AI page" — the AI is at the keystroke. `/pax` becomes a *log* (see §7), not a place you compose.

### 4.2 Other Pax-in-⌘K examples

- `summarize today` → renders a 3-bullet brief inline. ⌘O opens it as a full page. Enter dismisses.
- `find parcels under $30k in Polk County` → renders a 5-row result list inside the palette. Enter on a row opens the parcel; ⌘O takes the user to the filtered Parcels page with the same query.
- `what's the status of the Henderson deal` → returns one line + a link.
- `move all stale leads to nurture` → renders a confirmation card with a count ("This will affect 47 leads"); Enter executes the bulk mutation; ⌘Z within 10s undoes.

### 4.3 The structural caveat — why ⌘K cannot be Pax's *only* shell

A Spotlight-grade palette is **synchronous, narrow, and lossy**. Pax conversations sometimes need to be:
- Multi-turn (a back-and-forth lasting 10 messages)
- Long-form (a 2-page market analysis)
- Persistent across sessions (the user wants to come back to a thread tomorrow)
- Side-by-side with another surface (a draft email next to the lead's history)

⌘K is the wrong shell for any of those. So Pax has **two surfaces**:
- **⌘K = ask, draft, do** — single-turn, synchronous, action-shaped.
- **PaxCopilotRail = converse, persist, return** — the right-side rail that already exists, repurposed as the *only* multi-turn shell.

Which means: **delete `/pax` as a destination** (Holm's call, agreed), keep the rail (one canonical conversation surface), put ⌘K in front of every single-turn ask. Two shells, zero pages.

---

## 5 · Sidebar items that ⌘K should obviate

Holm lays out the IA refactor; here's the ⌘K view of it. These sidebar entries can leave nav and live in ⌘K only without harming the customer, because the customer reaches them by *intent*, not by *browsing*:

| Sidebar item | Frequency a typical user clicks it | ⌘K replacement | Why it works |
|---|---|---|---|
| AVM | weekly when buying | "run AVM on {parcel}" verb | Always invoked from a parcel context anyway |
| Vision AI | rarely | "analyze photo" / "scan document" verbs | Action, not destination |
| Document Intelligence | rarely | "extract from doc" verb | Same |
| Tax Researcher | rarely | "tax research {county}" verb | Same |
| Title Search | per-deal | "pull title on {parcel}" verb | Always parcel-scoped |
| Zoning | per-deal | "check zoning on {parcel}" verb | Same |
| Property Enrichment | bulk action, weekly | "enrich {parcels}" verb | Same |
| Compliance AI | rarely | "compliance check {state}" verb | Same |
| Market Intelligence | weekly | "what's happening in {market}" verb | Pax-shaped query |
| Market Watchlist | weekly | "show watchlist" + verb to add | List, not surface |
| Counties | reference | "open county {name}" → routes to the page that does need to exist | Lookup verb |
| Land Credit Score | weekly | "credit score for {lead/parcel}" verb | Always entity-scoped |
| Portfolio Optimizer | monthly | "optimize portfolio" verb | Single action |
| Negotiation Copilot | per-deal | "negotiate {deal}" verb | Always deal-scoped |
| Cash Flow Forecaster | weekly | "forecast cash flow" verb | Single action |
| Acquisition Radar | weekly | "show radar" verb | List, not surface |
| Deal Hunter | weekly | "find deals like {parcel}" verb | Lookup |
| Academy | rarely | "how do I {anything}" → help articles in ⌘K | Help merges in |
| Marketplace | rarely | "browse marketplace" verb | One verb, opens the page |

Sidebar after this purge is roughly Holm's 10-door target: **Home, Leads, Parcels, Pipeline, Campaigns, Inbox, Pax-rail, Insights, Finance, Settings.** Everything else is reachable by ⌘K, which is the safety net Holm names in §4 ("⌘K remains the safety net for everything else"). The ⌘K palette becomes ~80 items deep, fuzzy-matched, recency-ranked. Nobody scrolls a palette; they type.

---

## 6 · Discoverability plan — how new users learn ⌘K exists

The current state (§2.4) is a brand bug. Here's the fix, ordered by leverage.

### 6.1 The "everywhere it could matter" principle

⌘K is the IA. If a new customer doesn't internalize it in week 1, the rest of the app feels twice as hard. So treat discoverability as a P0 on equal footing with the palette itself.

| Surface | Today | Proposal |
|---|---|---|
| Topbar Search button | Visible at `lg`+ only | Always visible. On `<lg`, render an icon-only button with a long-press hint. |
| Sidebar | Item exists when expanded | Add a "Search anything…" pill at the top of the sidebar, kbd hint included, even when collapsed. |
| First-run toast | DEV-only (`App.tsx:991`) | Promote to production. Fire once on first authenticated session. Copy: *"Press ⌘K from anywhere to find leads, parcels, or ask Pax."* |
| Onboarding wizard | No step | Add a single step: "Try ⌘K — type a few letters of anything." Detect successful palette open + Enter; advance. |
| Empty states | Some hint | Every empty state with a "create" CTA gets a secondary "or press ⌘K" hint. |
| Help button | Removed (`App.tsx:1021–1023`) | Stays removed — help lives in ⌘K. But the *first time* the user hovers the topbar Search button, render a 1-line tooltip: "Help, search, and Pax — all here." |
| Mobile | ⌘K hidden | Add a long-press on the bottom nav center button → opens the palette. Or a top "Search" bar on every page (Apple's iOS Mail/Notes pattern). |
| Vesna P2-14 | "?" doesn't show shortcuts | Wire global "?" key → KeyboardShortcutsModal with ⌘K front and centered. |

### 6.2 The "one-key training" — a 7-day arc

- **Day 0** (signup): wizard step proves the user can open ⌘K.
- **Day 1** (return): topbar tooltip on hover: "You can search from anywhere with ⌘K."
- **Day 3**: if the user has used ⌘K < 3 times in their session, surface a one-time pulse on the topbar Search button.
- **Day 7**: if ⌘K usage is still < 5/week, an inline tip on `/today`: "Most Land Investors using AcreOS open ⌘K 20+ times a day. Try it next time you need a lead."
- After day 14, no further prompts. Either the habit took or it didn't.

This is **measurable**: telemetry already fires `command_palette` events (line 324). Add `command_palette_first_use_at` to the user record and you have a dashboard.

---

## 7 · Pax-via-⌘K vs `/pax` — what is the page for?

If ⌘K does Pax, what's `/pax` for? Three honest options. Pick one.

**Option A: delete `/pax` entirely.** Holm's recommendation. Pax = ⌘K + rail. The page goes away. ConversationHistory lives in the rail. Insights fold into `/today` cards. Agents fold into `/founder/agents`. **This is correct.**

**Option B: keep `/pax` as a Pax-only inbox** — a log of every Pax action taken, a thread index, a place to scroll back through "what did I ask Pax this week." Not a place to *talk to* Pax. A page-shaped *journal*. Acceptable as a fallback if the rail can't carry persistence.

**Option C: keep `/pax` and lose ⌘K's Pax-mode.** The status quo. Worst of all worlds — two shells with overlapping responsibility, the customer never knows which one to use, and Pax features ship in two places forever (Vesna's P0 risk, Holm's §7 prediction).

**My recommendation: A.** ⌘K for synchronous (ask, draft, do), rail for async (converse, persist, return). The page is unnecessary because **the rail already provides the long-form shell**, and ⌘K already provides the entry point. Two surfaces, both already shipped, neither wasted. The page is the third thing that asked to exist and shouldn't.

If the team can't get to A in this cycle, **B is acceptable as a 90-day waypoint**. Never C.

---

## 8 · The 2-week ⌘K project

Sequenced for a single engineer + designer pair. Every step ships behind a feature flag (`ff.cmdk_v2`) so we can compare against the current palette in canary.

### Week 1 — make ⌘K the spine

**Day 1 — Discoverability bedrock (4h).** Promote first-run toast from DEV to prod (`App.tsx:991`). Make topbar Search visible on mobile. Add `command_palette_first_use_at` telemetry. Wire global "?" → shortcuts modal.

**Day 2 — Server-side search (1 day).** New `GET /api/search?q=&scope=&limit=8` endpoint backed by `pg_trgm` similarity over leads, parcels, deals, contacts. Returns ranked results with score. Replace the in-memory `.filter()` at `command-palette.tsx:581–589`.

**Day 3 — Matcher upgrade (4h).** Replace cmdk's default matcher with a bigram + acronym + substring scorer for the *static* items (pages, verbs). Recency × frequency weighting using a small client-side LRU stored in localStorage. Top 9 ⌘N shortcuts re-rank dynamically.

**Day 4 — Verb expansion (1 day).** Grow quick-actions from 6 to ~30. Each verb declares: keywords, args (entity types it expects), preview (what to render in-line), executor (mutation or route). Codify in a `verbs.ts` registry so adding a verb is one file.

**Day 5 — Sub-menu redesign (1 day).** Replace the lead-status / deal-stage drill-down with inline verbs: "mark {lead} hot" matches in one go, no second selection. Right-arrow on a record row still opens the full action panel for users who prefer browsing. Esc still pops up one level.

### Week 2 — Pax inside ⌘K

**Day 6 — Pax inline preview (1 day).** When the input matches a Pax-shaped intent ("draft", "summarize", "find", "what is", "show me"), render the response *inside the palette* (not on a routed page). Re-use the existing `/api/realtime/ask` endpoint plus a new `actionPreview` field on the response so the palette can show a draft, not just a reply.

**Day 7 — Pax verbs with entity arguments (1 day).** "draft email to {contact}", "send offer on {parcel}", "summarize {deal}" — these need entity resolution before Pax fires. Add a two-stage: (1) parse intent + extract entity name, (2) ⌘K disambiguates entity if multiple matches, (3) Pax executes with confirmed entity. The "Did you mean…" UI from §4.1.

**Day 8 — Scope filters (4h).** Implement `in:leads`, `in:parcels`, `in:deals`, `is:hot`, `is:overdue`, `is:stuck` as query prefixes. Lex client-side; pass scope as a separate field to `/api/search`.

**Day 9 — Delete `/pax`, keep the rail (1 day).** Remove the route. Move ConversationHistory into the rail's history tab. Move Insights into `/today` and parcel detail. Move Agents into `/founder/agents`. Add redirects from `/pax` → `/` for 60 days.

**Day 10 — Polish + ship (4h).** Tab-between-groups navigation. Shift+Enter to open in drawer. Skeleton-shaped loading state for AI replies (Vesna P1-4 spillover). One visual pass. Flip the flag.

### What the user sees on day 11

- ⌘K from anywhere — desktop, mobile, sidebar collapsed or not, with or without keyboard.
- Type a few letters → fuzzy match across pages, leads, parcels, deals, contacts. Top match almost always right.
- Type a verb → action with preview. "draft email to bob" yields a draft, not a route.
- Type a question → Pax answers inline. No page swap.
- Scope filters for power users. Recents that respect context. Verbs for every research tool that used to have a sidebar item.
- The sidebar is 10 doors, the palette is 80 verbs, Pax is a verb that lives in both places that need it. **Everything is one keystroke away.**

---

## 9 · The one ⌘K mistake AcreOS would deeply regret in 6 months

**Building ⌘K v2 *next to* ⌘K v1 instead of replacing it.**

Right now there are already three palettes (customer ⌘K, founder ⌘⇧K, the misnamed `pax-command-palette.tsx` that's actually a slash-command picker). Add a "v2" without deleting v1 and there will be four. Then the natural next move is to add a "Pax palette" on top — five. The IA fragmentation Holm warns about for /pax will happen to ⌘K too if nobody keeps it singular.

**The discipline:** there is **one ⌘K** in this app. Founder mode gets it on Shift. Pax lives inside it. The slash-command picker is renamed and demoted (it's a Pax-internal prompt menu, not a palette). When v2 ships, v1 is deleted, not flagged-off-and-forgotten.

The deeper Spotlight principle: **the value of one keystroke is that there is one keystroke.** Two keystrokes is no keystrokes. The day AcreOS has two palettes for the same user is the day ⌘K stops being magic and starts being a fork.

---

*— Anya Berenson*
