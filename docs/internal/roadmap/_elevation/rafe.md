# Rafe — CCO Elevation Brief (2026-06-07)

**Lens:** Customer-success craft — onboarding-to-aha, the support loop (KB drafts / Pax-Support / escalation), retention mechanics, in-app guidance, NPS-to-action, lifecycle comms quality. The job before customer #1: make the first five into evangelists, not just survivors.

The substrate is genuinely strong. Pax-Support classifies, plays books, escalates and drops founder-visible `system_alerts` on handoff (`server/services/supportNotifications.ts`); resolved tickets mint KB drafts behind a review queue (`server/routes-support-tickets.ts:270-315`); NPS is queue-scheduled (`runScheduledJobs.ts:3255`) and detractors are *supposed* to page the founder. What's missing is not more machinery — it's the seams between the machinery, the human voice on top of it, and closing the loop back to the customer so they *feel* heard. That's where great lives.

---

## TOP IDEAS (most important first)

### 1. Fix the detractor-alert seam — the live NPS dialog never pages the founder (refine · founder · S)
**This is a live bug, not a roadmap item.** `client/src/components/nps-dialog.tsx:46` POSTs to `/api/nps` (`server/routes-organization.ts:2237`). That handler inserts the row, consumes the prompt-queue entry, logs — and stops. The detractor founder-alert logic lives on a *different* endpoint, `/api/nps/submit` (`server/routes-lifecycle.ts:74-104`), which **no client code calls** (grep `api/nps/submit` in `client/` → zero hits). So today: a customer rates us a 3, types "I'm about to cancel," hits submit — and nobody finds out. The charter's first-response SLA and "every detractor is a same-day call" discipline are dead on arrival.
**What "great" looks like:** the moment a score ≤6 lands, a `system_alerts` row + a Solene page fires with the verbatim comment attached, regardless of which endpoint received it.
**First step:** lift the detractor block from `routes-lifecycle.ts:74-104` into a shared `notifyFounderOfDetractor()` helper (mirror `supportNotifications.ts`) and call it from the `/api/nps` handler right after the insert at `routes-organization.ts:2262`. Then either redirect the dialog to one canonical endpoint or delete the orphan. Add a unit test asserting an alert row is written on score ≤6.

### 2. Close the loop back to the customer after a detractor / negative rating (elevate · customer · M)
Right now feedback is extractive: we capture the score, alert ourselves, and the customer hears nothing. The single highest-leverage retention move pre-launch is the personal reply. A detractor who gets a real, situation-specific "that's on us, here's what I'm doing" within the hour converts to a promoter at a rate nothing else touches.
**What "great" looks like:** every ≤6 score and every support rating ≤2 (`supportBrain.ts:606`) generates a **draft personal reply** in the founder's escalation queue, pre-filled with the customer's actual comment, their org name, their last 3 support cases, and a fill-in-the-blank "here's the fix" line — Tom edits and sends in 30 seconds. Never a template; always the customer's words.
**First step:** new founder surface `/founder/recourse` (or extend the escalations queue) reading detractor alerts + low support ratings, with a one-click "draft reply" that calls a `gpt-4o-mini` drafter seeded with the verbatim + account context. Persist the sent reply so the loop is auditable.

### 3. KB-draft review queue needs a real editor + a customer-visible "was this helpful" loop (improve · both · M)
Drafts are minted well (`routes-support-tickets.ts:294-310`) and gated from customer view (`:367-373`). But the founder review surface is publish/dismiss only — there's no in-place edit, no preview of how it renders, no merge-into-existing-article. A first customer's worst KB experience is a half-baked auto-generated article that reads like a ticket transcript. And published articles have a `viewCount` but no helpfulness signal, so we never learn which articles actually resolve vs. which send people to support anyway.
**What "great" looks like:** founder edits the draft inline before publish (title/summary/body), sees the rendered customer view side-by-side, and every published KB article carries a "Did this answer your question? Yes / No → open a ticket" footer that feeds an article-level resolution rate.
**First step:** add edit fields to the kb-drafts surface (the columns already exist on `knowledge_base_articles`); add a `kb_article_feedback` table + footer widget on `client/src/pages/help/kb-article.tsx`; surface article resolution-rate in the drafts/KB admin view.

### 4. Onboarding-to-aha: a guided "first real diligence in 5 minutes" path, instrumented end-to-end (develop · customer · M)
Activation events are recorded idempotently (`server/services/activation.ts`) and the funnel is computable, but the canonical events are wizard-step-shaped (`onboarding_step_N_completed`), not *value*-shaped. The aha for a land investor is **the first time AcreOS tells them something true about a real parcel they care about** — a Land Snapshot on their own deal, sourced + provenance-chipped. We have the parcel-check widget and Land Snapshot shipped; what's missing is a deliberate, instrumented "run your first real parcel" moment woven into the post-signup minutes, with `first_snapshot_viewed` / `first_provenance_chip_opened` as the activation milestones we actually optimize.
**What "great" looks like:** < 7-day onboarding-to-first-value (charter target) measured against a *value* event, not a click event; a celebratory but honest "here's what we found, here's what's still review-required" moment that earns trust by showing its work.
**First step:** add `first_land_snapshot_viewed` + `first_real_parcel_lookup` to the `ActivationEvent` union; fire them from the snapshot/lookup paths; add a "Run your first parcel" CTA card to the Today door for orgs with zero lookups; chart these in `/founder/activation`.

### 5. A human voice layer over Pax-Support — disclosed, warm, AcreOS-specific (improve · customer · S)
The contextual-response prompt (`supportBrain.ts:434-453`) is competent but generic ("You are a helpful support agent... Keep responses concise, professional"). It doesn't carry the AcreOS voice (plainspoken, "that's on us"), doesn't name the customer's actual situation, and the escalation message (`:517`) promises "within 24 hours" — which undersells our own < 15-min/< 4-hr SLA and reads like enterprise boilerplate. Immutable #7 (AI disclosure) is handled elsewhere, but the *tone* is where a first customer decides whether we're a real company or a wrapper.
**What "great" looks like:** Pax-Support sounds like Rafe — specific ("the comp pull failed because the county portal rate-limited us at 6:42am"), owns failures, never says "your ticket is in our queue." Escalation says "a human will be on this shortly" and means it.
**First step:** rewrite the system prompts in `supportBrain.ts` to inject the AcreOS support-voice clause (reuse the marketing voice-linter discipline), pull the customer's recent activity into context, and fix the escalation copy to match the real SLA.

### 6. Pax-handoff continuity — the customer shouldn't feel the seam (develop · both · M)
When `escalateCase` fires (`supportBrain.ts:507`), the customer gets a polite "I've escalated this" and then... silence until a human manually finds the alert. There's no handback when the human resolves, no "Rafe is now on this" identity change, no status the customer can see. The charter's "the customer doesn't feel the seam" standard isn't met yet.
**What "great" looks like:** on escalation the case shows a clear human-owner state in `support-content.tsx`; the customer gets a real first-response (not just the auto "within 24h" line); on resolution the human reply lands in the same thread with continuity. Pax hands off and hands back cleanly.
**First step:** add an `assignedTo` / `humanRespondedAt` concept to the case, surface owner state in the customer thread UI, and wire the founder escalation-queue reply back into `support_messages` so it appears in the customer's conversation.

### 7. Save-flow that's honest *and* effective — exit-interview discipline wired to the roadmap (elevate · both · M)
The cancellation dialog is excellent and dark-pattern-free (`cancellation-dialog.tsx` — reason capture, downgrade offer, data-stays reassurance, cancel-as-easy-as-signup). The gap is downstream: the captured reason + verbatim feedback need to become a **structured exit interview** that (a) pages the founder *before* the period ends (a save window exists), (b) files the verbatim for Maren's roadmap, and (c) trend-tracks churn reasons. Today it likely just flips the subscription.
**What "great" looks like:** every cancel produces a save-window alert with the verbatim + dollar impact, a filed exit-interview record, and a weekly churn-reason rollup — the charter's "verbatim quote + dollar impact" standard, operationalized.
**First step:** confirm `/api/subscription/cancel` persists reason+feedback to a queryable table; add a founder alert on cancel (severity scaled by MRR at risk) + a churn-reason aggregate in the founder pulse.

---

## BOLDEST ELEVATION BET

**The Recourse Loop: every negative signal becomes a drafted, personal, same-hour human reply — closed-loop and auditable.**

Combine ideas #1, #2, and #6 into one distinctive capability. Today every negative signal (detractor NPS, ≤2 support rating, escalation, cancellation) flows *inward* — we alert ourselves and the customer hears crickets. Flip it: every negative signal auto-generates a **draft personal reply** seeded with the customer's verbatim words, their account, and a concrete "here's the fix" — sitting in one founder queue, one-click to edit-and-send, with the sent reply persisted back into the customer's thread. The customer always hears back, in their own situation's language, fast. No SaaS at our stage does this; most never do it at all. It directly serves immutables #1 (truth), #2 (no dark patterns), and the cancellation-is-easy floor — and it is the single thing most likely to turn first customers into evangelists. Effort L, but it's the moat.

---

## SMALL HIGH-ROI POLISH

- **Detractor verbatim in the alert.** When the detractor alert fires, attach the `feedback` text, not just the score — a "3, no comment" and a "3, your county data was wrong" are different emergencies (`routes-lifecycle.ts:87` / fix in #1).
- **Honest SLA copy.** The escalation message says "within 24 hours" (`supportBrain.ts:517`) while our published SLA is < 15 min business / < 4 hr off-hours. Pick the true number and say it.
- **NPS feedback step "Skip" is a ghost button.** In `nps-dialog.tsx:156` the Skip button calls `handleSubmit` — same as Submit — so "Skip" silently submits an empty comment, which is fine, but it's labeled confusingly next to Submit. Make Skip submit-score-only explicitly.
- **NPS dismissal is client-only.** `nps-dismissed_at` lives in localStorage (`nps-dialog.tsx:77`); clear browser data and the prompt re-nags. Persist a dismiss on the queue row (`status='dismissed'`) so it's device-independent.
- **KB drafts read like ticket transcripts.** The auto-generated body is `## Issue Pattern / ## Resolution Approach / ## Steps That Worked` (`routes-support-tickets.ts:298`) — internal framing leaking to customers. Reframe the draft template to customer-voice ("If you're seeing X, here's how to fix it").
- **Support case "AI is now reviewing" toast** (`support-content.tsx:202`) is fine but set expectations: add the realistic timeframe so the customer knows whether to wait or walk away.
- **Health-score methodology doc** (`docs/customer/health-score-methodology-2026.md`, per charter) — confirm it exists and is wired to a real signal before launch, not a template stub.

---

## THE ONE THING THAT WOULD MOST EMBARRASS US

**A detractor rates us a 3, types a real complaint, hits submit — and the founder is never told.** That is exactly what happens today: the live dialog posts to `/api/nps` which doesn't fire the detractor alert, while the alert code sits on an orphaned `/api/nps/submit` endpoint no client calls (idea #1). For a customer-success function whose entire identity is "every detractor is a same-day call," shipping a feedback widget that swallows the most important responses is the cardinal sin. A sharp first customer who took the time to tell us we're failing — and got silence — doesn't churn quietly; they tell other land investors. This is the first thing I'd fix, before anything else on this list.

---

*Files surveyed: `server/services/supportBrain.ts`, `server/services/supportNotifications.ts`, `server/routes-support-tickets.ts`, `server/routes-organization.ts:2236-2360`, `server/routes-lifecycle.ts:54-150`, `server/jobs/runScheduledJobs.ts:3255-3342`, `server/services/activation.ts`, `client/src/components/nps-dialog.tsx`, `client/src/components/cancellation-dialog.tsx`, `client/src/components/support-content.tsx`, `client/src/pages/help.tsx`, `client/src/pages/help/kb-article.tsx`, `migrations/0109_kb_drafts_nps_queue.sql`.*
