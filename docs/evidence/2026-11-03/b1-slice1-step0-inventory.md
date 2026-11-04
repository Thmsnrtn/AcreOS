# P2 B1 slice 1 — step-0 inventory, reuse-or-retire ruling, and stop report (2026-11-03)

Package: `claude-package-b1-slice1-2026-11.md` (Muse, 2026-11-03).
Measured on main `f7f2e3f` (2026-11-03 17:59 EST). Every fact below was
measured by reading code in the tree, not from reports. No code was changed;
no route was added or modified (route census delta: 0 of any method).

## Outcome in one paragraph

Step 0 ran and is recorded here. **Both build legs stopped on step-0
contradictions with the spec**, and **two of the four inventoried surfaces are
load-bearing for non-B1 functions**, which is itself a stop condition. Nothing
was built. The ratified spec's hard constraints (read-only, zero new non-GET
routes, founder gating, org-aggregated) could not be held *as specced* on
either leg without either removing live founder capability (leg 1) or
inventing gate data (leg 2).

## Measured facts that hold (re-proof only)

| Spec claim | Measured | Holds? |
|---|---|---|
| `client/src/pages/founder-decisions.tsx` = 59,156 bytes | 59,156 | yes |
| `command-center.tsx` = 55,067 | 55,067 | yes |
| `founder-ai-observatory.tsx` = 24,449 | 24,449 | yes |
| `founder-compliance-ops.tsx` = 30,574 | 30,574 | yes |
| `server/routes-founder-intelligence.ts` = 201,033 | 201,056 | drift +23 bytes (not material) |
| `server/routes-ops.ts` = 10,167 | 10,167 | yes |
| Inbox page fetches `GET /api/founder/autopilot/pending-actions` | yes, `founder-decisions.tsx` `WitnessedSendQueue` | yes |
| Founder gating pattern | client `FounderProtectedRoute`; server `isAuthenticated, requireFounder` | yes |
| `/founder/*` route ratchet | `founderFourDoors.test.ts` `FOUNDER_ROUTE_BASELINE = 81`, shrink-only | — (new surfaces must be sections behind a door) |

## Contradiction 1 — leg 1 (decision inbox): the approval write path exists and is live

The spec's premise (Problem §3, Non-goals): *"The approval write path does not
exist … that is package P2b."* On main it exists:

- `server/routes-autopilot.ts` registers
  `POST /api/founder/autopilot/pending-actions/:id/approve` and `…/:id/reject`
  (`isAuthenticated, requireFounder`). Approve calls `approvePendingHand`,
  which **executes** the frozen autopilot action (hash check, expiry check,
  `executed` outcome).
- `founder-decisions.tsx` is the **only client caller** of those routes, and of
  six other founder write paths. Mutating calls the page issues today:

  | Section | Request |
  |---|---|
  | Witnessed-send queue | `POST /api/founder/autopilot/pending-actions/:id/{approve,reject}` |
  | Decision cards | `POST /api/founder/intelligence/decisions-inbox/:id/approve` |
  | Decision log | `POST /api/founder/intelligence/decision-log/:id/reverse` |
  | Weekly digest | `POST /api/founder/autopilot/weekly-digest/:id/undo` |
  | Uncertain refunds | `POST /api/founder/refunds/:id/resolve` |
  | Open asks | answer / supersede dialogs (agents block on unanswered asks until timeout) |

The spec requires the page to be **rebuilt in place** with **no controls that
write**, and Test 5 asserts **the rebuilt page issues no mutating request**.
Holding that removes the founder's only UI for every path above: frozen
autopilot sends could no longer be approved anywhere, and agents waiting on
asks would sit until timeout. That is a regression of the Decisions door
(one of the four fixed founder doors), not a read-only slice. Not improvised;
leg 1 stopped.

What *does* hold for leg 1 (so stop condition "no consequence/deadline data"
does **not** fire): `autopilot_pending_actions` already carries `summary`
("what approval will do"), `sourceDispatchId` (an evidence anchor), and
`expiresAt` (a real deadline). Card semantics are derivable read-only from
existing columns; no schema needed. The blocker is purely the read-only vs.
live-write conflict.

Options for Muse/Tom (not chosen here):
- **A (recommended).** Re-scope leg 1 as *additive within the existing page*:
  restructure the cards to what/evidence/consequence/deadline and keep the
  existing write controls untouched; drop "page issues no mutating request"
  and replace it with "the PR adds zero non-GET routes and zero new mutating
  client calls." Fold P2b's premise into a correction (the write path already
  exists; P2b becomes hardening of it, if anything).
- **B.** Build the read-only inbox as a new section/tab behind the Decisions
  door, leaving the existing page's write sections as they are. Duplicates the
  witnessed-send list, which step 0 exists to prevent.
- **C.** Keep the spec as written and accept removing the live approval UI
  until P2b. Not recommended: it takes away a working founder control.

## Contradiction 2 — leg 2 (live Atlas): the ratified Atlas v1.3 is not in the repo

The spec feeds the Atlas surface from *"the ratified Atlas states and the
`docs/evidence/` record."* Searched main and all 134 remote branches:

- No Atlas v1.3 document, no gate register by that name, and none of the
  spec's design sources (`files/platform-pax-founder-ratification-brief-2026-10.md`,
  `files/platform-amendment-1-2026-10.md`, deepening/evolution docs) exist in
  the tree or the upload.
- Every "Atlas" hit in the repo is the **founder chat's former name**
  (`client/src/pages/atlas.tsx`, `BridgeAtlasPane.tsx`, `atlas_cto`), not a
  gate atlas. One prose mention of a "Readiness Atlas" in `next-moves.md` and
  `shared/business-types/publicClaims.ts` points at a document that is not
  in-repo.
- No machine-readable gate-state store exists (ambiguity #3 confirmed).

Rendering "one card per ratified gate" would require transcribing gate names,
states, dates, and attributions from a source I cannot read — fabrication, which
the DO-NOT-DO list forbids, and which Test 2 ("no card without proof") would
pass vacuously over invented rows. Leg 2 stopped. To unblock: commit Atlas v1.3
(and the data-program evidence states) into the repo — e.g. under
`docs/company/` — then the surface can render it as recorded, with its proof
links resolving to `docs/evidence/`.

## Inventory and rulings (slice 1 deletes nothing)

| Surface | What it is today (measured) | Ruling |
|---|---|---|
| `client/src/pages/founder-decisions.tsx` | The Decisions door (`/founder/decisions`, `FOUNDER_DOORS`); 7 live write paths (table above); reads pending-actions, decision-log, decisions-inbox, asks, digest, refunds | **REUSE** as the spec names, but see contradiction 1: it is a read+write surface, not a read surface |
| `client/src/pages/command-center.tsx` | **The customer's Pax door content.** `/command-center` is a redirect to `/ai#chat`; the live import is `client/src/pages/pax.tsx` (`/ai`, `ProtectedRoute`, customer). Founder AI-console panels were already extracted from it to `client/src/components/founder/ai-console/` (2026-09-04) | **Not ruled — load-bearing for a non-B1 function (customer Pax).** Stop condition. It is not a founder surface and should leave the B1 inventory |
| `client/src/pages/founder-ai-observatory.tsx` | `/founder/ai-observatory` (`FounderProtectedRoute`); read-only: 4 GETs (`/api/founder/ai/stats`, `/api/founder/ai/telemetry`, `/api/admin/evolution-proposals`, `/api/admin/model-catalog`); 0 mutations; sole client caller of those endpoints; no in-app links found | **Keep-and-mark.** No overlap with the inbox or Atlas function. Candidate to move under `/founder/admin/*` in a consolidation package (lowers the route ratchet) |
| `client/src/pages/founder-compliance-ops.tsx` | `/founder/compliance-ops` (`FounderProtectedRoute`); **sole UI** for DSAR fulfil/self-test (`/api/founder/dsar/*`), fair-lending, disclosure-timing and reconciliation runs, vendor telemetry, pricing experiments; 5 mutations | **Not ruled — load-bearing for a non-B1 function (privacy/compliance obligations).** Stop condition |
| `server/routes-founder-intelligence.ts` | Mounted at `/api/founder/intelligence` behind `isAuthenticated, requireFounder`; 113 registrations (64 GET, 49 non-GET); 72 of 108 literal paths are referenced from the client by prefix; it backs the Decisions door's own decision cards (`decisions-inbox`, `decision-log`, incl. their writes) | **Not a retire-candidate** — it is the substrate under the current inbox. Its breadth (analytics, ops, and more) makes it load-bearing beyond B1; a full ruling needs its own study. Stop condition |

## Gates

Nothing built, so no vitest/typecheck/build deltas to report. Route census:
the PR diff is this file plus `docs/company/next-moves.md` — zero route
registrations of any method.
