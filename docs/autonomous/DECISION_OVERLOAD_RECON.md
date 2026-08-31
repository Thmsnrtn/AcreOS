# Founder Decision Overload — first-principles reconnaissance (E-1)

Quality-program evidence item E-1 (master-directive amendment 2026-08-30).
Read-only census run 2026-08-31 by a 5-agent adversarial workflow over every
system that projects "things the founder must decide"; key claims re-verified
against code, not census self-reports. The founder observed ~1,200+ items.

## The composition of the ~1,200 (verdict)

**~1,200 = a presentation artifact × a real backlog.**

- **Layer A — the Letter double-counted every open ask (~2× multiplier).
  FIXED 2026-08-31.** `continuousLoop.ts` set BOTH `decisionsWaitingCount`
  and `asksOpenCount` from the same `collab.openCount`;
  `narrate.ts:350-352` summed them believing they were separate stores.
  ~600 real open asks rendered as "~1,200 things need your call".
  `letterNeedsYouUnion.test.ts` was green over the defect (it pinned the
  sum's shape, never the operands — Law 1's exact failure) and now pins the
  operands' provenance; `decisionsWaitingCount` now carries the genuinely
  separate store (pending `decisions_inbox_items`).
- **Layer B — undeduped per-tick ask minting (the live-flow bulk).**
  `act.ts:322` (+ :241, :269) mints asks with NO dedup — the only writer of
  six without one. At OBSERVE trust (default), `escalation.ts:116` always
  escalates a blocked top move, re-minting every 30-min tick (~48/day
  worst case); ladder drain at 72–168h ⇒ steady-state ~144–336 open from
  this writer alone.
- **Layer C — decisions-inbox pending accumulation.** Duplicate-flood
  writers with no dedup: `vendorSecretRotation.ts:344` (~30 dupes/vendor ×4
  vendors), stripe/schema drift (1/day while drift persists),
  `agentAuthorityGate.ts:362/:385` (per blocked attempt),
  `rosyRiver.ts:341` `agent_event` info rows (manual-close-only). 13 of 20
  inbox writers bypass the attention-budget arbiter entirely.
- **Layer D — invisible queues charged to the founder.**
  `cascade_resolutions` with `founderEscalated=true` accumulate with server
  endpoints but no client queue UI, yet `countFounderDecisionsThisWeek`
  charges them to the founder budget.

## Lifecycle/closure gaps, ranked

1. Letter double-count — FIXED (see above).
2. `act.ts` ask minting has no dedup (the sole writer without one).
3. `expireOverdueAsks` (`founderCollab.ts:404`) NEVER WIRED — `timeout_at`
   written on every insert, indexed, promised to the founder in
   `doNothing.ts:32`, enforced by nothing. The only real closer (the
   escalation ladder) runs inside the same best-effort tick that mints —
   one failure mode both creates and stops draining.
4. Non-yes_no asks (free_text/multi_choice/numeric) have NO automatic
   closure at all — immortal until manual founder action.
5. No-dedup cron writers into the inbox (vendor rotation worst).
6. Arbiter bypass asymmetry (13 direct inserts vs. the governed path).
7. Orphaned cascade queue + built-but-unwired aggregators
   (`/api/founder/intelligence/todo`, `/founder/now` — zero client
   consumers).
8. `gateWatcher.ts:692` re-raise cycle: an ignored ripe gate cycles
   ask→72h timeout→ask forever (bounded by 13 gates).
9. `doNothingContract('founder_ask')` tells the founder asks "close as
   timed out" after their timeout — false while the sweeper is unwired and
   the ladder ignores `timeout_at`.

## Misclassification (operational events shown as founder decisions)

Genuine authority (keep): witnessed sends/refunds, shadow promotions, gate
ripenings, budget ramps, immune-response security calls, letter replies.
Misclassified bulk: `agent_event` "Acknowledge" rows (Story, not
decisions); drift/vendor expiry duplicates (one condition = one item, not
thirty); per-attempt escalation echoes; per-tick re-asks. Structural cause:
OBSERVE-level trust converts every blocked intent into a founder question —
the system projects its own immaturity as founder workload, inverting "the
more autopilot operates, the fewer doors."

## Remediation map (quality-program work; NO bulk dismissal — closure must be
semantically justified per class)

1. ~~Fix the Letter union~~ — DONE 2026-08-31 (this commit).
2. `act.ts`: already-open dedup keyed (agentRole, move.kind, domain) —
   mirror the operator/immune marker pattern; supersede existing duplicates
   via `supersedeAsk` naming the surviving ask.
3. Wire `expireOverdueAsks` into runScheduledJobs; reconcile ladder vs.
   `timeout_at`; give non-yes_no asks an expiry; then update `doNothing.ts`
   wording to verified behavior.
4. Reclassify `agent_event` informational rows to Story with a read-cursor;
   close existing pending ones as "reclassified: informational".
5. Dedup the drift/vendor/authority-gate writers ("one open item per
   condition, refreshed not re-minted"); supersede duplicates-by-newest.
6. Route the 13 direct inbox writers through `arbitrateFounderInterrupt`.
7. Cascade queue: mount it behind the Decisions door or formally retire the
   lane; stop charging invisible items to the founder budget.
8. Witnessed lane polish: background pending→expired sweep; try/catch to
   un-wedge `approved` rows; render `expiresAt` on the card.

## Production probes that confirm each hypothesis (run when the program starts)

- H-A: pulse blob's `decisionsWaitingCount === asksOpenCount` in historical
  snapshots; headline ≈ 2× `SELECT count(*) FROM solene_founder_asks WHERE
  status='open'`. (Post-fix: headline = asks + inbox pending.)
- H-B: `SELECT question_summary, count(*) … GROUP BY 1 ORDER BY 2 DESC` —
  expect near-identical "Approve a {domain} action" rows spaced ~30min.
- H-C: `GET /api/founder/intelligence/decisions-inbox` → `stats.byType`
  dominated by vendor_secret_rotation / drift / agent_event duplicates.
- H-D: `SELECT count(*) FROM cascade_resolutions WHERE founder_escalated
  AND founder_resolution IS NULL` — nonzero = invisible debt.
- Cross-checks: three surfaces (mobile badge, Decisions door, Letter) each
  showing a different number confirms the projection-layer diagnosis;
  `status='open' AND timeout_at < now()` nonzero confirms the unwired
  sweeper in production.

Full structured censuses: workflow wf_3b891f41-02e (session transcript).
