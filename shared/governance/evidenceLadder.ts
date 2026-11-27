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

import {
  BUSINESS_TYPES,
  registryPublicTier,
  type BusinessTypeId,
  type PublicMaturity,
} from "../business-types";

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

/**
 * What the caveat says about the PUBLIC tier, per registry tier. Read from the
 * registry (shared/business-types.ts → registryPublicTier) so the ladder can
 * never restate a public claim by hand — it used to say "the public claim is
 * beta (OD-5)" for every surfaced vertical, which was true only while the
 * demotion table said so. Pinned against publicMaturityOf in
 * verticalReadiness.test.ts.
 */
const PUBLIC_TIER_WORDING: Record<PublicMaturity, string> = {
  core: "the public claim is core",
  beta: "the public claim is beta",
  roadmap: "registry-only, not in the public promise",
};

/**
 * A vertical's ladder entry, derived from the one readiness fact it states.
 *
 * `decided`: a decision under the vertical's pack cites a scenario from an engine
 * that declares the vertical (evidence rule v2, tests/support/verticalEvidence.ts).
 * `surfaced`: real modules and workflow templates, but no such decision. The
 * public-tier half of the caveat is READ FROM THE REGISTRY (FD1, 2026-11-12), so
 * the ladder tells the founder the same tier a stranger is told: a surfaced
 * vertical the founder nonetheless promised as core says so in plain words.
 */
function verticalEntry(
  id: BusinessTypeId,
  name: string,
  evidenced: "surfaced" | "decided",
  opts: { notGradeable?: string; gradedCoarsely?: string } = {},
): Capability {
  const base = { id: `vertical.${id}`, level: "E1" as const, proof: { unit: ["tests/unit/verticalReadiness.test.ts"] } };
  const publicTier = registryPublicTier(BUSINESS_TYPES[id].maturity);
  const publicWording = `${PUBLIC_TIER_WORDING[publicTier]} (FD1)`;
  if (evidenced === "decided") {
    const caveats = [
      ...(opts.notGradeable ? [`decided, not yet gradeable: ${opts.notGradeable}`] : []),
      // Gradeable, but only coarsely: said beside the proof so the claim is not
      // read as finer-grained than it is.
      ...(opts.gradedCoarsely ? [`gradeable, but coarse: ${opts.gradedCoarsely}`] : []),
      // A decided vertical promised as core needs no public caveat; one the
      // founder kept at beta or registry-only states that beside its proof.
      ...(publicTier === "core" ? [] : [publicWording]),
    ];
    return {
      ...base,
      claim: `The ${name} vertical closes the canonical loop (scenario → decision snapshot)`,
      ...(caveats.length > 0 ? { caveat: caveats.join("; ") } : {}),
    };
  }
  return {
    ...base,
    claim: `The ${name} vertical has real modules and workflow templates (evidenced 'surfaced')`,
    caveat:
      publicTier === "core"
        ? `surfaced, not decided: ${publicWording} by founder decision on surfaced evidence`
        : `surfaced, not decided: ${publicWording}`,
  };
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
  // W4 forecasting. A walk-forward backtest is the model graded on the past by
  // its author: it earns E1 (the engine and the scorer are tested), never more.
  // Customer surfaces additionally need a LIVE scored record
  // (shared/forecasting/scoring.ts customerForecastGate), which no engine has.
  {
    id: "forecast.cycle-phase",
    claim: "I can say which phase each state's job market is in, and where it is likely to be in six months, with probabilities",
    level: "E1",
    proof: { unit: ["tests/unit/forecastingEngines.test.ts", "tests/unit/forecastingBacktestRecord.test.ts"] },
    caveat: "scored only in a walk-forward backtest on real-time payroll vintages; no live forecast has been scored yet, so customers never see it",
  },
  {
    id: "forecast.land-value",
    claim: "I can give a range for next year's farm real estate value growth in each state",
    level: "E1",
    proof: { unit: ["tests/unit/forecastingEngines.test.ts", "tests/unit/forecastingBacktestRecord.test.ts"] },
    caveat: "backtested on the latest USDA release (USDA keeps no past releases, so revisions leak into the backtest); farmland is not the cheap rural land most customers buy; no live forecast scored yet",
  },
  // Every vertical, listed by hand (never generated from the registry, which would make
  // E1 automatic): a vertical added later with no entry here is never `core` publicly.
  // Each entry states ONE fact — the readiness tier its evidence reaches — and the
  // claim and caveat are derived from it (verticalEntry, above), so the ladder cannot
  // say "beta" about a vertical the evidence rule v2 has released. That tier is
  // pinned to the MEASURED one in verticalReadiness.test.ts, which also pins each
  // caveat's public-tier wording to publicMaturityOf (the registry's projection,
  // FD1): one rule, read in two places, never restated by hand.
  verticalEntry("land_flipper", "land flipper", "decided"),
  // note_investor flipped surfaced → decided 2026-11-20 in the N5 lift:
  // the price-to-yield engine + decision desk (N3+N4) record decisions
  // citing gradeable scenarios, so its FD1 register entry closed.
  // hybrid follows mechanically — it is land + notes, and reaches a tier
  // exactly when every part has (readiness.ts COMPOSITE_VERTICALS).
  verticalEntry("note_investor", "note investor", "decided"),
  verticalEntry("hybrid", "hybrid", "decided"),
  verticalEntry("fix_and_flip", "fix and flip", "decided"),
  // residential_wholesaler flipped surfaced → decided 2026-11-18 in the
  // core-status lift: its journey-proof hold ended when the scoped
  // revenue-loop walk passed green end-to-end (see shared/business-types.ts).
  verticalEntry("residential_wholesaler", "residential wholesaler", "decided"),
  verticalEntry("buy_and_hold", "buy and hold", "decided"),
  verticalEntry("short_term_rental", "short term rental", "surfaced"),
  // commercial flipped surfaced → decided 2026-11-25 in the commercial
  // desk lift: POST /api/commercial/underwrite records acquire/hold/pass
  // decisions under the commercial pack citing commercial_underwrite
  // scenarios, and the engine now produces an acquisition `total_cost`
  // (the multifamilyNoi v2 pattern), so its decisions are gradeable.
  verticalEntry("commercial", "commercial", "decided"),
  verticalEntry("creative_finance", "creative finance", "surfaced"),
  // developer flipped surfaced → decided 2026-11-24 in the developer desk
  // lift: the shared subdivision decision desk records decisions under the
  // literal "developer" pack (server/routes-subdivision-decision.ts) citing
  // scenarios from the subdivision_feasibility engine, which declares the
  // developer vertical — the same desk and engine that carry subdivider's
  // decided tier, so the ladder states the tier the measurement reports.
  verticalEntry("developer", "developer", "decided"),
  verticalEntry("subdivider", "subdivider", "decided", {
    gradedCoarsely: "a price lock is asked for its outcome on the whole parcel (sold or abandoned), not lot by lot",
  }),
  // tax_lien_deed flipped surfaced → decided 2026-11-20 in the T6 lift:
  // the max-bid engine + decision desk (T4+T5) record decisions citing
  // gradeable scenarios, so its FD1 register entry closed — the register
  // is now empty and the maturity-overclaim baseline is 0.
  verticalEntry("tax_lien_deed", "tax lien deed", "decided"),
  verticalEntry("multifamily", "multifamily", "surfaced"),
  verticalEntry("mobile_home", "mobile home", "surfaced"),
  verticalEntry("agent_investor", "agent investor", "surfaced"),
];

export function evidenceRankOf(level: EvidenceLevel): number {
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
    if (evidenceRankOf(c.level) > evidenceRankOf(highest)) highest = c.level;
  }
  const atLeast = (l: EvidenceLevel) => EVIDENCE_LEVELS.filter((x) => evidenceRankOf(x) >= evidenceRankOf(l)).reduce((a, x) => a + counts[x], 0);
  return { counts, total: registry.length, highest, provenInSimulation: atLeast("E2"), provenBeyondSimulation: atLeast("E3") };
}

/** The Letter's one evidence sentence, from evidenceSummary(). */
export function evidenceLine(registry: readonly Capability[] = CAPABILITIES): string {
  const s = evidenceSummary(registry);
  return s.provenBeyondSimulation === 0
    ? `What's proven: ${s.provenInSimulation} of the ${s.total} things I claim to do are proven in simulation on the real app; none yet with a real model or real customers.`
    : `What's proven: ${s.provenInSimulation} of the ${s.total} things I claim to do are proven in simulation, ${s.provenBeyondSimulation} with a real model or beyond.`;
}
