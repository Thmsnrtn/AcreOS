# Runbook 08 — Founder out of office

**Severity:** P0/P1 routing while founder is unavailable
**Owner:** Backup contact rotation
**Time to first response:** Per severity (P0: 15 min, P1: 1 hour)

---

## Symptom
- Founder is asleep, on a flight, on vacation, sick, or in a deep-work block
- A P0/P1 alert has fired, or a customer has hit a ceiling that needs a judgment call
- Customer escalation that normally goes founder-direct has no one to receive it

---

## Diagnose (who's on right now?)
1. Check the **on-call rotation** in /founder/settings → On-call. The current week's primary and backup are listed there.
2. If the rotation isn't set, the default is:
   - **Primary backup:** Engineering lead
   - **Secondary backup:** Operations lead
   - **Tertiary:** Founder's spouse / emergency contact (P0 only — for "founder is incapacitated" scenarios)
3. Confirm the on-call is reachable on the channel listed (phone, SMS, Slack DM, etc).
4. Founder's calendar (founder.acreos.com or shared cal) shows OOO windows ahead of time — check there before paging.

---

## Fix (who handles what)
| Class | Goes to | Notes |
|---|---|---|
| P0 — site down, data loss, security incident | Primary backup, then secondary if no ack in 15 min | See runbook 07 (DB), runbook 06 (Stripe), `docs/runbooks/data-breach-response.md`. |
| P1 — billing broken, mass deliverability, vendor outage | Primary backup, founder notified async | Runbooks 02, 05, 06. |
| P2 — single customer escalation | Operations lead handles directly; founder reads digest | Runbooks 01, 03, 04. |
| Customer asks for founder personally | Reply: "founder is OOO until X, here's what I can help with now." Never silent-ignore. | Saved-reply: "founder OOO". |
| Press / media inquiry | Hold until founder back. Reply: "we'll respond within 24h." | Never improvise on record. |
| Legal threat / subpoena | Acknowledge receipt, do not respond on substance. Forward to founder + legal counsel. | |
| Refund > $500 | Backup may approve up to $500. Above: hold for founder. | |
| Tier change / discount > 20% | Hold for founder unless customer is actively churning, then backup may approve up to 30% to save the account. | |

---

## Verify (handoff is clean)
- Backup has acked the page (see escalation timer in /founder/notifications).
- An entry exists in `audit_events` for any decision the backup made during the OOO window.
- Founder's first action on return is to read the OOO digest (`/founder/oof-digest`) and confirm or roll back any approvals.

---

## Escalate if
- No backup acks in 15 min on a P0 → cascade through the rotation. If the whole rotation is silent, post in #founder-emergency Slack and SMS the secondary contact.
- Backup is unsure of a decision → default to **delay > damage**. A 24-hour wait rarely kills a deal; an irreversible bad call often does.
- Founder is unreachable for > 48h with no scheduled OOO → treat as "founder incapacitated" track: tertiary contact, plus authorized escalation path documented in operating agreement.

---

## Pre-OOO checklist (founder, before going dark)
- Confirm on-call rotation in /founder/settings → On-call.
- Update auto-reply on email + status page banner if absence is > 3 days.
- Pre-approve any pending dunning manual interventions or hold them until return.
- Note any open P1 threads for the backup in /founder/oof-handoff.
- Set the **escalation timer threshold** in /founder/notifications (default 15 min for P0, 60 min for P1).
