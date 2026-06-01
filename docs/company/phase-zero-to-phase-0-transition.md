# Phase Zero → Phase 0 — Transition Checklist

Author: Soren (CGO), with Solene's final approval.
Date scaffolded: 2026-06-01.
Status: scaffold — gates listed; activation is Solene's call.

## What this doc is

The single artifact that says "Phase Zero is closed, Phase 0 is open."
Until every gate below is signed off, AcreOS is in pre-acquisition mode:
no paid customer outreach, no public posting cadence active, no
trial-to-paid funnel measured. The moment every gate flips, Phase 0
begins and the customer-acquisition machine is allowed to run.

## What's required to leave Phase Zero

Phase Zero is the substrate-building phase. Sub-phases:

| Sub-phase | What ships | Owner | Closed? |
|-----------|------------|-------|---------|
| Zero-Zero | Constitution + charter signed; team memory loaded; production app live | Tom + Solene | YES (pre-existing) |
| Zero-One  | Persona architecture remediation; founder/customer Pax separation; e2e mobile + desktop tests green | Iris | PENDING — Iris is verifying in a parallel agent at the time of this commit |
| Zero-Two  | Acquisition foundation: landing positioning verified; content runway strategy; PostHog instrumented; LinkedIn org page prep; truth engine on every public claim | Soren | SCAFFOLDED — this commit ships the foundation; Solene approves activation when Iris closes Zero-One |
| Zero-Three | Beatrice compliance pass on every customer-facing surface (privacy policy current, CAN-SPAM compliance on email templates, AI disclosure language, no dark patterns) | Beatrice | NOT STARTED — activates when Zero-Two lands |
| Zero-Four | Lena baseline metrics: 7 days of pre-launch traffic captured in PostHog (signup_started, signup_completed) so we know the no-acquisition baseline | Lena | NOT STARTED — activates when Zero-Three lands |

**Gate to leave Phase Zero:** every sub-phase row above marked YES.

## What's required to enter Phase 0

Phase 0 = "paying customer acquisition begins." Entry gates:

1. **Landing live, truth-engine clean.** `npm run truth-engine:audit` exits 0. Every numeric/capability claim has a source. (✅ verified this commit.)
2. **Five canonical PostHog events firing.** `signup_started`, `signup_completed`, `first_value_reached`, `pax_first_interaction`, `trial_to_paid` — all five emit on the appropriate boundaries in production. (✅ wired this commit; production-fire-verification gated on VITE_POSTHOG_KEY being set.)
3. **LinkedIn org page provisioned + bio published.** Per `docs/marketing/linkedin-org-page-setup.md` §1. Owner: Soren. NOT YET DONE — bio drafted, page provisioning blocked on Tom (requires Tom's LinkedIn admin access on the org page).
4. **Three seed posts queued.** Per `linkedin-org-page-setup.md` §2 — written, truth-engine cleared, Beatrice-reviewed, scheduled via Postiz/Buffer. NOT YET DONE.
5. **Six outreach email templates Beatrice-reviewed.** Per `phase-zero-two-content-runway.md` §3. Bodies drafted, CAN-SPAM physical-address + unsubscribe link confirmed, suppression list wiring tested. NOT YET DONE.
6. **First blog post body shipped + truth-engine cleared.** One of the 12 from the runway, full body, every numeric claim sourced. NOT YET DONE — bodies are explicitly deferred from the Phase Zero-Two scope.
7. **Sentry + PostHog dashboards have Solene + Lena access.** OPS task — not started.
8. **Public status page live at status.acreos.io.** Referenced in landing Footer + LinkedIn bio. Verify before posting (a broken link in the bio is a credibility leak). NOT VERIFIED.
9. **Iris signs off on Phase Zero-One completion.** Persona architecture + e2e tests + mobile parity. BLOCKING.
10. **Beatrice signs off on Phase Zero-Three compliance pass.** BLOCKING.
11. **Solene approves Phase 0 activation.** The final gate. After every row above is YES, Solene relays to Tom and updates the company charter.

## Owners by transition gate

| Gate | Owner | Hand-off receiver |
|------|-------|-------------------|
| Zero-One closure | Iris | Solene |
| Zero-Two closure | Soren | Solene |
| Zero-Three closure | Beatrice | Solene |
| Zero-Four closure | Lena | Solene |
| Phase 0 activation declaration | Solene | Tom + the team |

Solene is the single neck on every transition. Tom is informed; Solene activates.

## Solene's one-line on the day Phase 0 activates

Draft:

> *Tom — Phase 0 is open. Iris closed persona architecture and the e2e harness Friday, Beatrice cleared the compliance pass over the weekend, Soren has the LinkedIn page live with three posts scheduled and the first blog body up at acreos.io/blog, Lena's dashboard shows the pre-launch baseline. The acquisition funnel is allowed to run. First scheduled post drops at 8:30 AM CT.*

(One line is the format; the above expands for context. The actual delivery should compress to the spirit: "Phase 0 is open. Here's what's scheduled today.")

## What this doc is NOT

- Not the Phase 0 → Phase 1 transition (~$200 MRR threshold; deferred to a future file).
- Not the Phase 1 → Phase 2 transition.
- Not the kill-switch document (separate; lives in the constitution).
- Not authority to mark Phase Zero-Two ACTIVE — that remains Solene's call once Iris closes Zero-One.

## Sign-off log (filled in at activation)

| Date | Gate closed | Signer | Notes |
|------|-------------|--------|-------|
| 2026-06-01 | Zero-Two scaffolded | Soren | This commit. Awaiting Iris on Zero-One. |
| TBD | Zero-One closed | Iris | |
| TBD | Zero-Two activated | Solene | |
| TBD | Zero-Three closed | Beatrice | |
| TBD | Zero-Four closed | Lena | |
| TBD | Phase 0 activated | Solene | |
