# Gates log — reconcile chain (2026-10-30)

Branch `claude/reconcile-chain`, based on main `58d1a9b`. Package: `claude-package-reconcile-chain-2026-10.md`.

Every verdict below was read from a status file (`cmd > out; echo $? > status`), never through a pipe.

## Local gates

| Gate | Tree | Exit | Result |
|---|---|---|---|
| `npm run check` | `3ad5dbb` | 0 | PASS |
| `npm test` (full vitest) | `3ad5dbb` | 1 | 1 failed, 19,222 passed, 159 skipped (1,568 files) |
| `npm run build` | `3ad5dbb` | 0 | PASS |
| `npx vitest run` on the two affected files, after the fix | fix commit | 0 | 38/38 |
| `npm run check:tests`, after the fix | fix commit | 0 | PASS, 151 type errors (baseline 151) |

- **The one failure** was in this branch's own new test. `stripCommentsIsALexer.test.ts` reported `stagingSchemaReconcileChained.test.ts [named] comments`: the new test had a helper of its own that pulled out comment lines.
- **The fix** removes that helper. The false-claim check now reads the whole file, comments included, which is stricter. The `run:` command check uses the shared `tests/helpers/stripYamlComments`.
- **Not re-run after the fix:** the full suite. The fix touches only that one test file. CI runs the full suite on the PR head.

## Mutation checks on the new gate

`tests/unit/stagingSchemaReconcileChained.test.ts` turned red for each of these mutations, and each was restored afterwards:

1. The reconcile job `needs: test` instead of `deploy-staging`.
2. `if: always()` added to the reconcile caller.
3. The call to the reconcile workflow removed.
4. The stale `fly.staging.toml` "schema built via db:push" comment restored. Re-checked after the fix.
5. `workflow_call` removed from the reconcile workflow.
6. `needs: reconcile` removed from the census job.
7. The declared-but-absent tolerance loosened from 0 to 1.
8. Comment lines counted in the declaration census.
9. `pgTable(` occurrences with no readable name skipped instead of counted.

## Census method and tolerance (measured locally)

- **Declared:** every `pgTable(` on a non-comment line of every `.ts` file under `shared/`, tests excluded. This is the table-count ratchet's own population and line rule.
  - There are 748 occurrences, equal to the ratchet baseline, and every one has a literal name.
  - They give 746 distinct names. `conversations` and `messages` are each declared twice, in `shared/models/chat.ts` and `shared/schema.ts`.
  - The `shared/schema` barrel exports 743 tables. All of them are in the 746, and 3 tables are declared outside it.
- **Physical:** tables in staging's `public` schema (relkind r/p, no partitions), read SELECT-only on a staging machine as name plus constraint and trigger counts.
- **Tolerance:**
  - Declared tables absent from staging: 0.
  - Undeclared tables present on staging: at most 21, the 2026-10-28 residue. All are listed on every run and none is dropped.
  - Also checked: the newest migration block's tables (`0295_tax_v1_procedure_objects.sql` → `tax_procedure_objects`, 2 triggers) must be present with at least those triggers.

## Staging verification — NOT verified in this session

- **Dispatch:** my own dispatch was refused (`403 Resource not accessible by integration`). The founder reported dispatching `staging.yml` on `claude/reconcile-chain`. When this log was written, the Actions API listed no Deploy to Staging run on that branch. The newest staging run was #1237 (`40930899780`, a push to main at `58d1a9b`).
- **Unproven:**
  - That a deploy on the branch triggers the reconcile.
  - That the reconcile concludes SUCCESS.
  - That the census passes.
  - That the newest block landed (SELECT-only object check).
- **Undeclared count:** the real number on staging is unmeasured. If it is not ≤ 21, the census goes red on its first run, by design. The fix is then a founder decision, not a higher tolerance.
- **Loud-failure path:** unproven on staging. No benign statement failure was simulated, because that cannot be done safely from here. Locally it is covered: the census refuses each failure mode in the unit tests. The reconcile job's non-zero-exit path is unchanged from the existing nightly workflow.
- **Session limits:** this session also could not reach the Fly Machines API (the token was refused). So it could not read staging directly.

## Not done (out of scope, per the package)

- No production workflow changes.
- No change to `migrate.mjs`.
- No table drops.
