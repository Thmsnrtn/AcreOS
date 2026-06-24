/**
 * Cognition Layer — C0: the Context Pack (the eagle-eye briefing).
 *
 * Today the only LLM in the decision path (deliberate.ts) sees a ~6-field state
 * line and may only reorder pre-ranked moves. The Cognition Layer's Operator
 * (C1/C2) instead reasons over THIS: a rich, structured, HONEST briefing of the
 * whole business — vitals, the books, the funnel, recent outcomes, attention,
 * trust, the founder's intent, episodic recall, and the running strategy thesis.
 *
 * This module is the briefing's shape + its assembly. The pure assembler
 * (`assembleContextPack`) is exhaustively testable with no IO; the thin async
 * gatherer (C2) will read the real sources and hand raw values in. Honesty is
 * load-bearing: a missing signal is LABELLED absent, never invented, and a
 * lower-bound (attribution) is marked as such — the Operator must never mistake
 * absence for a zero.
 */

// ── Raw inputs (what the gatherer reads from real sources) ────────────────────

export interface ContextPackRaw {
  /** Monthly recurring revenue, USD. */
  mrrUsd: number;
  /** MRR ~7 days ago from a real persisted pulse, or null if no prior datapoint. */
  mrrPriorUsd: number | null;
  trials: number;
  trialsEndingSoon: number;
  supportBacklog: number;
  /** Median first-response hours, or null if not measured yet. */
  supportFirstResponseHours: number | null;
  churnSignals: number;
  /** "green" | "amber" | "red" runway envelope. */
  envelopeStatus: string;
  /** Measured uptime %, or null if no samples yet. */
  uptimePct: number | null;
  openIncidents: number;
  complianceOpen: number;
  emailComplaints: number;

  /** Effective monthly cap (ramp-aware), base cap, month-to-date spend, reserve fraction. */
  effectiveCapUsd: number;
  baseCapUsd: number;
  mtdSpendUsd: number;
  reservePct: number;
  /** Attributed signups — a LOWER BOUND (absence ≠ failure). */
  attributedSignups: number;

  /** Recent decisions + realized outcomes, most recent first. */
  recentDecisions: Array<{ move: string; outcome: string }>;
  /** Forecast calibration grade + sample size, or null if untested. */
  calibrationGrade: string | null;
  calibrationN: number;

  /** Open founder asks with age in hours. */
  openAsks: Array<{ summary: string; ageHours: number }>;
  /** Per-domain autonomy + decision-quality line. */
  trust: Array<{ domain: string; level: string; qualityLine?: string | null }>;

  /** The founder's encoded will. */
  standingOrders: string[];
  objectives: string[];
  /** k-nearest past episodes + what worked. */
  recall: Array<{ situation: string; whatWorked: string }>;
  /** The running strategy thesis (strategyMemory, C4), or null until it exists. */
  thesis: string | null;
}

// ── The assembled pack ────────────────────────────────────────────────────────

export interface ContextPack {
  /** Honest provenance line: what's real, what's absent. */
  generatedNote: string;
  vitals: {
    mrrUsd: number;
    /** Week-over-week MRR change %, or null when there's no prior datapoint (never invented). */
    mrrWowPct: number | null;
    trials: number;
    trialsEndingSoon: number;
    supportBacklog: number;
    supportFirstResponseHours: number | null;
    churnSignals: number;
    envelopeStatus: string;
    uptimePct: number | null;
    openIncidents: number;
    complianceOpen: number;
    emailComplaints: number;
  };
  books: {
    effectiveCapUsd: number;
    baseCapUsd: number;
    ramped: boolean;
    mtdSpendUsd: number;
    /** Discretionary headroom after the reserve, USD (>= 0). */
    discretionaryHeadroomUsd: number;
    /** Attributed CAC, or null when no attributed signups (a lower bound, not a zero). */
    cacUsd: number | null;
    attributedSignups: number;
  };
  history: {
    recentDecisions: Array<{ move: string; outcome: string }>;
    calibrationGrade: string | null;
    calibrationN: number;
  };
  attention: { openAsks: Array<{ summary: string; ageHours: number }>; oldestAskHours: number | null };
  trust: Array<{ domain: string; level: string; qualityLine?: string | null }>;
  intent: { standingOrders: string[]; objectives: string[] };
  recall: Array<{ situation: string; whatWorked: string }>;
  thesis: string;
  /** A prompt-ready, human-readable eagle-eye briefing — what the Operator reasons over. */
  briefing: string;
}

function pct(numer: number, denom: number): number {
  return (numer / denom) * 100;
}

/**
 * Shape raw signals into the eagle-eye Context Pack. Pure + total. Honest by
 * construction: trends/CAC are null (not zero) when their inputs are absent, and
 * the briefing labels what's missing so the Operator never reasons on a phantom.
 */
export function assembleContextPack(raw: ContextPackRaw): ContextPack {
  const mrrWowPct =
    raw.mrrPriorUsd != null && raw.mrrPriorUsd > 0
      ? Math.round(pct(raw.mrrUsd - raw.mrrPriorUsd, raw.mrrPriorUsd) * 10) / 10
      : null;

  const reserveUsd = Math.max(0, raw.effectiveCapUsd * Math.min(1, Math.max(0, raw.reservePct)));
  const discretionaryHeadroomUsd = Math.max(0, raw.effectiveCapUsd - raw.mtdSpendUsd - reserveUsd);
  const cacUsd = raw.attributedSignups > 0 ? Math.round((raw.mtdSpendUsd / raw.attributedSignups) * 100) / 100 : null;
  const ramped = raw.effectiveCapUsd > raw.baseCapUsd;
  const oldestAskHours = raw.openAsks.length ? Math.max(...raw.openAsks.map((a) => a.ageHours)) : null;

  const absent: string[] = [];
  if (raw.mrrPriorUsd == null) absent.push("no prior MRR datapoint (trend omitted)");
  if (raw.uptimePct == null) absent.push("uptime not yet sampled");
  if (raw.supportFirstResponseHours == null) absent.push("support first-response not yet measured");
  if (raw.attributedSignups === 0) absent.push("no attributed signups yet (CAC is a lower bound, absent ≠ zero)");
  if (raw.calibrationGrade == null) absent.push("forecast calibration still learning");
  if (raw.thesis == null) absent.push("no strategy memory yet");

  const generatedNote =
    `Eagle-eye briefing assembled from real signals.` +
    (absent.length ? ` Absent/partial: ${absent.join("; ")}.` : ` All signals present.`);

  const trendLine =
    mrrWowPct == null ? "MRR trend: n/a (no prior datapoint)" : `MRR ${mrrWowPct >= 0 ? "+" : ""}${mrrWowPct}% WoW`;
  const cacLine = cacUsd == null ? "CAC: n/a (no attributed signups)" : `CAC ~$${cacUsd} (lower bound)`;
  const askLine = raw.openAsks.length
    ? `${raw.openAsks.length} open ask(s), oldest ${oldestAskHours}h`
    : "no open founder asks";

  const briefing = [
    `# Eagle-eye briefing`,
    generatedNote,
    ``,
    `## Vitals`,
    `$${raw.mrrUsd} MRR (${trendLine}); ${raw.trials} trial(s) (${raw.trialsEndingSoon} ending soon); ` +
      `${raw.supportBacklog} waiting on support` +
      `${raw.supportFirstResponseHours != null ? ` (first-response ~${raw.supportFirstResponseHours}h)` : ""}; ` +
      `${raw.churnSignals} churn signal(s); runway ${raw.envelopeStatus}; ` +
      `${raw.uptimePct != null ? `uptime ${raw.uptimePct}%` : "uptime n/a"}; ` +
      `${raw.openIncidents} incident(s), ${raw.complianceOpen} compliance item(s), ${raw.emailComplaints} spam complaint(s).`,
    ``,
    `## The books`,
    `Budget $${Math.round(raw.effectiveCapUsd)}/mo${ramped ? " (ramped from $" + Math.round(raw.baseCapUsd) + ")" : ""}; ` +
      `$${Math.round(raw.mtdSpendUsd)} spent MTD; $${Math.round(discretionaryHeadroomUsd)} discretionary headroom after reserve; ${cacLine}.`,
    ``,
    `## Attention`,
    askLine + ".",
    ``,
    `## Intent`,
    raw.standingOrders.length ? `Standing orders: ${raw.standingOrders.join("; ")}.` : "No standing orders.",
    raw.objectives.length ? `Objectives: ${raw.objectives.join("; ")}.` : "No objectives set.",
    ``,
    `## Thesis`,
    raw.thesis ?? "No strategy memory yet — establish one.",
  ].join("\n");

  return {
    generatedNote,
    vitals: {
      mrrUsd: raw.mrrUsd,
      mrrWowPct,
      trials: raw.trials,
      trialsEndingSoon: raw.trialsEndingSoon,
      supportBacklog: raw.supportBacklog,
      supportFirstResponseHours: raw.supportFirstResponseHours,
      churnSignals: raw.churnSignals,
      envelopeStatus: raw.envelopeStatus,
      uptimePct: raw.uptimePct,
      openIncidents: raw.openIncidents,
      complianceOpen: raw.complianceOpen,
      emailComplaints: raw.emailComplaints,
    },
    books: {
      effectiveCapUsd: raw.effectiveCapUsd,
      baseCapUsd: raw.baseCapUsd,
      ramped,
      mtdSpendUsd: raw.mtdSpendUsd,
      discretionaryHeadroomUsd,
      cacUsd,
      attributedSignups: raw.attributedSignups,
    },
    history: {
      recentDecisions: raw.recentDecisions,
      calibrationGrade: raw.calibrationGrade,
      calibrationN: raw.calibrationN,
    },
    attention: { openAsks: raw.openAsks, oldestAskHours },
    trust: raw.trust,
    intent: { standingOrders: raw.standingOrders, objectives: raw.objectives },
    recall: raw.recall,
    thesis: raw.thesis ?? "No strategy memory yet.",
    briefing,
  };
}

/**
 * Gather the live Context Pack from real sources (Phase 1 — gives the pure
 * assembler its first caller). Best-effort + honest: every source degrades to a
 * labelled-absent default, so the pack is always producible and never fabricates
 * a number it couldn't read. This is what the Operator (and the founder briefing)
 * reason over — the eagle-eye view the decision-path LLM has never had.
 */
export async function gatherContextPack(): Promise<ContextPack> {
  const raw: ContextPackRaw = {
    mrrUsd: 0, mrrPriorUsd: null, trials: 0, trialsEndingSoon: 0,
    supportBacklog: 0, supportFirstResponseHours: null, churnSignals: 0,
    envelopeStatus: "green", uptimePct: null, openIncidents: 0, complianceOpen: 0, emailComplaints: 0,
    effectiveCapUsd: 50, baseCapUsd: 50, mtdSpendUsd: 0, reservePct: 0.2, attributedSignups: 0,
    recentDecisions: [], calibrationGrade: null, calibrationN: 0,
    openAsks: [], trust: [], standingOrders: [], objectives: [], recall: [], thesis: null,
  };

  // Vitals — the morning pulse already aggregates most of them.
  try {
    const { composeMorningPulse } = await import("../solene/continuousLoop");
    const p = await composeMorningPulse();
    raw.mrrUsd = p.mrr;
    raw.trials = p.trials;
    raw.uptimePct = typeof p.uptimePct === "number" ? p.uptimePct : null;
    raw.complianceOpen = p.complianceOpenCount;
    raw.envelopeStatus = p.envelopeStatus;
  } catch { /* honest defaults */ }

  // Deliverability + churn (the outward senses decide.ts uses).
  try {
    const { readOutwardSenses, outwardSignalFrom } = await import("./perception");
    const s = outwardSignalFrom(await readOutwardSenses());
    raw.emailComplaints = s.emailComplaints;
    raw.churnSignals = s.churnSignals;
    raw.trialsEndingSoon = s.trialsEnding;
  } catch { /* none known */ }

  // The books.
  try {
    const { getEnsembleMonthlyCapUsd, getEffectiveMonthlyCapUsd, getMonthToDateSpendForType } =
      await import("../solene/capitalTracker");
    raw.baseCapUsd = getEnsembleMonthlyCapUsd();
    raw.effectiveCapUsd = await getEffectiveMonthlyCapUsd();
    raw.mtdSpendUsd = await getMonthToDateSpendForType("agent_dispatch");
  } catch { /* defaults */ }

  // Attribution (lower bound) + trust ledger + open asks + calibration.
  try {
    const { getConversionSummary } = await import("./attribution");
    raw.attributedSignups = (await getConversionSummary()).totalSignups;
  } catch { /* 0 */ }
  try {
    const { getTrustLedger } = await import("./domainAutonomy");
    const ledger = await getTrustLedger();
    raw.trust = ledger.map((d) => ({
      domain: d.domain,
      level: d.level,
      qualityLine: `${d.cleanCycleCount}/${d.threshold} clean cycles to next rung`,
    }));
  } catch { /* none */ }
  try {
    const { listOpenAsks } = await import("../solene/founderCollab");
    const asks = await listOpenAsks();
    const now = Date.now();
    raw.openAsks = asks.map((a) => ({
      summary: a.questionSummary,
      ageHours: a.askedAt ? Math.max(0, Math.round((now - new Date(a.askedAt).getTime()) / 3_600_000)) : 0,
    }));
  } catch { /* none */ }
  try {
    const { getCalibrationPairs } = await import("./experienceLog");
    const { calibrationReport } = await import("./forecast");
    const r = calibrationReport(await getCalibrationPairs());
    raw.calibrationGrade = r.grade;
    raw.calibrationN = r.n;
  } catch { /* learning */ }

  const pack = assembleContextPack(raw);

  // THE BET: append the causal theory of the business so the Operator reasons
  // over a falsifiable MODEL (levers → causal edges → outcomes), not just a
  // snapshot. v0 uses the seed model; B2's causal ledger refines its edges from
  // real witnessed interventions over time.
  try {
    const { summarizeModel, refineModel } = await import("./worldModel");
    const { LAND_PACK, landEvidenceByLever } = await import("./packs/land");
    // THE BET in motion: refine the seed edges from the org's own witnessed-
    // intervention history so the brain reasons over a model that SHARPENS with
    // consequence. Cold-start ≡ the seed priors (no episodes → identity).
    let model = LAND_PACK.causalModel;
    try {
      const { getPastEpisodes } = await import("./experienceLog");
      const episodes = (await getPastEpisodes(200)) as Array<{ moveKind: string; vote: string }>;
      model = refineModel(model, landEvidenceByLever(episodes));
    } catch { /* no episode history yet — seed model stands */ }
    pack.briefing += `\n\n## Causal theory\n${summarizeModel(model)}`;
  } catch { /* model unavailable — briefing stands without it */ }

  return pack;
}
