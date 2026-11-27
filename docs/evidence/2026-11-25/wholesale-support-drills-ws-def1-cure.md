# Wholesale support drills — WS-DEF-1 cure addendum

Run id: `drill-wholesale-w8-ws-def1-cure-local-2026-11-25`
Date: 2026-11-25 · Lane: WS-DEF-1 cure, stacked on PR #767 (which is stacked on PR #753)
Defect: WS-DEF-1, filed in `docs/evidence/2026-11-24/wholesale-support-drills.md` — the nine
wholesale Pax tools lived on the chat path only; none was in the support resolver's subset,
so drill 3 ("Pax told me X") was UNPROVEN. This addendum is the cure record; the #767 record
is carried forward unrewritten. Pattern: PR #742 (T9-DEF-1) / PR #764 (BH-DEF-1), followed exactly.

## The cure

Eight of the nine wholesale tools are reads. Each now has a support-resolver variant under a
support-only name (the registries key one dispatch per tool name), dispatching through
`executeSupportTool` to the SAME shared helper in `server/ai/wholesaleTools.ts` the chat path
calls — verified by source read: identical function, no reimplementation. The two gate-view
reads pass the caller's user id (`options?.userId ?? null`) exactly as the chat path does, and
the compliance gate runs inside the shared helper, so it binds the support path identically.

| Chat tool (shared helper) | Support variant | Disposition |
|---|---|---|
| `get_wholesale_buy_box` (`paxGetWholesaleBuyBox`) | `get_wholesale_buy_box_view` | variant |
| `get_wholesale_triage` (`paxGetWholesaleTriage`) | `get_wholesale_triage_view` | variant |
| `get_wholesale_buyers` (`paxGetWholesaleBuyers`) | `get_wholesale_buyers_view` | variant |
| `get_wholesale_buyer_matches` (`paxGetWholesaleBuyerMatches`) | `get_wholesale_buyer_matches_view` | variant |
| `get_wholesale_assignments` (`paxGetWholesaleAssignments`) | `get_wholesale_assignments_view` | variant |
| `get_wholesale_decision` (`paxGetWholesaleDecision`) | `get_wholesale_decision_view` | variant |
| `get_wholesale_disposition_packet` (`paxGetWholesaleDispositionPacket`) | `get_wholesale_disposition_packet_view` | variant (preview only; gate-first inside the helper) |
| `get_wholesale_blasts` (`paxGetWholesaleBlasts`) | `get_wholesale_blasts_view` | variant |
| `record_buyer_blast_response` (`paxRecordBuyerBlastResponse`) | — | WRITE: no variant, pinned absent in the drill file |

Subset arithmetic: `RESOLVER_TOOL_NAMES` 13 → **21** (the eight `*_view` names inserted after
`get_account_summary`). Capability inventory: 163 → **171** (89 executeTool, 82 executeSupportTool),
regenerated with `scripts/pax-capability-inventory.mjs`.

Mirror points, all eight names at each: `server/ai/supportAgent.ts` (supportToolDefinitions,
PAUSE_SAFE_SUPPORT_TOOLS, executeSupportTool dispatch cases), `server/ai/paxSupportResolver.ts`
(RESOLVER_TOOL_NAMES + prompt paragraph), `shared/pax-controls.ts` (support looks_and_drafts),
`shared/pax-capabilities.ts` (rows: executeSupportTool, looks_and_drafts, scope null, pauseSafe
true, family `wholesale`, the chat rows' notCovered/objects, roles [], since 2026-11-25), and the
regenerated inventory doc. `server/ai/supportToolScopes.ts` is untouched — pause-safe tools carry
no scope entries, per the permission-ladder test's rule.

## Exclusions: none — and why the get_tenants treatment does not apply

#764 excluded `get_tenants` because the chat path gates it behind `tenant_pii_read`, a fence the
support classification cannot hold identically. No wholesale read is gated that way: the helpers
take the session org (plus the caller's user id for the two gate-view reads), there is no scope
check in `wholesaleTools.ts`, and the buyer-shaped reads expose names only — the source's own
words: "no email or phone leaves here". There is therefore no fence a variant could weaken, and
no read is excluded. The drill file pins this reasoning. Buyer email addresses and phone numbers
remain unreachable on the support path (they are unreachable on the chat path too), and the
resolver prompt says so.

## Drill 3, re-run

- Capability pin flipped in `tests/unit/wholesaleSupportDrills.test.ts` part 2
  (`wholesaleSupportDrillsStuck.test.ts`): subset == prior 13 + exactly the eight support reads,
  in order; no chat wholesale name in the subset; every subset name resolves to a real support
  definition; all eight registered at every mirror point; the write pinned absent; the
  no-exclusion reasoning pinned. Drills 1, 2 and 4 are carried forward byte-identical (part 1 and
  part 3 files untouched; part 2 changes are the header, the vitest/db imports, the drill-3
  scaffold and the drill-3 block only — drills 2c/2d untouched).
- Real-switch legs (same file, real `executeSupportTool`, mocked db, clock pinned 2026-11-23):
  the assignments read reproduces drill 1's figures on the support path ($12,000 signed counted,
  the $9,000 draft not counted, no-custody coverage verbatim, org in the WHERE); the buyer-match
  read surfaces the REAL compliance gate as blocked in IL; the packet read refuses in IL through
  the REAL gate before anything is derived (packet builder never called, no updates); an unknown
  deal is refused in plain words.
- Resolver leg (new `tests/unit/wholesaleSupportDrillsResolver.test.ts`, real resolver gate,
  mocked model): the ticket quotes a chat answer of "$21,000"; the model reads
  `get_wholesale_assignments_view` and drafts the correction ($12,000 signed; the draft does not
  count; a fee is a record — AcreOS holds and moves no money) → auto-resolves, grounded in the read.

**Drill 3 verdict: PASS** (local form, same as #767's other drills; executable green is
discharged by CI on this PR's landing path — see Battery).

## Census derivation (the hard-stop check)

Applied the `purposeLedgerCensus` derivation to the composed tree by hand, the #764 method:
`server/ai/wholesaleTools.ts` contains ZERO DIRECT_READ matches (its buyer reads join `leads`
for names from other tables' `.from(...)`; there is no `.from(leads)`, no `query.leads`, no
owner/mailing address read, no raw SQL over those tables), and the eight new `executeSupportTool`
case bodies contain no direct read at all — they only call the shared helpers. The helpers are
not in the data-access layer and define no direct read, so the reader closure gains no reader and
no new surface becomes a census candidate. **No DEBT entry is needed and none was added; the
founder-gated hard stop does not arise.** (The drill lane's earlier remark that a cure "needs
founder-gated census entries" was its brief's stop-rule caution, not a derivation.)

## Plain words

The cure adds NO new refusal strings: every refusal on the new cases is the shared helpers'
existing refusal, reused unreworded through `wholesaleOutcomeToResult`.

## Battery

LOCAL (this VM, 2026-11-25): see the lane record `build-ws-def1-cure-2026-11.md` for the
executed legs and their results. The VM's execution guard intermittently denies node/python
reads of repo files tonight (the #767/#764 documented fault); any leg it blocks is named
CI-discharge below, never silently skipped.

CI-DISCHARGE (named): everything not executed locally, including the full `npm run check`
chain, discharges on CI when this PR retargets to main after #753 and #767 land (the stacked-PR
CI trap: the pull_request family does not fire while the base is not main).

## Bundle

The delta is server/test/shared/docs only — no client source. Bundle-neutral by construction;
ceilings unchanged (customer 7,954 KB / founder 2,735 KB); the CI Build leg is the measurement
of record at landing. No ceiling was raised.

## Stacking

This PR's base is `wholesale-support-drills` (PR #767), which is stacked on
`wholesale-pax-tools-current` (PR #753). It lands only after both, then retargets to main.
