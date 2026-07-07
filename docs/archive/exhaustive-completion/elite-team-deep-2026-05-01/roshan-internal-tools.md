# Roshan Gupta — internal-tools / build-vs-Retool audit

**Lens:** 7 yrs at Stripe + Retool. The unsexy strategic decision every early-stage SaaS gets wrong is "build it / buy it / Retool it." Bad internal tooling means engineers spend half their week being human SQL — exporting CSVs, running ad-hoc queries, manually flipping flags. AcreOS already shows the smell: 7,369 lines of `founder-dashboard.tsx` and 2,264 lines of `command-center.tsx` reading like "engineer with React paint" rather than "ops product." When the first ops hire arrives, this is what fails.

---

## 1. One-line verdict

AcreOS has built **a customer product** (slick, designed, polished) and **an engineer's REPL with buttons** (the founder/admin surfaces) — the gap between the two is where the first non-engineer hire will fail, and most of those engineer-only surfaces are 1-day Retool builds masquerading as 1-week React features.

---

## 2. Audience-map per admin / founder page

Surveyed 30+ pages. Each row = page, primary user, today's accessibility for non-engineer, and verdict.

| Page | Lines | Primary user (today) | Should be | Non-eng accessible? | Verdict |
|---|---|---|---|---|---|
| `/admin/support` (`admin-support.tsx`) | 581 | Founder | Support hire | **Yes** (with sidebar fix) | Keep, harden |
| `/founder-home` | 576 | Founder | Founder + on-call buddy | Yes | Keep |
| `/founder-dashboard` (legacy) | **7,369** | Founder | DELETE — no one | **Engineer only** | Demolish |
| `/command-center` | **2,264** | Founder | Engineering | **Engineer only** | Move to /eng |
| `/agent-command-center` | 959 | Founder | Engineering | **Engineer only** | Move to /eng |
| `/founder-ai-observatory` | 1,132 | Founder | Engineering | **Engineer only** | Move to /eng |
| `/admin/safety-gates` | 301 | Founder | Ops hire | Borderline — needs preamble | Keep, simplify copy |
| `/admin/decisions` (`decision-queue.tsx`) | 552 | Founder | Founder + ops | Borderline | Keep, add filters |
| `/admin/beta` (`beta-dashboard.tsx`) | 415 | Founder | Growth/ops | Yes | Keep |
| `/admin/beta-intake` | 396 | **Customer** (public form) | Customer | Yes | Keep — this is a marketing page |
| `/admin/beta-analytics` | 293 | Founder | Growth/ops | Yes | Keep |
| `/admin/ops` (`ops-dashboard.tsx`) | 322 | Founder | Ops hire | Yes | Keep |
| `/audit-log` | 349 | Org admin | Org admin + ops | Yes | Keep — well-built |
| `/founder-todo` | 297 | Founder | Founder | Yes | Keep |
| `/founder-tools` | 296 | Founder | Founder | Yes | Keep |
| `/founder-decisions` | 491 | Founder | Founder | Yes | Keep |
| `/founder-providers` | 186 | Founder | Engineering | Borderline | Move to /eng |
| `/founder-traces` | 251 | Founder | Engineering | **Engineer only** | Move to /eng |
| `/founder-onboarding` | 250 | Founder | Founder | Yes | Keep |
| `/founder-experiments` | 458 | Founder | PM / growth | Borderline | Keep |
| `/founder-letter` | 310 | Founder | Founder | Yes | Keep |
| `/founder-strategy` | 310 | Founder | Founder | Yes | Keep |
| `/founder-trends` | 284 | Founder | Founder | Yes | Keep |
| `/founder-prompt-history` | 255 | Founder | Engineering | **Engineer only** | Move to /eng |
| `/founder-prompt-evolutions` | 265 | Founder | Engineering | **Engineer only** | Move to /eng |
| `/founder-agents` | 178 | Founder | Founder | Yes | Keep |
| `/founder-expansion` | 320 | Founder | Sales/CS | Yes | Keep |
| `/founder-daily-digest` | 141 | Founder | Founder | Yes | Keep |
| `/founder-settings` | 226 | Founder | Founder | Yes | Keep |
| `/founder-preview` | 274 | Founder | Founder | Yes | Keep |
| `/team-inbox` | 538 | Founder | Sales/CS | Borderline | Keep |
| `/admin/features` (`features.tsx`) | n/a | Founder | Eng | Engineer-only | Move to /eng |
| `/admin/feature-flags` | n/a | Founder | Eng | Engineer-only | Move to /eng |
| `/admin/integrations` | n/a | Founder | Founder/ops | Yes | Keep |
| `/admin/ai-observatory` | n/a | Founder | Eng | Engineer-only | Move to /eng |

**Takeaway:** ~11 surfaces are engineer-only (~12,000 lines of code) collapsed into a single "Engineering / SRE" namespace would save ~50% of the cognitive load on the founder nav. The "founder" prefix is currently doing two jobs — "things only the founder cares about" and "things that need engineering context to interpret" — those are not the same audience.

---

## 3. Engineer-only surfaces — what to simplify

Five surfaces require SQL knowledge or internal data-shape understanding to be useful. They are below-bar for a non-engineer and won't transfer to the first ops hire.

### 3.1 `/founder-dashboard` (7,369 lines)
Everything-everywhere panel. Ops hire opens this and bounces. **Action:** route `/founder-dashboard` to `/founder-home` permanently. Move the few panels that aren't on `founder-home` to dedicated sub-pages already in the IA. Delete the rest. This is the single highest-leverage cleanup in the codebase.

### 3.2 `/command-center` (2,264 lines) + `/agent-command-center` (959 lines)
Power-user surfaces. Mix agent task creation, agent settings, autonomy toggles, and operational health. **Action:** split into (a) `/eng/agents` — engineering-only health view, (b) the parts a founder/ops actually presses (autonomy toggle, manual agent tasking) move into `/founder-agents` and `/founder-tools`.

### 3.3 `/founder-traces` (251 lines)
Trace-id viewer. Useless to anyone who can't read prompt + completion logs. **Action:** rename `/eng/traces`, gate behind eng role.

### 3.4 `/founder-prompt-history` (255) + `/founder-prompt-evolutions` (265)
Prompt-engineering surfaces. Net zero ops value. **Action:** rename `/eng/prompts/*`.

### 3.5 `/founder-ai-observatory` (1,132 lines)
Live token spend / model latency / quota dashboard. Engineer surface. **Action:** rename `/eng/ai-observability`. Keep a thin wrapper card on `/founder-home` that says "AI cost yesterday: $X / Y% of budget" with click-through.

**The general fix:** establish a `/eng/*` namespace. Anything that requires reading a prompt, an SQL result, a trace ID, or a feature-flag JSON belongs there. Founder + ops never need to load it.

---

## 4. Build vs Retool — top 5 candidates

Each row: surface, current effort (estimated from line count + verticals), Retool equivalent, recommendation.

### 4.1 GDPR delete + data-export admin UI — **RETOOL**
Not yet built. `gdprService.ts` exists; the UI is missing per Olu's audit. A native build is 2–3 days (form + confirm + audit-log row + status table). Retool wraps the existing service in a typed form + table + button in **2 hours**. This page will be touched ~10x/year. Do not write React for it.

### 4.2 Org-merge / account-merge UI — **RETOOL**
`storage.mergeLeads` exists; org-merge is manual. Same shape as 4.1. Form: source org, target org, dry-run preview table, confirm. **2 hours** in Retool. Native build: 2 days minimum, will rot.

### 4.3 Trial extension / tier override per customer — **RETOOL**
Endpoint already exists (`/api/admin/organizations/:id/tier-override` at `routes-admin.ts:4514`, and feature-overrides at `:4575`). There is **no UI surface** for these — calling them today requires `curl` or the network tab. Retool: org search → row click → tier dropdown + trial-end date picker + reason textarea → confirm. **3 hours**. Native: 1–2 days, low-frequency use.

### 4.4 Bulk operations console — **RETOOL**
`server/routes-bulk.ts` exposes `/api/bulk/leads/update`, `/api/bulk/leads/delete`, `/api/bulk/properties/update`, `/api/bulk/deals/update`, `/api/bulk/tasks/complete`. **Zero of these have a non-engineering UI today** — they are reachable only programmatically. Retool: query builder → select N rows → action dropdown → preview → confirm with diff. **1 day**. Native: probably 1 week of careful work.

### 4.5 Provider health + circuit-breaker reset — **NATIVE-LITE / RETOOL**
`founder-providers.tsx` (186 lines) already shows the read view. The missing 20% is mutation: "trip / un-trip a circuit breaker," "force a provider to be skipped," "rerun a failed lookup." This is exactly the "80% lookup, 20% mutation" trap — shipping the lookup half doesn't move the needle without the buttons. Retool the mutation surface in **half a day**.

**General Retool rules I'd encode:**
- Built-and-touched <1x/month → Retool, no debate.
- Touched 1–10x/month and audience is ≤3 humans → Retool unless there's a customer-visible quality reason.
- Touched daily by a customer → never Retool, always native.

This rules out ~6,000 lines of currently-native admin UI from ever needing to be written in React.

---

## 5. Audit + impersonation spec

### 5.1 Current state
- `audit_log` table exists, surfaced via `/audit-log` (349 lines, well-built).
- `founderAuditService.ts` exists with categories: autonomous_decision, compliance_override, financial_transaction, data_deletion, ai_action, security_event, system_error.
- `/api/admin/impersonate/:orgId` (`routes-admin.ts:4543`) exists — logs a row to `activityLog` with `action: "impersonation_started"`, includes `readOnly: true` flag and 30-min expiry.
- `/api/admin/organizations/:id/tier-override` and `/features` mutate org state.

### 5.2 Gaps
1. **Tier-override and feature-overrides do not write to `audit_log`.** I read the route bodies — they `db.update(organizations)` and return success. No audit row. **This is the #1 fix.** Every founder-admin mutation MUST audit-log via the existing `founderAuditService.log()`.
2. **Impersonation logs but doesn't enforce read-only.** The route response includes `readOnly: true` as a hint, but I see no server-side middleware that would *reject* a write while impersonating. Today an impersonating founder could mutate customer data and the only trace is the start row.
3. **No "impersonation banner"** in the customer-app shell. The customer's UI looks identical whether viewed natively or via impersonation. The first ops hire will absolutely fat-finger a write while in someone else's org.
4. **`founderAuditService.log()` swallows persistence failures silently** (line 67–69: `.catch` logs but doesn't throw). Acceptable for now, but in regulated mode (SOC2) this needs to be a hard fail with a queue retry.
5. **No "last-N admin actions" surface** filtered to `action LIKE 'founder_audit:%'`. The audit-log page filters by entity, not by category. Add a saved view: "Founder admin actions (last 30 days)."

### 5.3 The spec
- **Every admin mutation route** (search `routes-admin.ts` for `app.post|patch|put|delete`) must call `founderAuditService.log()` before returning. Add an ESLint rule or PR template checkbox.
- **Impersonation middleware** — when `req.session.impersonatingOrgId` is set, force `req.method === 'GET'`. Reject mutating verbs with 403 + audit row.
- **Customer-app banner** — when impersonating, render a fixed top bar: "Viewing as [Org Name] — read-only — exit" with a one-click eject.
- **Auto-expire impersonation** — 30 min is in the response payload but I don't see the cookie/session honoring it. Verify.
- **Audit retention** — 7 yr for financial / data-deletion / compliance categories, 1 yr for the rest. Document in `replit.md`.

---

## 6. First ops-hire onboarding — the first hour

This is the test the codebase fails today. Imagine a senior support hire shows up Monday morning. What do they need?

**Hour 1 (current state):**
1. Log in via Clerk → land on `/founder-home`. OK.
2. Click `/admin/support`. See SLA queue. Click a case. See conversation. **Cannot see customer's plan, MRR, days since signup, churn band, last 5 actions.** They open a second tab to query the DB. That's the engineer-as-SQL smell.
3. Reply. There's no saved-replies dropdown. They ask the founder for "the playbook" in Slack. Founder pastes `support-playbook.md`. Tab three.
4. Customer asks for a refund. Hire has no refund button. They Slack the founder. **Founder is the human Stripe dashboard.**
5. Customer asks "can you log in and see what I'm seeing?" Hire has impersonate route but no UI button — and per §5.2 even if they used it there's no read-only enforcement.

**Hour 1 (fixed state — what to build):**
1. **Customer-context sidebar in `/admin/support`** (Olu also flagged) — opens with the case. Pre-loaded.
2. **Saved-replies dropdown** — `support-playbook.md` snippets in the textarea.
3. **"View as customer" button** — one-click impersonation with the read-only banner of §5.3.
4. **Action menu on the customer header** — "Refund last invoice / Extend trial 14 days / Reset 2FA / Resend onboarding day-1 email." Each invokes an existing endpoint and audit-logs.
5. **A 1-page `OPS_HANDBOOK.md`** — "the 7 actions you can take, the 4 you can't, where to escalate."

The first ops hire is a forcing function. If you can't onboard them in an hour to do level-1 support, every customer-growth spike re-bottlenecks on Thomas.

---

## 7. The 2-week internal-tooling sprint

Sequenced by ops-leverage-per-day. Half is Retool, half is native polish.

### Week 1 — close the engineer-as-SQL gap
**Day 1 — Retool: GDPR + org-merge + tier-override + bulk-ops console.** Four small Retool apps wrapping endpoints that already exist. ~6 hours total. No React written. Reduces founder bottleneck by ~5 weekly minutes per use.

**Day 2 — Customer-context sidebar in `/admin/support`.** Plan, MRR, days-since-signup, churn band, last 5 events. Existing data, new component. ~1 day. Cuts case-handling time roughly in half (echoing Olu).

**Day 3 — Saved-replies dropdown + macros editor.** Load `support-playbook.md` into the textarea as snippets. Add a "Save reply as macro" button on existing replies. ~0.5 day.

**Day 4 — Impersonation banner + read-only middleware.** Server middleware rejects writes when impersonating. Customer-app shell renders banner. ~1 day. Closes the safety gap.

**Day 5 — Audit-log every admin mutation.** Sweep `routes-admin.ts`, add `founderAuditService.log()` to every `POST/PATCH/PUT/DELETE`. ~0.5 day. Add a "Founder admin actions" saved view in `/audit-log`. ~0.5 day.

### Week 2 — close the audience-mismatch gap
**Day 6 — Demolish `/founder-dashboard` (7,369 lines).** Redirect to `/founder-home`. Move the 2–3 panels still in use to existing sub-pages. ~1 day. Reduces JS bundle size and cognitive load materially.

**Day 7 — Establish `/eng/*` namespace.** Move command-center, agent-command-center, founder-traces, founder-prompt-history, founder-prompt-evolutions, founder-ai-observatory under `/eng/*`. Add a single `/eng` index. Hide from non-engineering roles. ~1 day.

**Day 8 — Provider mutation buttons.** Trip/un-trip circuit breaker, force skip, rerun. ~0.5 day. Plus a "data quality" SLO card on `founder-home`.

**Day 9 — Bulk-ops UI in customer surfaces (not Retool).** Power users want to multi-select 50 leads → bulk re-tier / bulk re-assign / bulk re-mail. Backend exists in `routes-bulk.ts`. Frontend wiring on `/leads`, `/deals`. ~1 day.

**Day 10 — `OPS_HANDBOOK.md` + first-hire dry run.** Write the 1-pager. Run it against a friendly outsider (advisor, spouse, anyone non-engineer). Watch them stall. Fix the stalls. ~0.5 day handbook + ~0.5 day fixes.

---

## 8. Workflow vs lookup — the 80/20 trap

A pattern across the codebase: the read view ships, the write view doesn't. Concrete examples worth naming because each represents a half-built tool:

- **`founder-providers.tsx`** (186 lines) — reads success rate, latency, cost per provider. Cannot trip a circuit breaker, force a skip, rerun a failed lookup, or change priority. The 20% of value (mutation) is missing.
- **`audit-log.tsx`** (349 lines) — reads beautifully. No "annotate this entry" or "mark as reviewed" affordance. Compliance reviewers need both.
- **`/admin/decisions`** (552 lines) — surfaces escalated cases, but the only mutation is approve/reject. No "send to second reviewer," no "snooze 24h," no "annotate for the agent's training set."
- **`/admin/support`** has no "merge two cases," no "mark as duplicate," no "split conversation." All real support patterns at 50 customers.
- **`/founder-traces`** (251 lines) — lists trace IDs. Can't replay a trace, can't promote a prompt to evolution. Engineering surface that's pure observability with no action.
- **`/admin/safety-gates`** — the gate definitions are *hardcoded in the page* (lines 51+ of `safety-gates.tsx`). There is no UI to add/edit/disable a gate. So when a customer hits a false-positive gate, the only fix is a code deploy. That's a P1 ops fail.

**The rule I'd codify:** every internal read surface gets at least one mutation button shipped at the same time. Otherwise the page is a tab in someone else's database client and adds zero workflow value.

---

## 9. What I'd tell the board

AcreOS shipped customer-quality React for surfaces an ops hire will press once a week, and shipped REPL-quality React for surfaces the founder presses every day. That's inverted. Two weeks of work — half of which is Retool, not code — moves the company from "founder is the only operator" to "any trained human can run L1." The CFO question this answers: at what customer count does the next hire pay for itself? Today it's never, because there's no surface for them to be productive on. After the sprint above, it's roughly customer 30. That's the business case.

The cleanest meta-signal: 7,369 lines of `founder-dashboard.tsx`, 2,264 of `command-center.tsx`, 1,132 of `founder-ai-observatory.tsx`. That's 10,765 lines of bespoke React that, in a Retool-native company, would be ~15 internal apps shipped in a sprint. Not because Retool is better — because the code/value ratio of "founder-only surface that mutates rarely" is famously bad in custom code. Retool the boring 80%; spend native React budget on the 20% that customers see.

— Roshan
