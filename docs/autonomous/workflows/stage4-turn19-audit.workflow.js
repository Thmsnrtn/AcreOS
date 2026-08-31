export const meta = {
  name: 'stage4-turn19-audit',
  description: 'Independent adversarial completeness audit closing the stage-4 consolidation program — every turn claim treated as a hypothesis',
  phases: [{ title: 'Claims' }, { title: 'Refute' }, { title: 'Cross-cuts' }, { title: 'Synthesize' }],
}
// TURN-19 CLOSING AUDIT (charter: docs/autonomous/BRAIN_CONSOLIDATION_STAGE4.md
// + this script). Fire ONLY after turns 12-13 are resolved (flipped on durable
// evidence, or explicitly refused with the divergence record) — the audit
// closes the program, it does not run inside it.
const CLAIMS_SCHEMA = { type: 'object', properties: { claims: { type: 'array', items: { type: 'object', properties: { turn: { type: 'string' }, claim: { type: 'string' }, evidenceNamed: { type: 'string' } }, required: ['turn', 'claim'] } } }, required: ['claims'] }
const VERDICT = { type: 'object', properties: { turn: { type: 'string' }, verdict: { type: 'string', enum: ['HOLDS', 'RESIDUE', 'FALSE'] }, findings: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'number' }, what: { type: 'string' }, severity: { type: 'string' } }, required: ['what'] } }, notes: { type: 'string' } }, required: ['turn', 'verdict', 'findings'] }

phase('Claims')
const parsed = await agent(
  'Read /home/user/AcreOS/docs/autonomous/BRAIN_CONSOLIDATION_STAGE4.md in full. Extract EVERY "DONE" turn annotation (turns 1-18, decisions A-G, and any correction blocks) as a list of discrete, checkable CLAIMS — what the turn says was built, deleted, flipped, pinned, or measured, with the evidence each names (tests, ratchets, deploy numbers, grep results). One claim per verifiable assertion; keep the turn label on each.',
  { label: 'parse-claims', schema: CLAIMS_SCHEMA },
)
const claims = parsed?.claims ?? []
log(`${claims.length} claims extracted`)

const byTurn = new Map()
for (const c of claims) {
  if (!byTurn.has(c.turn)) byTurn.set(c.turn, [])
  byTurn.get(c.turn).push(c)
}

const verdicts = await parallel([...byTurn.entries()].map(([turn, turnClaims]) => () =>
  agent(
    `ADVERSARIAL AUDIT of stage-4 ${turn} in /home/user/AcreOS. You did NOT build this; treat every claim as a hypothesis and hunt for residue. Claims: ${JSON.stringify(turnClaims)}. For each: verify against CODE, not reports — run the named tests where cheap, grep for the deleted symbols (including URL-string consumers, dynamic imports, string registries — symbol greps miss route paths), check the named ratchet baselines match current counts, confirm "pinned" behaviors have a test that actually FAILS when mutated (read the test; if it pins source-shape where the claim is behavioral, that is RESIDUE). Hunt this codebase's signature defect: built-but-unwired (new exports with zero call sites, jobs never registered, routes never mounted, promised sweeps with no callers). Report HOLDS / RESIDUE / FALSE per the schema with file:line findings.`,
    { label: `audit:${turn}`, phase: 'Refute', schema: VERDICT },
  ),
))

phase('Cross-cuts')
const cross = await parallel([
  () => agent('CROSS-CUT 1 in /home/user/AcreOS: the flip evidence itself. Read server/services/autopilot/trustSeam.ts and the durable evidence design (jobHealthLogs trustSeamShadow rows, GET /api/admin/trust-seam-shadow). Verify: divergence persistence has a mutation-killable test; the aggregation cannot double-count boot-cumulative flushes; the flip (if it happened) consumed DURABLE evidence and the reachability exemptions for the seam staged-API were removed on adoption (they carry explicit revocation conditions — check scripts/ratchets/reachability.json allowlist). If the flip has NOT happened, verify nothing consumes seamVerdict as authority yet. Report per the schema with turn="cross:evidence".', { phase: 'Cross-cuts', schema: VERDICT }),
  () => agent('CROSS-CUT 2 in /home/user/AcreOS: count coherence. For every ratchet the stage-4 turns claim to have lowered (colon-any, table-count, reachability axes, FOUNDER_ROUTE_BASELINE, outward-coverage, chokepoint per-member counts), verify current measured count == committed baseline (run the lint scripts). Any stale-high is an unclaimed win to lock; any breach is a regression. Also verify the OD-8 ledger block (migrations 0241-0247 in scripts/migrate.mjs) still enumerates exactly the tables the program dropped and nothing has re-added a model for any of the 23. Report per the schema with turn="cross:counts".', { phase: 'Cross-cuts', schema: VERDICT }),
  () => agent('CROSS-CUT 3 in /home/user/AcreOS: the founder-facing story. Read docs/autonomous/BRAIN_CONSOLIDATION_STAGE4.md, OWNER_DECISIONS_PENDING.md and ACREOS_AUTONOMOUS_CAMPAIGN_STATE.md and hunt for statements that are STALE or contradicted by code (dates, counts, "pending" items that resolved, "wired" things that are not). The institution record is load-bearing across compactions — a false sentence there propagates into future sessions. Report per the schema with turn="cross:record".', { phase: 'Cross-cuts', schema: VERDICT }),
])

phase('Synthesize')
const all = [...verdicts.filter(Boolean), ...cross.filter(Boolean)]
const synthesis = await agent(
  `Synthesize the stage-4 closing audit from these per-turn and cross-cut verdicts: ${JSON.stringify(all)}. Produce: (1) the program verdict — closed clean, or open findings blocking closure; (2) every RESIDUE/FALSE finding ranked by severity with its repair; (3) which findings are repairs THIS audit cycle owes vs. recorded follow-ups; (4) the one-paragraph closure statement for the founder (plain language, no internal jargon). The program does not close while any FALSE finding stands unrepaired.`,
  { label: 'synthesize' },
)
return { claimCount: claims.length, verdicts: all, synthesis }
