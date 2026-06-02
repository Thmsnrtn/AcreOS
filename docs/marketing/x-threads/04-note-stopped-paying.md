---
title: "The note that stopped paying on month 42 (X-native thread)"
slug: 04-note-stopped-paying
persona: note_investor (the wedge)
source-post: X-native — pairs with blog/the-note-that-stopped-paying.md
linked-substack: blog/the-note-that-stopped-paying.md
publish-status: ready when X account exists
beatrice-reviewed: PASSED — first-party collection scope only, "operator's counsel decides" line preserved, no advice on enforcement, no recovery-rate claim
truth-engine:
  - sources:
      - { name: "server/services/workflow-engine.ts (tpl_payment_missed_dunning trigger + actions)", ref: "/Users/user/AcreOS/AcreOS/server/services/workflow-engine.ts#L94" }
      - { name: "shared/business-types.ts (note_investor = core; three workflow templates)", ref: "/Users/user/AcreOS/AcreOS/shared/business-types.ts#L69" }
      - { name: "docs/company/CONSTITUTION.md §12 (no fiduciary advice)", ref: "/Users/user/AcreOS/AcreOS/docs/company/CONSTITUTION.md" }
ai-disclosure: "Drafted by Pax under Soren's direction. (Constitution §7.)"
voice-check: third-person mechanics; no founder voice; banned references absent; SaaS jargon absent
---

# Thread 4 — The note that stopped paying on month 42

## Tweet 1 (hook — 232 chars, stands alone)

> A seller-financed note pays on schedule for 41 months.
>
> On month 42, the payment doesn't arrive.
>
> Most note investors notice three days late, on a Saturday, after the borrower has already moved on to the next bill.
>
> The same-day workflow:

## Tweet 2 (220 chars)

> Trigger: the platform fires a payment.missed event the moment the scheduled date passes inside the configured grace window.
>
> No memory required. No spreadsheet to scan. The note's amortization schedule and the grace period live in the system.

## Tweet 3 (228 chars)

> Action 1 — Notify the workspace.
>
> "Payment missed on Note #[id] — [borrower]. Amount: $[amount]. Follow up immediately."
>
> Workspace-scoped. Multi-seat aware. A VA on the account sees the same notification, role-gated on borrower contact details.

## Tweet 4 (245 chars)

> Action 2 — Create a high-priority task with the grace period attached.
>
> Response to a missed payment on a 10-day-grace note is different from one with no grace. The platform surfaces the term that governs the next decision so the operator doesn't have to dig.

## Tweet 5 (255 chars)

> Action 3 — Draft the borrower email.
>
> Drafted. Not sent.
>
> A first-touch dunning is the first thing the borrower remembers from this note holder for the rest of the relationship. Generic and wrong is worse than slow. The operator approves, edits, or rewrites.

## Tweet 6 (240 chars)

> What the workflow does not do:
>
> · auto-text the borrower (different legal exposure)
> · contact a third party (out of scope for first-party servicing)
> · begin enforcement (the operator's counsel decides, on the operator's timeline)
>
> Boundaries on purpose.

## Tweet 7 (CTA — 254 chars)

> First-party collection on your own paper is generally outside FDCPA's third-party-collector scope. State law varies; the operator's counsel decides.
>
> Same-day workflow, in full:
>
> acreos.io/blog/the-note-that-stopped-paying
>
> ---
> Drafted by Pax.
