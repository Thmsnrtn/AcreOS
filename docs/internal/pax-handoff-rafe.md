# Pax → Human Handoff Playbook

**Owner:** Rafe (CCO) · **Phase:** 0–1 · **Last updated:** 2026-06-06

Pax (the AI support agent) handles most inbound support, but when it can't, the
handoff to a human must be **clean, honest, and never feel like the customer was
dropped**. Constitution immutable #7 requires AI mediation be disclosed, so the
handoff is explicit: Pax says "let me get a human," and a human actually shows up.

---

## When Pax escalates

`supportBrain.escalateCase` (`server/services/supportBrain.ts`) fires on any of:

- **Low classification confidence** — Pax isn't sure what the issue is.
- **Maximum AI attempts reached** — Pax tried and couldn't resolve.
- **Playbook execution failed** — the automated fix path errored.
- **AI response generation failed** — the model call itself failed.

The richer tool-driven path (`escalate_to_human` in `server/ai/supportAgent.ts`) also
attaches a diagnostic bundle (org tier, data counts, active alerts, recent API errors,
service health) to the ticket.

On escalation the case is set to `status = "escalated"` with `escalatedAt` +
`escalationReason`, the customer gets an honest "I've escalated this to a human, you'll
hear back within 24 hours" message, and an activity-log line is written.

---

## What I (the human) see — the queue is real, not just a flag

Escalation used to set a status flag and write an activity log line — neither of which
**pages a human**. As of Tahoe Wave-2 every escalation (and every newly-created ticket)
also drops a founder-visible row into `system_alerts` via
`server/services/supportNotifications.ts` (`notifyFounderOfTicket`):

- `alertType: "escalation"`, `type: "support_escalation"` / `"support_ticket_created"`
- `severity`: `critical` for urgent/high tickets, `warning` for escalations, `info` for
  ordinary new tickets
- `relatedEntityType: "support_case"` + `relatedEntityId` so it links straight to the case
- `metadata`: reason, priority, subject, escalation reason

`system_alerts` is the canonical founder-notification surface. These rows are read by:

- **`GET /api/founder/escalations`** — escalated tickets with full context + diagnostic
  bundle (`server/routes-support-tickets.ts`).
- the **founder pulse / alert-policy router** (`server/services/alertPolicy.ts`) which
  routes by severity.

So a brand-new ticket and a Pax escalation are now both **human-visible queue entries**,
which is what makes a first-response SLA possible.

**First-response SLA target: < 15 min.** Detractor NPS and urgent tickets get a same-day
personal touch.

---

## How I take over

1. **Acknowledge fast.** Reply on the ticket within SLA — even just "I've got this, give
   me a few minutes" resets the customer's clock and removes the dropped-feeling.
2. **Read the bundle first.** The diagnostic bundle on the ticket usually tells me what
   Pax already tried and the account state, so I don't repeat dead ends.
3. **Resolve or route.** Fix it directly if I can. For engineering issues use the
   `/api/founder/escalations/:id/generate-prompt` helper to produce a ready-to-paste
   investigation prompt.
4. **Close the loop with the customer in plain language** — what was wrong, what I did,
   what (if anything) they need to do. No internal jargon.
5. **Mark resolved** via `/api/founder/escalations/:id/resolve` (or the resolve tool),
   which records the resolution and feeds Pax's learning so the same issue auto-resolves
   next time.

---

## The handback (human → Pax)

When the human-handled issue is resolved:

- Record the solution so Pax learns it (the resolve path + `paxMemory` "escalation"/
  "solution_tried" entries already do this).
- If it's a recurring class of issue, file a KB draft (the KB-draft queue at
  `/founder/support/kb-drafts`) so Pax can answer it directly in future — never publish
  AI-generated KB content without human review.
- Future identical tickets should now resolve without escalation; watch the escalation
  rate for that category drop.

---

## The honesty rules (non-negotiable)

- Pax always **discloses** it's an AI and that it's bringing in a human (immutable #7).
- We never pretend a human is online when one isn't — the message commits to a 24h
  window, and the SLA target is tighter, but we don't fake presence.
- We never let an escalation sit invisibly. If the founder notification path ever fails,
  that is a P0 for customer trust — fix the wiring, don't paper over it.
