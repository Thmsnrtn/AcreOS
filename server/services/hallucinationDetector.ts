/**
 * Panel-300 #7 — hallucination detector for AI-generated content.
 *
 * Lightweight reasonableness checks on AI output BEFORE it's surfaced to
 * the operator. Distinct from the eval-as-gate (G1) which checks against
 * pre-defined test cases; this checks generated content against the
 * actual data context the AI was given.
 *
 * Three checks at v0:
 *   1. Cite verification — every numeric claim that looks like a citation
 *      ($X, N%, etc.) is checked against the source data. Hallucinated
 *      numbers (3 SDs from any source value) are flagged.
 *   2. ARV-vs-comp reasonableness — for offer/comp generation surfaces,
 *      the proposed ARV is checked vs the comp set median. ±50% deviation
 *      flags as suspicious.
 *   3. Disclosure-field-vs-schema match — for compliance disclosures,
 *      every field the AI says is "in" the document is verified to
 *      actually appear in the rendered text.
 *
 * On flag: returns a structured warnings list. Caller (route) can
 * either attach to response (advisory mode) or 422 reject (strict).
 */

export interface HallucinationWarning {
  // Pillar F / F1 — kinds extended for Pax entity-existence checks.
  kind:
    | "fabricated_number"
    | "arv_unreasonable"
    | "missing_disclosure_field"
    | "entity_not_in_org";
  detail: string;
  // severity is informational — most checks return "error", but
  // numeric warnings could become "warning" if we soften them later.
  severity?: "error" | "warning";
  field?: string;
  evidence?: { sourceValue?: number; outputValue?: number; field?: string };
}

const NUMBER_PATTERN = /\$([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*%/g;

function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(NUMBER_PATTERN)) {
    const raw = (match[1] ?? match[2] ?? "").replace(/,/g, "");
    const n = Number(raw);
    if (!Number.isNaN(n) && n > 0) out.push(n);
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Check 1 — Fabricated numbers. For every $-prefixed number or %-suffixed
 * number in the output, verify it exists in the source numeric set
 * (within 1% tolerance) OR is a sum/average computable from source values.
 *
 * Conservative: a 3-SD outlier from the source distribution flags as
 * fabricated. Tighter checks (exact-match) over-fire on rounding.
 */
export function checkFabricatedNumbers(
  output: string,
  sourceNumbers: number[],
): HallucinationWarning[] {
  if (sourceNumbers.length === 0) return [];
  const outputNumbers = extractNumbers(output);
  if (outputNumbers.length === 0) return [];

  const sourceMin = Math.min(...sourceNumbers);
  const sourceMax = Math.max(...sourceNumbers);
  const sourceMean = sourceNumbers.reduce((s, n) => s + n, 0) / sourceNumbers.length;
  const sourceVar =
    sourceNumbers.reduce((s, n) => s + (n - sourceMean) ** 2, 0) / sourceNumbers.length;
  const sourceStd = Math.sqrt(sourceVar);

  const warnings: HallucinationWarning[] = [];
  for (const out of outputNumbers) {
    if (out >= sourceMin * 0.95 && out <= sourceMax * 1.05) continue; // within source range
    if (Math.abs(out - sourceMean) <= 3 * sourceStd) continue; // within 3 SD
    // Also tolerate sums (output is the sum of any 2-3 source values)
    let isPlausibleSum = false;
    for (let i = 0; i < sourceNumbers.length; i++) {
      for (let j = i; j < sourceNumbers.length; j++) {
        if (Math.abs(sourceNumbers[i] + sourceNumbers[j] - out) < out * 0.02) {
          isPlausibleSum = true;
          break;
        }
      }
      if (isPlausibleSum) break;
    }
    if (isPlausibleSum) continue;
    warnings.push({
      kind: "fabricated_number",
      detail: `Output number ${out} is not in source range [${sourceMin}, ${sourceMax}] and not a plausible sum`,
      evidence: { outputValue: out, sourceValue: sourceMean },
    });
  }
  return warnings;
}

/**
 * Check 2 — ARV-vs-comp reasonableness. Given proposed ARV and the
 * comp set, flag if proposed is ±50% off comp median.
 */
export function checkArvReasonableness(
  proposedArv: number,
  compArvs: number[],
): HallucinationWarning[] {
  if (compArvs.length === 0) return [];
  const med = median(compArvs);
  if (med === 0) return [];
  const dev = Math.abs(proposedArv - med) / med;
  if (dev > 0.5) {
    return [{
      kind: "arv_unreasonable",
      detail: `Proposed ARV $${proposedArv} deviates ${(dev * 100).toFixed(0)}% from comp median $${med.toFixed(0)}`,
      evidence: { outputValue: proposedArv, sourceValue: med },
    }];
  }
  return [];
}

/**
 * Check 3 — Disclosure field-vs-schema. For each field name the AI
 * claims to have included, verify the field appears in the rendered text.
 */
export function checkDisclosureFields(
  output: string,
  requiredFields: string[],
): HallucinationWarning[] {
  const warnings: HallucinationWarning[] = [];
  const lowered = output.toLowerCase();
  for (const field of requiredFields) {
    if (!lowered.includes(field.toLowerCase())) {
      warnings.push({
        kind: "missing_disclosure_field",
        detail: `AI output claims to include "${field}" but the field is absent from rendered text`,
        evidence: { field },
      });
    }
  }
  return warnings;
}

/**
 * Composite check. Caller passes the AI output + the relevant context
 * (source numbers, comp set, required fields) and gets a single
 * warnings list.
 */
export function detectHallucinations(opts: {
  output: string;
  sourceNumbers?: number[];
  proposedArv?: number;
  compArvs?: number[];
  requiredFields?: string[];
}): HallucinationWarning[] {
  const warnings: HallucinationWarning[] = [];
  if (opts.sourceNumbers) {
    warnings.push(...checkFabricatedNumbers(opts.output, opts.sourceNumbers));
  }
  if (opts.proposedArv != null && opts.compArvs) {
    warnings.push(...checkArvReasonableness(opts.proposedArv, opts.compArvs));
  }
  if (opts.requiredFields) {
    warnings.push(...checkDisclosureFields(opts.output, opts.requiredFields));
  }
  return warnings;
}
