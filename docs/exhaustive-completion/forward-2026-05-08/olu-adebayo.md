# olu-adebayo — Ops Scaling: The Fallback Layer

**Reading list:**
- MASTER-FINDINGS-RECONCILIATION.md (21/24 P0s shipped)
- post-may1-resweep.md (RS-1..RS-7; no new runbooks)
- REMAINING-WORK-INVENTORY.md (missing 8 runbooks)
- Original: elite-team-2026-05-01/olu-coo.md

**State read:**

May 1 I warned the 5→50 stretch breaks when email silently stops arriving or Sophie auto-resolves something embarrassing. RS-1..RS-7 hardened account-security. But none touched the real bottleneck: **fallback-layer capacity.** You have 8/20 runbooks. At 50 customers with the same residual-case rate, the founder handles ~20–30 uncommon-path events/week. At 500, that's 200+. A second ops hire arrives at customer ~30; without runbooks and admin UX, they're onboarded for 2 weeks. This is the scaling wall.

**Push forward — my 5 moves (ranked):**

1. **Write the missing 8 runbooks (4-person task force, 5d).** Clerk outage, SES deliverability, Twilio 10DLC, e-sign stuck, GDPR delete, agent misfire, founder unavailable, Fly region outage. Same template as existing 9. Force-multiplication: "here's what a junior ops hire does" instead of "Thomas figures it out under stress."

2. **Add customer-context sidebar to `/admin/support`.** Plan/MRR/days-since-signup/churn-risk when case opens. Case-handling time drops ~50%. First ops hire works this daily; make it operable in hour-1. Effort: 1d. Highest-leverage UI change in COO roadmap.

3. **Build GDPR + org-merge admin UIs (2d).** Wrappers around existing services. Every legal request currently blocks Thomas opening SQL. Removes a single-person bottleneck before it scales.

4. **Route P0/P1 escalations beyond founder (0.5d).** Second FOUNDER_EMAILS entry (trusted advisor, read-only). SMS escalation if founder doesn't ack P0 within 30 min. Asymmetric hedge: founder unavailable 48h = you have fallback.

5. **Synthetic checks for deliverability + webhook drift (1d).** Every 15 min: (a) test email through SES, verify receipt, (b) test SMS through Twilio, check status, (c) hit Stripe webhook receiver with fixture. Catches SES suppression bloat and API changes before customers notice.

**What I'd defer:**

- Sophie human-in-loop for sensitive intents (refund/deletion). Real risk, not blocking launch.
- CSAT capture post-resolution. Nice-to-have signal.

**What scares me most:**

*The 5→50 stretch is where SaaS acquires a "silent failure" culture.* SES suppression bloats for 6 days; nobody notices. Twilio 10DLC rejected; SMS throughput drops; nobody alerts. Sophie auto-resolves a contract dispute at 72% confidence; screenshot on Twitter; you find out from a call. Automation without a second human = automation without accountability. Mitigation: runbooks + sidebar + synthetic checks = visibility. You want the ops engineer's first week to be "here's how things fail," not "Thomas will show you when it's on fire."

**Contrarian to Marisol:** She wants COGS rollups before raising. I'd reverse: ops discipline first. Hit 500 customers with flaky ops and unit economics become secondary—you have a support meltdown. Get scaling discipline in place first.

— Olu
