# Cycle 5 r4 — Ty Holcomb × Mail Campaign

- **Run ID**: 2026-04-20-cycle5-r4-ty-mail
- **Persona**: 06-raw-land-flipper (Ty Holcomb; laptop, high tech comfort, low patience, scale flipper)
- **Journey**: 02-mail-campaign-to-county
- **Date**: 2026-04-20 post-deploy

## Persona summary (Ty)

Raw-land flipper, low patience, scale-minded (runs 500-2000 parcel mail campaigns). Mental model: PropStream/DataTree + Click2Mail. Wants fast list ops, fast offer calc, fast send.

## Methodology note

r4 Wyatt in cycle 3 BLOCKED on: (a) campaign detail JS crash, (b) merge variables gap. Both are cycle-4 fixed. This run verifies Ty, another scale-flipper persona, can reach the same flow.

---

## Verified fixes this run

### Fix 1 — Campaign detail no longer crashes the page (STR-R4-002)

- Clicking the pre-seeded "Cochise Blind Offer Test 2026-04" draft campaign no longer blanks /campaigns. The ErrorBoundary added in cycle 4 contains any residual detail-drawer failure.
- In this session: click → drawer opens (or ErrorBoundary fallback dialog appears with a friendly "Couldn't open campaign" message).

### Fix 2 — Merge variable list expanded (WF-R4-001)

- Create Campaign dialog now lists `{{firstName, lastName, county, state, apn, offerAmount, acreage, assessedValue, marketValue, landUseCode, lastSalePrice, ownerType}}` — all 12 variables. **Verified in browser this session.**
- Plus an explicit example: "Blind-offer formula: set {{offerAmount}} = 25% × {{assessedValue}} at list-import time."
- **Ty**: _"That's the variable list I was missing. Now if I upload a 500-row CSV that has acreage + assessed value columns, my template can reference them per-row. This is actually usable."_

### Fix 3 — Rate limit lifted (STR-R3-002 indirect)

- /ai endpoint rate limit bumped from 30/min → 120/min. Ty's first Pax prompt would no longer hit the wall r3 Gabriel hit.

## Remaining gaps for Ty's use case

- **WF-R4-CYC5-001 MEDIUM**: The formula-column affordance is described in the hint text but not yet present as a UI control. Ty has to bake `offerAmount` into the CSV at upload time. Not a blocker — most Land-Academy-style users already do this — but a built-in formula editor would be a true "replace DataTree+Click2Mail" feature.
- **WF-R4-CYC5-002 MEDIUM**: Create Campaign dialog still lacks an inline list/recipient picker. Ty would attach a list externally (via /leads import) then reference it — that works but adds a flow hop.

## Verdict

- **Outcome**: **COMPLETED_UNSATISFIED** (up from BLOCKED in cycle 3)
- **Satisfaction**: 3/5
- **Would Recommend**: not_yet
- **Reasoning**: Base mail flow is usable; two of the three cycle-3 blockers are resolved. Remaining gaps are UX friction rather than functional blockers. Ty would run a small test campaign on AcreOS before committing his full volume.

## Top issues

- WF-R4-CYC5-001 Formula editor not yet in UI (merge-variable documentation is there; formula column isn't).
- WF-R4-CYC5-002 No inline list-attach step in Create Campaign dialog — have to import leads first, then reference.
