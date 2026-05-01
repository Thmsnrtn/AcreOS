# Joaquín Aguilar — Naming & Taxonomy Audit

**AcreOS, 2026-05-01.** Wave 2, naming-discipline lens. I led naming at Linear and at Stripe API; the lens I bring is: every concept gets ONE name, used everywhere, and a rename is a versioned, scheduled, *contracted* event. AcreOS does not yet have that discipline. It has a vocabulary primitive (`useTerm()`) and a registry (`personaVocabulary.ts`) that *could* enforce it, but the registry is incomplete and only ~5–6 of ~25 customer-facing surfaces consult it.

## 1 · One-line verdict

> **AcreOS has the right naming primitive (`useTerm()`) and the wrong number of names for every primary concept** — a parcel is called four things, the financial surface is called five, the assistant is called seven, and the registry that should arbitrate them ships with eight keys when it needs roughly forty.

---

## 2 · The canonical taxonomy

This is what the system actually *has* (table → column reality) versus what each surface *calls* it versus what the persona registry currently knows. Sourced from `shared/schema.ts`, `client/src/App.tsx`, `client/src/components/layout-sidebar.tsx`, and `client/src/lib/personaVocabulary.ts`.

| Concept | DB table (system-name) | UI name(s) currently shown | Primary URL(s) | personaVocabulary key | Coverage |
|---|---|---|---|---|---|
| A piece of land | `properties` | "Property" / "Properties" / "Parcel" / "Inventory" (onboarding copy) / "Listing" / "Subject property" | `/properties`, `/parcels/:id`, `/listings`, `/portfolio` | `entity.property` (+ `.plural`) | partial — wired on `/properties`, `/parcels/:id`, `/today`, `/pipeline`; NOT on `/portfolio`, `/listings`, `/marketplace`, `/maps`, parcel cards in `/leads` |
| A row in the funnel | `deals` | "Deal" / "Acquisition" / "Disposition" / "Offer" / "Opportunity" / "Negotiation" | `/deals`, `/pipeline`, `/offers`, `/negotiation`, `/deal-feed` | `entity.deal` (+ `.plural`) | partial — wired on `/deals`, `/pipeline`; NOT on `/offers`, `/negotiation`, `/deal-feed`, `/blind-offer-wizard` |
| A person of interest | `leads` | "Lead" / "Seller" / "Owner" / "Contact" / "Motivated seller" / "Borrower" | `/leads`, `/skip-tracing`, parcel detail "Owner", `/portal` | `entity.lead` (+ `.plural`) | partial — wired on `/leads`, `/today`; NOT on `/skip-tracing`, parcel-detail Owner card, `/leads/dedupe`, `/team-inbox` |
| Funnel stage label (terminal) | `deals.status` | "Closed" / "Acquired" / "Awarded" / "Sold" / "Leased" | `/deals` (kanban headers), `/pipeline` | `pipeline.stage.closed` | partial — only the *closed* stage is in the registry; `new`, `contacted`, `under_contract`, `lost` are not |
| Note / loan instrument | `notes` | "Note" / "Loan" / "Seller financing" / "Borrower account" | `/finance` (Notes tab), `/money` (Notes tab — different shape!), `/portal`, `/dunning` | **MISSING** | none |
| Payment record | `payments` | "Payment" / "Disbursement" / "Collection" / "Receipt" | `/finance`, `/money`, `/dunning`, `/portal` | **MISSING** | none |
| Outreach run | `campaigns` | "Campaign" / "Direct Mail" / "Sequence" / "Drip" / "Outreach" / "Blast" | `/campaigns`, `/direct-mail`, `/sequences`, `/syndication` | **MISSING** | none |
| The financial surface | (composite of `notes`, `payments`, `deals`, `properties.value*`) | "Money" / "Finance" / "Portfolio" / "Capital" / "Cash Flow" / "P&L" | `/money`, `/finance`, `/portfolio`, `/capital-markets`, `/cash-flow`, `/portfolio-pnl` | **MISSING** (no surface key at all) | none |
| The assistant | `agent_*` tables (configs, runs, sessions, memory) | "Pax" / "AI" / "Atlas" / "Sophie" / "Forge" / "Agents" / "AI Team" | `/pax`, `/ai`, `/agents`, `/ai-team`, rail, ⌘K, bell | **MISSING** | none — *and persona-architecture says founder names must never leak* |
| Home / start surface | n/a (composite) | "Home" / "Today" / "Dashboard" / "Command Center" / "Executive Dashboard" / "Founder Home" | `/`, `/today`, `/dashboard`, `/command-center`, `/executive-dashboard`, `/founder-home`, `/founder-dashboard` | **MISSING** | none |
| Insights surface | (analytics) | "Insights" / "Analytics" / "Intelligence" / "Markets" / "Observations" | `/analytics`, `/market-intelligence`, sidebar "Insights" | **MISSING** | none |
| Map | (composite over `properties.lat/lng`) | "Map" / "Maps" / "Maps & Land" | `/maps` (plural in route!), sidebar "Map" (singular) | **MISSING** | none |
| Persona itself | `users.persona` (`Persona` enum in `shared/models/auth.ts`) | "Land Investor" / "Note Investor" / "Wholesaler" / etc. | `/settings` Appearance, `/onboarding-v2` | `persona.name` | wired in onboarding + persona-panel only |
| Settings: Notifications vs Communications | `notification_preferences`, `communication_settings` (separate) | "Notifications" *and* "Communications" — two adjacent tabs in `/settings` | `/settings` tabs `notifications` + `communications` | **MISSING** | none — *these are conceptually overlapping, see §3* |

**Reading the table**: Of the ~14 user-held concepts, **only 4 have any persona-vocabulary entry, and none have full coverage of the surfaces that use them.** That is the gap.

---

## 3 · Collisions

### 3a · Same name, different concept (the worst kind — "homonym debt")

| Word | Meaning A | Meaning B | Impact |
|---|---|---|---|
| **"Notes"** | A *promissory note* / loan instrument (the `notes` table — a financial product note investors trade) | The Notes **tab on `/money`** that *also* surfaces seller-financing detail — different shape, partly overlapping rows with `/finance` Notes tab | Customer reading "Notes (12)" in two places sees two different counts. **Launch-blocking** for note_investor persona (their primary entity is called the same word as a UI tab they don't trust). |
| **"Pipeline"** | The *kanban view* (`/pipeline` route, "Board" tab) | The *concept* of "the deal funnel" used in copy ("$2.4M in pipeline") | Mild — but the word is used in headlines on three pages with three meanings. |
| **"Acquisition"** | A `deals.deal_type` value (acquisitions vs dispositions) | A persona-specific term for *deal* (`entity.deal[landlord]` resolves to "Acquisition") | When a landlord persona views `/deals`, the kanban column "Acquisitions" *and* the rows are both called "Acquisitions." Self-collision. |
| **"Owner"** | The `properties.owner_name` field (the person on title) | The `team_members.role = "owner"` Clerk concept (workspace owner) | Permission UI says "Owner" meaning workspace owner; parcel detail says "Owner" meaning seller. Same word, opposite party. |
| **"Map"** vs **"Maps"** | Same concept. | Same concept. | Sidebar singular, route plural. Trust-leak. |
| **"Activity"** | The `lead_activities` table (touches with a lead) | The `activity_log` table (audit log) | Two routes (`/activity`, `/audit-log`) both labeled "Activity" in nav copy at various points. |
| **"Notifications" + "Communications"** | Notifications = inbound *to user* alerts | Communications = outbound *from org* email/SMS settings | These are *not* synonyms — but presented as adjacent equally-weighted tabs in `/settings`, users read them as variants of the same thing and tab-shop. **Rename Communications → "Sending domains" or "Outbound channels."** |

### 3b · Same concept, different name (the next-worst kind — "synonym debt")

| Concept | Names in the wild | Canonical pick | Reasoning |
|---|---|---|---|
| Land | Property, Parcel, Listing, Inventory, Subject property | **Parcel** (per `useTerm()`, per Land Investor parlance) | `useTerm("entity.property")` already returns "Property" for default and "Note" / "Project" / "Rental" for personas; the *word* should adapt, the URL should not (see §5). |
| Deal | Deal, Opportunity, Acquisition, Disposition, Offer | **Deal** (row), **Pipeline** (collection view) | Holm's call. I concur. |
| Person | Lead, Seller, Owner, Contact, Borrower, Motivated seller | **Lead → Seller at LOI → Borrower if note** (state machine, named in code) | Already mostly correct in `useTerm()`; needs a `entity.lead.contractStage` key for the state shift. |
| Outreach | Campaign, Direct Mail, Sequence, Drip, Blast, Syndication | **Campaign** (parent) with channel children (mail, email, sms) | Six routes for one concept. |
| Money | Money, Finance, Portfolio, Capital, Cash Flow | **Finance** (parent surface) | Holm's call. I concur. |
| Assistant | Pax, AI, Atlas, Sophie, Forge, Agents, AI Team | **Pax** in customer surface; founder codenames **never** in customer JSX | Already a P0 persona-architecture rule per project memory; not yet enforced via lint. |
| Home | Home, Today, Dashboard, Command Center, Executive Dashboard | **Home (`/`) is the destination; "Today" is a section** | Holm's call. I concur. |

---

## 4 · `personaVocabulary.ts` gap analysis

The registry today has **8 keys** across 4 concepts. To cover the customer-facing taxonomy it needs roughly **40 keys** across 14 concepts. Concrete additions, ranked by harm-if-omitted:

### P0 (ship before the next persona-driven surface lands)

| Missing key | Reason |
|---|---|
| `entity.note` / `entity.note.plural` | note_investor's *primary* entity. The `/money` Notes tab and the `notes` table share a word that the registry doesn't arbitrate. |
| `entity.payment` / `entity.payment.plural` | Per-persona: "Payment" (default), "Disbursement" (note investor), "Rent" (landlord), "Distribution" (subdivider). |
| `entity.campaign` / `entity.campaign.plural` | Per-persona: "Campaign" (default), "Outreach" (wholesaler), "Mailer" (tax_delinquent), "Listing push" (subdivider). |
| `surface.finance` | The **parent label** on the financial surface — "Finance" (default), "Notes" (note_investor), "Portfolio" (landlord), "P&L" (fix_flipper). Today the sidebar says "Finance" hardcoded. |
| `pipeline.stage.new`, `pipeline.stage.contacted`, `pipeline.stage.under_contract`, `pipeline.stage.lost` | Only `closed` exists; the rest of the kanban headers are hardcoded English. note_investor's funnel is `Sourced → Diligence → Bid → Awarded`, not `New → Contacted → Under Contract → Closed`. |

### P1 (next quarter)

| Missing key | Reason |
|---|---|
| `entity.lead.postContract` | The Lead→Seller→Borrower state transition Holm called out. |
| `surface.home`, `surface.insights`, `surface.outreach` | Sidebar labels should adapt; today they're hardcoded. |
| `assistant.name` | Defaults to "Pax." A future white-label tier may need an org-level override. Belongs alongside `useBrandName`. |
| `entity.task` / `entity.task.plural` | Tasks vs Todos vs Reminders — three words, one concept. |
| `entity.document` / `entity.document.plural` | Document vs Contract vs Agreement vs Deed — four words across `/documents`, `/sign/:docId`, parcel detail. |

### P2 (nice-to-have)

| Missing key | Reason |
|---|---|
| `metric.pipeline_value`, `metric.cash_flow`, `metric.equity` | Persona-specific framings of dollar metrics. |
| `action.makeOffer` / `action.runValuation` / `action.checkTitle` | Verbs are also persona-sensitive ("make offer" vs "submit bid" vs "place LOI"). |

### Registry shape gap

The current registry is a flat `Record<key, Partial<Record<Persona, string>>>`. It's missing:

- **No plurals abstraction.** `.plural` is a string-suffix convention; it should be `{ singular, plural }` per persona to avoid drift.
- **No gendered/case forms.** "the Lead" vs "Lead's email" — sentence-case fragments leak when concatenated.
- **No `aria-label` separation.** The same key serves headline + screen-reader; for assistive tech you sometimes want the formal noun ("promissory note") not the persona word ("paper").
- **No tenant override.** White-label customers will want to rename "Pax" or "Lead" org-wide; today there's no org-scoped override layer.

---

## 5 · URL stability vs adaptability

**Rule I'd codify**: URLs do *not* adapt to persona. Copy does. Three reasons: (a) URLs are shareable across personas (a wholesaler emails a parcel link to a lender); (b) URLs are an external contract — bookmarks, emails, support links; (c) routing tables are global and personas are per-user — adapting URLs by persona means the same DOM-anchor resolves differently for different sessions, which is a class of bug we don't want.

| Route | Should the URL adapt? | UI label adapts? | Notes |
|---|---|---|---|
| `/properties` | **No** | **Yes** — useTerm("entity.property.plural") | URL stays generic; H1 reads "Notes" / "Rentals" / "Projects" depending on persona. |
| `/parcels/:id` | **No** | **Yes** | The detail page is already wired. Singular `/parcel/:id` would be more correct; keep the typo since it shipped, alias the singular as a 301. |
| `/deals` | **No** | **Yes** | Headline + kanban column labels useTerm-aware. |
| `/leads` | **No** | **Yes** | Already wired. |
| `/finance` (after Holm's merge of `/money`) | **No** | **Yes — surface.finance key** | The sidebar parent label adapts; URL stays `/finance`. |
| `/portfolio` | **fold into `/finance/portfolio`** | n/a (sub-route) | Per Holm. |
| `/campaigns`, `/sequences`, `/direct-mail` | **fold into `/campaigns/*`** | label adapts | One URL parent, channel-children URLs stable. |
| `/maps` → `/map` | **One-time rename + redirect** | **No** label adapt — "Map" is universal. | The trivial bleed-trust rename. |
| `/pax`, `/ai`, `/agents`, `/ai-team` | **collapse → `/pax`** (or remove entirely per Holm's "Pax is Spotlight"). | n/a | Stop having four URLs for one assistant. |
| `/settings/notifications` + `/settings/communications` | **rename communications → `/settings/sending`** | both labels adapt | Disambiguates the homonym. |

**The exception that might prove the rule**: a persona may want the *front door* to feel like theirs. E.g. a note_investor lands on `/notes` rather than `/properties`. **Resolve this with a persona-default redirect at the index, not by mutating routes.** `/` → `/properties` for land_investor; `/` → `/finance/notes` for note_investor. Same routing table, different starting point.

---

## 6 · `data-testid` hygiene under renaming

Today's testids are an inconsistent mix of (a) concept-anchored (`tab-deal-details`, `card-deal-${id}`), (b) action-anchored (`button-create-deal`, `button-export-deals`), and (c) presentation-anchored (`text-pipeline-value` — *the value of the pipeline*, **not** the deals on the `/pipeline` route). When `useTerm()` flips "Deal" → "Note acquisition," the visible label changes but the testid must not — and right now there's no rule saying it can't.

**Concrete risks I found:**

- `data-testid="text-acquisitions"` and `data-testid="text-dispositions"` in `deals.tsx` lines 518, 532. If we rename the *concept* "Acquisition" → "Note acquisition" for note_investor, these testids accidentally encode persona-default copy. Tests that assert "the acquisitions count card" would still pass on land_investor and silently miss note_investor regressions.
- `data-testid="text-pipeline-value"` (line 546) is a metric on `/deals` page — but Holm proposes deleting `/pipeline` entirely. The testid will outlive its referent.
- No testids on the persona-aware H1s (`text-page-title` is generic — fine — but no testid distinguishes "Properties" rendered for landlord ("Rentals") from a regression where the term didn't apply).

**Rule I'd add** (one paragraph in the naming-discipline doc):

> testids name the **system concept**, never the rendered string. They use the canonical name (`deal`, `lead`, `parcel`, `note`, `payment`), never the persona-adapted one. Singular for cards, plural for collections, kebab-case, prefix by element role (`card-`, `button-`, `text-`, `tab-`, `column-`, `select-`). When a concept is renamed system-wide, testids change in lockstep with the *system* name, not the *display* name.

This makes the testid a stable contract and lets `useTerm()` change the display freely. Today this rule is mostly followed by accident; it should be enforced (lint can catch persona strings inside testids).

---

## 7 · Settings: Notifications vs Communications

These are presented as peer tabs at `settings.tsx:899–905` and grouped together at `settings.tsx:832` as `<SelectLabel>Notifications</SelectLabel>` containing both items. This is a tell: even the implementer felt they were related but couldn't quite articulate the shape.

The actual axis:

- **Notifications** = inbound, per-user preferences. "Email me when a deal closes." "Push me at 8am."
- **Communications** = outbound, per-org configuration. "Send mail from this domain." "These SMS senders are verified."

These share zero data, zero permission scope (notifications are user-scoped; communications are org-admin-scoped), and zero UI patterns (toggles vs. provider-credential forms). They should not be peers in the same tab strip.

**Recommendation**: rename **Communications → "Sending"** (or "Channels," "Senders") and move it into the **Integrations** tab as a sub-section. Notifications stays a top-level tab. This drops the "what's the difference?" cost to zero.

---

## 8 · Migration sequence (without breaking muscle memory)

The naming work cannot be a flag-day rename. The product has emails-in-flight, support articles linking specific routes, and customers who learned the existing words. Sequence the cost:

### Phase 0 — discipline-doc (day 0, no shipping)
Write and merge the **Naming Discipline** doc (§9 below). Get one engineer to own the registry. Merge a CI lint that flags new hardcoded persona-sensitive strings.

### Phase 1 — registry expansion (week 1, internal-only)
- Add the P0 keys from §4 (notes, payments, campaigns, surface.finance, pipeline.stage.*).
- Add `aria-label` separation and `singular/plural` shape.
- Add an org-level override layer (white-label substrate).
- **No UI changes ship.** This is pure schema.

### Phase 2 — wire useTerm on remaining surfaces (week 2)
- The 6+ surfaces Holm listed as missing wiring: `/portfolio`, `/listings`, `/marketplace`, `/skip-tracing`, `/team-inbox`, `/offers`, `/negotiation`, `/blind-offer-wizard`, parcel-detail Owner card.
- Each PR is one surface, one concept. Persona switching is the test.

### Phase 3 — homonym fixes (week 3)
- `/maps` → `/map` (301).
- "Communications" tab → "Sending," moved under Integrations.
- "Owner" disambiguation: `properties.owner_name` UI label → "Seller of record"; workspace `team_members.role = owner` UI label → "Workspace owner."
- Notes-vs-notes: rename `/money` Notes tab → "Promissory notes" while `/money` exists; tab dies with `/money` per Holm anyway.

### Phase 4 — URL collapses (week 4–5, behind redirect-preserving)
Apply Holm's `/pipeline → /deals`, `/money → /finance`, `/dashboard → /` etc. with 60-day redirects. **Sidebar updates only after redirects ship**, so links in old support articles still resolve.

### Phase 5 — testid recanonicalization (week 5, async)
- Lint rule: testids may not contain persona strings.
- Sweep the 50 worst offenders (`text-acquisitions`, `text-pipeline-value`, etc.) renamed to system-concept names. Tests update with the rename.

### Phase 6 — communicate (week 6)
- One in-app banner per major rename ("Money is now Finance — same place, simpler word").
- One changelog entry, one help-center article cluster update.
- After 60 days, pull redirects and deprecate the old paths.

**Total clock**: ~6 weeks. **Total user-perceived disruption**: one banner per surface, zero broken bookmarks. **Invariant maintained**: every old URL resolves for at least 60 days post-rename.

---

## 9 · The naming-discipline doc the team should adopt

Three pages. No more. The team I'd want pinned in `docs/engineering/naming.md`:

```
NAMING DISCIPLINE — AcreOS

1. ONE name per concept.
   Every concept the customer thinks about has exactly one canonical name
   in the codebase, one canonical URL, and one canonical testid. Persona
   adaptation is a *display* concern — the canonical name does not change.

2. Concepts get a key in personaVocabulary.ts before they get UI.
   If you're rendering a concept-noun in customer-facing JSX, it must
   come from useTerm(). New concepts add a key first; PR description
   states the canonical name and the per-persona variants.

3. URLs are stable contracts.
   Renaming a concept does not rename its URL without a 60-day redirect.
   Persona does not branch the route table. Defaults can vary; routes
   cannot.

4. testids are the system name, never the display name.
   "card-deal-${id}" stays "card-deal" even when a persona sees it
   labeled "Note acquisition." Lint enforces.

5. Homonyms are bugs.
   If two concepts share a word (Notes the loan / Notes the tab,
   Owner the seller / Owner the workspace role), one of them gets
   renamed. We do not ship two meanings of one word.

6. Synonyms are bugs.
   If one concept has two words in customer-facing UI (Property and
   Parcel and Inventory all meaning the parcels table), pick one and
   renames the others on a sequenced migration with redirects.

7. Founder-only names never leak to customers.
   Atlas, Sophie, Forge, etc. are codenames. Customer JSX uses Pax.
   Lint enforces.

8. Renames are scheduled, not opportunistic.
   A concept rename is a planned cross-surface migration with a single
   owner, an issue that lists every call site, redirects for URLs, and
   a banner for the customer. Not a refactor.

9. Two senses, two words.
   "Notifications" (inbound to user) and "Sending" (outbound from org)
   are different concepts. Same syllable count is not a reason to merge
   tabs.

10. The registry is not optional.
    A surface without useTerm() is incomplete. CI flags hardcoded
    concept-nouns in customer-facing TSX.

OWNER: One engineer owns naming. They review every PR that touches
personaVocabulary.ts, App.tsx routes, or sidebar labels. Disagreements
escalate to the owner; the owner has final call. (At Linear this was me;
here it should be whoever is closest to the IA work — likely the eng
lead nearest Holm.)
```

That's the doc. It's nine rules and one ownership statement. The reason it's short is because *naming discipline is mostly a commitment, not a process* — once the team decides "one name per concept, enforced," the rest follows.

---

## Closing

The naming gap in AcreOS is not catastrophic. The primitive (`useTerm()`) exists. The registry exists. The persona enum is in place. The IA work Holm is doing names the right targets. What's missing is the *commitment* — owner, lint, and the discipline to add to the registry **before** rendering a new concept-noun, not after.

Do that, and AcreOS in six months has nine entity nouns the customer learns. Skip it, and AcreOS in six months has thirty-five and a support team that gets "what's the difference between Property and Parcel?" three times a day.

*— Joaquín Aguilar*
