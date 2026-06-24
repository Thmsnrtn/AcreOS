/**
 * THE BET (2035 vision) — the executable, self-revising CAUSAL WORLD-MODEL of the
 * business. The deepest leap-primitive every lens converged on: make CONSEQUENCE,
 * not a frozen catalog, the generator of the action space. The brain reasons over
 * a falsifiable model of the BUSINESS (variables + causal edges it can simulate
 * interventions on and propose edits to), not a snapshot of language about it.
 *
 * ── KERNEL (domain-agnostic — the Foundry-reusable spine) ────────────────────
 * CausalModel + queryIntervention (forward-propagate an intervention along the
 * causal graph) + summarizeModel. A new vertical supplies only its ontology +
 * edges (the DOMAIN PACK); this machinery is inherited unchanged.
 *
 * ── DOMAIN PACK (AcreOS) ─────────────────────────────────────────────────────
 * ACREOS_SEED_MODEL — the land-acquisition causal structure. Edge effects start
 * as LOW-confidence priors and get refined from the org's own witnessed-
 * intervention history (the causal ledger, B2) — so the model gets PERMANENTLY
 * SHARPER from real consequence, the heart of the bet.
 *
 * Pure + exhaustively testable. Honest by construction: every edge carries its
 * confidence + evidence; predictions are point + confidence, never an oracle.
 */

export type VariableKind = "lever" | "metric" | "outcome";

export interface CausalVariable {
  id: string;
  label: string;
  kind: VariableKind;
}

export interface CausalEdge {
  from: string;
  to: string;
  /** Elasticity: a +1% change in `from` is modeled to move `to` by `effect`%. */
  effect: number;
  /** 0..1 — how much we believe this edge (priors start low; the ledger refines). */
  confidence: number;
  /** Where the estimate comes from (a prior, or N measured interventions). */
  evidence: string;
}

export interface CausalModel {
  version: number;
  variables: CausalVariable[];
  edges: CausalEdge[];
  updatedAt?: string;
}

export interface PredictedEffect {
  variable: string;
  label: string;
  /** Predicted % change given the intervention. */
  deltaPct: number;
  /** Path confidence (product of edge confidences along the way), 0..1. */
  confidence: number;
}

export interface InterventionResult {
  lever: string;
  inputDeltaPct: number;
  effects: PredictedEffect[];
}

/** Kahn topological order; returns null on a cycle (caller falls back safely). */
function topoOrder(model: CausalModel): string[] | null {
  const indeg = new Map<string, number>();
  for (const v of model.variables) indeg.set(v.id, 0);
  for (const e of model.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const out: string[] = [];
  const outByFrom = new Map<string, CausalEdge[]>();
  for (const e of model.edges) {
    const arr = outByFrom.get(e.from) ?? [];
    arr.push(e);
    outByFrom.set(e.from, arr);
  }
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const e of outByFrom.get(n) ?? []) {
      indeg.set(e.to, (indeg.get(e.to) ?? 0) - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }
  return out.length === model.variables.length ? out : null;
}

/**
 * Forward-propagate an intervention (a `deltaPct` change to `leverId`) through
 * the causal graph and return the predicted % change + path confidence on every
 * downstream variable. Pure. This is what `simulate()` rolls candidate moves
 * through into the risk/economics gates — turning the gate stack from a safety
 * filter into a planning oracle.
 */
export function queryIntervention(model: CausalModel, leverId: string, deltaPct: number): InterventionResult {
  const labelOf = new Map(model.variables.map((v) => [v.id, v.label]));
  if (!labelOf.has(leverId)) return { lever: leverId, inputDeltaPct: deltaPct, effects: [] };

  const order = topoOrder(model);
  const delta = new Map<string, number>([[leverId, deltaPct]]);
  const conf = new Map<string, number>([[leverId, 1]]);
  const incoming = new Map<string, CausalEdge[]>();
  for (const e of model.edges) {
    const arr = incoming.get(e.to) ?? [];
    arr.push(e);
    incoming.set(e.to, arr);
  }

  const seq = order ?? model.variables.map((v) => v.id); // cycle → best-effort order
  for (const node of seq) {
    if (node === leverId) continue;
    const ins = incoming.get(node) ?? [];
    let d = 0;
    let bestConf = 0;
    for (const e of ins) {
      const srcDelta = delta.get(e.from) ?? 0;
      if (srcDelta === 0) continue;
      d += srcDelta * e.effect;
      bestConf = Math.max(bestConf, (conf.get(e.from) ?? 1) * e.confidence);
    }
    if (ins.length) {
      delta.set(node, d);
      conf.set(node, bestConf);
    }
  }

  const effects: PredictedEffect[] = [];
  for (const v of model.variables) {
    if (v.id === leverId) continue;
    const d = delta.get(v.id);
    if (d == null || d === 0) continue;
    effects.push({
      variable: v.id,
      label: labelOf.get(v.id) ?? v.id,
      deltaPct: Math.round(d * 100) / 100,
      confidence: Math.round((conf.get(v.id) ?? 0) * 100) / 100,
    });
  }
  // Outcomes first, then metrics — the operator cares about the bottom line.
  const kindRank = new Map(model.variables.map((v) => [v.id, v.kind === "outcome" ? 0 : 1]));
  effects.sort((a, b) => (kindRank.get(a.variable)! - kindRank.get(b.variable)!) || Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  return { lever: leverId, inputDeltaPct: deltaPct, effects };
}

/** A compact, honest text summary of the causal theory for the Context Pack. Pure. */
export function summarizeModel(model: CausalModel): string {
  const levers = model.variables.filter((v) => v.kind === "lever").map((v) => v.label);
  const edgeLines = model.edges
    .map((e) => {
      const f = model.variables.find((v) => v.id === e.from)?.label ?? e.from;
      const t = model.variables.find((v) => v.id === e.to)?.label ?? e.to;
      return `${f} →(${e.effect >= 0 ? "+" : ""}${e.effect}, conf ${Math.round(e.confidence * 100)}%) ${t}`;
    });
  return [
    `Causal theory of the business (v${model.version}) — levers: ${levers.join(", ")}.`,
    ...edgeLines.map((l) => `  ${l}`),
    `(Edge confidences are priors until refined from real witnessed interventions; treat as a decision aid with honest uncertainty, never an oracle.)`,
  ].join("\n");
}

// ── DOMAIN PACK: the AcreOS land-acquisition seed model ──────────────────────
// Priors only (low confidence) — they sharpen from the causal ledger over time.
export const ACREOS_SEED_MODEL: CausalModel = {
  version: 1,
  variables: [
    { id: "publish_guide", label: "Publish a county guide", kind: "lever" },
    { id: "ramp_budget", label: "Lift growth budget", kind: "lever" },
    { id: "witnessed_outbound", label: "Witnessed outbound touch", kind: "lever" },
    { id: "indexed_pages", label: "Indexed SEO pages", kind: "metric" },
    { id: "search_impressions", label: "Search impressions", kind: "metric" },
    { id: "parcel_checks", label: "Free parcel checks run", kind: "metric" },
    { id: "signups", label: "Signups", kind: "metric" },
    { id: "mrr", label: "MRR", kind: "outcome" },
  ],
  edges: [
    { from: "publish_guide", to: "indexed_pages", effect: 0.8, confidence: 0.4, evidence: "prior: a published guide adds indexable surface" },
    { from: "indexed_pages", to: "search_impressions", effect: 0.5, confidence: 0.3, evidence: "prior: impressions lag indexing 4-9mo" },
    { from: "search_impressions", to: "parcel_checks", effect: 0.3, confidence: 0.3, evidence: "prior: a fraction of impressions click through to the tool" },
    { from: "witnessed_outbound", to: "parcel_checks", effect: 0.2, confidence: 0.25, evidence: "prior: helpful outbound drives a few checks" },
    { from: "parcel_checks", to: "signups", effect: 0.15, confidence: 0.3, evidence: "prior: a fraction of checkers sign up (lower bound via attribution)" },
    { from: "signups", to: "mrr", effect: 1.0, confidence: 0.7, evidence: "prior: signups → trials → paid at the tier blend" },
    { from: "ramp_budget", to: "search_impressions", effect: 0.2, confidence: 0.2, evidence: "prior: paid amplification, only once funnel proven" },
  ],
};
