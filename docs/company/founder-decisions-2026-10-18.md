# Founder decisions — 2026-10-18

**Date:** 2026-10-18

**Source:** the founder's answer, relayed by the coordinating session of
2026-10-18 to the session building `claude/declared-uniques-enforced`. This
record was written by the implementing session from that relay; it did not see
the founder's answer itself. Only the founder can rescind it.

## An invalid FOUNDER_PRIMARY_ORG_ID pin is refused and alerted — "refuse and alert"

System alerts, on-call pages and other founder-scoped writes with no tenant
context land in the founder's organization, resolved by
`resolveFounderPrimaryOrgId()` (server/services/founder.ts). The strict rule
(`resolveFounderOrganization()`) accepts `FOUNDER_PRIMARY_ORG_ID` only when it
names an organization a founder identity owns. Until this decision, when the
strict rule refused the pin, the resolver still used it **as written**, and
otherwise fell back to a founder user's first team membership — so a stale or
mistyped pin could route founder alerts into an organization no founder owns.

**Decision:** when `FOUNDER_PRIMARY_ORG_ID` is set and the strict rule does not
accept it, the founder organization is **unresolved**:

- the pin is never used as written, and no team-membership guess replaces it;
- founder-scoped writes take the existing `FOUNDER_ORG_UNRESOLVED` path —
  nothing is written; on-call still emails (that channel needs no org);
- at production boot, the diagnostics send **one** on-call alert saying the
  pin is invalid and was refused. The alert and the logs never contain an
  organization id.

Unchanged: one founder-owned organization with no pin resolves ("sole-owned");
a pin naming a founder-owned organization resolves ("pinned"). (The no-pin
membership case is decided by the follow-up below.)

How it is enforced:

- `resolveFounderPrimaryOrgIdWithSource()` has no "as written" branch and no
  membership fallback (see the follow-up);
- `reportFounderOrgAtBoot()` (server/services/founderOrgDiagnostics.ts) titles
  the alert "FOUNDER_PRIMARY_ORG_ID is invalid and was refused";
- `/founder/readiness` shows "Founder organization resolves" as incomplete with
  the remedy;
- tests: `tests/unit/systemAlertsNeverLandInAGuessedOrg.test.ts` (an invalid
  pin is refused, not replaced by a membership guess, not read as written
  inside the miss window; a valid pin and the sole-owned path still resolve)
  and `tests/unit/founderOrgDiagnostics.test.ts` (unresolved with
  `pin-not-founder-owned`, one alert saying the pin is invalid, no ids).

## Follow-up, same day: no membership fallback either — "refuse it too"

**Source:** a second answer from the founder on 2026-10-18, relayed the same
way.

The first decision left one guess in place: with **no** `FOUNDER_PRIMARY_ORG_ID`
set, the resolver fell back to a founder user's first team membership. A
membership is not ownership — a founder invited into a customer's workspace
(support, a demo) is a member of it — so that fallback could still route
founder alerts into a customer's tenant.

**Decision:** only an organization a founder identity **owns** can be the
founder organization: the sole founder-owned organization, or the founder-owned
organization the pin selects. With no pin and no such organization (or several
without a pin), the founder organization is **unresolved**, with the same
refuse-and-alert behaviour: founder-scoped writes take the
`FOUNDER_ORG_UNRESOLVED` path and write nothing, and production boot sends one
on-call alert ("Founder organization is not configured") with no ids.

How it is enforced: `resolveFounderPrimaryOrgIdWithSource()` answers only from
the strict rule (`resolveFounderOrganization()`); its sources are `sole-owned`
and `pinned` and nothing else. Tests:
`tests/unit/systemAlertsNeverLandInAGuessedOrg.test.ts` (a membership never
answers, pinned or not; ownership still does) and
`tests/unit/founderOrgDiagnostics.test.ts` (a member-only founder is
unresolved and alerted once, no ids).

Production is unaffected: its pin names a founder-owned organization.
