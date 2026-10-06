# Plan 9 — Tenant isolation on mutating routes, and server-side URL fetching

**Status:** Not yet run · **Owner:** [OWNER] founder to assign · **Index:** [README](README.md)

> This repository is public. This plan describes **test methods** only. Any
> defect found while running it is reported privately to the owner and is not
> written into the run log, an issue, or a commit message until it is fixed.

## Goal

Two properties, each checked over an **enumerated population** so that a
green result says which routes and call sites it covered:

- **Part A — isolation on mutating routes.** A signed-in member of
  organization B cannot create, change, link, or delete anything belonging to
  organization A through any `POST`, `PUT`, `PATCH` or `DELETE` route — whether
  A's identifier arrives in the path, the query, or the request body.
- **Part B — server-side URL fetching.** Every place the server fetches a URL
  that a caller can influence — directly in a request, or indirectly through a
  value stored earlier and fetched later — applies an address guard **at fetch
  time**, so the fetch cannot reach private, loopback, link-local or
  metadata addresses.

## Why the campaign could not cover it

The campaign's sweep (`tests/simulation/campaign/idor-sweep.ts`, on branch
`claude/simulation-campaign-2026-10`) enumerates `/api` routes whose **path**
carries an `:id`-style parameter, using a verb pattern that matches
`get|put|patch|delete`. It reads with B against A's forged rows, and for
`PUT`/`PATCH`/`DELETE` it attempts a benign write and re-reads A's row from
the database. So:

- `POST` routes are outside its population entirely (including sub-resource
  creates such as a payment under a note id in the path);
- identifiers carried in the **body** or **query** (`propertyId`, `dealId`,
  `leadId`, `noteId`, `assignedTo`, arrays of ids on bulk routes) are outside
  it, whatever the verb;
- server-side URL fetching was not tested at all. The campaign report's gap
  list names "POST by-id isolation" and "SSRF on enrichment".

## Existing assets

- `tests/security/idorFuzz.ts` — the original hand-picked by-id fuzz.
- `scripts/check-org-scoped-fetch.mjs` (`npm run lint:org-fetch`) — the static
  tenancy lint; a complement to, not a substitute for, the dynamic test.
- `tests/helpers/stripComments.ts` — the comment stripper the sweep uses for
  route enumeration.
- Two URL guards already in the codebase: `validateUrl` / `SSRFBlockedError`
  in `server/middleware/fileUploadSecurity.ts`, and `checkOperatorUrl` in
  `server/services/providers/ssrf-guard.ts`.
- Local environment as in the campaign: `scripts/ci/build-schema-from-repo.sh`,
  `tests/personas/seedDb.ts`, the test-auth bypass (`server/auth/testAuth.ts`).

## Environment and prerequisites

- **Local only**, with `E2E_TEST_AUTH=1`, a database built from the repository,
  and two seeded organizations (the sweep uses the personas
  `land-operator-desktop` as A and `note-investor-buyer` as B).
- `DATABASE_URL` for direct read-back (the airtight check), `SIM_BASE_URL`.
- Outbound providers unconfigured, so a mutating request cannot send mail,
  SMS, letters or charges.
- For Part B, a local canary HTTP listener on a private or loopback address in
  the test environment, used only to detect whether the server attempted a
  request to it.

## Procedure — Part A

1. **Population.** Extend route enumeration to `post` and to every verb,
   regardless of whether the path has an id parameter. For each route, also
   extract the identifier-shaped fields its handler reads from `req.body` and
   `req.query` (field names ending in `Id`/`Ids`, plus known references such
   as `assignedTo`). Print the population count and assert a floor, as the
   existing sweep does with `POPULATION_FLOOR`.
2. **Unit boundaries.** Add one canary fixture per registration shape the
   enumerator relies on (inline handler, wrapped handler, trailing comma,
   nested transaction callback, sync handler) and confirm each is found —
   CLAUDE.md, "the population is not just which files — it is where each unit
   begins and ends".
3. **Forge.** For each referenced table that carries `organization_id`, forge a
   row in A and a row in B with the sweep's generic row-forger.
4. **Positive control.** A performs the request against A's own row. A non-2xx
   or 5xx here is recorded as `control-failed`; a route whose control fails is
   not counted as isolated.
5. **Cross-tenant attempt.** B performs the same request with A's identifier
   placed where the route reads it (path, query or body), with an otherwise
   valid body.
6. **Read back from the database**, not from the response: A's row unchanged;
   no new row in any organization that references A's row; no row created in
   A's organization; no audit or ledger entry in A's organization. Status
   codes are recorded but do not decide the outcome.
7. **Honesty.** Every route that could not be exercised (no forgeable table,
   required external state, provider-dependent) is listed with its reason.
   Forged rows are removed.
8. **Falsify the detector.** Before trusting a clean result, run the detector
   once against a deliberately broken local build in which one mutating
   handler's organization filter is removed, and confirm it goes red.

## Procedure — Part B

9. **Enumerate fetch sites.** List every outbound HTTP call in `server/`
   (`fetch(`, `axios`, `https.get`, `http.request`, and any other client) whose
   URL is not a fixed literal host. Classify each URL source as: fixed
   provider host; caller-supplied in the request; stored by a customer or
   operator and fetched later; or supplied by an inbound third-party message.
   Put the enumeration in the test as a list, with a vacuity assertion per
   member, so a new fetch site that is not in the list fails the test.
10. **Static check.** For each non-fixed site, confirm the URL passes through
    `validateUrl` (or an equivalent that resolves the host) **at fetch time**,
    not only when the value was saved.
11. **Dynamic check.** For each caller-influenced input, submit a URL that
    resolves to the canary listener's private address, through the normal API,
    and assert: the API refuses or records a failure, and the canary receives
    no request. Repeat with a URL whose host is public at save time where the
    flow stores and fetches later, to confirm the fetch-time check.

### Candidate places to examine (Part B)

Step 9 produces the candidate list. It is kept with the private campaign
findings, not in this public document, and is handed to whoever runs this
plan. Results from Part B go to the private report first (see the README).

## Pass criteria

- **Part A:** zero cross-tenant effects observed by database read-back over
  the full enumerated population; the population floor holds; every shape
  canary is found; the falsification run in step 8 goes red; every
  unexercised route is listed with a reason.
- **Part B:** every non-fixed fetch site is in the enumerated list; each
  applies a fetch-time guard; the canary listener receives no request in any
  dynamic case.
- **Fail:** any cross-tenant write, link or delete; any fetch site absent from
  the list; any request reaching the canary.

## Results

Not yet run.

## Still owed

- An owner and a date.
- The campaign sweep landing on `main` (or a copy of it) as the base to extend.
- A decision on whether the extended sweep runs in CI, and with which floor.
- A private channel for reporting anything found (in place already for the
  campaign's own security findings).

## Run log

_(empty — append entries per the format in [README](README.md); security
findings go to the private report, not here)_
