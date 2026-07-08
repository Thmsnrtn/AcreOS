# Kunle Oyedepo — Support Tooling Deep Audit

**Lens:** I worked Zendesk Premier and Front Engineering. The thing nobody admits is that "support tooling" is what determines whether your customers like you in year two. Feature velocity wins year one. Then a customer hits something broken at 11pm on a Tuesday, and how that path runs — from "they typed a sentence" to "fix shipped" — is your retention engine. AcreOS has built more agent automation than most Series-A vendors and the *bones* of a real ticketing system, but the human-side workflow is a single textarea.

---

## 1. One-line verdict

**B-minus on the bones, C on the workflow.** The data model is solid (two-tiered: Sophie-resolved `supportCases` + customer-facing `supportTickets`, full SLA math, escalation reasons, action audit trail, KB articles with auto-fix metadata). The *human* layer — the thing a support engineer actually uses — is missing macros, missing customer context, missing assignment, missing CSAT capture, and has no bug-to-engineering bridge. At 5 customers Thomas eats the friction; at 50 it costs 8–10 hrs/week.

---

## 2. Intake + triage — current vs. needed

### Current state

| Channel | Surface | Status |
|---|---|---|
| **In-app ticket form** | `/api/support/tickets` POST (in `routes-support-tickets.ts`); creates `supportTickets` row with `pageContext` + `errorContext` (browser, screen, stack) | EXISTS |
| **Pax chat** | `customerSupportAutoResolver.ts` → creates `supportCases` row, classifies via `supportBrain.ts` | EXISTS |
| **Email** | None — no inbound email-to-ticket pipe. `support@acreos.io` (or whatever Thomas uses) goes to Thomas's personal inbox, not into the ticket store. | **MISSING** |
| **Live chat widget on marketing site** | None | **MISSING** (acceptable pre-launch) |
| **Bug report from inside-app error boundary** | Stack/page captured to `errorContext` *if* user opens the form; auto-capture on uncaught error → ticket draft does not exist | **PARTIAL** |
| **Triage** | `supportBrain.classifyMessage()` (gpt-4o-mini): category, confidence, sentiment, urgency, suggested playbook. Maps urgency → priority 1–5. Auto-routes to playbook or escalates if confidence < 0.4 or aiAttempts ≥ 3. | EXISTS |
| **Human triage queue** | `/admin/support` shows `escalated` cases sorted by SLA. No "needs triage" lane separate from "needs reply." | **PARTIAL** |

### Needed for 50-customer scale

1. **Inbound email pipe.** `support@acreos.io` → SES inbound → webhook → `createSupportTicket(source: "email")` with reply-by email-thread matching on `Message-ID` / `In-Reply-To`. ~1.5 days. Without this, every customer who emails (which they will, regardless of in-app form) lands in Thomas's personal inbox and is invisible to metrics.
2. **Auto-capture from error boundary.** When `ErrorBoundary` catches a render-tree crash or `window.onerror` fires, prefill a ticket draft with stack, route, user state. One-click "send to support."
3. **Triage lane in `/admin/support`.** Today escalated == needs human. Split into: (a) **inbox** — newly arrived, not yet classified or assigned; (b) **mine** — assigned to me; (c) **waiting on customer**; (d) **breached SLA**. Today the page shows only one queue.

---

## 3. SLA proposal — by tier × priority

The current SLA table is uniform across tiers (priority 5 = 1h, 4 = 4h, 3 = 24h, 2 = 48h, 1 = 72h). At 50 customers across Free/Starter/Pro that's wrong: a Free user with a "feature question" should not block a Pro user with "billing broken." Tiered SLAs.

### First-response SLA (hours)

| Priority | Free | Starter | Pro | Enterprise |
|---|---:|---:|---:|---:|
| 5 — Critical (app down, billing broken, data loss) | 4 | 2 | 1 | **30 min** |
| 4 — High (feature broken, blocking workflow) | 12 | 6 | 4 | 2 |
| 3 — Medium (degraded, workaround exists) | 48 | 24 | 12 | 8 |
| 2 — Normal (question, minor issue) | 72 | 48 | 24 | 12 |
| 1 — Low (feature request, nice-to-have) | best-effort | 96 | 72 | 48 |

### Resolution SLA (hours)

| Priority | Free | Starter | Pro | Enterprise |
|---|---:|---:|---:|---:|
| 5 | 24 | 12 | 4 | 2 |
| 4 | 72 | 48 | 24 | 12 |
| 3 | 1 wk | 5 d | 3 d | 2 d |
| 2 | 2 wk | 1 wk | 5 d | 3 d |
| 1 | none | none | none | 2 wk |

### Implementation note

`SLA_HOURS` in `shared/schema.ts:3170` is a flat object. Replace with `SLA_HOURS_BY_TIER[tier][priority]` and pass `org.subscriptionTier` into `computeSla()`. ~2 hours of work plus a backfill to recompute existing cases. Without tiered SLAs the founder will inevitably hit "I worked a Free user's feature question for 30 minutes while a Pro user's billing case breached" within the first month of launch.

---

## 4. Customer-context sidebar spec for /admin/support

When a case is open, the right rail (or a slide-over panel) should render. Read-only, no edits — that's what other admin pages are for.

```
┌─ CUSTOMER CONTEXT ─────────────────────┐
│  Jane Doe — jane@acme.com              │
│  Acme Land Co. (org #142)              │
│  Pro · MRR $99 · since Jan 2026 (3 mo) │
│                                        │
│  ── Health ──────────────────────────  │
│  Activation:   ████████░░  80%         │
│  Churn risk:   Low (12)                │
│  Last active:  2 hours ago             │
│  NPS (last):   8                       │
│                                        │
│  ── Account ─────────────────────────  │
│  Plan:    Pro ($99/mo, renews May 12)  │
│  Credits: $14.20                       │
│  Seats:   3 / 5 used                   │
│  BYOK:    Regrid connected             │
│                                        │
│  ── Past tickets (5) ────────────────  │
│  • #87  CSV import — resolved 2d       │
│  • #71  Note compliance — resolved 1w  │
│  • #62  BYOK setup — resolved 2w       │
│  • #54  Pricing question — closed 3w   │
│  • #41  Onboarding stuck — resolved 1m │
│                                        │
│  ── Recent activity (last 5) ────────  │
│  • 14:22  enriched APN 002-…           │
│  • 14:01  imported 47 leads            │
│  • 13:47  viewed deal #392             │
│  • 13:30  signed in (mobile)           │
│  • 11:14  ran campaign "Q2 mailer"     │
│                                        │
│  ── Recent errors (last 3) ──────────  │
│  • 13:42  500 /api/parcels/…  ATTOM    │
│  • 11:09  429 /api/enrich  rate limit  │
│                                        │
│  [Open in admin] [Switch user] [Notes] │
└────────────────────────────────────────┘
```

### Data sources (all already exist)

| Field | Source |
|---|---|
| Plan / MRR / renewal | `organizations` + `subscriptions` |
| Activation % | `activationProgress` (or `useActivation` hook computation) |
| Churn risk | `churnSignal` table from churn engine |
| NPS | `npsResponses` table |
| Credits / BYOK | `creditService.getBalance()` + `byokKeys` |
| Past tickets | `supportCases` + `supportTickets` filtered by user |
| Activity | `activityLog` last 5 by org+user |
| Errors | `apiErrorLog` (or whatever the equivalent is) last 3 |

### Endpoint

`GET /api/admin/support/cases/:id/context` returning `{ user, org, health, account, recentTickets, recentActivity, recentErrors }`. Single round-trip to render the panel. ~4 hours backend + 4 hours UI = **1 day total.**

### Why it matters

Without this sidebar, every reply requires 3+ tab switches: admin/support → admin/users/:id → admin/billing → back. At 50 customers and ~10 escalations/week, that's ~30 minutes/week of context-thrashing. It's also where you make mistakes — replying to a Free user with Pro-only instructions because you didn't see their tier.

---

## 5. Bug-report → engineering → ship workflow

This is the gap that is currently 100% manual. Today: customer reports a bug → Sophie maybe captures it → human reads it in `/admin/support` → human (Thomas) opens VS Code → fix → deploy → Thomas remembers to email the customer back. There's no GitHub bridge, no internal "linked issue" field, no auto-notify-on-deploy.

### Proposed workflow

```
Customer reports bug
        │
        ▼
┌───────────────────────┐
│ Ticket created        │  category=bug, priority auto
│ pageContext + error   │  errorContext auto-bundled
│ Bundle               │  errorBundle: stack, route, user, org
└───────────┬───────────┘
            ▼
   Sophie classifies → "bug" → DOES NOT auto-resolve;
   instead enriches with similar past tickets
            │
            ▼
┌───────────────────────────────────────────┐
│  /admin/support  ticket view              │
│  [Convert to GitHub issue] button (NEW)   │
└───────────┬───────────────────────────────┘
            │ click
            ▼
   POST /api/admin/support/tickets/:id/escalate-to-engineering
            │
            ├─ Creates GitHub issue via gh API
            │  Title: "[bug-from-#142] <ticket subject>"
            │  Body: stack + route + user-anonymized repro + link back to ticket
            │  Labels: bug, customer-reported, P{1..5}
            │
            ├─ Stores github_issue_url on ticket
            │
            └─ Auto-replies to customer:
               "Engineering is looking — we'll let you know
                when this ships. Tracking ID: ENG-372."
            │
            ▼
   GitHub PR closes issue → webhook back to AcreOS
            │
            ▼
   POST /api/webhooks/github/issue-closed
            ├─ Looks up ticket by github_issue_url
            ├─ Auto-posts to ticket: "Fix shipped in v2.34.1"
            ├─ Marks ticket awaiting_user (asks for confirmation)
            └─ Tags ticket bug:shipped for analytics
            │
            ▼
   Customer confirms → resolve. CSAT prompt fires.
```

### Schema additions (small)

```ts
// supportTickets — three new columns
githubIssueUrl: text("github_issue_url"),
githubIssueState: text("github_issue_state"), // open | closed
shippedInVersion: text("shipped_in_version"),
```

### Why this matters

This is the workflow that turns "we are responsive" from a vibe into a measurable. **Time-to-ship for customer-reported bugs** is the metric that matters at the 5–50 stage. Right now it's not measurable because the link is in Thomas's head. With this workflow, you can graph "median bug-to-fix" weekly and put it on `/founder-home` as one of the 4 vital signs.

Estimated build: GitHub bridge ~4h, webhook receiver ~3h, UI button + status pill ~2h. **~1.5 days.**

---

## 6. Saved replies + macros plan

### Today

`docs/support-playbook.md` has 15 hand-written canned responses. Sophie consumes them via classification → playbook lookup. **The human in `/admin/support` does not see them.** Every reply is typed fresh into the textarea.

### Needed

#### A. Saved replies in the textarea (Week 1)

Add a `saved_replies` table:

```ts
export const savedReplies = pgTable("saved_replies", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"), // null = system-wide
  authorId: text("author_id"),                  // who created it
  shortcut: text("shortcut").unique(),          // e.g. "/import-csv"
  title: text("title").notNull(),
  body: text("body").notNull(),                 // supports {{variables}}
  category: text("category"),                   // billing | technical | …
  language: text("language").default("en"),
  usageCount: integer("usage_count").default(0),
  lastUsedAt: timestamp("last_used_at"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});
```

UI: in the textarea, typing `/` opens a fuzzy picker (cmd-k style) of saved replies. Selecting one inserts the body with variables resolved (`{{customer.first_name}}`, `{{org.plan}}`, `{{credit_balance}}`, etc.). Bootstrap by importing the 15 entries from `support-playbook.md` as system-wide saved replies.

#### B. Variable resolution

```
{{customer.first_name}}      → from selected case's user
{{customer.last_name}}
{{org.plan}}                  → "Pro"
{{org.credit_balance}}        → "$14.20"
{{ticket.id}}                 → "#142"
{{kb.link("import-leads")}}   → renders as a markdown link
```

Implemented server-side in a `resolveSavedReply(id, ctx)` helper called when the picker selects.

#### C. AI-assist drafting (Week 2)

Button: **"Draft reply with AI."** Sends ticket history + customer context + last 3 saved-reply exemplars + KB hits → gpt-4o → draft text in the textarea. **Always editable, never auto-send.** Reuse existing `tracedLlmCall` infrastructure.

#### D. Macros (post-Week-2)

Macros are saved replies + actions. Schema:

```ts
macroActions: jsonb("macro_actions").$type<Array<{
  type: "set_status" | "set_priority" | "add_tag" | "assign_to" | "issue_credit" | "trigger_playbook";
  params: Record<string, any>;
}>>(),
```

Example: `/refund-and-close` macro = insert text + issue $50 credit + tag `refund` + status=resolved + assign=null.

### Coverage targets (achievable)

- Top 10 saved replies → **70% of reply volume.** That's the Pareto we measured at Front for B2B SaaS support of this size.
- AI-drafted first pass → **50%+ accept rate** (with edits).

---

## 7. The 1-2 week support tooling sprint

Sequenced for highest impact-per-day. None require new infra — all build on existing `supportTickets`, `supportCases`, KB, and `supportBrain`.

### Week 1 — make the human side workable (5 days)

| Day | Item | Effort |
|---|---|---|
| 1 | **Customer-context sidebar** in `/admin/support` (single endpoint, single panel) | 1 d |
| 2 | **Saved replies** table + `/`-shortcut picker + import 15 from playbook.md | 1 d |
| 3 | **Tiered SLAs** — `SLA_HOURS_BY_TIER`, plumb `org.subscriptionTier` into `computeSla()`, backfill | 0.5 d |
| 3.5 | **Triage lanes** — split `/admin/support` queue into Inbox / Mine / Waiting / Breached | 0.5 d |
| 4 | **Inbound email pipe** — SES inbound → `createSupportTicket(source: "email")` with thread matching | 1 d |
| 5 | **CSAT capture** — single 1–5 prompt in resolution email + persist to `supportCases.userSatisfaction` | 0.5 d |
| 5.5 | **Assignment field** — add `assignedTo` UI in case header (already in schema, just no UI) | 0.5 d |

### Week 2 — close the bug-to-ship loop (5 days)

| Day | Item | Effort |
|---|---|---|
| 6 | **GitHub bridge** — "Convert to issue" button + `gh` API call + store `githubIssueUrl` | 0.5 d |
| 6.5 | **Webhook back from GitHub** — issue-closed → auto-post to ticket → mark awaiting_user | 0.5 d |
| 7 | **Auto-error-boundary capture** — `ErrorBoundary` + `window.onerror` → prefilled ticket draft | 1 d |
| 8 | **AI-assist draft button** in the textarea, reusing `tracedLlmCall` | 1 d |
| 9 | **Analytics dashboard** — `/admin/support/analytics`: tickets/wk, by category, by status, by tier, median first-response, median resolution, CSAT, ai-resolve rate | 1 d |
| 10 | **Sophie human-in-loop guard** for sensitive intents (refund, account-deletion, contract, data-export) — always escalate even at 95% confidence | 0.5 d |
| 10.5 | **Saved-reply A/B telemetry** — track which replies correlate with high CSAT, surface top performers | 0.5 d |

### What I'd skip pre-launch

- **Full macros engine** (Week-1 saved replies + Week-2 AI draft cover 80% of the value; macros are post-launch).
- **Live chat widget on marketing site.** Lower-funnel cost than the in-app pipe at this stage.
- **Multi-language saved replies.** Add when first non-English customer signs.
- **Round-robin auto-assignment.** Single human reviewer right now; round-robin is a 5-customer-of-support-team problem.

---

## What I'd tell Thomas

The model is good. The data is in the right shape. The SLAs already compute correctly. **What you don't have is a workflow** — you have a textarea that empties into the void. Spend two weeks giving the *human* side what the *agent* side already has (templates, context, escalation paths) and you cut your time-per-case by ~60% and stop dropping bug reports on the floor between "captured" and "shipped."

The single most-leveraged item in this sprint is the **GitHub bridge**: it's the difference between "we are responsive" being a story you tell investors and being a number on a graph. Ship that one even if you skip everything else.

— Kunle
