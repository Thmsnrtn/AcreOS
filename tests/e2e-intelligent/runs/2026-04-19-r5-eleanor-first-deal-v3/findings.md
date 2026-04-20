# Findings Report — r5 Eleanor × First Deal Evaluation

- **Run ID**: 2026-04-19-r5-eleanor-first-deal-v3
- **Persona**: 08-retiree-small-budget (Eleanor Briggs)
- **Total Findings**: 2

## HIGH

### WF-R5-001: /today information density overwhelms low-tech-comfort first-time users

- **Severity**: HIGH
- **Category**: workflow
- **Step**: 1
- **URL**: https://acreos.io/today
- **Description**: On initial load, /today renders 7+ distinct info-dense regions (early-access banner, trial CTA, onboarding hero, Getting Started checklist, Business Pulse, Start Here Today AI suggestions, Pipeline stats, Today's Actions, Pax Suggests, AI Action Queue, Portfolio Overview). A new user with low tech comfort cannot triage where to look first. For Eleanor specifically, abandonment trigger #5 (overwhelmed by information density) is met within 10 seconds.
- **Evidence**: DOM walks from r6 and r1 enumerate at least 7 visible cards on /today above the fold plus 3-4 more on scroll. No progressive-disclosure or "new user mode" is offered.
- **Persona Impact**: Eleanor would close the tab before exploring. The product's target-user framing for /today appears to assume an experienced investor, not a newcomer.
- **Recommended Action**: Add a "new user mode" that hides Business Pulse, AI Action Queue, and Pax Suggests until the Getting Started checklist reaches 50% complete. Alternatively, lead with the hero + checklist and push other cards below the fold.

## MEDIUM

### WF-R5-002: Domain jargon (APN, prospect, Quick Verdict, AcreScore) not glossed inline

- **Severity**: MEDIUM
- **Category**: workflow
- **Step**: 4
- **URL**: https://acreos.io/properties (and /today)
- **Description**: Key terms appear without tooltip definitions or a glossary link: APN, prospect (property status), Quick Verdict (on property detail), AcreScore (on /today), Business Pulse, Insufficient Data (score reason), Land Credit (sidebar). A low-tech-comfort retiree-persona cannot reliably decode these within her patience window.
- **Evidence**: DOM walk found no `aria-describedby`, no `[role="tooltip"]` on the affected terms; no visible "?" icons linking to definitions.
- **Persona Impact**: Eleanor's abandonment trigger #3 (jargon without definition). She would tap around, remain confused, and close.
- **Recommended Action**: Add hover/tap tooltips to: APN (Assessor Parcel Number — the county's unique ID for this parcel), prospect (status: considering, not yet owned), Quick Verdict (AI score from 0-4), AcreScore, Business Pulse. A single glossary page linked from the help menu would also mitigate.
