/**
 * Corroboration Engine — cross-source triangulation of independent free
 * federal instruments (ruling #9 wave 2, docs/company/founder-decisions-2026-07-28.md).
 *
 * The product idea: when independent agencies measuring the same physical
 * question AGREE, confidence rises mechanically; when they DISAGREE, the
 * disagreement itself is surfaced as a finding — never smoothed over. A
 * contradiction between FEMA, USFWS, and USDA is exactly the thing a land
 * buyer needs to see before trusting any single map.
 *
 * Rule table (v1):
 *
 *  ┌──────────────────┬───────────────────────────────────────────────────────┐
 *  │ wetness_triangle │ "Is this ground wet?" — three independent agencies:   │
 *  │                  │   • USFWS NWI     — hasWetlands (mapped wetlands)     │
 *  │                  │   • USDA SSURGO   — hydricRating ("Yes"/"No")         │
 *  │                  │   • MRLC NLCD     — wetland land-cover class (90/95)  │
 *  │                  │ ≥2 usable readings, all agree   → CORROBORATED        │
 *  │                  │ ≥2 usable readings, disagreement → CONTRADICTION      │
 *  │                  │ <2 usable readings              → INSUFFICIENT        │
 *  ├──────────────────┼───────────────────────────────────────────────────────┤
 *  │ flood_coherence  │ "Does this flood?" — two independent instruments:     │
 *  │                  │   • FEMA NFHL     — flood zone / riskLevel            │
 *  │                  │   • USDA SSURGO   — floodingFrequency                 │
 *  │                  │ Both determinate & equal        → CORROBORATED        │
 *  │                  │ Both determinate & opposed      → CONTRADICTION       │
 *  │                  │ Either missing or intermediate  → INSUFFICIENT        │
 *  │                  │ (FEMA "medium" / zone D, SSURGO "Rare" are honest     │
 *  │                  │  intermediates — they confirm nothing and contradict  │
 *  │                  │  nothing, so the rule says so instead of guessing.)   │
 *  └──────────────────┴───────────────────────────────────────────────────────┘
 *
 * Honesty contract:
 *  - A missing source is stated as unchecked — never assumed dry/safe.
 *  - A verdict NEVER comes from a single source (that is INSUFFICIENT).
 *  - Unrecognized/malformed values degrade to "indeterminate" (and thus
 *    toward INSUFFICIENT) — never a crash, never a guess.
 *  - Findings are categorical with a full per-source evidence chain. No
 *    invented weights, no numeric confidence scores we cannot ground.
 *
 * This module is PURE and dependency-free (no DB, no fetch) so it is fully
 * unit-testable and callable from any fetch layer. The broker categories it
 * mirrors are `flood_zone`, `wetlands`, `soil`, `land_cover` in
 * server/services/data-source-broker.ts — input shapes match those query
 * results exactly.
 *
 * FUTURE-INSTRUMENT SEAM: `extraInstruments` accepts a generic evidence list
 * so wave-2 sibling categories (e.g. `wildfire_hazard`, `broadband`) and later
 * sources can join rules without redesign. Instruments no rule consumes yet
 * are echoed back honestly as `noRuleYet` — present, seen, not yet triangulated.
 */

// ─── Source labels (match the broker's provenance titles) ────────────────────

export const SOURCE_NWI = "USFWS NWI";
export const SOURCE_SSURGO = "USDA SSURGO";
export const SOURCE_NLCD = "MRLC NLCD";
export const SOURCE_FEMA = "FEMA NFHL";

/** The broker categories the v1 rules read. */
export const CORROBORATION_CATEGORIES = [
  "flood_zone",
  "wetlands",
  "soil",
  "land_cover",
] as const;
export type CorroborationCategory = (typeof CORROBORATION_CATEGORIES)[number];

// ─── Input shapes (mirror data-source-broker query results; all optional) ────

/** `flood_zone` category result (queryFemaFlood). */
export interface FloodZoneInput {
  /** e.g. "Zone AE", "Zone X (Minimal Flood Hazard)" */
  zone?: unknown;
  /** "low" | "medium" | "high" */
  riskLevel?: unknown;
  lastUpdated?: string | null;
  [key: string]: unknown;
}

/** `wetlands` category result (queryNwiWetlands). */
export interface WetlandsInput {
  hasWetlands?: unknown;
  classification?: unknown;
  percentage?: unknown;
  lastUpdated?: string | null;
  [key: string]: unknown;
}

/** `soil` category result (querySoilData). */
export interface SoilInput {
  /** SSURGO component hydricrating: "Yes" | "No" | "Unranked" | null */
  hydricRating?: unknown;
  drainage?: unknown;
  /** SSURGO flodfreqdcd: "None" | "Very rare" | "Rare" | "Occasional" | "Frequent" | "Very frequent" | null */
  floodingFrequency?: unknown;
  suitability?: unknown;
  hydrologicGroup?: unknown;
  lastUpdated?: string | null;
  [key: string]: unknown;
}

/** `land_cover` category result (queryLandCover). */
export interface LandCoverInput {
  nlcdClass?: unknown;
  className?: unknown;
  isWetland?: unknown;
  year?: unknown;
  lastUpdated?: string | null;
  [key: string]: unknown;
}

/**
 * Generic evidence for instruments beyond the v1 rule set (the future seam).
 * Wave-2 siblings (`wildfire_hazard`, `broadband`, …) plug in here.
 */
export interface ExtraInstrumentEvidence {
  /** Broker category key, e.g. "wildfire_hazard". */
  category: string;
  /** Human source label, e.g. "USFS Wildfire Hazard Potential". */
  source: string;
  /** Raw signal values as fetched — never interpreted without a rule. */
  values: Record<string, unknown>;
  asOf?: string | null;
}

export interface CorroborationInputs {
  floodZone?: FloodZoneInput | null;
  wetlands?: WetlandsInput | null;
  soil?: SoilInput | null;
  landCover?: LandCoverInput | null;
  extraInstruments?: ExtraInstrumentEvidence[];
}

// ─── Output shapes ───────────────────────────────────────────────────────────

export type CorroborationStatus = "corroborated" | "contradiction" | "insufficient";

/** One link in a finding's evidence chain: what a source actually said. */
export interface SourceEvidence {
  source: string;
  category: string;
  /** The field the reading came from (e.g. "hydricRating"). */
  field: string;
  /** The raw value as provided (null when the source carried no value). */
  value: string | number | boolean | null;
  /** Source timestamp when known; null = unknown, never invented. */
  asOf: string | null;
}

export interface CorroborationFinding {
  ruleId: "wetness_triangle" | "flood_coherence";
  /** The physical question the rule triangulates. */
  claim: string;
  status: CorroborationStatus;
  /** Sources whose usable readings agree (corroborated) or form the sides (contradiction). */
  agreeingSources: string[];
  disagreeingSources: string[];
  /** Sources absent or with uninterpretable/intermediate readings, with the reason. */
  missingSources: Array<{ source: string; category: string; reason: string }>;
  /** Full per-source evidence chain for every source that was present. */
  evidence: SourceEvidence[];
  /** Plain-words note — the product. Always present. */
  fieldNote: string;
  /**
   * Only on CORROBORATED: the plain-words rationale for why agreement raises
   * confidence. Categorical — deliberately NOT a number.
   */
  confidenceBoost?: string;
}

export interface UncheckedCategory {
  category: CorroborationCategory;
  source: string;
  reason: string;
}

export interface CorroborationReport {
  findings: CorroborationFinding[];
  /** Core categories that were not provided — stated, never assumed. */
  unchecked: UncheckedCategory[];
  /** Source labels for every core category that WAS provided. */
  sourcesPresent: string[];
  /**
   * Extra instruments passed in that no rule consumes yet — echoed honestly
   * so the caller knows they were seen but not triangulated.
   */
  extraInstruments: Array<ExtraInstrumentEvidence & { noRuleYet: true }>;
  generatedAt: string;
}

// ─── Signal derivation (tolerant readers; malformed → indeterminate) ─────────

type TriState = "wet" | "dry" | "indeterminate";
type FloodState = "floods" | "minimal" | "indeterminate";

function asTrimmedLower(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().toLowerCase() : null;
}

function asOfOf(input: { lastUpdated?: string | null } | null | undefined): string | null {
  return typeof input?.lastUpdated === "string" ? input.lastUpdated : null;
}

/** NWI: mapped-wetlands boolean is the reading. */
function nwiWetSignal(w: WetlandsInput): { signal: TriState; reason?: string } {
  if (w.hasWetlands === true) return { signal: "wet" };
  if (w.hasWetlands === false) return { signal: "dry" };
  return {
    signal: "indeterminate",
    reason: `NWI hasWetlands value not interpretable (${JSON.stringify(w.hasWetlands ?? null)})`,
  };
}

/** SSURGO: component hydricrating "Yes"/"No"; anything else is not a reading. */
function ssurgoWetSignal(s: SoilInput): { signal: TriState; reason?: string } {
  const rating = asTrimmedLower(s.hydricRating);
  if (rating === "yes") return { signal: "wet" };
  if (rating === "no") return { signal: "dry" };
  return {
    signal: "indeterminate",
    reason: `SSURGO hydricRating not interpretable (${JSON.stringify(s.hydricRating ?? null)})`,
  };
}

/** NLCD wetland classes: 90 (Woody Wetlands), 95 (Emergent Herbaceous Wetlands). */
const NLCD_WETLAND_CODES = new Set([90, 95]);
/** All NLCD 2021 L48 class codes — a known non-wetland code is a real "dry" reading. */
const NLCD_KNOWN_CODES = new Set([11, 12, 21, 22, 23, 24, 31, 41, 42, 43, 52, 71, 81, 82, 90, 95]);

function nlcdWetSignal(lc: LandCoverInput): { signal: TriState; reason?: string } {
  if (lc.isWetland === true) return { signal: "wet" };
  if (lc.isWetland === false) {
    // isWetland:false is only a usable "dry" reading when the pixel actually
    // resolved to a known class — an unresolved pixel also reports false.
    const code = typeof lc.nlcdClass === "number" && Number.isFinite(lc.nlcdClass) ? lc.nlcdClass : null;
    const name = asTrimmedLower(lc.className);
    if ((code !== null && NLCD_KNOWN_CODES.has(code)) || (name !== null && name !== "unknown")) {
      return { signal: "dry" };
    }
    return { signal: "indeterminate", reason: "NLCD pixel did not resolve to a known land-cover class" };
  }
  const code = typeof lc.nlcdClass === "number" && Number.isFinite(lc.nlcdClass) ? lc.nlcdClass : null;
  if (code !== null && NLCD_KNOWN_CODES.has(code)) {
    return { signal: NLCD_WETLAND_CODES.has(code) ? "wet" : "dry" };
  }
  return {
    signal: "indeterminate",
    reason: `NLCD land-cover value not interpretable (${JSON.stringify(lc.nlcdClass ?? lc.className ?? null)})`,
  };
}

const FEMA_HIGH_PREFIXES = ["A", "V"]; // A, AE, AH, AO, AR, A99, V, VE
const FEMA_MINIMAL_PREFIXES = ["X", "B", "C"];

/** Strip the broker's "Zone " prefix / "(…)" suffix down to the bare zone code. */
export function bareFemaZone(zone: unknown): string | null {
  if (typeof zone !== "string" || zone.trim() === "") return null;
  const m = zone.trim().match(/^(?:zone\s+)?([A-Za-z0-9]+)/i);
  return m ? m[1].toUpperCase() : null;
}

function femaFloodSignal(fz: FloodZoneInput): { signal: FloodState; reason?: string } {
  const risk = asTrimmedLower(fz.riskLevel);
  if (risk === "high") return { signal: "floods" };
  if (risk === "low") return { signal: "minimal" };
  if (risk === "medium") {
    return {
      signal: "indeterminate",
      reason: "FEMA medium risk (500-yr / shaded X) is an intermediate signal — it neither confirms nor contradicts flooding",
    };
  }
  // riskLevel absent or unrecognized: fall back to the zone string itself.
  const bare = bareFemaZone(fz.zone);
  if (bare !== null) {
    if (FEMA_HIGH_PREFIXES.some((p) => bare.startsWith(p))) return { signal: "floods" };
    if (FEMA_MINIMAL_PREFIXES.some((p) => bare.startsWith(p))) return { signal: "minimal" };
  }
  return {
    signal: "indeterminate",
    reason: `FEMA flood reading not interpretable (riskLevel ${JSON.stringify(fz.riskLevel ?? null)}, zone ${JSON.stringify(fz.zone ?? null)})`,
  };
}

const SSURGO_FLOODS = new Set(["occasional", "frequent", "very frequent"]);
const SSURGO_MINIMAL = new Set(["none", "very rare"]);

function ssurgoFloodSignal(s: SoilInput): { signal: FloodState; reason?: string } {
  const freq = asTrimmedLower(s.floodingFrequency);
  if (freq !== null && SSURGO_FLOODS.has(freq)) return { signal: "floods" };
  if (freq !== null && SSURGO_MINIMAL.has(freq)) return { signal: "minimal" };
  if (freq === "rare") {
    return {
      signal: "indeterminate",
      reason: 'SSURGO flooding frequency "Rare" is an intermediate signal — it neither confirms nor contradicts flooding',
    };
  }
  return {
    signal: "indeterminate",
    reason: `SSURGO floodingFrequency not interpretable (${JSON.stringify(s.floodingFrequency ?? null)})`,
  };
}

// ─── Rule: wetness triangle ──────────────────────────────────────────────────

interface WetnessWitness {
  source: string;
  category: CorroborationCategory;
  signal: TriState;
  reason?: string;
  evidence: SourceEvidence;
  phrase: { wet: string; dry: string };
}

function evaluateWetnessTriangle(inputs: CorroborationInputs): CorroborationFinding {
  const witnesses: WetnessWitness[] = [];
  const missing: CorroborationFinding["missingSources"] = [];

  if (inputs.wetlands) {
    const { signal, reason } = nwiWetSignal(inputs.wetlands);
    witnesses.push({
      source: SOURCE_NWI,
      category: "wetlands",
      signal,
      reason,
      evidence: {
        source: SOURCE_NWI,
        category: "wetlands",
        field: "hasWetlands",
        value: normalizeEvidenceValue(inputs.wetlands.hasWetlands),
        asOf: asOfOf(inputs.wetlands),
      },
      phrase: {
        wet: "NWI maps wetlands on this parcel",
        dry: "NWI shows no mapped wetlands",
      },
    });
  } else {
    missing.push({ source: SOURCE_NWI, category: "wetlands", reason: "wetlands category not checked" });
  }

  if (inputs.soil) {
    const { signal, reason } = ssurgoWetSignal(inputs.soil);
    witnesses.push({
      source: SOURCE_SSURGO,
      category: "soil",
      signal,
      reason,
      evidence: {
        source: SOURCE_SSURGO,
        category: "soil",
        field: "hydricRating",
        value: normalizeEvidenceValue(inputs.soil.hydricRating),
        asOf: asOfOf(inputs.soil),
      },
      phrase: {
        wet: "the soil survey rates this ground hydric",
        dry: "the soil survey rates this ground non-hydric",
      },
    });
  } else {
    missing.push({ source: SOURCE_SSURGO, category: "soil", reason: "soil category not checked" });
  }

  if (inputs.landCover) {
    const { signal, reason } = nlcdWetSignal(inputs.landCover);
    witnesses.push({
      source: SOURCE_NLCD,
      category: "land_cover",
      signal,
      reason,
      evidence: {
        source: SOURCE_NLCD,
        category: "land_cover",
        field: "className",
        value: normalizeEvidenceValue(inputs.landCover.className ?? inputs.landCover.nlcdClass),
        asOf: asOfOf(inputs.landCover),
      },
      phrase: {
        wet: "NLCD classifies the land cover as wetland",
        dry: "NLCD land cover shows no wetland class",
      },
    });
  } else {
    missing.push({ source: SOURCE_NLCD, category: "land_cover", reason: "land_cover category not checked" });
  }

  // Present-but-uninterpretable readings count as missing for the verdict.
  for (const w of witnesses) {
    if (w.signal === "indeterminate") {
      missing.push({ source: w.source, category: w.category, reason: w.reason ?? "reading not interpretable" });
    }
  }

  const usable = witnesses.filter((w) => w.signal !== "indeterminate");
  const evidence = witnesses.map((w) => w.evidence);
  const claim = "Is this ground wet? (independent wetness instruments)";

  if (usable.length < 2) {
    const missingList = missing.map((m) => `${m.source} (${m.reason})`).join("; ");
    return {
      ruleId: "wetness_triangle",
      claim,
      status: "insufficient",
      agreeingSources: [],
      disagreeingSources: [],
      missingSources: missing,
      evidence,
      fieldNote:
        `Only ${usable.length} of 3 independent wetness instruments returned a usable reading — ` +
        `cross-checking needs at least two, so no verdict is drawn from a single source. ` +
        `Missing or unusable: ${missingList || "none provided"}.`,
    };
  }

  const wet = usable.filter((w) => w.signal === "wet");
  const dry = usable.filter((w) => w.signal === "dry");

  if (wet.length > 0 && dry.length > 0) {
    // CONTRADICTION — the finding IS the product. Lead with the "clean" side,
    // then the wet evidence, then flood-zone context when FEMA corroborates
    // wetness pressure, then the standing instruction.
    let note =
      dry.map((w) => w.phrase.dry).join(" and ") +
      ", but " +
      wet.map((w) => w.phrase.wet).join(" and ");
    if (inputs.floodZone) {
      const femaSignal = femaFloodSignal(inputs.floodZone);
      const bare = bareFemaZone(inputs.floodZone.zone);
      if (femaSignal.signal === "floods" && bare) {
        note += ` and it sits in FEMA zone ${bare}`;
      }
    }
    note += " — walk the parcel before trusting the map.";
    return {
      ruleId: "wetness_triangle",
      claim,
      status: "contradiction",
      agreeingSources: [],
      disagreeingSources: usable.map((w) => w.source),
      missingSources: missing,
      evidence,
      fieldNote: note,
    };
  }

  const verdictWet = wet.length > 0;
  const names = usable.map((w) => w.source);
  return {
    ruleId: "wetness_triangle",
    claim,
    status: "corroborated",
    agreeingSources: names,
    disagreeingSources: [],
    missingSources: missing,
    evidence,
    fieldNote: verdictWet
      ? `${names.join(", ")} independently agree this ground is wet: ${usable.map((w) => w.phrase.wet).join("; ")}.`
      : `${names.join(", ")} independently agree this ground shows no wetness signal: ${usable.map((w) => w.phrase.dry).join("; ")}.`,
    confidenceBoost:
      `${names.length} independent federal instruments (${names.join(", ")}) reached the same reading ` +
      `from separate surveys — simultaneous mapping error across ${names.length === 3 ? "all three" : "both"} is unlikely, ` +
      `which mechanically raises confidence in the ${verdictWet ? "wet" : "not-wet"} reading.`,
  };
}

// ─── Rule: flood coherence ───────────────────────────────────────────────────

function evaluateFloodCoherence(inputs: CorroborationInputs): CorroborationFinding {
  const missing: CorroborationFinding["missingSources"] = [];
  const evidence: SourceEvidence[] = [];
  const claim = "Does this ground flood? (FEMA mapping vs. soil-survey flooding record)";

  let fema: { signal: FloodState; reason?: string } | null = null;
  if (inputs.floodZone) {
    fema = femaFloodSignal(inputs.floodZone);
    evidence.push({
      source: SOURCE_FEMA,
      category: "flood_zone",
      field: "zone",
      value: normalizeEvidenceValue(inputs.floodZone.zone ?? inputs.floodZone.riskLevel),
      asOf: asOfOf(inputs.floodZone),
    });
    if (fema.signal === "indeterminate") {
      missing.push({ source: SOURCE_FEMA, category: "flood_zone", reason: fema.reason ?? "reading not interpretable" });
    }
  } else {
    missing.push({ source: SOURCE_FEMA, category: "flood_zone", reason: "flood_zone category not checked" });
  }

  let soil: { signal: FloodState; reason?: string } | null = null;
  if (inputs.soil) {
    soil = ssurgoFloodSignal(inputs.soil);
    evidence.push({
      source: SOURCE_SSURGO,
      category: "soil",
      field: "floodingFrequency",
      value: normalizeEvidenceValue(inputs.soil.floodingFrequency),
      asOf: asOfOf(inputs.soil),
    });
    if (soil.signal === "indeterminate") {
      missing.push({ source: SOURCE_SSURGO, category: "soil", reason: soil.reason ?? "reading not interpretable" });
    }
  } else {
    missing.push({ source: SOURCE_SSURGO, category: "soil", reason: "soil category not checked" });
  }

  const femaUsable = fema !== null && fema.signal !== "indeterminate";
  const soilUsable = soil !== null && soil.signal !== "indeterminate";

  if (!femaUsable || !soilUsable) {
    const missingList = missing.map((m) => `${m.source} (${m.reason})`).join("; ");
    return {
      ruleId: "flood_coherence",
      claim,
      status: "insufficient",
      agreeingSources: [],
      disagreeingSources: [],
      missingSources: missing,
      evidence,
      fieldNote:
        `Flood coherence needs both independent instruments (${SOURCE_FEMA} and ${SOURCE_SSURGO}) to return ` +
        `a usable reading — no verdict from one source. Missing or unusable: ${missingList}.`,
    };
  }

  const bare = bareFemaZone(inputs.floodZone!.zone);
  const zoneLabel = bare ? `zone ${bare}` : "an unlabeled zone";
  const freqRaw = typeof inputs.soil!.floodingFrequency === "string" ? inputs.soil!.floodingFrequency : String(inputs.soil!.floodingFrequency ?? "unknown");

  if (fema!.signal === soil!.signal) {
    const floods = fema!.signal === "floods";
    return {
      ruleId: "flood_coherence",
      claim,
      status: "corroborated",
      agreeingSources: [SOURCE_FEMA, SOURCE_SSURGO],
      disagreeingSources: [],
      missingSources: missing,
      evidence,
      fieldNote: floods
        ? `FEMA maps this parcel in ${zoneLabel} (high flood risk) and the soil survey independently records "${freqRaw}" flooding — two independent instruments agree this ground floods.`
        : `FEMA maps this parcel in ${zoneLabel} (minimal flood risk) and the soil survey independently records "${freqRaw}" flooding — two independent instruments agree flooding is not indicated.`,
      confidenceBoost:
        `${SOURCE_FEMA} (hydraulic mapping) and ${SOURCE_SSURGO} (field soil survey) measure flooding by entirely ` +
        `different methods and reached the same reading — mechanical confidence boost for the "${floods ? "floods" : "does not flood"}" verdict.`,
    };
  }

  const femaSaysFloods = fema!.signal === "floods";
  return {
    ruleId: "flood_coherence",
    claim,
    status: "contradiction",
    agreeingSources: [],
    disagreeingSources: [SOURCE_FEMA, SOURCE_SSURGO],
    missingSources: missing,
    evidence,
    fieldNote: femaSaysFloods
      ? `FEMA maps this parcel in ${zoneLabel} (high flood risk), but the soil survey records "${freqRaw}" flooding — one instrument is out of date or the parcel straddles a map boundary; verify elevation and flood history before trusting either map.`
      : `FEMA maps this parcel in ${zoneLabel} (minimal flood risk), but the soil survey records "${freqRaw}" flooding — one instrument is out of date or the parcel straddles a map boundary; verify elevation and flood history before trusting either map.`,
  };
}

// ─── Evidence value normalization ────────────────────────────────────────────

function normalizeEvidenceValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  // Non-primitive raw value: represent honestly as its JSON form, never guess.
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ─── Engine entry point ──────────────────────────────────────────────────────

export function corroborateParcel(inputs: CorroborationInputs): CorroborationReport {
  const safe: CorroborationInputs = inputs ?? {};

  const findings: CorroborationFinding[] = [
    evaluateWetnessTriangle(safe),
    evaluateFloodCoherence(safe),
  ];

  const presence: Array<{ category: CorroborationCategory; source: string; present: boolean }> = [
    { category: "flood_zone", source: SOURCE_FEMA, present: !!safe.floodZone },
    { category: "wetlands", source: SOURCE_NWI, present: !!safe.wetlands },
    { category: "soil", source: SOURCE_SSURGO, present: !!safe.soil },
    { category: "land_cover", source: SOURCE_NLCD, present: !!safe.landCover },
  ];

  return {
    findings,
    unchecked: presence
      .filter((p) => !p.present)
      .map((p) => ({
        category: p.category,
        source: p.source,
        reason: "no result for this category — source not checked, nothing assumed",
      })),
    sourcesPresent: presence.filter((p) => p.present).map((p) => p.source),
    extraInstruments: (safe.extraInstruments ?? []).map((inst) => ({
      ...inst,
      noRuleYet: true as const,
    })),
    generatedAt: new Date().toISOString(),
  };
}
