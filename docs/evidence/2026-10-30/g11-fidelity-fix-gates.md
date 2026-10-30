# G11 fidelity fix — gates log (2026-10-30)

Branch `claude/g11-fidelity-fix`, based on main `58d1a9b`. Every verdict below was
read from a file (`> out.txt 2>&1; echo $?`), never through a pipe, after editing
finished. Local Postgres 16 built from this repository with
`scripts/ci/build-schema-from-repo.sh` (its only failure is the `vector`
extension for `solene_embedded_records`, unrelated), plus migration 0300.

| Gate | Result |
|---|---|
| `npm run check` (all 30+ sub-gates) | exit 0 |
| `npm test` | exit 0 — 1535 files passed, 35 skipped; 19,224 tests passed, 175 skipped |
| `npm run build` | exit 0 |
| Real-database acceptance tests (`ACREOS_REAL_DATABASE_URL`) | `tests/unit/g11FidelityFix.realdb.test.ts` 16/16 pass; run again with `rawSqlColumnsExist` 26/26 |

`npm test` skips `*.realdb.test.ts` without a database, so the 16 real-database
tests were run separately, against the Postgres above.

## Ratchets moved in this change
- `as-any` 1056 → 1055 (the `(req.permissionContext as any)` cast is gone): baseline lowered in the same commit.
- `check-tests-typecheck` stays 151 = 151 (a new offender in my own test was fixed, not absorbed).
- `lint-reachability` all 11 counts at baseline. The new exports are reached through one production-read object (`IMPORT_EXPORT_CONTRACT` on the import `columns` endpoint, `ACQUIRED_NOTES_EXPORT` on the notes `columns` endpoint), not through test-only exports.
- `colon-any` stays 2638.
- `rawSqlColumnsExist` unresolved-template count stays 49: the new test uses parameterised literal statements.

## Named acceptance tests → where they run
| Test (from the package) | File |
|---|---|
| originated notes import succeeds with a Start Date column | g11FidelityFix.realdb |
| …with a fieldMap supplying Start Date succeeds | g11FidelityFix.realdb |
| …without a start date refuses per row, leaves no orphan lead | g11FidelityFix.realdb (+ forced note failure takes its lead with it) |
| empty notes CSV re-import returns zero rows, not 500 | g11FidelityFix.realdb (HTTP, through the real route) |
| properties export re-imports 3/3 | g11FidelityFix.realdb |
| export headers are all importable | exportHeadersAreImportable (leads, properties, deals, notes, acquired) |
| leads export round-trips with zero fields lost | g11FidelityFix.realdb (DB read-back, 14 fields × 3 leads) |
| acquired notes export lists the N1 book | g11FidelityFix.realdb (HTTP, json and csv) |
| acquired notes export re-imports | g11FidelityFix.realdb (every `golden.expected.json` field, then committed into a fresh org and the book rows compared) |
| export-everything ZIP contains acquired notes | g11FidelityFix.realdb (real job → real ZIP) |
| investor-income: owner 200 / founder 200 / non-owner 403 | g11FidelityFix.realdb (sums 50,000 + 25,000 = 75,000) |
| PATCH writes provenance observations | g11FidelityFix.realdb |
| import errors contain no SQL | importErrorsContainNoSql (incl. 501-row shape) |

## Falsification (each fix undone on purpose; the named tests went red, then restored)
- Gate reads `permissionContext` only → `investor-income … org owner` red.
- "Start Date" removed from the map → 3 tests red.
- "Size (Acres)" removed → 2 tests red.
- SQL pass-through restored → 4 tests red.
- Rollback of the borrower lead disabled → "takes its borrower lead with it" red.
- The investor-income aggregation was red BEFORE its fix (225,000 against 75,000) and green after.

## Not run
- The staging round-trip demonstration the package asks for: staging is not reachable from this session. The real-database tests above stand in; the staging re-run is still owed.
- Security Scanning and the other `main`-only workflows: they run on the PR/merge, not here.
