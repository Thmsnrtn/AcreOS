# Customer Daily-Flow UX Audit — 2026-05-01

Auditor: Persona A (working land investor at 7am) + Persona B (senior product designer).
Scope: critical daily-flow surfaces only — auth → today → pipeline → properties → parcels/:id → deals → leads → money/finance/portfolio → inbox → pax → settings.
Method: file-level read of each surface, with cross-checks against v6 brief, JC#7 persona primitive, and recent commits (ced5144 parcel-detail, 2804a1f Pax-draft, 05bd418 settings clusters).

---

## 1. Executive Summary (5-sentence verdict)

The daily flow is **mostly rock-solid for a launch-ready operating system**, with strong scannability on `/today`, a clean composed `/parcels/:id` surface, theme-token-driven status colors on `/deals` and `/pipeline`, and clear empty states everywhere. However, three structural problems reduce the experience from "production" to "still shipping": **(1)** the JC#7 `useTerm()` persona primitive is wired on only 3 of the 12 customer surfaces (`/properties`, `/deals`, `/leads`) — every other page hardcodes "Lead/Property/Deal/Parcel/Notes" so a wholesaler or note-investor user still reads land-investor copy outside those three pages; **(2)** `/money` is a tabbed wrapper that *embeds* `/finance` and `/portfolio` as inner tabs, but `/finance` and `/portfolio` are also still routable on their own with their own page chrome — same content reachable from three URLs with three different headers, and the tab routing inside `/money` is mis-labeled (tab "Finance" actually mounts `<PortfolioPage>`); **(3)** `/pax` has slipped backwards on theming — it's the only customer-facing surface that still uses raw Tailwind hexes (red-500, amber-500, blue-50, emerald-200) instead of the `--acr-*` semantic tokens used everywhere else, so it visibly clashes when the user switches themes. Founder-persona leak found: `/finance` line 197 says "Sophie keeps the notes, payments, and statements straight" — Sophie is a founder-only persona per the persona-architecture rule and must not appear in customer copy. Brief §13 / §11 anti-patterns are fully purged across all 13 audited files (no confetti, no PartyPopper, no "Most Intelligent", no 🔥 emojis in copy, no "Something went wrong").

---

## 2. Per-Page Findings

### 2.1 `/auth` — Sign-in / Sign-up (`client/src/pages/auth-page.tsx`)

**Verdict: solid.** The page is 163 lines, single-purpose, accessible.

**Strengths**
- Tagline matches v6 ("The operating system for Land Investors") at line 135.
- Invite-token race is handled correctly: `inviteState !== "done"` blocks the `<Redirect>` until POST resolves (lines 59–80).
- Loading state uses semantic `role="status"` + `aria-live` + `sr-only` (lines 90–102).
- Branding swaps to white-label tenant name via `useBrandName` (line 16).

**Findings**
- **P2** — Mode toggle state (`mode`, line 18) is read once on mount from `?mode=register`, but Clerk's `<SignUp>` and `<SignIn>` widgets each render their own internal "Don't have an account? Sign up" link. The `mode` state never gets updated from inside Clerk's widget, so the local `mode` variable is essentially dead state. Comment at lines 150–152 already acknowledges this — consider deleting the `mode` state entirely or wiring it to Clerk's `signUpUrl` prop.
- **P2** — The sign-in page has no "what is AcreOS" copy beyond the tagline. A user redirected here from a marketing CTA may want a 1-line "what they're signing up for" reassurance.

---

### 2.2 `/today` — Daily landing (`client/src/pages/today.tsx`)

**Verdict: dense but thoughtful.** 1391 lines is heavy for a landing — but the new-user-mode short-circuit (line 212) and section-by-section progressive disclosure manage it.

**First impression (Persona A)**
- Header at lines 633–666 nails it: time-of-day greeting, formatted date, a soft-tone count of pending decisions, and a one-click "Review now" pill that lands on `/decision-queue`. The first useful action is in front of you in <2 seconds.
- New-user mode at line 212 hides Pulse / Pax Suggests / AI Action Queue until the user has ≥3 leads OR ≥1 owned property — this is the right call.

**Scannability (Persona B)**
- Section ordering: Onboarding → Welcome-back → Hero → Agent activity → Business pulse → Start here today → Today's actions → Portfolio alerts → Pax noticed → Pax suggests → Goal progress → AI action queue → Cash position → KPI strip. Roughly 14 sections — that's a lot. Headings use the `acr-section-h2` class (line 819, 871, 935, 995, 1104, 1163, 1207, 1257) which gives consistent rhythm, but 14 sections is more than a 5-second scan can absorb.
- "Pax noticed" + "Pax suggests" sit back-to-back (lines 990 and 1100). They feel similar enough that I'd expect a Land Investor to wonder "wait, what's the difference?" The brief decision was right (header IS the byline) but two sequential Pax sections without a separating motif might read as redundant.

**Primary action**
- "Review now" pill (line 654) is the obvious next thing when `pendingDecisionCount > 0`. When that's zero, there's no equivalent — the user lands on a wall of equally-weighted dashboard sections. Consider a fallback CTA like "Find a deal" or "Run today's outreach" when pending=0.

**Empty state**
- Brand-new org: `getActiveLeads === 0 && activeProperties === 0` triggers a focused "Ready to find your first deal?" card with two CTAs ("Add your first parcel", "Import leads") at lines 602–631. **This is excellent** — inviting, not punishing.

**Friction**
- Cross-surface trip: the "Cash position" section at lines 1252–1329 links to `/finance` (line 1265). Once the consolidation question (see §3) is resolved, this should target `/money#notes` so users land in the unified surface.

**Status communication / colors (Persona B)**
- All status tones use `--acr-*` tokens (e.g. `priorityColors` at line 180, `pulseBg/pulseColor` at line 395). Theme-respondent. Verified.

**Vocabulary**
- "Parcel," "lead," "deal," "note" all used naturally. **However: useTerm() is not imported on this page.** A wholesaler or note-investor user would still read "lead" on the homepage even after switching personas. **P1** — wire `useTerm("entity.lead.plural")`, `useTerm("entity.property.plural")`, `useTerm("entity.deal.plural")` into the KPI strip (lines 1339–1387) and the hero greeting (line 645).

**Findings**
- **P1** — useTerm not wired (above).
- **P2** — 14-section page. Consider collapsing AI Action Queue (line 1203) and Goal Progress (line 1158) behind an "Insights" disclosure, especially on mobile.
- **P2** — `text-blue-200/blue-50/blue-900` hardcoded on alert border at line 948 (`isInfo` branch). All other branches use `--acr-*`. Token regression.
- **P3** — `Bot` icon eyebrow (line 670) routes to `/sovereign` (founder-only term?) — verify `sovereign` doesn't leak founder-persona vocabulary on the customer side.

---

### 2.3 `/pipeline` — Stage funnel + 5 tab views (`client/src/pages/pipeline.tsx`)

**Verdict: clean.** 336 lines, focused.

**Strengths**
- Funnel visualization uses theme-token color resolution via `var(--acr-warn)`, `var(--acr-brand)`, `var(--acr-pos)` at lines 76–82. Re-skins on theme switch.
- Tabs are lazy-loaded (lines 29–31) — `LeadsPage`, `PropertiesPage`, `CampaignsPage` Suspense-wrapped.
- Empty-state copy at line 263 ("Your deal machine. Bring in your first lead to get going.") is in voice.

**Findings**
- **P1** — useTerm not wired. Hero copy at line 256 says "active deal" hardcoded; wholesaler personas should see their own term here.
- **P2** — The `Board` tab (line 306) and `Deals` tab (line 322) both render `<DealsPage />`. Two tabs, identical content. Confusing — pick one or differentiate (Board = kanban, Deals = list view? But that's already a sub-toggle inside `/deals` itself).
- **P2** — Stage funnel uses `var(--muted-foreground)` for the "New" stage (line 77). On dark themes this is mid-gray and the funnel reads as "stage one is dead/inactive." Use `var(--acr-ink-3)` or `var(--acr-brand)/30`.

---

### 2.4 `/properties` — Inventory grid (`client/src/pages/properties.tsx`)

**Verdict: heavy.** 3,280 lines is the second-largest customer page (after settings). Bigger than it should be — most of the size is the create/edit modal and the GIS-filter sidecar.

**Strengths**
- useTerm IS wired (lines 139–141). When a wholesaler logs in this page actually adapts.
- Hero copy (line 460): `{plural(properties.length, "parcel")} across your portfolio.` uses the correct vernacular for land investors.
- List ↔ map toggle (lines 478–495), with persisted view-mode in localStorage. Good.
- Filtered empty state (lines 701–717) gives "Reset filters" affordance instead of just "no results."
- Saved-views selector (line 606) — power-user feature without dominating the page.

**Findings**
- **P1** — Mixed terminology: hero says "parcel" (line 460), but the modal title says "Add New Property" (line 533) and the description says "Enter the property details" (line 535). Bulk delete dialog says "permanently remove the property from your inventory" (line 744). Pick one — for land investors, **parcel** is canonical.
- **P1** — The "Add" CTA reads `Add {propertyLabel}` (line 528) where `propertyLabel = useTerm("entity.property")` returns "Property" (capitalized). Adjacent buttons read "Export CSV" and "Import CSV" — consistent. But three lines below, modal title is hardcoded "Add New Property" (line 533) — useTerm not threaded into modal headers.
- **P2** — Filter row (lines 588–643) has 4 controls in a wrap-flex: select-all checkbox, SavedViews, GisFilters, distress-score select. On a 1280px screen this wraps awkwardly into two rows if any GisFilter chips are active. Consider a compact "Filters (3)" popover instead of inline.
- **P2** — `console.error` at line 54 — should route through structured `logger`.
- **P3** — APN regex at line 23 accepts purely-numeric input without separators (`12345678`) — fine, but it also accepts `1-2-3` which is unlikely to be a real APN. Consider min-length 6.

---

### 2.5 `/parcels/:id` — Composed parcel detail (`client/src/pages/parcel-detail.tsx`)

**Verdict: this is the best surface in the audit.** 417 lines, single purpose, composes the four old-world surfaces (properties / property-enrichment / avm / market-data) into one place.

**Strengths**
- Header (lines 178–199): APN as eyebrow, address as H1, county/subdivision/lot as caption, status badge — perfect IA hierarchy for a Land Investor.
- 4-up metric grid (lines 202–225) with iconography that reads scan-fast: Size / Assessed / Market / Due-diligence-progress.
- Tabbed sections (Overview / Due diligence / Financial / Actions) compress the four-page journey to one page + four tabs.
- The "Actions" tab (lines 321–348) is the cross-surface bridge: "Enrich this parcel" → /property-enrichment, "Run valuation" → /avm, "View comps" → /market-data, "Generate offer" → /blind-offer-wizard. **This is exactly the friction-killer JC#1 promised.**
- Error/empty/loading states are correctly differentiated (lines 110–155).

**Findings**
- **P1** — useTerm NOT wired. `useDocumentTitle("Parcel #${id}")` at line 98 hardcodes "Parcel"; back-link says "Properties" (line 173). For a note-investor persona, the term changes — but this page won't reflect that.
- **P2** — `STATUS_LABELS` at line 43 includes `prospect` / `due_diligence` / `offer_sent` / `under_contract` / `owned` / `listed` / `sold`. But `properties.tsx` bulk-status dropdown (lines 569–577) uses `available` / `under_contract` / `due_diligence` / `closing` / `sold` / `listed` — **`available` and `closing` exist on /properties but are missing from /parcels/:id's STATUS_LABELS, so they fall through to the raw status key.** Same for `prospect` / `offer_sent` / `owned` which aren't in the bulk dropdown. Status enum is divergent between the two surfaces.
- **P2** — Back-link at line 168 says only "Properties" without breadcrumb context. Once useTerm lands, this should read `← {propertyLabelPlural}`.
- **P2** — Header doesn't surface market-vs-assessed delta, or a price-per-acre. For a Land Investor making an offer call, that's the single most important number on the page. Consider adding a 5th MetricCard.
- **P2** — `defaultValue="overview"` (line 228) means the user always starts on Overview. If they came from `/today` clicking a "Run valuation" Pax suggestion, they'd want to land on Actions. Consider URL hash sync (`#actions`).
- **P3** — `property.utilities?.electric` rendering (line 248) shows "Yes" or "—" — but never "No." Tri-state collapse to bi-state hides the "we asked the county and they said no" data point.

---

### 2.6 `/deals` — Deal pipeline (`client/src/pages/deals.tsx`)

**Verdict: comprehensive and readable.** 2,234 lines.

**Strengths**
- useTerm is wired (lines 119–121). Page title, hero, modal triggers all adapt.
- Health indicators (lines 93–106) use `getDealHealth(deal)` returning `'healthy' | 'warning' | 'stalled'`, mapped to `bg-acr-pos / bg-acr-warn / bg-acr-neg` semantic tokens. Theme-respondent.
- Pipeline-distribution stacked bar (lines 594–635) is the right summary primitive for a 7am scan: "X stalled, Y slow, all on track." Uses an `aria-label` describing the distribution for screen-reader users.
- Stage colors (`statusColors`, lines 108–116): all `acr-*-soft` tokens. Verified theme-respondent.
- Acquisitions/Dispositions/Pipeline/Closed 4-up at lines 509–569 — exactly what a Persona A wants at a glance.
- DisclaimerBanner (line 507) — correctly placed for legal-compliance copy.

**Findings**
- **P2** — Hero copy hardcoded at line 472–477: `Acquisitions and dispositions. From offer to close, all on one rail.` This is land-investor framing; for a wholesaler who flips contracts, "acquisitions and dispositions" is the wrong frame. Wire useTerm-driven copy here too.
- **P2** — `dealLabel.toLowerCase()` (line 493, 498, 499) — the modal title says "Create deal" but `useTerm("entity.deal")` on `wholesaler` persona returns "Contract" (presumably). Lowercasing "Contract" to "contract" reads okay but not great. Either trust the term as-is or have a dedicated `entity.deal.verb` key.
- **P3** — `glass-panel` class at line 510, 524, 538, 554 — verify in `today.css` or the global stylesheet that this token isn't a holdover from pre-port nocturne theming.

---

### 2.7 `/leads` — Leads list (`client/src/pages/leads.tsx`)

**Verdict: solid.** 2,740 lines.

**Strengths**
- useTerm wired (lines 654–656).
- Hero (lines 1054–1070) adapts: empty → "Import a CSV or add one by hand to get started"; non-empty → "{n} leads — buyers, sellers, and warm intros."
- Stage iconography (lines 107–117) uses Flame/Sun/Snowflake/Skull — appropriately memorable for a daily user. Note: hot/warm/cold/dead emoji-icon uses Lucide's Flame component, not the 🔥 emoji char banned in §13. Compliant.
- Mobile actions collapsed into a dropdown (lines 1105–1144) — good responsive pattern.
- Discard-confirm intercepts unsaved form input on close (lines 1146–1160). Replaces the banned `window.confirm()` pattern.

**Findings**
- **P2** — Hero copy hardcodes "buyers, sellers, and warm intros" (line 1059). For a note-investor persona, the population is "borrowers, brokers, and lead lists" — different vocabulary. useTerm covers the entity name, not the description; consider an additional vocabulary key for descriptions.
- **P2** — `console.error` likely present in catch handlers (CLAUDE.md says use `logger`). Did not exhaustively check.
- **P3** — On the wholesaler persona, "Import tax list" (line 1101) — wholesalers don't typically work tax-delinquent lists. Consider gating this CTA behind `usePersona() === "land_investor"`.

---

### 2.8 `/money` + `/finance` + `/portfolio` — **THE CONSOLIDATION QUESTION**

This is the structural finding of the audit.

**What's there today:**

| Route | File | Shape | What it is |
|-------|------|-------|------------|
| `/money` | money.tsx (135 lines) | Tabbed wrapper | 5 tabs: Notes, Finance, Portfolio, Forecast, Capital |
| `/finance` | finance.tsx (1824 lines) | Standalone page | Notes management, payments, Stripe Connect, cash-flow chart |
| `/portfolio` | portfolio.tsx (963 lines) | Standalone page | Portfolio analytics — total value, monthly cash flow, IRR |

**Problems:**

1. **Tab labels lie about content.** Inside `/money`:
   - Tab "Notes" (line 105) renders `<FinancePage />` — actually shows Notes management. ✓ matches.
   - Tab "Finance" (line 109) renders `<PortfolioPage />` — shows portfolio analytics. ✗ **mismatched label**.
   - Tab "Portfolio" (line 115) renders `<PortfolioOptimizerPage />` — a third, different page (`portfolio-optimizer`). ✗
   - Tab "Forecast" (line 121) renders `<CashFlowPage />`.
   - Tab "Capital" (line 127) renders `<CapitalMarketsPage />`.

   So the `/money` tab labels and the embedded page identity don't agree. A user clicking "Finance" inside `/money` lands on `/portfolio`'s content.

2. **Triple-routability.** A user reaching "Finance" can land at:
   - `/money#finance` (which is actually portfolio analytics)
   - `/finance` (the real Notes-and-Payments page, with its own header "The paper side. Sophie keeps the notes…")
   - As a tab embedded in `/money#notes`

   Three URLs, three different headers (one says "Money," one says "Finance — The paper side, Sophie keeps…", one is the embedded version). **No SSOT for the Finance surface.**

3. **Founder-persona leak in /finance hero copy.** Line 197: `Sophie keeps the notes, payments, and statements straight.` Sophie is a founder-only persona name per the persona-architecture rule (`Customers see Pax only; founder sees Sophie/Forge/Atlas/etc. Never mix them`). **P0 — must be removed before launch.**

4. **/money has no useTerm wiring** despite the inner pages each having their own term needs. Hero (line 65–70) hardcodes: `Money. Notes, portfolio, cash flow, and capital markets.`

5. **/portfolio uses `<h1 className="text-3xl font-bold">` directly** (line 296) instead of the platform `acr-cc-greeting` editorial pattern used by /today, /pipeline, /properties, /deals, /leads, /finance, /settings. Visual hierarchy break.

**Recommendation:**

Pick ONE consolidation pattern. Either:
- **A**: `/money` is the canonical surface, `/finance` and `/portfolio` redirect to `/money#finance` / `/money#portfolio`. Single hero, tab-internal switching.
- **B**: `/money` is deleted, `/finance` and `/portfolio` are sibling top-level routes accessed via the global nav. Each has its own hero. (Three pages → two.)

**Pattern A is the smaller diff and matches /pipeline's pattern.** But the tab→page mapping inside money.tsx must be corrected first.

**Findings**
- **P0** — Founder persona leak at finance.tsx:197 ("Sophie keeps the notes…").
- **P0** — `/money` tab labels mis-mapped to inner pages (money.tsx:109, 115).
- **P1** — Triple-routability of the Finance/Portfolio content with three different heroes.
- **P1** — useTerm not wired on /money, /finance, /portfolio.
- **P2** — /portfolio uses raw `<h1 className="text-3xl">` instead of platform `acr-cc-greeting` (portfolio.tsx:296).

---

### 2.9 `/inbox` — Unified email + SMS (`client/src/pages/inbox.tsx`)

**Verdict: the Pax-draft integration is well-done.** 1,208 lines.

**Strengths (Pax draft attribution — commit 2804a1f)**
- Attribution chip (lines 578–598): `Sparkles` icon + the model's attribution string in a soft `bg-acr-brand-soft text-acr-brand` chip — only renders **after** the draft lands. Auto-disappears mid-regenerate. Includes a discoverable "Regenerate" button with `aria-label="Regenerate Pax draft"`.
- Loading state is honest: "Pax is drafting a reply…" (line 603), not an ambiguous spinner.
- Error state is graceful: "[error]. You can still write a reply manually below." (line 609) — preserves the user's flow.
- Once the user types into the textarea, the attribution chip drops (per comment line 619). This is correct: edited drafts are the user's, not Pax's.

**Findings**
- **P0 — Sidebar import collision.** The file imports `Sidebar, useSidebarCollapsed` from `@/components/layout-sidebar` at line 2 — but every other customer page uses `<PageShell>` (`@/components/page-shell`). `/inbox` is the only customer page that breaks the shell pattern. Verify this doesn't double-render the sidebar or break the `PageTopbar` (commit e315df9).
- **P2** — useTerm not wired. "Lead" hardcoded throughout the inbox in lead-attribution sub-rows.
- **P2** — Auto-trigger draft on first reply-panel open (line 314). This will silently spend AI credits each time the user opens a reply. Verify with the credit-deduction logic that the auto-draft is gated on tier or rate-limited.
- **P3** — `paxAttribution` is reset on every textarea change (line 619 comment). On a long reply, accidentally pasting and reverting still drops the byline. Consider a "draft-edited" indicator so the user can see "this started as a Pax draft, you've edited it."

---

### 2.10 `/pax` — AI assistant hub (`client/src/pages/pax.tsx`)

**Verdict: behaves as a chatbot novelty more than as a tool.** 678 lines. Five tabs: Insights / Chat / Activity / Agents (founder-only) / Automation.

**Strengths**
- Founder-tab gating at lines 583–586 redirects customers off `#agents` if they hash-land there. Persona architecture preserved.
- Insights tab (lines 174–453) has a thoughtful structure: Pax Noticed / Stale Leads / Expiring Offers / Motivated Callers — same primitives as `/today`'s "Pax noticed" but with deeper drill-in.
- Empty-state copy: "All clear — Pax is keeping watch." (line 224) — calm, not desperate.

**Findings — this page is the regression concern**
- **P1** — **Hardcoded raw Tailwind colors throughout.** Examples (lines):
  - 97–101: `border-red-400 / border-amber-400 / border-blue-400 / border-gray-300` (severity borders)
  - 146: `border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40` (greeting banner)
  - 150: `text-blue-500`
  - 264: `text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20` (revenue-impact badge)
  - 292: `text-amber-500`
  - 306–319: `border-amber-200 bg-amber-50` / `bg-red-500` / `bg-amber-500` / `text-red-500`
  - 346: `text-red-500`
  - 365: `border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10`
  - 369: `text-red-500`
  - 398–410: `text-emerald-500` / `border-emerald-200 bg-emerald-50` / `bg-emerald-200`

  Every other customer surface migrated to `--acr-pos / --acr-warn / --acr-neg / --acr-brand` semantic tokens. `/pax` did not. On Quarry / Nocturne / Meadow themes the red-50/amber-50/emerald-50 backgrounds will read as the wrong tone. **Theme-token regression — this is the one customer surface that visibly clashes when the user switches themes.**

- **P1** — Hero (line 609–614): `<h1 className="text-2xl md:text-3xl font-bold">AI hub</h1>` + `AI assistant, agents, and automation for your land business.` Doesn't follow the `acr-cc-hero` / `acr-cc-greeting` editorial pattern used by /today, /pipeline, /properties, /deals, /leads, /finance, /settings. Visual rhythm break vs the rest of the platform.

- **P1** — Page title is "AI hub" — but the URL is `/pax` and the rail/nav says "Pax." Pick one.

- **P2** — `revenueImpact()` at lines 166–170 returns hardcoded ranges ("+$25K–$80K" for high severity) regardless of the user's actual deal sizes. For a small-acreage flipper, $25K is a whole deal. For a portfolio buyer it's nothing. **Either personalize this or remove it.** As-is, an experienced Persona A reads it as marketing copy.

- **P2** — Default tab is `chat` (line 43), not `insights`. For a daily-flow user, *insights* is the more useful entry point — the chat is a fallback.

- **P3** — useTerm not wired anywhere on the page.

---

### 2.11 `/settings` — workspace tuning (`client/src/pages/settings.tsx`)

**Verdict: 17 tabs in 6 clusters works on desktop, mobile select is the right escape hatch.** 3,075 lines.

**Cluster ordering review (commit 05bd418):**
1. Profile (general / security / privacy / referral)
2. Workspace (appearance / autonomy* / goals)
3. Notifications (notifications / communications)
4. Team & Billing (team / payments)
5. Data (data / integrations / automations / developer)
6. AI (ai / ai-tasks)

**Persona B IA assessment:**
- Cluster ordering is **personal → workspace → comms → team/billing → data/integrations → ai**. That's a sensible "individual to org to platform" arc.
- `mr-3` margin spacers (line 877, 893, 903, 913, 927, 933) create visible cluster gaps on desktop without forcing a sub-tab re-architecture. Subtle and correct.
- Mobile fallback uses `<SelectGroup>` with `<SelectLabel>` — preserves cluster identity (lines 818–852).

**Findings**
- **P2** — "Autonomy" tab is feature-flagged (`autonomyFlag &&`, line 887). Without the flag the Workspace cluster has only 2 tabs (Appearance / Goals) — so its `mr-3` separator (line 893) would attach to "Goals," visually merging Workspace into Notifications. Acceptable degradation but worth flagging.
- **P2** — "Refer & earn" (line 877) is in the Profile cluster. Is referral really a profile setting? It's more a marketing/billing concern. Move to Team & Billing.
- **P2** — "Developer" tab (line 931) is in the Data cluster. For a Land Investor, "Developer" implies API access — that's likely wrong audience for a setting nested under Data. Either gate it behind `isFounder` or move it to a separate cluster.
- **P3** — `<h1 className="acr-cc-greeting">Tune the workspace.` (line 800) — fine, but no useTerm.

---

## 3. Cross-Cutting Friction Patterns

### 3.1 useTerm() persona primitive coverage gap (P1, platform-wide)

**Wired:** properties.tsx, deals.tsx, leads.tsx (3 pages).
**Not wired:** today.tsx, pipeline.tsx, parcel-detail.tsx, money.tsx, finance.tsx, portfolio.tsx, inbox.tsx, pax.tsx, settings.tsx (9 pages).

Verified with `grep -n "useTerm" client/src/pages/{...}.tsx`. The hook exists at `client/src/hooks/use-persona.ts` (25 lines) and works correctly — coverage is purely a wiring problem. Until the other 9 pages adopt it, switching `users.persona` from `land_investor` to `wholesaler` or `note_investor` only re-skins 3 of 12 customer surfaces — the rest still say "Lead / Property / Deal."

This is the single most impactful cross-cutting fix on the audit.

### 3.2 Money / Finance / Portfolio triple-routability (P1)

See §2.8. Same content reachable from three URLs with three different heroes. Tab labels inside `/money` mis-map to embedded pages.

### 3.3 Theme-token regressions on /pax (P1)

`/pax` is the one customer surface that didn't migrate from raw Tailwind hexes to `--acr-*` semantic tokens. See §2.10 line list. Visible in any non-default theme.

### 3.4 Hero/H1 inconsistency

`acr-cc-hero` + `acr-cc-greeting` editorial pattern used on: today, pipeline, properties, deals, leads, finance, settings.
Raw `<h1 className="text-{2,3}xl font-bold">` used on: money, portfolio, pax, parcel-detail.
Pick one platform-wide.

### 3.5 Status-enum divergence between /properties and /parcels/:id

`/properties` bulk-edit dropdown statuses ≠ `/parcels/:id` STATUS_LABELS map. See §2.5. Single source of truth required (move to `@shared/schema` constants).

### 3.6 Founder-persona vocabulary leak (P0, immediate)

`finance.tsx:197` — "Sophie keeps the notes, payments, and statements straight." Customer-facing. Per persona-architecture rule, must be removed.

---

## 4. Persona A's "What Would I Demand Fixed Today?" — Top 5

1. **Remove "Sophie" from /finance hero.** (P0). Persona leak. Tomorrow's customer demo would surface this.
2. **Fix the /money tab labels.** Clicking "Finance" inside /money loads /portfolio's content. Confusing on first use, infuriating by week 2.
3. **Wire useTerm on /today.** I'm a wholesaler. Why does my homepage still say "lead"?
4. **/pax theme polish.** I switched to Nocturne and the AI page is suddenly bright red and amber. Looks broken.
5. **Add a "what's next" CTA on /today when pendingDecisionCount = 0.** When everything's caught up, I land on a dashboard wall with no guidance — give me a "find a deal" or "send today's outreach" pivot.

---

## 5. Persona B's "Structural Improvements" — Top 5

1. **Consolidate /money + /finance + /portfolio.** Decide on pattern A (money is canonical, redirects from finance/portfolio) or pattern B (delete /money, keep finance and portfolio as siblings). Three URLs for the same surface is a structural smell.
2. **Migrate /pax to `--acr-*` tokens** to match the rest of the platform. Single PR; ~30 line edits.
3. **Wire useTerm() across the remaining 9 customer surfaces.** Highest-leverage IA fix for the JC#7 persona primitive — it's already designed, just not adopted.
4. **Standardize on `acr-cc-hero`/`acr-cc-greeting` H1 pattern** across money, portfolio, pax, parcel-detail.
5. **Move status enums and color maps to `@shared/schema`** so /properties, /parcels/:id, /deals can't drift. Currently each page redeclares its own STATUS_LABELS / statusColors.

---

## 6. Quick Wins (Under 30 Min Each)

1. **Delete "Sophie keeps the notes…" line at `client/src/pages/finance.tsx:197`.** Replace with persona-neutral copy. ~2 min.
2. **Swap raw Tailwind reds/ambers/emeralds in `client/src/pages/pax.tsx` for `--acr-*` tokens.** SEVERITY_BORDER (line 96), GreetingBanner (line 146), revenueImpact badge (line 264), stale-lead row (line 306), expiring-offer row (line 365), motivated-callers row (line 406). ~25 min global find-replace.
3. **Fix `/money` tab → page mapping.** money.tsx tabs labeled "Finance" should mount FinancePage; tab labeled "Portfolio" should mount PortfolioPage; tab "Notes" is currently FinancePage which seems intentional but is mis-named — verify with PM. ~10 min.
4. **Wire useTerm on `/today` KPI strip.** today.tsx:1339–1387 — replace "Active leads" / "Properties" / "Active notes" / "Open deals" labels with `useTerm("entity.lead.plural")` etc. ~15 min.
5. **Wire useTerm on `/parcel-detail` document title and back link.** parcel-detail.tsx:98, 173. ~5 min.
6. **Replace `<h1 className="text-3xl font-bold">Portfolio analytics</h1>`** at portfolio.tsx:296 with the `acr-cc-hero`/`acr-cc-greeting` pattern. ~10 min.
7. **Remove duplicate "Board" tab at pipeline.tsx:306** (mounts the same DealsPage as the "Deals" tab at line 322). Or differentiate them. ~5 min.
8. **Replace `console.error` at properties.tsx:54 with structured `logger`.** ~3 min.
9. **Stage-funnel "New" color regression at pipeline.tsx:77** — swap `var(--muted-foreground)` for `var(--acr-brand)/30` so first stage doesn't read as "dead." ~2 min.
10. **Default `/pax` tab → "insights"** instead of "chat" (pax.tsx:43). Daily-flow users want signal, not a chat box. ~1 min.

---

## Appendix — Files Audited (with line counts)

```
   163 client/src/pages/auth-page.tsx
  1391 client/src/pages/today.tsx
   336 client/src/pages/pipeline.tsx
  3280 client/src/pages/properties.tsx
   417 client/src/pages/parcel-detail.tsx
  2234 client/src/pages/deals.tsx
  2740 client/src/pages/leads.tsx
   135 client/src/pages/money.tsx
  1824 client/src/pages/finance.tsx
   963 client/src/pages/portfolio.tsx
  1208 client/src/pages/inbox.tsx
   678 client/src/pages/pax.tsx
  3075 client/src/pages/settings.tsx
─────────
 18444 lines audited
```

Hook reference: `client/src/hooks/use-persona.ts` (25 lines).
Route mapping: `client/src/App.tsx:367` (HomeRoute), :411–442 (route table).
