/**
 * An UPDATE with nothing to set is not a no-op — it is malformed SQL.
 *
 * Drizzle DROPS undefined values from `.set()`, so a patch whose every value
 * is undefined renders the same statement as `.set({})`:
 *
 *   update "organizations" set  where "organizations"."id" = $1
 *                            ^^ nothing between SET and WHERE
 *
 * Postgres rejects that with a syntax error, which surfaces as a 500 with a
 * message about the SQL grammar — nowhere near the caller who sent an empty
 * body. The mechanism is pinned in tests/unit/emptyUpdateIsNotAStatement.test.ts.
 *
 * Two shapes of caller, two answers:
 *
 *   - A ROUTE that built the patch from a request body should answer 400.
 *     An empty PATCH body is the client's mistake and the client can fix it.
 *     Use `hasWritableValues` and return `Errors.badRequest`.
 *
 *   - An INTERNAL write path (a storage repo, a job, a service) should throw.
 *     Nothing in the request produced it, so there is no one to tell but the
 *     log — and it already throws today, just with a Postgres syntax error
 *     that names no call site. `assertWritablePatch` fails in the same place
 *     with a message that names the table and the caller.
 */

/** True iff at least one value survives Drizzle's undefined-dropping. */
export function hasWritableValues(patch: object | undefined | null): boolean {
  if (!patch) return false;
  for (const value of Object.values(patch)) {
    if (value !== undefined) return true;
  }
  return false;
}

/**
 * Throw unless the patch would produce a well-formed SET clause.
 *
 * `what` names the write for the log — conventionally `"<table>.<method>"`,
 * e.g. `"payments.updatePayment"`. Returns the patch so it can wrap an
 * argument inline.
 */
export function assertWritablePatch<T extends object>(patch: T, what: string): T {
  if (hasWritableValues(patch)) return patch;
  throw new Error(
    `Refusing to UPDATE ${what} with an empty patch: every value was undefined, ` +
      `which renders "set  where …" and is rejected by Postgres as a syntax error. ` +
      `The caller passed nothing to change — decide upstream whether that is a ` +
      `no-op (return early) or a bad request (answer 400).`,
  );
}
