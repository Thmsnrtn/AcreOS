# E2E Intelligent Test Transcript

- **Run ID**: 2026-04-19-r5-eleanor-first-deal
- **Persona**: 08-retiree-small-budget (Eleanor Briggs, 3yr retired office manager, iPhone-only, $8k budget, low tolerance for jargon)
- **Journey**: 01-first-deal-evaluation
- **Date**: 2026-04-19T22:10:00Z
- **Target**: https://acreos.io
- **Protocol**: API-first
- **Steps**: 3

## Summary

Eleanor's journey overlaps r1/r2 on core path. Additional persona-specific concerns tested.

## Steps

1. `GET /api/onboarding/status` → **200** `{completed:false, currentStep:0, data:{}, totalSteps:5}`. Onboarding state tracked correctly. Good.
2. `GET /api/getting-started/checklist` → **404 Not Found**. Dashboard shows a "Getting Started 0/5" checklist, but the corresponding API is 404. Checklist items must be hardcoded client-side.
3. Evaluated shared blockers (STR-003 residue, STR-016, STR-019) from Eleanor's lens.

## Persona-specific findings layered on existing blockers

- UX-004 (HIGH, persona-amplified): "APN" appears everywhere in the product with no explanation. Eleanor's persona explicitly asks "What's an 'APN'? Is that like an address?" The Add Property form (r1 step 11) labels the field "APN" with placeholder `123-456-789` and no tooltip. For a first-time user from a retail audience, this is an immediate confusion point. Add a tooltip: "APN = Assessor's Parcel Number, the county's unique ID for the property."
- UX-005 (MEDIUM): The `/today` greeting "Good afternoon, E2E's Organization" (already UX-002) would hit Eleanor harder — she'd be confused about why her dashboard addresses her as "E2E's Organization." Low tolerance for feeling dumb.

## Journey Verdict

- **Outcome**: **BLOCKED** (inherited from STR-016 AI chat regression + general flow state)
- **Satisfaction**: 1/5
- **Would Recommend**: **no**
- **Reasoning**: Eleanor would make it further than Marcus did in r1 — she's patient, she'd read the empty states, she might even tolerate the onboarding wizard. But she'd stall at the first APN lookup ("what IS this thing"), tap around the sidebar for a minute, and if she couldn't find a plain-English "search for land near me" path she'd put the phone down. Her abandonment is quiet: not angry, just deflated. The 30+ sidebar items (per r1) make that outcome very likely.

### Additional Findings

- **UX-004** (HIGH): No tooltip / explainer on "APN" anywhere Eleanor would see it. Journey-blocking for beginner personas.
- **STR-022** (MEDIUM): `/api/getting-started/checklist` 404 despite the `/today` dashboard rendering a 0/5 checklist with specific items (add lead, import CSV, etc). Checklist is hardcoded client-side — can't be personalized or updated server-side.
