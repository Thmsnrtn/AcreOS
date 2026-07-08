# Yelena Volkov — AcreOS user review (Land Investor with ADHD)

I'm Yelena. 33. Brooklyn. Diagnosed ADHD-Combined at 30, after I lost a $14k earnest deposit because I "forgot" the contingency window — which is a lie my brain tells me; what actually happened is I had nineteen Chrome tabs open across three windows, the title commitment was buried in tab seventeen, and the calendar reminder fired while I was hyperfocused on a mineral-rights spreadsheet for a different deal. I did not forget. I context-switched, and the switch cost me $14k.

So when I evaluate AcreOS, I'm not evaluating "is the AI smart" or "are the comps accurate." I'm evaluating: **does this product help me hold a thought, or does it shatter it.** That's the only question that matters for me. Software for ADHD brains is not a UX preference. It is the difference between closing deals and bleeding deposits.

I spent a day inside AcreOS — login, twelve hours of try-to-do-real-work, a deliberate "interrupt-myself" stress test, and a "come back the next morning" cold-start test. Here's what I found.

---

## 1. Thirty-second verdict

Would I sign up today? **Maybe. Conditional on three fixes that, individually, are each less than a week of work.**

The good news: AcreOS has more ADHD-friendly bones than any land platform I've used. Real wizard infrastructure (`OnboardingWizard` persists progress to localStorage AND server). Real notification preferences (`NotificationPreferences` component with calm-matrix philosophy, per-event four-channel toggles, default-conservative). Real quiet hours (`NotificationQuietHours` component, wraps midnight, debounced PATCH, persists to `/api/me/preferences`). Real saved-views, real command palette (`pax-command-palette.tsx`), real sticky breadcrumb (`page-topbar.tsx`).

The bad news: the wizard pattern is **inconsistent across the product**. `OnboardingWizard` saves state. `OfferWizard` (`client/src/components/offer-wizard.tsx`) does not — three steps, no localStorage, no server draft, close the sheet and you start over. `FounderSetupWizard` — same problem. There is **no focus mode** (one stray hit in `pages/conscious-organization.tsx`, nothing app-wide). The `NotificationCenter` polls every 30 seconds and there is no client-side digest/coalesce/throttle to match the server-side digest config. Quiet hours store the preference but the dispatcher does not appear to enforce it on the in-app channel — the bell still pings.

Three fixes — wizard save-state everywhere, real focus mode, enforced quiet-hours on in-app channel — and AcreOS is the first land platform I'd recommend to another ADHD operator. Without them, I'll churn within sixty days because the cost of context-loss will outweigh the value of the AI.

---

## 2. The seven things my brain needs — and what AcreOS actually has

### **(1) Save-state on every input, on every wizard, every time.**

This is non-negotiable. ADHD brains do not finish wizards in one sitting. We get a phone call. We open a tab. The dog needs out. We come back forty minutes later and the field where we typed the seller's mother's maiden name is empty and we will not retype it; we will close the tab and start hating the product.

What AcreOS has:
- `OnboardingWizard` (`client/src/components/onboarding/OnboardingWizard.tsx` lines 126–144) does this **correctly**. Reads from localStorage on mount, writes on every step transition, server-syncs via `/api/onboarding/complete-step`. If I close mid-flow and come back, I land on the step I left.
- `OfferWizard` (`client/src/components/offer-wizard.tsx`) does this **wrong**. Three steps — analysis, letter, confirm. State held in component-local `useState` only. No localStorage key. No `/api/negotiation/pipeline/draft` endpoint to PUT in-progress letter copy. If I'm in the middle of editing the letter (line 207, the `Textarea` for `letter`), close the sheet to check a comp, reopen — I'm back at step `analysis`. The letter I edited is gone. The tier I selected is gone.
- `FounderSetupWizard` — same pattern. No persistence.
- Page-level forms: spot-checked deal create, lead create, campaign create — none of them appear to draft-save. The grep for `localStorage` in `client/src/pages` returns hits for `academy.tsx` (lesson progress), `deal-hunter.tsx` (last-visited timestamp), `founder-dashboard.tsx` (tab + MRR goal), `field-scout.tsx` (offline queue) — but **no form drafts on creates/edits**.

What I'd build:
1. A `useDraftPersistence(key, value, { serverSync })` hook in `client/src/hooks/`. Wraps `useState`, debounces to localStorage on every change (300ms), optionally PATCHes a `/api/drafts/:scope/:key` endpoint. One line per form: `const [letter, setLetter] = useDraftPersistence("offer-letter-" + dealId, "")`.
2. Apply it to every wizard. `OfferWizard`, `FounderSetupWizard`, `BlindOfferWizard` (`pages/blind-offer-wizard.tsx`), every multi-step create flow.
3. A "you have a draft from [time ago]" banner when a wizard reopens with persisted state. **Default action: resume.** Not "start over and lose work" — resume. Make me click a small "discard draft" link if I genuinely want to start over.
4. A `drafts` table on the server. `(userId, scope, key, payload jsonb, updatedAt)`. TTL 30 days. Surface a "Drafts" page somewhere I can find them — `/drafts`, accessible from the command palette.

This is two days of work and it would do more for my retention as a customer than any AI feature on the roadmap.

---

### **(2) Default-to-resume — never default-to-start-over.**

Adjacent to (1) but distinct. When I land on `/deals/:id` after a context switch, the question is not "what does this deal look like" — it's "**what was I doing here before**." That second question is invisible to AcreOS today.

What AcreOS has: nothing structured. `deal-hunter.tsx` (line 978-983) records a `LAST_VISITED_KEY` timestamp in localStorage but uses it only to highlight new items since last visit. There is no per-entity "last action context" that says "you were drafting an offer letter, you stopped at step 2."

What I'd build:
1. An `activity_resume` localStorage key — last 5 in-progress flows. `[{ scope: "offer", entityId: 17, step: "letter", lastEdit: 1714521600 }, ...]`.
2. On `/dashboard`, a "Pick up where you left off" panel — top of the page, above the fold, dismissible per-day, **not** dismissible permanently. The dismissal is per-day because tomorrow-me is a different person than today-me and tomorrow-me will need it again.
3. When I arrive at an entity I have an in-progress draft on, auto-restore the wizard to the last step with a "(Resumed from yesterday)" pill at the top.

---

### **(3) Notification overload — enforce the matrix you already built.**

The `NotificationPreferences` component is genuinely good. Per-event, four-channel matrix, opt-in framing, global mute switch, calm copy ("conservative defaults — flip a toggle to opt in deliberately"). The `NotificationQuietHours` component is good. The server has `digestDay`/`digestHour` config, weekly digest concept, batch summary patterns.

But:

**`NotificationCenter` polls `/api/notifications/count` every 30 seconds (line 83).** Every thirty seconds my bell can update. Every update is a peripheral-vision distraction for an ADHD brain. The server-side digest config doesn't help me here because in-app is not a digestable channel — the bell is the bell.

**Quiet hours are stored, but I cannot find evidence the dispatcher checks them.** Grepped `notificationDispatcher.ts` and `notificationPreferences.ts` for `isQuietHours / inQuietWindow / suppress / skipNotification` — zero hits. The pref persists. Whether the dispatcher honors it on the in-app channel is unclear; I don't see the gate. (It may be enforced for email/SMS/push at the channel layer, but the in-app `notifications` table appears to insert regardless.)

**There is no "what's important right now" filter on the bell.** The bell shows everything: `task_assigned, task_due, task_overdue, deal_update, deal_stage_changed, payment_received, payment_missed, lead_response, lead_assigned, team_mention, automation_triggered, system_alert, agent_action_completed, agent_decision_made, trust_promotion, agent_proactive`. Sixteen types. No urgency tier. No "show me only what blocks me from finishing what I'm doing right now."

What I'd build:
1. **Bell polling: 30s → 5 minutes by default**, with a "live" toggle for power users. Or better: WebSocket-pushed notifications with a server-side coalescer — debounce by user for 60 seconds, only push if `severity >= medium` outside an active session.
2. **Enforce quiet hours on the in-app channel** in `notificationDispatcher.ts`. During quiet hours, queue notifications to a `pending_notifications` table; flush at window-end with a single "you have 14 things from overnight" digest entry.
3. **Severity tier** on notification types. `system_alert, payment_missed, task_overdue` are red. `agent_proactive, trust_promotion, automation_triggered` are dim and collapsible. Bell counts only red+amber by default.
4. **A "focus session" toggle** that suppresses ALL in-app notifications for 25/50/90 minutes, surfaces only the digest at the end. (See item 5.)

---

### **(4) Focus mode — there isn't one. There needs to be one.**

I grepped the entire `client/src` tree for `focus-mode | focus.?mode | distraction | deep.?work | hide.?nav` — one hit, in `pages/conscious-organization.tsx`, unrelated. There is no focus mode in AcreOS. This is the single biggest UX gap for my brain.

I do not need a meditation app. I need: a button I can press that says "I am working on this one deal for the next 50 minutes, hide everything else."

What I'd build:
1. **`/focus/:entityType/:entityId`** route. Renders the entity (deal, lead, parcel, campaign) full-screen. Sidebar collapsed. Topbar minimal. Bell hidden. Pax rail hidden by default (it can be shown but not auto-popping). Command palette still works. Theme is forced to a low-distraction variant — flatter contrast, no ambient animations.
2. **Pomodoro shell** around it. 25/50/90 minute defaults, big timer, end-of-session breakdown ("you spent 47 minutes here. Drafted: offer letter. Touched: 3 comps. Stopped at: confirm step.") This breakdown is critical — ADHD brains lose track of what they accomplished and feel useless even on productive days. The breakdown converts invisible work into evidence.
3. **"Focus session" toggle on the page-topbar** that activates focus mode for the current entity. One click, two seconds.
4. **`focus_sessions` table.** `(userId, entityType, entityId, startedAt, endedAt, completedActions jsonb)`. Queryable. "How much time did I spend on the Henderson deal" is a question I will ask weekly.
5. **Auto-resume into focus mode** if I left one in progress. Same default-to-resume principle as (2).

---

### **(5) Distraction hide — the Pax rail and the activity feed are loud.**

`pax-copilot-rail.tsx` is a persistent right-side rail. `notification-banner.tsx` is a top-of-page banner pattern. `usage-limit-banner.tsx`, `trial-banner.tsx`, `disclaimer-banner.tsx`, `cookie-consent-banner.tsx` — bannerlands. Each one individually is fine. Collectively they're peripheral motion that keeps stealing my attention from the field I'm trying to fill in.

What I'd build:
1. **A "calm mode" preference** on the user level (one notch below focus mode). When on: Pax rail collapsed by default, activity timeline hidden, banners collapsed to a single "3 advisories" pill, ambient `framer-motion` animations disabled.
2. **Honor `prefers-reduced-motion`** as a hard signal — not a soft one. Today the codebase uses `staggerContainer` and `staggerItem` in `client/src/lib/animations.ts`; verify those respect `prefers-reduced-motion: reduce` and short-circuit. If they don't, fix that.
3. **Pax rail open-by-default is wrong for me.** Open-on-demand. The rail context (`contexts/pax-rail-context.tsx`) already persists state — change the default for new users to closed, and let the user opt in.

---

### **(6) Tab-flooding — push me toward in-app split-pane, not new tabs.**

My ADHD failure mode is opening 19 Chrome tabs because every cross-reference becomes "let me just open this in a new tab." AcreOS has the bones for an in-app split-pane (a "_picker-verification-03-split-view.png" screenshot exists in `docs/exhaustive-completion/auth-screenshots/`) but the dominant pattern in the product is `<Link href="/leads">` from the notification center, full-page navigation.

What I'd build:
1. **Cmd-click on entity links opens a side panel, not a new tab.** Right rail, 50/50 split with current page. Stack of recent panels. ESC closes. This is the #1 anti-tab-flood pattern.
2. **A "recently opened" stack** in the command palette. Last 10 entities I touched, jump back instantly. (`pax-command-palette.tsx` already has the surface — add a "Recent" section above search.)
3. **"Open in this view"** as the default action everywhere, "Open in new tab" as a secondary action. Today it's the inverse for browser-native links.

---

### **(7) Structured wizard flows everywhere — not just onboarding.**

`OnboardingWizard` is 854 lines and gets the structure right: numbered steps, progress indicator, "skip for now" affordance, persistence, server sync. That structure should be the **template** for every multi-decision flow in the product, not a one-off.

Today, things that should be wizards but aren't:
- **Lead import.** I grepped — there's a `csv-import` flow but it's not wrapped in a step-by-step wizard with progress UI and per-step save.
- **Deal close-out.** Closing a deal involves: title commitment review, contingency releases, closing-cost reconciliation, post-close tasks. Today it's spread across five separate pages with no enforced order. For my brain that's a tab-flood trigger.
- **Campaign launch.** Today campaigns have a "create campaign" form. It should be a wizard: audience → message variants → schedule → budget → launch.
- **Parcel due-diligence.** `due-diligence-panel.tsx` exists but it's a flat checklist. A guided "next thing to verify" flow with save-state would be better for my brain.

What I'd build:
1. **A reusable `<StepWizard>` component** with built-in `useDraftPersistence`, progress bar, "skip" and "back" affordances, "you have a draft from X ago" banner on resume.
2. **Migrate the wizards above to it.** Don't build seven wizards from scratch — build one shell, mount seven configs.
3. **A "what should I be doing next" surface** on the dashboard, drawing from in-progress wizards. "You started a campaign launch yesterday — finish it (3 steps left)." Same default-to-resume logic.

---

## 3. Where AcreOS is actually best-in-class for my brain (credit where due)

- **Sticky breadcrumb in `page-topbar.tsx`.** This is invaluable. After a context-switch, I look at the breadcrumb to remember where I am. Many products bury this. AcreOS doesn't.
- **Command palette (`pax-command-palette.tsx`).** Cmd-K everywhere. This is the right pattern for "I forgot how I get to the thing I need" — keyboard-first, search-first.
- **The `NotificationPreferences` calm-matrix philosophy** ("conservative defaults — flip a toggle to opt in deliberately"). This is the right defaults posture for ADHD users. Just enforce it server-side.
- **`OnboardingWizard` persistence pattern.** It works. The fix is to copy this pattern, not invent a new one.
- **`focus-list.tsx` as a concept** — "here is the next action for each lead." That's exactly how my brain wants to consume a lead pipeline. Don't make me decide; tell me the next move and let me do it. (Today it's used on the leads page; it should be a global pattern for every list view.)

---

## 4. The single change that would make me a paying customer tomorrow

Build `useDraftPersistence` and apply it to `OfferWizard`. One hook, one wizard, two days of work. Then I can start an offer letter, get pulled into a phone call, and come back to **the exact text I was typing**, with a small pill that says "Resumed from 47 min ago."

That's not a feature. That's the difference between churn and renewal.

---

## 5. Verdict in one paragraph

AcreOS already has 70% of the bones for an ADHD-friendly platform — wizard infrastructure, notification matrix, quiet hours, command palette, sticky breadcrumb. What it's missing is: **consistent application of those bones across every flow, plus a real focus mode, plus enforcement of the preferences it stores.** The fixes are small. The ROI on retention for the ~15% of operators with ADHD (and the ~50% who'd benefit from ADHD-friendly defaults whether they have it or not) is enormous. Ship the three fixes — wizard save-state everywhere, focus mode, enforced quiet hours on in-app — and AcreOS becomes the reference platform for neurodivergent land investors. Don't ship them and we'll churn quietly, because we won't tell you why; we'll just stop logging in.
