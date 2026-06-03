# Role development — perpetual cadence

This tree is Solene's continuous role-development infrastructure for the
team (Iris, Soren, Beatrice, Krieger) and for herself. Treats every team
member's role as something to be *developed*, not just performed.

Per Tom (2026-06-02): *"I would like you to perform this type of deep
analysis on a regular basis and continuously improve yourself and the
entire team perpetually however that best looks in an elite fashion."*

## Layout

```
role-development/
  README.md                    ← this file
  elite-bars/<member>.md       ← current + aspirational bar per member
  evolution/<member>.md        ← append-only ledger of role evolutions
  reviews/<YYYY-MM>-<member>.md ← monthly deep reviews (rotating)
  arc/<YYYY>-Q<n>.md           ← quarterly Solene-arc reviews
```

## Cadence

| Frequency | Subject | Forcing function | Output |
|---|---|---|---|
| Weekly (Sun 23:00 UTC) | Solene decisions | `scripts/generate-weekly-retro.mjs` | `docs/company/retros/<ISO-week>.md` |
| Monthly (1st 09:00 UTC, rotating) | One team member | `scripts/generate-team-member-review.mjs` | `reviews/<YYYY-MM>-<member>.md` |
| Quarterly (1st of Jan/Apr/Jul/Oct 09:00 UTC) | Solene's own arc | `scripts/generate-solene-arc-review.mjs` | `arc/<YYYY>-Q<n>.md` |
| Continuous | Elite-bar tracker | hand-maintained, loaded into monthly reviews | `elite-bars/<member>.md` |
| Continuous | Role evolution log | append-only on every meaningful role change | `evolution/<member>.md` |

## Rotation (monthly review)

`month % 4` → 0=Iris, 1=Soren, 2=Beatrice, 3=Krieger.

- Jan / May / Sep → Iris
- Feb / Jun / Oct → Soren
- Mar / Jul / Nov → Beatrice
- Apr / Aug / Dec → Krieger

Override via `TEAM_MEMBER_REVIEW_OVERRIDE=iris|soren|beatrice|krieger`.

## Discipline

Empty skeletons are worse than no skeletons. The Solene self-audit
`checkReviewSkeletonStaleness` detector fires `warn` when a generated
review file still contains `TODO(solene):` markers more than 7 days after
generation. The cadence is real because the audit catches it when it
isn't.
