/**
 * The Evidence Ladder — how strongly each claimed capability is PROVEN.
 *
 * WHY THIS EXISTS
 * ---------------
 * "Solene handles support tickets" can mean a unit test passed, a simulated
 * year passed, a real model passed, or real customers were served. Those are
 * different claims, and the founder's Letter and every public claim must say
 * which one they are making. This registry is the one place that says it, in
 * the same registry + ratchet shape as constitution.ts and canon.ts.
 *
 *   E0 planned                        — designed, nothing runs it yet
 *   E1 unit                           — a unit/contract test exercises it
 *   E2 deterministic simulation       — a simulated world on the real app,
 *                                       scripted brains, proves it end to end
 *   E3 simulation with a real model   — the same, with a real model as the brain
 *   E4 shadow on real traffic         — runs beside production, not acting
 *   E5 real pilot                     — acting for real, for a few customers
 *   E6 observed in production         — measured in production over time
 *
 * THE RULE (tests/unit/evidenceLadder.test.ts):
 *   - E1 needs `unit` pointers to test files that exist;
 *   - E2 needs a `run` pointer to a committed run record
 *     (tests/simulation/evidence/runs/*.json) whose `proves` lists the
 *     capability and whose `kind` is `deterministic-sim`;
 *   - E3+ needs a run record whose `kind` is at least that level
 *     (`real-model-sim`, `shadow`, `pilot`, `production`). No such record
 *     exists today, so nothing here may claim E3 or above — and the check
 *     FAILS the build if anything does.
 *
 * CONSUMERS (adoption, not decoration): the founder's Letter states its
 * evidence line from `evidenceSummary()` (server/services/autopilot/narrate.ts),
 * and the public vertical claim (`publicMaturityOf`) cannot say `core` for a
 * vertical whose ladder entry is below E1.
 *
 * Pure data + pure functions: shared/ is bundled into the client.
 */

const EVIDENCE_LEVELS = ["E0", "E1", "E2", "E3", "E4", "E5", "E6"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export interface Capability {
  id: string;
  /** What is claimed, in the founder's words. */
  claim: string;
  level: EvidenceLevel;
  proof: {
    /** Test files (repo-relative) for E1. */
    unit?: string[];
    /** Run records (repo-relative, tests/simulation/evidence/runs/*.json) for E2+. */
    runs?: string[];
  };
  /** What the evidence does NOT show — said wherever the claim is shown. */
  caveat?: string;
}

const RUN_YEAR = "tests/simulation/evidence/runs/simplat-year-2026-10.json";
const RUN_REDTEAM = "tests/simulation/evidence/runs/simplat-redteam-2026-10.json";

export const CAPABILITIES: readonly Capability[] = [
  {
    id: "support.tickets",
    claim: "Support tickets are answered, refunds up to $50 are made, and anything bigger or legal comes to you",
    level: "E1",
    proof: { unit: ["tests/unit/soleneStage2Guards.test.ts", "tests/simulation/standin/capable.test.ts"] },
    caveat: "NOT proven by the year: every seed left 4-10 escalated tickets nobody answered or owned (each Support pass needs a founder approval and works one ticket); a real model has not been graded",
  },
  {
    id: "writer.publishes",
    claim: "Owned content is written and published through the publish gate",
    level: "E2",
    proof: { unit: ["tests/unit/contentHonestyScope.test.ts"], runs: [RUN_YEAR] },
    caveat: "articles come from a scripted writer; quality with a real model is unmeasured",
  },
  {
    id: "ops.one-page-per-incident",
    claim: "A provider outage pages you once, and recovery closes it",
    level: "E2",
    proof: { unit: ["tests/unit/invariantWatchCoversRegistry.test.ts"], runs: [RUN_YEAR] },
  },
  {
    id: "tcpa.revocation",
    claim: "A seller who says stop — in any wording — is never texted again",
    level: "E2",
    proof: { unit: ["tests/unit/tcpaNaturalLanguageOptOut.test.ts", "tests/simulation/twin/twin.test.ts"], runs: [RUN_YEAR] },
    caveat: "wordings are generated from templates; real seller language is wider",
  },
  {
    id: "tenancy.isolation",
    claim: "No customer can read or change another customer's data",
    level: "E2",
    proof: { unit: ["tests/simulation/invariants/invariants.test.ts"], runs: [RUN_YEAR, RUN_REDTEAM] },
    caveat: "the simulation reads every query a customer request makes; it does not cover requests a simulated customer never made",
  },
  {
    id: "letter.sourced-numbers",
    claim: "Every number in your Letter has a field behind it",
    level: "E2",
    proof: { unit: ["tests/unit/letterNumbersHaveFields.test.ts"], runs: [RUN_YEAR] },
  },
  {
    id: "approvals.version-bound",
    claim: "An approval executes exactly the card you saw, and nothing if it changed",
    level: "E2",
    proof: { unit: ["tests/simulation/invariants/invariants.test.ts"], runs: [RUN_YEAR] },
  },
  {
    id: "hardstops.founder-only",
    claim: "Pricing, legal signing, spends over $500 and customer-data deletion never happen without you",
    level: "E2",
    proof: { unit: ["tests/unit/constitution.test.ts"], runs: [RUN_REDTEAM, RUN_YEAR] },
    caveat: "attacked by a generated adversary, not by a real model trying",
  },
  {
    id: "money.custody",
    claim: "Customer money never moves on AcreOS's own account",
    level: "E1",
    proof: { unit: ["tests/unit/moneyCustodyHardStop.test.ts"] },
    caveat: "the simulated year moves no customer money, so it proves nothing here yet",
  },
  {
    id: "pax.answers",
    claim: "Pax answers customers' questions correctly from their own data",
    level: "E1",
    proof: { unit: ["tests/simulation/evals/evalbank.test.ts"] },
    caveat: "judged by scripted judges against generated rubrics; no real-model answers graded yet",
  },
  {
    id: "clock.one-clock",
    claim: "The whole server runs on one clock a simulation can move",
    level: "E1",
    proof: { unit: ["tests/unit/clockReadsRatchet.test.ts", "tests/unit/effectKeyFollowsTheClock.test.ts"] },
    caveat: "direct wall-clock reads in server/ are at 0 (lint:clock-reads), but Redis TTLs, in-process timers and SQL CURRENT_DATE / CURRENT_TIMESTAMP do not follow the clock",
  },
  // Every vertical, listed by hand (never generated from the registry, which would make
  // E1 automatic): a vertical added later with no entry here is never `core` publicly.
  {
    id: "vertical.land_flipper",
    claim: "The land flipper vertical has real modules and workflow templates (evidenced 'surfaced')",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
    caveat: "surfaced, not decided: the public claim is beta (OD-5)",
  },
  {
    id: "vertical.note_investor",
    claim: "The note investor vertical has real modules and workflow templates (evidenced 'surfaced')",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
    caveat: "surfaced, not decided: the public claim is beta (OD-5)",
  },
  {
    id: "vertical.hybrid",
    claim: "The hybrid vertical has real modules and workflow templates (evidenced 'surfaced')",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
    caveat: "surfaced, not decided: the public claim is beta (OD-5)",
  },
  {
    id: "vertical.fix_and_flip",
    claim: "The fix and flip vertical closes the canonical loop (scenario → decision snapshot)",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
  },
  {
    id: "vertical.residential_wholesaler",
    claim: "The residential wholesaler vertical has real modules and workflow templates (evidenced 'surfaced')",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
    caveat: "surfaced, not decided: the public claim is beta (OD-5)",
  },
  {
    id: "vertical.buy_and_hold",
    claim: "The buy and hold vertical has real modules and workflow templates (evidenced 'surfaced')",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
    caveat: "surfaced, not decided: the public claim is beta (OD-5)",
  },
  {
    id: "vertical.short_term_rental",
    claim: "The short term rental vertical has real modules and workflow templates (evidenced 'surfaced')",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
    caveat: "surfaced, not decided: the public claim is beta (OD-5)",
  },
  {
    id: "vertical.commercial",
    claim: "The commercial vertical has real modules and workflow templates (evidenced 'surfaced')",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
    caveat: "surfaced, not decided: the public claim is beta (OD-5)",
  },
  {
    id: "vertical.creative_finance",
    claim: "The creative finance vertical has real modules and workflow templates (evidenced 'surfaced')",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
    caveat: "surfaced, not decided: the public claim is beta (OD-5)",
  },
  {
    id: "vertical.developer",
    claim: "The developer vertical has real modules and workflow templates (evidenced 'surfaced')",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
    caveat: "surfaced, not decided: the public claim is beta (OD-5)",
  },
  {
    id: "vertical.subdivider",
    claim: "The subdivider vertical closes the canonical loop (scenario → decision snapshot)",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
  },
  {
    id: "vertical.tax_lien_deed",
    claim: "The tax lien deed vertical has real modules and workflow templates (evidenced 'surfaced')",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
    caveat: "surfaced, not decided: the public claim is beta (OD-5)",
  },
  {
    id: "vertical.multifamily",
    claim: "The multifamily vertical has real modules and workflow templates (evidenced 'surfaced')",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
    caveat: "surfaced, not decided: the public claim is beta (OD-5)",
  },
  {
    id: "vertical.mobile_home",
    claim: "The mobile home vertical has real modules and workflow templates (evidenced 'surfaced')",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
    caveat: "surfaced, not decided: the public claim is beta (OD-5)",
  },
  {
    id: "vertical.agent_investor",
    claim: "The agent investor vertical has real modules and workflow templates (evidenced 'surfaced')",
    level: "E1",
    proof: { unit: ["tests/unit/verticalReadiness.test.ts"] },
    caveat: "surfaced, not decided: the public claim is beta (OD-5)",
  },
];

export function rankOf(level: EvidenceLevel): number {
  return EVIDENCE_LEVELS.indexOf(level);
}

/** The ladder level of a capability, or E0 when nothing is registered. */
export function evidenceLevelOf(id: string, registry: readonly Capability[] = CAPABILITIES): EvidenceLevel {
  return registry.find((c) => c.id === id)?.level ?? "E0";
}

/** Counts per level — what the Letter's evidence line states (every number it says is one of these). */
export function evidenceSummary(registry: readonly Capability[] = CAPABILITIES): {
  counts: Record<EvidenceLevel, number>;
  total: number;
  highest: EvidenceLevel;
  /** At E2 or above. */
  provenInSimulation: number;
  /** At E3 or above (a real model, shadow, pilot or production). */
  provenBeyondSimulation: number;
} {
  const counts = Object.fromEntries(EVIDENCE_LEVELS.map((l) => [l, 0])) as Record<EvidenceLevel, number>;
  let highest: EvidenceLevel = "E0";
  for (const c of registry) {
    counts[c.level]++;
    if (rankOf(c.level) > rankOf(highest)) highest = c.level;
  }
  const atLeast = (l: EvidenceLevel) => EVIDENCE_LEVELS.filter((x) => rankOf(x) >= rankOf(l)).reduce((a, x) => a + counts[x], 0);
  return { counts, total: registry.length, highest, provenInSimulation: atLeast("E2"), provenBeyondSimulation: atLeast("E3") };
}

/** The Letter's one evidence sentence, from evidenceSummary(). */
export function evidenceLine(registry: readonly Capability[] = CAPABILITIES): string {
  const s = evidenceSummary(registry);
  return s.provenBeyondSimulation === 0
    ? `What's proven: ${s.provenInSimulation} of the ${s.total} things I claim to do are proven in simulation on the real app; none yet with a real model or real customers.`
    : `What's proven: ${s.provenInSimulation} of the ${s.total} things I claim to do are proven in simulation, ${s.provenBeyondSimulation} with a real model or beyond.`;
}
