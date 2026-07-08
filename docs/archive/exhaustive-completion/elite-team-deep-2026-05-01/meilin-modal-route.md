# Mei Lin Davis — Modal vs Route vs Sheet Audit
**AcreOS, 2026-05-01.** Wave 2 of 87. Lens: when a surface is shipped at the wrong altitude — modal where a route belongs, route where a modal belongs, dialog where a sheet belongs — the whole product feels half-architected. I have walked the dialog inventory, the drawer inventory, and the 484-line route table.

## 1 · One-line verdict

**AcreOS is a route-shaped product wearing a 90-modal coat.** The two highest-value surfaces in the app — the lead and the deal — have no shareable URL, while a 30-second cancellation flow gets its own modal-sized chrome. Fix five things and the whole product stops feeling improvised.

---

## 2 · Modal / route / sheet inventory

I counted **86 files importing `Dialog`**, **18 importing `Sheet` outside `responsive-modal`**, **2 in-page detail drawers** (leads, deals), **1 detail route** (`/parcels/:id`), and **484 `<Route>` elements** in `App.tsx`. The full inventory grouped by current shape:

### A. Centered dialogs (`Dialog`) — 60+ surfaces

| Surface | File | Current | Lifetime user spends inside | Recommended |
|---|---|---|---|---|
| Confirm-delete (lead, deal, property, task, doc, view, …) | `confirm-dialog.tsx` (used everywhere) | Dialog | <5s | **Modal — keep.** Textbook yes/no. |
| Safe bulk-delete | `safe-bulk-delete-dialog.tsx` | Dialog | 5–15s | Modal — keep. |
| Cost confirmation (paid lookup) | `cost-confirmation-modal.tsx` | Dialog | 3s | Modal — keep. |
| NPS prompt | `nps-dialog.tsx` | Dialog | 10s | Modal — keep. |
| Cancellation flow | `cancellation-dialog.tsx` | Dialog | 30–60s | Modal — keep, but exit interview belongs on a route (see §4). |
| Keyboard shortcuts cheatsheet | `keyboard-shortcuts-dialog.tsx` | Dialog | 10s | Modal — keep. |
| Credit purchase | `credit-purchase-modal.tsx` | Dialog | 30s | Modal — keep (it's a quick decision). |
| Saved-views selector | `saved-views-selector.tsx` | Dialog | 5s | **Popover** — modal is overkill. |
| Custom-fields editor | `custom-fields.tsx` | Dialog | 2–10 min | **Route** → `/settings/custom-fields`. Configuration is not modal-shaped. |
| Workflow builder | `workflow-builder.tsx` | Dialog (max-w-3xl, max-h-[90vh]) | 5–20 min | **Route** → `/automation/builder/:id`. This is an IDE in a box. |
| Tax-delinquent importer | `tax-delinquent-importer.tsx` | Dialog (sm:max-w-[800px], 4-step state machine) | 3–10 min | **Route** → `/leads/import?source=tax-delinquent`. |
| Notes import | `notes-import-dialog.tsx` | Dialog | 2–5 min | Route → `/finance/notes/import`. |
| Document generator | `document-generator.tsx` | Dialog | 3–10 min | Route → `/documents/new` (or stay modal if it's a quick template pick — see file). |
| Founder setup wizard | `founder-setup-wizard.tsx` | Dialog | 5–15 min | **Route** — already partially routed; finish the move. |
| Onboarding modal (legacy) | `onboarding-modal.tsx` | Dialog | 2–5 min | **Delete** in favor of `OnboardingWizard` (canonical surface, per memory). |
| Onboarding wizard (canonical) | `components/onboarding/OnboardingWizard.tsx` | Mixed | 10–20 min | **Route** — `/onboarding-v2` already exists; ensure no Dialog fallback. |
| Pax connector / project / knowledge panels | `pax-*-panel.tsx` | Sheet (right) | 2–10 min | **Sheet — keep**, but write `?pax=connectors` so the state survives a refresh. |
| Conversation tray (Pax) | `conversation-tray.tsx` | Sheet (bottom-right) | continuous | Sheet — keep. Ambient layer per Holm. |
| Email compose | `email-compose-sheet.tsx` | Sheet | 1–5 min | Sheet — keep (Gmail-compose pattern is correct). |
| Property analysis chat | `property-analysis-chat.tsx` | Sheet | 2–10 min | Sheet — keep, but URL-sync to `/parcels/:id?chat=open`. |
| Phone-numbers settings | `phone-numbers-settings.tsx` | Dialog | 1–3 min | **Route** — already inside `/settings/*`; should be a sub-route, not a modal. |
| Email/mail settings sub-dialogs | `email-settings-content.tsx`, `mail-settings-content.tsx` | Dialog | 2–5 min | **Route** — same logic. |
| AB-test manager | `ab-test-manager.tsx` | Dialog | 5–20 min | **Route** → `/campaigns/ab-tests/:id`. |
| Sequences editor | `sequences-content.tsx` | Dialog | 5–20 min | **Route** → `/campaigns/sequences/:id`. |
| Campaigns variants panel | `campaign-variants-panel.tsx` | Dialog | 5+ min | Route → `/campaigns/:id/variants`. |
| Lost-reason / Quick-offer / Deal-closed | `modals/*-modal.tsx` | Dialog | 10–30s | Modal — keep. These are correct. |
| Request signatures | `request-signatures-dialog.tsx` | Dialog | 1–2 min | Modal — keep (single-step action). |
| Photo gallery (field scout) | `field-scout/photo-gallery.tsx` | Dialog | browse | **Route or hash-state** — gallery items should be linkable. |

### B. Form modals (`ResponsiveModal`) — 4 surfaces (post JC#5)

| Surface | File | Current | Recommended |
|---|---|---|---|
| Add/edit Lead | `pages/leads.tsx` | ResponsiveModal | **Modal — keep.** Form is small enough. |
| Add/edit Deal | `pages/deals.tsx` | ResponsiveModal | Modal — keep. |
| Add/edit Property | `pages/properties.tsx` | ResponsiveModal | Modal — keep. |
| Add/edit Task | `pages/tasks.tsx` | ResponsiveModal | Modal — keep. |

JC#5 was correct — these are small enough for a modal and the mobile sheet variant fixes the 375px squeeze. Don't promote to routes.

### C. In-page drawers — 2 surfaces (the load-bearing problem)

| Surface | File | Current | Recommended |
|---|---|---|---|
| **Lead detail** | `LeadDetailDrawer` in `pages/leads.tsx` (line 2363) | **Local state, no URL** | **Route** → `/leads/:id` or **sheet with URL sync** → `/leads?selected=42`. |
| **Deal detail** | `DealDetailDrawer` in `pages/deals.tsx` (line 1192) | **Local state, no URL** | Same as above. |

Both are >1000 LOC, host inline AI calls (negotiation script, pricing optimizer), checklist editing, stage-gate mutations — users spend **5–30 minutes** inside. Today they cannot share a link to the lead or deal they're discussing on Slack. **This is the largest IA defect Holm did not name.**

### D. True detail routes — 1 surface

| Surface | File | Current | Recommended |
|---|---|---|---|
| **Parcel detail** | `pages/parcel-detail.tsx`, route `/parcels/:id` | Route ✅ | Keep. This is the model the rest of the app should follow. |

### E. Wizards living at modal altitude

| Surface | File | Current | Lifetime | Recommended |
|---|---|---|---|---|
| Offer wizard | `components/offer-wizard.tsx` | **Bottom Sheet, h-[85vh]** | 3–10 min | **Route** → `/offers/new?parcelId=`. This is the offer creation flow; users want to share-link an offer-in-progress. |
| Blind offer wizard | `pages/blind-offer-wizard.tsx` | **Route ✅** | 5–20 min | Keep, but Holm flags it for merge into `/deals`. |
| Founder setup wizard | `components/founder-setup-wizard.tsx` | Dialog | 5–15 min | Route. |
| Onboarding wizard | mixed | partial | 10–20 min | Route — already at `/onboarding-v2`; deprecate the Dialog version. |

---

## 3 · The decision rules — concrete rubric

Pin this above the team's monitor. Every overlay PR must answer all five.

| # | Question | If **YES** → | If **NO** → |
|---|---|---|---|
| 1 | Will the user spend **>2 minutes** inside? | Route | continue |
| 2 | Is the content **shareable** (a teammate would want to send a link)? | Route | continue |
| 3 | Does the user need **deep navigation inside it** (sub-tabs, sub-panels, history)? | Route | continue |
| 4 | Is the content **about something the surrounding page is showing** (a row in a table, a parcel on a map)? | Sheet (right or bottom) with URL sync | continue |
| 5 | Is it a **one-shot decision** (yes/no, confirm, single short form)? | Modal | reconsider — there's a fourth shape (popover, inline edit, page section) |

**Tiebreakers:**
- If the surface has **its own back-button moments** (multi-step, with "Back" between steps) — it's a route. Modals should never need internal back; the parent page is the "back."
- If the URL is the only honest way to answer "what is the user looking at right now?" — it's a route or a URL-synced sheet.
- If a refresh erases meaningful work — it's a route.

**Heuristics that catch 80% of mistakes:**
- "Edit one thing in 30s" → modal.
- "Compose / configure / build" → route.
- "Inspect this row from the table" → sheet, URL-synced.
- "Confirm a destructive action" → modal, AlertDialog variant.

---

## 4 · Misclassified surfaces

### Modals that should be routes (in priority order)

1. **`workflow-builder.tsx`** — a node-graph builder rendered into `max-w-3xl max-h-[90vh]`. Users spend 10+ minutes. There's no way to share a workflow draft. → `/automation/builder/:id`.
2. **`tax-delinquent-importer.tsx`** — 4-state-machine importer (upload → preview → mapping → done) in a single Dialog. Refresh = lose all the column mapping. → `/leads/import/:jobId`.
3. **`custom-fields.tsx`** — schema editor inside a modal. → `/settings/data/custom-fields`.
4. **`ab-test-manager.tsx`**, **`sequences-content.tsx`**, **`campaign-variants-panel.tsx`** — these are *the campaign authoring surfaces*. Authoring belongs at route altitude. → `/campaigns/:id/{ab-tests,sequences,variants}`.
5. **`founder-setup-wizard.tsx`** — multi-step setup wrapped in a Dialog. → `/founder/setup`.
6. **`onboarding-modal.tsx`** (legacy) — redundant with `OnboardingWizard` route. **Delete.**
7. **`offer-wizard.tsx`** — currently a 85vh bottom sheet, masquerading as a modal. Offers are entities; they deserve URLs. → `/offers/new`.
8. **`document-generator.tsx`** — if it's a template picker, modal is fine. If it generates and edits, route.

### Routes that should be modals (or merged away)

| Route | Should be |
|---|---|
| `/onboarding-wizard` (the page version) | Picked: keep the route, kill the Dialog twin. |
| `/cancellation` (if it exists as page) — currently a Dialog | Modal is correct for the *prompt*; the **exit interview** (long-form feedback) should be a route `/feedback/exit` so it survives accidental dismissal. |
| `/changelog`, `/status` | Holm already says: link from `/help`, not the sidebar. Not modal candidates. |

### Sheets that should be routes

- **Pax panels** (`pax-project-panel`, `pax-knowledge-panel`, `pax-connector-panel`) — these are configuration surfaces masquerading as drawers. Connectors especially: 5+ minutes of OAuth dance. Route them under `/settings/integrations/*`.

### Routes that should be sheets

- None significant. This is the rarer mistake in AcreOS — the app over-modals, it doesn't over-route.

### Things misnamed in this audit but actually fine

- `KeyboardShortcutsDialog`, `ConfirmDialog`, `SafeBulkDeleteDialog`, `CostConfirmationModal`, `NpsDialog`, `CreditPurchaseModal`, `LostReasonModal`, `QuickOfferModal`, `DealClosedModal`, `RequestSignaturesDialog` — all correct as modals. Don't touch.

---

## 5 · Deep-linking gaps

The crown-jewel defect: **AcreOS users cannot share a URL to a lead or a deal.**

| Surface | Shareable URL today | Should be |
|---|---|---|
| Lead detail | ❌ | `/leads/:id` (or at minimum `/leads?selected=42`) |
| Deal detail | ❌ | `/deals/:id` |
| Parcel detail | ✅ `/parcels/:id` | Keep |
| Offer-in-progress | ❌ | `/offers/:id` |
| Workflow draft | ❌ | `/automation/builder/:id` |
| Tax-delinquent import job | ❌ | `/leads/import/:jobId` |
| Pax conversation | ❌ | `/pax?conversation=:id` (or kill `/pax`, route via rail state) |
| Saved view (any list) | partial | `?view=` query param everywhere |
| Photo gallery item | ❌ | `?photo=:id` hash state |
| AB-test variant | ❌ | `/campaigns/:id/ab-tests/:testId` |

**Why this matters concretely:**
- "Tom, can you look at this deal?" — today the user screenshots. Tomorrow they paste a link.
- Deep links from Pax notifications cannot land users *inside* a lead/deal — they can only land on the list. This makes the notification feel half-finished.
- Email follow-ups from the activity log can't link back to the row. Every cross-system flow is broken at the entity boundary.
- Founder mode (`/founder/todo`) wants to deep-link into the offending row. Today it can't.

**The fix is small.** Wouter supports route params. The drawers already render from a single ID. The change per surface is ~30 lines:
1. Add `/leads/:id` route, mounting the same `LeadsPage` with `selectedId` from params.
2. On row click: `setLocation(`/leads/${lead.id}`)` instead of `setSelectedLead(lead)`.
3. On drawer close: `setLocation('/leads')`.

Two-day project for both leads and deals. Single largest UX dividend in the codebase per LOC.

---

## 6 · Back-button audit — surprising behaviors

Tested mentally against each overlay class:

| Scenario | Actual behavior | Expected | Surprise? |
|---|---|---|---|
| Open lead drawer → press browser Back | Navigates **away from `/leads`** (drawer never registered in history) | Back closes drawer | **YES — the worst** |
| Open deal drawer → press Back | Same — leaves `/deals` | Back closes drawer | **YES** |
| Open `/parcels/:id` → press Back | Navigates to previous route | Back to list | No |
| Open ResponsiveModal (form) → press Back on mobile | Sheet does **not** intercept hardware back; navigates away | Mobile users expect Back to dismiss the sheet | **YES — mobile** |
| Open Dialog → press Esc | Closes dialog ✅ | ✅ | No |
| Open Dialog → press Back | Navigates away from page | Browser back is undefined-by-design for modal — but on mobile this is unexpected | Mild |
| Open Pax sheet → press Back on mobile | Navigates away | Sheet should intercept | **YES** |
| Inside multi-step Dialog (workflow builder, importer) → press Back | Navigates away, losing all in-flight state | At minimum a confirm | **YES — destructive** |
| Open `/offers/new` (if routed) → press Back | Returns to `/offers` | ✅ | (would be correct after fix) |

**The pattern:** Dialogs and Sheets do not push history entries, so the browser back button is never a "close" on overlays. On desktop this is acceptable (Esc is the close). **On mobile (where there's no Esc and the hardware back button is the user's primary close gesture), every Sheet in the app fails this test.** This is platform-grade unexpected.

**Fix:** the `Dialog` and `Sheet` primitives can `pushState` a transient history entry on open and `popState`-listen for back; close on pop. This is a 30-line change in the primitive layer that lights up every surface. Already a known pattern (Vaul drawer does this; shadcn/ui does not by default).

---

## 7 · Migration sequence — top 5

Ranked by impact-per-day. Each is independently shippable.

### 1. Route the lead and deal detail drawers (2 days, P0)

- Add `Route path="/leads/:id"` and `Route path="/deals/:id"` mounting the same page component.
- Page reads `:id` from params; if present, opens the drawer.
- Row click: `setLocation('/leads/' + id)` instead of local state.
- Close: `setLocation('/leads')`.
- **Wins:** shareable URLs, browser-back closes drawer (because drawer is the route now), Pax notifications can deep-link, exit interviews land on the row. Roughly 60% of the "feels half-architected" sensation comes from these two drawers — fixing them returns most of the perceived polish for a fraction of the work.

### 2. Promote the multi-step modal-as-app surfaces to routes (3 days, P1)

In order: workflow-builder, tax-delinquent-importer, custom-fields, sequences, ab-test-manager. Each becomes `/route/:id`. Each gains shareable-state and refresh-survives-progress. All five share the same migration shape: extract Dialog wrapper, wrap with `PageShell`, add route entry, add back-link.

### 3. Add hardware-back-button handling to `Dialog`, `Sheet`, `ResponsiveModal` primitives (1 day, P1)

Single change in `client/src/components/ui/{dialog,sheet,responsive-modal}.tsx`: on open push a transient state to history; on `popstate` close. Mobile back-button starts behaving correctly across **every** overlay simultaneously. This is the highest leverage one-day fix in the audit.

### 4. URL-sync the Pax panels and conversation tray (1 day, P2)

`?pax=connectors`, `?pax=knowledge`, `?conversation=:id`. Pax becomes link-shareable. Aligns with Holm's "Pax is Spotlight, not a page" thesis: if the rail is canonical, then state in the rail must round-trip via URL.

### 5. Kill the legacy `onboarding-modal.tsx` (0.5 day, P2)

Two onboarding surfaces is one too many (per memory: `OnboardingWizard.tsx` is canonical). Delete the modal twin, redirect any remaining call-sites to the route.

---

**Net effect after these 5 changes:**
- Shareable URLs go from 1 entity (parcel) to 5 entities (parcel, lead, deal, offer, workflow).
- Mobile hardware back works on every overlay.
- Refresh-survives-progress on every wizard.
- `/leads`, `/deals`, `/offers`, `/automation` all use the same modal-vs-route discipline.
- The team has a five-question rubric to enforce in PR review.

---

## 8 · The one design mistake AcreOS will regret in 6 months

If left alone: the lead and deal detail drawers will keep accreting features — inline AI, comments, history, attachments, sub-tabs — until each one is a 3,000-LOC component rendered behind a `useState(null)`. At that point routing them is a 2-week refactor with state-migration footguns, instead of the 2-day add-a-route project it is today.

The cost of "drawer-as-app" isn't paid when it ships. It's paid when you finally have to URL it, and you discover that 14 features assumed the parent's local state. Pay the route cost now while the drawers are still shaped like inspection panels.

The deeper principle: **a URL is a contract with the user that says "you can come back here."** Every surface where the user invests >2 minutes deserves that contract. AcreOS has 11 surfaces today that violate it. By the end of next sprint, that number should be zero.

---

*— Mei Lin Davis*
