// ============================================================================
// SHARED/SUBDIVISION/BUILDABILITYSCREEN.TS — the buildability screen
// ("buildability-screen v1"). Subdivision V1, Leg 1 (package 2026-11-05 §3).
// ----------------------------------------------------------------------------
// Pure and browser-safe. ONE definition of every kill trigger, read by the
// route that records a run and by every surface that shows one.
//
// THREE VERDICTS, NEVER TWO. Each trigger returns
//   triggered          — the facts as recorded affirmatively fire it;
//   clear_on_evidence  — the facts as recorded affirmatively clear it;
//   not_determinable   — the facts are absent (or a stated threshold the rule
//                        needs is absent); the verdict carries what would
//                        resolve it and whose job that is.
// UNKNOWN IS NOT CLEAR. The screen as a whole never says "buildable": its
// positive state is "no kill trigger fired on the facts recorded — N of 7
// triggers not determinable", with the N named.
//
// FACTS. Step 0 (§2.5) found the facts these triggers need stored almost
// nowhere with provenance — legal access, easements, slope, water/sewer and
// perc have no provenanced home on a parcel. So v1 reads facts AS THE OPERATOR
// RECORDS THEM ON THE RUN, each with its source and as-of, frozen verbatim on
// the run record. Thresholds (floodplain share, slope) are the operator's for
// this run — nothing is prefilled (§9.4).
//
// THE PERC SLOT (§3.4, Amendment 2 boundary — hard). The septic trigger reads,
// in order of strength: a recorded perc RESULT (the operator's own test), a
// recorded sewer-availability fact, or nothing. `percEstimate` is typed for the
// future calibrated model (estimate + basis + calibration state) and is ALWAYS
// null in v1: no surface shows a perc probability, a pass-rate, or a synonym.
// ============================================================================

import type { LotYieldEstimate } from "./lotYield";

const BUILDABILITY_SCREEN_VERSION = "buildability-screen v1";

/** A fact as the operator records it on this run: the value, where it came from, and when. */
export interface RecordedFact<T> {
  value: T;
  source: string;
  asOf: string | null;
}

/** Reserved for Amendment 2 §9's calibrated perc model. Never populated in v1. */
export interface PercEstimateSlot {
  estimate: number;
  basis: string;
  calibrationState: string;
}

export interface ScreenFacts {
  /** Legal access as recorded: deeded/recorded access, none, or only an unrecorded/unresolved easement. */
  legalAccess: RecordedFact<"recorded_access" | "no_legal_access" | "unrecorded_easement_only"> | null;
  /** Gross acreage the shares are computed over. */
  grossAcres: RecordedFact<number> | null;
  /** Acres in the regulatory floodway. */
  floodwayAcres: RecordedFact<number> | null;
  /** Acres in the 100-year floodplain (outside the floodway). */
  floodplainAcres: RecordedFact<number> | null;
  /** A perc test the operator ran: its result, with date and tester in `source`/`asOf`. */
  percResult: RecordedFact<"pass" | "fail"> | null;
  /** Public sewer available to the parcel. */
  sewerAvailable: RecordedFact<boolean> | null;
  /** Public or well water available to the parcel. */
  waterAvailable: RecordedFact<boolean> | null;
  /** Acres of buildable area crossed by an easement of record with no recorded resolution. */
  unresolvedEasementAcres: RecordedFact<number> | null;
  /** The steepest buildable-area slope, in percent. */
  maxSlopePct: RecordedFact<number> | null;
  /** v1: always null (see the header). */
  percEstimate: PercEstimateSlot | null;
}

export interface ScreenThresholds {
  /** Floodplain share (0..1) above which the flood trigger fires. The operator's, for this run. */
  floodplainShareMax: number | null;
  /** Slope (percent) above which the slope trigger fires. The operator's, for this run. */
  maxBuildableSlopePct: number | null;
}

const TRIGGER_IDS = [
  "no_legal_access",
  "flood",
  "septic",
  "unresolved_easement",
  "slope",
  "no_water_or_wastewater_path",
  "sub_minimum_yield",
] as const;
export type TriggerId = (typeof TRIGGER_IDS)[number];

export type Verdict = "triggered" | "clear_on_evidence" | "not_determinable";

export interface EvidenceItem {
  fact: string;
  value: string;
  source: string;
  asOf: string | null;
}

export interface ResolutionPath {
  /** What would resolve it. */
  action: string;
  /** What it costs, in the ignorance map's plain terms ("free, ~2 days", "ordered service"). */
  cost: string;
  /** Whose job it is. */
  owner: string;
}

export interface TriggerVerdict {
  id: TriggerId;
  label: string;
  verdict: Verdict;
  /** One sentence: why this verdict, on which facts. */
  reason: string;
  evidence: EvidenceItem[];
  /** Present exactly when the verdict is not_determinable. */
  resolution: ResolutionPath | null;
}

export interface ScreenResult {
  version: typeof BUILDABILITY_SCREEN_VERSION;
  verdicts: TriggerVerdict[];
  triggered: TriggerId[];
  notDeterminable: TriggerId[];
  /** The panel header. Never the word "buildable". */
  headline: string;
}

const LABELS: Record<TriggerId, string> = {
  no_legal_access: "No legal access",
  flood: "Floodway / floodplain",
  septic: "Unperkable / septic-infeasible",
  unresolved_easement: "Unresolvable easement or encumbrance",
  slope: "Slope / terrain",
  no_water_or_wastewater_path: "No water or wastewater path",
  sub_minimum_yield: "Sub-minimum yield",
};

const RESOLUTIONS: Record<TriggerId, ResolutionPath> = {
  no_legal_access: { action: "county recorder pull of the deed and any access easements", cost: "free, ~2 days", owner: "you" },
  flood: { action: "FEMA flood map panel read for the parcel, or a surveyor's flood determination", cost: "free (panel) / ordered service (survey)", owner: "you, or your surveyor" },
  septic: { action: "a perc test, or written sewer availability from the utility", cost: "ordered service", owner: "your soil scientist or utility" },
  unresolved_easement: { action: "county recorder pull of easements of record, or a title commitment", cost: "free (recorder) / title fee", owner: "you, or your title company" },
  slope: { action: "a topographic survey, or a slope read from county contours", cost: "ordered service (survey)", owner: "your surveyor" },
  no_water_or_wastewater_path: { action: "water availability letter from the utility (or a well permit), and the septic/sewer facts above", cost: "free to ordered service", owner: "you, with the utility" },
  sub_minimum_yield: { action: "state the facts the yield estimate is missing (see the yield estimate's not-determinable lines)", cost: "see each missing fact", owner: "you" },
};

const ev = (fact: string, f: RecordedFact<unknown>): EvidenceItem => ({ fact, value: String(f.value), source: f.source, asOf: f.asOf });

function verdict(id: TriggerId, v: Verdict, reason: string, evidence: EvidenceItem[]): TriggerVerdict {
  return { id, label: LABELS[id], verdict: v, reason, evidence, resolution: v === "not_determinable" ? RESOLUTIONS[id] : null };
}

function access(f: ScreenFacts): TriggerVerdict {
  const a = f.legalAccess;
  if (!a) return verdict("no_legal_access", "not_determinable", "no legal-access fact recorded", []);
  const e = [ev("legal access", a)];
  if (a.value === "recorded_access") return verdict("no_legal_access", "clear_on_evidence", "recorded legal access", e);
  return verdict(
    "no_legal_access",
    "triggered",
    a.value === "no_legal_access" ? "the record shows no legal access" : "access only via an unrecorded or unresolved easement",
    e,
  );
}

function flood(f: ScreenFacts, t: ScreenThresholds): TriggerVerdict {
  const e: EvidenceItem[] = [];
  if (f.floodwayAcres) e.push(ev("floodway acres", f.floodwayAcres));
  if (f.floodplainAcres) e.push(ev("floodplain acres", f.floodplainAcres));
  if (f.grossAcres) e.push(ev("gross acres", f.grossAcres));
  if (f.floodwayAcres && f.floodwayAcres.value > 0) {
    return verdict("flood", "triggered", `${f.floodwayAcres.value} ac lie in the regulatory floodway`, e);
  }
  if (!f.floodwayAcres || !f.floodplainAcres) {
    return verdict("flood", "not_determinable", `not recorded: ${[!f.floodwayAcres && "floodway acres", !f.floodplainAcres && "floodplain acres"].filter(Boolean).join(", ")}`, e);
  }
  if (f.floodplainAcres.value === 0) return verdict("flood", "clear_on_evidence", "no floodway and no floodplain acres recorded", e);
  if (!f.grossAcres || !(f.grossAcres.value > 0)) return verdict("flood", "not_determinable", "floodplain recorded but no gross acreage to take its share of", e);
  if (t.floodplainShareMax === null) return verdict("flood", "not_determinable", "floodplain recorded but no floodplain-share threshold stated for this run", e);
  const share = f.floodplainAcres.value / f.grossAcres.value;
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
  e.push({ fact: "your floodplain-share threshold for this run", value: pct(t.floodplainShareMax), source: "operator-stated", asOf: null });
  return share > t.floodplainShareMax
    ? verdict("flood", "triggered", `floodplain share ${pct(share)} exceeds your stated ${pct(t.floodplainShareMax)}`, e)
    : verdict("flood", "clear_on_evidence", `floodplain share ${pct(share)} is within your stated ${pct(t.floodplainShareMax)}`, e);
}

function septic(f: ScreenFacts): TriggerVerdict {
  const e: EvidenceItem[] = [];
  if (f.percResult) e.push(ev("perc test result", f.percResult));
  if (f.sewerAvailable) e.push(ev("public sewer available", f.sewerAvailable));
  if (f.sewerAvailable?.value === true) return verdict("septic", "clear_on_evidence", "public sewer recorded as available", e);
  if (f.percResult?.value === "pass") return verdict("septic", "clear_on_evidence", "a recorded perc test passed", e);
  if (f.percResult?.value === "fail") {
    return verdict("septic", "triggered", f.sewerAvailable ? "a recorded perc failure and no public sewer" : "a recorded perc failure, with no sewer path recorded", e);
  }
  return verdict("septic", "not_determinable", f.sewerAvailable ? "no sewer, and no perc result recorded" : "no perc result and no sewer fact recorded", e);
}

function easement(f: ScreenFacts): TriggerVerdict {
  const x = f.unresolvedEasementAcres;
  if (!x) return verdict("unresolved_easement", "not_determinable", "no easement fact recorded", []);
  return x.value > 0
    ? verdict("unresolved_easement", "triggered", `${x.value} ac of buildable area crossed by an easement with no recorded resolution`, [ev("unresolved easement acres", x)])
    : verdict("unresolved_easement", "clear_on_evidence", "no unresolved easement across the buildable area recorded", [ev("unresolved easement acres", x)]);
}

function slope(f: ScreenFacts, t: ScreenThresholds): TriggerVerdict {
  const s = f.maxSlopePct;
  const e: EvidenceItem[] = s ? [ev("steepest buildable slope (%)", s)] : [];
  if (!s) return verdict("slope", "not_determinable", "no slope fact recorded", e);
  if (t.maxBuildableSlopePct === null) return verdict("slope", "not_determinable", "slope recorded but no build threshold stated for this run", e);
  e.push({ fact: "your slope threshold for this run (%)", value: String(t.maxBuildableSlopePct), source: "operator-stated", asOf: null });
  return s.value > t.maxBuildableSlopePct
    ? verdict("slope", "triggered", `${s.value}% exceeds your stated ${t.maxBuildableSlopePct}%`, e)
    : verdict("slope", "clear_on_evidence", `${s.value}% is within your stated ${t.maxBuildableSlopePct}%`, e);
}

function utilities(f: ScreenFacts): TriggerVerdict {
  const e: EvidenceItem[] = [];
  if (f.waterAvailable) e.push(ev("water available", f.waterAvailable));
  if (f.sewerAvailable) e.push(ev("public sewer available", f.sewerAvailable));
  if (f.percResult) e.push(ev("perc test result", f.percResult));
  if (f.waterAvailable?.value === false) return verdict("no_water_or_wastewater_path", "triggered", "the record shows no available water", e);
  const wastewaterNone = f.sewerAvailable?.value === false && f.percResult?.value === "fail";
  if (wastewaterNone) return verdict("no_water_or_wastewater_path", "triggered", "no public sewer and a failed perc: no wastewater path recorded", e);
  const wastewaterYes = f.sewerAvailable?.value === true || f.percResult?.value === "pass";
  if (f.waterAvailable?.value === true && wastewaterYes) return verdict("no_water_or_wastewater_path", "clear_on_evidence", "water and a wastewater path both recorded", e);
  const missing = [!f.waterAvailable && "water", !wastewaterYes && "a wastewater path"].filter(Boolean).join(" and ");
  return verdict("no_water_or_wastewater_path", "not_determinable", `not recorded: ${missing}`, e);
}

function yieldTrigger(y: LotYieldEstimate | null): TriggerVerdict {
  if (!y || y.refusedReason) {
    return verdict("sub_minimum_yield", "not_determinable", y?.refusedReason ? `the yield estimate refused: ${y.refusedReason}` : "no yield estimate on this run", []);
  }
  const e: EvidenceItem[] = [
    { fact: "yield estimate, high end (lots)", value: String(y.yield.high.value), source: y.version, asOf: null },
    { fact: "yield estimate, low end (lots)", value: y.yield.low.value === null ? "not determinable" : String(y.yield.low.value), source: y.version, asOf: null },
  ];
  const hi = y.yield.high.value as number;
  if (hi < 2) return verdict("sub_minimum_yield", "triggered", `even the high end of the estimate is ${hi} lot${hi === 1 ? "" : "s"} — under 2, the parcel cannot subdivide on the facts stated`, e);
  const lo = y.yield.low.value;
  if (lo !== null && lo >= 2) return verdict("sub_minimum_yield", "clear_on_evidence", `the low end of the estimate is ${lo} lots`, e);
  return verdict("sub_minimum_yield", "not_determinable", lo === null ? "the low end of the yield estimate is not determinable" : `the estimate spans ${lo}–${hi} lots`, e);
}

/** The screen. Pure; reproducible from (facts, thresholds, yield). */
export function runBuildabilityScreen(facts: ScreenFacts, thresholds: ScreenThresholds, yieldEstimate: LotYieldEstimate | null): ScreenResult {
  const verdicts = [
    access(facts),
    flood(facts, thresholds),
    septic(facts),
    easement(facts),
    slope(facts, thresholds),
    utilities(facts),
    yieldTrigger(yieldEstimate),
  ];
  const triggered = verdicts.filter((v) => v.verdict === "triggered").map((v) => v.id);
  const notDeterminable = verdicts.filter((v) => v.verdict === "not_determinable").map((v) => v.id);
  const nd = notDeterminable.length;
  const ndNames = verdicts.filter((v) => v.verdict === "not_determinable").map((v) => v.label.toLowerCase());
  const ndClause = nd === 0 ? "every trigger determined" : `${nd} of ${verdicts.length} triggers not determinable (${ndNames.join("; ")})`;
  const headline =
    triggered.length > 0
      ? `${triggered.length} kill trigger${triggered.length === 1 ? "" : "s"} fired on the facts recorded (${verdicts
          .filter((v) => v.verdict === "triggered")
          .map((v) => v.label.toLowerCase())
          .join("; ")}) — ${ndClause}`
      : `No kill trigger fired on the facts recorded — ${ndClause}`;
  return { version: BUILDABILITY_SCREEN_VERSION, verdicts, triggered, notDeterminable, headline };
}

