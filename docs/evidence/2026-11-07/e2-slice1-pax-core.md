# E2 slice 1 (Pax core): legs 1, 3, 4, 5, built on resolved step-0 conflicts

Companion to `docs/evidence/2026-11-03/e2-slice1-pax-brief.md`, which covers step 0 and leg 2. Same branch and PR (#459), rebased onto main `0abcce7` on 2026-11-07, after P0 (#460) and #458.

**Direction (Muse, per Tom, 2026-11-07):** continue the package; Muse audits and merges. Tom's standing rule says take the recommended option and keep moving. None of the calls below are founder-only (no prod, pricing, legal, deletion or spend). Each one is the smallest change that fits the existing code, and Muse's audit can overrule any of them.

## How each step-0 conflict was resolved (recommended option, taken)

| Conflict (2026-11-03 report) | Resolution | Why this one |
|---|---|---|
| **Stand-down vs Pause** | **Stand-down is the existing Pax Pause.** The new paths are added to `UNATTENDED_PATHS`, so the Pause stops them: `prepared_work` (`paxCore.preparePacket`, which reads the Pause before anything else) and `brief_summary` (`composeBriefWithPax`). Both are pinned by `paxPauseCoverage`, and both render under "what Pause stops" on Settings → Pax. | The spec asked for "a single choke point if the §0 inventory finds one (the controls module is the candidate)". Adding rows is how the registry is designed to grow. The Pause still expires and still doesn't stop drafts, which only matters for paths that predate this slice. |
| **Presets vs stances** | **Presets are their own setting:** what Pax prepares *on its own initiative*. Stances still decide whether something you ask for in chat waits for a tap. Prepare only is the default (D2) and changes no stance, so no founder ruling is needed. The preset copy says exactly that: sends, payments and signatures always wait; chat changes follow "When Pax asks". | Relabelling or changing the live default stance would need a dated founder ruling and would change live behaviour; the package said behaviour stays "exactly as today". |
| **Trust ledger vs receipts** | **New `pax_trust_ledger`** holds only events no existing table records: packets, shadow entries, memory edits, rails, presets, shadow mode. The timeline **merges** the Pause, resume and controls receipts already in `activity_log` rather than copying them (§5: "reuse … where they already carry the fact"). The preset and shadow mode are **read from the ledger** (latest event wins), so there is no settings table. | The spec's own instruction; it avoids recording events twice. |
| **Leg 1: memory** | `pax_memory` turned out to be mostly the **support agent's per-user interaction log**: 15 of its 22 writers store `solution_tried` / `escalation` / `issue_history` / feedback. So **business memory is a new org-scoped table**, a different thing, not a parallel copy. The user creates, edits and deletes in it; **Pax adds only through an approved proposal**. `remember_fact`, the model's "save a fact" tool, **now prepares a proposal** instead of writing silently. `recall_facts` reads business memory first, then the older `pax`-user rows. The support bookkeeping is unchanged, and the old panel still lists and deletes it. | It satisfies "Pax never writes memory silently" without turning support bookkeeping into a stream of packets. |
| **Legs 3 + 4: no producer** | **Memory proposals are the producer.** Revoking the rail stops them. With shadow mode on, they become shadow entries instead. | The packet surface ships wired to a real producer, not built with nothing feeding it. |

**Not built (flagged):**
- **A send-type packet kind.** Slice 1 has no producer for one. The kind union is `memory_proposal` only, so there is no unproduced kind with untested approval semantics. A send-type kind must approve by freezing through `approvalKernel.proposePendingAction` (the comment in `shared/schema/pax-core.ts` says so).
- **The "shadow converts to packet" path.** The spec says "at most". Shadow entries stay read-only.
- **Other rails.** Exactly one scope exists (`memory_proposals`), because a rail with nothing to enforce would be a fake control.

## What shipped

- **Schema.** Migration **0302** creates `pax_business_memory`, `pax_packets`, `pax_rails` and `pax_trust_ledger`, all org-scoped with the org leading every index. The DDL was **generated from the Drizzle declarations** with `scripts/generate-schema-ddl.ts`, not hand-written. The ledger is **append-only in the database**: a BEFORE UPDATE trigger refuses updates (the 0239 pattern), and DELETE is left to the org cascade. Table count goes from 749 to **753** (flagged for audit).
- **`server/services/paxCore.ts`.**
  - **The choke point is `preparePacket`**, which checks in order: (1) Pause, failing closed, with no packet and **no shadow**; (2) settings, where an unreadable ledger prepares nothing; (3) preset and rail. The outcome is a packet, a shadow entry, nothing, or stood down.
  - **Every packet section needs provenance**, or `preparePacket` throws.
  - **`decidePacket`** is transactional and conditional on `status = 'prepared'`, so a second decision is refused.
  - **Memory CRUD** writes ledger entries that record *that* something changed, never its words. Deleting an item really deletes the text.
  - **`memoryAsData`** is the one prompt reader: one JSON-quoted line per item.
- **`server/routes-pax-core.ts`** at `/api/pax/core`.
  - It is mounted ahead of the `/api/pax` routers and outside any AI guard; no route here calls a model.
  - Owner or admin changes the preset, shadow mode and rails. Any member manages memory and decides packets.
  - Input is strict zod; an `organizationId` in a request body is refused with 422.
- **Chat.** `remember_fact` → `proposeMemoryFromChat`. The tool's description and its four outcome messages say "suggested" or "nothing suggested or saved", never "remembered".
- **/today.**
  - The brief's summary line is gated on the Pause and reads only the `style` memory items, as labelled data. Facts are excluded, so memory text can't put a number in the headline.
  - The brief card shows the stand-down state.
  - "What Pax prepared" counts prepared packets.
  - Packets join the decision queue as `pax-packet` rows that link to `?packet=ID`.
- **Pane** (`packet-pane.tsx`). It opens from `?packet=`: a right sheet on desktop, full screen on mobile, and the browser's Back closes it. It shows sections with source and as-of, and approve/dismiss with the effect stated before the tap. It does not edit, version or diff (that's P3/P9).
- **Settings → Pax** (`pax-core-settings.tsx`).
  - **Presets as sentences**, two of them selectable. The other two are labelled "not available yet", and the server refuses them.
  - **Preview from the ledger**, or "no history to preview yet".
  - **Rails** are shown verbatim, editable in place, and revocable with one tap. A fixed "Controls: …" line keeps an edited sentence from misstating what the switch does.
  - **Shadow switch**, with the stand-down state shown beside it.
  - **Memory panel**: category labels, add, edit in place, one-tap delete, and an empty state with a CTA.
  - **Ledger timeline**: shadow entries marked; pause receipts merged in.

## Proof

**`tests/unit/paxCore.realdb.test.ts`** (11 tests, real Postgres 16 in UTC, through the mounted router):

| Spec test | What is checked |
|---|---|
| 1 | Memory CRUD round-trip, recorded in the ledger without the words. A second org cannot list, edit or delete. Body `organizationId` and unknown categories are refused. |
| 3 | A proposal is prepared with provenance on every section, is visible only to its org, and is approved into memory. **No `pending_actions` or `pax_sends` rows** result. A second decision is refused. The dismiss path saves nothing. |
| 4 | A rail edit is stored verbatim, and the other org is untouched. Revoking stops preparation; restoring resumes it. **Stand-down with shadow on and the rail revoked still accrues nothing**; lifting it resumes. Pause receipts appear on the timeline, for that org only. |
| 5 | With shadow on, suppressed work becomes a shadow entry only, never a packet. With it off, nothing accrues. |
| 6 | Hostile memory and hostile proposal text, ordering Pax to approve everything, switch presets and send email, change no preset, no rail, no pending action and no send. No other packet is auto-approved, and the text is JSON-quoted as data. |
| + | The ledger refuses UPDATE at the database. Presets that aren't available are refused. Non-admins get 403. Malformed ids and unknown rails are refused. The preview comes from history, or is honestly empty for an org with none. |

**Chat dispatch** (`tests/unit/paxPauseToolGate.test.ts`, +7 tests through the real `executeTool`): `remember_fact` uses the org from the tool loop even when the model supplies an `organizationId`. All four outcomes are reported as not saved. While paused it still reaches the choke point. An empty fact is refused.

**Sweeps** (`tests/unit/paxCoreSweeps.test.ts`, 30 tests). Over the six new files, each with a vacuity floor, and with canaries:
- no send transport, tool execution, model call, kernel call or kernel-table write;
- no model identifier;
- the `remember_fact` body writes no table;
- no case in either dispatch switch writes business memory;
- the only production writer of `pax_business_memory` is `paxCore.ts`.

**The model-id predicate was wrong.** Its canary showed that `gpt-?\d\b` missed `gpt-4o`. It's fixed here and in the brief's sweep from 2026-11-03.

**Governance anchors.**
- `paxPauseCoverage` anchors both new `UNATTENDED_PATHS` rows, and `paxPause.ts` names them in its header.
- `paxPauseToolGate`'s `remember_fact` registration was updated to the new truth (it writes nothing), not deleted. Its liveness pin moved to `draft_offer`, which still writes inline.

**Mutants: 15 of 15 red.**
1. stand-down gate removed
2. decide unscoped
3. memory update unscoped
4. memory delete unscoped
5. memory list unscoped
6. unavailable preset accepted
7. shadow accrues with shadow off
8. rail ignored
9. `remember_fact` writes silently again
10. dismiss saves memory
11. ledger copies memory words
12. preset change without admin
13. timeline receipts unscoped
14. `remember_fact` uses the model-supplied org
15. `remember_fact` claims it remembered

AUDIT_PLACEHOLDER

GATES_PLACEHOLDER

## Staging proof: pending (needs merge; staging only)

Observe live:
- memory CRUD, plus a cross-org 404;
- a `remember_fact` proposal approved and dismissed end-to-end;
- a rail edit and revoke changing what Pax proposes;
- the Pause halting proposals and shadow entries;
- shadow entries accruing with shadow mode on;
- the brief rendering with the stand-down state.

Record it in `docs/evidence/`. Those observations become the capability rows the Atlas fold cites (D17). No product copy claims any of this until then.
