# Persona Simulation: Marcus Chen -- J1 Landing to First Parcel

| Field | Value |
|---|---|
| Persona | Marcus Chen, 38, CEO of Desert Ridge Land Acquisitions, Phoenix AZ |
| Device | Desktop 1440x900 |
| Browser | Chrome |
| Network | Fast (fiber) |
| Session | Fresh (incognito) |
| Concurrency | CONC-50 (evaluating with scale in mind -- 10,000+ parcels) |
| Input | Keyboard-only (no mouse) |
| Date | 2026-04-18 |

---

## Persona Context

Marcus manages 10,000+ parcels across 8 states. He runs a 5-person team. He navigates everything keyboard-first and types 95 WPM. He's evaluating AcreOS as a potential replacement for Salesforce ($380/mo), Google Sheets, Airtable, and a custom scraping script. His CSV export has 10,247 rows ready to import on day one. If the product can't handle his volume, it's a toy.

> "If it can't handle 10,000 parcels without choking, it's a weekend project, not a product."

---

## Step 1: Arrival at acreos.fly.dev/ (Keyboard Navigation)

**Action:** Marcus types `acreos.fly.dev` and starts navigating with Tab immediately. He does not touch the mouse.

**Tab order observed:**

1. Tab 1: Unclear -- may land on the page body or skip link (if one exists). **There is no skip-to-content link.** Marcus must tab through every nav element before reaching the main content.
2. Tab 2: "Pricing" link (ghost button in nav)
3. Tab 3: "Sign In" link (ghost button in nav)
4. Tab 4: "Get Started Free" link (primary button in nav)
5. Tab 5-13: The 9 strategy badges (Wholesaling, Fix & Flip, etc.) -- these are `<Badge>` components. They're not interactive links but they may still be focusable depending on the underlying DOM element. If they're `<div>` or `<span>` elements without `tabindex`, Tab will skip them. If they're implemented as focusable elements, Tab stops on each one -- wasting 9 keystrokes.
6. Tab 6 (or 14): "Start Free" link/button in hero
7. Tab 7 (or 15): "View Pricing" link/button in hero
8. Then through the 6 feature cards (if card links are focusable)
9. Then the 4 pricing teaser cards
10. "See Full Comparison" link
11. "Get Started Free" link in final CTA
12. Footer: "Pricing" link
13. Footer: "Sign In" link

**Focus visibility:** The shadcn/ui Button component provides focus rings via Tailwind's `focus-visible:ring-2`. These should be visible. The Link components wrapped in Button `asChild` should inherit focus styles. Marcus confirms focus rings are visible on the primary buttons.

### Marcus's Reaction: Efficient but Unremarkable

> "Tab order is linear, top to bottom. No skip link, so I have to tab through the nav every time. The badges might eat 9 extra tabs if they're focusable -- let me check."

He inspects with Tab: the strategy badges are rendered as `<Badge>` (likely `<div>` with styling). They're not focusable. Good -- no wasted keystrokes.

> "OK, the landing page is simple enough. I don't need to spend time here. Let me check if this thing can handle scale. Pricing first."

**What Marcus reads (speed-reading the hero):**

- "The operating system for real estate professionals" -- acceptable framing.
- "manages leads, automates outreach, and closes deals" -- relevant to his operation.
- He spots "Land" in the strategy badges. Good.
- "500+ Properties managed" -- Marcus manages 10,000+ himself. This social proof tells him the platform is early-stage.

> "500 properties managed. I have 10,247 in a CSV right now. Either this number is total across all users, which means I'd be their biggest user by 20x, or it's per-user, which might be OK but still small. Let me check the pricing for scale limits."

**FRICTION EVENT F-01: No skip-to-content link.**
Every page load requires tabbing through the entire nav bar before reaching content. For a keyboard-only user who navigates 50+ pages per evaluation session, this adds up.

---

## Step 2: Pricing Page (Keyboard-Only)

**Action:** Marcus presses Enter on "Pricing" (Tab 2 in the nav). URL: `/pricing`.

**Tab order on pricing page:**
1. ArrowLeft + AcreOS logo link (back to home)
2. "Get Started" button (nav, links to `/auth?mode=register`)
3. Monthly/Annual toggle button
4. Through 4 tier card CTAs: "Get Started" (Free), "Start 14-Day Free Trial" (Starter), "Start 14-Day Free Trial" (Pro), "Start 14-Day Free Trial" (Scale)
5. "Contact us" mailto link
6. Footer: "Home" link
7. Footer: "Sign In" link

**The billing toggle:** Marcus tabs to it, presses Enter (or Space). The toggle switches between Monthly and Annual. This is a custom `<button>` element -- it responds to both Enter and Space. The visual state updates. No ARIA `role="switch"` or `aria-checked` attribute, but it functions correctly with keyboard.

**Feature comparison table:** Marcus tabs through the table area. The table itself is a standard `<table>` element -- not focusable, but cell content is readable. The Check/X icons use lucide-react `<svg>` elements. No `aria-label` on the Check/X icons -- a screen reader would not know what they mean, but Marcus is sighted and keyboard-only, so this doesn't block him.

### Marcus's Critical Evaluation of Pricing

Marcus reads the feature table methodically:

| Feature | What Marcus Needs | What AcreOS Offers (Scale $79/mo) |
|---|---|---|
| Leads | Unlimited | Unlimited -- OK |
| Properties | 10,000+ | Unlimited -- OK |
| Team Seats | 5 people | 10 (add more at $40/seat) -- OK but $40/seat is steep |
| Campaigns | Heavy usage | Unlimited -- OK |
| Bulk operations | 3,000 at once | Not mentioned -- RED FLAG |
| CSV import | 10,247 rows | Not mentioned -- RED FLAG |
| CSV export | Full data | Not mentioned -- RED FLAG |
| API access | Required for Node.js scripts | Not mentioned -- RED FLAG |
| Webhooks | Required for Zapier | Not mentioned -- RED FLAG |

> "The pricing page tells me what I get but not what I can DO. Unlimited leads and properties -- fine. But can I import 10,000 records at once? Can I select 3,000 and bulk-update their status? Can I export a filtered view to CSV? Can I hit an API endpoint from my scripts? None of this is answered."

> "$79/month for Scale. I'm paying $380/month for Salesforce. If this product actually works at my scale, it's a no-brainer. But 'unlimited' doesn't mean 'performant.' I need to get inside and test."

**FRICTION EVENT F-02: No mention of bulk operations, import limits, export, or API.**
For a power user evaluating a platform to replace Salesforce, the pricing page is silent on the capabilities that matter most: import/export limits, bulk operation support, API access, and webhook integration. These are the features that determine whether the product is viable at scale.

---

## Step 3: Navigate to Auth (Keyboard-Only)

**Action:** Marcus presses Shift+Tab to go back to the nav, finds "Get Started" button, presses Enter. URL: `/auth?mode=register`.

**What he sees:** Clerk SignUp widget centered on a blank page. Because the URL has `?mode=register`, the widget shows the registration form. **Known fix pending deploy** -- if the deployed version links to `/auth` without the query param, Marcus would see Sign In first.

**Keyboard navigation of Clerk widget:** The Clerk widget is a third-party component. Its internal keyboard navigation depends on Clerk's implementation. Typically:
- Tab moves between input fields (email, password, name)
- Enter submits the form
- Social login buttons (if present) are focusable and activatable

Marcus fills out the form quickly (95 WPM). Email, password, done.

Below the widget, the toggle link ("Already have an account? Sign in") is focusable via Tab and activatable via Enter.

### Marcus's Reaction: Fast, No Issues

> "Standard auth. Fine. Let me get inside."

He submits, waits for the loading spinner (no text, no progress indicator -- just a spinning circle), and gets redirected.

**Redirect destination:**
- If onboarding-v2 fix is deployed: `/onboarding-v2`
- If not deployed: `/today`

**Known fix pending deploy.**

---

## Step 4: First Authenticated View

### Scenario A: Redirected to /onboarding-v2

Marcus sees the path selection screen:
- **Beginner:** "Where Do You Want to Invest?"
- **Active:** "Upgrade your investing operation" -- Import Your Existing Portfolio
- **Enterprise:** "Configure AcreOS for your team" -- Set Up Your Team

Marcus selects **Enterprise**. He has a team of 5 and needs team configuration.

The Enterprise path:
1. Team setup -- invite deal analysts, VAs, closing coordinators
2. Connect tools -- CRM, accounting, communication stack
3. Market scan -- scan all target markets simultaneously
4. Configure deal workflows -- custom pipeline stages and automation rules

**Friction:** Step 1 asks to invite team members by email. Marcus would do this, but first he needs to verify the platform can handle his data. He doesn't want to invite his team to a product that might choke on import.

> "Don't ask me to invite my team before I've proven this thing works. I need to import 10,000 parcels and see if the list view renders in under a second. Then I'll invite people."

He clicks through the onboarding steps (if a "Skip" option exists) or completes minimal info to get to the dashboard.

### Scenario B: Redirected to /today

Marcus lands on the Today dashboard. Stat cards show zeros. The onboarding wizard modal may appear.

In either scenario, Marcus wants to get to the properties/pipeline view immediately and test:
1. Can he import a CSV?
2. How fast does the list render?
3. Can he bulk-select and update?
4. Can he filter with compound conditions?

---

## Step 5: Keyboard Navigation in the Authenticated App

**Action:** Marcus tabs through the authenticated interface to find the import function.

**Sidebar navigation:** The PageShell component renders a sidebar on desktop (1440px). The sidebar items should be focusable via Tab. Marcus tabs through:
- Today
- Pipeline
- Properties
- Money
- AI
- Agents
- Settings
- (and potentially more items)

**Keyboard shortcuts:** Marcus hits `?` to check for a keyboard shortcuts help dialog. He tries `Cmd+K` for a command palette. He tries `g then p` for go-to-properties (vim-style).

The app has a command palette (`command-palette.tsx`) bound to `Cmd+K`. If this works, Marcus can jump to any page instantly:
- Dashboard (/)
- Pipeline
- Properties
- Settings
- etc.

> "Cmd+K works. OK, that's good. Let me search for 'import.'"

**FRICTION EVENT F-03: Unknown keyboard shortcuts.**
The landing page and pricing page don't mention keyboard shortcuts. There's no `?` shortcut help dialog documented. Marcus discovers `Cmd+K` by instinct. A power user shouldn't have to guess -- keyboard shortcuts should be documented in the product (tooltip on first use, or a help dialog).

---

## Step 6: Evaluate Import and Scale

**Action:** Marcus navigates to the properties or pipeline view and looks for an import function.

**What he's looking for:**
- An "Import CSV" button or menu item
- Support for 10,000+ row files
- Field mapping UI (his CSV columns won't match AcreOS's field names exactly)
- Progress indicator for large imports
- Error handling for bad rows (his CSV has some messy data)

**What he expects to find based on the onboarding wizard:** The v1 onboarding wizard (if shown) has an "Import Leads" step. The v2 onboarding (active path) has a "Import Your Existing Portfolio" step. Both suggest import functionality exists.

**Potential issues at scale:**
- The import endpoint might have a row limit (e.g., 5,000 rows) that silently truncates
- The UI might time out during a 10,247-row import
- The list view might not paginate efficiently -- loading all 10,247 records into a React state array would kill performance
- Filtering might be client-side (O(n) scan of all records) rather than server-side (indexed DB query)

> "I need to test this with my actual CSV. If the import works and the list view renders 10,000 records without choking, I'll bring my team in. If it freezes, stutters, or silently drops records, I'm closing this tab and going back to Salesforce."

Marcus cannot fully test import during this landing-page evaluation, but he's looking for signals:
- Is there a documented import limit? (No -- he checked pricing, help, and settings)
- Does the list view have server-side pagination? (Visible in network tab -- does `/api/properties` accept `?page=1&limit=50` params?)
- Are there bulk action buttons (select all, update status, delete, export)?

**FRICTION EVENT F-04: No documented import limits or scale capabilities.**
The product claims "unlimited properties" on the Scale tier but doesn't state maximum import size, whether imports are synchronous or queued, or what happens with malformed rows. For a user importing 10,247 records, this ambiguity is a blocker.

---

## Step 7: Check for API/Webhook Support

**Action:** Marcus opens DevTools (he does this within 5 minutes of using any product) and checks the Network tab.

**What he sees:**
- REST API calls to `/api/properties`, `/api/leads`, `/api/organizations`, `/api/dashboard/intelligence`, etc.
- JSON responses with standard structure
- Authentication via cookies (Clerk session)
- No visible rate limiting headers

**What he looks for next:**
- A Settings > API Keys section
- A Settings > Webhooks section
- A developer documentation link
- An OpenAPI/Swagger endpoint

**What he finds:** Based on the source code, there is no public API key management, no webhook configuration UI, and no developer documentation. The APIs are internal-only, authenticated via Clerk sessions.

### Marcus's Reaction: Dealbreaker Territory

> "The API exists -- I can see it in the network tab. Clean REST endpoints, JSON responses, good structure. But there's no way for me to call it from my scripts. No API keys. No OAuth tokens. No webhook registration. My Node.js scraper pushes data into Salesforce via their API. I can't do that here."

> "This is a closed ecosystem. Data goes in through the UI and stays there. For someone managing 10,000 parcels with automated workflows, this is a non-starter."

**FRICTION EVENT F-05: No public API or webhook support.**
Marcus's existing operation relies on a custom Node.js script that scrapes county assessor sites and pushes data into Salesforce via API. Without API access, he cannot integrate AcreOS into his existing workflow. He would need to abandon his custom tooling entirely and rebuild everything inside AcreOS -- a migration risk he won't accept without proof of scale performance.

---

## Final Verdict: NOT YET -- Needs Scale Proof and API Access

Marcus sees a product with good engineering fundamentals (React, Vite, clean API structure, Cmd+K command palette) but critical gaps for power users:

1. **No API access** -- his automation scripts can't integrate
2. **No documented scale limits** -- he can't risk importing 10,247 records without knowing if the platform can handle it
3. **No bulk operation documentation** -- "unlimited" on the pricing page doesn't mean "performant at scale"
4. **Weak social proof** -- 500 properties managed vs. his 10,000+

The product is designed for users managing 10-500 parcels. Marcus manages 10,000+. He's not the target user yet, and the product isn't ready for him.

---

## Friction Events

| # | Event | Severity | Description |
|---|-------|----------|-------------|
| F1 | No skip-to-content link | MEDIUM | Every page requires tabbing through the full nav before reaching content. For keyboard-only navigation across dozens of pages, this is cumulative friction. |
| F2 | No bulk operations, import limits, or API mentioned on pricing page | HIGH | The pricing page lists feature counts (leads, properties, seats) but says nothing about import size limits, bulk operation support, export capabilities, or API access. These are the decision-making features for a power user. |
| F3 | Keyboard shortcuts undocumented | MEDIUM | Cmd+K command palette exists but is not documented anywhere. No `?` help dialog, no tooltip on first use, no keyboard shortcuts section in settings or help. |
| F4 | No documented import limits or scale capabilities | HIGH | "Unlimited properties" on the Scale tier doesn't address maximum import size, queue/sync behavior, or malformed-row handling. A user preparing to import 10,247 records needs this information before committing. |
| F5 | No public API or webhook support | CRITICAL | The internal REST API is clean and well-structured but inaccessible to external scripts. No API keys, no OAuth tokens, no webhook registration. This blocks integration with Marcus's existing Node.js automation and eliminates AcreOS as a Salesforce replacement. |
| F6 | No product screenshots on landing page | LOW | Marcus doesn't need screenshots (he evaluates by using the product), but the absence of data-dense UI imagery (tables, filters, bulk actions) means he can't assess the product's power-user capabilities from the landing page. |
| F7 | Billing toggle lacks ARIA attributes | LOW | The monthly/annual toggle works with keyboard (Enter/Space) but has no `role="switch"` or `aria-checked`. Functional but not semantically correct. |
| F8 | Social proof suggests small scale | MEDIUM | "500+ Properties managed" is a positive signal for the product's general traction but a negative signal for scale readiness. Marcus needs evidence that the platform has been tested at 10,000+ record volumes. |
| F9 | Auth page unbranded | LOW | Minor issue for Marcus -- he doesn't care about branding. But the Clerk widget on a blank page is a generic experience. |
| F10 | Onboarding asks for team before proving scale | MEDIUM | The Enterprise onboarding path asks to invite team members before Marcus has verified the platform can handle his data volume. He won't invite his team to an unproven tool. |

---

## Recommendation Score

**4/10 -- Strong foundation, missing power-user infrastructure.**

The engineering quality is solid. The command palette works. The API structure (visible in DevTools) is clean. But without public API access, documented scale limits, and bulk operation capabilities, AcreOS cannot replace Salesforce for a 10,000+ parcel operation. Marcus would need to see:
- API key management and webhook support
- Documented import limits (>10,000 rows)
- Evidence of sub-second query performance at scale
- Bulk select-all-across-pages with status update support

He'll check back in 6 months. If API access ships, he'll do a full-scale import test.

---

## Verbatim Quotes (Marcus Would Say)

1. "I can see the API in the network tab. It's clean -- RESTful, JSON, proper status codes. But I can't call it from my scripts. That's like having a sports car with no ignition key."

2. "The pricing page tells me I get 'unlimited properties' but doesn't tell me if I can import 10,000 at once, filter them in under a second, or bulk-update 3,000 records. 'Unlimited' is a marketing word, not an engineering spec."

3. "500 properties managed. I manage 10,247. Am I going to be the stress test that breaks this thing?"

4. "Cmd+K command palette works. That's the first thing that's impressed me. Now show me the keyboard shortcuts for the list view -- j/k navigation, x to select, Shift+click for range select. If I have to click checkboxes with a mouse, this isn't for me."

5. "Don't ask me to invite my team before I've proven this thing can handle our volume. If I bring five people onto a platform that chokes at 10,000 records, I'm the one who looks stupid."
